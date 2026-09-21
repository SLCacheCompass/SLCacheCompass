import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.CACHE_COMPASS_ADMIN_CONFIG || {};
const supportUrl = config.supportFunctionUrl;
const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { detectSessionInUrl: false } });

let messages = [];
let selectedUid = null;

installStyles();
bindUi();
bootstrap();

async function bootstrap() {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    await refreshList({ silent: true });
  }
  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session) await refreshList({ silent: true });
  });
}

function bindUi() {
  document.querySelector('#support-refresh')?.addEventListener('click', () => refreshList());
  document.querySelector('#support-search')?.addEventListener('input', renderList);
  document.querySelector('[data-view="support"]')?.addEventListener('click', () => setTimeout(() => refreshList(), 0));
}

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Your sign-in expired. Please sign in again.');
  return { authorization: `Bearer ${data.session.access_token}`, 'content-type': 'application/json' };
}

async function supportApi(url, options = {}) {
  if (!supportUrl) throw new Error('Support mailbox service is not configured.');
  const response = await fetch(url, { ...options, headers: { ...(await authHeaders()), ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(humanError(body.error || 'Support mailbox request failed.'));
  return body;
}

async function refreshList({ silent = false } = {}) {
  const status = document.querySelector('#support-status');
  if (!silent) status.textContent = 'Loading support inbox…';
  try {
    const body = await supportApi(`${supportUrl}?action=list&limit=100`);
    messages = Array.isArray(body.messages) ? body.messages : [];
    renderList();
    updateUnread(Number(body.unread || 0));
    document.querySelector('#support-count').textContent = `${messages.length} message${messages.length === 1 ? '' : 's'}`;
    status.textContent = '';
    if (selectedUid && !messages.some((message) => message.uid === selectedUid)) {
      selectedUid = null;
      renderEmptyReader();
    }
  } catch (error) {
    messages = [];
    renderList();
    updateUnread(null);
    status.textContent = error.message;
    renderSetupState(error.message);
  }
}

function renderList() {
  const holder = document.querySelector('#support-list');
  if (!holder) return;
  const query = (document.querySelector('#support-search')?.value || '').trim().toLowerCase();
  const filtered = messages.filter((message) => {
    if (!query) return true;
    return [message.subject, message.from?.name, message.from?.address]
      .some((value) => String(value || '').toLowerCase().includes(query));
  });

  holder.replaceChildren();
  if (!filtered.length) {
    holder.innerHTML = '<div class="support-list-empty muted">No matching support emails.</div>';
    return;
  }

  for (const message of filtered) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `support-message-row${message.seen ? '' : ' unread'}${message.uid === selectedUid ? ' selected' : ''}`;
    button.innerHTML = `
      <div class="support-message-top">
        <strong>${escapeHtml(message.from?.name || message.from?.address || 'Unknown sender')}</strong>
        <span>${escapeHtml(shortDateTime(message.date))}</span>
      </div>
      <div class="support-message-subject">${escapeHtml(message.subject || '(no subject)')}</div>
      <div class="support-message-email">${escapeHtml(message.from?.address || '')}</div>
    `;
    button.addEventListener('click', () => openMessage(message.uid));
    holder.append(button);
  }
}

async function openMessage(uid) {
  selectedUid = uid;
  renderList();
  const reader = document.querySelector('#support-reader');
  reader.innerHTML = '<div class="support-loading muted">Loading message…</div>';
  try {
    const body = await supportApi(`${supportUrl}?action=read&uid=${encodeURIComponent(uid)}`);
    const message = body.message;
    const local = messages.find((row) => row.uid === uid);
    if (local) local.seen = true;
    renderList();
    renderMessage(message);
    updateUnread(messages.filter((row) => !row.seen).length);
  } catch (error) {
    reader.innerHTML = `<div class="support-error">${escapeHtml(error.message)}</div>`;
  }
}

function renderMessage(message) {
  const reader = document.querySelector('#support-reader');
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  reader.innerHTML = `
    <div class="support-reader-head">
      <div>
        <p class="eyebrow">MESSAGE</p>
        <h3>${escapeHtml(message.subject || '(no subject)')}</h3>
        <p class="support-from"><strong>${escapeHtml(message.from?.name || message.from?.address || 'Unknown sender')}</strong> <span>&lt;${escapeHtml(message.from?.address || '')}&gt;</span></p>
        <p class="muted">${escapeHtml(fullDateTime(message.date))}</p>
      </div>
      <div class="inline-actions">
        <button id="support-toggle-read" class="button quiet" type="button">Mark unread</button>
        <button id="support-archive" class="button quiet" type="button">Archive</button>
      </div>
    </div>
    <div class="support-body"></div>
    ${attachments.length ? `<div class="support-attachments"><p class="eyebrow">ATTACHMENTS</p>${attachments.map((file) => `<div>${escapeHtml(file.filename)} <span class="muted">(${escapeHtml(formatBytes(file.size))})</span></div>`).join('')}</div>` : ''}
    <form id="support-reply-form" class="support-reply">
      <label>Reply<textarea id="support-reply-text" rows="7" placeholder="Write your reply…" required></textarea></label>
      <div class="support-reply-actions">
        <span id="support-reply-status" class="message" role="status"></span>
        <button class="button gold" type="submit">Send Reply</button>
      </div>
    </form>
  `;
  reader.querySelector('.support-body').textContent = message.text || '(No readable message body.)';
  reader.querySelector('#support-toggle-read')?.addEventListener('click', () => markUnread(message.uid));
  reader.querySelector('#support-archive')?.addEventListener('click', () => archiveMessage(message.uid));
  reader.querySelector('#support-reply-form')?.addEventListener('submit', (event) => sendReply(event, message));
}

async function markUnread(uid) {
  try {
    await supportApi(supportUrl, { method: 'POST', body: JSON.stringify({ action: 'mark_unread', uid }) });
    const local = messages.find((row) => row.uid === uid);
    if (local) local.seen = false;
    updateUnread(messages.filter((row) => !row.seen).length);
    renderList();
    document.querySelector('#support-toggle-read').textContent = 'Unread';
    document.querySelector('#support-toggle-read').disabled = true;
  } catch (error) {
    document.querySelector('#support-status').textContent = error.message;
  }
}

async function archiveMessage(uid) {
  try {
    await supportApi(supportUrl, { method: 'POST', body: JSON.stringify({ action: 'archive', uid }) });
    messages = messages.filter((row) => row.uid !== uid);
    selectedUid = null;
    renderList();
    renderEmptyReader();
    updateUnread(messages.filter((row) => !row.seen).length);
    document.querySelector('#support-count').textContent = `${messages.length} message${messages.length === 1 ? '' : 's'}`;
  } catch (error) {
    document.querySelector('#support-status').textContent = error.message;
  }
}

async function sendReply(event, message) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const status = document.querySelector('#support-reply-status');
  const text = document.querySelector('#support-reply-text').value.trim();
  if (!text) return;
  try {
    button.disabled = true;
    status.textContent = 'Sending…';
    await supportApi(supportUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'reply',
        to: message.from?.address || '',
        subject: message.subject || 'Cache Compass support',
        text,
        inReplyTo: message.messageId || '',
        references: message.references || [],
      }),
    });
    document.querySelector('#support-reply-text').value = '';
    status.textContent = 'Reply sent.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function updateUnread(count) {
  const metric = document.querySelector('#metric-support');
  if (!metric) return;
  metric.textContent = count == null ? '—' : String(count);
}

function renderEmptyReader() {
  const reader = document.querySelector('#support-reader');
  if (!reader) return;
  reader.innerHTML = '<div class="support-empty"><p class="eyebrow">INBOX</p><h3>Select a message</h3><p class="muted">Choose an email on the left to read and reply.</p></div>';
}

function renderSetupState(message) {
  const reader = document.querySelector('#support-reader');
  if (!reader) return;
  if (!/mailbox not configured|mailbox_not_configured/i.test(message)) return;
  reader.innerHTML = '<div class="support-empty"><p class="eyebrow">ONE-TIME SETUP</p><h3>Namecheap mailbox credentials needed</h3><p class="muted">The Back Office inbox is built and connected to its secure server function. Add the Namecheap application password to the server secret to turn the mailbox on.</p></div>';
}

function humanError(value) {
  const map = {
    mailbox_not_configured: 'Namecheap mailbox connection needs its application password.',
    authentication_required: 'Your Back Office sign-in expired.',
    invalid_session: 'Your Back Office sign-in expired.',
    admin_access_required: 'This mailbox is restricted to the Back Office owner.',
    message_not_found: 'That message is no longer in the inbox.',
    reply_provider_not_configured: 'Outgoing support email is not configured.',
  };
  return map[value] || String(value || 'Support mailbox request failed.').replaceAll('_', ' ');
}

function shortDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function fullDateTime(value) {
  return value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}

function installStyles() {
  if (document.querySelector('#support-ui-styles')) return;
  const style = document.createElement('style');
  style.id = 'support-ui-styles';
  style.textContent = `
    .support-layout{display:grid;grid-template-columns:minmax(280px,380px) minmax(0,1fr);gap:14px;align-items:start}
    .support-list-panel{padding:0;overflow:hidden}
    .support-list-head{padding:12px;border-bottom:1px solid rgba(226,189,118,.22)}
    .support-list-head input{width:100%}
    .support-list-head #support-count{display:block;margin-top:7px;font-size:10px}
    .support-list{max-height:68vh;overflow:auto}
    .support-message-row{width:100%;display:block;border:0;border-bottom:1px solid rgba(102,212,206,.10);background:transparent;color:inherit;padding:13px;text-align:left;cursor:pointer}
    .support-message-row:hover,.support-message-row.selected{background:rgba(102,212,206,.055)}
    .support-message-row.unread{box-shadow:inset 3px 0 0 var(--teal)}
    .support-message-top{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
    .support-message-top strong{font-size:12px;color:var(--cream);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .support-message-top span,.support-message-email{font-size:9px;color:#8e9b98}
    .support-message-subject{font-size:11px;margin-top:5px;color:#d8dedb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .support-message-email{margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .support-reader{min-height:480px}
    .support-reader-head{display:flex;justify-content:space-between;gap:18px;border-bottom:1px solid rgba(226,189,118,.22);padding-bottom:14px}
    .support-reader-head h3{margin:3px 0 7px}
    .support-from{margin:0 0 4px}.support-from span{color:#8e9b98}
    .support-body{white-space:pre-wrap;line-height:1.65;padding:22px 0;min-height:140px}
    .support-attachments{border-top:1px solid rgba(102,212,206,.12);padding:14px 0}
    .support-reply{border-top:1px solid rgba(226,189,118,.22);padding-top:16px}
    .support-reply textarea{width:100%;margin-top:7px}
    .support-reply-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px}
    .support-empty,.support-loading,.support-error{padding:42px 20px}
    .support-list-empty{padding:20px}
    @media(max-width:900px){.support-layout{grid-template-columns:1fr}.support-list{max-height:36vh}.support-reader{min-height:360px}}
  `;
  document.head.append(style);
}
