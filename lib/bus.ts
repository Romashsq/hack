import "server-only";
import { EventEmitter } from "events";
import type { RoomEvent } from "./types";
import { usingSupabase } from "./store";

// Fan-out of room events. Supabase Realtime broadcast (REST) when configured,
// otherwise an in-process emitter consumed by the SSE route.

const g = globalThis as unknown as { __sarBus?: EventEmitter };
export const localBus: EventEmitter = (g.__sarBus ??= (() => {
  const e = new EventEmitter();
  e.setMaxListeners(0);
  return e;
})());

export const channelName = (code: string) => `room:${code}`;

export async function publish(code: string, event: RoomEvent): Promise<void> {
  if (!usingSupabase) {
    localBus.emit(channelName(code), event);
    return;
  }
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/realtime/v1/api/broadcast`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: key,
        "Content-Type": "application/json",
        // Legacy JWT keys also go in Authorization; new sb_secret_ keys must not.
        ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        messages: [{ topic: channelName(code), event: "room", payload: event }],
      }),
    });
    if (!res.ok) console.error("broadcast failed", res.status, await res.text());
  } catch (err) {
    console.error("broadcast error", err);
  }
}
