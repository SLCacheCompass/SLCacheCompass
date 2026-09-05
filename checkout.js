import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const SUPABASE_URL='https://oaoabjtzupmgldnryzuj.supabase.co';
const SUPABASE_KEY='sb_publishable_iRg3rRWNof20qgVfFJFP0g_Bge0bRxm';
const CHECKOUT_URL=`${SUPABASE_URL}/functions/v1/commerce-checkout`;
const LEGAL_BUNDLE_VERSION='2026-09-04';
const supabase=createClient(SUPABASE_URL,SUPABASE_KEY);
const $=id=>document.getElementById(id);
const status=$('session-status'), checkoutStatus=$('checkout-status'), buy=$('buy'), legal=$('legal');
const params=new URLSearchParams(location.search); if(params.get('slots')) $('slots').value=params.get('slots');

async function refresh(){
  const {data}=await supabase.auth.getSession();
  const session=data.session;
  if(session){ $('email').value=session.user.email||''; status.textContent=`Signed in as ${session.user.email}`; $('signin').textContent='Signed in'; $('signin').disabled=true; }
  else status.textContent='Sign in with your verified email before checkout.';
  buy.disabled=!(session&&legal.checked);
  return session;
}
legal.addEventListener('change',refresh);
$('signin').addEventListener('click',async()=>{
  const email=$('email').value.trim(); if(!email){status.textContent='Enter your email first.';return;}
  const redirectTo=new URL('checkout.html',location.href); redirectTo.searchParams.set('slots',$('slots').value);
  const {error}=await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:redirectTo.toString()}});
  status.textContent=error?`Could not send sign-in link: ${error.message}`:'Check your email for the secure sign-in link.';
});
$('buy').addEventListener('click',async()=>{
  checkoutStatus.textContent='Opening secure checkout…'; const session=await refresh();
  if(!session||!legal.checked){checkoutStatus.textContent='Sign in and accept the policies first.';return;}
  const requestId=crypto.randomUUID();
  const response=await fetch(CHECKOUT_URL,{method:'POST',headers:{authorization:`Bearer ${session.access_token}`,'content-type':'application/json'},body:JSON.stringify({kind:'self',slots:Number($('slots').value),requestId,legalAccepted:true,legalBundleVersion:LEGAL_BUNDLE_VERSION})});
  const body=await response.json().catch(()=>({}));
  if(!response.ok){checkoutStatus.textContent=human(body.error);return;}
  if(!body.url){checkoutStatus.textContent='Checkout did not return a secure payment page.';return;}
  location.assign(body.url);
});
function human(code){return({legal_acceptance_required:'Please accept the Terms, Privacy Policy, and Refund Policy.',self_service_capacity_limit_30:'This purchase would exceed the 30-avatar self-service limit. Contact support.',existing_entitlement_not_active:'Your existing license needs owner review before another purchase.',verified_email_required:'Please use a verified email address.',unauthorized:'Your sign-in expired. Please sign in again.'})[code]||'Checkout is temporarily unavailable. Please try again.';}
await refresh();
