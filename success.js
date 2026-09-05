import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const SUPABASE_URL='https://oaoabjtzupmgldnryzuj.supabase.co';
const SUPABASE_KEY='sb_publishable_iRg3rRWNof20qgVfFJFP0g_Bge0bRxm';
const STATUS_URL=`${SUPABASE_URL}/functions/v1/commerce-status`;
const supabase=createClient(SUPABASE_URL,SUPABASE_KEY);
const orderId=new URLSearchParams(location.search).get('order');
const status=document.getElementById('status'), details=document.getElementById('details');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){
 const {data}=await supabase.auth.getSession(); const session=data.session;
 if(!session){status.textContent='Your sign-in expired. Return to checkout and sign in again.';return;}
 if(!orderId){status.textContent='Purchase reference is missing.';return;}
 for(let attempt=0;attempt<20;attempt++){
  const response=await fetch(STATUS_URL,{method:'POST',headers:{authorization:`Bearer ${session.access_token}`,'content-type':'application/json'},body:JSON.stringify({orderId})});
  const body=await response.json().catch(()=>({}));
  if(response.ok&&body.fulfilled){status.textContent='Payment confirmed and your Cache Compass entitlement is ready.';details.innerHTML=`<p><strong>Purchased capacity:</strong> ${body.purchasedSlots} avatars</p><p><strong>Current total capacity:</strong> ${body.currentCapacity} avatars</p>`;return;}
  if(!response.ok){status.textContent='We could not confirm the purchase yet. Please contact support if this persists.';return;}
  status.textContent='Payment received or still processing. Waiting for fulfillment…'; await sleep(1500);
 }
 status.textContent='Payment is taking longer than expected to confirm. Do not purchase again; contact support with your email if needed.';
}
run();
