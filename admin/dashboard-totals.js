import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.CACHE_COMPASS_ADMIN_CONFIG;
const activeCustomersEl = document.querySelector('#metric-active-customers');
const attachedAltsEl = document.querySelector('#metric-attached-alts');
const resolvedNames = new Map();
let supabase = null;
let refreshRun = 0;

if (config && activeCustomersEl && attachedAltsEl) {
  supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  loadCurrentTotals();
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) loadCurrentTotals();
  });
}

async function loadCurrentTotals() {
  const runId = ++refreshRun;
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
    applyResolvedNameLabels();

    await refreshAvatarNames(licenses, data.session.access_token, runId);
  } catch (error) {
    activeCustomersEl.textContent = '—';
    attachedAltsEl.textContent = '—';
    console.error('Unable to load current dashboard totals', error);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectAvatarUuids(licenses) {
  const uuids = new Set();
  for (const license of licenses) {
    if (license.purchaser_avatar_uuid) uuids.add(String(license.purchaser_avatar_uuid).trim().toLowerCase());
    for (const avatar of license.avatars || []) {
      if (avatar.avatar_uuid) uuids.add(String(avatar.avatar_uuid).trim().toLowerCase());
    }
  }
  return [...uuids].filter(Boolean);
}

async function requestResolvedNames(uuids, accessToken) {
  for (let index = 0; index < uuids.length; index += 50) {
    const batch = uuids.slice(index, index + 50);
    const response = await fetch(config.nameResolverFunctionUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ uuids: batch }),
    });

    if (!response.ok) {
      console.debug('Avatar name resolver returned', response.status);
      continue;
    }

    const result = await response.json();
    for (const row of result.names || []) {
      const uuid = String(row.avatar_uuid || '').trim().toLowerCase();
      if (!uuid) continue;
      resolvedNames.set(uuid, {
        legacyName: String(row.legacy_name || '').trim(),
        displayName: String(row.display_name || '').trim(),
      });
    }
  }
}

async function refreshAvatarNames(licenses, accessToken, runId) {
  if (!config.nameResolverFunctionUrl) return;
  const all = collectAvatarUuids(licenses);
  if (!all.length) return;

  // The first request queues UUIDs. The in-world SL worker resolves them
  // asynchronously, so check the cache again instead of requiring a page reload.
  const delays = [0, 10000, 10000, 10000];
  for (const delay of delays) {
    if (runId !== refreshRun) return;
    if (delay) await sleep(delay);
    if (runId !== refreshRun) return;

    const unresolved = all.filter((uuid) => !resolvedNames.has(uuid));
    if (!unresolved.length) return;

    try {
      await requestResolvedNames(unresolved, accessToken);
      applyResolvedNameLabels();
    } catch (error) {
      console.debug('Avatar name resolver is not available yet.', error);
      return;
    }
  }
}

function lookupName(uuid) {
  return resolvedNames.get(String(uuid || '').trim().toLowerCase()) || null;
}

function ensureLegacyLine(parent, legacyName, className = 'resolved-legacy-name') {
  let line = parent.querySelector(`.${className}`);
  if (!legacyName) {
    if (line) line.remove();
    return;
  }
  if (!line) {
    line = document.createElement('span');
    line.className = className;
    line.style.display = 'block';
    line.style.color = 'var(--muted)';
    line.style.fontSize = '10px';
    const strong = parent.querySelector('strong');
    if (strong) strong.insertAdjacentElement('afterend', line);
    else parent.prepend(line);
  }
  line.textContent = `Legacy: ${legacyName}`;
}

function applyResolvedNameLabels() {
  for (const row of document.querySelectorAll('#customer-rows tr')) {
    const cell = row.querySelector('.name-cell');
    const name = cell?.querySelector('strong');
    const uuid = row.querySelector('.uuid-short')?.getAttribute('title')?.trim();
    if (!cell || !name || !uuid) continue;

    const resolved = lookupName(uuid);
    if (resolved) {
      name.textContent = resolved.displayName || resolved.legacyName || uuid;
      ensureLegacyLine(cell, resolved.legacyName);
    } else if (/^Customer •••• /.test(name.textContent || '')) {
      name.textContent = uuid;
    }
  }

  const drawerName = document.querySelector('#drawer-name');
  const drawerUuidElement = document.querySelector('#drawer-uuid');
  const drawerUuid = drawerUuidElement?.textContent?.trim();
  if (drawerName && drawerUuid && !drawerUuid.startsWith('No primary')) {
    const resolved = lookupName(drawerUuid);
    if (resolved) {
      drawerName.textContent = resolved.displayName || resolved.legacyName || drawerUuid;
      let legacy = document.querySelector('#drawer-legacy-name');
      if (!legacy) {
        legacy = document.createElement('p');
        legacy.id = 'drawer-legacy-name';
        legacy.className = 'muted';
        legacy.style.margin = '0 0 2px';
        drawerUuidElement.parentElement?.insertBefore(legacy, drawerUuidElement);
      }
      legacy.textContent = resolved.legacyName ? `Legacy: ${resolved.legacyName}` : '';
    } else if (/^Customer •••• /.test(drawerName.textContent || '')) {
      drawerName.textContent = drawerUuid;
    }
  }

  for (const row of document.querySelectorAll('.avatar-line')) {
    const uuidElement = row.querySelector('.avatar-uuid');
    const nameElement = row.querySelector('.avatar-name');
    const uuid = uuidElement?.textContent?.trim();
    if (!uuid || !nameElement) continue;

    const resolved = lookupName(uuid);
    if (!resolved) continue;
    nameElement.textContent = resolved.displayName || resolved.legacyName || uuid;

    let legacy = row.querySelector('.avatar-legacy-name');
    if (!legacy) {
      legacy = document.createElement('p');
      legacy.className = 'avatar-legacy-name';
      legacy.style.margin = '0';
      legacy.style.color = 'var(--muted)';
      legacy.style.fontSize = '9px';
      nameElement.insertAdjacentElement('afterend', legacy);
    }
    legacy.textContent = resolved.legacyName ? `Legacy: ${resolved.legacyName}` : '';
  }
}

applyResolvedNameLabels();
const fallbackObserver = new MutationObserver(applyResolvedNameLabels);
fallbackObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
