-- Shared AI Room schema. Run once in the Supabase SQL Editor.
-- All access goes through the server (service role); browsers only use
-- Realtime broadcast on public channels, never these tables.

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (char_length(code) = 6),
  model text not null default 'claude' check (model in ('claude', 'gpt')),
  host_participant_id uuid,
  ai_lock_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  display_name text not null,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index if not exists participants_room_idx on participants(room_id, last_seen);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  room_id uuid not null references rooms(id) on delete cascade,
  sender_type text not null check (sender_type in ('human', 'ai')),
  sender_name text not null,
  model text check (model in ('claude', 'gpt')),
  content text not null,
  ai_requested boolean not null default false,
  ai_status text not null default 'none' check (ai_status in ('none', 'pending', 'done')),
  reply_to uuid references messages(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists messages_room_seq_idx on messages(room_id, seq);
create index if not exists messages_pending_idx on messages(room_id, seq) where ai_status = 'pending';

-- Lock the tables down: service role only.
alter table rooms enable row level security;
alter table participants enable row level security;
alter table messages enable row level security;
revoke all on rooms, participants, messages from anon, authenticated;
