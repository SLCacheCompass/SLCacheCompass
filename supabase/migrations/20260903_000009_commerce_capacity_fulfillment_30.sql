-- USD fulfillment preserves each payment as its own purchase while adding capacity to an
-- existing customer entitlement instead of creating unlimited active licenses.
create or replace function public.cc_fulfill_usd_order(
  p_order_id uuid,
  p_event_id text,
  p_event_type text,
  p_session_id text,
  p_payment_intent text,
  p_environment text,
  p_amount integer,
  p_key_hash text,
  p_key_last4 text
)
returns jsonb
language plpgsql
set search_path=public,pg_temp
as $$
declare
  o public.commerce_orders%rowtype;
  e public.commerce_payment_events%rowtype;
  customer_value uuid;
  purchase_value uuid;
  license_value uuid;
  entitlement_state jsonb;
  capacity_result jsonb;
begin
  if p_event_id is null or p_event_id !~ '^evt_'
     or p_payment_intent is null or p_payment_intent !~ '^pi_'
     or p_session_id is null or p_session_id !~ '^cs_'
     or p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$'
     or p_key_last4 is null or length(p_key_last4)<>4 then
    raise exception 'invalid_fulfillment_input';
  end if;
  if p_event_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded') then
    raise exception 'unsupported_payment_event';
  end if;

  select * into o from public.commerce_orders where id=p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if o.environment is distinct from p_environment
     or o.expected_amount is distinct from p_amount
     or o.stripe_session_id is distinct from p_session_id
     or o.kind<>'self' then raise exception 'payment_order_mismatch'; end if;
  if o.purchaser_email is null or btrim(o.purchaser_email)='' then raise exception 'order_customer_missing'; end if;

  insert into public.commerce_payment_events(provider,environment,event_id,event_type,order_id)
  values('stripe',p_environment,p_event_id,p_event_type,o.id)
  on conflict(provider,environment,event_id) do nothing;

  select * into e from public.commerce_payment_events
  where provider='stripe' and environment=p_environment and event_id=p_event_id for update;
  if e.order_id is distinct from o.id or e.event_type is distinct from p_event_type then
    raise exception 'event_order_conflict';
  end if;

  if o.state='paid' then
    if o.payment_intent_id is distinct from p_payment_intent or o.license_id is null or o.purchase_id is null then
      raise exception 'payment_fulfillment_conflict';
    end if;
    update public.commerce_payment_events
    set status='processed',processed_at=coalesce(processed_at,now()),purchase_id=o.purchase_id,error_code=null
    where provider='stripe' and environment=p_environment and event_id=p_event_id;
    return jsonb_build_object('reused',true,'licenseId',o.license_id,'purchaseId',o.purchase_id,'capacity',public.cc_license_capacity(o.license_id));
  end if;

  if o.state not in ('pending','checkout_created') then raise exception 'order_not_payable'; end if;
  if e.status='processed' then raise exception 'event_fulfillment_conflict'; end if;

  insert into public.customers(email)
  values(lower(btrim(o.purchaser_email)))
  on conflict(lower(email)) where email is not null do update set email=public.customers.email
  returning id into customer_value;

  entitlement_state:=public.cc_find_entitlement_state_v2(customer_value,null,o.purchaser_email);
  if entitlement_state is not null then license_value:=(entitlement_state->>'licenseId')::uuid; end if;

  insert into public.purchases(
    customer_id,channel,external_order_id,processor,processor_transaction_id,amount,currency,
    license_tier,purchase_kind,environment,purchaser_email,status,metadata,license_id
  ) values (
    customer_value,'website_usd',o.id::text,'stripe',p_payment_intent,p_amount/100.0,'USD',
    o.slots,'self',p_environment,o.purchaser_email,'paid',
    jsonb_build_object('commerce_order_id',o.id,'stripe_session_id',p_session_id,'capacity_purchase',license_value is not null),
    license_value
  ) returning id into purchase_value;

  if license_value is null then
    insert into public.licenses(
      customer_id,purchase_id,license_key_hash,license_key_prefix,key_hash,key_last4,tier,
      max_avatar_slots,max_avatars,payment_method,payment_amount,payment_currency,external_transaction_id
    ) values (
      customer_value,purchase_value,p_key_hash,'CC-'||p_key_last4,p_key_hash,p_key_last4,o.slots,
      o.slots,o.slots,'usd',p_amount/100.0,'USD','stripe:'||p_environment||':'||p_payment_intent
    ) returning id into license_value;

    update public.purchases set license_id=license_value where id=purchase_value;
    insert into public.license_events(license_id,event_type,metadata)
    values(license_value,'issued_usd',jsonb_build_object('order_id',o.id,'purchase_id',purchase_value,'environment',p_environment,'slots',o.slots));
    capacity_result:=jsonb_build_object('upgraded',false,'newLicense',true,'capacity',o.slots,'pendingOwnerReview',false);
  else
    capacity_result:=public.cc_apply_capacity_purchase(
      license_value,o.slots,'purchase_upgrade','stripe',p_amount/100.0,0,p_amount/100.0,'USD',
      'stripe:'||p_environment||':'||p_payment_intent,purchase_value::text,null,
      jsonb_build_object('order_id',o.id,'stripe_session_id',p_session_id)
    );
  end if;

  update public.commerce_orders
  set state='paid',license_id=license_value,purchase_id=purchase_value,payment_intent_id=p_payment_intent,
      paid_at=now(),updated_at=now()
  where id=o.id;

  update public.commerce_payment_events
  set status='processed',processed_at=now(),purchase_id=purchase_value,error_code=null
  where provider='stripe' and environment=p_environment and event_id=p_event_id;

  return jsonb_build_object('reused',false,'licenseId',license_value,'purchaseId',purchase_value,
    'capacityResult',capacity_result,'capacity',public.cc_license_capacity(license_value));
end;
$$;
