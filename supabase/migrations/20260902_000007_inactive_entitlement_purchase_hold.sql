-- A suspended/revoked customer must not bypass account state by purchasing a fresh
-- active license. Preserve the paid transaction as a pending owner-review record instead.
-- The owner can reactivate the entitlement and then approve the held capacity purchase.

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
  current_status text;
  current_capacity integer;
  requested_capacity integer;
  customer_value uuid;
  existing_request public.license_capacity_override_requests%rowtype;
  existing_event public.license_capacity_events%rowtype;
  applied jsonb;
  hold_reason text;
begin
  if target_license_id is null then raise exception 'license_id_required'; end if;
  if slots_to_add is null or slots_to_add <= 0 then raise exception 'positive_slots_required'; end if;

  -- A completed transaction wins first. A retry must never add the same paid slots twice.
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
        'pendingOwnerOverride', false,
        'pendingOwnerReview', false,
        'licenseId', existing_event.license_id,
        'addedSlots', existing_event.delta_slots,
        'previousCapacity', existing_event.previous_capacity,
        'capacity', existing_event.resulting_capacity,
        'ownerOverride', existing_event.owner_override
      );
    end if;

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
        'upgraded', existing_request.status = 'approved',
        'reused', true,
        'pendingOwnerOverride', existing_request.status = 'pending' and existing_request.requested_capacity > 25,
        'pendingOwnerReview', existing_request.status = 'pending',
        'overrideRequestId', existing_request.id,
        'licenseId', existing_request.license_id,
        'addedSlots', existing_request.requested_slots,
        'previousCapacity', existing_request.current_capacity,
        'requestedCapacity', existing_request.requested_capacity,
        'status', existing_request.status,
        'holdReason', existing_request.metadata->>'hold_reason'
      );
    end if;
  end if;

  select status into current_status
  from public.licenses
  where id = target_license_id
  for update;
  if current_status is null then raise exception 'license_not_found'; end if;

  current_capacity := public.cc_license_capacity(target_license_id);
  if current_capacity <= 0 then raise exception 'license_capacity_missing'; end if;
  requested_capacity := current_capacity + slots_to_add;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='licenses' and column_name='customer_id'
  ) then
    execute 'select customer_id from public.licenses where id = $1'
      into customer_value using target_license_id;
  end if;

  if current_status <> 'active' then
    hold_reason := 'license_not_active';
  elsif requested_capacity > 25 then
    hold_reason := 'owner_override_required_above_25';
  end if;

  if hold_reason is not null then
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
      coalesce(metadata_value, '{}'::jsonb) || jsonb_build_object(
        'hold_reason', hold_reason,
        'license_status', current_status
      )
    )
    returning id into existing_request.id;

    return jsonb_build_object(
      'upgraded', false,
      'reused', false,
      'pendingOwnerOverride', hold_reason = 'owner_override_required_above_25',
      'pendingOwnerReview', true,
      'overrideRequestId', existing_request.id,
      'licenseId', target_license_id,
      'addedSlots', slots_to_add,
      'previousCapacity', current_capacity,
      'requestedCapacity', requested_capacity,
      'status', 'pending',
      'holdReason', hold_reason,
      'licenseStatus', current_status
    );
  end if;

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

  return applied || jsonb_build_object(
    'pendingOwnerOverride', false,
    'pendingOwnerReview', false
  );
end;
$$;

revoke all on function public.cc_apply_capacity_purchase(uuid, integer, text, text, numeric, numeric, numeric, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.cc_apply_capacity_purchase(uuid, integer, text, text, numeric, numeric, numeric, text, text, text, text, jsonb) to service_role;

comment on function public.cc_apply_capacity_purchase(uuid, integer, text, text, numeric, numeric, numeric, text, text, text, text, jsonb) is
  'Applies paid capacity to an active entitlement through 25 avatars. Purchases above 25 or purchases against suspended/revoked entitlements are preserved as idempotent pending owner-review records rather than creating a new active license.';
