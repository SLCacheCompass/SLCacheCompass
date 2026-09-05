create table if not exists public.avatar_name_cache (
  avatar_uuid uuid primary key,
  legacy_name text,
  display_name text,
  resolved_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.avatar_name_requests (
  avatar_uuid uuid primary key,
  status text not null default 'pending' check (status in ('pending','claimed','complete')),
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  attempts integer not null default 0
);

create index if not exists avatar_name_requests_status_requested_idx
  on public.avatar_name_requests(status, requested_at);

alter table public.avatar_name_cache enable row level security;
alter table public.avatar_name_requests enable row level security;

revoke all on public.avatar_name_cache from anon, authenticated;
revoke all on public.avatar_name_requests from anon, authenticated;
