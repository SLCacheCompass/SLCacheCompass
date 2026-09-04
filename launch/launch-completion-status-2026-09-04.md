# Cache Compass launch completion status — 2026-09-04

## Scope
Launch-critical audit only. No new product features. No purchases, license deletions, avatar registration, inventory movement, payment, advertising spend, or customer-history rewrites were performed.

## Completed during this audit

### Production licensing / capacity
- Confirmed production was still using the older Linden purchase path that created a separate active license for each purchase.
- Applied an additive capacity schema to production. Existing licenses, purchases, avatar assignments, and historical test data were preserved.
- Added capacity event history and owner-review request history.
- Installed final 30-avatar rules:
  - self-service increments are 3 / 5 / 10 slots;
  - purchases add to an existing entitlement when the buyer/customer/avatar can be resolved;
  - normal self-service capacity stops at 30;
  - a purchase that would exceed 30 is held for owner review instead of silently creating extra capacity or a second license;
  - owner-only approval can authorize capacity above 30;
  - external transaction IDs make capacity fulfillment idempotent.
- Added Back Office database controls for total capacity, manual +3/+5/+10 capacity, and owner approval above 30.
- Added `linden_kiosk` as a valid purchase channel while preserving the historical `second_life_kiosk` label.
- Deployed production Edge Function `linden-purchase` with the sandbox-proven capacity-aware purchase flow. The older `quick-api` was intentionally left intact so no existing object was broken during deployment.
- Ran non-destructive transaction/rollback tests in production:
  - 3-slot capacity purchase correctly increased a 3-slot entitlement to 6 inside the transaction;
  - repeated +10 additions correctly reached 30;
  - an additional +3 at 30 returned `pendingOwnerReview=true`, requested 33, and left active capacity at 30;
  - all QA changes were rolled back; no capacity event or override test record was retained.

### Production security hardening
- Re-ran Supabase security advisors.
- Revoked anonymous EXECUTE from the highest-risk Back Office mutation functions, including manual sale/license issuance, avatar swap/name corrections, customer merge, license-key reissue, and operational purge functions.
- Kept authenticated Back Office behavior intact so role-checked owner/admin workflows are not broken.
- Newly added capacity tables have RLS enabled and no anon/authenticated table access; capacity core functions are service-role only. Authenticated Back Office wrapper functions enforce Cache Compass admin roles.

### Existing launch evidence retained
- Prior Windows automated regression run: 28/28 test groups passed, including duplicate Landmarks/Notecards, keyword-only behavior, geometry policy, discovery assertions, and installer license line-ending checks.
- Protected Folders native fixture testing at 125% DPI passed the documented Select All / Deselect All / filter / Clear Search behavior.
- `admin-delete-license` and `avatar-name-resolver` were already deployed and their unauthenticated access safeguards had been verified.

### Legal
- Current Terms, Privacy Policy, and Refund Policy exist in the public website repository.
- Terms effective date is September 4, 2026 and includes the final 30-avatar capacity language, anti-circumvention/piracy language, compatibility limits, inventory responsibility, refund-policy incorporation, Kentucky governing-law language, and affirmative-acceptance language.
- Because launch is now in-world L$ vendor only, a web-checkout acceptance control is not a launch dependency. Installer/EULA acceptance remains the important affirmative software-license acceptance point.

### Marketing preparation
- Added `launch/launch-kit-2026-09-04.md` containing:
  - product positioning and short description;
  - reviewer pitch and disclosure note;
  - first reviewer shortlist;
  - Cache Compass Primfeed profile/cadence/first seven posts;
  - $500 maximum test-budget plan with stop rules;
  - sales attribution metrics;
  - commercial structure for a 60-second Beetle Wilder master;
  - launch social copy;
  - support templates.

## Confirmed current launch pricing
- 3 avatars: L$7,500 launch / L$9,000 regular
- 5 avatars: L$10,500 launch / L$12,000 regular
- 10 avatars: L$19,500 launch / L$21,000 regular
- Launch price window: one month after the commercial releases.

## Known website consistency issue
The current `main` homepage still presents USD prices and copy implying an alternative USD purchase path, while the approved launch decision is **in-world vendor only**. It also still labels the main navigation CTA `Coming Soon`, which should remain until the actual release is ready but must be changed at launch. Do not publish a USD checkout.

## Remaining gates that require external/native interaction
1. **In-world vendor wiring:** the in-world vendor must point to the new production `linden-purchase` endpoint rather than the legacy purchase endpoint, while keeping the existing private kiosk secret private. Then reset the script and confirm it loads L$7,500 / L$10,500 / L$19,500 from the server.
2. **Actual in-world purchase verification:** one authorized test purchase/controlled payment is needed to prove the full LSL → Edge Function → purchase record → entitlement path. Do not run an unapproved real-money/L$ transaction automatically.
3. **Windows native verification:** Remote Desktop Commander was not connected during this audit. Final installer pane rendering, licensed end-to-end Start Here/Scan/Review/Move flow, taskbar/maximize behavior, and tester-specific Windows issues require a connected Windows machine/tester.
4. **Tester-specific proof:** Rei’s historical Landmark/Notecard issue and Beetle’s DPI/theme checkbox visibility require their machine/build feedback or equivalent native reproduction. Automated evidence is strong but is not a substitute for those tester conditions.
5. **Beetle commercial:** waiting for Beetle’s reply on the 60-second package / social cut.
6. **Primfeed account creation:** must be created by the account owner as the Cache Compass avatar; all copy/content is prepared.

## Not launch blockers / deliberately deferred
- Marketplace listing: not planned.
- USD/Stripe public checkout: not planned for this launch.
- New feature requests: frozen until after launch.
- Destructive owner Delete Record test: intentionally not performed.
