import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.CACHE_COMPASS_ADMIN_CONFIG;
if (!config?.supabaseUrl || !config?.supabaseAnonKey) throw new Error('Back Office config missing');

const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
const endpoint = `${config.supabaseUrl}/functions/v1/admin-influencers`;

injectStyles();
const { tab, view } = injectView();
wireNavigation(tab, view);

let items = [];
let editingId = null;

const els = {
  rows: view.querySelector('#influencer-rows'),
  count: view.querySelector('#influencer-count'),
  waiting: view.querySelector('#influencer-waiting'),
  posted: view.querySelector('#influencer-posted'),
  sales: view.querySelector('#influencer-sales'),
  search: view.querySelector('#influencer-search'),
  status: view.querySelector('#influencer-status-filter'),
  form: view.querySelector('#influencer-form'),
  formWrap: view.querySelector('#influencer-form-wrap'),
  formTitle: view.querySelector('#influencer-form-title'),
  message: view.querySelector('#influencer-message'),
};

view.querySelector('#influencer-add').addEventListener('click', () => openForm());
view.querySelector('#influencer-cancel').addEventListener('click', closeForm);
els.search.addEventListener('input', render);
els.status.addEventListener('change', render);
els.form.addEventListener('submit', saveItem);
els.rows.addEventListener('click', handleRowAction);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && view.classList.contains('active')) loadItems();
});

async function authFetch(options = {}) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Your sign-in expired. Please sign in again.');
  const headers = {
    authorization: `Bearer ${data.session.access_token}`,
    ...(options.headers || {}),
  };
  const response = await fetch(endpoint, { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(humanError(result.error));
  return result;
}

async function loadItems() {
  els.message.textContent = 'Loading influencer tracker…';
  try {
    const result = await authFetch({ method: 'GET' });
    items = result.items || [];
    render();
    els.message.textContent = '';
  } catch (error) {
    els.message.textContent = error.message;
  }
}

function render() {
  const q = els.search.value.trim().toLowerCase();
  const status = els.status.value;
  const filtered = items.filter((item) => {
    const haystack = [item.creator_name, item.sl_avatar_name, item.platform, item.referral_code, item.notes]
      .filter(Boolean).join(' ').toLowerCase();
    return (!q || haystack.includes(q)) && (!status || item.status === status);
  });

  els.rows.innerHTML = filtered.map((item) => {
    const post = item.post_url
      ? `<a class="influencer-link" href="${escapeAttr(item.post_url)}" target="_blank" rel="noopener">Open post</a>${item.post_date ? `<div class="muted">${escapeHtml(item.post_date)}</div>` : ''}`
      : '<span class="muted">Not posted yet</span>';
    const license = item.license_id ? '<span class="status-pill active">Comp linked</span>' : '<span class="muted">—</span>';
    return `<tr>
      <td><strong>${escapeHtml(item.creator_name)}</strong><div class="muted">${escapeHtml(item.sl_avatar_name || '—')}</div></td>
      <td>${escapeHtml(item.platform || '—')}</td>
      <td><span class="status-pill ${statusClass(item.status)}">${escapeHtml(statusLabel(item.status))}</span></td>
      <td>${license}<div class="muted">${escapeHtml(item.deliverable || '')}</div></td>
      <td>${post}</td>
      <td>${Number(item.views || 0).toLocaleString()}<div class="muted">${Number(item.engagement || 0).toLocaleString()} engagement</div></td>
      <td><code>${escapeHtml(item.referral_code || '—')}</code><div class="muted">${Number(item.referral_clicks || 0)} clicks</div></td>
      <td>${Number(item.attributed_sales || 0)}</td>
      <td class="row-actions"><button class="mini-button" type="button" data-action="edit" data-id="${item.id}">Edit</button><button class="mini-button" type="button" data-action="delete" data-id="${item.id}">Delete</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="9" class="muted" style="padding:24px">No matching creators.</td></tr>';

  els.count.textContent = `${filtered.length} creator${filtered.length === 1 ? '' : 's'}`;
  els.waiting.textContent = items.filter((i) => ['agreed','comped','waiting_to_post'].includes(i.status)).length;
  els.posted.textContent = items.filter((i) => i.status === 'posted').length;
  els.sales.textContent = items.reduce((sum, i) => sum + Number(i.attributed_sales || 0), 0);
}

function handleRowAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const item = items.find((row) => row.id === button.dataset.id);
  if (!item) return;
  if (button.dataset.action === 'edit') openForm(item);
  if (button.dataset.action === 'delete') deleteItem(item);
}

function openForm(item = null) {
  editingId = item?.id || null;
  els.form.reset();
  els.formTitle.textContent = item ? `Edit ${item.creator_name}` : 'Add influencer';
  els.formWrap.hidden = false;
  const set = (name, value) => { const input = els.form.elements.namedItem(name); if (input) input.value = value ?? ''; };
  if (item) {
    set('creatorName', item.creator_name);
    set('slAvatarName', item.sl_avatar_name);
    set('slAvatarUuid', item.sl_avatar_uuid);
    set('licenseId', item.license_id);
    set('platform', item.platform);
    set('deliverable', item.deliverable);
    set('status', item.status);
    set('postDate', item.post_date);
    set('postUrl', item.post_url);
    set('views', item.views || 0);
    set('engagement', item.engagement || 0);
    set('referralCode', item.referral_code);
    set('referralClicks', item.referral_clicks || 0);
    set('attributedSales', item.attributed_sales || 0);
    set('notes', item.notes);
  } else {
    set('status', 'waiting_to_post');
    set('views', 0);
    set('engagement', 0);
    set('referralClicks', 0);
    set('attributedSales', 0);
  }
  els.formWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeForm() {
  editingId = null;
  els.formWrap.hidden = true;
  els.form.reset();
}

async function saveItem(event) {
  event.preventDefault();
  const submit = els.form.querySelector('button[type="submit"]');
  const payload = Object.fromEntries(new FormData(els.form));
  for (const key of Object.keys(payload)) if (payload[key] === '') delete payload[key];
  payload.action = editingId ? 'update' : 'create';
  if (editingId) payload.id = editingId;

  submit.disabled = true;
  els.message.textContent = editingId ? 'Saving changes…' : 'Adding creator…';
  try {
    await authFetch({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    closeForm();
    await loadItems();
    els.message.textContent = editingId ? 'Influencer updated.' : 'Influencer added.';
  } catch (error) {
    els.message.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}

async function deleteItem(item) {
  if (!confirm(`Delete ${item.creator_name} from the influencer tracker? This does not delete their customer or license.`)) return;
  els.message.textContent = `Removing ${item.creator_name}…`;
  try {
    await authFetch({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id: item.id }),
    });
    await loadItems();
    els.message.textContent = `${item.creator_name} removed from the tracker.`;
  } catch (error) {
    els.message.textContent = error.message;
  }
}

function wireNavigation(tabEl, viewEl) {
  tabEl.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((el) => el.classList.remove('active'));
    document.querySelectorAll('.view').forEach((el) => el.classList.remove('active'));
    tabEl.classList.add('active');
    viewEl.classList.add('active');
    loadItems();
  });
  document.querySelectorAll('.tab').forEach((el) => {
    if (el === tabEl) return;
    el.addEventListener('click', () => {
      tabEl.classList.remove('active');
      viewEl.classList.remove('active');
    }, true);
  });
}

function injectView() {
  const nav = document.querySelector('.tabs');
  const app = document.querySelector('#app');
  const releasesTab = nav?.querySelector('[data-view="releases"]');
  const tab = document.createElement('button');
  tab.className = 'tab';
  tab.dataset.view = 'influencers';
  tab.textContent = 'Influencers';
  if (releasesTab) nav.insertBefore(tab, releasesTab); else nav?.appendChild(tab);

  const view = document.createElement('section');
  view.id = 'view-influencers';
  view.className = 'view';
  view.innerHTML = `
    <div class="view-heading split">
      <div><p class="eyebrow">MARKETING</p><h2>Influencer Tracker</h2><p class="muted">Track comps, posting status, engagement, referral codes and attributed sales.</p></div>
      <button id="influencer-add" class="button gold" type="button">+ Add Creator</button>
    </div>
    <div class="metric-grid influencer-metrics">
      <div class="metric" style="cursor:default"><span>Total creators</span><strong id="influencer-count">0 creators</strong></div>
      <div class="metric" style="cursor:default"><span>Waiting to post</span><strong id="influencer-waiting">0</strong></div>
      <div class="metric" style="cursor:default"><span>Posted</span><strong id="influencer-posted">0</strong></div>
      <div class="metric" style="cursor:default"><span>Attributed sales</span><strong id="influencer-sales">0</strong></div>
    </div>
    <section id="influencer-form-wrap" class="panel influencer-form-panel" hidden>
      <div class="section-title"><div><p class="eyebrow">PARTNERSHIP</p><h3 id="influencer-form-title">Add influencer</h3></div></div>
      <form id="influencer-form" class="influencer-form">
        <label>Creator / public name<input name="creatorName" required></label>
        <label>SL avatar name<input name="slAvatarName"></label>
        <label>SL avatar UUID<input name="slAvatarUuid" placeholder="Optional"></label>
        <label>Linked license ID<input name="licenseId" placeholder="Optional"></label>
        <label>Platform<input name="platform" placeholder="Facebook, YouTube, Flickr, Primfeed…"></label>
        <label>Status<select name="status"><option value="contacted">Contacted</option><option value="agreed">Agreed</option><option value="comped">Comped</option><option value="waiting_to_post">Waiting to post</option><option value="posted">Posted</option><option value="declined">Declined</option><option value="inactive">Inactive</option></select></label>
        <label class="wide">Agreed deliverable<input name="deliverable" placeholder="Example: Product demo / post using Cache Compass"></label>
        <label>Post date<input name="postDate" type="date"></label>
        <label>Post URL<input name="postUrl" type="url" placeholder="https://"></label>
        <label>Views<input name="views" type="number" min="0" value="0"></label>
        <label>Likes / comments<input name="engagement" type="number" min="0" value="0"></label>
        <label>Referral code<input name="referralCode" placeholder="creator-name"></label>
        <label>Referral clicks<input name="referralClicks" type="number" min="0" value="0"></label>
        <label>Attributed sales<input name="attributedSales" type="number" min="0" value="0"></label>
        <label class="wide">Notes<textarea name="notes" rows="3"></textarea></label>
        <div class="wide influencer-form-actions"><button class="button quiet" id="influencer-cancel" type="button">Cancel</button><button class="button gold" type="submit">Save Creator</button></div>
      </form>
    </section>
    <div class="filterbar influencer-filterbar">
      <input id="influencer-search" type="search" placeholder="Search creator, avatar, platform, referral code or notes">
      <select id="influencer-status-filter"><option value="">All statuses</option><option value="contacted">Contacted</option><option value="agreed">Agreed</option><option value="comped">Comped</option><option value="waiting_to_post">Waiting to post</option><option value="posted">Posted</option><option value="declined">Declined</option><option value="inactive">Inactive</option></select>
    </div>
    <p id="influencer-message" class="message" role="status"></p>
    <div class="table-shell"><table class="data-table influencer-table"><thead><tr><th>Creator</th><th>Platform</th><th>Status</th><th>Comp / deliverable</th><th>Post</th><th>Reach</th><th>Referral</th><th>Sales</th><th>Actions</th></tr></thead><tbody id="influencer-rows"></tbody></table></div>
  `;

  const releasesView = app?.querySelector('#view-releases');
  if (releasesView) app.insertBefore(view, releasesView); else app?.appendChild(view);
  return { tab, view };
}

function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .influencer-metrics{grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:14px}
    .influencer-metrics .metric strong{font-size:22px}
    .influencer-form-panel{margin-bottom:14px}
    .influencer-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .influencer-form .wide{grid-column:1/-1}
    .influencer-form-actions{display:flex;justify-content:flex-end;gap:8px}
    .influencer-filterbar{grid-template-columns:minmax(300px,1fr) 190px;margin-bottom:8px}
    .influencer-link{color:var(--gold);text-decoration:none}
    .influencer-link:hover{text-decoration:underline}
    .influencer-table code{color:var(--gold);font-size:10px}
    @media(max-width:900px){.influencer-metrics{grid-template-columns:1fr 1fr}.influencer-form{grid-template-columns:1fr}.influencer-form .wide{grid-column:auto}.influencer-filterbar{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function statusLabel(status) {
  return ({ contacted:'Contacted', agreed:'Agreed', comped:'Comped', waiting_to_post:'Waiting to post', posted:'Posted', declined:'Declined', inactive:'Inactive' })[status] || status;
}

function statusClass(status) {
  if (status === 'posted') return 'active';
  if (status === 'declined' || status === 'inactive') return 'revoked';
  if (status === 'waiting_to_post' || status === 'comped' || status === 'agreed') return 'suspended';
  return '';
}

function humanError(code) {
  const known = {
    authentication_required: 'Your sign-in expired. Please sign in again.',
    invalid_session: 'Your sign-in expired. Please sign in again.',
    admin_access_required: 'Your Back Office account is not authorized.',
    creator_name_required: 'Creator name is required.',
    invalid_avatar_uuid: 'The avatar UUID is not valid.',
    invalid_license_id: 'The linked license ID is not valid.',
    invalid_metrics: 'Views, engagement, clicks and sales must be whole numbers of zero or more.',
    duplicate_creator: 'That avatar or referral code is already in the tracker.',
    influencer_operation_failed: 'The influencer tracker could not save that change.',
  };
  return known[code] || String(code || 'Influencer tracker error').replaceAll('_', ' ');
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#96;');
}
