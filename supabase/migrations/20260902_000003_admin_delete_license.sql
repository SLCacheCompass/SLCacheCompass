create or replace function public.admin_delete_license_record(target_license_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  child record;
  deleted_count integer := 0;
begin
  if target_license_id is null then
    raise exception 'license_id_required';
  end if;

  if not exists (select 1 from public.licenses where id = target_license_id) then
    raise exception 'license_not_found';
  end if;

  -- Remove avatar slot history that points to an assignment rather than directly
  -- to the license, when those current-schema tables/columns exist.
  if to_regclass('public.avatar_slot_events') is not null
     and to_regclass('public.license_avatar_assignments') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'avatar_slot_events' and column_name = 'assignment_id'
     )
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'license_avatar_assignments' and column_name = 'id'
     )
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'license_avatar_assignments' and column_name = 'license_id'
     ) then
    execute '
      delete from public.avatar_slot_events
      where assignment_id in (
        select id from public.license_avatar_assignments where license_id = $1
      )'
      using target_license_id;
  end if;

  -- Delete every direct child row in public tables that exposes a license_id
  -- column. This keeps the operation compatible with both the original and
  -- expanded Cache Compass licensing schemas.
  for child in
    select distinct table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'license_id'
      and table_name <> 'licenses'
    order by table_name
  loop
    execute format('delete from public.%I where license_id = $1', child.table_name)
      using target_license_id;
  end loop;

  delete from public.licenses where id = target_license_id;
  get diagnostics deleted_count = row_count;

  if deleted_count <> 1 then
    raise exception 'license_delete_failed';
  end if;

  return jsonb_build_object('deleted', true, 'licenseId', target_license_id);
end;
$$;

revoke all on function public.admin_delete_license_record(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_license_record(uuid) to service_role;

comment on function public.admin_delete_license_record(uuid) is
  'Owner-admin hard delete for test/erroneous Cache Compass license records. Deletes license_id child rows before the license itself.';
