import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { publish } from "@/lib/bus";
import { bad, body, loadRoom, member } from "@/lib/http";

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const room = await loadRoom((await params).code);
  if (!room) return bad("Room not found", 404);
  const b = await body(req);
  const me = await member(room.id, b.participantId);
  if (!me) return bad("Not in this room", 403);
  if (room.host_participant_id !== me.id) return bad("Only the host can switch the model", 403);
  const model = b.model === "gpt" ? "gpt" : "claude";
  await store.setModel(room.id, model);
  await publish(room.code, { type: "model", model, by: me.display_name });
  return NextResponse.json({ model });
}
