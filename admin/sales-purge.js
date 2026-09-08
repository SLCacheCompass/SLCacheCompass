import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.CACHE_COMPASS_ADMIN_CONFIG;
if (!config?.supabaseUrl || !config?.supabaseAnonKey || !config?.adminFunctionUrl || !config?.purgeFunctionUrl) {
  console.debug('Sales purge control is not configured.');
} else {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  let licenses = [];
  let decorating = false;

  initialize();

  async function initialize() {
    await loadData();
    installObserver();
    decorateSalesTable();

    supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session) return;
      await loadData();
      decorateSalesTable();
    });

    const appMessage = document.querySelector('#app-message');
    if (appMessage) {
      const messageObserver = new MutationObserver(() => {
        if ((appMessage.textContent || '').trim() === 'Purge complete.') location.reload();
      });
      messageObserver.observe(appMessage, { childList: true, characterData: true, subtree: true });
    }
  }

  async function authToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function loadData() {
    const token = await authToken();
    if (!token) return;
    try {
      const params = new URLSearchParams({ q: '', status: '', limit: '1000' });
      const response = await fetch(`${config.adminFunctionUrl}?${params}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not load sales purge data');
      licenses = Array.isArray(body.licenses) ? body.licenses : [];
    } catch (error) {
      console.debug('Sales purge data load failed.', error);
    }
  }

  function installObserver() {
    const view = document.querySelector('#view-sales');
    if (!view) return;
    const observer = new MutationObserver(() => decorateSalesTable());
    observer.observe(view, { childList: true, subtree: true });
    document.querySelector('[data-view="sales"]')?.addEventListener('click', () => setTimeout(decorateSalesTable, 30));
  }

  function decorateSalesTable() {
    if (decorating) return;
    const table = document.querySelector('#view-sales .data-table');
    const body = document.querySelector('#sales-rows');
    if (!table || !body) return;
    decorating = true;
    try {
      const headerRow = table.querySelector('thead tr');
      if (headerRow && !headerRow.querySelector('[data-sales-purge-heading]')) {
        const th = document.createElement('th');
        th.dataset.salesPurgeHeading = '1';
        th.textContent = 'Actions';
        headerRow.append(th);
      }

      for (const row of body.querySelectorAll('tr')) {
        if (row.querySelector('[data-sales-purge-cell]') || row.querySelector('.row-actions')) continue;
        if (row.cells.length === 1) {
          row.cells[0].colSpan = Math.max(Number(row.cells[0].colSpan || 1), headerRow?.cells.length || 10);
          continue;
        }

        const purchase = purchaseForRenderedRow(row);
        const cell = document.createElement('td');
        cell.dataset.salesPurgeCell = '1';
        cell.className = 'row-actions';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mini-button danger';
        button.textContent = 'Purge';
        if (!purchase) {
          button.disabled = true;
          button.title = 'A single internal purchase record could not be identified for this row.';
        } else {
          button.title = 'Owner-only permanent purge of this Cache Compass internal sale record';
          button.addEventListener('click', (event) => {
            event.stopPropagation();
            runSalePurge(purchase.id);
          });
        }
        cell.append(button);
        row.append(cell);
      }
    } finally {
      decorating = false;
    }
  }

  function purchaseForRenderedRow(row) {
    const text = row.textContent || '';
    const endingMatch = text.match(/••••\s*([A-Z0-9]{1,12})/i);
    const ending = endingMatch?.[1]?.toUpperCase() || '';
    const receiptCell = row.cells.length >= 8 ? row.cells[7]?.textContent?.trim() || '' : '';

    let candidateLicenses = ending
      ? licenses.filter((license) => String(license.key_last4 || '').toUpperCase() === ending)
      : licenses;
    let candidates = candidateLicenses.flatMap((license) => (license.purchases || []).map((purchase) => ({ purchase, license })));

    if (receiptCell && receiptCell !== '—') {
      const byReceipt = candidates.filter(({ purchase }) => purchaseReceiptAliases(purchase).some((value) => shortReceipt(value) === receiptCell));
      if (byReceipt.length === 1) return byReceipt[0].purchase;
      if (byReceipt.length > 1) candidates = byReceipt;
    }

    if (ending) {
      const byEnding = candidates.filter(({ license }) => String(license.key_last4 || '').toUpperCase() === ending);
      if (byEnding.length === 1) return byEnding[0].purchase;
    }
    return candidates.length === 1 ? candidates[0].purchase : null;
  }

  function purchaseReceiptAliases(purchase) {
    return [purchase.processor_transaction_id, purchase.external_order_id, purchase.id].filter(Boolean).map(String);
  }

  async function runSalePurge(purchaseId) {
    const token = await authToken();
    if (!token) {
      alert('Your sign-in expired. Please sign in again.');
      return;
    }

    try {
      const previewResponse = await fetch(config.purgeFunctionUrl, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'preview', kind: 'sale', id: purchaseId }),
      });
      const preview = await previewResponse.json().catch(() => ({}));
      if (!previewResponse.ok) throw new Error(preview.detail || preview.error || 'Could not prepare purge');

      const removed = (preview.items || []).map((item) => `• ${item}`).join('\n');
      const retained = (preview.retained || []).map((item) => `• ${item}`).join('\n');
      if (!preview.canPurge) {
        alert(`${preview.label || 'This sale'} cannot be purged.\n\n${preview.note || ''}${retained ? `\n\nMust be retained:\n${retained}` : ''}`);
        return;
      }

      const warning = `${preview.label || 'Purge this sale'}\n\nWILL BE REMOVED:\n${removed || '• Selected internal sale record'}${retained ? `\n\nWILL BE RETAINED:\n${retained}` : ''}\n\n${preview.note || ''}\n\nType PURGE to permanently remove the eligible Cache Compass records.`;
      const confirmation = prompt(warning) ?? '';
      if (confirmation.trim().toUpperCase() !== 'PURGE') return;

      const purgeResponse = await fetch(config.purgeFunctionUrl, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'purge', kind: 'sale', id: purchaseId, confirmation: 'PURGE' }),
      });
      const result = await purgeResponse.json().catch(() => ({}));
      if (!purgeResponse.ok) throw new Error(result.detail || result.error || 'Purge failed');
      location.reload();
    } catch (error) {
      alert(`Could not purge this sale: ${error.message}`);
    }
  }

  function shortReceipt(value) {
    const text = String(value || '');
    return text.length > 20 ? `${text.slice(0,10)}…${text.slice(-6)}` : text || '—';
  }
}
