const config = window.CACHE_COMPASS_ADMIN_CONFIG;
const modal = document.querySelector('#purge-modal');
const button = document.querySelector('#purge-confirm-button');
const note = document.querySelector('#purge-note');
const confirmation = document.querySelector('#purge-confirmation');
const appMessage = document.querySelector('#app-message');

if (config?.purgeFunctionUrl && modal && button && note && confirmation && appMessage) {
  let purgeAttemptActive = false;
  let purgeSucceeded = false;
  let lastFailure = '';

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const [input, init = {}] = args;
    const url = typeof input === 'string' ? input : input?.url || '';
    let payload = null;
    if (url === config.purgeFunctionUrl && String(init?.method || 'GET').toUpperCase() === 'POST') {
      try { payload = JSON.parse(String(init?.body || '{}')); } catch { payload = null; }
    }

    if (payload?.action !== 'purge') return nativeFetch(...args);

    purgeAttemptActive = true;
    purgeSucceeded = false;
    lastFailure = '';
    setRunningState();

    const response = await nativeFetch(...args);
    const body = await response.clone().json().catch(() => ({}));
    if (response.ok) {
      purgeSucceeded = true;
    } else {
      lastFailure = failureReason(body, response.status);
    }
    return response;
  };

  button.addEventListener('click', (event) => {
    if (button.dataset.purgeState === 'complete') {
      event.preventDefault();
      event.stopImmediatePropagation();
      modal.hidden = true;
      resetState();
      return;
    }

    if (button.dataset.purgeState === 'failed') {
      button.dataset.purgeState = '';
      button.textContent = 'Permanently Purge';
      button.classList.remove('gold');
      button.classList.add('danger-button');
      note.style.color = '';
    }

    if (!button.disabled && confirmation.value.trim().toUpperCase() === 'PURGE') {
      purgeAttemptActive = true;
      setRunningState();
    }
  }, true);

  const messageObserver = new MutationObserver(() => {
    if (!purgeAttemptActive || !purgeSucceeded) return;
    if ((appMessage.textContent || '').trim() !== 'Purge complete.') return;

    // app.js has already refreshed its in-memory lists at this point. Reopen the
    // result panel so the owner sees confirmation while the deleted row is already
    // gone behind it, without a browser refresh.
    modal.hidden = false;
    confirmation.disabled = true;
    button.disabled = false;
    button.dataset.purgeState = 'complete';
    button.textContent = 'Complete';
    button.classList.remove('danger-button');
    button.classList.add('gold');
    note.textContent = 'Purge complete. The record has been removed from the Back Office.';
    note.style.color = 'var(--teal)';
    purgeAttemptActive = false;
  });
  messageObserver.observe(appMessage, { childList: true, characterData: true, subtree: true });

  const noteObserver = new MutationObserver(() => {
    if (!purgeAttemptActive || purgeSucceeded || !lastFailure) return;
    setTimeout(() => {
      if (!purgeAttemptActive || purgeSucceeded) return;
      button.disabled = false;
      button.dataset.purgeState = 'failed';
      button.textContent = 'Failed — Try Again';
      button.classList.remove('gold');
      button.classList.add('danger-button');
      note.textContent = `Purge failed: ${lastFailure}`;
      note.style.color = 'var(--danger)';
      purgeAttemptActive = false;
    }, 0);
  });
  noteObserver.observe(note, { childList: true, characterData: true, subtree: true });

  document.addEventListener('click', (event) => {
    if (!event.target.closest?.('[data-close-purge-modal]')) return;
    setTimeout(resetState, 0);
  });

  function setRunningState() {
    button.dataset.purgeState = 'running';
    button.textContent = 'Purging…';
    button.classList.remove('gold');
    button.classList.add('danger-button');
    note.style.color = '';
  }

  function resetState() {
    purgeAttemptActive = false;
    purgeSucceeded = false;
    lastFailure = '';
    button.dataset.purgeState = '';
    button.classList.remove('gold');
    button.classList.add('danger-button');
    note.style.color = '';
  }

  function failureReason(body, status) {
    const detail = String(body?.detail || '').trim();
    if (detail) return detail;
    switch (body?.error) {
      case 'retention_required': return 'This record contains financial or legal evidence that must be retained.';
      case 'owner_access_required': return 'Your current session does not have owner permission for permanent purge.';
      case 'authentication_required':
      case 'invalid_session': return 'Your owner sign-in has expired. Sign in again and retry.';
      case 'license_not_found': return 'The license no longer exists.';
      case 'customer_not_found': return 'The customer no longer exists.';
      case 'sale_not_found':
      case 'purchase_not_found': return 'The sale no longer exists.';
      case 'purge_failed': return 'The server could not safely remove all dependent records, so the purge was stopped.';
      default: return status >= 500 ? 'The purge service encountered a server error and did not complete.' : 'The purge request could not be completed.';
    }
  }
}
