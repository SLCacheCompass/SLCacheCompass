import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, x-cache-compass-kiosk-secret',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    },
  });
}

function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('server_configuration_error');
  return createClient(url, key, { auth: { persistSession: false } });
}

function validUuid(value: unknown): value is string {
  // Second Life keys are UUID-shaped, but individual key generators may change UUID version.
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function cleanName(value: unknown) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name ? name.slice(0, 100) : null;
}

function tierSlots(value: unknown) {
  if (value === 3 || value === '3') return 3;
  if (value === 5 || value === '5') return 5;
  if (value === 10 || value === '10') return 10;
  return null;
}

function requiredPositiveInteger(name: string) {
  const raw = Deno.env.get(name);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function prices() {
  return {
    3: requiredPositiveInteger('KIOSK_PRICE_3_LD'),
    5: requiredPositiveInteger('KIOSK_PRICE_5_LD'),
    10: requiredPositiveInteger('KIOSK_PRICE_10_LD'),
  } as const;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value.trim().toUpperCase()));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function deterministicLicenseKey(secret: string, purchaseId: string, payerUuid: string, tier: number) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${purchaseId}|${payerUuid.toLowerCase()}|${tier}`),
  );
  const bytes = new Uint8Array(signed);
  let raw = '';
  for (let i = 0; i < 16; i++) raw += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  return `CC-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

function authenticateKiosk(req: Request) {
  const expectedSecret = Deno.env.get('KIOSK_SHARED_SECRET');
  const suppliedSecret = req.headers.get('x-cache-compass-kiosk-secret');
  const expectedOwner = Deno.env.get('KIOSK_OWNER_UUID')?.trim().toLowerCase();
  const ownerKey = req.headers.get('x-secondlife-owner-key')?.trim().toLowerCase() ?? '';
  const shard = req.headers.get('x-secondlife-shard')?.trim() ?? '';
  const objectKey = req.headers.get('x-secondlife-object-key')?.trim().toLowerCase() ?? '';
  const region = req.headers.get('x-secondlife-region')?.trim() ?? '';
  const userAgent = req.headers.get('user-agent') ?? '';

  if (!expectedSecret || !expectedOwner) return { ok: false as const, status: 500, error: 'server_configuration_error' };
  if (!suppliedSecret || suppliedSecret !== expectedSecret) return { ok: false as const, status: 401, error: 'unauthorized' };
  if (!validUuid(expectedOwner) || ownerKey !== expectedOwner) return { ok: false as const, status: 403, error: 'unauthorized_owner' };
  if (shard !== 'Production') return { ok: false as const, status: 403, error: 'production_grid_required' };
  if (!validUuid(objectKey)) return { ok: false as const, status: 403, error: 'invalid_kiosk_object' };
  if (!userAgent.startsWith('Second Life LSL/')) return { ok: false as const, status: 403, error: 'lsl_request_required' };

  return { ok: true as const, ownerKey, objectKey, region, shard };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({});
  if (!['GET', 'POST'].includes(req.method)) return json({ error: 'method_not_allowed' }, 405);

  try {
    const kiosk = authenticateKiosk(req);
    if (!kiosk.ok) return json({ error: kiosk.error }, kiosk.status);

    const kioskPrices = prices();

    if (req.method === 'GET') {
      return json({
        ready: true,
        currency: 'L$',
        tiers: [
          { tier: 3, price: kioskPrices[3] },
          { tier: 5, price: kioskPrices[5] },
          { tier: 10, price: kioskPrices[10] },
        ],
      });
    }

    const body = await req.json();
    const tier = tierSlots(body.tier);
    const payerUuid = typeof body.payerUuid === 'string' ? body.payerUuid.trim().toLowerCase() : '';
    const payerName = cleanName(body.payerName);
    const nonce = typeof body.nonce === 'string' ? body.nonce.trim().toLowerCase() : '';
    const amount = Number(body.amount);

    if (!tier) return json({ error: 'invalid_tier' }, 400);
    if (!validUuid(payerUuid)) return json({ error: 'invalid_payer_uuid' }, 400);
    if (!validUuid(nonce)) return json({ error: 'invalid_purchase_nonce' }, 400);
    if (!Number.isInteger(amount) || amount <= 0) return json({ error: 'invalid_amount' }, 400);
    if (amount !== kioskPrices[tier]) return json({ error: 'incorrect_amount', expected: kioskPrices[tier] }, 409);

    const issuerSecret = Deno.env.get('LICENSE_ISSUER_SECRET');
    if (!issuerSecret) return json({ error: 'server_configuration_error' }, 500);

    // The LSL money event does not expose Linden Lab's transaction ID. This is an
    // internal, idempotent purchase ID generated from the kiosk object + nonce.
    const purchaseId = `linden-kiosk:${kiosk.objectKey}:${nonce}`;
    const licenseKey = await deterministicLicenseKey(issuerSecret, purchaseId, payerUuid, tier);
    const keyHash = await sha256(licenseKey);
    const db = serviceClient();

    const finishExisting = async (license: any) => {
      if (
        license.key_hash !== keyHash ||
        Number(license.tier) !== tier ||
        license.purchaser_avatar_uuid?.toLowerCase() !== payerUuid
      ) {
        return json({ error: 'purchase_id_conflict' }, 409);
      }

      if (license.status !== 'active') return json({ error: 'license_not_active', status: license.status }, 403);

      const { error: regError } = await db.from('license_avatars').upsert({
        license_id: license.id,
        avatar_uuid: payerUuid,
        avatar_name: payerName,
        last_validated_at: new Date().toISOString(),
      }, { onConflict: 'license_id,avatar_uuid', ignoreDuplicates: false });

      if (regError) {
        console.error('linden-purchase retry registration failed', regError.code);
        return json({ error: 'purchase_recovery_failed' }, 500);
      }

      const { count } = await db.from('license_avatars')
        .select('id', { count: 'exact', head: true })
        .eq('license_id', license.id);

      return json({
        purchased: true,
        reused: true,
        licenseKey,
        tier,
        maxAvatars: license.max_avatars,
        usedSlots: count ?? 1,
        remainingSlots: Math.max(0, license.max_avatars - (count ?? 1)),
      });
    };

    const { data: existing, error: existingError } = await db.from('licenses')
      .select('id,key_hash,tier,max_avatars,status,purchaser_avatar_uuid')
      .eq('external_transaction_id', purchaseId)
      .maybeSingle();

    if (existingError) {
      console.error('linden-purchase existing lookup failed', existingError.code);
      return json({ error: 'purchase_failed' }, 500);
    }
    if (existing) return await finishExisting(existing);

    const { data: license, error: insertError } = await db.from('licenses').insert({
      key_hash: keyHash,
      key_last4: licenseKey.slice(-4),
      tier: String(tier),
      max_avatars: tier,
      purchaser_avatar_uuid: payerUuid,
      payment_method: 'linden',
      payment_amount: amount,
      payment_currency: 'L$',
      external_transaction_id: purchaseId,
    }).select('id,key_hash,tier,max_avatars,status,purchaser_avatar_uuid,created_at').single();

    if (insertError) {
      if (insertError.code === '23505') {
        const { data: raced } = await db.from('licenses')
          .select('id,key_hash,tier,max_avatars,status,purchaser_avatar_uuid')
          .eq('external_transaction_id', purchaseId)
          .maybeSingle();
        if (raced) return await finishExisting(raced);
      }
      console.error('linden-purchase license insert failed', insertError.code);
      return json({ error: 'purchase_failed' }, 500);
    }

    const { error: avatarError } = await db.from('license_avatars').insert({
      license_id: license.id,
      avatar_uuid: payerUuid,
      avatar_name: payerName,
      last_validated_at: new Date().toISOString(),
    });

    if (avatarError) {
      await db.from('licenses').delete().eq('id', license.id);
      console.error('linden-purchase avatar registration failed', avatarError.code);
      return json({ error: 'purchase_failed' }, 500);
    }

    await db.from('license_events').insert({
      license_id: license.id,
      event_type: 'issued_linden',
      avatar_uuid: payerUuid,
      metadata: {
        amount,
        currency: 'L$',
        kiosk_object_uuid: kiosk.objectKey,
        kiosk_owner_uuid: kiosk.ownerKey,
        region: kiosk.region,
        purchase_nonce: nonce,
      },
    });

    return json({
      purchased: true,
      reused: false,
      licenseKey,
      tier,
      maxAvatars: tier,
      usedSlots: 1,
      remainingSlots: tier - 1,
      createdAt: license.created_at,
    }, 201);
  } catch (error) {
    console.error('linden-purchase unexpected error', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'bad_request' }, 400);
  }
});
