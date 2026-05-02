-- 0001_init.sql
-- Verbatim from AGENTS.md. Run this in the Supabase SQL editor before
-- anything else. RLS is intentionally disabled for the hackathon.

create extension if not exists "pgcrypto";

create table users (
  id uuid primary key,
  display_name text not null,
  color text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  room_code text not null unique,
  master_context text not null default '',
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on projects (room_code);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  parent_session_id uuid references sessions(id) on delete set null,
  fork_point_message_id uuid,
  label text,
  tags text[] not null default '{}',
  summary text not null default '',
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  message_count int not null default 0,
  is_archived boolean not null default false
);
create index on sessions (project_id, parent_session_id);

create table messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  author_id uuid references users(id),
  content text not null,
  model text,
  prompt_tokens int,
  completion_tokens int,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  is_deleted boolean not null default false
);
create index on messages (session_id, created_at);

alter table sessions
  add constraint sessions_fork_point_fk
  foreign key (fork_point_message_id) references messages(id) on delete set null;

create table session_participants (
  session_id uuid not null references sessions(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  message_count int not null default 0,
  primary key (session_id, user_id)
);
create index on session_participants (user_id);

create table highlights (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  message_id uuid references messages(id) on delete set null,
  content text not null,
  note text,
  source text not null check (source in ('user','ai')),
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index on highlights (session_id, created_at);
