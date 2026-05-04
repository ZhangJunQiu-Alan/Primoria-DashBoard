-- Music library: shared per-user music files in Supabase Storage with metadata in Postgres.
-- Library is global per-user (all music-player widgets see the same tracks).

create table if not exists public.music_tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  artist text,
  album text,
  duration_ms integer,
  size_bytes bigint not null,
  audio_path text not null,
  cover_path text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists music_tracks_user_id_idx on public.music_tracks (user_id, sort_order);

alter table public.music_tracks enable row level security;

drop policy if exists "Users can read their tracks" on public.music_tracks;
create policy "Users can read their tracks"
on public.music_tracks
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can insert their tracks" on public.music_tracks;
create policy "Users can insert their tracks"
on public.music_tracks
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users can update their tracks" on public.music_tracks;
create policy "Users can update their tracks"
on public.music_tracks
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can delete their tracks" on public.music_tracks;
create policy "Users can delete their tracks"
on public.music_tracks
for delete
to authenticated
using (user_id = auth.uid());

-- Storage bucket for audio + cover art. Path convention: {user_id}/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'music',
  'music',
  false,
  31457280,  -- 30 MB
  array[
    'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/aac', 'audio/x-m4a', 'audio/ogg',
    'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/webm',
    'image/jpeg', 'image/png', 'image/webp'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read their music files" on storage.objects;
create policy "Users can read their music files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'music'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can upload their music files" on storage.objects;
create policy "Users can upload their music files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'music'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can update their music files" on storage.objects;
create policy "Users can update their music files"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'music'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'music'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can delete their music files" on storage.objects;
create policy "Users can delete their music files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'music'
  and (storage.foldername(name))[1] = auth.uid()::text
);
