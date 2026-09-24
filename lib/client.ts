"use client";
import { useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import type { RoomEvent } from "./types";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = SB_URL && SB_ANON ? createClient(SB_URL, SB_ANON) : null;

export async function api<T>(path: string, data?: unknown): Promise<T> {
  const res = await fetch(path, data === undefined ? { cache: "no-store" } : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

export const identityKey = (code: string) => `sar:${code}`;

export type RealtimeMode = "supabase" | "sse";

// Subscribe to room events on the channel the server publishes to (reported by
// the room snapshot): Supabase Realtime broadcast or SSE.
// onReconnect fires after (re)subscribing so the caller can resync history.
export function useRoomEvents(
  code: string | null,
  mode: RealtimeMode | null,
  onEvent: (e: RoomEvent) => void,
  onReconnect: () => void,
) {
  const handler = useRef(onEvent);
  const resync = useRef(onReconnect);
  handler.current = onEvent;
  resync.current = onReconnect;

  useEffect(() => {
    if (!code || !mode) return;
    if (mode === "supabase") {
      if (!sb) {
        console.error("Server uses Supabase but NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are missing");
        return;
      }
      const ch = sb
        .channel(`room:${code}`)
        .on("broadcast", { event: "room" }, ({ payload }) => handler.current(payload as RoomEvent))
        .subscribe((status) => { if (status === "SUBSCRIBED") resync.current(); });
      return () => { void sb.removeChannel(ch); };
    }
    const es = new EventSource(`/api/rooms/${code}/events`);
    es.onopen = () => resync.current();
    es.onmessage = (m) => handler.current(JSON.parse(m.data) as RoomEvent);
    return () => es.close();
  }, [code, mode]);
}
