import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { publish } from "@/lib/bus";
import { cleanName } from "@/lib/codes";
import { bad, body, loadRoom } from "@/lib/http";

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const room = await loadRoom((await params).code);
  if (!room) return bad("Room not found", 404);
  const name = cleanName((await body(req)).name);
  if (!name) return bad("Enter a display name");
  const p = await store.addParticipant(room.id, name);
  await publish(room.code, { type: "presence" });
  return NextResponse.json({ code: room.code, participantId: p.id });
}
