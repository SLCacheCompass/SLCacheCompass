-- Paid capacity changes above the normal 25-avatar ceiling must never be silently
-- dropped. Record them idempotently for owner review instead of applying them.

create table if not exists public.license_capacity_override_requests (
  id bigint generated always as identity primary key,
  license_id uuid references public.licenses(id) on delete set null,
  customer_id uuid,
  requested_slots integer not null check (requested_slots > 0),
  current_capacity integer not null,
  requested_capacity integer not null,
  payment_source text,
  gross_amount numeric(14,2),
  fee_amount numeric(14,2),
  net_amount numeric(14,2),
  currency text,
  external_transaction_id text,
  purchase_id text,
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index if not exists license_capacity_override_requests_external_tx_unique
  on public.license_capacity_override_requests(external_transaction_id)
  where external_transaction_id is not null and external_transaction_id <> '';
create index if not exists license_capacity_override_requests_status_created_idx
  on public.license_capacity_override_requests(status, created_at desc);

alter table public.license_capacity_override_requests enable row level security;
revoke all on public.license_capacity_override_requests from anon, authenticated;

create or replace function public.cc_apply_capacity_purchase(
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
  note_value text default null,
  metadata_value jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_capacity integer;
  requested_capacity integer;
  customer_value uuid;
  existing_request public.license_capacity_override_requests%rowtype;
  applied jsonb;
begin
  if target_license_id is null then raise exception 'license_id_required'; end if;
  if slots_to_add is null or slots_to_add <= 0 then raise exception 'positive_slots_required'; end if;

  current_capacity := public.cc_license_capacity(target_license_id);
  if current_capacity <= 0 then raise exception 'license_capacity_missing'; end if;
  requested_capacity := current_capacity + slots_to_add;

  if requested_capacity <= 25 then
    applied := public.cc_upgrade_license_capacity(
      target_license_id,
      slots_to_add,
      change_type,
      payment_source_value,
      gross_amount_value,
      fee_amount_value,
      net_amount_value,
      currency_value,
      external_transaction_value,
      purchase_id_value,
      false,
      note_value,
      metadata_value
    );
    return applied || jsonb_build_object('pendingOwnerOverride', false);
  end if;

  if external_transaction_value is not null and btrim(external_transaction_value) <> '' then
    select * into existing_request
    from public.license_capacity_override_requests
    where external_transaction_id = btrim(external_transaction_value)
    limit 1;
    if found then
      if existing_request.license_id is distinct from target_license_id
         or existing_request.requested_slots is distinct from slots_to_add then
        raise exception 'capacity_transaction_conflict';
      end if;
      return jsonb_build_object(
        'upgraded', false,
        'reused', true,
        'pendingOwnerOverride', existing_request.status = 'pending',
        'overrideRequestId', existing_request.id,
        'licenseId', existing_request.license_id,
        'addedSlots', existing_request.requested_slots,
        'previousCapacity', existing_request.current_capacity,
        'requestedCapacity', existing_request.requested_capacity,
        'status', existing_request.status
      );
    end if;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='licenses' and column_name='customer_id'
  ) then
    execute 'select customer_id from public.licenses where id = $1'
      into customer_value using target_license_id;
  end if;

  insert into public.license_capacity_override_requests(
    license_id, customer_id, requested_slots, current_capacity, requested_capacity,
    payment_source, gross_amount, fee_amount, net_amount, currency,
    external_transaction_id, purchase_id, note, metadata
  ) values (
    target_license_id, customer_value, slots_to_add, current_capacity, requested_capacity,
    nullif(btrim(payment_source_value), ''), gross_amount_value, fee_amount_value,
    coalesce(net_amount_value,
      case when gross_amount_value is not null and fee_amount_value is not null
           then gross_amount_value - fee_amount_value else null end),
    nullif(upper(btrim(currency_value)), ''), nullif(btrim(external_transaction_value), ''),
    nullif(btrim(purchase_id_value), ''), nullif(btrim(note_value), ''),
    coalesce(metadata_value, '{}'::jsonb)
  )
  returning id into existing_request.id;

  return jsonb_build_object(
    'upgraded', false,
    'reused', false,
    'pendingOwnerOverride', true,
    'overrideRequestId', existing_request.id,
    'licenseId', target_license_id,
    'addedSlots', slots_to_add,
    'previousCapacity', current_capacity,
    'requestedCapacity', requested_capacity,
    'status', 'pending'
  );
end;
$$;

create or replace function public.cc_approve_capacity_override(
  override_request_id bigint,
  owner_note text default null,
  metadata_value jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_row public.license_capacity_override_requests%rowtype;
  applied jsonb;
begin
  select * into request_row
  from public.license_capacity_override_requests
  where id = override_request_id
  for update;

  if not found then raise exception 'override_request_not_found'; end if;
  if request_row.status = 'approved' then
    return jsonb_build_object('approved', true, 'reused', true, 'requestId', request_row.id, 'licenseId', request_row.license_id);
  end if;
  if request_row.status <> 'pending' then raise exception 'override_request_not_pending'; end if;

  applied := public.cc_upgrade_license_capacity(
    request_row.license_id,
    request_row.requested_slots,
    'upgrade',
    request_row.payment_source,
    request_row.gross_amount,
    request_row.fee_amount,
    request_row.net_amount,
    request_row.currency,
    request_row.external_transaction_id,
    request_row.purchase_id,
    true,
    coalesce(nullif(btrim(owner_note), ''), request_row.note),
    coalesce(request_row.metadata, '{}'::jsonb) || coalesce(metadata_value, '{}'::jsonb) || jsonb_build_object('override_request_id', request_row.id)
  );

  update public.license_capacity_override_requests
  set status = 'approved', resolved_at = now(), note = coalesce(nullif(btrim(owner_note), ''), note)
  where id = request_row.id;

  return applied || jsonb_build_object('approved', true, 'requestId', request_row.id);
end;
$$;

revoke all on function public.cc_apply_capacity_purchase(uuid, integer, text, text, numeric, numeric, numeric, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.cc_approve_capacity_override(bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.cc_apply_capacity_purchase(uuid, integer, text, text, numeric, numeric, numeric, text, text, text, text, jsonb) to service_role;
grant execute on function public.cc_approve_capacity_override(bigint, text, jsonb) to service_role;

comment on table public.license_capacity_override_requests is
  'Paid or requested capacity changes that would exceed the normal 25-avatar limit and therefore require owner approval.';
comment on function public.cc_apply_capacity_purchase(uuid, integer, text, text, numeric, numeric, numeric, text, text, text, text, jsonb) is
  'Applies paid capacity through 25 avatars; above 25 it records an idempotent pending owner-override request instead of stacking a new active license.';
