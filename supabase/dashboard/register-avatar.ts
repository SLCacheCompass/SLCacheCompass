import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
      'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
      'access-control-allow-methods': 'POST, OPTIONS',
    },
  });
}

function preflight(req: Request) {
  if (req.method === 'OPTIONS') return json({}, 200);
  return null;
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

function cleanAvatarName(value: unknown) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name ? name.slice(0, 100) : null;
}

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const body = await req.json();
    const licenseKey = typeof body.licenseKey === 'string' ? body.licenseKey : '';
    const avatarUuid = body.avatarUuid;

    if (!licenseKey) return json({ error: 'license_key_required' }, 400);
    if (!validAvatarUuid(avatarUuid)) return json({ error: 'invalid_avatar_uuid' }, 400);

    const db = serviceClient();
    const keyHash = await hashLicenseKey(licenseKey);

    const { data: license, error: licenseError } = await db
      .from('licenses')
      .select('id,tier,max_avatars,status')
      .eq('key_hash', keyHash)
      .maybeSingle();

    if (licenseError) {
      console.error('register-avatar license lookup failed', licenseError.code);
      return json({ error: 'registration_failed' }, 500);
    }
    if (!license) return json({ error: 'invalid_license' }, 404);
    if (license.status !== 'active') return json({ error: 'license_not_active', status: license.status }, 403);

    const { data: existing, error: existingError } = await db
      .from('license_avatars')
      .select('id')
      .eq('license_id', license.id)
      .eq('avatar_uuid', avatarUuid)
      .maybeSingle();

    if (existingError) {
      console.error('register-avatar duplicate lookup failed', existingError.code);
      return json({ error: 'registration_failed' }, 500);
    }

    if (existing) {
      return json({
        registered: true,
        alreadyRegistered: true,
        tier: Number(license.tier),
        maxAvatars: license.max_avatars,
      });
    }

    const { error: insertError } = await db.from('license_avatars').insert({
      license_id: license.id,
      avatar_uuid: avatarUuid,
      avatar_name: cleanAvatarName(body.avatarName),
      last_validated_at: new Date().toISOString(),
    });

    if (insertError) {
      const detail = `${insertError.message ?? ''} ${insertError.details ?? ''}`;
      if (detail.includes('avatar_limit_reached')) return json({ error: 'avatar_limit_reached' }, 409);
      if (detail.includes('license_not_active')) return json({ error: 'license_not_active' }, 403);
      if (insertError.code === '23505') return json({ registered: true, alreadyRegistered: true });
      console.error('register-avatar insert failed', insertError.code);
      return json({ error: 'registration_failed' }, 500);
    }

    const { count } = await db
      .from('license_avatars')
      .select('id', { count: 'exact', head: true })
      .eq('license_id', license.id);

    await db.from('license_events').insert({
      license_id: license.id,
      event_type: 'avatar_registered',
      avatar_uuid: avatarUuid,
      metadata: { used_slots: count ?? null },
    });

    return json({
      registered: true,
      alreadyRegistered: false,
      tier: Number(license.tier),
      maxAvatars: license.max_avatars,
      usedSlots: count ?? null,
      remainingSlots: count == null ? null : Math.max(0, license.max_avatars - count),
    }, 201);
  } catch (error) {
    console.error('register-avatar unexpected error', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'bad_request' }, 400);
  }
});
