import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.CACHE_COMPASS_ADMIN_CONFIG;
const setupWarning = document.querySelector('#setup-warning');
const loginPanel = document.querySelector('#login-panel');
const app = document.querySelector('#app');
const appMessage = document.querySelector('#app-message');
const licensesContainer = document.querySelector('#licenses');
const template = document.querySelector('#license-template');
let supabase = null;
let licenses = [];

const configured = config && !Object.values(config).some((value) => !value || String(value).includes('YOUR_'));
if (!configured) {
  setupWarning.hidden = false;
  loginPanel.hidden = true;
} else {
  supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  start();
}

async function start() {
  const { data } = await supabase.auth.getSession();
  showSession(data.session);
  supabase.auth.onAuthStateChange((_event, session) => showSession(session));
}

function showSession(session) {
  loginPanel.hidden = Boolean(session);
  app.hidden = !session;
  document.querySelector('#sign-out').hidden = !session;
  if (session) loadLicenses();
}

document.querySelector('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = document.querySelector('#login-email').value.trim();
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href } });
  document.querySelector('#login-message').textContent = error ? error.message : 'Check your email for the secure sign-in link.';
});

document.querySelector('#sign-out').addEventListener('click', () => supabase.auth.signOut());
document.querySelector('#search-button').addEventListener('click', loadLicenses);
document.querySelector('#search').addEventListener('keydown', (event) => { if (event.key === 'Enter') loadLicenses(); });
document.querySelector('#status-filter').addEventListener('change', loadLicenses);
document.querySelector('#new-license-button').addEventListener('click', () => document.querySelector('#issue-panel').hidden = false);
document.querySelector('#close-issue').addEventListener('click', () => document.querySelector('#issue-panel').hidden = true);
document.querySelector('#export-button').addEventListener('click', exportCsv);
document.querySelector('#release-form').addEventListener('submit', publishRelease);

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Your sign-in expired. Please sign in again.');
  return { 'authorization': `Bearer ${data.session.access_token}`, 'content-type': 'application/json' };
}

async function api(path = '', options = {}) {
  const response = await fetch(`${config.adminFunctionUrl}${path}`, { ...options, headers: { ...(await authHeaders()), ...(options.headers || {}) } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}

async function loadLicenses() {
  try {
    appMessage.textContent = 'Loading…';
    const params = new URLSearchParams({ q: document.querySelector('#search').value.trim(), status: document.querySelector('#status-filter').value, limit: '1000' });
    const result = await api(`?${params}`);
    licenses = result.licenses;
    document.querySelector('#result-count').textContent = `${result.total} license${result.total === 1 ? '' : 's'}`;
    renderLicenses();
    appMessage.textContent = '';
  } catch (error) {
    appMessage.textContent = error.message;
  }
}

function renderLicenses() {
  licensesContainer.replaceChildren();
  for (const license of licenses) {
    const card = template.content.firstElementChild.cloneNode(true);
    const status = card.querySelector('.status');
    status.textContent = license.status;
    status.classList.add(license.status);
    card.querySelector('.license-label').textContent = `${license.tier}-avatar license •••• ${license.key_last4}`;
    card.querySelector('.license-meta').textContent = `Created ${formatDate(license.created_at)} • ${license.payment_method.toUpperCase()}`;
    card.querySelector('.facts').innerHTML = [
      ['Slots', `${license.avatars.length} / ${license.max_avatars}`],
      ['Purchaser UUID', license.purchaser_avatar_uuid || 'Not recorded'],
      ['Payment', paymentText(license)],
      ['Receipt', license.external_transaction_id || 'Not recorded'],
    ].map(([label, value]) => `<div class="fact"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
    renderActions(card, license);
    renderAvatars(card, license);
    renderOrders(card, license);
    renderHistory(card, license);
    licensesContainer.append(card);
  }
}

function renderActions(card, license) {
  const actions = card.querySelector('.license-actions');
  for (const next of ['active', 'suspended', 'revoked']) {
    if (next === license.status) continue;
    const button = document.createElement('button');
    button.textContent = next === 'active' ? 'Reactivate' : next[0].toUpperCase() + next.slice(1);
    button.addEventListener('click', async () => {
      const reason = prompt(`Reason for changing this license to ${next}:`) ?? '';
      if (!reason.trim()) return;
      await mutate({ action: 'set_status', licenseId: license.id, status: next, reason });
    });
    actions.append(button);
  }
}

function renderAvatars(card, license) {
  const holder = card.querySelector('.avatars');
  if (!license.avatars.length) holder.innerHTML = '<p class="muted">No avatars registered.</p>';
  for (const avatar of license.avatars) {
    const row = document.createElement('div');
    row.className = 'avatar-row';
    row.innerHTML = `<div><p><strong>${escapeHtml(avatar.avatar_name || 'Name not recorded')}</strong></p><p class="muted">${escapeHtml(avatar.avatar_uuid)}</p></div><div class="avatar-actions"></div>`;
    const actions = row.querySelector('.avatar-actions');
    const rename = document.createElement('button');
    rename.textContent = 'Edit name';
    rename.addEventListener('click', async () => {
      const avatarName = prompt('Correct avatar name:', avatar.avatar_name || '') ?? '';
      if (!avatarName.trim()) return;
      await mutate({ action: 'update_avatar_name', licenseId: license.id, avatarUuid: avatar.avatar_uuid, avatarName });
    });
    const replace = document.createElement('button');
    replace.textContent = 'Replace slot';
    replace.addEventListener('click', async () => {
      const newAvatarUuid = prompt('New avatar UUID:')?.trim();
      if (!newAvatarUuid) return;
      const newAvatarName = prompt('New avatar name (optional):') ?? '';
      const reason = prompt('Reason or paid replacement receipt:') ?? '';
      if (!reason.trim()) return;
      await mutate({ action: 'replace_avatar', licenseId: license.id, oldAvatarUuid: avatar.avatar_uuid, newAvatarUuid, newAvatarName, reason });
    });
    actions.append(rename, replace);
    holder.append(row);
  }
}

function renderOrders(card, license) {
  const holder = card.querySelector('.orders');
  if (!license.orders.length) holder.innerHTML = '<p class="muted">No linked order record.</p>';
  for (const order of license.orders) {
    const row = document.createElement('div');
    row.className = 'order-row';
    row.innerHTML = `<div><p><strong>${escapeHtml(order.provider.toUpperCase())} • ${escapeHtml(order.status)}</strong></p><p class="muted">${escapeHtml(order.purchaser_email || order.purchaser_avatar_name || 'Customer identity not recorded')}</p></div><p class="muted">${escapeHtml(formatMoney(order.amount_minor, order.currency))}</p>`;
    holder.append(row);
  }
}

function renderHistory(card, license) {
  const holder = card.querySelector('.history');
  const combined = [
    ...license.avatarHistory.map((row) => ({ at: row.occurred_at, title: `${row.action}: ${row.avatar_name || row.avatar_uuid}`, detail: row.reason || (row.replacement_avatar_uuid ? `Replaced by ${row.replacement_avatar_name || row.replacement_avatar_uuid}` : '') })),
    ...license.events.map((row) => ({ at: row.created_at, title: row.event_type, detail: row.avatar_uuid || '' })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));
  if (!combined.length) holder.innerHTML = '<p class="muted">No history yet.</p>';
  for (const item of combined) {
    const row = document.createElement('div');
    row.className = 'history-row';
    row.innerHTML = `<div><p><strong>${escapeHtml(item.title)}</strong></p><p class="muted">${escapeHtml(item.detail)}</p></div><p class="muted">${escapeHtml(formatDate(item.at))}</p>`;
    holder.append(row);
  }
}

async function mutate(payload) {
  try {
    appMessage.textContent = 'Saving…';
    await api('', { method: 'POST', body: JSON.stringify(payload) });
    await loadLicenses();
    appMessage.textContent = 'Saved.';
  } catch (error) {
    appMessage.textContent = error.message;
  }
}

async function publishRelease(event) {
  event.preventDefault();
  const message = document.querySelector('#release-message');
  const button = event.currentTarget.querySelector('button[type="submit"]');
  try {
    message.textContent = 'Uploading and calculating the file checksum…';
    button.disabled = true;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error('Your sign-in expired. Please sign in again.');
    const response = await fetch(config.releaseFunctionUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${data.session.access_token}` },
      body: new FormData(event.currentTarget),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Release upload failed');
    message.textContent = `Version ${result.release.version} is now the active customer download. SHA-256: ${result.release.sha256}`;
    event.currentTarget.reset();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

document.querySelector('#issue-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget));
  for (const key of Object.keys(payload)) if (payload[key] === '') delete payload[key];
  payload.action = 'issue_license';
  try {
    const result = await api('', { method: 'POST', body: JSON.stringify(payload) });
    const issued = document.querySelector('#issued-license');
    issued.hidden = false;
    issued.innerHTML = `<strong>License created:</strong> ${escapeHtml(result.licenseKey)}<br>Copy it now. Only the secure hash is stored.`;
    await loadLicenses();
  } catch (error) {
    appMessage.textContent = error.message;
  }
});

function exportCsv() {
  const rows = [['License ending','Status','Tier','Used slots','Avatar name','Avatar UUID','Customer email','Payment method','Amount','Currency','Created']];
  for (const license of licenses) {
    const avatars = license.avatars.length ? license.avatars : [{}];
    const email = license.orders.find((order) => order.purchaser_email)?.purchaser_email || '';
    for (const avatar of avatars) rows.push([license.key_last4,license.status,license.tier,`${license.avatars.length}/${license.max_avatars}`,avatar.avatar_name||'',avatar.avatar_uuid||'',email,license.payment_method,license.payment_amount??'',license.payment_currency||'',license.created_at]);
  }
  const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"','""')}"`).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  link.download = `cache-compass-customers-${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function paymentText(license) { return license.payment_amount == null ? license.payment_method : `${license.payment_currency || ''} ${license.payment_amount}`.trim(); }
function formatMoney(amount, currency) { if (amount == null) return ''; return currency === 'USD' ? `$${(amount/100).toFixed(2)}` : `${currency || ''}${amount}`; }
function formatDate(value) { return value ? new Date(value).toLocaleString() : '—'; }
function escapeHtml(value) { const div=document.createElement('div'); div.textContent=String(value??''); return div.innerHTML; }
