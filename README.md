# Shared AI Room

Hackathon MVP: several people chat with **one AI (Claude or GPT) in one shared room** with one shared context, live.
The host creates a room, others join by code, link or QR (no signup), and everyone sees the same history and the same AI reply streaming token by token.

Standalone app. It has nothing to do with Folk AI and does not touch `apps/web`.

## Run locally (2 minutes, no database)

```bash
cd hackathon/shared-ai-room
npm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY / OPENAI_API_KEY (optional)
npm run build && npm start   # http://localhost:3000
```

Without Supabase variables the app uses an **in-memory store + Server-Sent Events**, which works on one Node process (`next start` / `next dev`).
Without an API key, that provider runs in **mock mode** and streams a canned reply, so you can still demo the realtime flow.
To use a phone on the same Wi-Fi, open `http://<laptop-LAN-IP>:3000`. The QR encodes whatever origin the laptop is using.

## Deploy to Vercel (needs Supabase)

Serverless functions don't share memory, so production needs Supabase for storage and Realtime.

1. Create a Supabase project and run `supabase/schema.sql` in the SQL Editor.
2. Create a Vercel project with **Root Directory = `hackathon/shared-ai-room`** and set these env vars:

| Var | Where it is used |
|---|---|
| `ANTHROPIC_API_KEY` | server only |
| `OPENAI_API_KEY` | server only |
| `NEXT_PUBLIC_SUPABASE_URL` | server + browser (Realtime subscribe) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser, Realtime only (tables have RLS on and grants revoked) |
| `SUPABASE_SERVICE_ROLE_KEY` | server only |
| `CLAUDE_MODEL` (optional) | default `claude-opus-5` |
| `OPENAI_MODEL` (optional) | default `gpt-4.1` |

3. Deploy. `/api/rooms/[code]/messages` sets `maxDuration = 300` so a reply can finish streaming.

## How it works

- **Storage**: rooms, participants and messages live in `lib/store.ts` (Supabase or memory).
- **Send**: `POST /api/rooms/:code/messages`. A message starting with `@ai` (or sent with **Ask AI**) is stored as `ai_status = pending`.
  After responding, the route runs `drainAiQueue` in `after()`.
- **One AI reply at a time**: `drainAiQueue` takes a per-room lock (`rooms.ai_lock_at`, an atomic compare-and-set, stale after 150 s) and answers pending requests in order.
  Requests that arrive while the AI is busy wait as `pending`, and the lock holder picks them up.
- **Context**: every human message up to the request, as `[Name]: text` user turns, with each earlier AI reply placed right after the message it answered (`contextFor` in `lib/runner.ts`).
  Replies from both models become assistant turns, so switching Claude ↔ GPT continues the same conversation.
- **Streaming**: the server streams from the model and broadcasts the *cumulative* text every 120 ms (`ai_start` → `ai_text`… → `ai_done`) on channel `room:CODE`.
  It uses Supabase Realtime broadcast in production and SSE locally. The final message is written to the DB.
- **Presence**: a 10 s heartbeat. "Online" means seen in the last 30 s.
- **Model switch**: host only (`rooms.host_participant_id`). The change is broadcast to everyone.

## Status

Done
- Create or join a room by code, link or QR. Large QR overlay for the projector. Copy-link button.
- Display names, online list, host badge.
- Realtime shared feed with the full history for late joiners.
- `@ai` / Ask AI, with replies streamed live to everyone at once.
- Per-room queue, so there is only one AI reply at a time.
- Claude/GPT switcher (host only) that keeps the history.
- Speaker-prefixed history and the required system prompt.
- API keys stay server-side.
- Mock mode when no key is set.

Not done / known limits
- No auth: the participant id in `localStorage` is the only identity. Anyone with the code can join.
- Someone who joins in the middle of a stream sees that reply only when it finishes.
- The Supabase deploy path is written but was not exercised end to end yet. The local memory + SSE path was tested with two browsers.
- No rate limits, room expiry or message editing (out of scope).
- There is no trimming for very long rooms. The last 500 messages are loaded and sent.
