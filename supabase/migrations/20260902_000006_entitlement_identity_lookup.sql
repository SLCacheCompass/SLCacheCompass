-- Resolve one customer's existing entitlement without rewriting any historical records.
-- This is intentionally additive. It understands the expanded customer model when present,
-- purchaser UUIDs, registered avatar assignments, the legacy license_avatars table, and email.

create or replace function public.cc_find_entitlement_state_v2(
  target_customer_id uuid default null,
  target_avatar_uuid uuid default null,
  target_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  found jsonb;
  normalized_email text := nullif(lower(btrim(target_email)), '');
begin
  -- 1. Stable customer id is the strongest identity when the expanded schema has it.
  if target_customer_id is not null and exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='licenses' and column_name='customer_id'
  ) then
    execute $q$
      select jsonb_build_object(
        'licenseId', l.id,
        'status', l.status,
        'capacity', coalesce(
          nullif(to_jsonb(l)->>'max_avatar_slots','')::int,
          nullif(to_jsonb(l)->>'max_avatars','')::int,
          nullif(to_jsonb(l)->>'tier','')::int,
          0
        ),
        'customerId', to_jsonb(l)->>'customer_id',
        'matchedBy', 'customer_id'
      )
      from public.licenses l
      where l.customer_id = $1
      order by
        case l.status when 'active' then 0 when 'suspended' then 1 when 'revoked' then 2 else 3 end,
        coalesce(
          nullif(to_jsonb(l)->>'max_avatar_slots','')::int,
          nullif(to_jsonb(l)->>'max_avatars','')::int,
          nullif(to_jsonb(l)->>'tier','')::int,
          0
        ) desc,
        l.created_at asc
      limit 1
    $q$ into found using target_customer_id;
    if found is not null then return found; end if;
  end if;

  -- 2. Email can recover USD customers before they have registered an SL avatar.
  if normalized_email is not null
     and to_regclass('public.customers') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='customers' and column_name='id')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='customers' and column_name='email')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='licenses' and column_name='customer_id') then
    execute $q$
      select jsonb_build_object(
        'licenseId', l.id,
        'status', l.status,
        'capacity', coalesce(
          nullif(to_jsonb(l)->>'max_avatar_slots','')::int,
          nullif(to_jsonb(l)->>'max_avatars','')::int,
          nullif(to_jsonb(l)->>'tier','')::int,
          0
        ),
        'customerId', to_jsonb(l)->>'customer_id',
        'matchedBy', 'email'
      )
      from public.customers c
      join public.licenses l on l.customer_id = c.id
      where lower(c.email) = $1
      order by
        case l.status when 'active' then 0 when 'suspended' then 1 when 'revoked' then 2 else 3 end,
        coalesce(
          nullif(to_jsonb(l)->>'max_avatar_slots','')::int,
          nullif(to_jsonb(l)->>'max_avatars','')::int,
          nullif(to_jsonb(l)->>'tier','')::int,
          0
        ) desc,
        l.created_at asc
      limit 1
    $q$ into found using normalized_email;
    if found is not null then return found; end if;
  end if;

  if target_avatar_uuid is not null then
    -- 3. Original purchaser / primary avatar UUID.
    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='licenses' and column_name='purchaser_avatar_uuid'
    ) then
      execute $q$
        select jsonb_build_object(
          'licenseId', l.id,
          'status', l.status,
          'capacity', coalesce(
            nullif(to_jsonb(l)->>'max_avatar_slots','')::int,
            nullif(to_jsonb(l)->>'max_avatars','')::int,
            nullif(to_jsonb(l)->>'tier','')::int,
            0
          ),
          'customerId', case when to_jsonb(l) ? 'customer_id' then to_jsonb(l)->>'customer_id' else null end,
          'matchedBy', 'purchaser_avatar_uuid'
        )
        from public.licenses l
        where l.purchaser_avatar_uuid = $1
        order by
          case l.status when 'active' then 0 when 'suspended' then 1 when 'revoked' then 2 else 3 end,
          coalesce(
            nullif(to_jsonb(l)->>'max_avatar_slots','')::int,
            nullif(to_jsonb(l)->>'max_avatars','')::int,
            nullif(to_jsonb(l)->>'tier','')::int,
            0
          ) desc,
          l.created_at asc
        limit 1
      $q$ into found using target_avatar_uuid;
      if found is not null then return found; end if;
    end if;

    -- 4. Current expanded avatar assignment table. This is what lets a registered alt
    -- purchase more capacity without accidentally becoming a second customer/license.
    if to_regclass('public.license_avatar_assignments') is not null
       and exists (select 1 from information_schema.columns where table_schema='public' and table_name='license_avatar_assignments' and column_name='license_id')
       and exists (select 1 from information_schema.columns where table_schema='public' and table_name='license_avatar_assignments' and column_name='avatar_uuid') then
      execute $q$
        select jsonb_build_object(
          'licenseId', l.id,
          'status', l.status,
          'capacity', coalesce(
            nullif(to_jsonb(l)->>'max_avatar_slots','')::int,
            nullif(to_jsonb(l)->>'max_avatars','')::int,
            nullif(to_jsonb(l)->>'tier','')::int,
            0
          ),
          'customerId', case when to_jsonb(l) ? 'customer_id' then to_jsonb(l)->>'customer_id' else null end,
          'matchedBy', 'avatar_assignment'
        )
        from public.license_avatar_assignments a
        join public.licenses l on l.id = a.license_id
        where a.avatar_uuid = $1
          and coalesce(to_jsonb(a)->>'status','active') = 'active'
          and nullif(to_jsonb(a)->>'removed_at','') is null
        order by
          case l.status when 'active' then 0 when 'suspended' then 1 when 'revoked' then 2 else 3 end,
          coalesce(
            nullif(to_jsonb(l)->>'max_avatar_slots','')::int,
            nullif(to_jsonb(l)->>'max_avatars','')::int,
            nullif(to_jsonb(l)->>'tier','')::int,
            0
          ) desc,
          l.created_at asc
        limit 1
      $q$ into found using target_avatar_uuid;
      if found is not null then return found; end if;
    end if;

    -- 5. Legacy avatar table, retained for compatibility with the original backend.
    if to_regclass('public.license_avatars') is not null
       and exists (select 1 from information_schema.columns where table_schema='public' and table_name='license_avatars' and column_name='license_id')
       and exists (select 1 from information_schema.columns where table_schema='public' and table_name='license_avatars' and column_name='avatar_uuid') then
      execute $q$
        select jsonb_build_object(
          'licenseId', l.id,
          'status', l.status,
          'capacity', coalesce(
            nullif(to_jsonb(l)->>'max_avatar_slots','')::int,
            nullif(to_jsonb(l)->>'max_avatars','')::int,
            nullif(to_jsonb(l)->>'tier','')::int,
            0
          ),
          'customerId', case when to_jsonb(l) ? 'customer_id' then to_jsonb(l)->>'customer_id' else null end,
          'matchedBy', 'legacy_avatar_assignment'
        )
        from public.license_avatars a
        join public.licenses l on l.id = a.license_id
        where a.avatar_uuid = $1
        order by
          case l.status when 'active' then 0 when 'suspended' then 1 when 'revoked' then 2 else 3 end,
          coalesce(
            nullif(to_jsonb(l)->>'max_avatar_slots','')::int,
            nullif(to_jsonb(l)->>'max_avatars','')::int,
            nullif(to_jsonb(l)->>'tier','')::int,
            0
          ) desc,
          l.created_at asc
        limit 1
      $q$ into found using target_avatar_uuid;
      if found is not null then return found; end if;
    end if;
  end if;

  return null;
end;
$$;

create or replace function public.cc_find_active_entitlement_v2(
  target_customer_id uuid default null,
  target_avatar_uuid uuid default null,
  target_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  state jsonb;
begin
  state := public.cc_find_entitlement_state_v2(target_customer_id, target_avatar_uuid, target_email);
  if state is null or state->>'status' <> 'active' then return null; end if;
  return (state->>'licenseId')::uuid;
end;
$$;

-- Preserve every existing two-argument caller while giving it the stronger alt-aware lookup.
create or replace function public.cc_find_active_entitlement(
  target_customer_id uuid default null,
  target_avatar_uuid uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.cc_find_active_entitlement_v2(target_customer_id, target_avatar_uuid, null);
end;
$$;

revoke all on function public.cc_find_entitlement_state_v2(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.cc_find_active_entitlement_v2(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.cc_find_active_entitlement(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cc_find_entitlement_state_v2(uuid, uuid, text) to service_role;
grant execute on function public.cc_find_active_entitlement_v2(uuid, uuid, text) to service_role;
grant execute on function public.cc_find_active_entitlement(uuid, uuid) to service_role;

comment on function public.cc_find_entitlement_state_v2(uuid, uuid, text) is
  'Finds the best existing Cache Compass entitlement by customer id, email, purchaser UUID, current avatar assignment, or legacy avatar assignment. Returns active/suspended/revoked state so purchase paths cannot bypass a suspension by creating a fresh active license.';
comment on function public.cc_find_active_entitlement_v2(uuid, uuid, text) is
  'Alt-aware/email-aware active entitlement lookup used to prevent duplicate active licenses for the same customer.';
