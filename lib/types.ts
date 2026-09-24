export type ModelKind = "claude" | "gpt";

export interface Room {
  id: string;
  code: string;
  model: ModelKind;
  host_participant_id: string | null;
  created_at: string;
}

export interface Participant {
  id: string;
  room_id: string;
  display_name: string;
  joined_at: string;
  last_seen: string;
}

export interface Message {
  id: string;
  seq: number;
  room_id: string;
  sender_type: "human" | "ai";
  sender_name: string;
  model: ModelKind | null;
  content: string;
  ai_requested: boolean;
  ai_status: "none" | "pending" | "done";
  reply_to: string | null; // AI replies: id of the human request they answer
  created_at: string;
}

// Events broadcast on the room channel. Same shape for Supabase Realtime and SSE.
export type RoomEvent =
  | { type: "message"; message: Message }
  | { type: "ai_start"; streamId: string; model: ModelKind }
  | { type: "ai_text"; streamId: string; content: string }
  | { type: "ai_done"; streamId: string; message: Message }
  | { type: "ai_queue"; pending: number }
  | { type: "model"; model: ModelKind; by: string }
  | { type: "presence" };

export const MODEL_LABEL: Record<ModelKind, string> = {
  claude: "Claude",
  gpt: "GPT",
};
