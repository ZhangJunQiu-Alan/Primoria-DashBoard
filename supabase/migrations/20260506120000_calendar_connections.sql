create table if not exists public.user_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null default 'google',
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  scope text,
  token_type text,
  expires_at timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_calendar_connections_provider_check check (provider = 'google')
);

alter table public.user_calendar_connections enable row level security;

create or replace function public.set_user_calendar_connections_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_calendar_connections_updated_at on public.user_calendar_connections;
create trigger set_user_calendar_connections_updated_at
before update on public.user_calendar_connections
for each row
execute function public.set_user_calendar_connections_updated_at();

comment on table public.user_calendar_connections is
  'Encrypted Google Calendar OAuth tokens for server-side AI and brief generation. RLS intentionally has no client policies; access goes through server functions only.';
