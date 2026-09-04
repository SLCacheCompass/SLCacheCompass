import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.CACHE_COMPASS_ADMIN_CONFIG;
if (config?.supabaseUrl && config?.supabaseAnonKey && config?.adminFunctionUrl && config?.entitlementFunctionUrl) {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  let licenses = [];
  let pending = [];

  installPanel();
  load();
  supabase.auth.onAuthStateChange((_event, session) => { if (session) load(); });

  function installPanel() {
    const dashboard = document.querySelector('#view-dashboard');
    if (!dashboard || document.querySelector('#capacity-approvals-panel')) return;

    const panel = document.createElement('section');
    panel.id = 'capacity-approvals-panel';
    panel.className = 'panel compact-panel';
    panel.hidden = true;
    panel.style.marginBottom = '12px';
    panel.innerHTML = `
      <div class="section-title">
        <div><p class="eyebrow">OWNER REVIEW</p><h3>Capacity approvals</h3></div>
        <span id="capacity-approval-count" class="status-pill suspended">0 pending</span>
      </div>
      <div id="capacity-approval-list" class="activity-list"></div>`;

    const anchor = dashboard.querySelector('.dashboard-grid');
    if (anchor) dashboard.insertBefore(panel, anchor);
    else dashboard.append(panel);
  }

  async function token() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function load() {
    const accessToken = await token();
    if (!accessToken) return;

    try {
      const ready = await fetch(config.entitlementFunctionUrl, { method: 'OPTIONS' });
      if (!ready.ok) return;

      const params = new URLSearchParams({ q: '', status: '', limit: '1000' });
      const licenseResponse = await fetch(`${config.adminFunctionUrl}?${params}`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const licenseResult = await licenseResponse.json();
      if (!licenseResponse.ok) throw new Error(licenseResult.error || 'Could not load licenses');
      licenses = Array.isArray(licenseResult.licenses) ? licenseResult.licenses : [];

      const ids = licenses.map((license) => license.id).filter(Boolean).slice(0, 250);
      const url = new URL(config.entitlementFunctionUrl);
      if (ids.length) url.searchParams.set('licenseIds', ids.join(','));
      const capacityResponse = await fetch(url, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const capacityResult = await capacityResponse.json();
      if (!capacityResponse.ok) throw new Error(capacityResult.error || 'Could not load capacity approvals');

      pending = (Array.isArray(capacityResult.overrideRequests) ? capacityResult.overrideRequests : [])
        .filter((request) => request.status === 'pending')
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

      render();
    } catch (error) {
      console.debug('Capacity approval list is not available yet.', error);
    }
  }

  function render() {
    const panel = document.querySelector('#capacity-approvals-panel');
    const list = document.querySelector('#capacity-approval-list');
    const count = document.querySelector('#capacity-approval-count');
    if (!panel || !list || !count) return;

    panel.hidden = false;
    count.textContent = `${pending.length} pending`;
    list.replaceChildren();

    if (!pending.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No capacity approvals are waiting.';
      list.append(empty);
    }

    for (const request of pending) {
      const license = licenses.find((item) => item.id === request.license_id) || null;
      const row = document.createElement('div');
      row.className = 'activity-row';
      row.style.gridTemplateColumns = 'minmax(150px,1fr) minmax(180px,1.4fr) minmax(120px,.8fr) auto';

      const name = customerName(license);
      const change = `${request.current_capacity} → ${request.requested_capacity} avatars (+${request.requested_slots})`;
      const payment = [String(request.payment_source || '').toUpperCase(), formatAmount(request.gross_amount, request.currency)]
        .filter(Boolean).join(' · ') || 'Manual review';
      const receipt = firstText(request.external_transaction_id, request.purchase_id);
      const holdReason = request.metadata?.hold_reason || '';
      const inactive = license && license.status !== 'active';
      const reasonText = holdReason === 'license_not_active'
        ? `Purchase held because license is ${license?.status || request.metadata?.license_status || 'not active'}. Reactivate it first.`
        : request.requested_capacity > 30
          ? 'Owner approval required above the normal 30-avatar limit.'
          : 'Owner review required.';

      row.innerHTML = `
        <div><strong>${escapeHtml(name)}</strong><p class="muted">${escapeHtml(license ? `•••• ${license.key_last4 || '—'}` : 'License record unavailable')}</p></div>
        <div><strong>${escapeHtml(change)}</strong><p class="muted">${escapeHtml(reasonText)}</p><p class="muted">${escapeHtml(receipt ? `Receipt: ${shortReceipt(receipt)}` : 'No receipt recorded')}</p></div>
        <div><strong>${escapeHtml(payment)}</strong><p class="muted">${escapeHtml(shortDate(request.created_at))}</p></div>
        <div><button class="mini-button" type="button">${inactive ? 'Reactivate First' : 'Approve'}</button></div>`;

      const button = row.querySelector('button');
      if (inactive) {
        button.disabled = true;
        button.title = 'Reactivate the license in the customer record, then return here to approve the held capacity purchase.';
      } else {
        button.addEventListener('click', () => approve(request, license));
      }
      list.append(row);
    }

    const attention = document.querySelector('#metric-attention');
    if (attention) {
      const nonActive = licenses.filter((license) => license.status !== 'active').length;
      attention.textContent = String(nonActive + pending.length);
    }
  }

  async function approve(request, license) {
    const name = customerName(license);
    const detail = `${name}: approve +${request.requested_slots} slots, taking capacity from ${request.current_capacity} to ${request.requested_capacity}?`;
    const extra = request.requested_capacity > 30
      ? '\n\nThis records the owner-only override above the normal 30-avatar limit.'
      : '';
    if (!confirm(`${detail}${extra}`)) return;

    const note = prompt('Owner note (optional). Cancel to stop:', request.note || '');
    if (note === null) return;
    const accessToken = await token();
    if (!accessToken) {
      alert('Your sign-in expired. Please sign in again.');
      return;
    }

    try {
      const response = await fetch(config.entitlementFunctionUrl, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'approve_override', requestId: request.id, note }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Override approval failed');
      await load();
    } catch (error) {
      alert(`Could not approve the capacity request: ${humanize(error.message)}`);
    }
  }

  function customerName(license) {
    if (!license) return 'Customer';
    const avatars = Array.isArray(license.avatars) ? license.avatars : [];
    const purchaserUuid = String(license.purchaser_avatar_uuid || '').toLowerCase();
    const purchaser = avatars.find((avatar) => String(avatar.avatar_uuid || '').toLowerCase() === purchaserUuid);
    const orderName = (license.orders || []).find((order) => order.purchaser_avatar_name)?.purchaser_avatar_name;
    return purchaser?.avatar_name || orderName || avatars.find((avatar) => avatar.avatar_name)?.avatar_name || license.purchaser_avatar_uuid || 'Customer';
  }

  function formatAmount(value, currency) {
    if (value == null || value === '' || !Number.isFinite(Number(value))) return '';
    const code = String(currency || '').toUpperCase();
    if (code === 'USD') return `$${Number(value).toFixed(2)}`;
    if (['L$','LD','LINDEN'].includes(code)) return `L$${Math.round(Number(value))}`;
    return `${currency || ''} ${Number(value)}`.trim();
  }

  function firstText(...values) {
    for (const value of values) if (value != null && String(value).trim()) return String(value).trim();
    return '';
  }
  function shortReceipt(value) { const text = String(value || ''); return text.length > 22 ? `${text.slice(0,10)}…${text.slice(-7)}` : text; }
  function shortDate(value) { return value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; }
  function humanize(value) { return String(value || 'Request failed').replaceAll('_', ' '); }
  function escapeHtml(value) { const div = document.createElement('div'); div.textContent = String(value ?? ''); return div.innerHTML; }
}