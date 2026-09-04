import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.CACHE_COMPASS_ADMIN_CONFIG;
if (!config?.supabaseUrl || !config?.supabaseAnonKey || !config?.adminFunctionUrl) {
  console.debug('Back Office operations module is not configured.');
} else {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  let licenses = [];
  let capacityEvents = [];
  let customerGroups = [];
  let entitlementReady = false;
  let salesObserver = null;

  initialize();

  async function initialize() {
    installReleaseFilename();
    installSalesUi();
    installSearchBridges();
    installCapacityButton();
    await loadData();

    supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) await loadData();
    });

    const drawerObserver = new MutationObserver(() => installCapacityButton());
    drawerObserver.observe(document.querySelector('#customer-drawer') || document.body, { childList: true, subtree: true });
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
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load Back Office data');
      licenses = Array.isArray(result.licenses) ? result.licenses : [];
      customerGroups = groupCustomers(licenses);
    } catch (error) {
      console.debug('Operations data load failed.', error);
      return;
    }

    capacityEvents = [];
    entitlementReady = false;
    if (config.entitlementFunctionUrl) {
      try {
        const ready = await fetch(config.entitlementFunctionUrl, {
          method: 'OPTIONS',
          headers: { authorization: `Bearer ${token}` },
        });
        entitlementReady = ready.ok;
        if (entitlementReady) {
          const ids = licenses.map((license) => license.id).filter(Boolean).slice(0, 250);
          const url = new URL(config.entitlementFunctionUrl);
          if (ids.length) url.searchParams.set('licenseIds', ids.join(','));
          const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
          if (response.ok) {
            const result = await response.json();
            capacityEvents = Array.isArray(result.events) ? result.events : [];
          }
        }
      } catch (error) {
        console.debug('Entitlement service is not live yet.', error);
      }
    }

    installCapacityButton();
    if (document.querySelector('#view-sales')?.classList.contains('active')) renderSales();
  }

  function groupCustomers(items) {
    const groups = new Map();
    for (const license of items) {
      const email = (license.orders || []).find((order) => order.purchaser_email)?.purchaser_email || '';
      const firstAvatar = Array.isArray(license.avatars) ? license.avatars[0] : null;
      const primaryUuid = String(license.purchaser_avatar_uuid || firstAvatar?.avatar_uuid || '').toLowerCase();
      const key = license.customer_id
        ? `customer:${license.customer_id}`
        : email
          ? `email:${email.toLowerCase()}`
          : primaryUuid
            ? `uuid:${primaryUuid}`
            : `license:${license.id}`;
      if (!groups.has(key)) groups.set(key, { key, email, primaryUuid, customerId: license.customer_id || '', licenses: [] });
      const group = groups.get(key);
      group.licenses.push(license);
      if (!group.email && email) group.email = email;
      if (!group.primaryUuid && primaryUuid) group.primaryUuid = primaryUuid;
      if (!group.customerId && license.customer_id) group.customerId = license.customer_id;
    }
    return [...groups.values()];
  }

  function currentDrawerGroup() {
    const uuidText = document.querySelector('#drawer-uuid')?.textContent?.trim().toLowerCase() || '';
    const primaryUuid = isUuid(uuidText) ? uuidText : '';
    let email = '';
    for (const chip of document.querySelectorAll('#customer-summary .summary-chip')) {
      if (chip.querySelector('span')?.textContent?.trim() === 'Email') {
        const value = chip.querySelector('strong')?.textContent?.trim() || '';
        if (value && value !== 'Not recorded') email = value.toLowerCase();
      }
    }
    if (primaryUuid) {
      const byUuid = customerGroups.find((group) => group.primaryUuid === primaryUuid);
      if (byUuid) return byUuid;
    }
    if (email) return customerGroups.find((group) => group.email.toLowerCase() === email) || null;
    return null;
  }

  function activeEntitlement(group) {
    return [...(group?.licenses || [])]
      .filter((license) => license.status === 'active')
      .sort((a, b) => {
        const capacityDiff = licenseCapacity(b) - licenseCapacity(a);
        if (capacityDiff) return capacityDiff;
        return new Date(a.created_at || 0) - new Date(b.created_at || 0);
      })[0] || null;
  }

  function installCapacityButton() {
    const oldButton = document.querySelector('#drawer-add-license');
    if (!oldButton || oldButton.dataset.capacityWorkflow === '1') return;

    const button = oldButton.cloneNode(true);
    button.dataset.capacityWorkflow = '1';
    button.textContent = 'Upgrade / Add Alt Capacity';
    button.title = 'Add avatar slots to the customer’s existing active entitlement';
    oldButton.replaceWith(button);
    button.addEventListener('click', openCapacityModal);
  }

  function ensureCapacityModal() {
    if (document.querySelector('#capacity-modal')) return document.querySelector('#capacity-modal');
    const wrapper = document.createElement('div');
    wrapper.id = 'capacity-modal';
    wrapper.className = 'modal';
    wrapper.hidden = true;
    wrapper.innerHTML = `
      <div class="modal-backdrop" data-close-capacity></div>
      <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="capacity-title">
        <div class="section-title">
          <div><p class="eyebrow">ENTITLEMENT</p><h2 id="capacity-title">Upgrade / Add Alt Capacity</h2><p id="capacity-context" class="muted"></p></div>
          <button class="icon-button" type="button" data-close-capacity aria-label="Close">×</button>
        </div>
        <form id="capacity-form" class="form-grid">
          <label>Slots to add<input name="slotsToAdd" type="number" min="1" max="250" step="1" value="3" required></label>
          <label>Record type<select name="recordType"><option value="upgrade">Upgrade</option><option value="gift">Gift</option><option value="comp">Comp</option><option value="manual_adjustment">Manual adjustment</option></select></label>
          <label>Payment source<select name="paymentSource"><option value="usd">USD</option><option value="linden">L$</option><option value="manual">Manual</option><option value="test">Test</option></select></label>
          <label>Currency<input name="currency" value="USD" maxlength="12"></label>
          <label>Gross<input name="grossAmount" type="number" min="0" step="0.01" placeholder="Optional"></label>
          <label>Fees<input name="feeAmount" type="number" min="0" step="0.01" placeholder="Optional"></label>
          <label>Net<input name="netAmount" type="number" step="0.01" placeholder="Optional; calculated if gross + fees are given"></label>
          <label>Receipt / transaction<input name="externalTransactionId" maxlength="200" placeholder="Recommended for paid changes"></label>
          <label class="wide"><input name="ownerOverride" type="checkbox" style="width:auto;margin-right:7px"> Owner override — allow total capacity above 30</label>
          <label class="wide">Note<textarea name="note" rows="3" placeholder="Reason, support context, or payment note"></textarea></label>
          <button class="button gold" type="submit">Apply Capacity</button>
        </form>
        <p id="capacity-message" class="message" role="status"></p>
      </section>`;
    document.body.append(wrapper);
    for (const close of wrapper.querySelectorAll('[data-close-capacity]')) close.addEventListener('click', () => { wrapper.hidden = true; });
    wrapper.querySelector('#capacity-form').addEventListener('submit', submitCapacity);
    wrapper.querySelector('[name="paymentSource"]').addEventListener('change', (event) => {
      const currency = wrapper.querySelector('[name="currency"]');
      if (event.target.value === 'linden') currency.value = 'L$';
      else if (currency.value === 'L$') currency.value = 'USD';
    });
    wrapper.querySelector('[name="slotsToAdd"]').addEventListener('input', updateCapacityContext);
    wrapper.querySelector('[name="ownerOverride"]').addEventListener('change', updateCapacityContext);
    return wrapper;
  }

  let modalEntitlement = null;
  let modalGroup = null;

  function openCapacityModal() {
    const modal = ensureCapacityModal();
    const message = modal.querySelector('#capacity-message');
    message.textContent = '';
    modalGroup = currentDrawerGroup();
    modalEntitlement = activeEntitlement(modalGroup);

    if (!entitlementReady) {
      message.textContent = 'The entitlement capacity service has not been deployed yet.';
      modal.querySelector('#capacity-form button[type="submit"]').disabled = true;
    } else if (!modalEntitlement) {
      message.textContent = 'No active entitlement was found. Reactivate the appropriate license first.';
      modal.querySelector('#capacity-form button[type="submit"]').disabled = true;
    } else {
      modal.querySelector('#capacity-form button[type="submit"]').disabled = false;
    }
    modal.querySelector('#capacity-form').reset();
    modal.querySelector('[name="slotsToAdd"]').value = '3';
    modal.querySelector('[name="currency"]').value = 'USD';
    updateCapacityContext();
    modal.hidden = false;
  }

  function updateCapacityContext() {
    const modal = document.querySelector('#capacity-modal');
    if (!modal) return;
    const current = modalEntitlement ? licenseCapacity(modalEntitlement) : 0;
    const add = Number(modal.querySelector('[name="slotsToAdd"]')?.value || 0);
    const result = current + (Number.isFinite(add) ? add : 0);
    const override = modal.querySelector('[name="ownerOverride"]')?.checked;
    const customerName = document.querySelector('#drawer-name')?.textContent?.trim() || 'Customer';
    let text = modalEntitlement
      ? `${customerName}: ${current} current slots + ${add || 0} = ${result} total.`
      : `${customerName}: no active entitlement selected.`;
    if (result > 30 && !override) text += ' Totals above 30 require the owner override checkbox.';
    if (result > 30 && override) text += ' Owner override will be recorded in the audit trail.';
    modal.querySelector('#capacity-context').textContent = text;
  }

  async function submitCapacity(event) {
    event.preventDefault();
    const modal = document.querySelector('#capacity-modal');
    const message = modal.querySelector('#capacity-message');
    if (!entitlementReady || !modalEntitlement) return;

    const form = new FormData(event.currentTarget);
    const slotsToAdd = Number(form.get('slotsToAdd'));
    const current = licenseCapacity(modalEntitlement);
    const resultCapacity = current + slotsToAdd;
    const ownerOverride = form.get('ownerOverride') === 'on';
    if (resultCapacity > 30 && !ownerOverride) {
      message.textContent = 'Capacity above 30 requires the owner override checkbox.';
      return;
    }

    const token = await authToken();
    if (!token) {
      message.textContent = 'Your sign-in expired. Please sign in again.';
      return;
    }

    const payload = {
      action: 'add_capacity',
      licenseId: modalEntitlement.id,
      customerId: modalGroup?.customerId || null,
      primaryUuid: modalGroup?.primaryUuid || null,
      slotsToAdd,
      recordType: String(form.get('recordType') || 'upgrade'),
      paymentSource: String(form.get('paymentSource') || 'manual'),
      currency: String(form.get('currency') || ''),
      grossAmount: valueOrNull(form.get('grossAmount')),
      feeAmount: valueOrNull(form.get('feeAmount')),
      netAmount: valueOrNull(form.get('netAmount')),
      externalTransactionId: valueOrNull(form.get('externalTransactionId')),
      ownerOverride,
      note: valueOrNull(form.get('note')),
    };

    const button = event.currentTarget.querySelector('button[type="submit"]');
    try {
      button.disabled = true;
      message.textContent = 'Applying capacity…';
      const response = await fetch(config.entitlementFunctionUrl, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(humanError(body.error || 'Capacity update failed'));
      message.textContent = `Capacity updated to ${body.entitlement?.capacity ?? resultCapacity} avatars.`;
      await loadData();
      setTimeout(() => location.reload(), 450);
    } catch (error) {
      message.textContent = error.message;
      button.disabled = false;
    }
  }

  function installSalesUi() {
    const view = document.querySelector('#view-sales');
    const table = view?.querySelector('.data-table');
    if (!view || !table || view.dataset.salesOps === '1') return;
    view.dataset.salesOps = '1';

    const filters = document.createElement('div');
    filters.className = 'filterbar';
    filters.id = 'sales-filters';
    filters.style.gridTemplateColumns = 'repeat(6,minmax(120px,1fr)) auto';
    filters.innerHTML = `
      <input id="sales-start" type="date" aria-label="Sales start date">
      <input id="sales-end" type="date" aria-label="Sales end date">
      <select id="sales-currency" aria-label="Currency"><option value="">USD + L$</option><option value="USD">USD</option><option value="L$">L$</option></select>
      <select id="sales-tier" aria-label="Tier"><option value="">All tiers</option><option value="3">3</option><option value="5">5</option><option value="10">10</option></select>
      <select id="sales-type" aria-label="Sale type"><option value="">All types</option><option value="sale">New sale</option><option value="upgrade">Upgrade</option><option value="gift">Gift</option><option value="comp">Comp</option><option value="chargeback">Chargeback</option><option value="manual">Manual / Test</option></select>
      <button id="sales-clear" class="button quiet" type="button">Clear</button>
      <button id="sales-export" class="button quiet" type="button">Export CSV</button>`;

    const summary = document.createElement('div');
    summary.id = 'sales-summary';
    summary.className = 'metric-grid';
    summary.style.gridTemplateColumns = 'repeat(5,minmax(0,1fr))';
    summary.style.marginBottom = '12px';
    summary.innerHTML = `
      <div class="metric" style="cursor:default"><span>Gross</span><strong id="sales-gross">—</strong></div>
      <div class="metric" style="cursor:default"><span>Fees</span><strong id="sales-fees">—</strong></div>
      <div class="metric" style="cursor:default"><span>Net</span><strong id="sales-net">—</strong></div>
      <div class="metric" style="cursor:default"><span>This month</span><strong id="sales-month">—</strong></div>
      <div class="metric" style="cursor:default"><span>YTD</span><strong id="sales-ytd">—</strong></div>`;

    const shell = view.querySelector('.table-shell');
    shell.parentElement.insertBefore(filters, shell);
    shell.parentElement.insertBefore(summary, shell);
    table.querySelector('thead').innerHTML = '<tr><th>Customer</th><th>Type</th><th>Source</th><th>Gross</th><th>Fees</th><th>Net</th><th>License / Capacity</th><th>Receipt</th><th>Date</th></tr>';

    for (const control of filters.querySelectorAll('input,select')) control.addEventListener('change', renderSales);
    filters.querySelector('#sales-clear').addEventListener('click', () => {
      for (const input of filters.querySelectorAll('input')) input.value = '';
      for (const select of filters.querySelectorAll('select')) select.value = '';
      renderSales();
    });
    filters.querySelector('#sales-export').addEventListener('click', exportSalesCsv);

    const rows = document.querySelector('#sales-rows');
    salesObserver = new MutationObserver(() => {
      if (view.classList.contains('active')) renderSales();
    });
    salesObserver.observe(rows, { childList: true });

    document.querySelector('[data-view="sales"]')?.addEventListener('click', () => setTimeout(renderSales, 0));
  }

  function allSalesRows() {
    const rows = [];
    const eventByTransaction = new Map();
    for (const event of capacityEvents) {
      if (event.external_transaction_id) eventByTransaction.set(String(event.external_transaction_id), event);
    }
    const usedEvents = new Set();

    for (const license of licenses) {
      const customer = groupForLicense(license);
      const orders = Array.isArray(license.orders) ? license.orders : [];
      if (orders.length) {
        for (const order of orders) {
          const receipt = firstText(order.external_transaction_id, order.transaction_id, order.receipt_id, order.id, license.external_transaction_id);
          const capacityEvent = receipt ? eventByTransaction.get(receipt) : null;
          if (capacityEvent) usedEvents.add(capacityEvent.id);
          rows.push(saleFromOrder(license, customer, order, capacityEvent));
        }
      } else if (license.payment_method || license.payment_amount != null) {
        const receipt = firstText(license.external_transaction_id);
        const capacityEvent = receipt ? eventByTransaction.get(receipt) : null;
        if (capacityEvent) usedEvents.add(capacityEvent.id);
        rows.push(saleFromLicense(license, customer, capacityEvent));
      }
    }

    for (const event of capacityEvents) {
      if (usedEvents.has(event.id)) continue;
      const license = licenses.find((item) => item.id === event.license_id) || null;
      rows.push({
        customer: license ? groupForLicense(license) : null,
        license,
        type: normalizeSaleType(event.event_type),
        source: String(event.payment_source || 'manual').toUpperCase(),
        currency: normalizeCurrency(event.currency),
        gross: numberOrNull(event.gross_amount),
        fee: numberOrNull(event.fee_amount),
        net: numberOrNull(event.net_amount),
        receipt: firstText(event.external_transaction_id, event.purchase_id),
        at: event.created_at,
        tier: Number(license?.tier || 0),
        capacityDelta: Number(event.delta_slots || 0),
        resultingCapacity: Number(event.resulting_capacity || 0),
        status: '',
      });
    }
    return rows.filter((row) => row.at).sort((a, b) => new Date(b.at) - new Date(a.at));
  }

  function saleFromOrder(license, customer, order, capacityEvent) {
    const currency = normalizeCurrency(order.currency || license.payment_currency);
    const gross = moneyFromOrder(order, license, 'gross');
    const fee = moneyFromOrder(order, license, 'fee');
    const explicitNet = moneyFromOrder(order, license, 'net');
    const type = capacityEvent
      ? normalizeSaleType(capacityEvent.event_type)
      : detectSaleType(order, license);
    return {
      customer,
      license,
      type,
      source: String(order.provider || order.payment_method || license.payment_method || '').toUpperCase(),
      currency,
      gross,
      fee,
      net: explicitNet ?? (gross != null && fee != null ? gross - fee : null),
      receipt: firstText(order.external_transaction_id, order.transaction_id, order.receipt_id, order.id, license.external_transaction_id),
      at: order.created_at || license.created_at,
      tier: Number(license.tier || 0),
      capacityDelta: Number(capacityEvent?.delta_slots || 0),
      resultingCapacity: Number(capacityEvent?.resulting_capacity || 0),
      status: String(order.status || ''),
    };
  }

  function saleFromLicense(license, customer, capacityEvent) {
    const currency = normalizeCurrency(license.payment_currency);
    const gross = numberOrNull(license.payment_amount);
    return {
      customer,
      license,
      type: capacityEvent ? normalizeSaleType(capacityEvent.event_type) : detectSaleType({}, license),
      source: String(license.payment_method || '').toUpperCase(),
      currency,
      gross,
      fee: null,
      net: null,
      receipt: firstText(license.external_transaction_id),
      at: license.created_at,
      tier: Number(license.tier || 0),
      capacityDelta: Number(capacityEvent?.delta_slots || 0),
      resultingCapacity: Number(capacityEvent?.resulting_capacity || 0),
      status: '',
    };
  }

  function filteredSalesRows() {
    const start = document.querySelector('#sales-start')?.value || '';
    const end = document.querySelector('#sales-end')?.value || '';
    const currency = document.querySelector('#sales-currency')?.value || '';
    const tier = document.querySelector('#sales-tier')?.value || '';
    const type = document.querySelector('#sales-type')?.value || '';
    const startAt = start ? new Date(`${start}T00:00:00`).getTime() : null;
    const endAt = end ? new Date(`${end}T23:59:59.999`).getTime() : null;

    return allSalesRows().filter((sale) => {
      const at = new Date(sale.at).getTime();
      if (startAt != null && at < startAt) return false;
      if (endAt != null && at > endAt) return false;
      if (currency && sale.currency !== currency) return false;
      if (tier && Number(tier) !== sale.tier) return false;
      if (type && sale.type !== type) return false;
      return true;
    });
  }

  function renderSales() {
    const rowsElement = document.querySelector('#sales-rows');
    if (!rowsElement) return;
    const rows = filteredSalesRows();

    if (salesObserver) salesObserver.disconnect();
    rowsElement.replaceChildren();
    for (const sale of rows) {
      const tr = document.createElement('tr');
      const customerName = customerNameForGroup(sale.customer, sale.license);
      const capacityText = sale.capacityDelta
        ? `+${sale.capacityDelta} slots → ${sale.resultingCapacity}`
        : `${sale.tier || '—'}-avatar •••• ${sale.license?.key_last4 || '—'}`;
      tr.innerHTML = `<td class="name-cell"><strong>${escapeHtml(customerName)}</strong></td><td>${escapeHtml(labelSaleType(sale.type))}</td><td>${escapeHtml(sale.source || '—')}</td><td>${escapeHtml(formatAmount(sale.gross, sale.currency))}</td><td>${escapeHtml(formatAmount(sale.fee, sale.currency))}</td><td>${escapeHtml(formatAmount(sale.net, sale.currency))}</td><td>${escapeHtml(capacityText)}</td><td><span class="uuid-short">${escapeHtml(shortReceipt(sale.receipt))}</span></td><td>${escapeHtml(shortDate(sale.at))}</td>`;
      rowsElement.append(tr);
    }
    if (!rows.length) rowsElement.innerHTML = '<tr><td colspan="9" class="muted">No matching payment records.</td></tr>';
    if (salesObserver) salesObserver.observe(rowsElement, { childList: true });

    document.querySelector('#sales-gross').textContent = summarizeMoney(rows, 'gross');
    document.querySelector('#sales-fees').textContent = summarizeMoney(rows, 'fee', true);
    document.querySelector('#sales-net').textContent = summarizeMoney(rows, 'net', true);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const yearStart = new Date(now.getFullYear(), 0, 1).getTime();
    const all = allSalesRows();
    document.querySelector('#sales-month').textContent = summarizeMoney(all.filter((sale) => new Date(sale.at).getTime() >= monthStart), 'gross');
    document.querySelector('#sales-ytd').textContent = summarizeMoney(all.filter((sale) => new Date(sale.at).getTime() >= yearStart), 'gross');
  }

  function exportSalesCsv() {
    const rows = filteredSalesRows();
    const csvRows = [['Customer','Primary UUID','Type','Source','Gross','Fees','Net','Currency','Tier','Capacity added','Resulting capacity','License ending','Receipt / transaction','Date']];
    for (const sale of rows) csvRows.push([
      customerNameForGroup(sale.customer, sale.license),
      sale.customer?.primaryUuid || sale.license?.purchaser_avatar_uuid || '',
      labelSaleType(sale.type),
      sale.source || '',
      sale.gross ?? '',
      sale.fee ?? '',
      sale.net ?? '',
      sale.currency || '',
      sale.tier || '',
      sale.capacityDelta || '',
      sale.resultingCapacity || '',
      sale.license?.key_last4 || '',
      sale.receipt || '',
      sale.at || '',
    ]);
    const csv = csvRows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"','""')}"`).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    link.download = `cache-compass-sales-${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function installSearchBridges() {
    const pairs = [
      ['#customer-search', '#customer-search-button'],
      ['#license-search', '#license-search-button'],
      ['#dashboard-search', '#dashboard-search-button'],
    ];
    for (const [inputSelector, buttonSelector] of pairs) {
      const input = document.querySelector(inputSelector);
      const button = document.querySelector(buttonSelector);
      if (!input) continue;
      if (inputSelector === '#customer-search') input.placeholder = 'Search avatar name, UUID, email, license ending, receipt, or transaction';
      const bridge = () => temporarilyMapReceiptSearch(input);
      input.addEventListener('input', bridge, true);
      input.addEventListener('keydown', (event) => { if (event.key === 'Enter') bridge(); }, true);
      button?.addEventListener('click', bridge, true);
    }
  }

  function temporarilyMapReceiptSearch(input) {
    const original = input.value.trim();
    if (!original || original.length < 3) return;
    const mapped = receiptLookup(original);
    if (!mapped || mapped.toLowerCase() === original.toLowerCase()) return;
    input.value = mapped;
    queueMicrotask(() => { input.value = original; });
  }

  function receiptLookup(query) {
    const needle = query.toLowerCase();
    for (const group of customerGroups) {
      for (const license of group.licenses) {
        const receipts = [license.external_transaction_id];
        for (const order of license.orders || []) receipts.push(order.external_transaction_id, order.transaction_id, order.receipt_id, order.id);
        for (const receipt of receipts) {
          if (String(receipt || '').toLowerCase().includes(needle)) return group.primaryUuid || group.email || license.key_last4 || '';
        }
      }
    }
    for (const event of capacityEvents) {
      if ([event.external_transaction_id, event.purchase_id].some((value) => String(value || '').toLowerCase().includes(needle))) {
        const license = licenses.find((item) => item.id === event.license_id);
        const group = license ? groupForLicense(license) : null;
        return group?.primaryUuid || group?.email || license?.key_last4 || '';
      }
    }
    return '';
  }

  function installReleaseFilename() {
    const form = document.querySelector('#release-form');
    if (!form || form.querySelector('[name="customerFilename"]')) return;
    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.name = 'customerFilename';
    hidden.value = 'CacheCompass-Setup.exe';
    form.append(hidden);
    const fileLabel = form.querySelector('.release-file');
    if (fileLabel) {
      const note = document.createElement('span');
      note.className = 'muted';
      note.style.display = 'block';
      note.style.fontSize = '11px';
      note.style.marginTop = '4px';
      note.textContent = 'Customer download filename: CacheCompass-Setup.exe';
      fileLabel.append(note);
    }
  }

  function groupForLicense(license) {
    return customerGroups.find((group) => group.licenses.some((item) => item.id === license.id)) || null;
  }

  function customerNameForGroup(group, license) {
    const avatars = Array.isArray(license?.avatars) ? license.avatars : [];
    const purchaser = avatars.find((avatar) => avatar.avatar_uuid === license?.purchaser_avatar_uuid);
    const orderName = (license?.orders || []).find((order) => order.purchaser_avatar_name)?.purchaser_avatar_name;
    return purchaser?.avatar_name || orderName || avatars.find((avatar) => avatar.avatar_name)?.avatar_name || group?.primaryUuid || group?.email || 'Customer';
  }

  function detectSaleType(order, license) {
    const text = [order.type, order.kind, order.status, order.payment_status, license.payment_method, ...(license.events || []).map((event) => event.event_type)]
      .filter(Boolean).join(' ').toLowerCase();
    if (text.includes('chargeback') || text.includes('charged_back') || text.includes('dispute') || text.includes('reversal')) return 'chargeback';
    if (text.includes('gift')) return 'gift';
    if (text.includes('comp')) return 'comp';
    if (text.includes('manual') || text.includes('test')) return 'manual';
    return 'sale';
  }

  function normalizeSaleType(value) {
    const text = String(value || '').toLowerCase();
    if (text.includes('chargeback')) return 'chargeback';
    if (text.includes('gift')) return 'gift';
    if (text.includes('comp')) return 'comp';
    if (text.includes('upgrade') || text.includes('capacity')) return 'upgrade';
    if (text.includes('manual') || text.includes('test')) return 'manual';
    return 'sale';
  }

  function labelSaleType(value) {
    return ({ sale: 'New sale', upgrade: 'Upgrade', gift: 'Gift', comp: 'Comp', chargeback: 'Chargeback', manual: 'Manual / Test' })[value] || 'Sale';
  }

  function moneyFromOrder(order, license, kind) {
    const currency = normalizeCurrency(order.currency || license.payment_currency);
    const minorKeys = kind === 'gross'
      ? ['gross_minor','amount_minor']
      : kind === 'fee'
        ? ['fee_minor','fees_minor','processor_fee_minor']
        : ['net_minor'];
    for (const key of minorKeys) {
      if (order[key] != null && Number.isFinite(Number(order[key]))) return currency === 'USD' ? Number(order[key]) / 100 : Number(order[key]);
    }
    const regularKeys = kind === 'gross' ? ['gross_amount','amount'] : kind === 'fee' ? ['fee_amount','fees'] : ['net_amount','net'];
    for (const key of regularKeys) if (order[key] != null && Number.isFinite(Number(order[key]))) return Number(order[key]);
    if (kind === 'gross') return numberOrNull(license.payment_amount);
    return null;
  }

  function summarizeMoney(rows, field, flagUnknown = false) {
    const totals = new Map();
    const unknown = new Map();
    for (const row of rows) {
      const currency = row.currency || '—';
      if (row[field] == null) unknown.set(currency, (unknown.get(currency) || 0) + 1);
      else totals.set(currency, (totals.get(currency) || 0) + Number(row[field]));
    }
    const currencies = [...new Set([...totals.keys(), ...unknown.keys()])].filter((value) => value !== '—');
    if (!currencies.length) return '—';
    return currencies.map((currency) => {
      const value = totals.has(currency) ? formatAmount(totals.get(currency), currency) : '—';
      return flagUnknown && unknown.get(currency) ? `${value}*` : value;
    }).join(' · ');
  }

  function formatAmount(value, currency) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    if (currency === 'USD') return `$${Number(value).toFixed(2)}`;
    if (currency === 'L$') return `L$${Math.round(Number(value))}`;
    return `${currency || ''} ${Number(value).toFixed(2)}`.trim();
  }

  function normalizeCurrency(value) {
    const text = String(value || '').trim().toUpperCase();
    if (['L$','LD','LINDEN','LINDENS'].includes(text)) return 'L$';
    if (text === 'USD' || text === '$') return 'USD';
    return text;
  }

  function licenseCapacity(license) {
    return Number(license?.max_avatar_slots ?? license?.max_avatars ?? license?.tier ?? 0) || 0;
  }

  function humanError(value) {
    return ({
      owner_override_required_above_30: 'Totals above 30 avatars require the owner override checkbox.',
      license_not_active: 'This license is not active. Reactivate it before adding capacity.',
      active_entitlement_not_found: 'No active entitlement was found for this customer.',
      capacity_transaction_conflict: 'That receipt / transaction is already tied to a different capacity change.',
    })[value] || String(value || 'Request failed').replaceAll('_', ' ');
  }

  function firstText(...values) {
    for (const value of values) if (value != null && String(value).trim()) return String(value).trim();
    return '';
  }
  function valueOrNull(value) { const text = String(value ?? '').trim(); return text ? text : null; }
  function numberOrNull(value) { if (value == null || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
  function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '').trim()); }
  function shortReceipt(value) { const text = String(value || ''); return text.length > 20 ? `${text.slice(0,10)}…${text.slice(-6)}` : text || '—'; }
  function shortDate(value) { return value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(value).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : '—'; }
  function escapeHtml(value) { const div = document.createElement('div'); div.textContent = String(value ?? ''); return div.innerHTML; }
}
