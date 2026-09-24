import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { Message, ModelKind } from "./types";

export const SYSTEM_PROMPT =
  "You are an AI assistant in a shared group chat. Several people are talking to you. " +
  "Each user message is prefixed with the speaker's name. Address people by name when relevant " +
  "and keep one shared context for the whole group.";

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1";

type Turn = { role: "user" | "assistant"; content: string };

// Humans become "user" turns prefixed with the speaker; consecutive human
// messages are merged so the transcript alternates as the APIs expect.
// AI replies from either model become "assistant" turns, so a model switch
// continues the same conversation.
export function toTurns(history: Message[]): Turn[] {
  const turns: Turn[] = [];
  for (const m of history) {
    const role = m.sender_type === "ai" ? "assistant" : "user";
    const text = m.sender_type === "ai" ? m.content : `[${m.sender_name}]: ${m.content}`;
    if (!text.trim()) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += "\n" + text;
    else turns.push({ role, content: text });
  }
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns;
}

export function modelId(kind: ModelKind): string {
  return kind === "claude" ? CLAUDE_MODEL : OPENAI_MODEL;
}

export async function streamReply(
  kind: ModelKind,
  history: Message[],
  onText: (full: string) => void,
): Promise<string> {
  const turns = toTurns(history);
  let full = "";
  const push = (delta: string) => {
    full += delta;
    onText(full);
  };

  if (kind === "claude") {
    if (!process.env.ANTHROPIC_API_KEY) return mockStream(kind, turns, push);
    const client = new Anthropic();
    const stream = client.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      // Low effort keeps time-to-first-token short for a live chat.
      output_config: { effort: "low" },
      messages: turns,
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        push(event.delta.text);
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal" && !full) push("(Claude declined to answer this one.)");
    return full;
  }

  if (!process.env.OPENAI_API_KEY) return mockStream(kind, turns, push);
  const client = new OpenAI();
  const stream = await client.chat.completions.create({
    model: OPENAI_MODEL,
    stream: true,
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...turns],
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) push(delta);
  }
  return full;
}

// Used when no API key is configured, so the realtime flow can be demoed offline.
async function mockStream(kind: ModelKind, turns: Turn[], push: (d: string) => void) {
  const lastUser = [...turns].reverse().find((t) => t.role === "user")?.content ?? "";
  const speakers = [...new Set([...lastUser.matchAll(/\[([^\]]+)\]:/g)].map((m) => m[1]))];
  const reply =
    `(${kind === "claude" ? "Claude" : "GPT"} mock mode — set ${kind === "claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} for real answers.) ` +
    `Hi ${speakers.join(" and ") || "there"}! I can see ${turns.length} turns of shared history. ` +
    `You last said: "${lastUser.split("\n").pop()?.replace(/^\[[^\]]+\]:\s*/, "").slice(0, 120)}".`;
  for (const word of reply.split(/(\s+)/)) {
    push(word);
    await new Promise((r) => setTimeout(r, 30));
  }
  return reply;
}
