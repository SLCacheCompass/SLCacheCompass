import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.CACHE_COMPASS_ADMIN_CONFIG;
if (config?.supabaseUrl && config?.supabaseAnonKey && config?.releaseFunctionUrl) {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  const form = document.querySelector('#release-form');
  if (form) form.addEventListener('submit', publishReleaseDirect, true);

  async function publishReleaseDirect(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const message = document.querySelector('#release-message');
    const button = form.querySelector('button[type="submit"]');
    const version = String(form.elements.version?.value || '').trim();
    const releaseNotes = String(form.elements.releaseNotes?.value || '').trim();
    const file = form.elements.file?.files?.[0];
    if (!file) { message.textContent = 'Choose the Cache Compass installer first.'; return; }
    if (!/^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$/.test(version)) { message.textContent = 'Enter a valid release version.'; return; }
    if (!file.name.toLowerCase().endsWith('.exe')) { message.textContent = 'The customer release must be the CacheCompass-Setup.exe installer.'; return; }

    try {
      button.disabled = true;
      message.textContent = 'Calculating SHA-256…';
      const sha256 = await digestHex(await file.arrayBuffer());
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Your sign-in expired. Please sign in again.');

      message.textContent = 'Preparing private upload…';
      const prepare = await callRelease(token, {
        action: 'create_upload', version, sha256, fileSize: file.size,
      });

      message.textContent = 'Uploading installer…';
      const uploaded = await supabase.storage
        .from(prepare.upload.bucket)
        .uploadToSignedUrl(prepare.upload.path, prepare.upload.token, file, {
          contentType: 'application/octet-stream', upsert: false,
        });
      if (uploaded.error) throw uploaded.error;

      message.textContent = 'Publishing release…';
      const finalized = await callRelease(token, {
        action: 'finalize', version, sha256, fileSize: file.size,
        storagePath: prepare.upload.path, releaseNotes,
      });
      const release = finalized.release;
      message.textContent = `Version ${release.version} is now the active private customer download. SHA-256: ${release.sha256}`;
      form.reset();
    } catch (error) {
      message.textContent = error?.message || 'Release upload failed.';
    } finally {
      button.disabled = false;
    }
  }

  async function callRelease(token, body) {
    const response = await fetch(config.releaseFunctionUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(result.error || 'Release operation failed').replaceAll('_', ' '));
    return result;
  }

  async function digestHex(buffer) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
}
