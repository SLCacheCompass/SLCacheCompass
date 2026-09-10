import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, x-cache-compass-kiosk-secret',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function dbClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('server_configuration_error');
  return createClient(url, key, { auth: { persistSession: false } });
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

function cleanName(value: unknown) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name ? name.slice(0, 100) : null;
}

function uniqueUuids(values: unknown[]) {
  return [...new Set(values
    .filter(validUuid)
    .map((value) => String(value).trim().toLowerCase()))].slice(0, 100);
}

async function requireAdmin(req: Request, db: ReturnType<typeof dbClient>) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!token) return false;
  const { data, error } = await db.auth.getUser(token);
  return !error && Boolean(data.user);
}

function authenticateWorker(req: Request) {
  const expectedSecret = Deno.env.get('KIOSK_SHARED_SECRET');
  const expectedOwner = Deno.env.get('KIOSK_OWNER_UUID')?.trim().toLowerCase();
  const suppliedSecret = req.headers.get('x-cache-compass-kiosk-secret');
  const ownerKey = req.headers.get('x-secondlife-owner-key')?.trim().toLowerCase() || '';
  const objectKey = req.headers.get('x-secondlife-object-key')?.trim().toLowerCase() || '';
  const shard = req.headers.get('x-secondlife-shard')?.trim() || '';

  if (!expectedSecret || !expectedOwner) return false;
  if (!suppliedSecret || suppliedSecret !== expectedSecret) return false;
  if (!validUuid(expectedOwner) || ownerKey !== expectedOwner) return false;
  if (!validUuid(objectKey) || shard !== 'Production') return false;
  return true;
}

async function queueMissing(db: ReturnType<typeof dbClient>, uuids: string[]) {
  if (!uuids.length) return;
  const staleBefore = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: fresh } = await db.from('avatar_name_cache')
    .select('avatar_uuid')
    .in('avatar_uuid', uuids)
    .gte('resolved_at', staleBefore);
  const freshSet = new Set((fresh || []).map((row: any) => String(row.avatar_uuid).toLowerCase()));
  const missing = uuids.filter((uuid) => !freshSet.has(uuid));
  if (!missing.length) return;

  const now = new Date().toISOString();
  const rows = missing.map((avatar_uuid) => ({ avatar_uuid, status: 'pending', requested_at: now, claimed_at: null, completed_at: null }));
  const { error } = await db.from('avatar_name_requests').upsert(rows, { onConflict: 'avatar_uuid' });
  if (error) console.error('avatar-name-resolver queue failed', error.code, error.message);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({});
  if (!['GET', 'POST'].includes(req.method)) return json({ error: 'method_not_allowed' }, 405);

  const db = dbClient();
  const url = new URL(req.url);
  const workerMode = url.searchParams.get('worker');

  try {
    if (workerMode) {
      if (!authenticateWorker(req)) return json({ error: 'unauthorized_worker' }, 403);

      if (req.method === 'GET' && workerMode === 'next') {
        const staleClaim = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        const { data, error } = await db.from('avatar_name_requests')
          .select('avatar_uuid,status,claimed_at,attempts,requested_at')
          .or(`status.eq.pending,and(status.eq.claimed,claimed_at.lt.${staleClaim})`)
          .order('requested_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (error) {
          console.error('avatar-name-resolver next failed', error.code, error.message);
          return json({ error: 'queue_read_failed' }, 500);
        }
        if (!data) return json({ pending: false });

        const now = new Date().toISOString();
        const { error: claimError } = await db.from('avatar_name_requests').update({
          status: 'claimed',
          claimed_at: now,
          attempts: Number(data.attempts || 0) + 1,
        }).eq('avatar_uuid', data.avatar_uuid);
        if (claimError) return json({ error: 'queue_claim_failed' }, 500);
        return json({ pending: true, avatarUuid: data.avatar_uuid });
      }

      if (req.method === 'POST' && workerMode === 'result') {
        const body = await req.json();
        const avatarUuid = typeof body.avatarUuid === 'string' ? body.avatarUuid.trim().toLowerCase() : '';
        if (!validUuid(avatarUuid)) return json({ error: 'invalid_avatar_uuid' }, 400);
        const legacyName = cleanName(body.legacyName);
        const displayName = cleanName(body.displayName);
        if (!legacyName && !displayName) {
          await db.from('avatar_name_requests').update({ status: 'pending', claimed_at: null }).eq('avatar_uuid', avatarUuid);
          return json({ accepted: false, retry: true });
        }

        const now = new Date().toISOString();
        const { error: cacheError } = await db.from('avatar_name_cache').upsert({
          avatar_uuid: avatarUuid,
          legacy_name: legacyName,
          display_name: displayName,
          resolved_at: now,
          updated_at: now,
        }, { onConflict: 'avatar_uuid' });
        if (cacheError) {
          console.error('avatar-name-resolver cache write failed', cacheError.code, cacheError.message);
          return json({ error: 'cache_write_failed' }, 500);
        }
        await db.from('avatar_name_requests').update({ status: 'complete', completed_at: now }).eq('avatar_uuid', avatarUuid);
        return json({ accepted: true });
      }

      return json({ error: 'invalid_worker_request' }, 400);
    }

    if (!(await requireAdmin(req, db))) return json({ error: 'unauthorized' }, 401);

    let uuids: string[] = [];
    if (req.method === 'GET') {
      uuids = uniqueUuids((url.searchParams.get('ids') || '').split(','));
    } else {
      const body = await req.json();
      uuids = uniqueUuids(Array.isArray(body.uuids) ? body.uuids : []);
    }
    if (!uuids.length) return json({ names: [] });

    await queueMissing(db, uuids);
    const { data, error } = await db.from('avatar_name_cache')
      .select('avatar_uuid,legacy_name,display_name,resolved_at')
      .in('avatar_uuid', uuids);
    if (error) return json({ error: 'cache_read_failed' }, 500);

    return json({ names: data || [] });
  } catch (error) {
    console.error('avatar-name-resolver unexpected error', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'bad_request' }, 400);
  }
});
