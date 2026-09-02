import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.CACHE_COMPASS_ADMIN_CONFIG;
if (!config?.deleteLicenseFunctionUrl || !config?.supabaseUrl || !config?.supabaseAnonKey) {
  console.debug('License delete control is not configured.');
} else {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  let endpointReady = false;

  initialize();

  async function initialize() {
    endpointReady = await checkEndpoint();
    if (!endpointReady) return;
    addDeleteButtons();
    const observer = new MutationObserver(addDeleteButtons);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function checkEndpoint() {
    try {
      const response = await fetch(config.deleteLicenseFunctionUrl, { method: 'OPTIONS' });
      return response.ok;
    } catch {
      return false;
    }
  }

  function readLicenseInfo(block) {
    const heading = block.querySelector('.license-block-head h4')?.textContent || '';
    const match = heading.match(/(3|5|10)-Avatar License\s*·\s*••••\s*([A-Z0-9]+)/i);
    if (!match) return null;

    const receiptText = [...block.querySelectorAll('.history-row')]
      .map((row) => row.textContent || '')
      .find((text) => text.includes('Receipt / transaction:')) || '';
    const externalTransactionId = receiptText.includes('Receipt / transaction:')
      ? receiptText.split('Receipt / transaction:').slice(1).join('Receipt / transaction:').trim()
      : '';

    return {
      tier: Number(match[1]),
      keyLast4: match[2].toUpperCase(),
      externalTransactionId,
    };
  }

  function addDeleteButtons() {
    if (!endpointReady) return;
    for (const block of document.querySelectorAll('.license-block')) {
      if (block.querySelector('[data-delete-license-record]')) continue;
      const info = readLicenseInfo(block);
      if (!info) continue;

      const toolbar = block.querySelector('.license-toolbar');
      if (!toolbar) continue;

      const button = document.createElement('button');
      button.className = 'mini-button danger';
      button.type = 'button';
      button.dataset.deleteLicenseRecord = '1';
      button.textContent = 'Delete Record';
      button.title = 'Permanently delete this license record. Use this for tests or erroneous records only.';
      button.addEventListener('click', (event) => deleteLicenseRecord(event, info));
      toolbar.append(button);
    }
  }

  async function deleteLicenseRecord(event, info) {
    event.stopPropagation();

    const warning = `Permanently delete the ${info.tier}-avatar license ending ${info.keyLast4}?\n\nThis removes the license and its linked Cache Compass license data. It cannot be undone. Real customer sales should normally be revoked instead.\n\nType DELETE ${info.keyLast4} to continue.`;
    const confirmation = prompt(warning) ?? '';
    if (confirmation.trim().toUpperCase() !== `DELETE ${info.keyLast4}`) return;

    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Deleting…';

    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('Your sign-in expired. Please sign in again.');

      const response = await fetch(config.deleteLicenseFunctionUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${data.session.access_token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          tier: info.tier,
          keyLast4: info.keyLast4,
          externalTransactionId: info.externalTransactionId || null,
          confirmation,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Delete failed');

      location.reload();
    } catch (error) {
      alert(`Could not delete this license record: ${error.message}`);
      button.disabled = false;
      button.textContent = 'Delete Record';
    }
  }
}
