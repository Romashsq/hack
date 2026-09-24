import "server-only";
import { randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Message, ModelKind, Participant, Room } from "./types";

// Storage layer. Supabase Postgres when configured, otherwise an in-process
// store (fine for `next dev` / a single Node server, NOT for serverless).

export const ONLINE_WINDOW_MS = 30_000;
export const AI_LOCK_STALE_MS = 150_000;

export interface Store {
  createRoom(code: string, model: ModelKind): Promise<Room>;
  getRoom(code: string): Promise<Room | null>;
  setHost(roomId: string, participantId: string): Promise<void>;
  setModel(roomId: string, model: ModelKind): Promise<void>;
  addParticipant(roomId: string, name: string): Promise<Participant>;
  getParticipant(id: string): Promise<Participant | null>;
  touch(id: string): Promise<void>;
  listOnline(roomId: string): Promise<Participant[]>;
  addMessage(m: Omit<Message, "id" | "seq" | "created_at">): Promise<Message>;
  listMessages(roomId: string): Promise<Message[]>;
  nextPendingAi(roomId: string): Promise<Message | null>;
  countPendingAi(roomId: string): Promise<number>;
  markAiDone(messageId: string): Promise<void>;
  tryLockAi(roomId: string): Promise<boolean>;
  unlockAi(roomId: string): Promise<void>;
}

// ---------- in-memory ----------

interface Mem {
  rooms: Map<string, Room & { ai_lock_at: number | null }>;
  participants: Map<string, Participant>;
  messages: Message[];
  seq: number;
}

const g = globalThis as unknown as { __sarMem?: Mem };
const mem: Mem = (g.__sarMem ??= {
  rooms: new Map(),
  participants: new Map(),
  messages: [],
  seq: 0,
});

const now = () => new Date().toISOString();

const memoryStore: Store = {
  async createRoom(code, model) {
    const room = { id: randomUUID(), code, model, host_participant_id: null, created_at: now(), ai_lock_at: null };
    mem.rooms.set(code, room);
    return room;
  },
  async getRoom(code) {
    return mem.rooms.get(code) ?? null;
  },
  async setHost(roomId, pid) {
    for (const r of mem.rooms.values()) if (r.id === roomId) r.host_participant_id = pid;
  },
  async setModel(roomId, model) {
    for (const r of mem.rooms.values()) if (r.id === roomId) r.model = model;
  },
  async addParticipant(roomId, name) {
    const p = { id: randomUUID(), room_id: roomId, display_name: name, joined_at: now(), last_seen: now() };
    mem.participants.set(p.id, p);
    return p;
  },
  async getParticipant(id) {
    return mem.participants.get(id) ?? null;
  },
  async touch(id) {
    const p = mem.participants.get(id);
    if (p) p.last_seen = now();
  },
  async listOnline(roomId) {
    const cutoff = Date.now() - ONLINE_WINDOW_MS;
    return [...mem.participants.values()].filter(
      (p) => p.room_id === roomId && Date.parse(p.last_seen) >= cutoff,
    );
  },
  async addMessage(m) {
    const msg: Message = { ...m, id: randomUUID(), seq: ++mem.seq, created_at: now() };
    mem.messages.push(msg);
    return msg;
  },
  async listMessages(roomId) {
    return mem.messages.filter((m) => m.room_id === roomId);
  },
  async nextPendingAi(roomId) {
    return mem.messages.find((m) => m.room_id === roomId && m.ai_status === "pending") ?? null;
  },
  async countPendingAi(roomId) {
    return mem.messages.filter((m) => m.room_id === roomId && m.ai_status === "pending").length;
  },
  async markAiDone(id) {
    const m = mem.messages.find((x) => x.id === id);
    if (m) m.ai_status = "done";
  },
  async tryLockAi(roomId) {
    for (const r of mem.rooms.values()) {
      if (r.id !== roomId) continue;
      if (r.ai_lock_at && Date.now() - r.ai_lock_at < AI_LOCK_STALE_MS) return false;
      r.ai_lock_at = Date.now();
      return true;
    }
    return false;
  },
  async unlockAi(roomId) {
    for (const r of mem.rooms.values()) if (r.id === roomId) r.ai_lock_at = null;
  },
};

// ---------- Supabase ----------

function supabaseStore(sb: SupabaseClient): Store {
  const one = <T>(res: { data: T | null; error: { message: string } | null }) => {
    if (res.error) throw new Error(res.error.message);
    return res.data;
  };
  const ROOM_COLS = "id, code, model, host_participant_id, created_at";
  const MSG_COLS = "id, seq, room_id, sender_type, sender_name, model, content, ai_requested, ai_status, reply_to, created_at";

  return {
    async createRoom(code, model) {
      return one(await sb.from("rooms").insert({ code, model }).select(ROOM_COLS).single()) as Room;
    },
    async getRoom(code) {
      return one(await sb.from("rooms").select(ROOM_COLS).eq("code", code).maybeSingle()) as Room | null;
    },
    async setHost(roomId, pid) {
      one(await sb.from("rooms").update({ host_participant_id: pid }).eq("id", roomId));
    },
    async setModel(roomId, model) {
      one(await sb.from("rooms").update({ model }).eq("id", roomId));
    },
    async addParticipant(roomId, name) {
      return one(
        await sb.from("participants").insert({ room_id: roomId, display_name: name }).select("*").single(),
      ) as Participant;
    },
    async getParticipant(id) {
      return one(await sb.from("participants").select("*").eq("id", id).maybeSingle()) as Participant | null;
    },
    async touch(id) {
      one(await sb.from("participants").update({ last_seen: now() }).eq("id", id));
    },
    async listOnline(roomId) {
      const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
      return (one(
        await sb.from("participants").select("*").eq("room_id", roomId).gte("last_seen", cutoff).order("joined_at"),
      ) ?? []) as Participant[];
    },
    async addMessage(m) {
      return one(await sb.from("messages").insert(m).select(MSG_COLS).single()) as Message;
    },
    async listMessages(roomId) {
      return (one(
        await sb.from("messages").select(MSG_COLS).eq("room_id", roomId).order("seq").limit(500),
      ) ?? []) as Message[];
    },
    async nextPendingAi(roomId) {
      return one(
        await sb.from("messages").select(MSG_COLS).eq("room_id", roomId).eq("ai_status", "pending")
          .order("seq").limit(1).maybeSingle(),
      ) as Message | null;
    },
    async countPendingAi(roomId) {
      const res = await sb.from("messages").select("id", { count: "exact", head: true })
        .eq("room_id", roomId).eq("ai_status", "pending");
      if (res.error) throw new Error(res.error.message);
      return res.count ?? 0;
    },
    async markAiDone(id) {
      one(await sb.from("messages").update({ ai_status: "done" }).eq("id", id));
    },
    async tryLockAi(roomId) {
      // Atomic compare-and-set: only one request wins the room's AI slot.
      const stale = new Date(Date.now() - AI_LOCK_STALE_MS).toISOString();
      const rows = one(
        await sb.from("rooms").update({ ai_lock_at: now() }).eq("id", roomId)
          .or(`ai_lock_at.is.null,ai_lock_at.lt."${stale}"`).select("id"),
      );
      return Array.isArray(rows) && rows.length > 0;
    },
    async unlockAi(roomId) {
      one(await sb.from("rooms").update({ ai_lock_at: null }).eq("id", roomId));
    },
  };
}

export const usingSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

export const store: Store = usingSupabase
  ? supabaseStore(
      createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false },
      }),
    )
  : memoryStore;
