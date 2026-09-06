-- Final self-service capacity policy: customers may add 3/5/10 slots to an existing
-- active entitlement up to 30 active avatars. Above 30 requires owner approval.
-- This is additive/non-destructive and preserves all historical licenses, purchases,
-- avatar assignments and capacity events.

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
set search_path=public,pg_temp
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
  if slots_to_add not in (3,5,10) and not owner_override_value then raise exception 'invalid_self_service_capacity_increment'; end if;

  if external_transaction_value is not null and btrim(external_transaction_value) <> '' then
    select * into existing_event
    from public.license_capacity_events
    where external_transaction_id=btrim(external_transaction_value)
    limit 1;
    if found then
      if existing_event.license_id is distinct from target_license_id
         or existing_event.delta_slots is distinct from slots_to_add then
        raise exception 'capacity_transaction_conflict';
      end if;
      return jsonb_build_object(
        'upgraded',true,'reused',true,'licenseId',existing_event.license_id,
        'addedSlots',existing_event.delta_slots,'previousCapacity',existing_event.previous_capacity,
        'capacity',existing_event.resulting_capacity,'ownerOverride',existing_event.owner_override
      );
    end if;
  end if;

  select status,customer_id into current_status,customer_value
  from public.licenses where id=target_license_id for update;
  if current_status is null then raise exception 'license_not_found'; end if;
  if current_status <> 'active' then raise exception 'license_not_active'; end if;

  current_capacity:=public.cc_license_capacity(target_license_id);
  if current_capacity <= 0 then raise exception 'license_capacity_missing'; end if;
  new_capacity:=current_capacity+slots_to_add;
  if new_capacity > 30 and not owner_override_value then raise exception 'owner_override_required_above_30'; end if;

  update public.licenses
  set max_avatar_slots=new_capacity,
      max_avatars=new_capacity,
      capacity_override_approved=case when new_capacity>30 then owner_override_value else false end,
      capacity_override_note=case when new_capacity>30 then nullif(btrim(note_value),'') else null end,
      updated_at=now()
  where id=target_license_id;

  insert into public.license_capacity_events(
    license_id,customer_id,event_type,delta_slots,previous_capacity,resulting_capacity,
    payment_source,gross_amount,fee_amount,net_amount,currency,external_transaction_id,
    purchase_id,owner_override,note,metadata
  ) values (
    target_license_id,customer_value,coalesce(nullif(btrim(change_type),''),'upgrade'),
    slots_to_add,current_capacity,new_capacity,nullif(btrim(payment_source_value),''),
    gross_amount_value,fee_amount_value,
    coalesce(net_amount_value,case when gross_amount_value is not null and fee_amount_value is not null then gross_amount_value-fee_amount_value else null end),
    nullif(upper(btrim(currency_value)),''),nullif(btrim(external_transaction_value),''),
    nullif(btrim(purchase_id_value),''),owner_override_value,nullif(btrim(note_value),''),coalesce(metadata_value,'{}'::jsonb)
  );

  insert into public.license_events(license_id,event_type,metadata)
  values(target_license_id,'capacity_upgraded',jsonb_build_object(
    'change_type',change_type,'added_slots',slots_to_add,'previous_capacity',current_capacity,
    'resulting_capacity',new_capacity,'payment_source',payment_source_value,
    'external_transaction_id',external_transaction_value,'owner_override',owner_override_value
  ));

  return jsonb_build_object(
    'upgraded',true,'reused',false,'licenseId',target_license_id,'addedSlots',slots_to_add,
    'previousCapacity',current_capacity,'capacity',new_capacity,'ownerOverride',owner_override_value
  );
end;
$$;

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
set search_path=public,pg_temp
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
  if slots_to_add not in (3,5,10) then raise exception 'invalid_self_service_capacity_increment'; end if;

  if external_transaction_value is not null and btrim(external_transaction_value) <> '' then
    select * into existing_event from public.license_capacity_events
    where external_transaction_id=btrim(external_transaction_value) limit 1;
    if found then
      if existing_event.license_id is distinct from target_license_id
         or existing_event.delta_slots is distinct from slots_to_add then raise exception 'capacity_transaction_conflict'; end if;
      return jsonb_build_object('upgraded',true,'reused',true,'pendingOwnerOverride',false,
        'pendingOwnerReview',false,'licenseId',existing_event.license_id,
        'addedSlots',existing_event.delta_slots,'previousCapacity',existing_event.previous_capacity,
        'capacity',existing_event.resulting_capacity,'ownerOverride',existing_event.owner_override);
    end if;

    select * into existing_request from public.license_capacity_override_requests
    where external_transaction_id=btrim(external_transaction_value) limit 1;
    if found then
      if existing_request.license_id is distinct from target_license_id
         or existing_request.requested_slots is distinct from slots_to_add then raise exception 'capacity_transaction_conflict'; end if;
      return jsonb_build_object('upgraded',existing_request.status='approved','reused',true,
        'pendingOwnerOverride',existing_request.status='pending' and existing_request.requested_capacity>30,
        'pendingOwnerReview',existing_request.status='pending','overrideRequestId',existing_request.id,
        'licenseId',existing_request.license_id,'addedSlots',existing_request.requested_slots,
        'previousCapacity',existing_request.current_capacity,'requestedCapacity',existing_request.requested_capacity,
        'status',existing_request.status,'holdReason',existing_request.metadata->>'hold_reason');
    end if;
  end if;

  select status,customer_id into current_status,customer_value
  from public.licenses where id=target_license_id for update;
  if current_status is null then raise exception 'license_not_found'; end if;

  current_capacity:=public.cc_license_capacity(target_license_id);
  if current_capacity <= 0 then raise exception 'license_capacity_missing'; end if;
  requested_capacity:=current_capacity+slots_to_add;

  if current_status <> 'active' then hold_reason:='license_not_active';
  elsif requested_capacity > 30 then hold_reason:='owner_override_required_above_30'; end if;

  if hold_reason is not null then
    insert into public.license_capacity_override_requests(
      license_id,customer_id,requested_slots,current_capacity,requested_capacity,payment_source,
      gross_amount,fee_amount,net_amount,currency,external_transaction_id,purchase_id,note,metadata
    ) values (
      target_license_id,customer_value,slots_to_add,current_capacity,requested_capacity,
      nullif(btrim(payment_source_value),''),gross_amount_value,fee_amount_value,
      coalesce(net_amount_value,case when gross_amount_value is not null and fee_amount_value is not null then gross_amount_value-fee_amount_value else null end),
      nullif(upper(btrim(currency_value)),''),nullif(btrim(external_transaction_value),''),
      nullif(btrim(purchase_id_value),''),nullif(btrim(note_value),''),
      coalesce(metadata_value,'{}'::jsonb)||jsonb_build_object('hold_reason',hold_reason,'license_status',current_status)
    ) returning id into existing_request.id;

    return jsonb_build_object('upgraded',false,'reused',false,
      'pendingOwnerOverride',hold_reason='owner_override_required_above_30','pendingOwnerReview',true,
      'overrideRequestId',existing_request.id,'licenseId',target_license_id,'addedSlots',slots_to_add,
      'previousCapacity',current_capacity,'requestedCapacity',requested_capacity,'status','pending',
      'holdReason',hold_reason,'licenseStatus',current_status);
  end if;

  applied:=public.cc_upgrade_license_capacity(
    target_license_id,slots_to_add,change_type,payment_source_value,gross_amount_value,
    fee_amount_value,net_amount_value,currency_value,external_transaction_value,purchase_id_value,
    false,note_value,metadata_value
  );
  return applied||jsonb_build_object('pendingOwnerOverride',false,'pendingOwnerReview',false);
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
set search_path=public,pg_temp
as $$
declare
  request_row public.license_capacity_override_requests%rowtype;
  applied jsonb;
begin
  select * into request_row from public.license_capacity_override_requests
  where id=override_request_id for update;
  if not found then raise exception 'override_request_not_found'; end if;
  if request_row.status='approved' then
    return jsonb_build_object('approved',true,'reused',true,'requestId',request_row.id,'licenseId',request_row.license_id);
  end if;
  if request_row.status <> 'pending' then raise exception 'override_request_not_pending'; end if;

  applied:=public.cc_upgrade_license_capacity(
    request_row.license_id,request_row.requested_slots,'upgrade',request_row.payment_source,
    request_row.gross_amount,request_row.fee_amount,request_row.net_amount,request_row.currency,
    request_row.external_transaction_id,request_row.purchase_id,true,
    coalesce(nullif(btrim(owner_note),''),request_row.note),
    coalesce(request_row.metadata,'{}'::jsonb)||coalesce(metadata_value,'{}'::jsonb)||jsonb_build_object('override_request_id',request_row.id)
  );

  update public.license_capacity_override_requests
  set status='approved',resolved_at=now(),note=coalesce(nullif(btrim(owner_note),''),note)
  where id=request_row.id;

  return applied||jsonb_build_object('approved',true,'requestId',request_row.id);
end;
$$;

revoke all on function public.cc_upgrade_license_capacity(uuid,integer,text,text,numeric,numeric,numeric,text,text,text,boolean,text,jsonb) from public,anon,authenticated;
revoke all on function public.cc_apply_capacity_purchase(uuid,integer,text,text,numeric,numeric,numeric,text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.cc_approve_capacity_override(bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.cc_upgrade_license_capacity(uuid,integer,text,text,numeric,numeric,numeric,text,text,text,boolean,text,jsonb) to service_role;
grant execute on function public.cc_apply_capacity_purchase(uuid,integer,text,text,numeric,numeric,numeric,text,text,text,text,jsonb) to service_role;
grant execute on function public.cc_approve_capacity_override(bigint,text,jsonb) to service_role;
