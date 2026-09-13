# Cache Compass licensing backend

This folder contains the Cache Compass licensing backend. It is designed for Supabase's free tier and keeps licensing separate from the public GitHub Pages website.

## License tiers

Current planned launch pricing:

- 3 avatars — $24.99 launch ($29.99 regular)
- 5 avatars — $34.99 launch ($39.99 regular)
- 10 avatars — $69.99 launch ($74.99 regular)

Every tier unlocks the same Cache Compass features. The tier only controls the number of registered Second Life avatar UUIDs.

## Security model

- Plaintext license keys are never stored in the database.
- The database stores only a SHA-256 hash of each license key plus the last four characters for support lookup.
- Manual/server-side license issuance requires the private `LICENSE_ISSUER_SECRET`.
- The in-world kiosk uses a separate, narrow `KIOSK_SHARED_SECRET`; the master issuer secret is never placed in LSL.
- The kiosk endpoint checks Second Life's outgoing HTTP headers for the Production grid, kiosk owner UUID, kiosk object UUID, and LSL user agent.
- The kiosk server independently checks the L$ amount against server-side pricing instead of trusting the viewer's Pay buttons.
- Kiosk license keys are deterministically derived server-side from a unique purchase nonce. Retrying the same paid purchase therefore returns the same license instead of creating duplicates if an HTTP response is lost.
- Database tables have Row Level Security enabled and are not directly readable by anonymous clients.
- Avatar registration is enforced server-side so a 3/5/10-avatar license cannot exceed its slot count.
- No Second Life passwords, MFA codes, or viewer credentials are stored.

## Included endpoints

- `issue-license` — private server/admin endpoint for issuing a license after a verified non-kiosk purchase.
- `validate-license` — checks license status, tier, registered avatars, and remaining slots.
- `register-avatar` — adds a Second Life avatar UUID to a license if a slot is available.
- `linden-purchase` — narrow Second Life kiosk endpoint. GET returns current L$ tier prices to an authorized kiosk; POST records a paid purchase, registers the buying avatar, and returns the license key.

## Current live test status

The Supabase project has already successfully tested this core loop through the dashboard:

1. Issue a 3-avatar test license.
2. Validate that the license is active with 0/3 slots used.
3. Register a test avatar UUID.
4. Validate again and confirm 1/3 slots used, 2 remaining, and the test avatar recognized as registered.

The kiosk endpoint and LSL vendor are intentionally still on the `licensing-backend` branch until an in-world payment test is complete.

## In-world L$ purchase flow

1. The vendor starts with Pay disabled and calls `linden-purchase` with GET.
2. The server verifies the request came from the configured Cache Compass owner on the Second Life Production grid and returns the three current L$ prices.
3. The vendor configures exactly three Pay buttons for the 3/5/10-avatar tiers.
4. The buyer pays the vendor. The LSL `money` event supplies the payer UUID and actual L$ amount.
5. The vendor sends the payer UUID, amount, tier, and a unique nonce to `linden-purchase`.
6. The server re-checks the amount, creates the entitlement, automatically registers the purchasing avatar as slot 1, and returns the license key.
7. The kiosk IMs the buyer their license and remaining slot count.
8. If the web response is lost, the kiosk retries with the same nonce. The server returns the same deterministic license key rather than creating another sale.

The LSL `money` event does not expose Linden Lab's official transaction ID. Cache Compass therefore records its own unique kiosk receipt ID in `external_transaction_id`, built from the kiosk object UUID and purchase nonce. This is an internal idempotency/receipt value, not a Linden Lab transaction number.

## Supabase deployment

For the kiosk function, configure these additional Edge Function secrets before deployment:

- `KIOSK_SHARED_SECRET` — a new long random secret used only by the kiosk.
- `KIOSK_OWNER_UUID` — the Second Life UUID of the avatar that owns the live vendor.
- `KIOSK_PRICE_3_LD` — integer L$ price for the 3-avatar tier.
- `KIOSK_PRICE_5_LD` — integer L$ price for the 5-avatar tier.
- `KIOSK_PRICE_10_LD` — integer L$ price for the 10-avatar tier.

Supabase automatically exposes `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. `LICENSE_ISSUER_SECRET` must remain configured server-side as well.

Deploy `supabase/functions/linden-purchase/index.ts` as an Edge Function named exactly `linden-purchase`, with legacy JWT verification OFF just like the other Cache Compass functions.

Then copy `secondlife/CacheCompassVendor.lsl` into a root-prim script in Second Life and fill only these two script values:

- `ENDPOINT_URL` — the deployed Supabase `linden-purchase` function URL.
- `KIOSK_SHARED_SECRET` — the same kiosk-only secret stored in Supabase.

The vendor fetches prices from the server at startup, so final L$ prices can be changed server-side without editing the LSL script each time.

Do not place `LICENSE_ISSUER_SECRET`, the Supabase service-role key, database password, or any other master credential in the LSL script, website, or public repository.

## Remaining before public sales

- Choose final L$ prices.
- Deploy and test `linden-purchase` from a real Second Life object.
- Run controlled L$1/L$2/L$3 test pricing before switching to live prices.
- Verify failed-network retry behavior in-world.
- Add USD checkout/payment verification.
- Add customer-facing download/activation flow.
- Revoke/delete test licenses before launch.
