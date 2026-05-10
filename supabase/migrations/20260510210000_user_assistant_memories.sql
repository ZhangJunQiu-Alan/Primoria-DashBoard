create table if not exists public.user_assistant_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  memory_type text not null check (
    memory_type in ('user_preference', 'work_habit', 'project_fact', 'process_rule')
  ),
  scope text not null default 'global',
  title text not null default '',
  body text not null default '',
  confidence numeric(4, 3) not null default 0.500 check (confidence >= 0 and confidence <= 1),
  evidence jsonb not null default '[]'::jsonb,
  source_reflection_keys text[] not null default '{}'::text[],
  schema_version integer not null default 1,
  last_seen_at timestamptz not null default now(),
  user_modified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body, '') || ' ' || coalesce(scope, ''))
  ) stored
);

alter table public.user_assistant_memories enable row level security;

alter table public.user_assistant_reflections
add column if not exists memory_extracted_at timestamptz,
add column if not exists memory_source_fingerprint text,
add column if not exists memory_update_count integer not null default 0;

create index if not exists user_assistant_memories_user_type_seen_idx
on public.user_assistant_memories (user_id, memory_type, last_seen_at desc);

create index if not exists user_assistant_memories_user_updated_at_idx
on public.user_assistant_memories (user_id, updated_at desc);

create index if not exists user_assistant_memories_source_keys_idx
on public.user_assistant_memories using gin (source_reflection_keys);

create index if not exists user_assistant_memories_evidence_idx
on public.user_assistant_memories using gin (evidence);

create index if not exists user_assistant_memories_search_vector_idx
on public.user_assistant_memories using gin (search_vector);

create index if not exists user_assistant_reflections_memory_status_idx
on public.user_assistant_reflections (user_id, memory_extracted_at desc, updated_at desc);

create or replace function public.set_user_assistant_memories_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_assistant_memories_updated_at on public.user_assistant_memories;
create trigger set_user_assistant_memories_updated_at
before update on public.user_assistant_memories
for each row
execute function public.set_user_assistant_memories_updated_at();

drop policy if exists "Users can read their assistant memories" on public.user_assistant_memories;
create policy "Users can read their assistant memories"
on public.user_assistant_memories
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Users can insert their assistant memories" on public.user_assistant_memories;
create policy "Users can insert their assistant memories"
on public.user_assistant_memories
for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "Users can update their assistant memories" on public.user_assistant_memories;
create policy "Users can update their assistant memories"
on public.user_assistant_memories
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Users can delete their assistant memories" on public.user_assistant_memories;
create policy "Users can delete their assistant memories"
on public.user_assistant_memories
for delete
to authenticated
using (user_id = (select auth.uid()));

comment on table public.user_assistant_memories is
  'Long-term structured memory layer for the personal dashboard assistant. Stores stable preferences, work habits, project facts, and process rules derived from assistant reflections.';
