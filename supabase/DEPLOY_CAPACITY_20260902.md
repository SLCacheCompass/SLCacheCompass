# Cache Compass capacity rollout — 2026-09-02

This rollout is additive and must not rewrite or delete historical customers, licenses, test purchases, receipts, transactions, avatar history, reconciliation/recovery data, or support notes.

## Deploy in this order

1. `supabase/migrations/20260902_000004_entitlement_capacity.sql`
2. `supabase/migrations/20260902_000005_capacity_purchase_guard.sql`
3. `supabase/migrations/20260902_000006_entitlement_identity_lookup.sql`
4. `supabase/migrations/20260902_000007_inactive_entitlement_purchase_hold.sql`
5. Deploy Edge Function `supabase/functions/admin-entitlements/index.ts` as `admin-entitlements`.

`admin-entitlements` is owner/admin only. Keep Supabase-user authentication enabled for that function.

## Important production warning

Do **not** overwrite the current live Linden endpoint with the older repository `linden-purchase` implementation, and do not deploy the repository `issue-license` implementation over a newer live licensing function without first diffing the current deployed code. The live production payment/recovery/idempotency logic must be preserved.

The repository functions are reference integrations for the new capacity RPCs; the current live functions may contain newer schema/recovery logic that is not represented in GitHub.

## Patch the current live purchase paths in place

For every normal paid purchase from a known customer (USD or L$):

1. Preserve the existing provider receipt / transaction / nonce / purchase record exactly as today.
2. Resolve the customer's existing entitlement with `cc_find_entitlement_state_v2(customer_id, avatar_uuid, email)`.
   - This lookup understands customer id, email, purchaser UUID, current avatar assignments, and legacy avatar assignments.
   - A registered alt therefore resolves back to the same entitlement.
3. If no existing entitlement exists, follow the current new-customer issuance path.
4. If an existing entitlement is `active`, call `cc_apply_capacity_purchase(...)` instead of creating another active license.
5. If the resulting capacity is 30 or less, capacity is applied idempotently to the existing entitlement.
6. If the resulting capacity is above 30, the transaction is preserved as a pending owner-review request. Do not create another active license.
7. If the existing entitlement is `suspended` or `revoked`, preserve the transaction as a pending owner-review hold. Do not create another active license and do not reactivate automatically.
8. Replays/retries must pass the same external transaction id so the capacity operation remains idempotent.

For Linden purchases, keep the existing nonce/recovery/reconciliation behavior. The capacity RPC is an entitlement decision after the current payment/idempotency checks, not a replacement for those checks.

## Back Office behavior

The Back Office on `main` is already wired for:

- `Upgrade / Add Alt Capacity`
- normal 30-avatar ceiling
- explicit owner override above 30
- gross / fees / net / currency / receipt metadata
- upgrades / gifts / comps / manual adjustments
- date range / USD-L$ / tier / sale-type filters
- monthly and YTD sales summaries
- Sales CSV export
- pending capacity approvals on Dashboard
- inactive-license purchase holds that require Reactivate first
- customer download filename request `CacheCompass-Setup.exe`

Do not redesign the Back Office during this rollout.

## Verification checklist

Use test data only. Do not alter historical production records just to make the verification cleaner.

- New customer buys 3-avatar tier -> one active entitlement is created.
- Same primary avatar buys 5 -> no second active entitlement; existing entitlement gains 5 slots and both transactions remain visible.
- A registered alt buys 3 -> resolves to the same entitlement; no new active license.
- Repeat the same transaction/nonce -> no duplicate capacity and no duplicate active license.
- Capacity 28 + purchase 3 -> transaction is preserved pending owner approval; capacity stays 28 until approved.
- Owner approves -> capacity becomes 31 and the override is recorded.
- Suspended customer purchases -> transaction is preserved pending review; no new active license and no automatic reactivation.
- Reactivate suspended entitlement, then approve held request -> capacity applies to that entitlement.
- Search still finds customer by avatar name, UUID, email, license ending, receipt, and transaction.
- Linden-only customer remains recoverable without email.
- Existing replacement/removal avatar history remains unchanged.
- Sales filters and CSV still include historical records plus new capacity events.

## Releases

Do not invent a rollback implementation without inspecting the deployed `admin-release` function and its private storage/version pointer. Preserve internal versioning. Customer-facing downloads should be served as `CacheCompass-Setup.exe` once the deployed release function is confirmed to honor that filename.