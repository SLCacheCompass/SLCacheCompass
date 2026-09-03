import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const NORMAL_MAX = 30;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-cache-compass-kiosk-secret',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  }});
}

function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('server_configuration_error');
  return createClient(url, key, { auth: { persistSession: false } });
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function cleanName(value: unknown) { if (typeof value !== 'string') return null; const n=value.trim(); return n ? n.slice(0,100) : null; }
function tierSlots(value: unknown) { if (value===3||value==='3') return 3; if(value===5||value==='5') return 5; if(value===10||value==='10') return 10; return null; }
function requiredPositiveInteger(name:string){ const v=Number(Deno.env.get(name)); if(!Number.isInteger(v)||v<=0) throw new Error(`missing_${name.toLowerCase()}`); return v; }
function prices(){ return {3:requiredPositiveInteger('KIOSK_PRICE_3_LD'),5:requiredPositiveInteger('KIOSK_PRICE_5_LD'),10:requiredPositiveInteger('KIOSK_PRICE_10_LD')} as const; }

async function sha256(value:string){ const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value.trim().toUpperCase())); return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,'0')).join(''); }
async function deterministicLicenseKey(secret:string,purchaseId:string,payerUuid:string,tier:number){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signed=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${purchaseId}|${payerUuid.toLowerCase()}|${tier}`));
  const bytes=new Uint8Array(signed); let raw=''; for(let i=0;i<16;i++) raw+=KEY_ALPHABET[bytes[i]%KEY_ALPHABET.length];
  return `CC-${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}`;
}

function authenticateKiosk(req:Request){
  const expectedSecret=Deno.env.get('KIOSK_SHARED_SECRET'); const supplied=req.headers.get('x-cache-compass-kiosk-secret');
  const expectedOwner=Deno.env.get('KIOSK_OWNER_UUID')?.trim().toLowerCase();
  const ownerKey=req.headers.get('x-secondlife-owner-key')?.trim().toLowerCase()??'';
  const shard=req.headers.get('x-secondlife-shard')?.trim()??'';
  const objectKey=req.headers.get('x-secondlife-object-key')?.trim().toLowerCase()??'';
  const region=req.headers.get('x-secondlife-region')?.trim()??''; const ua=req.headers.get('user-agent')??'';
  if(!expectedSecret||!expectedOwner) return {ok:false as const,status:500,error:'server_configuration_error'};
  if(!supplied||supplied!==expectedSecret) return {ok:false as const,status:401,error:'unauthorized'};
  if(!validUuid(expectedOwner)||ownerKey!==expectedOwner) return {ok:false as const,status:403,error:'unauthorized_owner'};
  if(shard!=='Production') return {ok:false as const,status:403,error:'production_grid_required'};
  if(!validUuid(objectKey)) return {ok:false as const,status:403,error:'invalid_kiosk_object'};
  if(!ua.startsWith('Second Life LSL/')) return {ok:false as const,status:403,error:'lsl_request_required'};
  return {ok:true as const,ownerKey,objectKey,region,shard};
}

async function getOrCreateCustomer(db:any,payerUuid:string,payerName:string|null){
  const existing=await db.from('customers').select('id,primary_avatar_uuid,primary_avatar_name,status').eq('primary_avatar_uuid',payerUuid).order('created_at',{ascending:true}).limit(1).maybeSingle();
  if(existing.error) throw existing.error; if(existing.data) return existing.data;
  const created=await db.from('customers').insert({primary_avatar_uuid:payerUuid,primary_avatar_name:payerName,preferred_contact_method:'second_life',marketing_consent:false,status:'active'}).select('id,primary_avatar_uuid,primary_avatar_name,status').single();
  if(created.error) throw created.error; return created.data;
}

async function ensureSlotOne(db:any,licenseId:string,payerUuid:string,payerName:string|null){
  const current=await db.from('license_avatar_assignments').select('id,avatar_uuid,status').eq('license_id',licenseId).eq('slot_number',1).maybeSingle();
  if(current.error) throw current.error;
  if(current.data){ if(String(current.data.avatar_uuid).toLowerCase()!==payerUuid) throw new Error('slot_one_conflict'); return; }
  const name=payerName||'Second Life Avatar';
  const added=await db.from('license_avatar_assignments').insert({license_id:licenseId,slot_number:1,avatar_uuid:payerUuid,avatar_name_at_registration:name,current_avatar_name:payerName,status:'active'});
  if(added.error) throw added.error;
  const compat=await db.from('license_avatars').insert({license_id:licenseId,avatar_uuid:payerUuid,avatar_name:payerName,last_validated_at:new Date().toISOString()});
  if(compat.error && compat.error.code!=='23505') console.warn('compat avatar insert skipped',compat.error.code);
}

async function activeSlotCount(db:any,licenseId:string){ const q=await db.from('license_avatar_assignments').select('id',{count:'exact',head:true}).eq('license_id',licenseId).eq('status','active'); return q.error?0:(q.count??0); }

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return json({}); if(!['GET','POST'].includes(req.method)) return json({error:'method_not_allowed'},405);
  try{
    const kiosk=authenticateKiosk(req); if(!kiosk.ok) return json({error:kiosk.error},kiosk.status);
    const kioskPrices=prices();
    if(req.method==='GET') return json({ready:true,currency:'L$',normalMaxAvatars:NORMAL_MAX,tiers:[{tier:3,price:kioskPrices[3]},{tier:5,price:kioskPrices[5]},{tier:10,price:kioskPrices[10]}]});
    const body=await req.json(); const tier=tierSlots(body.tier); const payerUuid=typeof body.payerUuid==='string'?body.payerUuid.trim().toLowerCase():''; const payerName=cleanName(body.payerName); const nonce=typeof body.nonce==='string'?body.nonce.trim().toLowerCase():''; const amount=Number(body.amount);
    if(!tier) return json({error:'invalid_tier'},400); if(!validUuid(payerUuid)) return json({error:'invalid_payer_uuid'},400); if(!validUuid(nonce)) return json({error:'invalid_purchase_nonce'},400); if(!Number.isInteger(amount)||amount<=0) return json({error:'invalid_amount'},400); if(amount!==kioskPrices[tier]) return json({error:'incorrect_amount',expected:kioskPrices[tier]},409);
    const issuerSecret=Deno.env.get('LICENSE_ISSUER_SECRET'); if(!issuerSecret) return json({error:'server_configuration_error'},500);
    const purchaseToken=`linden-kiosk:${kiosk.objectKey}:${nonce}`; const db=serviceClient();

    // Same nonce/payment retry: return the already-recorded result and never add capacity twice.
    const priorPurchase=await db.from('purchases').select('id,customer_id,license_id,license_tier,status,metadata').eq('external_order_id',purchaseToken).maybeSingle();
    if(priorPurchase.error) throw priorPurchase.error;
    if(priorPurchase.data){
      const p=priorPurchase.data; if(Number(p.license_tier)!==tier) return json({error:'purchase_id_conflict'},409);
      const event=await db.from('license_capacity_events').select('license_id,resulting_capacity,delta_slots').eq('external_transaction_id',purchaseToken).maybeSingle();
      const hold=await db.from('license_capacity_override_requests').select('license_id,current_capacity,requested_capacity,status').eq('external_transaction_id',purchaseToken).maybeSingle();
      if(event.data){ const used=await activeSlotCount(db,event.data.license_id); return json({purchased:true,reused:true,capacityAdded:true,tier,licenseId:event.data.license_id,maxAvatars:event.data.resulting_capacity,usedSlots:used,remainingSlots:Math.max(0,event.data.resulting_capacity-used)}); }
      if(hold.data){ return json({purchased:true,reused:true,capacityAdded:false,pendingOwnerReview:hold.data.status==='pending',tier,licenseId:hold.data.license_id,maxAvatars:hold.data.current_capacity,requestedCapacity:hold.data.requested_capacity}); }
      if(p.license_id){ const lic=await db.from('licenses').select('id,max_avatar_slots,max_avatars').eq('id',p.license_id).single(); if(lic.data){ const cap=Number(lic.data.max_avatar_slots??lic.data.max_avatars??tier); const used=await activeSlotCount(db,lic.data.id); return json({purchased:true,reused:true,capacityAdded:false,tier,licenseId:lic.data.id,maxAvatars:cap,usedSlots:used,remainingSlots:Math.max(0,cap-used)}); } }
      return json({error:'purchase_recovery_failed'},500);
    }

    const customer=await getOrCreateCustomer(db,payerUuid,payerName);
    const stateRpc=await db.rpc('cc_find_entitlement_state_v2',{target_customer_id:customer.id,target_avatar_uuid:payerUuid,target_email:null}); if(stateRpc.error) throw stateRpc.error;
    const state=stateRpc.data as any;

    const purchaseInsert=await db.from('purchases').insert({customer_id:customer.id,channel:'linden_kiosk',external_order_id:purchaseToken,processor:'linden_lab',processor_transaction_id:purchaseToken,amount,currency:'L$',license_tier:tier,purchase_kind:'self',environment:'live',purchaser_avatar_uuid:payerUuid,purchaser_avatar_name:payerName,status:'paid',paid_at:new Date().toISOString(),metadata:{kiosk_object_uuid:kiosk.objectKey,kiosk_owner_uuid:kiosk.ownerKey,region:kiosk.region,purchase_nonce:nonce}}).select('id').single();
    if(purchaseInsert.error){ if(purchaseInsert.error.code==='23505') return json({error:'retry_required'},409); throw purchaseInsert.error; }
    const purchaseRowId=purchaseInsert.data.id;

    if(state?.licenseId){
      const licenseId=String(state.licenseId); const currentCapacity=Number(state.capacity??0);
      const applied=await db.rpc('cc_apply_capacity_purchase',{target_license_id:licenseId,slots_to_add:tier,change_type:'linden_purchase_add',payment_source_value:'linden',gross_amount_value:amount,fee_amount_value:0,net_amount_value:amount,currency_value:'L$',external_transaction_value:purchaseToken,purchase_id_value:purchaseRowId,note_value:null,metadata_value:{kiosk_object_uuid:kiosk.objectKey,payer_avatar_uuid:payerUuid}});
      if(applied.error) throw applied.error;
      await db.from('purchases').update({license_id:licenseId}).eq('id',purchaseRowId);
      const r=applied.data as any;
      if(r.pendingOwnerReview){ return json({purchased:true,reused:false,capacityAdded:false,pendingOwnerReview:true,tier,licenseId,maxAvatars:currentCapacity,requestedCapacity:Number(r.requestedCapacity??currentCapacity+tier),normalMaxAvatars:NORMAL_MAX},202); }
      const cap=Number(r.capacity??currentCapacity+tier); const used=await activeSlotCount(db,licenseId);
      return json({purchased:true,reused:false,capacityAdded:true,tier,licenseId,maxAvatars:cap,usedSlots:used,remainingSlots:Math.max(0,cap-used),normalMaxAvatars:NORMAL_MAX},200);
    }

    const licenseKey=await deterministicLicenseKey(issuerSecret,purchaseToken,payerUuid,tier); const keyHash=await sha256(licenseKey); const keyLast4=licenseKey.slice(-4); const keyPrefix=licenseKey.slice(0,7); const now=new Date().toISOString();
    const created=await db.from('licenses').insert({customer_id:customer.id,purchase_id:purchaseRowId,license_key_hash:keyHash,license_key_prefix:keyPrefix,key_hash:keyHash,key_last4:keyLast4,tier,max_avatar_slots:tier,max_avatars:tier,status:'active',issued_at:now,activated_at:now,purchaser_avatar_uuid:payerUuid,payment_method:'linden',payment_amount:amount,payment_currency:'L$',external_transaction_id:purchaseToken}).select('id,max_avatar_slots,issued_at').single();
    if(created.error) throw created.error;
    await ensureSlotOne(db,created.data.id,payerUuid,payerName);
    await db.from('purchases').update({license_id:created.data.id}).eq('id',purchaseRowId);
    await db.from('license_events').insert({license_id:created.data.id,event_type:'issued_linden',avatar_uuid:payerUuid,metadata:{tier,amount,currency:'L$',purchase_id:purchaseRowId,external_transaction_id:purchaseToken,kiosk_object_uuid:kiosk.objectKey}});
    const used=await activeSlotCount(db,created.data.id);
    return json({purchased:true,reused:false,capacityAdded:false,licenseKey,tier,licenseId:created.data.id,maxAvatars:tier,usedSlots:used,remainingSlots:Math.max(0,tier-used),normalMaxAvatars:NORMAL_MAX,createdAt:created.data.issued_at},201);
  }catch(error){ console.error('linden-purchase unexpected error',error instanceof Error?error.message:'unknown'); return json({error:'purchase_failed'},500); }
});