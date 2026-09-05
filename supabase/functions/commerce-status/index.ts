import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { checkRelease, CommerceError, safeMessage, uuid } from '../_shared/commerce-core.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type':'application/json',
    'cache-control':'no-store',
    'access-control-allow-origin':'*',
    'access-control-allow-headers':'authorization, content-type',
    'access-control-allow-methods':'POST, OPTIONS',
  },
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({});
  if (req.method !== 'POST') return json({ error:'method_not_allowed' },405);
  try {
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
    if (!token) throw new CommerceError('unauthorized',401);
    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
    const { data:user, error:authError } = await anon.auth.getUser(token);
    if (authError || !user.user) throw new CommerceError('unauthorized',401);

    const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth:{ persistSession:false } });
    const body = await req.json().catch(() => ({}));
    let query = service.from('commerce_orders')
      .select('id,kind,slots,state,license_id,purchase_id,created_at,paid_at')
      .eq('auth_user_id',user.user.id)
      .order('created_at',{ascending:false});
    if (body.orderId) query = query.eq('id',uuid(body.orderId));
    const { data:orders, error } = await query;
    if (error) throw new CommerceError('commerce_unavailable',503);

    const ids = [...new Set((orders || []).map(order => order.license_id).filter(Boolean))];
    const licensesResult = ids.length
      ? await service.from('licenses').select('id,tier,max_avatars,max_avatar_slots,status,created_at').in('id',ids)
      : { data:[], error:null };
    if (licensesResult.error) throw new CommerceError('commerce_unavailable',503);
    const licenses = licensesResult.data || [];
    if (!body.orderId) return json({ orders:orders || [], licenses });

    const order = orders?.[0] || null;
    const license = order?.license_id ? licenses.find((entry:any) => entry.id === order.license_id) || null : null;
    const fulfilled = Boolean(order && order.state === 'paid' && order.purchase_id && order.license_id && license && license.status === 'active');
    let download: { available:boolean; fileName?:string; url?:string; version?:string; sha256?:string } = { available:false };
    if (fulfilled) {
      try {
        const release = checkRelease(name => Deno.env.get(name));
        download = { available:true, fileName:'CacheCompass-Setup.exe', url:release.downloadUrl, version:release.version, sha256:release.sha256 };
      } catch (releaseError) {
        if (!(releaseError instanceof CommerceError) || releaseError.code !== 'download_not_ready') throw releaseError;
      }
    }
    return json({
      order,
      license,
      fulfilled,
      purchasedSlots: order?.slots ?? null,
      currentCapacity: license ? Number(license.max_avatar_slots ?? license.max_avatars ?? 0) : null,
      download,
    });
  } catch (error) {
    const result = safeMessage(error);
    return json({ error:result.error },result.status);
  }
});
