create table if not exists public.dashboard_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  dashboard_state jsonb not null default '{}'::jsonb,
  widget_data jsonb not null default '{}'::jsonb,
  background_path text,
  updated_at timestamptz not null default now()
);

alter table public.dashboard_snapshots enable row level security;

drop policy if exists "Users can read their dashboard snapshot" on public.dashboard_snapshots;
create policy "Users can read their dashboard snapshot"
on public.dashboard_snapshots
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can insert their dashboard snapshot" on public.dashboard_snapshots;
create policy "Users can insert their dashboard snapshot"
on public.dashboard_snapshots
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users can update their dashboard snapshot" on public.dashboard_snapshots;
create policy "Users can update their dashboard snapshot"
on public.dashboard_snapshots
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create or replace function public.set_dashboard_snapshot_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_dashboard_snapshot_updated_at on public.dashboard_snapshots;
create trigger set_dashboard_snapshot_updated_at
before update on public.dashboard_snapshots
for each row
execute function public.set_dashboard_snapshot_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dashboard-assets',
  'dashboard-assets',
  false,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read their dashboard assets" on storage.objects;
create policy "Users can read their dashboard assets"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'dashboard-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can upload their dashboard assets" on storage.objects;
create policy "Users can upload their dashboard assets"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'dashboard-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can update their dashboard assets" on storage.objects;
create policy "Users can update their dashboard assets"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'dashboard-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'dashboard-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can delete their dashboard assets" on storage.objects;
create policy "Users can delete their dashboard assets"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'dashboard-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);
