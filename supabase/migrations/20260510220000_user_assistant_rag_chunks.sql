create extension if not exists vector with schema extensions;

create table if not exists public.user_assistant_rag_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (
    source_type in ('content_item', 'assistant_reflection', 'assistant_memory')
  ),
  source_id uuid,
  source_key text not null,
  chunk_index integer not null default 0,
  title text not null default '',
  body text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  content_hash text not null,
  embedding_model text not null default 'gemini-embedding-001',
  embedding_dimensions integer not null default 768,
  embedding extensions.vector(768) not null,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body, ''))
  ) stored,
  constraint user_assistant_rag_chunks_source_unique unique (
    user_id,
    source_type,
    source_key,
    chunk_index
  )
);

alter table public.user_assistant_rag_chunks enable row level security;

create index if not exists user_assistant_rag_chunks_user_source_idx
on public.user_assistant_rag_chunks (user_id, source_type, source_key);

create index if not exists user_assistant_rag_chunks_user_updated_idx
on public.user_assistant_rag_chunks (user_id, updated_at desc);

create index if not exists user_assistant_rag_chunks_metadata_idx
on public.user_assistant_rag_chunks using gin (metadata);

create index if not exists user_assistant_rag_chunks_search_vector_idx
on public.user_assistant_rag_chunks using gin (search_vector);

create index if not exists user_assistant_rag_chunks_embedding_idx
on public.user_assistant_rag_chunks using hnsw (embedding vector_cosine_ops);

create or replace function public.set_user_assistant_rag_chunks_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_assistant_rag_chunks_updated_at on public.user_assistant_rag_chunks;
create trigger set_user_assistant_rag_chunks_updated_at
before update on public.user_assistant_rag_chunks
for each row
execute function public.set_user_assistant_rag_chunks_updated_at();

create or replace function public.match_assistant_rag_chunks(
  target_user_id uuid,
  query_embedding extensions.vector(768),
  match_count integer default 8,
  match_threshold double precision default 0.62,
  source_types text[] default null
)
returns table (
  id uuid,
  source_type text,
  source_key text,
  title text,
  body text,
  metadata jsonb,
  similarity double precision
)
language sql
stable
as $$
  select
    chunks.id,
    chunks.source_type,
    chunks.source_key,
    chunks.title,
    chunks.body,
    chunks.metadata,
    1 - (chunks.embedding <=> query_embedding) as similarity
  from public.user_assistant_rag_chunks chunks
  where chunks.user_id = target_user_id
    and ((select auth.role()) = 'service_role' or chunks.user_id = (select auth.uid()))
    and chunks.embedding_model = 'gemini-embedding-001'
    and chunks.embedding_dimensions = 768
    and (source_types is null or chunks.source_type = any(source_types))
    and 1 - (chunks.embedding <=> query_embedding) >= match_threshold
  order by chunks.embedding <=> query_embedding
  limit match_count;
$$;

drop policy if exists "Users can read their assistant rag chunks" on public.user_assistant_rag_chunks;
create policy "Users can read their assistant rag chunks"
on public.user_assistant_rag_chunks
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Users can insert their assistant rag chunks" on public.user_assistant_rag_chunks;
create policy "Users can insert their assistant rag chunks"
on public.user_assistant_rag_chunks
for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "Users can update their assistant rag chunks" on public.user_assistant_rag_chunks;
create policy "Users can update their assistant rag chunks"
on public.user_assistant_rag_chunks
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Users can delete their assistant rag chunks" on public.user_assistant_rag_chunks;
create policy "Users can delete their assistant rag chunks"
on public.user_assistant_rag_chunks
for delete
to authenticated
using (user_id = (select auth.uid()));

comment on table public.user_assistant_rag_chunks is
  'Unified pgvector index for dashboard content, assistant reflections, and long-term assistant memories. Used by the personal dashboard RAG retrieval layer.';
