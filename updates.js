const RELEASE_ENDPOINT = 'https://glamoujtjfczrpkrpbmp.supabase.co/functions/v1/public-update-release';
const PUBLIC_ANON_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsYW1vdWp0amZjenJwa3JwYm1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwNjAzMzgsImV4cCI6MjEwMzYzNjMzOH0.HM2YIawznoIV0kodJrStduSJp63hcbKwHr9b5BYyqhs';
const DOWNLOAD_URL = 'https://cache-compass-downloads.lucyinthesky395.workers.dev/updates/latest/CacheCompass-Setup.exe';
async function currentRelease() {
  const response = await fetch(RELEASE_ENDPOINT, {headers: {authorization: 'Bearer ' + PUBLIC_ANON_JWT}});
  if (!response.ok) throw new Error('release_unavailable');
  const release = await response.json();
  if (!/^\d+\.\d+\.\d+$/.test(release.version) || !/^[a-f0-9]{64}$/.test(release.sha256) ||
      !Number.isSafeInteger(release.fileSize) || release.fileSize <= 0 || release.downloadUrl !== DOWNLOAD_URL ||
      !Number.isFinite(new Date(release.publishedAt).getTime())) throw new Error('invalid_release');
  return release;
}
try {
  const release = await currentRelease();
  for (const label of document.querySelectorAll('[data-release-version]')) label.textContent = release.version;
  for (const label of document.querySelectorAll('[data-release-size]')) label.textContent = Math.round(release.fileSize / 1048576) + ' MiB';
  for (const label of document.querySelectorAll('[data-release-date]')) {
    label.textContent = new Intl.DateTimeFormat('en-US', {year: 'numeric',month: 'long',day: 'numeric',timeZone: 'America/New_York'}).format(new Date(release.publishedAt));
    label.dateTime = release.publishedAt;
  }
  const button = document.getElementById('update-download');
  if (button) {button.href = DOWNLOAD_URL; button.removeAttribute('aria-disabled');}
  const status = document.getElementById('release-status');
  if (status) status.textContent = 'Latest installer available.';
  if (release.version !== '1.0.8') {
    document.getElementById('changes-108')?.setAttribute('hidden', '');
    const notes = document.getElementById('future-release-notes');
    if (notes) {notes.textContent = release.releaseNotes || 'Download the latest release above.'; notes.hidden = false;}
  }
} catch {
  const status = document.getElementById('release-status');
  if (status) status.textContent = 'The update download is temporarily unavailable. Please try again or contact support.';
}

