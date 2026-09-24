import "server-only";
import { NextResponse } from "next/server";
import { store } from "./store";
import { normalizeCode } from "./codes";

export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function loadRoom(rawCode: string) {
  return store.getRoom(normalizeCode(rawCode));
}

export async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// Participant must exist and belong to this room.
export async function member(roomId: string, participantId: unknown) {
  if (typeof participantId !== "string" || !participantId) return null;
  const p = await store.getParticipant(participantId).catch(() => null);
  return p && p.room_id === roomId ? p : null;
}
