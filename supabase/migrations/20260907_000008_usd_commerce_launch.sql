-- Cache Compass USD launch commerce ledger and fulfillment.
-- Additive only: does not change Linden purchase functions or existing avatar assignment/history.

create table if not exists public.commerce_orders (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  purchaser_email text,
  request_id uuid not null,
  kind text not null check (kind = 'self'),
  slots integer not null check (slots in (3,5,10)),
  expected_amount integer not null check (expected_amount > 0),
  stripe_price_id text not null,
  environment text not null default 'live' check (environment in ('test','live')),
  stripe_session_id text unique,
  payment_intent_id text,
  state text not null default 'pending' check (state in ('pending','checkout_created','paid','failed','canceled')),
  license_id uuid references public.licenses(id) on delete set null,
  purchase_id uuid references public.purchases(id) on delete restrict,
  tax_amount integer not null default 0,
  total_amount integer,
  purchaser_country text,
  purchaser_region text,
  legal_bundle_version text,
  legal_effective_date date,
  legal_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (auth_user_id, request_id)
);

create index if not exists commerce_orders_user_created_idx on public.commerce_orders(auth_user_id, created_at desc);
create index if not exists commerce_orders_purchase_idx on public.commerce_orders(purchase_id);
create index if not exists commerce_orders_license_idx on public.commerce_orders(license_id);

create table if not exists public.commerce_payment_events (
  provider text not null,
  environment text not null check (environment in ('test','live')),
  event_id text not null,
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  purchase_id uuid references public.purchases(id) on delete restrict,
  order_id uuid references public.commerce_orders(id) on delete restrict,
  status text not null default 'received' check (status in ('received','processed','ignored','failed')),
  error_code text,
  primary key (provider, environment, event_id)
);
create index if not exists commerce_payment_events_order_idx on public.commerce_payment_events(order_id);

alter table public.commerce_orders
  add column if not exists purchaser_email text,
  add column if not exists purchase_id uuid references public.purchases(id) on delete restrict,
  add column if not exists tax_amount integer not null default 0,
  add column if not exists total_amount integer,
  add column if not exists purchaser_country text,
  add column if not exists purchaser_region text,
  add column if not exists legal_bundle_version text,
  add column if not exists legal_effective_date date,
  add column if not exists legal_accepted_at timestamptz;

alter table public.commerce_payment_events
  add column if not exists order_id uuid references public.commerce_orders(id) on delete restrict;

alter table public.purchases
  add column if not exists tax_jurisdiction text,
  add column if not exists tax_collection_method text,
  add column if not exists tax_rate numeric,
  add column if not exists customer_country text,
  add column if not exists customer_region text;

alter table public.commerce_orders enable row level security;
alter table public.commerce_payment_events enable row level security;
revoke all on public.commerce_orders, public.commerce_payment_events from public, anon, authenticated;
grant select, insert, update on public.commerce_orders, public.commerce_payment_events to service_role;

alter table public.commerce_orders drop constraint if exists commerce_orders_legal_bundle_version_check;
alter table public.commerce_orders add constraint commerce_orders_legal_bundle_version_check
  check (legal_bundle_version is null or length(legal_bundle_version) between 1 and 64);

create or replace function public.cc_fulfill_usd_order(
  p_order_id uuid,
  p_event_id text,
  p_event_type text,
  p_session_id text,
  p_payment_intent text,
  p_environment text,
  p_subtotal integer,
  p_tax integer,
  p_total integer,
  p_customer_country text,
  p_customer_region text,
  p_key_hash text,
  p_key_last4 text
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  o public.commerce_orders%rowtype;
  e public.commerce_payment_events%rowtype;
  customer_value uuid;
  purchase_value uuid;
  license_value uuid;
  entitlement_state jsonb;
  capacity_result jsonb;
  jurisdiction text;
begin
  if p_event_id is null or p_event_id !~ '^evt_'
     or p_payment_intent is null or p_payment_intent !~ '^pi_'
     or p_session_id is null or p_session_id !~ '^cs_'
     or p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$'
     or p_key_last4 is null or length(p_key_last4) <> 4 then
    raise exception 'invalid_fulfillment_input';
  end if;
  if p_event_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded') then
    raise exception 'unsupported_payment_event';
  end if;
  if p_subtotal is null or p_tax is null or p_total is null or p_subtotal < 0 or p_tax < 0 or p_total <> p_subtotal + p_tax then
    raise exception 'invalid_tax_totals';
  end if;

  select * into o from public.commerce_orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if o.legal_bundle_version is null or o.legal_effective_date is null or o.legal_accepted_at is null then
    raise exception 'legal_acceptance_missing';
  end if;
  if o.environment is distinct from p_environment
     or o.expected_amount is distinct from p_subtotal
     or o.stripe_session_id is distinct from p_session_id
     or o.kind <> 'self' then
    raise exception 'payment_order_mismatch';
  end if;
  if o.purchaser_email is null or btrim(o.purchaser_email) = '' then raise exception 'order_customer_missing'; end if;

  jurisdiction := case
    when upper(coalesce(p_customer_country,'')) = 'US' and btrim(coalesce(p_customer_region,'')) <> ''
      then 'US-' || upper(btrim(p_customer_region))
    when btrim(coalesce(p_customer_country,'')) <> '' then upper(btrim(p_customer_country))
    else null
  end;

  insert into public.commerce_payment_events(provider,environment,event_id,event_type,order_id)
    values('stripe',p_environment,p_event_id,p_event_type,o.id)
    on conflict(provider,environment,event_id) do nothing;
  select * into e from public.commerce_payment_events
    where provider='stripe' and environment=p_environment and event_id=p_event_id for update;
  if e.order_id is distinct from o.id or e.event_type is distinct from p_event_type then raise exception 'event_order_conflict'; end if;

  if o.state = 'paid' then
    if o.payment_intent_id is distinct from p_payment_intent or o.license_id is null or o.purchase_id is null then
      raise exception 'payment_fulfillment_conflict';
    end if;
    update public.commerce_payment_events
      set status='processed', processed_at=coalesce(processed_at,now()), purchase_id=o.purchase_id, error_code=null
      where provider='stripe' and environment=p_environment and event_id=p_event_id;
    return jsonb_build_object('reused',true,'licenseId',o.license_id,'purchaseId',o.purchase_id,'capacity',public.cc_license_capacity(o.license_id));
  end if;
  if o.state not in ('pending','checkout_created') then raise exception 'order_not_payable'; end if;
  if e.status = 'processed' then raise exception 'event_fulfillment_conflict'; end if;

  insert into public.customers(email) values(lower(btrim(o.purchaser_email)))
    on conflict(lower(email)) where email is not null do update set email=public.customers.email
    returning id into customer_value;

  entitlement_state := public.cc_find_entitlement_state_v2(customer_value,null,o.purchaser_email);
  if entitlement_state is not null then license_value := (entitlement_state->>'licenseId')::uuid; end if;

  insert into public.purchases(
    customer_id,channel,external_order_id,processor,processor_transaction_id,
    amount,currency,original_amount,original_currency,original_source,tax_amount,
    tax_jurisdiction,tax_collection_method,customer_country,customer_region,
    license_tier,purchase_kind,environment,purchaser_email,status,metadata,license_id,financials_status
  ) values (
    customer_value,'website_usd',o.id::text,'stripe',p_payment_intent,
    p_total/100.0,'USD',p_subtotal/100.0,'USD','stripe_checkout',p_tax/100.0,
    jurisdiction,'stripe_tax',nullif(upper(btrim(coalesce(p_customer_country,''))),''),
    nullif(upper(btrim(coalesce(p_customer_region,''))),''),o.slots,'self',p_environment,
    o.purchaser_email,'paid',jsonb_build_object(
      'commerce_order_id',o.id,'stripe_session_id',p_session_id,
      'capacity_purchase',license_value is not null,'subtotal_cents',p_subtotal,
      'tax_cents',p_tax,'total_cents',p_total,'legal_bundle_version',o.legal_bundle_version,
      'legal_effective_date',o.legal_effective_date,'legal_accepted_at',o.legal_accepted_at
    ),license_value,'pending'
  ) returning id into purchase_value;

  if license_value is null then
    insert into public.licenses(
      customer_id,purchase_id,license_key_hash,license_key_prefix,key_hash,key_last4,
      tier,max_avatar_slots,max_avatars,payment_method,payment_amount,payment_currency,external_transaction_id
    ) values (
      customer_value,purchase_value,p_key_hash,'CC-'||p_key_last4,p_key_hash,p_key_last4,
      o.slots,o.slots,o.slots,'usd',p_total/100.0,'USD','stripe:'||p_environment||':'||p_payment_intent
    ) returning id into license_value;
    update public.purchases set license_id=license_value where id=purchase_value;
    insert into public.license_events(license_id,event_type,metadata)
      values(license_value,'issued_usd',jsonb_build_object('order_id',o.id,'purchase_id',purchase_value,'environment',p_environment,'slots',o.slots,'tax_cents',p_tax));
    capacity_result := jsonb_build_object('upgraded',false,'newLicense',true,'capacity',o.slots,'pendingOwnerReview',false);
  else
    capacity_result := public.cc_apply_capacity_purchase(
      license_value,o.slots,'purchase_upgrade','stripe',p_subtotal/100.0,0,p_subtotal/100.0,'USD',
      'stripe:'||p_environment||':'||p_payment_intent,purchase_value::text,null,
      jsonb_build_object('order_id',o.id,'stripe_session_id',p_session_id,'tax_cents',p_tax,'total_cents',p_total,
        'legal_bundle_version',o.legal_bundle_version,'legal_effective_date',o.legal_effective_date,'legal_accepted_at',o.legal_accepted_at)
    );
  end if;

  update public.commerce_orders
    set state='paid',license_id=license_value,purchase_id=purchase_value,payment_intent_id=p_payment_intent,
        tax_amount=p_tax,total_amount=p_total,purchaser_country=nullif(upper(btrim(coalesce(p_customer_country,''))),''),
        purchaser_region=nullif(upper(btrim(coalesce(p_customer_region,''))),''),paid_at=now(),updated_at=now()
    where id=o.id;
  update public.commerce_payment_events
    set status='processed',processed_at=now(),purchase_id=purchase_value,error_code=null
    where provider='stripe' and environment=p_environment and event_id=p_event_id;

  return jsonb_build_object('reused',false,'licenseId',license_value,'purchaseId',purchase_value,
    'capacityResult',capacity_result,'capacity',public.cc_license_capacity(license_value),
    'subtotal',p_subtotal,'tax',p_tax,'total',p_total,'taxJurisdiction',jurisdiction);
end;
$$;

revoke all on function public.cc_fulfill_usd_order(uuid,text,text,text,text,text,integer,integer,integer,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.cc_fulfill_usd_order(uuid,text,text,text,text,text,integer,integer,integer,text,text,text,text)
  to service_role;

comment on table public.commerce_orders is 'Idempotent hosted Stripe self-purchase ledger; each payment remains a separate order.';
