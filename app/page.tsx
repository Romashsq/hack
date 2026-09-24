"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, identityKey } from "@/lib/client";
import { normalizeCode } from "@/lib/codes";
import type { ModelKind } from "@/lib/types";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [model, setModel] = useState<ModelKind>("claude");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ code: string; participantId: string }>("/api/rooms", { name, model });
      localStorage.setItem(identityKey(r.code), JSON.stringify({ participantId: r.participantId, name }));
      router.push(`/r/${r.code}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  function join() {
    const c = normalizeCode(code);
    if (c.length !== 6) return setError("Room codes are 6 characters");
    router.push(`/r/${c}`);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-4 py-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Shared AI Room</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          One AI chat for the whole group. Same history, live, for everyone in the room.
        </p>
      </div>

      <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="font-medium">Create a room</h2>
        <input
          className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
          placeholder="Your display name"
          value={name}
          maxLength={30}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-2">
          {(["claude", "gpt"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setModel(m)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                model === m
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-zinc-300 dark:border-zinc-700"
              }`}
            >
              {m === "claude" ? "Claude" : "GPT"}
            </button>
          ))}
        </div>
        <button
          disabled={busy || !name.trim()}
          onClick={create}
          className="w-full rounded-lg bg-zinc-900 px-3 py-2.5 font-medium text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
        >
          {busy ? "Creating…" : "Create room"}
        </button>
      </section>

      <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="font-medium">Join with a code</h2>
        <div className="flex gap-2">
          <input
            className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 font-mono uppercase tracking-widest dark:border-zinc-700"
            placeholder="K7P2QX"
            value={code}
            onChange={(e) => setCode(normalizeCode(e.target.value))}
            onKeyDown={(e) => e.key === "Enter" && join()}
          />
          <button onClick={join} className="rounded-lg bg-indigo-600 px-4 font-medium text-white">
            Join
          </button>
        </div>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </main>
  );
}
