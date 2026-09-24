import { NextResponse } from "next/server";
import { store, usingSupabase } from "@/lib/store";
import { bad, loadRoom } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const room = await loadRoom((await params).code);
  if (!room) return bad("Room not found", 404);
  const [messages, online, pending] = await Promise.all([
    store.listMessages(room.id),
    store.listOnline(room.id),
    store.countPendingAi(room.id),
  ]);
  return NextResponse.json({
    room: { code: room.code, model: room.model, host_participant_id: room.host_participant_id },
    messages,
    online: online.map((p) => ({ id: p.id, display_name: p.display_name })),
    pending,
    // Tells the browser which realtime channel the server publishes on.
    realtime: usingSupabase ? "supabase" : "sse",
  });
}
