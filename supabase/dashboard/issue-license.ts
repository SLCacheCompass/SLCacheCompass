import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('server_configuration_error');
  return createClient(url, key, { auth: { persistSession: false } });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-cache-compass-admin-secret',
      'access-control-allow-methods': 'POST, OPTIONS',
    },
  });
}

function generateLicenseKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let raw = '';
  for (let i = 0; i < 16; i++) raw += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  return `CC-${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}`;
}

function normalizeLicenseKey(value: string) {
  return value.trim().toUpperCase();
}

async function hashLicenseKey(value: string) {
  const normalized = normalizeLicenseKey(value);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function validAvatarUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function tierSlots(tier: unknown) {
  if (tier === '3' || tier === 3) return 3;
  if (tier === '5' || tier === 5) return 5;
  if (tier === '10' || tier === 10) return 10;
  return null;
}

function cleanAvatarName(value: unknown) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name ? name.slice(0, 100) : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({}, 200);
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
