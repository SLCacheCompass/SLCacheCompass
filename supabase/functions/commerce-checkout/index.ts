import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { LAUNCH_PRICES, CommerceError, safeMessage, uuid, stripeConfiguration, email } from '../_shared/commerce-core.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type':'application/json', 'access-control-allow-origin':'*', 'access-control-allow-headers':'authorization, content-type', 'access-control-allow-methods':'POST, OPTIONS' }});
const db = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth:{ persistSession:false } });
const authUser = async (req: Request) => { const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,''); if(!token) throw new CommerceError('unauthorized',401); const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!); const {data,error}=await client.auth.getUser(token); if(error||!data.user) throw new CommerceError('unauthorized',401); return data.user; };

Deno.serve(async req => {
  if (req.method==='OPTIONS') return json({});
  if (req.method!=='POST') return json({error:'method_not_allowed'},405);
  try {
    const user=await authUser(req); const body=await req.json();
    if(body.kind&&body.kind!=='self') throw new CommerceError('unsupported_purchase_kind');
    const slots=Number(body.slots); if(![3,5,10].includes(slots)) throw new CommerceError('invalid_capacity');
    const requestId=uuid(body.requestId);
    const {mode,secret}=stripeConfiguration(name=>Deno.env.get(name));
    const purchaserEmail=email(user.email);
    if(!purchaserEmail||!user.email_confirmed_at) throw new CommerceError('verified_email_required',403);
    const siteUrl=Deno.env.get('COMMERCE_SITE_URL')||''; let site:URL;
    try { site=new URL(siteUrl); } catch { throw new CommerceError('commerce_not_configured',503); }
    if(site.protocol!=='https:'||site.username||site.password||site.search||site.hash) throw new CommerceError('commerce_not_configured',503);
    const priceId=Deno.env.get(`STRIPE_PRICE_${slots}_${mode.toUpperCase()}`); if(!priceId) throw new CommerceError('commerce_not_configured',503);
    const amount=LAUNCH_PRICES[slots]; const service=db();

    // Prevent payment before it happens when an existing account would exceed the normal
    // self-service ceiling. Suspended/revoked customers cannot bypass state with a new sale.
    const entitlement=await service.rpc('cc_find_entitlement_state_v2',{target_customer_id:null,target_avatar_uuid:null,target_email:purchaserEmail});
    if(entitlement.error) throw new CommerceError('checkout_unavailable',503);
    if(entitlement.data){
      const status=String(entitlement.data.status||'');
      const capacity=Number(entitlement.data.capacity||0);
      if(status!=='active') throw new CommerceError('existing_entitlement_not_active',409);
      if(!Number.isFinite(capacity)||capacity<=0) throw new CommerceError('checkout_unavailable',503);
      if(capacity+slots>30) throw new CommerceError('self_service_capacity_limit_30',409);
    }

    const existing=await service.from('commerce_orders').select('*').eq('auth_user_id',user.id).eq('request_id',requestId).maybeSingle();
    if(existing.error) throw new CommerceError('checkout_unavailable',503);
    if(existing.data&&(existing.data.slots!==slots||existing.data.environment!==mode||existing.data.kind!=='self')) throw new CommerceError('request_id_conflict',409);
    if(existing.data?.stripe_session_id){
      const restored=await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(existing.data.stripe_session_id)}`,{headers:{authorization:`Bearer ${secret}`}});
      const session=await restored.json();
      if(restored.ok&&session.url) return json({orderId:existing.data.id,state:existing.data.state,url:session.url});
      throw new CommerceError('checkout_unavailable',503);
    }

    let order=existing.data;
    if(!order){
      const inserted=await service.from('commerce_orders').insert({auth_user_id:user.id,purchaser_email:purchaserEmail,request_id:requestId,kind:'self',slots,expected_amount:amount,stripe_price_id:priceId,environment:mode}).select('*').single();
      if(inserted.error?.code==='23505') order=(await service.from('commerce_orders').select('*').eq('auth_user_id',user.id).eq('request_id',requestId).single()).data;
      else order=inserted.data;
    }
    if(!order) throw new CommerceError('checkout_unavailable',503);
    if(order.slots!==slots||order.environment!==mode||order.kind!=='self') throw new CommerceError('request_id_conflict',409);

    const form=new URLSearchParams({mode:'payment',success_url:`${site.origin}/success.html?order=${order.id}`,cancel_url:`${site.origin}/checkout.html`,client_reference_id:order.id,'line_items[0][price]':order.stripe_price_id,'line_items[0][quantity]':'1','metadata[order_id]':order.id,'metadata[slots]':String(slots),'customer_creation':'always','customer_email':order.purchaser_email});
    const response=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/x-www-form-urlencoded','idempotency-key':`cc-checkout-${order.id}`},body:form});
    const session=await response.json(); if(!response.ok||!session.id||!session.url) throw new CommerceError('checkout_unavailable',503);
    const saved=await service.from('commerce_orders').update({stripe_session_id:session.id,state:'checkout_created',updated_at:new Date().toISOString()}).eq('id',order.id).in('state',['pending','checkout_created']);
    if(saved.error) throw new CommerceError('checkout_unavailable',503);
    return json({orderId:order.id,state:'checkout_created',url:session.url});
  } catch(e){ const x=safeMessage(e); return json({error:x.error},x.status); }
});
