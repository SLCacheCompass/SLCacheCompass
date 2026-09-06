import { cleanAvatarName, json, preflight, serviceClient, validAvatarUuid } from '../_shared/license.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64url(bytes: Uint8Array) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromB64url(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function signingKey() {
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!service) throw new Error('server_configuration_error');
  const material = await crypto.subtle.digest('SHA-256', encoder.encode(`cache-compass-auto-license-v1:${service}`));
  return crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function makeToken(licenseId: string, deviceId: string) {
  const payload = b64url(encoder.encode(JSON.stringify({ v: 1, licenseId, deviceId })));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(), encoder.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

async function readToken(token: unknown, deviceId: string) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const ok = await crypto.subtle.verify('HMAC', await signingKey(), fromB64url(parts[1]), encoder.encode(parts[0]));
  if (!ok) return null;
  const parsed = JSON.parse(decoder.decode(fromB64url(parts[0])));
  if (parsed?.v !== 1 || typeof parsed.licenseId !== 'string' || parsed.deviceId !== deviceId) return null;
  return parsed.licenseId as string;
}

function validDeviceId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

async function licenseState(db: ReturnType<typeof serviceClient>, licenseId: string) {
  const { data, error } = await db.from('licenses').select('id,status,max_avatars,tier').eq('id', licenseId).maybeSingle();
  if (error) throw error;
  return data;
}

async function slotState(db: ReturnType<typeof serviceClient>, licenseId: string, avatarUuid: string) {
  const { data: existing, error: existingError } = await db.from('license_avatars').select('id').eq('license_id', licenseId).eq('avatar_uuid', avatarUuid).maybeSingle();
  if (existingError) throw existingError;
  const { count, error: countError } = await db.from('license_avatars').select('id', { count: 'exact', head: true }).eq('license_id', licenseId);
  if (countError) throw countError;
  return { existing: Boolean(existing), used: count ?? 0 };
}

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const body = await req.json();
    const action = body.action;
    const avatarUuid = body.avatarUuid;
    const deviceId = body.deviceId;
    if (!validAvatarUuid(avatarUuid)) return json({ error: 'invalid_avatar_uuid' }, 400);
    if (!validDeviceId(deviceId)) return json({ error: 'invalid_device_id' }, 400);

    const db = serviceClient();
    let licenseId: string | null = null;

    if (action === 'bootstrap') {
      const { data, error } = await db.rpc('cc_find_entitlement_state_v2', {
        target_customer_id: null,
        target_avatar_uuid: avatarUuid,
        target_email: null,
      });
      if (error) throw error;
      if (!data?.licenseId) return json({ error: 'license_not_found' }, 404);
      if (data.status !== 'active') return json({ error: 'license_not_active', status: data.status }, 403);
      licenseId = data.licenseId;
    } else if (action === 'validate') {
      licenseId = await readToken(body.token, deviceId);
      if (!licenseId) return json({ error: 'invalid_device_token' }, 401);
    } else {
      return json({ error: 'invalid_action' }, 400);
    }

    const license = await licenseState(db, licenseId);
    if (!license) return json({ error: 'license_not_found' }, 404);
    if (license.status !== 'active') return json({ error: 'license_not_active', status: license.status }, 403);

    const before = await slotState(db, licenseId, avatarUuid);
    let alreadyRegistered = before.existing;
    if (!alreadyRegistered) {
      const { error: insertError } = await db.from('license_avatars').insert({
        license_id: licenseId,
        avatar_uuid: avatarUuid,
        avatar_name: cleanAvatarName(body.avatarName),
        last_validated_at: new Date().toISOString(),
      });
      if (insertError) {
        const detail = `${insertError.message ?? ''} ${insertError.details ?? ''}`;
        if (detail.includes('avatar_limit_reached')) return json({ error: 'avatar_limit_reached' }, 409);
        if (detail.includes('license_not_active')) return json({ error: 'license_not_active' }, 403);
        if (insertError.code !== '23505') throw insertError;
        alreadyRegistered = true;
      } else {
        await db.from('license_events').insert({
          license_id: licenseId,
          event_type: 'avatar_registered',
          avatar_uuid: avatarUuid,
          metadata: { source: 'automatic_license' },
        });
      }
    }

    const after = await slotState(db, licenseId, avatarUuid);
    const maxAvatars = Number(license.max_avatars ?? license.tier ?? 0);
    const token = action === 'bootstrap' ? await makeToken(licenseId, deviceId) : undefined;
    return json({
      allowed: true,
      token,
      avatarRegistered: true,
      alreadyRegistered,
      maxAvatars,
      remainingSlots: Math.max(0, maxAvatars - after.used),
    });
  } catch (error) {
    console.error('automatic-license unexpected error', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'automatic_license_failed' }, 500);
  }
});
