"use client";
import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { api, identityKey, useRoomEvents } from "@/lib/client";
import { normalizeCode } from "@/lib/codes";
import { MODEL_LABEL, type Message, type ModelKind, type RoomEvent } from "@/lib/types";

type Identity = { participantId: string; name: string };
type Online = { id: string; display_name: string };
type Snapshot = {
  room: { code: string; model: ModelKind; host_participant_id: string | null };
  messages: Message[];
  online: Online[];
  pending: number;
};
type Live = { streamId: string; model: ModelKind; content: string };

export default function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const code = normalizeCode(use(params).code);
  const [me, setMe] = useState<Identity | null | undefined>(undefined);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(identityKey(code));
      setMe(raw ? (JSON.parse(raw) as Identity) : null);
    } catch {
      setMe(null);
    }
  }, [code]);

  if (me === undefined) return null;
  if (!me) return <JoinForm code={code} onJoined={setMe} />;
  return <Room code={code} me={me} onKicked={() => { localStorage.removeItem(identityKey(code)); setMe(null); }} />;
}

function JoinForm({ code, onJoined }: { code: string; onJoined: (i: Identity) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function join() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ participantId: string }>(`/api/rooms/${code}/join`, { name });
      const id = { participantId: r.participantId, name: name.trim() };
      localStorage.setItem(identityKey(code), JSON.stringify(id));
      onJoined(id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4">
      <p className="text-sm text-zinc-500">Joining room</p>
      <h1 className="font-mono text-4xl font-semibold tracking-[0.2em]">{code}</h1>
      <input
        autoFocus
        className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2.5 dark:border-zinc-700"
        placeholder="Your display name"
        value={name}
        maxLength={30}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && name.trim() && join()}
      />
      <button
        disabled={busy || !name.trim()}
        onClick={join}
        className="rounded-lg bg-indigo-600 px-3 py-2.5 font-medium text-white disabled:opacity-40"
      >
        {busy ? "Joining…" : "Join room"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Link href="/" className="text-sm text-zinc-500 underline">Back home</Link>
    </main>
  );
}

function Room({ code, me, onKicked }: { code: string; me: Identity; onKicked: () => void }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [live, setLive] = useState<Record<string, Live>>({});
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [qr, setQr] = useState("");
  const [link, setLink] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);

  const isHost = snap?.room.host_participant_id === me.participantId;

  const load = useCallback(async () => {
    try {
      const s = await api<Snapshot>(`/api/rooms/${code}`);
      setSnap(s);
      if (s.pending === 0) setLive({});
    } catch (e) {
      setError((e as Error).message);
    }
  }, [code]);

  const heartbeat = useCallback(async () => {
    try {
      const r = await api<{ online: Online[] }>(`/api/rooms/${code}/heartbeat`, { participantId: me.participantId });
      setSnap((s) => (s ? { ...s, online: r.online } : s));
    } catch (e) {
      if ((e as Error).message === "Not in this room") onKicked();
    }
  }, [code, me.participantId, onKicked]);

  useEffect(() => {
    void load();
    void heartbeat();
    const t = setInterval(heartbeat, 10_000);
    return () => clearInterval(t);
  }, [load, heartbeat]);

  useEffect(() => {
    const url = `${window.location.origin}/r/${code}`;
    setLink(url);
    QRCode.toDataURL(url, { margin: 1, width: 720 }).then(setQr);
  }, [code]);

  const addMessage = (m: Message) =>
    setSnap((s) => (!s || s.messages.some((x) => x.id === m.id) ? s : { ...s, messages: [...s.messages, m] }));

  useRoomEvents(
    code,
    (e: RoomEvent) => {
      switch (e.type) {
        case "message":
          addMessage(e.message);
          break;
        case "ai_start":
          setLive((l) => ({ ...l, [e.streamId]: { streamId: e.streamId, model: e.model, content: "" } }));
          break;
        case "ai_text":
          setLive((l) => (l[e.streamId] ? { ...l, [e.streamId]: { ...l[e.streamId], content: e.content } } : l));
          break;
        case "ai_done":
          addMessage(e.message);
          setLive((l) => {
            const { [e.streamId]: _, ...rest } = l;
            return rest;
          });
          break;
        case "ai_queue":
          setSnap((s) => (s ? { ...s, pending: e.pending } : s));
          break;
        case "model":
          setSnap((s) => (s ? { ...s, room: { ...s.room, model: e.model } } : s));
          flash(`${e.by} switched the AI to ${MODEL_LABEL[e.model]}`);
          break;
        case "presence":
          void heartbeat();
          break;
      }
    },
    load,
  );

  // Keep the feed pinned to the bottom while messages stream in.
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [snap?.messages.length, live]);

  function flash(text: string) {
    setToast(text);
    setTimeout(() => setToast(""), 3000);
  }

  async function send(askAi: boolean) {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    try {
      const r = await api<{ message: Message }>(`/api/rooms/${code}/messages`, {
        participantId: me.participantId,
        content,
        askAi,
      });
      addMessage(r.message);
    } catch (e) {
      setDraft(content);
      flash((e as Error).message);
    }
  }

  async function switchModel(model: ModelKind) {
    try {
      await api(`/api/rooms/${code}/model`, { participantId: me.participantId, model });
      setSnap((s) => (s ? { ...s, room: { ...s.room, model } } : s));
    } catch (e) {
      flash((e as Error).message);
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(link).catch(() => {});
    flash("Link copied");
  }

  if (error) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-3 px-4">
        <p className="text-lg">{error}</p>
        <Link href="/" className="text-indigo-600 underline">Back home</Link>
      </main>
    );
  }
  if (!snap) return <p className="p-6 text-zinc-500">Loading room…</p>;

  const liveList = Object.values(live);
  const model = snap.room.model;
  const aiBusy = liveList.length > 0 || snap.pending > 0;

  const panel = (
    <aside className="space-y-6">
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Online · {snap.online.length}
        </h3>
        <ul className="space-y-1.5">
          {snap.online.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="truncate">{p.display_name}</span>
              {p.id === snap.room.host_participant_id && <span className="text-xs text-zinc-500">host</span>}
              {p.id === me.participantId && <span className="text-xs text-zinc-500">you</span>}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Invite</h3>
        {qr && (
          <button onClick={() => setShowQr(true)} className="block w-full rounded-xl bg-white p-2" title="Show large QR">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code to join" className="w-full" />
          </button>
        )}
        <p className="mt-2 text-center font-mono text-2xl font-semibold tracking-[0.2em]">{code}</p>
        <button onClick={copyLink} className="mt-2 w-full rounded-lg border border-zinc-300 py-1.5 text-sm dark:border-zinc-700">
          Copy link
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <Link href="/" className="font-semibold">Shared AI Room</Link>
        <span className="font-mono text-sm tracking-widest text-zinc-500">{code}</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-lg border border-zinc-300 p-0.5 text-sm dark:border-zinc-700" title={isHost ? "Switch model" : "Only the host can switch"}>
            {(["claude", "gpt"] as const).map((m) => (
              <button
                key={m}
                disabled={!isHost || model === m}
                onClick={() => switchModel(m)}
                className={`rounded-md px-3 py-1 font-medium ${model === m ? "bg-indigo-600 text-white" : "text-zinc-500 enabled:hover:text-zinc-900 dark:enabled:hover:text-white"}`}
              >
                {MODEL_LABEL[m]}
              </button>
            ))}
          </div>
          <button onClick={() => setShowQr(true)} className="rounded-lg border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700">QR</button>
          <button onClick={() => setShowPanel((v) => !v)} className="rounded-lg border border-zinc-300 px-3 py-1 text-sm lg:hidden dark:border-zinc-700">
            {snap.online.length} online
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={feedRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {snap.messages.length === 0 && liveList.length === 0 && (
              <p className="mt-10 text-center text-sm text-zinc-500">
                No messages yet. Start with <span className="font-mono">@ai</span> to ask {MODEL_LABEL[model]}.
              </p>
            )}
            {snap.messages.map((m) => (
              <Bubble key={m.id} m={m} mine={m.sender_type === "human" && m.sender_name === me.name} />
            ))}
            {liveList.map((l) => (
              <Bubble
                key={l.streamId}
                streaming
                m={{ sender_type: "ai", sender_name: MODEL_LABEL[l.model], model: l.model, content: l.content } as Message}
              />
            ))}
          </div>

          <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
            {aiBusy && (
              <p className="mb-2 text-xs text-zinc-500">
                {liveList.length ? `${MODEL_LABEL[liveList[0].model]} is answering…` : `${MODEL_LABEL[model]} is thinking…`}
                {snap.pending > 1 && ` ${snap.pending - 1} more queued.`}
              </p>
            )}
            <div className="flex items-end gap-2">
              <textarea
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(false);
                  }
                }}
                placeholder={`Message the room… start with @ai to ask ${MODEL_LABEL[model]}`}
                className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-zinc-300 bg-transparent px-3 py-2.5 dark:border-zinc-700"
              />
              <button onClick={() => send(false)} className="h-[44px] rounded-xl border border-zinc-300 px-3 text-sm font-medium dark:border-zinc-700">
                Send
              </button>
              <button onClick={() => send(true)} className="h-[44px] rounded-xl bg-indigo-600 px-3 text-sm font-medium text-white">
                Ask AI
              </button>
            </div>
          </div>
        </div>

        <div className="hidden w-72 shrink-0 overflow-y-auto border-l border-zinc-200 p-4 lg:block dark:border-zinc-800">{panel}</div>
      </div>

      {showPanel && (
        <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setShowPanel(false)}>
          <div className="absolute right-0 top-0 h-full w-72 overflow-y-auto bg-white p-4 dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
            {panel}
          </div>
        </div>
      )}

      {showQr && (
        <div className="fixed inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-zinc-950/95 p-6 text-white" onClick={() => setShowQr(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {qr && <img src={qr} alt="QR code to join" className="aspect-square w-[min(80vw,70vh)] rounded-2xl bg-white p-4" />}
          <p className="font-mono text-6xl font-semibold tracking-[0.25em]">{code}</p>
          <p className="text-zinc-400">{link}</p>
          <p className="text-sm text-zinc-500">Tap anywhere to close</p>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-white dark:text-zinc-900">
          {toast}
        </div>
      )}
    </div>
  );
}

function Bubble({ m, mine, streaming }: { m: Message; mine?: boolean; streaming?: boolean }) {
  const ai = m.sender_type === "ai";
  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <span className="mb-0.5 px-1 text-xs text-zinc-500">
        {m.sender_name}
        {ai && m.model && <span className="ml-1 rounded bg-indigo-100 px-1 text-[10px] font-semibold uppercase text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">AI</span>}
      </span>
      <div
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed ${
          ai
            ? "border border-indigo-200 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950/50"
            : mine
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "bg-white shadow-sm dark:bg-zinc-800"
        }`}
      >
        {m.content}
        {streaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-indigo-500 align-middle" />}
      </div>
    </div>
  );
}
