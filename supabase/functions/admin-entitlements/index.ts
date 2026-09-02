import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
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
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  return error ? null : data.user;
}

function optionalMoney(value: unknown) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('invalid_amount');
  return Math.round(number * 100) / 100;
}

function text(value: unknown, max = 250) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ready: true });
  if (!['GET', 'POST'].includes(req.method)) return json({ error: 'method_not_allowed' }, 405);

  try {
    const db = dbClient();
    const admin = await requireAdmin(req, db);
    if (!admin) return json({ error: 'unauthorized' }, 401);

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const ids = (url.searchParams.get('licenseIds') || '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(validUuid)
        .slice(0, 250);

      let query = db.from('license_capacity_events')
        .select('id,license_id,customer_id,event_type,delta_slots,previous_capacity,resulting_capacity,payment_source,gross_amount,fee_amount,net_amount,currency,external_transaction_id,purchase_id,owner_override,note,metadata,created_at')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (ids.length) query = query.in('license_id', ids);

      const { data, error } = await query;
      if (error) {
        console.error('admin-entitlements list failed', error.code, error.message);
        return json({ error: 'capacity_history_failed' }, 500);
      }
      return json({ events: data || [] });
    }

    const body = await req.json();
    if (body.action !== 'add_capacity') return json({ error: 'unsupported_action' }, 400);

    const slotsToAdd = Number(body.slotsToAdd);
    if (!Number.isInteger(slotsToAdd) || slotsToAdd <= 0 || slotsToAdd > 250) {
      return json({ error: 'invalid_slots' }, 400);
    }

    const ownerOverride = body.ownerOverride === true;
    const primaryUuid = validUuid(body.primaryUuid) ? String(body.primaryUuid).trim().toLowerCase() : null;
    const customerId = validUuid(body.customerId) ? String(body.customerId).trim().toLowerCase() : null;
    let licenseId = validUuid(body.licenseId) ? String(body.licenseId).trim().toLowerCase() : null;

    if (!licenseId) {
      const { data: entitlement, error } = await db.rpc('cc_find_active_entitlement', {
        target_customer_id: customerId,
        target_avatar_uuid: primaryUuid,
      });
      if (error) {
        console.error('admin-entitlements entitlement lookup failed', error.code, error.message);
        return json({ error: 'entitlement_lookup_failed' }, 500);
      }
      licenseId = entitlement || null;
    }

    // Fallback for UUID-less legacy/test records: allow a precise tier + key ending
    // lookup, but reject collisions rather than guessing.
    if (!licenseId && body.keyLast4) {
      const keyLast4 = String(body.keyLast4).trim().toUpperCase();
      const tier = Number(body.tier);
      if (!/^[A-Z0-9]{1,12}$/.test(keyLast4) || ![3, 5, 10].includes(tier)) {
        return json({ error: 'invalid_license_reference' }, 400);
      }
      const { data: matches, error } = await db.from('licenses')
        .select('id,status')
        .eq('key_last4', keyLast4)
        .eq('tier', String(tier))
        .eq('status', 'active')
        .limit(2);
      if (error) return json({ error: 'entitlement_lookup_failed' }, 500);
      if (!matches?.length) return json({ error: 'active_entitlement_not_found' }, 404);
      if (matches.length !== 1) return json({ error: 'ambiguous_license_reference' }, 409);
      licenseId = matches[0].id;
    }

    if (!licenseId) return json({ error: 'active_entitlement_not_found' }, 404);

    const gross = optionalMoney(body.grossAmount);
    const fee = optionalMoney(body.feeAmount);
    const suppliedNet = optionalMoney(body.netAmount);
    const net = suppliedNet ?? (gross != null && fee != null ? Math.round((gross - fee) * 100) / 100 : null);
    const recordType = text(body.recordType, 40) || 'upgrade';
    if (!['upgrade', 'gift', 'comp', 'manual_adjustment', 'purchase_capacity'].includes(recordType)) {
      return json({ error: 'invalid_record_type' }, 400);
    }

    const { data, error } = await db.rpc('cc_upgrade_license_capacity', {
      target_license_id: licenseId,
      slots_to_add: slotsToAdd,
      change_type: recordType,
      payment_source_value: text(body.paymentSource, 30),
      gross_amount_value: gross,
      fee_amount_value: fee,
      net_amount_value: net,
      currency_value: text(body.currency, 12),
      external_transaction_value: text(body.externalTransactionId, 200),
      purchase_id_value: text(body.purchaseId, 200),
      owner_override_value: ownerOverride,
      note_value: text(body.note, 1000),
      metadata_value: {
        admin_user_id: admin.id,
        admin_email: admin.email || null,
        source: 'back_office',
      },
    });

    if (error) {
      const message = `${error.message || ''} ${error.details || ''}`;
      if (message.includes('owner_override_required_above_25')) return json({ error: 'owner_override_required_above_25' }, 409);
      if (message.includes('license_not_active')) return json({ error: 'license_not_active' }, 409);
      if (message.includes('capacity_transaction_conflict')) return json({ error: 'capacity_transaction_conflict' }, 409);
      console.error('admin-entitlements upgrade failed', error.code, error.message);
      return json({ error: 'capacity_update_failed' }, 500);
    }

    return json({ updated: true, entitlement: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    if (message === 'invalid_amount') return json({ error: 'invalid_amount' }, 400);
    console.error('admin-entitlements unexpected error', message);
    return json({ error: 'bad_request' }, 400);
  }
});
