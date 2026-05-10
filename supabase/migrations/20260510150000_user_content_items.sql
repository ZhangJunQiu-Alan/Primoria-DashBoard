create table if not exists public.user_content_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_key text not null,
  content_type text not null check (
    content_type in (
      'note',
      'lined_note_page',
      'todo',
      'scheduled_task',
      'habit',
      'daily_brief',
      'calendar_event',
      'ai_message',
      'ai_tool_call',
      'pending_action'
    )
  ),
  source_surface text not null default 'dashboard',
  widget_id text,
  widget_type text,
  object_type text,
  object_id text,
  title text not null default '',
  body text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  content_hash text not null,
  sync_batch_id text not null,
  schema_version integer not null default 1,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body, ''))
  ) stored,
  constraint user_content_items_user_content_key_unique unique (user_id, content_key)
);

alter table public.user_content_items enable row level security;

create index if not exists user_content_items_user_type_updated_at_idx
on public.user_content_items (user_id, content_type, updated_at desc);

create index if not exists user_content_items_user_surface_updated_at_idx
on public.user_content_items (user_id, source_surface, updated_at desc);

create index if not exists user_content_items_metadata_idx
on public.user_content_items using gin (metadata);

create index if not exists user_content_items_search_vector_idx
on public.user_content_items using gin (search_vector);

create or replace function public.set_user_content_items_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_content_items_updated_at on public.user_content_items;
create trigger set_user_content_items_updated_at
before update on public.user_content_items
for each row
execute function public.set_user_content_items_updated_at();

drop policy if exists "Users can read their content items" on public.user_content_items;
create policy "Users can read their content items"
on public.user_content_items
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Users can insert their content items" on public.user_content_items;
create policy "Users can insert their content items"
on public.user_content_items
for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "Users can update their content items" on public.user_content_items;
create policy "Users can update their content items"
on public.user_content_items
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Users can delete their content items" on public.user_content_items;
create policy "Users can delete their content items"
on public.user_content_items
for delete
to authenticated
using (user_id = (select auth.uid()));

comment on table public.user_content_items is
  'Derived current-content index for the personal dashboard assistant. Dashboard snapshots remain the restore authority; this table supports future search, memory extraction, and RAG.';

