import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.CACHE_COMPASS_ADMIN_CONFIG;
const form = document.querySelector('#issue-form');

if (form && config?.supabaseUrl && config?.supabaseAnonKey) {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  const endpoint = `${config.supabaseUrl}/functions/v1/admin-issue-license`;

  // Capture phase replaces the legacy issue path without changing the rest of app.js.
  // issue-guard.js still runs first and may block duplicate active entitlements.
  form.addEventListener('submit', issueLicense, true);

  async function issueLicense(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    const appMessage = document.querySelector('#app-message');
    const issued = document.querySelector('#issued-license');
    const submit = form.querySelector('button[type="submit"]');
    const payload = Object.fromEntries(new FormData(form));
    for (const key of Object.keys(payload)) if (payload[key] === '') delete payload[key];

    try {
      submit.disabled = true;
      if (appMessage) appMessage.textContent = 'Creating license…';
      if (issued) {
        issued.hidden = true;
        issued.textContent = '';
      }

      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('Your sign-in expired. Please sign in again.');

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${data.session.access_token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(humanError(result.error, result.detail));

      if (issued) {
        issued.hidden = false;
        issued.innerHTML = `<strong>License created:</strong> ${escapeHtml(result.licenseKey)}<br>Copy it now. Only the secure hash is stored.<br><button id="refresh-after-issue" class="mini-button" type="button" style="margin-top:9px">Refresh Back Office</button>`;
        issued.querySelector('#refresh-after-issue')?.addEventListener('click', () => location.reload());
      }
      if (appMessage) appMessage.textContent = 'License created. Copy the key before refreshing.';
    } catch (error) {
      if (appMessage) appMessage.textContent = error.message;
      alert(`Could not create this license: ${error.message}`);
      submit.disabled = false;
    }
  }

  function humanError(code, detail) {
    const known = {
      invalid_tier: 'Choose a 3, 5, or 10 avatar tier.',
      invalid_avatar_uuid: 'The avatar UUID is not valid.',
      invalid_payment_amount: 'The payment amount is not valid.',
      invalid_currency: 'Currency must be USD or L$.',
      duplicate_transaction: 'That receipt / transaction is already recorded.',
      admin_access_required: 'Your Back Office account is not authorized to issue licenses.',
      authentication_required: 'Your sign-in expired. Please sign in again.',
      invalid_session: 'Your sign-in expired. Please sign in again.',
      license_issue_failed: 'The license could not be created.',
    };
    if (known[code]) return detail && code === 'license_issue_failed' ? `${known[code]} ${detail}` : known[code];
    return detail || String(code || 'License creation failed').replaceAll('_', ' ');
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
  }
}
