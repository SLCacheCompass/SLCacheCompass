-- The purchases table's canonical in-world channel is second_life_kiosk.
-- Keep accounting defaults compatible with older linden_kiosk labels if any legacy row exists.
create or replace function public.cc_linden_accounting_defaults()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if new.channel in ('second_life_kiosk','linden_kiosk') and new.currency='L$' then
    new.original_amount := coalesce(new.original_amount,new.amount);
    new.original_currency := coalesce(new.original_currency,'L$');
    new.original_source := coalesce(new.original_source,'linden_kiosk');
    new.tax_amount := coalesce(new.tax_amount,0);
    new.tax_collection_method := coalesce(new.tax_collection_method,'not_collected_location_unavailable');
    new.tax_jurisdiction := null;
    new.tax_rate := null;
    new.customer_country := null;
    new.customer_region := null;
    new.financials_status := coalesce(new.financials_status,'valuation_pending');
  end if;
  return new;
end;
$$;

update public.purchases
set original_amount=coalesce(original_amount,amount),
    original_currency=coalesce(original_currency,'L$'),
    original_source=coalesce(original_source,'linden_kiosk'),
    tax_amount=coalesce(tax_amount,0),
    tax_collection_method=coalesce(tax_collection_method,'not_collected_location_unavailable'),
    tax_jurisdiction=null,
    tax_rate=null,
    customer_country=null,
    customer_region=null,
    financials_status=coalesce(financials_status,'valuation_pending')
where channel in ('second_life_kiosk','linden_kiosk') and currency='L$';
