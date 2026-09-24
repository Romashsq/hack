import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { publish } from "@/lib/bus";
import { cleanName, randomCode } from "@/lib/codes";
import { bad, body } from "@/lib/http";
import type { ModelKind } from "@/lib/types";

export async function POST(req: Request) {
  const b = await body(req);
  const name = cleanName(b.name);
  const model: ModelKind = b.model === "gpt" ? "gpt" : "claude";
  if (!name) return bad("Enter a display name");

  let room = null;
  for (let i = 0; i < 5 && !room; i++) {
    const code = randomCode();
    if (await store.getRoom(code)) continue;
    room = await store.createRoom(code, model).catch(() => null);
  }
  if (!room) return bad("Could not create room, try again", 500);

  const host = await store.addParticipant(room.id, name);
  await store.setHost(room.id, host.id);
  await publish(room.code, { type: "presence" });
  return NextResponse.json({ code: room.code, participantId: host.id });
}
