create table if not exists public.user_assistant_reflections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reflection_key text not null,
  period_type text not null check (period_type in ('daily', 'weekly')),
  period_start date not null,
  period_end date not null,
  summary text not null default '',
  completion_summary text not null default '',
  priority_items jsonb not null default '[]'::jsonb,
  habit_signals jsonb not null default '[]'::jsonb,
  suggestions jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  source_fingerprint text not null,
  model text,
  schema_version integer not null default 1,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_assistant_reflections_user_key_unique unique (user_id, reflection_key)
);

alter table public.user_assistant_reflections enable row level security;

create index if not exists user_assistant_reflections_user_period_start_idx
on public.user_assistant_reflections (user_id, period_type, period_start desc);

create index if not exists user_assistant_reflections_priority_items_idx
on public.user_assistant_reflections using gin (priority_items);

create index if not exists user_assistant_reflections_evidence_idx
on public.user_assistant_reflections using gin (evidence);

create or replace function public.set_user_assistant_reflections_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_assistant_reflections_updated_at on public.user_assistant_reflections;
create trigger set_user_assistant_reflections_updated_at
before update on public.user_assistant_reflections
for each row
execute function public.set_user_assistant_reflections_updated_at();

drop policy if exists "Users can read their assistant reflections" on public.user_assistant_reflections;
create policy "Users can read their assistant reflections"
on public.user_assistant_reflections
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Users can insert their assistant reflections" on public.user_assistant_reflections;
create policy "Users can insert their assistant reflections"
on public.user_assistant_reflections
for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "Users can update their assistant reflections" on public.user_assistant_reflections;
create policy "Users can update their assistant reflections"
on public.user_assistant_reflections
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Users can delete their assistant reflections" on public.user_assistant_reflections;
create policy "Users can delete their assistant reflections"
on public.user_assistant_reflections
for delete
to authenticated
using (user_id = (select auth.uid()));

comment on table public.user_assistant_reflections is
  'Daily and weekly reflection layer for the personal dashboard assistant. Stores model-assisted summaries, priority scoring, habit signals, suggestions, and evidence references derived from behavior events and current content.';
