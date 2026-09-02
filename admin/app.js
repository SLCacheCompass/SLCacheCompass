import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.CACHE_COMPASS_ADMIN_CONFIG;
const setupWarning = document.querySelector('#setup-warning');
const loginPanel = document.querySelector('#login-panel');
const app = document.querySelector('#app');
const appMessage = document.querySelector('#app-message');
const drawer = document.querySelector('#customer-drawer');
const issueModal = document.querySelector('#issue-modal');

let supabase = null;
let licenses = [];
let customers = [];
let selectedCustomerKey = null;
let issueCustomerKey = null;
let previousLogin = null;
let loading = false;

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
  await showSession(data.session);
  supabase.auth.onAuthStateChange((_event, session) => showSession(session));
}

async function showSession(session) {
  loginPanel.hidden = Boolean(session);
  app.hidden = !session;
  document.querySelector('#sign-out').hidden = !session;
  document.querySelector('#new-license-button').hidden = !session;
  if (!session) return;

  const sessionFlag = 'cacheCompassAdminSessionStarted';
  if (!sessionStorage.getItem(sessionFlag)) {
    const prior = localStorage.getItem('cacheCompassAdminLastLogin');
    previousLogin = prior ? new Date(prior) : null;
    sessionStorage.setItem('cacheCompassAdminPreviousLogin', prior || '');
    sessionStorage.setItem(sessionFlag, '1');
    localStorage.setItem('cacheCompassAdminLastLogin', new Date().toISOString());
  } else {
    const prior = sessionStorage.getItem('cacheCompassAdminPreviousLogin');
    previousLogin = prior ? new Date(prior) : null;
  }
  await refreshData();
}

document.querySelector('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = document.querySelector('#login-email').value.trim();
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href } });
  document.querySelector('#login-message').textContent = error ? error.message : 'Check your email for the secure sign-in link.';
});

document.querySelector('#sign-out').addEventListener('click', async () => {
  sessionStorage.removeItem('cacheCompassAdminSessionStarted');
  sessionStorage.removeItem('cacheCompassAdminPreviousLogin');
  await supabase.auth.signOut();
});

for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => switchView(tab.dataset.view));
for (const jump of document.querySelectorAll('[data-jump]')) jump.addEventListener('click', () => switchView(jump.dataset.jump));
for (const close of document.querySelectorAll('[data-close-drawer]')) close.addEventListener('click', closeDrawer);
for (const close of document.querySelectorAll('[data-close-modal]')) close.addEventListener('click', closeIssueModal);

document.querySelector('#global-search-button').addEventListener('click', () => {
  switchView('customers');
  document.querySelector('#customer-search').focus();
});
document.querySelector('#new-license-button').addEventListener('click', () => openIssueModal());
document.querySelector('#drawer-add-license').addEventListener('click', () => {
  const customer = findCustomer(selectedCustomerKey);
  if (customer) openIssueModal(customer);
});
document.querySelector('#export-button').addEventListener('click', exportCsv);
document.querySelector('#release-form').addEventListener('submit', publishRelease);
document.querySelector('#issue-form').addEventListener('submit', issueLicense);
document.querySelector('#note-form').addEventListener('submit', addCustomerNote);

const customerSearch = document.querySelector('#customer-search');
const customerStatus = document.querySelector('#customer-status-filter');
document.querySelector('#customer-search-button').addEventListener('click', renderCustomers);
customerSearch.addEventListener('input', renderCustomers);
customerStatus.addEventListener('change', renderCustomers);
customerSearch.addEventListener('keydown', (event) => { if (event.key === 'Enter') renderCustomers(); });

const licenseSearch = document.querySelector('#license-search');
const licenseStatus = document.querySelector('#license-status-filter');
document.querySelector('#license-search-button').addEventListener('click', renderLicenseTable);
licenseSearch.addEventListener('input', renderLicenseTable);
licenseStatus.addEventListener('change', renderLicenseTable);
licenseSearch.addEventListener('keydown', (event) => { if (event.key === 'Enter') renderLicenseTable(); });

document.querySelector('#dashboard-search-button').addEventListener('click', runDashboardSearch);
document.querySelector('#dashboard-search').addEventListener('keydown', (event) => { if (event.key === 'Enter') runDashboardSearch(); });

function runDashboardSearch() {
  const query = document.querySelector('#dashboard-search').value.trim();
  customerSearch.value = query;
  switchView('customers');
  renderCustomers();
  customerSearch.focus();
}

function switchView(name) {
  for (const tab of document.querySelectorAll('.tab')) tab.classList.toggle('active', tab.dataset.view === name);
  for (const view of document.querySelectorAll('.view')) view.classList.toggle('active', view.id === `view-${name}`);
  if (name === 'dashboard') renderDashboard();
  if (name === 'customers') renderCustomers();
  if (name === 'licenses') renderLicenseTable();
  if (name === 'sales') renderSales();
}

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Your sign-in expired. Please sign in again.');
  return { authorization: `Bearer ${data.session.access_token}`, 'content-type': 'application/json' };
}

async function api(path = '', options = {}) {
  const response = await fetch(`${config.adminFunctionUrl}${path}`, { ...options, headers: { ...(await authHeaders()), ...(options.headers || {}) } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}

async function refreshData() {
  if (loading) return;
  loading = true;
  try {
    appMessage.textContent = 'Loading…';
    const params = new URLSearchParams({ q: '', status: '', limit: '1000' });
    const result = await api(`?${params}`);
    licenses = Array.isArray(result.licenses) ? result.licenses : [];
    customers = buildCustomers(licenses);
    renderAll();
    appMessage.textContent = '';
  } catch (error) {
    appMessage.textContent = error.message;
  } finally {
    loading = false;
  }
}

function buildCustomers(items) {
  const map = new Map();
  for (const license of items) {
    const email = customerEmailForLicense(license);
    const purchaserUuid = license.purchaser_avatar_uuid || '';
    const firstAvatar = Array.isArray(license.avatars) ? license.avatars[0] : null;
    const key = email ? `email:${email.toLowerCase()}` : purchaserUuid ? `uuid:${purchaserUuid.toLowerCase()}` : firstAvatar?.avatar_uuid ? `uuid:${firstAvatar.avatar_uuid.toLowerCase()}` : `license:${license.id}`;
    if (!map.has(key)) map.set(key, { key, licenses: [], email: email || '', primaryUuid: purchaserUuid || firstAvatar?.avatar_uuid || '', name: customerNameForLicense(license), firstDate: license.created_at, lastDate: license.created_at });
    const customer = map.get(key);
    customer.licenses.push(license);
    if (!customer.email && email) customer.email = email;
    if (!customer.primaryUuid && purchaserUuid) customer.primaryUuid = purchaserUuid;
    const candidateName = customerNameForLicense(license);
    if ((!customer.name || customer.name.startsWith('Customer ')) && candidateName) customer.name = candidateName;
    if (new Date(license.created_at) < new Date(customer.firstDate)) customer.firstDate = license.created_at;
    if (new Date(license.created_at) > new Date(customer.lastDate)) customer.lastDate = license.created_at;
  }
  return [...map.values()].map((customer) => ({
    ...customer,
    totalSlots: customer.licenses.reduce((sum, license) => sum + Number(license.max_avatars || license.tier || 0), 0),
    usedSlots: customer.licenses.reduce((sum, license) => sum + (license.avatars?.length || 0), 0),
    status: customerStatusForLicenses(customer.licenses),
    sources: [...new Set(customer.licenses.map((license) => String(license.payment_method || 'manual').toUpperCase()))],
  })).sort((a, b) => new Date(b.lastDate) - new Date(a.lastDate));
}

function customerNameForLicense(license) {
  const avatars = Array.isArray(license.avatars) ? license.avatars : [];
  const purchaser = avatars.find((avatar) => avatar.avatar_uuid === license.purchaser_avatar_uuid);
  if (purchaser?.avatar_name) return purchaser.avatar_name;
  const orderName = (license.orders || []).find((order) => order.purchaser_avatar_name)?.purchaser_avatar_name;
  if (orderName) return orderName;
  const named = avatars.find((avatar) => avatar.avatar_name)?.avatar_name;
  if (named) return named;
  const email = customerEmailForLicense(license);
  if (email) return email.split('@')[0];
  return `Customer •••• ${license.key_last4 || '—'}`;
}

function customerEmailForLicense(license) {
  return (license.orders || []).find((order) => order.purchaser_email)?.purchaser_email || '';
}

function customerStatusForLicenses(items) {
  if (items.some((license) => license.status === 'active')) return 'active';
  if (items.some((license) => license.status === 'suspended')) return 'suspended';
  return items[0]?.status || 'revoked';
}

function renderAll() {
  renderDashboard();
  renderCustomers();
  renderLicenseTable();
  renderSales();
  if (selectedCustomerKey) {
    const customer = findCustomer(selectedCustomerKey);
    if (customer) renderDrawer(customer); else closeDrawer();
  }
}

function renderDashboard() {
  const cutoff = previousLogin ? previousLogin.getTime() : 0;
  const newLicenses = licenses.filter((license) => new Date(license.created_at).getTime() > cutoff);
  const newCustomers = customers.filter((customer) => new Date(customer.firstDate).getTime() > cutoff);
  const avatarActivity = licenses.flatMap((license) => (license.avatarHistory || []).map((row) => ({ ...row, license }))).filter((row) => new Date(row.occurred_at || 0).getTime() > cutoff && ['added','registered','replaced','replace'].some((word) => String(row.action || '').toLowerCase().includes(word)));
  const attention = licenses.filter((license) => license.status !== 'active');

  document.querySelector('#metric-customers').textContent = newCustomers.length;
  document.querySelector('#metric-licenses').textContent = newLicenses.length;
  document.querySelector('#metric-avatars').textContent = avatarActivity.length;
  document.querySelector('#metric-attention').textContent = attention.length;
  document.querySelector('#metric-support').textContent = '—';
  document.querySelector('#since-label').textContent = previousLogin ? `Since ${formatDate(previousLogin)}` : 'First recorded owner session — showing all available activity.';

  const activity = [];
  for (const license of licenses) activity.push({ at: license.created_at, type: 'License', customer: customerForLicense(license), detail: `${license.tier}-avatar license issued`, license });
  for (const license of licenses) {
    for (const row of license.avatarHistory || []) activity.push({ at: row.occurred_at, type: 'Avatar', customer: customerForLicense(license), detail: `${row.action || 'Updated'}: ${row.avatar_name || shortUuid(row.avatar_uuid)}`, license });
    for (const row of license.events || []) activity.push({ at: row.created_at, type: 'System', customer: customerForLicense(license), detail: humanize(row.event_type || 'License event'), license });
  }
  activity.sort((a, b) => new Date(b.at) - new Date(a.at));
  const holder = document.querySelector('#activity-list');
  holder.replaceChildren();
  if (!activity.length) holder.innerHTML = '<p class="muted">No activity recorded yet.</p>';
  for (const item of activity.slice(0, 12)) {
    const row = document.createElement('div');
    row.className = 'activity-row';
    row.innerHTML = `<span class="activity-type">${escapeHtml(item.type)}</span><p><strong>${escapeHtml(item.customer?.name || 'Customer')}</strong></p><p class="activity-detail muted">${escapeHtml(item.detail)}</p><p class="time">${escapeHtml(shortDate(item.at))}</p>`;
    if (item.customer) row.addEventListener('click', () => openDrawer(item.customer));
    holder.append(row);
  }
}

function renderCustomers() {
  const query = customerSearch.value.trim().toLowerCase();
  const status = customerStatus.value;
  const filtered = customers.filter((customer) => (!status || customer.status === status) && matchesCustomer(customer, query));
  const body = document.querySelector('#customer-rows');
  body.replaceChildren();
  for (const customer of filtered) {
    const row = document.createElement('tr');
    row.innerHTML = `<td class="name-cell"><strong>${escapeHtml(customer.name)}</strong><span>${escapeHtml(customer.email || 'No email recorded')}</span></td><td><span class="uuid-short" title="${escapeHtml(customer.primaryUuid)}">${escapeHtml(shortUuid(customer.primaryUuid))}</span></td><td>${customer.licenses.length}</td><td>${customer.usedSlots} / ${customer.totalSlots}</td><td>${escapeHtml(customer.sources.join(' · '))}</td><td><span class="status-pill ${escapeHtml(customer.status)}">${escapeHtml(customer.status)}</span></td><td>${escapeHtml(shortDate(customer.lastDate))}</td>`;
    row.addEventListener('click', () => openDrawer(customer));
    body.append(row);
  }
  if (!filtered.length) body.innerHTML = '<tr><td colspan="7" class="muted">No matching customers.</td></tr>';
  document.querySelector('#customer-count').textContent = `${filtered.length} customer${filtered.length === 1 ? '' : 's'}`;
}

function matchesCustomer(customer, query) {
  if (!query) return true;
  const values = [customer.name, customer.primaryUuid, customer.email];
  for (const license of customer.licenses) {
    values.push(license.key_last4, license.external_transaction_id, license.payment_method);
    for (const avatar of license.avatars || []) values.push(avatar.avatar_name, avatar.avatar_uuid);
    for (const order of license.orders || []) values.push(order.purchaser_email, order.purchaser_avatar_name);
  }
  return values.some((value) => String(value || '').toLowerCase().includes(query));
}

function renderLicenseTable() {
  const query = licenseSearch.value.trim().toLowerCase();
  const status = licenseStatus.value;
  const filtered = licenses.filter((license) => (!status || license.status === status) && matchesLicense(license, query)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const body = document.querySelector('#license-rows');
  body.replaceChildren();
  for (const license of filtered) {
    const customer = customerForLicense(license);
    const row = document.createElement('tr');
    row.innerHTML = `<td class="name-cell"><strong>${escapeHtml(customer?.name || customerNameForLicense(license))}</strong><span>${escapeHtml(customer?.email || '')}</span></td><td>${escapeHtml(`${license.tier}-avatar •••• ${license.key_last4 || '—'}`)}</td><td>${license.avatars?.length || 0} / ${license.max_avatars || license.tier}</td><td>${escapeHtml(paymentText(license))}</td><td><span class="status-pill ${escapeHtml(license.status)}">${escapeHtml(license.status)}</span></td><td>${escapeHtml(shortDate(license.created_at))}</td>`;
    if (customer) row.addEventListener('click', () => openDrawer(customer));
    body.append(row);
  }
  if (!filtered.length) body.innerHTML = '<tr><td colspan="6" class="muted">No matching licenses.</td></tr>';
  document.querySelector('#license-count').textContent = `${filtered.length} license${filtered.length === 1 ? '' : 's'}`;
}

function matchesLicense(license, query) {
  if (!query) return true;
  const customer = customerForLicense(license);
  const values = [license.key_last4, license.external_transaction_id, license.purchaser_avatar_uuid, license.payment_method, customer?.name, customer?.email];
  for (const avatar of license.avatars || []) values.push(avatar.avatar_name, avatar.avatar_uuid);
  return values.some((value) => String(value || '').toLowerCase().includes(query));
}

function renderSales() {
  const rows = [];
  for (const license of licenses) {
    const customer = customerForLicense(license);
    if (license.orders?.length) {
      for (const order of license.orders) rows.push({ customer, source: order.provider || license.payment_method, amount: formatMoney(order.amount_minor, order.currency), license, receipt: order.external_transaction_id || license.external_transaction_id || '', at: order.created_at || license.created_at });
    } else {
      rows.push({ customer, source: license.payment_method || 'manual', amount: paymentText(license), license, receipt: license.external_transaction_id || '', at: license.created_at });
    }
  }
  rows.sort((a, b) => new Date(b.at) - new Date(a.at));
  const body = document.querySelector('#sales-rows');
  body.replaceChildren();
  for (const sale of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="name-cell"><strong>${escapeHtml(sale.customer?.name || 'Customer')}</strong></td><td>${escapeHtml(String(sale.source || '').toUpperCase())}</td><td>${escapeHtml(sale.amount || '—')}</td><td>${escapeHtml(`${sale.license.tier}-avatar •••• ${sale.license.key_last4 || '—'}`)}</td><td><span class="uuid-short">${escapeHtml(shortReceipt(sale.receipt))}</span></td><td>${escapeHtml(shortDate(sale.at))}</td>`;
    if (sale.customer) tr.addEventListener('click', () => openDrawer(sale.customer));
    body.append(tr);
  }
  if (!rows.length) body.innerHTML = '<tr><td colspan="6" class="muted">No payment records.</td></tr>';
}

function openDrawer(customer) {
  selectedCustomerKey = customer.key;
  renderDrawer(customer);
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
}

function closeDrawer() {
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
}

function renderDrawer(customer) {
  document.querySelector('#drawer-name').textContent = customer.name;
  document.querySelector('#drawer-uuid').textContent = customer.primaryUuid || 'No primary UUID recorded';
  document.querySelector('#customer-summary').innerHTML = [
    ['Licenses', customer.licenses.length],
    ['Slots', `${customer.usedSlots} / ${customer.totalSlots}`],
    ['Status', humanize(customer.status)],
    ['Customer since', shortDate(customer.firstDate)],
    ['Last purchase', shortDate(customer.lastDate)],
    ['Email', customer.email || 'Not recorded'],
  ].map(([label, value]) => `<div class="summary-chip"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');

  const licenseHolder = document.querySelector('#drawer-licenses');
  licenseHolder.replaceChildren();
  for (const license of [...customer.licenses].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))) licenseHolder.append(renderLicenseBlock(license));
  renderNotes(customer);
  renderCustomerHistory(customer);
}

function renderLicenseBlock(license) {
  const block = document.createElement('div');
  block.className = 'license-block';
  const head = document.createElement('div');
  head.className = 'license-block-head';
  head.innerHTML = `<div><h4>${escapeHtml(`${license.tier}-Avatar License · •••• ${license.key_last4 || '—'}`)} <span class="status-pill ${escapeHtml(license.status)}">${escapeHtml(license.status)}</span></h4><p>${escapeHtml(`${license.avatars?.length || 0}/${license.max_avatars || license.tier} slots · ${paymentText(license)} · ${shortDate(license.created_at)}`)}</p></div><div class="license-toolbar"></div>`;
  const toolbar = head.querySelector('.license-toolbar');
  for (const next of ['active','suspended','revoked']) {
    if (next === license.status) continue;
    const button = document.createElement('button');
    button.className = `mini-button ${next === 'revoked' ? 'danger' : ''}`;
    button.textContent = next === 'active' ? 'Reactivate' : humanize(next);
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const reason = prompt(`Reason for changing this license to ${next}:`) ?? '';
      if (!reason.trim()) return;
      await mutate({ action: 'set_status', licenseId: license.id, status: next, reason });
    });
    toolbar.append(button);
  }
  block.append(head);

  const avatarList = document.createElement('div');
  avatarList.className = 'avatar-list';
  if (!license.avatars?.length) avatarList.innerHTML = '<p class="muted">No avatars registered.</p>';
  for (const avatar of license.avatars || []) avatarList.append(renderAvatarLine(license, avatar));
  block.append(avatarList);

  if (license.external_transaction_id) {
    const receipt = document.createElement('div');
    receipt.className = 'history-row';
    receipt.style.padding = '8px 11px';
    receipt.innerHTML = `<p class="muted">Receipt / transaction: <span class="uuid-short">${escapeHtml(license.external_transaction_id)}</span></p>`;
    block.append(receipt);
  }
  return block;
}

function renderAvatarLine(license, avatar) {
  const row = document.createElement('div');
  row.className = 'avatar-line';
  row.innerHTML = `<div><p class="avatar-name">${escapeHtml(avatar.avatar_name || 'Name not recorded')}</p><p class="avatar-uuid">${escapeHtml(avatar.avatar_uuid)}</p></div><div class="avatar-actions"></div>`;
  const actions = row.querySelector('.avatar-actions');

  const rename = document.createElement('button');
  rename.className = 'mini-button';
  rename.textContent = 'Edit';
  rename.addEventListener('click', async () => {
    const avatarName = prompt('Correct avatar name:', avatar.avatar_name || '') ?? '';
    if (!avatarName.trim()) return;
    await mutate({ action: 'update_avatar_name', licenseId: license.id, avatarUuid: avatar.avatar_uuid, avatarName });
  });

  const replace = document.createElement('button');
  replace.className = 'mini-button';
  replace.textContent = 'Replace';
  replace.addEventListener('click', async () => {
    const newAvatarUuid = prompt('New avatar UUID:')?.trim();
    if (!newAvatarUuid) return;
    const newAvatarName = prompt('New avatar name (optional):') ?? '';
    const reason = prompt('Reason or paid replacement receipt:') ?? '';
    if (!reason.trim()) return;
    await mutate({ action: 'replace_avatar', licenseId: license.id, oldAvatarUuid: avatar.avatar_uuid, newAvatarUuid, newAvatarName, reason });
  });

  const remove = document.createElement('button');
  remove.className = 'mini-button danger';
  remove.textContent = 'Remove';
  remove.title = 'Remove this avatar from the active license while preserving history';
  remove.addEventListener('click', async () => {
    if (!confirm(`Remove ${avatar.avatar_name || avatar.avatar_uuid} from this license? The slot should become available and the history should be preserved.`)) return;
    const reason = prompt('Reason for removal (maintenance, paid change, support correction, etc.):') ?? '';
    if (!reason.trim()) return;
    await mutate({ action: 'remove_avatar', licenseId: license.id, avatarUuid: avatar.avatar_uuid, reason });
  });

  actions.append(rename, replace, remove);
  return row;
}

function renderCustomerHistory(customer) {
  const combined = [];
  for (const license of customer.licenses) {
    combined.push({ at: license.created_at, title: `${license.tier}-avatar license issued`, detail: `${String(license.payment_method || 'manual').toUpperCase()} · •••• ${license.key_last4 || '—'}` });
    for (const row of license.avatarHistory || []) combined.push({ at: row.occurred_at, title: `${humanize(row.action || 'Avatar update')}: ${row.avatar_name || row.avatar_uuid}`, detail: row.reason || (row.replacement_avatar_uuid ? `Replaced by ${row.replacement_avatar_name || row.replacement_avatar_uuid}` : '') });
    for (const row of license.events || []) combined.push({ at: row.created_at, title: humanize(row.event_type || 'License event'), detail: row.avatar_uuid || '' });
  }
  combined.sort((a, b) => new Date(b.at) - new Date(a.at));
  const holder = document.querySelector('#drawer-history');
  holder.replaceChildren();
  if (!combined.length) holder.innerHTML = '<p class="muted">No history yet.</p>';
  for (const item of combined.slice(0, 100)) {
    const row = document.createElement('div');
    row.className = 'history-row';
    row.innerHTML = `<p><strong>${escapeHtml(item.title)}</strong></p><p class="history-meta">${escapeHtml(item.detail || '')}${item.detail ? ' · ' : ''}${escapeHtml(formatDate(item.at))}</p>`;
    holder.append(row);
  }
}

function notesKey(customer) { return `cacheCompassCustomerNotes:${customer.key}`; }
function getNotes(customer) {
  try { return JSON.parse(localStorage.getItem(notesKey(customer)) || '[]'); } catch { return []; }
}
function renderNotes(customer) {
  const holder = document.querySelector('#drawer-notes');
  holder.replaceChildren();
  const notes = getNotes(customer).sort((a, b) => new Date(b.at) - new Date(a.at));
  if (!notes.length) holder.innerHTML = '<p class="muted">No customer notes yet.</p>';
  for (const note of notes) {
    const row = document.createElement('div');
    row.className = 'note-row';
    row.innerHTML = `<p>${escapeHtml(note.text)}</p><p class="note-meta">${escapeHtml(note.category)} · ${escapeHtml(formatDate(note.at))}</p>`;
    holder.append(row);
  }
}
function addCustomerNote(event) {
  event.preventDefault();
  const customer = findCustomer(selectedCustomerKey);
  if (!customer) return;
  const form = new FormData(event.currentTarget);
  const text = String(form.get('text') || '').trim();
  if (!text) return;
  const notes = getNotes(customer);
  notes.push({ text, category: String(form.get('category') || 'General'), at: new Date().toISOString() });
  localStorage.setItem(notesKey(customer), JSON.stringify(notes));
  event.currentTarget.reset();
  renderNotes(customer);
}

function openIssueModal(customer = null) {
  issueCustomerKey = customer?.key || null;
  const form = document.querySelector('#issue-form');
  form.reset();
  form.elements.paymentCurrency.value = 'USD';
  document.querySelector('#issued-license').hidden = true;
  document.querySelector('#issued-license').textContent = '';
  document.querySelector('#issue-title').textContent = customer ? 'Add license' : 'Issue a license';
  document.querySelector('#issue-context').textContent = customer ? `Adding another license for ${customer.name}. Existing customer information is prefilled.` : 'Create a manual, comp, or test license.';
  if (customer) {
    form.elements.purchaserAvatarName.value = customer.name || '';
    form.elements.purchaserAvatarUuid.value = customer.primaryUuid || '';
  }
  issueModal.hidden = false;
}
function closeIssueModal() { issueModal.hidden = true; issueCustomerKey = null; }

async function issueLicense(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget));
  for (const key of Object.keys(payload)) if (payload[key] === '') delete payload[key];
  payload.action = 'issue_license';
  try {
    appMessage.textContent = 'Creating license…';
    const result = await api('', { method: 'POST', body: JSON.stringify(payload) });
    const issued = document.querySelector('#issued-license');
    issued.hidden = false;
    issued.innerHTML = `<strong>License created:</strong> ${escapeHtml(result.licenseKey)}<br>Copy it now. Only the secure hash is stored.`;
    const reopenKey = issueCustomerKey;
    await refreshData();
    if (reopenKey) {
      const customer = findCustomer(reopenKey) || customers.find((entry) => entry.primaryUuid && entry.primaryUuid === payload.purchaserAvatarUuid);
      if (customer) openDrawer(customer);
    }
  } catch (error) {
    appMessage.textContent = error.message;
  }
}

async function mutate(payload) {
  try {
    appMessage.textContent = 'Saving…';
    await api('', { method: 'POST', body: JSON.stringify(payload) });
    await refreshData();
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
    const response = await fetch(config.releaseFunctionUrl, { method: 'POST', headers: { authorization: `Bearer ${data.session.access_token}` }, body: new FormData(event.currentTarget) });
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

function exportCsv() {
  const rows = [['Customer','Primary UUID','Email','License ending','Status','Tier','Used slots','Avatar name','Avatar UUID','Payment method','Amount','Currency','Created']];
  for (const customer of customers) for (const license of customer.licenses) {
    const avatars = license.avatars?.length ? license.avatars : [{}];
    for (const avatar of avatars) rows.push([customer.name,customer.primaryUuid,customer.email,license.key_last4,license.status,license.tier,`${license.avatars?.length || 0}/${license.max_avatars}`,avatar.avatar_name||'',avatar.avatar_uuid||'',license.payment_method,license.payment_amount??'',license.payment_currency||'',license.created_at]);
  }
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"','""')}"`).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  link.download = `cache-compass-customers-${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function findCustomer(key) { return customers.find((customer) => customer.key === key); }
function customerForLicense(license) { return customers.find((customer) => customer.licenses.some((item) => item.id === license.id)); }
function paymentText(license) { return license.payment_amount == null ? String(license.payment_method || 'manual').toUpperCase() : `${license.payment_currency || ''} ${license.payment_amount}`.trim(); }
function formatMoney(amount, currency) { if (amount == null) return ''; return currency === 'USD' ? `$${(amount / 100).toFixed(2)}` : `${currency || ''} ${amount}`.trim(); }
function formatDate(value) { return value ? new Date(value).toLocaleString() : '—'; }
function shortDate(value) { return value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(value).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : '—'; }
function shortUuid(value) { const text = String(value || ''); return text.length > 16 ? `${text.slice(0,8)}…${text.slice(-4)}` : text || '—'; }
function shortReceipt(value) { const text = String(value || ''); return text.length > 20 ? `${text.slice(0,10)}…${text.slice(-6)}` : text || '—'; }
function humanize(value) { return String(value || '').replaceAll('_',' ').replace(/\b\w/g, (char) => char.toUpperCase()); }
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = String(value ?? ''); return div.innerHTML; }
