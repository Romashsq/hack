import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { bad, body, loadRoom, member } from "@/lib/http";

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const room = await loadRoom((await params).code);
  if (!room) return bad("Room not found", 404);
  const me = await member(room.id, (await body(req)).participantId);
  if (!me) return bad("Not in this room", 403);
  await store.touch(me.id);
  const online = await store.listOnline(room.id);
  return NextResponse.json({ online: online.map((p) => ({ id: p.id, display_name: p.display_name })) });
}
