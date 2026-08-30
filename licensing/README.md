# Cache Compass licensing backend

This folder contains the first licensing backend for Cache Compass. It is designed for Supabase's free tier and keeps licensing separate from the public GitHub Pages website.

## License tiers

- 3 avatars — $24.99
- 5 avatars — $39.99
- 10 avatars — $69.99

Every tier unlocks the same Cache Compass features. The tier only controls the number of registered Second Life avatar UUIDs.

## Security model

- Plaintext license keys are returned only once when a license is issued.
- The database stores only a SHA-256 hash of each license key plus the last four characters for support lookup.
- License issuance requires a private `LICENSE_ISSUER_SECRET` and the Supabase service-role key.
- Database tables have Row Level Security enabled and are not directly readable by anonymous clients.
- Avatar registration is enforced server-side so a 3/5/10-avatar license cannot exceed its slot count.
- No Second Life passwords, MFA codes, or viewer credentials are stored.

## Included endpoints

- `issue-license` — server-to-server endpoint used after a verified USD or L$ purchase.
- `validate-license` — checks license status, tier, registered avatars, and remaining slots.
- `register-avatar` — adds a Second Life avatar UUID to a license if a slot is available.

## Purchase flow

1. A website checkout or in-world kiosk verifies payment.
2. The trusted payment bridge calls `issue-license`.
3. The backend creates the license and returns the plaintext license key once.
4. Cache Compass sends the license key and current avatar UUID to `validate-license` / `register-avatar`.
5. The database enforces the avatar-slot limit.

The in-world kiosk should not be allowed to write directly to the database. It will eventually call a narrow payment endpoint that verifies the L$ transaction and then issues the entitlement.

## Supabase deployment

1. Create a Supabase project.
2. Run `supabase/migrations/20260830_000001_create_licensing.sql`.
3. Set Edge Function secrets:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `LICENSE_ISSUER_SECRET`
4. Deploy the three Edge Functions in `supabase/functions/`.
5. Point `api.slcachecompass.com` at the deployed API layer when ready.

No live secrets belong in this repository.