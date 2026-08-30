create extension if not exists pgcrypto;

create table if not exists public.licenses (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique,
  key_last4 text not null,
  tier text not null check (tier in ('3','5','10')),
  max_avatars integer not null check (max_avatars in (3,5,10)),
  purchaser_avatar_uuid uuid,
  status text not null default 'active' check (status in ('active','revoked','suspended')),
  payment_method text not null check (payment_method in ('usd','linden','manual','test')),
  payment_amount numeric(12,2),
  payment_currency text,
  external_transaction_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tier_matches_slots check (
    (tier = '3' and max_avatars = 3) or
    (tier = '5' and max_avatars = 5) or
    (tier = '10' and max_avatars = 10)
  )
);

create table if not exists public.license_avatars (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  avatar_uuid uuid not null,
  avatar_name text,
  registered_at timestamptz not null default now(),
  last_validated_at timestamptz,
  unique (license_id, avatar_uuid)
);

create table if not exists public.license_events (
  id bigint generated always as identity primary key,
  license_id uuid references public.licenses(id) on delete set null,
  event_type text not null,
  avatar_uuid uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_licenses_key_last4 on public.licenses(key_last4);
create index if not exists idx_licenses_purchaser_avatar on public.licenses(purchaser_avatar_uuid);
create index if not exists idx_license_avatars_license on public.license_avatars(license_id);
create index if not exists idx_license_avatars_avatar on public.license_avatars(avatar_uuid);
create index if not exists idx_license_events_license on public.license_events(license_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists licenses_set_updated_at on public.licenses;
create trigger licenses_set_updated_at
before update on public.licenses
for each row execute function public.set_updated_at();

create or replace function public.enforce_license_avatar_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed_slots integer;
  current_status text;
  used_slots integer;
begin
  select max_avatars, status
    into allowed_slots, current_status
  from public.licenses
  where id = new.license_id
  for update;

  if allowed_slots is null then
    raise exception 'license_not_found';
  end if;

  if current_status <> 'active' then
    raise exception 'license_not_active';
  end if;

  select count(*) into used_slots
  from public.license_avatars
  where license_id = new.license_id;

  if used_slots >= allowed_slots then
    raise exception 'avatar_limit_reached';
  end if;

  return new;
end;
$$;

drop trigger if exists license_avatar_limit on public.license_avatars;
create trigger license_avatar_limit
before insert on public.license_avatars
for each row execute function public.enforce_license_avatar_limit();

alter table public.licenses enable row level security;
alter table public.license_avatars enable row level security;
alter table public.license_events enable row level security;

-- No anon/authenticated policies are intentionally created here.
-- Edge Functions use the service-role key and are the only public interface.

comment on table public.licenses is 'Cache Compass software license entitlements. Plaintext keys are never stored.';
comment on table public.license_avatars is 'Second Life avatar UUID slots registered to each Cache Compass license.';
comment on table public.license_events is 'Audit trail for issuance, validation, registration, suspension, and revocation events.';