import { cleanAvatarName, hashLicenseKey, json, preflight, serviceClient, validAvatarUuid } from '../_shared/license.ts';

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
