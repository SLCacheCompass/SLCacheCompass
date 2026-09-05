const endpoint='https://glamoujtjfczrpkrpbmp.supabase.co/functions/v1/customer-download';
const key=document.querySelector('#license-key');
const button=document.querySelector('#download');
const message=document.querySelector('#message');
const meta=document.querySelector('#meta');
button.addEventListener('click',async()=>{
  const licenseKey=key.value.trim();
  if(!licenseKey){message.textContent='Enter your Cache Compass license key first.';return;}
  button.disabled=true; message.textContent='Preparing your private download…'; meta.textContent='';
  try{
    const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({licenseKey})});
    const body=await response.json().catch(()=>({}));
    if(!response.ok){message.textContent=human(body.error,body.status);return;}
    message.textContent=`Cache Compass ${body.version} is ready. The private link expires in 10 minutes.`;
    meta.textContent=`SHA-256: ${body.sha256}`;
    const link=document.createElement('a');
    link.className='button button-primary'; link.href=body.url; link.textContent='Download CacheCompass-Setup.exe';
    link.rel='noopener'; meta.append(document.createElement('br'),document.createElement('br'),link);
  }catch{message.textContent='The download service could not be reached. Please try again.';}
  finally{button.disabled=false;}
});
function human(code,status){return({license_key_required:'Enter your Cache Compass license key first.',invalid_license:'That license key was not recognized.',license_not_active:status==='suspended'?'This license is suspended. Contact support@slcachecompass.com.':'This license is not active. Contact support@slcachecompass.com.',release_not_available:'The current Cache Compass installer has not been published yet.'})[code]||'The download could not be prepared. Please contact support@slcachecompass.com if this continues.';}
