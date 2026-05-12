alter table public.dashboard_snapshots
add column if not exists sync_revision bigint not null default 1;

alter table public.dashboard_snapshots
add column if not exists background_signature text;

create or replace function public.set_dashboard_snapshot_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  if tg_op = 'UPDATE' then
    new.sync_revision = coalesce(old.sync_revision, 0) + 1;
  elsif new.sync_revision is null then
    new.sync_revision = 1;
  end if;
  return new;
end;
$$;
