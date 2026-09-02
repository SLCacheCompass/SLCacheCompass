-- Additive capacity model for Cache Compass entitlements.
-- Existing licenses, purchases, receipts, avatar history and test records are not deleted
-- or rewritten. Current capacity fields remain the source used by existing clients; this
-- migration only relaxes the old tier=capacity constraint so an existing entitlement can
-- grow beyond its original 3/5/10 purchase tier.

create table if not exists public.license_capacity_events (
  id bigint generated always as identity primary key,
  license_id uuid references public.licenses(id) on delete set null,
  customer_id uuid,
  event_type text not null default 'upgrade',
  delta_slots integer not null,
  previous_capacity integer not null,
  resulting_capacity integer not null,
  payment_source text,
  gross_amount numeric(14,2),
  fee_amount numeric(14,2),
  net_amount numeric(14,2),
  currency text,
  external_transaction_id text,
  purchase_id text,
  owner_override boolean not null default false,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint license_capacity_events_positive_result check (resulting_capacity > 0)
);

create unique index if not exists license_capacity_events_external_tx_unique
  on public.license_capacity_events(external_transaction_id)
  where external_transaction_id is not null and external_transaction_id <> '';

create index if not exists license_capacity_events_license_created_idx
  on public.license_capacity_events(license_id, created_at desc);
create index if not exists license_capacity_events_customer_created_idx
  on public.license_capacity_events(customer_id, created_at desc);

alter table public.license_capacity_events enable row level security;
revoke all on public.license_capacity_events from anon, authenticated;

-- The original schema tied max_avatars directly to the purchase tier. Upgrades need the
-- purchase tier to remain historical while current capacity grows independently.
do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.licenses'::regclass
      and contype = 'c'
      and (
        pg_get_constraintdef(oid) ilike '%max_avatars%'
        or pg_get_constraintdef(oid) ilike '%max_avatar_slots%'
      )
  loop
    execute format('alter table public.licenses drop constraint if exists %I', r.conname);
  end loop;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='licenses' and column_name='max_avatars'
  ) then
    execute 'alter table public.licenses add constraint licenses_max_avatars_positive check (max_avatars is null or max_avatars > 0) not valid';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='licenses' and column_name='max_avatar_slots'
  ) then
    execute 'alter table public.licenses add constraint licenses_max_avatar_slots_positive check (max_avatar_slots is null or max_avatar_slots > 0) not valid';
  end if;
end $$;

alter table public.licenses
  add column if not exists capacity_override_approved boolean not null default false,
  add column if not exists capacity_override_note text;

create or replace function public.cc_license_capacity(target_license_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  capacity integer;
begin
  if target_license_id is null then return 0; end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='licenses' and column_name='max_avatar_slots'
  ) then
    execute 'select max_avatar_slots from public.licenses where id = $1'
      into capacity using target_license_id;
  end if;

  if capacity is null and exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='licenses' and column_name='max_avatars'
  ) then
    execute 'select max_avatars from public.licenses where id = $1'
      into capacity using target_license_id;
  end if;

  return coalesce(capacity, 0);
end;
$$;

create or replace function public.cc_find_active_entitlement(
  target_customer_id uuid default null,
  target_avatar_uuid uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  found_id uuid;
  has_customer_id boolean;
begin
  has_customer_id := exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='licenses' and column_name='customer_id'
  );

  if target_customer_id is not null and has_customer_id then
    execute $q$
      select id from public.licenses
      where customer_id = $1 and status = 'active'
      order by greatest(
        coalesce(case when to_jsonb(licenses) ? 'max_avatar_slots' then (to_jsonb(licenses)->>'max_avatar_slots')::int else null end, 0),
        coalesce(case when to_jsonb(licenses) ? 'max_avatars' then (to_jsonb(licenses)->>'max_avatars')::int else null end, 0)
      ) desc, created_at asc
      limit 1
    $q$ into found_id using target_customer_id;
    if found_id is not null then return found_id; end if;
  end if;

  if target_avatar_uuid is not null and exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='licenses' and column_name='purchaser_avatar_uuid'
  ) then
    execute $q$
      select id from public.licenses
      where purchaser_avatar_uuid = $1 and status = 'active'
      order by greatest(
        coalesce(case when to_jsonb(licenses) ? 'max_avatar_slots' then (to_jsonb(licenses)->>'max_avatar_slots')::int else null end, 0),
        coalesce(case when to_jsonb(licenses) ? 'max_avatars' then (to_jsonb(licenses)->>'max_avatars')::int else null end, 0)
      ) desc, created_at asc
      limit 1
    $q$ into found_id using target_avatar_uuid;
  end if;

  return found_id;
end;
$$;

create or replace function public.cc_upgrade_license_capacity(
  target_license_id uuid,
  slots_to_add integer,
  change_type text default 'upgrade',
  payment_source_value text default null,
  gross_amount_value numeric default null,
  fee_amount_value numeric default null,
  net_amount_value numeric default null,
  currency_value text default null,
  external_transaction_value text default null,
  purchase_id_value text default null,
  owner_override_value boolean default false,
  note_value text default null,
  metadata_value jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_status text;
  current_capacity integer;
  new_capacity integer;
  customer_value uuid;
  existing_event public.license_capacity_events%rowtype;
begin
  if target_license_id is null then raise exception 'license_id_required'; end if;
  if slots_to_add is null or slots_to_add <= 0 then raise exception 'positive_slots_required'; end if;

  -- Idempotency: a retry of the same paid transaction returns the prior result rather
  -- than adding the capacity twice.
  if external_transaction_value is not null and btrim(external_transaction_value) <> '' then
    select * into existing_event
    from public.license_capacity_events
    where external_transaction_id = btrim(external_transaction_value)
    limit 1;
    if found then
      if existing_event.license_id is distinct from target_license_id
         or existing_event.delta_slots is distinct from slots_to_add then
        raise exception 'capacity_transaction_conflict';
      end if;
      return jsonb_build_object(
        'upgraded', true,
        'reused', true,
        'licenseId', existing_event.license_id,
        'addedSlots', existing_event.delta_slots,
        'previousCapacity', existing_event.previous_capacity,
        'capacity', existing_event.resulting_capacity,
        'ownerOverride', existing_event.owner_override
      );
    end if;
  end if;

  select status into current_status from public.licenses
  where id = target_license_id
  for update;

  if current_status is null then raise exception 'license_not_found'; end if;
  if current_status <> 'active' then raise exception 'license_not_active'; end if;

  current_capacity := public.cc_license_capacity(target_license_id);
  if current_capacity <= 0 then raise exception 'license_capacity_missing'; end if;
  new_capacity := current_capacity + slots_to_add;

  if new_capacity > 25 and not owner_override_value then
    raise exception 'owner_override_required_above_25';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='licenses' and column_name='max_avatar_slots'
  ) then
    execute 'update public.licenses set max_avatar_slots = $2 where id = $1'
      using target_license_id, new_capacity;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='licenses' and column_name='max_avatars'
  ) then
    execute 'update public.licenses set max_avatars = $2 where id = $1'
      using target_license_id, new_capacity;
  end if;

  update public.licenses
  set capacity_override_approved = case when new_capacity > 25 then owner_override_value else capacity_override_approved end,
      capacity_override_note = case when new_capacity > 25 then nullif(btrim(note_value), '') else capacity_override_note end
  where id = target_license_id;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='licenses' and column_name='customer_id'
  ) then
    execute 'select customer_id from public.licenses where id = $1'
      into customer_value using target_license_id;
  end if;

  insert into public.license_capacity_events(
    license_id, customer_id, event_type, delta_slots, previous_capacity,
    resulting_capacity, payment_source, gross_amount, fee_amount, net_amount,
    currency, external_transaction_id, purchase_id, owner_override, note, metadata
  ) values (
    target_license_id, customer_value, coalesce(nullif(btrim(change_type), ''), 'upgrade'),
    slots_to_add, current_capacity, new_capacity,
    nullif(btrim(payment_source_value), ''), gross_amount_value, fee_amount_value,
    coalesce(net_amount_value,
      case when gross_amount_value is not null and fee_amount_value is not null
           then gross_amount_value - fee_amount_value else null end),
    nullif(upper(btrim(currency_value)), ''), nullif(btrim(external_transaction_value), ''),
    nullif(btrim(purchase_id_value), ''), owner_override_value, nullif(btrim(note_value), ''),
    coalesce(metadata_value, '{}'::jsonb)
  );

  if to_regclass('public.license_events') is not null then
    begin
      insert into public.license_events(license_id, event_type, metadata)
      values (
        target_license_id,
        'capacity_upgraded',
        jsonb_build_object(
          'change_type', change_type,
          'added_slots', slots_to_add,
          'previous_capacity', current_capacity,
          'resulting_capacity', new_capacity,
          'payment_source', payment_source_value,
          'external_transaction_id', external_transaction_value,
          'owner_override', owner_override_value
        )
      );
    exception when undefined_column then
      null;
    end;
  end if;

  return jsonb_build_object(
    'upgraded', true,
    'reused', false,
    'licenseId', target_license_id,
    'addedSlots', slots_to_add,
    'previousCapacity', current_capacity,
    'capacity', new_capacity,
    'ownerOverride', owner_override_value
  );
end;
$$;

-- Make the original license_avatars trigger honor upgraded current capacity while
-- preserving its active-license safety check.
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
  select status into current_status
  from public.licenses
  where id = new.license_id
  for update;

  allowed_slots := public.cc_license_capacity(new.license_id);

  if allowed_slots <= 0 then raise exception 'license_not_found'; end if;
  if current_status <> 'active' then raise exception 'license_not_active'; end if;

  select count(*) into used_slots
  from public.license_avatars
  where license_id = new.license_id;

  if used_slots >= allowed_slots then raise exception 'avatar_limit_reached'; end if;
  return new;
end;
$$;

revoke all on function public.cc_license_capacity(uuid) from public, anon, authenticated;
revoke all on function public.cc_find_active_entitlement(uuid, uuid) from public, anon, authenticated;
revoke all on function public.cc_upgrade_license_capacity(uuid, integer, text, text, numeric, numeric, numeric, text, text, text, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.cc_license_capacity(uuid) to service_role;
grant execute on function public.cc_find_active_entitlement(uuid, uuid) to service_role;
grant execute on function public.cc_upgrade_license_capacity(uuid, integer, text, text, numeric, numeric, numeric, text, text, text, boolean, text, jsonb) to service_role;

comment on table public.license_capacity_events is
  'Additive audit/payment trail for capacity upgrades, gifts, comps and owner overrides. Existing purchase records remain untouched.';
comment on function public.cc_upgrade_license_capacity(uuid, integer, text, text, numeric, numeric, numeric, text, text, text, boolean, text, jsonb) is
  'Adds slots to an existing active entitlement. Normal capacity stops at 25; >25 requires an explicit owner override. Idempotent when an external transaction id is supplied.';
