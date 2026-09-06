# Stripe Tax + Linden accounting sandbox handoff

Date: 2026-09-04

## Scope

Sandbox only. Production Stripe, production Supabase, and live in-world customer pricing were not changed.

## Sandbox changes completed

- Stripe sandbox products 3 / 5 / 10 use tax code `txcd_10202001` (Downloadable Software - non-recreational - personal use).
- Stripe sandbox launch prices are tax-exclusive so advertised prices remain pre-tax.
- `commerce-checkout` sandbox Edge Function version 13 enables Stripe automatic tax and requires billing address collection.
- `stripe-webhook` sandbox Edge Function version 9 accepts tax on top of the expected subtotal, records subtotal/tax/total and customer country/region, and preserves replay compatibility for older zero-tax sessions.
- Migration `20260904_000010_tax_and_linden_accounting.sql` adds tax and L$ valuation/accounting fields, an accounting view, service-role valuation helper, and tax-aware USD fulfillment.
- Migration `20260904_000011_linden_accounting_defaults.sql` adds automatic accounting defaults for in-world L$ purchases without changing what the customer pays.
- Migration `20260904_000012_linden_channel_compat.sql` recognizes both historical `second_life_kiosk` and current `linden_kiosk` channel labels.
- Migration `20260904_000013_allow_linden_kiosk_channel.sql` allows the current `linden_kiosk` label under the purchases channel constraint.

## Verified in sandbox

- Existing paid zero-tax Stripe order can still replay through the new fulfillment function without creating a duplicate entitlement.
- L$ purchase accounting defaults record the original L$ amount, zero tax collected, unknown jurisdiction, and leave USD equivalent null until a defensible exchange-rate snapshot is recorded.
- `cc_set_linden_valuation` can record a later L$/USD accounting snapshot without rewriting the original L$ transaction.

## Kentucky registration gate

Stripe Tax has no sandbox tax registrations recorded as of this handoff. Do not represent Cache Compass as registered with Kentucky inside Stripe until the Kentucky Sales & Use Tax account is actually obtained. After registration, add Kentucky to Stripe Tax in test/live as appropriate and run a Kentucky-address checkout proving 6% tax before production release.

## Source reconciliation before production

The sandbox-deployed `commerce-checkout` v13 and `stripe-webhook` v9 contain the tax-aware runtime changes. Before production deployment, reconcile those deployed function bodies back into the `capacity-30` repository source and rerun CI. Do not deploy the older repository checkout/webhook source over these sandbox changes.
