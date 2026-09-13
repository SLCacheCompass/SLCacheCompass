import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.CACHE_COMPASS_ADMIN_CONFIG;
const drawer = document.querySelector('#customer-drawer');
const actions = drawer?.querySelector('.drawer-actions');

if (config && drawer && actions) {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { detectSessionInUrl: false } });
  const endpoint = `${config.supabaseUrl}/functions/v1/admin-rebuild-license`;

  const style = document.createElement('style');
  style.textContent = `
    .rebuild-backdrop{position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.72);display:grid;place-items:center;padding:18px}
    .rebuild-backdrop[hidden]{display:none}
    .rebuild-card{width:min(720px,96vw);max-height:90vh;overflow:auto;background:#0a1011;border:1px solid rgba(226,189,118,.46);border-radius:16px;padding:24px;box-shadow:0 28px 90px rgba(0,0,0,.6)}
    .rebuild-card h2{margin:3px 0 7px;color:#f2efe6}.rebuild-card .muted{color:#98a39e;font-size:12px;line-height:1.55}
    .rebuild-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px}.rebuild-grid .full{grid-column:1/-1}
    .rebuild-grid label{display:flex;flex-direction:column;gap:5px;color:#cfd5d1;font-size:11px;font-weight:700;letter-spacing:.03em}
    .rebuild-grid input,.rebuild-grid select,.rebuild-grid textarea{box-sizing:border-box;width:100%;padding:10px 11px;background:#050b0c;color:#f2efe6;border:1px solid #35474b;border-radius:8px;font:inherit}.rebuild-grid textarea{min-height:72px;resize:vertical}
    .rebuild-warning{margin:14px 0;padding:11px 12px;border:1px solid rgba(226,189,118,.28);border-radius:9px;background:rgba(226,189,118,.055);color:#d8cfbc;font-size:12px;line-height:1.5}
    .rebuild-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.rebuild-result{margin-top:15px;padding:13px;border:1px solid rgba(102,212,206,.3);border-radius:9px;background:rgba(102,212,206,.05);word-break:break-word}.rebuild-result code{color:#f2efe6;font-size:15px}
    @media(max-width:620px){.rebuild-grid{grid-template-columns:1fr}.rebuild-grid .full{grid-column:auto}.rebuild-actions{justify-content:flex-start;flex-wrap:wrap}}
  `;
  document.head.appendChild(style);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button gold';
  button.textContent = 'Rebuild / Reissue';
  button.title = 'Replace an operational license while preserving the original protected purchase record.';
  actions.insertBefore(button, actions.querySelector('#drawer-purge-customer') || null);

  const modal = document.createElement('div');
  modal.className = 'rebuild-backdrop';
  modal.hidden = true;
  modal.innerHTML = `
    <section class="rebuild-card" role="dialog" aria-modal="true" aria-labelledby="rebuild-title">
      <p class="eyebrow">LICENSE REBUILD</p>
      <h2 id="rebuild-title">Rebuild & reissue license</h2>
      <p class="muted">Use this when a customer/license record needs to be rebuilt from an existing purchase. The old operational license is removed, protected Stripe/tax/legal evidence is retained, and a fresh license key is issued against the same purchase.</p>
      <div class="rebuild-warning">This invalidates the old license key. The replacement key is shown only once after the rebuild.</div>
      <form id="rebuild-form">
        <div class="rebuild-grid">
          <label class="full">Existing purchase<select name="purchaseId" required></select></label>
          <label class="full">License to replace<select name="oldLicenseId" required></select></label>
          <label>Purchase source<select name="channel" required><option value="website_usd">Website USD</option><option value="second_life_marketplace">Second Life Marketplace</option><option value="manual">Manual / In-world</option><option value="promo">Promo / Comp</option></select></label>
          <label>License tier<select name="tier" required><option value="3">3 avatars</option><option value="5">5 avatars</option><option value="10">10 avatars</option></select></label>
          <label>Email<input name="email" type="email" autocomplete="off"></label>
          <label>Avatar name<input name="avatarName" type="text" maxlength="100" autocomplete="off"></label>
          <label class="full">Primary avatar UUID<input name="avatarUuid" type="text" maxlength="36" autocomplete="off" spellcheck="false" placeholder="00000000-0000-0000-0000-000000000000"></label>
          <label class="full">Reason<textarea name="reason">Back Office rebuild/reissue</textarea></label>
          <label class="full">Type REBUILD to confirm<input name="confirmation" type="text" autocomplete="off" required></label>
        </div>
        <p id="rebuild-message" class="message" role="status"></p>
        <div id="rebuild-result" class="rebuild-result" hidden></div>
        <div class="rebuild-actions"><button id="rebuild-cancel" class="button quiet" type="button">Cancel</button><button class="button gold" type="submit">Rebuild & Issue New Key</button></div>
      </form>
    </section>`;
  document.body.appendChild(modal);

  const form = modal.querySelector('#rebuild-form');
  const message = modal.querySelector('#rebuild-message');
  const resultBox = modal.querySelector('#rebuild-result');
  let currentCustomerId = null;

  button.addEventListener('click', open);
  modal.querySelector('#rebuild-cancel').addEventListener('click', close);
  modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
  form.addEventListener('submit', rebuild);

  async function open() {
    button.disabled = true;
    try {
      message.textContent = 'Loading customer purchases…';
      resultBox.hidden = true;
      const identity = drawerIdentity();
      const customer = await resolveCustomer(identity);
      if (!customer) throw new Error('Could not uniquely match this customer record.');
      currentCustomerId = customer.id;
      modal.hidden = false;

      const preview = await call({ action: 'preview', customerId: customer.id });
      const purchases = preview.purchases || [];
      const licenses = preview.licenses || [];
      if (!purchases.length) throw new Error('This customer has no purchase record to rebuild from.');
      if (!licenses.length) throw new Error('This customer has no license record to replace.');

      const purchaseSelect = form.elements.purchaseId;
      purchaseSelect.replaceChildren(...purchases.map((p) => option(p.id, purchaseLabel(p))));
      const licenseSelect = form.elements.oldLicenseId;
      licenseSelect.replaceChildren(...licenses.map((l) => option(l.id, `License #${l.license_number ?? '—'} · ${l.tier} avatars · ${l.status} · ending ${l.key_last4 || '—'}`)));

      form.elements.email.value = preview.customer?.email || identity.email || '';
      form.elements.avatarName.value = preview.customer?.primary_avatar_name || identity.name || '';
      form.elements.avatarUuid.value = preview.customer?.primary_avatar_uuid || (isUuid(identity.uuid) ? identity.uuid : '');
      const firstPurchase = purchases[0];
      if (['website_usd','second_life_marketplace','manual','promo'].includes(firstPurchase.channel)) form.elements.channel.value = firstPurchase.channel;
      form.elements.tier.value = String(firstPurchase.license_tier || licenses[0]?.tier || 3);
      form.elements.reason.value = 'Back Office rebuild/reissue';
      form.elements.confirmation.value = '';
      syncLicenseToPurchase();
      message.textContent = 'Review the retained purchase information, make any corrections, then type REBUILD.';
      purchaseSelect.onchange = () => { prefillFromPurchase(preview.purchases.find(p => p.id === purchaseSelect.value), preview.licenses); };
    } catch (error) {
      message.textContent = error?.message || 'Could not prepare the rebuild.';
      if (!modal.hidden && !currentCustomerId) setTimeout(close, 1200);
    } finally {
      button.disabled = false;
    }
  }

  function prefillFromPurchase(purchase, licenses) {
    if (!purchase) return;
    if (['website_usd','second_life_marketplace','manual','promo'].includes(purchase.channel)) form.elements.channel.value = purchase.channel;
    form.elements.tier.value = String(purchase.license_tier || 3);
    if (purchase.purchaser_email) form.elements.email.value = purchase.purchaser_email;
    if (purchase.purchaser_avatar_name) form.elements.avatarName.value = purchase.purchaser_avatar_name;
    if (purchase.purchaser_avatar_uuid) form.elements.avatarUuid.value = purchase.purchaser_avatar_uuid;
    const linked = licenses.find(l => l.id === purchase.license_id || l.purchase_id === purchase.id);
    if (linked) form.elements.oldLicenseId.value = linked.id;
  }

  function syncLicenseToPurchase() {
    const purchaseId = form.elements.purchaseId.value;
    const opts = [...form.elements.oldLicenseId.options];
    const match = opts.find(o => o.dataset.purchaseId === purchaseId);
    if (match) form.elements.oldLicenseId.value = match.value;
  }

  async function rebuild(event) {
    event.preventDefault();
    if (!currentCustomerId) return;
    const payload = Object.fromEntries(new FormData(form));
    if (String(payload.confirmation || '').trim().toUpperCase() !== 'REBUILD') {
      message.textContent = 'Type REBUILD to confirm.';
      return;
    }
    if (payload.avatarUuid && !isUuid(payload.avatarUuid)) {
      message.textContent = 'The avatar UUID is not valid.';
      return;
    }
    if (!confirm('Replace the selected license with a fresh license key while retaining the original protected purchase record?')) return;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    message.textContent = 'Rebuilding license…';
    try {
      const response = await call({ action:'rebuild', customerId:currentCustomerId, ...payload });
      const number = response.license?.license_number ?? '—';
      resultBox.hidden = false;
      resultBox.innerHTML = `<strong>Replacement license #${escapeHtml(number)}</strong><br><code>${escapeHtml(response.licenseKey)}</code><br><span class="muted">Copy this key now. Only its secure hash is stored.</span>`;
      message.textContent = 'Rebuild complete. The old key is invalid and the retained purchase now points to the replacement license.';
      form.querySelector('#rebuild-cancel').textContent = 'Close & Refresh';
      form.querySelector('#rebuild-cancel').onclick = () => location.reload();
    } catch (error) {
      message.textContent = error?.message || 'Could not rebuild the license.';
      submit.disabled = false;
    }
  }

  async function call(payload) {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error('Your Back Office sign-in expired. Sign in again.');
    const r = await fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${data.session.access_token}`,'content-type':'application/json'},body:JSON.stringify(payload)});
    const b = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(b.detail || String(b.error || `Request failed (${r.status})`).replaceAll('_',' '));
    return b;
  }

  function close() {
    modal.hidden = true;
    currentCustomerId = null;
    message.textContent = '';
    resultBox.hidden = true;
    form.reset();
  }

  function drawerIdentity() {
    const name = document.querySelector('#drawer-name')?.textContent?.trim() || '';
    const uuid = document.querySelector('#drawer-uuid')?.textContent?.trim() || '';
    let email = '';
    for (const chip of drawer.querySelectorAll('.summary-chip')) {
      if (chip.querySelector('span')?.textContent?.trim().toLowerCase() === 'email') {
        const value = chip.querySelector('strong')?.textContent?.trim() || '';
        if (value && value.toLowerCase() !== 'not recorded') email = value;
      }
    }
    return { name, uuid, email };
  }

  async function resolveCustomer(identity) {
    if (isUuid(identity.uuid)) {
      const {data,error}=await supabase.from('customers').select('id,email,primary_avatar_name,primary_avatar_uuid').eq('primary_avatar_uuid',identity.uuid).limit(2);
      if(error)throw error;if(data?.length===1)return data[0];
    }
    if (identity.email) {
      const {data,error}=await supabase.from('customers').select('id,email,primary_avatar_name,primary_avatar_uuid').ilike('email',identity.email).limit(2);
      if(error)throw error;if(data?.length===1)return data[0];
    }
    if (identity.name) {
      const {data,error}=await supabase.from('customers').select('id,email,primary_avatar_name,primary_avatar_uuid').eq('primary_avatar_name',identity.name).limit(2);
      if(error)throw error;if(data?.length===1)return data[0];
    }
    return null;
  }

  function purchaseLabel(p) {
    const amount = p.original_amount ?? p.amount;
    const currency = p.original_currency || p.currency || '';
    const date = p.paid_at || p.purchased_at || p.created_at;
    return `${human(p.channel)} · ${currency} ${amount ?? '—'} · ${date ? new Date(date).toLocaleDateString() : '—'} · Sale #${p.purchase_number ?? '—'}`;
  }
  function option(value,text){const el=document.createElement('option');el.value=value;el.textContent=text;return el;}
  function human(v){return String(v||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());}
  function isUuid(v){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||'').trim());}
  function escapeHtml(v){const d=document.createElement('div');d.textContent=String(v??'');return d.innerHTML;}
}
