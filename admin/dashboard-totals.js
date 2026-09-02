import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.CACHE_COMPASS_ADMIN_CONFIG;
const activeCustomersEl = document.querySelector('#metric-active-customers');
const attachedAltsEl = document.querySelector('#metric-attached-alts');

if (config && activeCustomersEl && attachedAltsEl) {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  loadCurrentTotals();
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) loadCurrentTotals();
  });
}

async function loadCurrentTotals() {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;

    const params = new URLSearchParams({ q: '', status: '', limit: '1000' });
    const response = await fetch(`${config.adminFunctionUrl}?${params}`, {
      headers: { authorization: `Bearer ${data.session.access_token}` },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Request failed');

    const licenses = Array.isArray(result.licenses) ? result.licenses : [];
    const activeCustomerKeys = new Set();
    let attachedAlts = 0;

    for (const license of licenses) {
      if (license.status !== 'active') continue;

      const avatars = Array.isArray(license.avatars) ? license.avatars : [];
      const purchaserUuid = String(license.purchaser_avatar_uuid || '').trim().toLowerCase();
      const primaryUuid = purchaserUuid || String(avatars[0]?.avatar_uuid || '').trim().toLowerCase();
      const email = (license.orders || []).find((order) => order.purchaser_email)?.purchaser_email || '';
      const customerKey = primaryUuid ? `uuid:${primaryUuid}` : email ? `email:${String(email).toLowerCase()}` : `license:${license.id}`;
      activeCustomerKeys.add(customerKey);

      for (const avatar of avatars) {
        const avatarUuid = String(avatar.avatar_uuid || '').trim().toLowerCase();
        if (!avatarUuid) continue;
        if (primaryUuid && avatarUuid === primaryUuid) continue;
        attachedAlts += 1;
      }
    }

    activeCustomersEl.textContent = String(activeCustomerKeys.size);
    attachedAltsEl.textContent = String(attachedAlts);
  } catch (error) {
    activeCustomersEl.textContent = '—';
    attachedAltsEl.textContent = '—';
    console.error('Unable to load current dashboard totals', error);
  }
}
