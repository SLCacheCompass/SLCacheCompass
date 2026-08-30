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

    const externalTransactionId = body.externalTransactionId ? String(body.externalTransactionId).trim().slice(0, 200) : null;
    const paymentAmount = body.paymentAmount == null ? null : Number(body.paymentAmount);
    if (paymentAmount != null && (!Number.isFinite(paymentAmount) || paymentAmount < 0)) {
      return json({ error: 'invalid_payment_amount' }, 400);
    }

    const paymentCurrency = body.paymentCurrency ? String(body.paymentCurrency).trim().toUpperCase().slice(0, 12) : null;
    const registerPurchaser = body.registerPurchaser !== false;

    const db = serviceClient();
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
