import { localBus, channelName } from "@/lib/bus";
import { usingSupabase } from "@/lib/store";
import { bad, loadRoom } from "@/lib/http";
import type { RoomEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

// Server-Sent Events for local in-memory mode. With Supabase configured the
// browser subscribes to Realtime directly and this route is unused.
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  if (usingSupabase) return bad("Use Supabase Realtime", 410);
  const room = await loadRoom((await params).code);
  if (!room) return bad("Room not found", 404);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (e: RoomEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      const ping = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 15_000);
      localBus.on(channelName(room.code), send);
      req.signal.addEventListener("abort", () => {
        clearInterval(ping);
        localBus.off(channelName(room.code), send);
        try { controller.close(); } catch {}
      });
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
