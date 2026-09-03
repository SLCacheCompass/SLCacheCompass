export type Mode = 'test' | 'live';
export const LAUNCH_PRICES: Record<number, number> = { 3: 2499, 5: 3499, 10: 6499 };
export const REGULAR_PRICES: Record<number, number> = { 3: 2999, 5: 3999, 10: 6999 };
export class CommerceError extends Error { constructor(public code: string, public status = 400) { super(code); } }
export function uuid(v: unknown): string { if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) throw new CommerceError('invalid_id'); return v.toLowerCase(); }
export function slots(v: unknown): number { if (typeof v !== 'number' || ![3, 5, 10].includes(v)) throw new CommerceError('invalid_capacity'); return v; }
export function opaque(v: unknown): string { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(v)) throw new CommerceError('invalid_token'); return v; }
export function email(v: unknown): string | null { if (v == null || v === '') return null; if (typeof v !== 'string' || v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new CommerceError('invalid_email'); return v.trim().toLowerCase(); }
export async function sha256(v: string): Promise<string> { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))); }
function hex(v: Uint8Array): string { return Array.from(v, b => b.toString(16).padStart(2, '0')).join(''); }
export function randomToken(): string { return hex(crypto.getRandomValues(new Uint8Array(32))); }
export async function derive(secret: string, purpose: string, id: string): Promise<string> { if (secret.length < 32) throw new CommerceError('server_configuration_error', 503); const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`cachecompass:v1:${purpose}:${id}`)))); }
export async function credential(secret: string, orderId: string): Promise<string> { return `CC-${(await derive(secret, 'license', uuid(orderId))).toUpperCase()}`; }
export function safeMessage(error: unknown): { error: string; status: number } { if (error instanceof CommerceError) return { error: error.code, status: error.status }; return { error: 'commerce_unavailable', status: 503 }; }
export function stripeConfiguration(get: (name: string) => string | undefined) { const mode = get('STRIPE_MODE'); const secret = get('STRIPE_SECRET_KEY') || ''; if ((mode !== 'test' && mode !== 'live') || !secret.startsWith(`sk_${mode}_`) && !secret.startsWith(`rk_${mode}_`)) throw new CommerceError('commerce_not_configured', 503); return { mode: mode as Mode, secret }; }
