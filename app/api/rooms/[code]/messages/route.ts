import { NextResponse, after } from "next/server";
import { store } from "@/lib/store";
import { publish } from "@/lib/bus";
import { drainAiQueue } from "@/lib/runner";
import { bad, body, loadRoom, member } from "@/lib/http";

// The AI reply streams inside after(), so allow a long-running function.
export const maxDuration = 300;

const AI_PREFIX = /^\s*@ai\b[:,]?\s*/i;

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const room = await loadRoom((await params).code);
  if (!room) return bad("Room not found", 404);
  const b = await body(req);
  const me = await member(room.id, b.participantId);
  if (!me) return bad("Not in this room", 403);

  const raw = String(b.content ?? "").trim().slice(0, 4000);
  if (!raw) return bad("Empty message");
  const askAi = b.askAi === true || AI_PREFIX.test(raw);
  const content = raw.replace(AI_PREFIX, "") || raw;

  const message = await store.addMessage({
    room_id: room.id,
    sender_type: "human",
    sender_name: me.display_name,
    model: null,
    content: askAi ? `@ai ${content}` : content,
    ai_requested: askAi,
    ai_status: askAi ? "pending" : "none",
    reply_to: null,
  });
  await publish(room.code, { type: "message", message });
  void store.touch(me.id);

  if (askAi) {
    const pending = await store.countPendingAi(room.id);
    await publish(room.code, { type: "ai_queue", pending });
    after(() => drainAiQueue(room));
  }
  return NextResponse.json({ message });
}
