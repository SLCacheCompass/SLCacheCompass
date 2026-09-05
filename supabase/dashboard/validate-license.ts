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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({}, 200);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const body = await req.json();
    const licenseKey = typeof body.licenseKey === 'string' ? body.licenseKey : '';
    const avatarUuid = body.avatarUuid ?? null;

    if (!licenseKey) return json({ valid: false, error: 'license_key_required' }, 400);
    if (avatarUuid && !validAvatarUuid(avatarUuid)) {
      return json({ valid: false, error: 'invalid_avatar_uuid' }, 400);
    }

    const db = serviceClient();
    const keyHash = await hashLicenseKey(licenseKey);

    const { data: license, error } = await db
      .from('licenses')
      .select('id,tier,max_avatars,status')
      .eq('key_hash', keyHash)
      .maybeSingle();

    if (error) {
      console.error('validate-license lookup failed', error.code);
      return json({ valid: false, error: 'validation_failed' }, 500);
    }
    if (!license) return json({ valid: false, error: 'invalid_license' }, 404);

    const { count, error: countError } = await db
      .from('license_avatars')
      .select('id', { count: 'exact', head: true })
      .eq('license_id', license.id);

    if (countError) {
      console.error('validate-license count failed', countError.code);
      return json({ valid: false, error: 'validation_failed' }, 500);
    }

    let avatarRegistered = false;
    if (avatarUuid) {
      const { data: registration, error: registrationError } = await db
        .from('license_avatars')
        .select('id')
        .eq('license_id', license.id)
        .eq('avatar_uuid', avatarUuid)
        .maybeSingle();

      if (registrationError) {
        console.error('validate-license registration lookup failed', registrationError.code);
        return json({ valid: false, error: 'validation_failed' }, 500);
      }

      avatarRegistered = Boolean(registration);
      if (registration) {
        await db.from('license_avatars')
          .update({ last_validated_at: new Date().toISOString() })
          .eq('id', registration.id);
      }
    }

    const usedSlots = count ?? 0;
    const active = license.status === 'active';

    return json({
      valid: active,
      status: license.status,
      tier: Number(license.tier),
      maxAvatars: license.max_avatars,
      usedSlots,
      remainingSlots: Math.max(0, license.max_avatars - usedSlots),
      avatarRegistered,
      canRegisterAvatar: active && !avatarRegistered && usedSlots < license.max_avatars,
    });
  } catch (error) {
    console.error('validate-license unexpected error', error instanceof Error ? error.message : 'unknown');
    return json({ valid: false, error: 'bad_request' }, 400);
  }
});
