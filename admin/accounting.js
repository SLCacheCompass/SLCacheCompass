import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.CACHE_COMPASS_ADMIN_CONFIG;
const accountingView = document.querySelector('#view-accounting');
const accountingTab = document.querySelector('.tab[data-view="accounting"]');

if (!config || !accountingView || !accountingTab) {
  // Accounting UI is optional; leave the rest of Back Office untouched if it is absent.
} else {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  let expenses = [];
  let editingId = null;
  let loadedOnce = false;

  const form = document.querySelector('#expense-form');
  const dateInput = document.querySelector('#expense-date');
  const vendorInput = document.querySelector('#expense-vendor');
  const categoryInput = document.querySelector('#expense-category');
  const descriptionInput = document.querySelector('#expense-description');
  const amountInput = document.querySelector('#expense-amount');
  const currencyInput = document.querySelector('#expense-currency');
  const usdInput = document.querySelector('#expense-usd-value');
  const paymentInput = document.querySelector('#expense-payment-method');
  const receiptInput = document.querySelector('#expense-receipt');
  const deductibleInput = document.querySelector('#expense-deductible');
  const notesInput = document.querySelector('#expense-notes');
  const saveButton = document.querySelector('#expense-save');
  const cancelButton = document.querySelector('#expense-cancel');
  const message = document.querySelector('#accounting-message');
  const searchInput = document.querySelector('#expense-search');
  const categoryFilter = document.querySelector('#expense-category-filter');
  const yearFilter = document.querySelector('#expense-year-filter');
  const includeVoided = document.querySelector('#expense-include-voided');
  const rowsHolder = document.querySelector('#expense-rows');
  const countLabel = document.querySelector('#expense-count');

  dateInput.value = todayString();
  syncUsdField();

  accountingTab.addEventListener('click', async () => {
    if (!loadedOnce) await loadExpenses();
    else render();
  });

  form.addEventListener('submit', saveExpense);
  cancelButton.addEventListener('click', resetForm);
  amountInput.addEventListener('input', syncUsdField);
  currencyInput.addEventListener('change', syncUsdField);
  searchInput.addEventListener('input', render);
  categoryFilter.addEventListener('change', render);
  yearFilter.addEventListener('change', render);
  includeVoided.addEventListener('change', render);
  document.querySelector('#expense-export').addEventListener('click', exportExpenses);

  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session) {
      expenses = [];
      loadedOnce = false;
      render();
    }
  });

  (async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) await loadExpenses();
  })();

  async function loadExpenses() {
    setMessage('Loading expenses…');
    const { data, error } = await supabase
      .from('accounting_expenses')
      .select('*')
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      setMessage(`Expense tracker could not load: ${error.message}`, true);
      return;
    }

    expenses = Array.isArray(data) ? data : [];
    loadedOnce = true;
    refreshFilterOptions();
    render();
    setMessage('');
  }

  async function saveExpense(event) {
    event.preventDefault();
    const amount = Number(amountInput.value);
    const currency = currencyInput.value.trim() || 'USD';
    const usdValueRaw = usdInput.value.trim();
    const amountUsd = currency === 'USD' ? amount : (usdValueRaw === '' ? null : Number(usdValueRaw));

    if (!dateInput.value || !vendorInput.value.trim() || !Number.isFinite(amount) || amount <= 0) {
      setMessage('Date, vendor, and a positive amount are required.', true);
      return;
    }
    if (amountUsd != null && (!Number.isFinite(amountUsd) || amountUsd < 0)) {
      setMessage('USD accounting value must be a valid non-negative amount.', true);
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      setMessage('Your sign-in expired. Please sign in again.', true);
      return;
    }

    const payload = {
      expense_date: dateInput.value,
      vendor: vendorInput.value.trim(),
      category: categoryInput.value,
      description: descriptionInput.value.trim(),
      amount,
      currency,
      amount_usd: amountUsd,
      payment_method: blankToNull(paymentInput.value),
      receipt_reference: blankToNull(receiptInput.value),
      tax_deductible: deductibleInput.checked,
      notes: blankToNull(notesInput.value),
      updated_by: sessionData.session.user.id,
    };

    setMessage(editingId ? 'Updating expense…' : 'Saving expense…');
    let result;
    if (editingId) {
      result = await supabase.from('accounting_expenses').update(payload).eq('id', editingId).select().single();
    } else {
      result = await supabase.from('accounting_expenses').insert(payload).select().single();
    }

    if (result.error) {
      setMessage(`Could not save expense: ${result.error.message}`, true);
      return;
    }

    resetForm();
    await loadExpenses();
    setMessage(editingId ? 'Expense updated.' : 'Expense saved.');
  }

  function editExpense(expense) {
    editingId = expense.id;
    dateInput.value = expense.expense_date || todayString();
    vendorInput.value = expense.vendor || '';
    categoryInput.value = expense.category || 'Other';
    descriptionInput.value = expense.description || '';
    amountInput.value = expense.amount ?? '';
    currencyInput.value = expense.currency === 'L$' ? 'L$' : 'USD';
    usdInput.value = expense.amount_usd ?? '';
    paymentInput.value = expense.payment_method || '';
    receiptInput.value = expense.receipt_reference || '';
    deductibleInput.checked = expense.tax_deductible !== false;
    notesInput.value = expense.notes || '';
    saveButton.textContent = 'Update Expense';
    cancelButton.hidden = false;
    syncUsdField(false);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    vendorInput.focus();
  }

  function resetForm() {
    editingId = null;
    form.reset();
    dateInput.value = todayString();
    categoryInput.value = 'Software / Subscriptions';
    currencyInput.value = 'USD';
    deductibleInput.checked = true;
    saveButton.textContent = 'Add Expense';
    cancelButton.hidden = true;
    syncUsdField();
  }

  async function voidExpense(expense) {
    if (expense.voided_at) return;
    const reason = prompt(`Why are you voiding the ${formatMoney(expense.amount, expense.currency)} expense from ${expense.vendor}?`);
    if (reason == null || !reason.trim()) return;
    if (!confirm('Void this expense? The record will be retained for accounting history.')) return;

    const { data: sessionData } = await supabase.auth.getSession();
    const { error } = await supabase
      .from('accounting_expenses')
      .update({
        voided_at: new Date().toISOString(),
        voided_by: sessionData.session?.user?.id || null,
        void_reason: reason.trim(),
        updated_by: sessionData.session?.user?.id || null,
      })
      .eq('id', expense.id);

    if (error) {
      setMessage(`Could not void expense: ${error.message}`, true);
      return;
    }
    await loadExpenses();
    setMessage('Expense voided and retained in history.');
  }

  async function restoreExpense(expense) {
    if (!expense.voided_at) return;
    if (!confirm('Restore this voided expense to the active accounting ledger?')) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const { error } = await supabase
      .from('accounting_expenses')
      .update({
        voided_at: null,
        voided_by: null,
        void_reason: null,
        updated_by: sessionData.session?.user?.id || null,
      })
      .eq('id', expense.id);

    if (error) {
      setMessage(`Could not restore expense: ${error.message}`, true);
      return;
    }
    await loadExpenses();
    setMessage('Expense restored.');
  }

  function render() {
    renderSummary();
    const filtered = filteredExpenses();
    rowsHolder.replaceChildren();

    for (const expense of filtered) {
      const row = document.createElement('tr');
      if (expense.voided_at) row.classList.add('expense-voided');
      row.innerHTML = `
        <td>${escapeHtml(formatDateOnly(expense.expense_date))}</td>
        <td class="name-cell"><strong>${escapeHtml(expense.vendor || '—')}</strong><span>${escapeHtml(expense.description || '')}</span></td>
        <td>${escapeHtml(expense.category || 'Other')}</td>
        <td>${escapeHtml(formatMoney(expense.amount, expense.currency))}</td>
        <td>${expense.amount_usd == null ? '<span class="muted">—</span>' : escapeHtml(formatUsd(expense.amount_usd))}</td>
        <td>${escapeHtml(expense.payment_method || '—')}</td>
        <td><span class="uuid-short">${escapeHtml(expense.receipt_reference || '—')}</span></td>
        <td>${expense.tax_deductible ? '<span class="status-pill">Yes</span>' : '<span class="muted">No</span>'}${expense.voided_at ? '<span class="expense-void-label">Voided</span>' : ''}</td>
        <td class="row-actions"></td>`;

      const actions = row.querySelector('.row-actions');
      if (!expense.voided_at) {
        actions.append(makeButton('Edit', () => editExpense(expense)));
        actions.append(makeButton('Void', () => voidExpense(expense), 'danger'));
      } else {
        actions.append(makeButton('Restore', () => restoreExpense(expense)));
      }
      rowsHolder.append(row);
    }

    if (!filtered.length) rowsHolder.innerHTML = '<tr><td colspan="9" class="muted">No matching expenses.</td></tr>';
    countLabel.textContent = `${filtered.length} expense${filtered.length === 1 ? '' : 's'} shown`;
  }

  function renderSummary() {
    const active = expenses.filter((expense) => !expense.voided_at);
    const now = new Date();
    const year = String(now.getFullYear());
    const month = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const totalUsd = (items) => items.reduce((sum, expense) => sum + (expense.amount_usd == null ? 0 : Number(expense.amount_usd)), 0);
    const unconvertedLinden = active.filter((expense) => expense.currency === 'L$' && expense.amount_usd == null).reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

    document.querySelector('#expense-metric-month').textContent = formatUsd(totalUsd(active.filter((expense) => String(expense.expense_date || '').startsWith(month))));
    document.querySelector('#expense-metric-ytd').textContent = formatUsd(totalUsd(active.filter((expense) => String(expense.expense_date || '').startsWith(`${year}-`))));
    document.querySelector('#expense-metric-all').textContent = formatUsd(totalUsd(active));
    document.querySelector('#expense-metric-linden').textContent = unconvertedLinden ? `L$${formatNumber(unconvertedLinden)}` : 'L$0';
  }

  function filteredExpenses() {
    const q = searchInput.value.trim().toLowerCase();
    const category = categoryFilter.value;
    const year = yearFilter.value;
    return expenses.filter((expense) => {
      if (!includeVoided.checked && expense.voided_at) return false;
      if (category && expense.category !== category) return false;
      if (year && !String(expense.expense_date || '').startsWith(`${year}-`)) return false;
      if (!q) return true;
      return [expense.vendor, expense.category, expense.description, expense.payment_method, expense.receipt_reference, expense.notes, expense.currency]
        .some((value) => String(value || '').toLowerCase().includes(q));
    });
  }

  function refreshFilterOptions() {
    const selectedCategory = categoryFilter.value;
    const selectedYear = yearFilter.value;
    const categories = [...new Set(expenses.map((expense) => expense.category).filter(Boolean))].sort();
    const years = [...new Set(expenses.map((expense) => String(expense.expense_date || '').slice(0, 4)).filter((value) => /^\d{4}$/.test(value)))].sort().reverse();

    categoryFilter.innerHTML = '<option value="">All categories</option>' + categories.map((value) => `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`).join('');
    yearFilter.innerHTML = '<option value="">All years</option>' + years.map((value) => `<option value="${value}">${value}</option>`).join('');
    if (categories.includes(selectedCategory)) categoryFilter.value = selectedCategory;
    if (years.includes(selectedYear)) yearFilter.value = selectedYear;
  }

  function exportExpenses() {
    const rows = filteredExpenses();
    if (!rows.length) {
      setMessage('There are no expenses in the current filter to export.', true);
      return;
    }

    const headers = ['Date','Vendor','Category','Description','Amount','Currency','USD Value','Payment Method','Receipt Reference','Tax Deductible','Notes','Voided At','Void Reason'];
    const csv = [headers, ...rows.map((expense) => [
      expense.expense_date,
      expense.vendor,
      expense.category,
      expense.description,
      expense.amount,
      expense.currency,
      expense.amount_usd ?? '',
      expense.payment_method || '',
      expense.receipt_reference || '',
      expense.tax_deductible ? 'Yes' : 'No',
      expense.notes || '',
      expense.voided_at || '',
      expense.void_reason || '',
    ])].map((row) => row.map(csvCell).join(',')).join('\r\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cache-compass-expenses-${todayString()}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function syncUsdField(clearOnLinden = true) {
    const isUsd = currencyInput.value === 'USD';
    usdInput.readOnly = isUsd;
    usdInput.title = isUsd ? 'USD expenses automatically use the expense amount.' : 'Enter the USD accounting value used for your books, if known.';
    if (isUsd) usdInput.value = amountInput.value || '';
    else if (clearOnLinden && usdInput.value === amountInput.value) usdInput.value = '';
  }

  function makeButton(label, handler, kind = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `mini-button ${kind}`.trim();
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }

  function setMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle('expense-error', Boolean(isError));
  }

  function blankToNull(value) {
    const trimmed = String(value || '').trim();
    return trimmed || null;
  }

  function todayString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatDateOnly(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return '—';
    const [year, month, day] = value.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day)));
  }

  function formatUsd(value) {
    const number = Number(value || 0);
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number.isFinite(number) ? number : 0);
  }

  function formatMoney(value, currency) {
    const amount = Number(value || 0);
    if (currency === 'USD') return formatUsd(amount);
    if (currency === 'L$') return `L$${formatNumber(amount)}`;
    return `${currency || ''} ${Number.isFinite(amount) ? amount.toFixed(2) : '0.00'}`.trim();
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value || 0));
  }

  function csvCell(value) {
    const text = String(value ?? '');
    return `"${text.replaceAll('"', '""')}"`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }
}
