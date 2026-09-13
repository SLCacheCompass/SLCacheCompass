const SORT_STATE = new WeakMap();

const tables = [
  {
    tbodyId: 'customer-rows',
    sortable: {
      0: 'text',
      1: 'text',
      2: 'number',
      3: 'ratio',
      4: 'text',
      5: 'text',
      6: 'date',
    },
  },
  {
    tbodyId: 'license-rows',
    sortable: {
      0: 'text',
      1: 'number',
      2: 'ratio',
      3: 'money',
      4: 'text',
      5: 'date',
    },
  },
  {
    tbodyId: 'sales-rows',
    sortable: {
      0: 'text',
      1: 'text',
      2: 'money',
      3: 'number',
      4: 'text',
      5: 'date',
    },
  },
];

function normalizeText(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function parseNumber(value) {
  const match = String(value || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.NEGATIVE_INFINITY;
}

function parseRatio(value) {
  const parts = String(value || '').match(/(-?\d+)\s*\/\s*(-?\d+)/);
  if (!parts) return parseNumber(value);
  return Number(parts[1]);
}

function parseMoney(value) {
  const text = String(value || '').trim();
  const number = parseNumber(text);
  if (!Number.isFinite(number)) return Number.NEGATIVE_INFINITY;
  if (/L\$/i.test(text)) return number / 1000000;
  return number;
}

function parseDate(value) {
  const timestamp = Date.parse(String(value || '').trim());
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function cellValue(row, columnIndex, type) {
  const text = row.cells[columnIndex]?.innerText || '';
  if (type === 'number') return parseNumber(text);
  if (type === 'ratio') return parseRatio(text);
  if (type === 'money') return parseMoney(text);
  if (type === 'date') return parseDate(text);
  return normalizeText(text);
}

function compareValues(a, b, direction) {
  const factor = direction === 'asc' ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * factor;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }) * factor;
}

function sortTable(table, tbody, columnIndex, type, button) {
  const previous = SORT_STATE.get(table) || {};
  const direction = previous.column === columnIndex && previous.direction === 'asc' ? 'desc' : 'asc';
  SORT_STATE.set(table, { column: columnIndex, direction });

  const rows = [...tbody.querySelectorAll('tr')].filter((row) => !row.querySelector('td[colspan]'));
  rows.sort((rowA, rowB) => {
    const result = compareValues(
      cellValue(rowA, columnIndex, type),
      cellValue(rowB, columnIndex, type),
      direction,
    );
    if (result !== 0) return result;
    return [...tbody.children].indexOf(rowA) - [...tbody.children].indexOf(rowB);
  });
  rows.forEach((row) => tbody.appendChild(row));

  for (const other of table.querySelectorAll('.column-sort')) {
    const active = other === button;
    other.classList.toggle('active', active);
    other.setAttribute('aria-sort', active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none');
    const indicator = other.querySelector('.sort-indicator');
    if (indicator) indicator.textContent = active ? (direction === 'asc' ? '▲' : '▼') : '↕';
  }
}

function enhanceTable(definition) {
  const tbody = document.getElementById(definition.tbodyId);
  const table = tbody?.closest('table');
  if (!tbody || !table) return;

  [...table.querySelectorAll('thead th')].forEach((th, index) => {
    const type = definition.sortable[index];
    if (!type || th.querySelector('.column-sort')) return;
    const label = th.textContent.trim();
    th.textContent = '';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'column-sort';
    button.setAttribute('aria-label', `Sort by ${label}`);
    button.setAttribute('aria-sort', 'none');
    button.innerHTML = `<span>${escapeHtml(label)}</span><span class="sort-indicator" aria-hidden="true">↕</span>`;
    button.addEventListener('click', () => sortTable(table, tbody, index, type, button));
    th.appendChild(button);
  });

  const makeEmailsClickable = () => {
    if (definition.tbodyId !== 'customer-rows' && definition.tbodyId !== 'license-rows') return;
    for (const span of tbody.querySelectorAll('.name-cell span')) {
      const email = span.textContent.trim();
      if (!email.includes('@') || span.querySelector('a')) continue;
      span.textContent = '';
      const link = document.createElement('a');
      link.href = `mailto:${email}`;
      link.textContent = email;
      link.className = 'backoffice-email-link';
      link.addEventListener('click', (event) => event.stopPropagation());
      span.appendChild(link);
    }
  };

  makeEmailsClickable();
  new MutationObserver(makeEmailsClickable).observe(tbody, { childList: true, subtree: true });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

const style = document.createElement('style');
style.textContent = `
  .data-table th:has(.column-sort){padding:0}
  .column-sort{width:100%;height:34px;padding:0 12px;border:0;background:transparent;color:inherit;font:inherit;font-weight:inherit;letter-spacing:inherit;text-transform:inherit;display:flex;align-items:center;justify-content:flex-start;gap:6px;cursor:pointer;text-align:left;white-space:nowrap}
  .column-sort:hover,.column-sort.active{color:var(--teal)}
  .column-sort:focus-visible{outline:2px solid var(--teal);outline-offset:-2px}
  .sort-indicator{font-size:9px;opacity:.65;line-height:1}
  .column-sort.active .sort-indicator{opacity:1;color:var(--gold)}
  .backoffice-email-link{color:var(--teal);text-decoration:none}
  .backoffice-email-link:hover{text-decoration:underline}
`;
document.head.appendChild(style);

tables.forEach(enhanceTable);
