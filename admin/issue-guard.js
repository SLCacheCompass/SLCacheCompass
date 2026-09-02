import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.CACHE_COMPASS_ADMIN_CONFIG;
const form = document.querySelector('#issue-form');
if (form && config?.supabaseUrl && config?.supabaseAnonKey && config?.adminFunctionUrl) {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  let licenses = [];
  let loadedAt = 0;

  refresh();
  supabase.auth.onAuthStateChange((_event, session) => { if (session) refresh(); });

  // Capture phase runs before the existing app.js submit handler. This is only a
  // Back Office safety rail; the live purchase endpoints still need the server-side
  // entitlement RPCs for authoritative enforcement.
  form.addEventListener('submit', guardIssue, true);

  async function refresh() {
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      const params = new URLSearchParams({ q: '', status: '', limit: '1000' });
      const response = await fetch(`${config.adminFunctionUrl}?${params}`, {
        headers: { authorization: `Bearer ${data.session.access_token}` },
      });
      const result = await response.json();
      if (!response.ok) return;
      licenses = Array.isArray(result.licenses) ? result.licenses : [];
      loadedAt = Date.now();
    } catch (error) {
      console.debug('Duplicate-license guard could not refresh.', error);
    }
  }

  async function guardIssue(event) {
    const data = new FormData(form);
    const paymentMethod = String(data.get('paymentMethod') || '').toLowerCase();
    if (paymentMethod === 'test') return;

    const uuid = String(data.get('purchaserAvatarUuid') || '').trim().toLowerCase();
    if (!isUuid(uuid)) return;

    if (Date.now() - loadedAt > 30000) await refresh();
    const existing = licenses.find((license) => licenseMatchesUuid(license, uuid));
    if (!existing) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const message = document.querySelector('#app-message');
    const ending = existing.key_last4 ? ` ending ${existing.key_last4}` : '';
    if (existing.status === 'active') {
      const text = `This avatar already belongs to an active Cache Compass entitlement${ending}. Use Upgrade / Add Alt Capacity instead of issuing another active license.`;
      if (message) message.textContent = text;
      alert(text);
    } else {
      const text = `This avatar already belongs to a ${existing.status} Cache Compass entitlement${ending}. Reactivate or review that entitlement instead of issuing a new active license.`;
      if (message) message.textContent = text;
      alert(text);
    }
  }

  function licenseMatchesUuid(license, uuid) {
    if (String(license.purchaser_avatar_uuid || '').trim().toLowerCase() === uuid) return true;
    for (const avatar of license.avatars || []) {
      if (String(avatar.avatar_uuid || '').trim().toLowerCase() === uuid) return true;
    }
    return false;
  }

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }
}
