create table if not exists public.user_behavior_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_event_id text not null,
  occurred_at timestamptz not null,
  event_name text not null,
  actor text not null check (actor in ('user', 'assistant', 'system')),
  surface text not null default 'dashboard',
  widget_id text,
  widget_type text,
  object_type text,
  object_id text,
  summary text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  constraint user_behavior_events_client_event_unique unique (user_id, client_event_id)
);

alter table public.user_behavior_events enable row level security;

create index if not exists user_behavior_events_user_occurred_at_idx
on public.user_behavior_events (user_id, occurred_at desc);

create index if not exists user_behavior_events_user_event_occurred_at_idx
on public.user_behavior_events (user_id, event_name, occurred_at desc);

create index if not exists user_behavior_events_metadata_idx
on public.user_behavior_events using gin (metadata);

drop policy if exists "Users can read their behavior events" on public.user_behavior_events;
create policy "Users can read their behavior events"
on public.user_behavior_events
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Users can insert their behavior events" on public.user_behavior_events;
create policy "Users can insert their behavior events"
on public.user_behavior_events
for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "Users can delete their behavior events" on public.user_behavior_events;
create policy "Users can delete their behavior events"
on public.user_behavior_events
for delete
to authenticated
using (user_id = (select auth.uid()));

comment on table public.user_behavior_events is
  'Privacy-preserving behavioral event stream for the personal dashboard agent. Raw note bodies, music URLs, iframe embeds, and image data URLs should not be stored here.';
