-- The current Linden edge function labels its purchase channel linden_kiosk.
-- Preserve the older second_life_kiosk label for historical compatibility.
alter table public.purchases drop constraint if exists purchases_channel_check;
alter table public.purchases add constraint purchases_channel_check check (
  channel = any (array[
    'website_usd'::text,
    'second_life_marketplace'::text,
    'second_life_kiosk'::text,
    'linden_kiosk'::text,
    'manual'::text,
    'promo'::text,
    'comp'::text
  ])
);
