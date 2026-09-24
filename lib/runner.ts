import "server-only";
import { randomUUID } from "crypto";
import { store } from "./store";
import { publish } from "./bus";
import { streamReply } from "./ai";
import type { Message, Room } from "./types";

const FLUSH_MS = 120;

// Drains the room's AI queue. Only the caller that wins the room lock runs;
// everyone else just leaves their request as `pending` and the winner picks it
// up. One AI reply at a time per room, in message order.
export async function drainAiQueue(room: Room): Promise<void> {
  // Loop guards the race where a request lands right after we unlock.
  for (let round = 0; round < 3; round++) {
    if (!(await store.tryLockAi(room.id))) return;
    try {
      let pending;
      while ((pending = await store.nextPendingAi(room.id))) {
        await publish(room.code, { type: "ai_queue", pending: await store.countPendingAi(room.id) });
        await answer(room.code, pending.seq, pending.id);
      }
    } finally {
      await store.unlockAi(room.id);
      await publish(room.code, { type: "ai_queue", pending: 0 });
    }
    if ((await store.countPendingAi(room.id)) === 0) return;
  }
}

async function answer(code: string, uptoSeq: number, requestId: string) {
  // Re-read the room so a model switch applies to the next reply.
  const room = (await store.getRoom(code))!;
  const history = contextFor(await store.listMessages(room.id), uptoSeq);
  const streamId = randomUUID();
  const model = room.model;
  await publish(code, { type: "ai_start", streamId, model });

  let latest = "";
  let sent = "";
  let inflight: Promise<void> = Promise.resolve();
  const timer = setInterval(() => {
    if (latest !== sent) {
      sent = latest;
      // Cumulative text, so out-of-order delivery can never garble the stream.
      inflight = publish(code, { type: "ai_text", streamId, content: sent });
    }
  }, FLUSH_MS);

  let content: string;
  try {
    content = await streamReply(model, history, (full) => (latest = full));
  } catch (err) {
    console.error("AI error", err);
    content = `⚠️ ${model === "claude" ? "Claude" : "GPT"} error: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    clearInterval(timer);
    await inflight;
  }

  const message = await store.addMessage({
    room_id: room.id,
    sender_type: "ai",
    sender_name: model === "claude" ? "Claude" : "GPT",
    model,
    content: content || "(empty reply)",
    ai_requested: false,
    ai_status: "none",
    reply_to: requestId,
  });
  await store.markAiDone(requestId);
  await publish(code, { type: "ai_done", streamId, message });
}

// Everything humans said up to the request, with each AI reply placed right
// after the message it answered (replies land later in seq order when queued).
export function contextFor(all: Message[], uptoSeq: number): Message[] {
  const replies = new Map<string, Message[]>();
  for (const m of all) {
    if (m.sender_type === "ai" && m.reply_to) {
      replies.set(m.reply_to, [...(replies.get(m.reply_to) ?? []), m]);
    }
  }
  const out: Message[] = [];
  for (const m of all) {
    if (m.sender_type !== "human" || m.seq > uptoSeq) continue;
    out.push(m, ...(replies.get(m.id) ?? []));
  }
  return out;
}
