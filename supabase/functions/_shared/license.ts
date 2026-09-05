import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('server_configuration_error');
  return createClient(url, key, { auth: { persistSession: false } });
}

export function json(body: unknown, status = 200) {
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

export function preflight(req: Request) {
  if (req.method === 'OPTIONS') return json({}, 200);
  return null;
}

export function generateLicenseKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let raw = '';
  for (let i = 0; i < 16; i++) raw += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  return `CC-${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}`;
}

export function normalizeLicenseKey(value: string) {
  return value.trim().toUpperCase();
}

export async function hashLicenseKey(value: string) {
  const normalized = normalizeLicenseKey(value);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function validAvatarUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function tierSlots(tier: unknown) {
  if (tier === '3' || tier === 3) return 3;
  if (tier === '5' || tier === 5) return 5;
  if (tier === '10' || tier === 10) return 10;
  return null;
}

export function cleanAvatarName(value: unknown) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name ? name.slice(0, 100) : null;
}
