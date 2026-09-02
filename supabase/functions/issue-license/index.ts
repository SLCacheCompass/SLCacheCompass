import { cleanAvatarName, generateLicenseKey, hashLicenseKey, json, preflight, serviceClient, tierSlots, validAvatarUuid } from '../_shared/license.ts';

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const expectedSecret = Deno.env.get('LICENSE_ISSUER_SECRET');
  const suppliedSecret = req.headers.get('x-cache-compass-admin-secret');
  if (!expectedSecret || !suppliedSecret || suppliedSecret !== expectedSecret) {
    return json({ error: 'unauthorized' }, 401);
  }

  try {
    const body = await req.json();
    const maxAvatars = tierSlots(body.tier);
    if (!maxAvatars) return json({ error: 'invalid_tier' }, 400);

    const paymentMethod = String(body.paymentMethod ?? '').toLowerCase();
    if (!['usd', 'linden', 'manual', 'test'].includes(paymentMethod)) {
      return json({ error: 'invalid_payment_method' }, 400);
    }

    const purchaserAvatarUuid = body.purchaserAvatarUuid ?? null;
    if (purchaserAvatarUuid && !validAvatarUuid(purchaserAvatarUuid)) {
      return json({ error: 'invalid_purchaser_avatar_uuid' }, 400);
    }

    const customerId = body.customerId && validAvatarUuid(body.customerId)
      ? String(body.customerId).trim().toLowerCase()
      : null;
    const externalTransactionId = body.externalTransactionId ? String(body.externalTransactionId).trim().slice(0, 200) : null;
    const paymentAmount = body.paymentAmount == null ? null : Number(body.paymentAmount);
    if (paymentAmount != null && (!Number.isFinite(paymentAmount) || paymentAmount < 0)) {
      return json({ error: 'invalid_payment_amount' }, 400);
    }

    const paymentCurrency = body.paymentCurrency ? String(body.paymentCurrency).trim().toUpperCase().slice(0, 12) : null;
    const registerPurchaser = body.registerPurchaser !== false;
    const db = serviceClient();

    // Tests remain intentionally separate. Normal purchases for a known existing
    // customer add capacity to one active entitlement instead of creating unlimited
    // parallel active licenses. The original tier remains historical; current capacity
    // is updated and the purchase is recorded in license_capacity_events.
    if (paymentMethod !== 'test' && (customerId || purchaserAvatarUuid)) {
      const { data: existingLicenseId, error: findError } = await db.rpc('cc_find_active_entitlement', {
        target_customer_id: customerId,
        target_avatar_uuid: purchaserAvatarUuid ? String(purchaserAvatarUuid).trim().toLowerCase() : null,
      });

      if (findError) {
        console.error('issue-license entitlement lookup failed', findError.code, findError.message);
        return json({ error: 'license_issue_failed' }, 500);
      }

      if (existingLicenseId) {
        const feeAmount = body.feeAmount == null ? null : Number(body.feeAmount);
        const netAmount = body.netAmount == null ? null : Number(body.netAmount);
        if (feeAmount != null && !Number.isFinite(feeAmount)) return json({ error: 'invalid_fee_amount' }, 400);
        if (netAmount != null && !Number.isFinite(netAmount)) return json({ error: 'invalid_net_amount' }, 400);

        const recordType = ['upgrade', 'gift', 'comp', 'purchase_capacity', 'manual_adjustment'].includes(String(body.recordType || ''))
          ? String(body.recordType)
          : 'upgrade';
        const ownerOverride = body.ownerOverride === true;

        const { data: upgraded, error: upgradeError } = await db.rpc('cc_upgrade_license_capacity', {
          target_license_id: existingLicenseId,
          slots_to_add: maxAvatars,
          change_type: recordType,
          payment_source_value: paymentMethod,
          gross_amount_value: paymentAmount,
          fee_amount_value: feeAmount,
          net_amount_value: netAmount,
          currency_value: paymentCurrency,
          external_transaction_value: externalTransactionId,
          purchase_id_value: body.purchaseId ? String(body.purchaseId).trim().slice(0, 200) : null,
          owner_override_value: ownerOverride,
          note_value: body.note ? String(body.note).trim().slice(0, 1000) : null,
          metadata_value: { source: 'issue-license' },
        });

        if (upgradeError) {
          const detail = `${upgradeError.message || ''} ${upgradeError.details || ''}`;
          if (detail.includes('owner_override_required_above_25')) return json({ error: 'owner_override_required_above_25' }, 409);
          if (detail.includes('capacity_transaction_conflict')) return json({ error: 'duplicate_transaction_conflict' }, 409);
          console.error('issue-license capacity upgrade failed', upgradeError.code, upgradeError.message);
          return json({ error: 'license_upgrade_failed' }, 500);
        }

        return json({
          upgraded: true,
          createdNewLicense: false,
          licenseKey: null,
          licenseId: existingLicenseId,
          addedSlots: maxAvatars,
          maxAvatars: Number(upgraded?.capacity || 0),
          status: 'active',
          transactionId: externalTransactionId,
        });
      }
    }

    const licenseKey = generateLicenseKey();
    const keyHash = await hashLicenseKey(licenseKey);
    const keyLast4 = licenseKey.slice(-4);

    const { data: license, error: insertError } = await db
      .from('licenses')
      .insert({
        key_hash: keyHash,
        key_last4: keyLast4,
        tier: String(maxAvatars),
        max_avatars: maxAvatars,
        purchaser_avatar_uuid: purchaserAvatarUuid,
        payment_method: paymentMethod,
        payment_amount: paymentAmount,
        payment_currency: paymentCurrency,
        external_transaction_id: externalTransactionId,
      })
      .select('id,tier,max_avatars,status,created_at')
      .single();

    if (insertError) {
      if (insertError.code === '23505') return json({ error: 'duplicate_transaction_or_license' }, 409);
      console.error('issue-license insert failed', insertError.code);
      return json({ error: 'license_issue_failed' }, 500);
    }

    if (purchaserAvatarUuid && registerPurchaser) {
      const { error: avatarError } = await db.from('license_avatars').insert({
        license_id: license.id,
        avatar_uuid: purchaserAvatarUuid,
        avatar_name: cleanAvatarName(body.purchaserAvatarName),
        last_validated_at: new Date().toISOString(),
      });

      if (avatarError) {
        await db.from('licenses').delete().eq('id', license.id);
        console.error('issue-license purchaser registration failed', avatarError.code);
        return json({ error: 'license_issue_failed' }, 500);
      }
    }

    await db.from('license_events').insert({
      license_id: license.id,
      event_type: 'issued',
      avatar_uuid: purchaserAvatarUuid,
      metadata: {
        tier: maxAvatars,
        payment_method: paymentMethod,
        external_transaction_id: externalTransactionId,
      },
    });

    return json({
      upgraded: false,
      createdNewLicense: true,
      licenseKey,
      tier: maxAvatars,
      maxAvatars,
      registeredAvatars: purchaserAvatarUuid && registerPurchaser ? 1 : 0,
      status: license.status,
      createdAt: license.created_at,
    }, 201);
  } catch (error) {
    console.error('issue-license unexpected error', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'bad_request' }, 400);
  }
});
