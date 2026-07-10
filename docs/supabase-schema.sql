create extension if not exists pgcrypto;

create table if not exists public.cocreate_profiles (
  client_id text primary key,
  memory_summary text,
  memory_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cocreate_snapshots (
  client_id text not null,
  app_id text not null,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (client_id, app_id)
);

create index if not exists cocreate_snapshots_updated_at_idx on public.cocreate_snapshots (updated_at desc);
create index if not exists cocreate_profiles_updated_at_idx on public.cocreate_profiles (updated_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cocreate_profiles_touch_updated_at on public.cocreate_profiles;
create trigger cocreate_profiles_touch_updated_at
before update on public.cocreate_profiles
for each row
execute function public.touch_updated_at();

drop trigger if exists cocreate_snapshots_touch_updated_at on public.cocreate_snapshots;
create trigger cocreate_snapshots_touch_updated_at
before update on public.cocreate_snapshots
for each row
execute function public.touch_updated_at();
