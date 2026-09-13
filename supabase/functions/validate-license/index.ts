import { hashLicenseKey, json, preflight, serviceClient, validAvatarUuid } from '../_shared/license.ts';

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
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
