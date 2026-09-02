import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
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

async function requireAdmin(req: Request, db: ReturnType<typeof dbClient>) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!token) return false;
  const { data, error } = await db.auth.getUser(token);
  return !error && Boolean(data.user);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ready: true });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const db = dbClient();
    if (!(await requireAdmin(req, db))) return json({ error: 'unauthorized' }, 401);

    const body = await req.json();
    const tier = Number(body.tier);
    const keyLast4 = typeof body.keyLast4 === 'string' ? body.keyLast4.trim().toUpperCase() : '';
    const externalTransactionId = typeof body.externalTransactionId === 'string' ? body.externalTransactionId.trim() : '';
    const confirmation = typeof body.confirmation === 'string' ? body.confirmation.trim().toUpperCase() : '';

    if (![3, 5, 10].includes(tier) || !/^[A-Z0-9]{1,12}$/.test(keyLast4)) {
      return json({ error: 'invalid_license_reference' }, 400);
    }
    if (confirmation !== `DELETE ${keyLast4}`) return json({ error: 'confirmation_required' }, 400);

    let query = db.from('licenses')
      .select('id,key_last4,tier,payment_method,external_transaction_id')
      .eq('key_last4', keyLast4)
      .eq('tier', String(tier));

    if (externalTransactionId) query = query.eq('external_transaction_id', externalTransactionId);

    const { data: matches, error: lookupError } = await query.limit(2);
    if (lookupError) {
      console.error('admin-delete-license lookup failed', lookupError.code, lookupError.message);
      return json({ error: 'lookup_failed' }, 500);
    }
    if (!matches?.length) return json({ error: 'license_not_found' }, 404);
    if (matches.length !== 1) return json({ error: 'ambiguous_license_reference' }, 409);

    const license = matches[0];
    const { data: deleted, error: deleteError } = await db.rpc('admin_delete_license_record', {
      target_license_id: license.id,
    });
    if (deleteError) {
      console.error('admin-delete-license delete failed', deleteError.code, deleteError.message);
      return json({ error: 'delete_failed' }, 500);
    }

    return json({
      deleted: true,
      licenseId: license.id,
      ending: keyLast4,
      result: deleted,
    });
  } catch (error) {
    console.error('admin-delete-license unexpected error', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'bad_request' }, 400);
  }
});
