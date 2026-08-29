const heroPhoto = document.querySelector('.boss-photo');
if (heroPhoto) {
  const heroParts = Array.from({ length: 9 }, (_, i) =>
    `assets/hero-wide-${String(i).padStart(2, '0')}.txt`
  );

  Promise.all(heroParts.map(src => fetch(src, { cache: 'no-store' }).then(response => {
    if (!response.ok) throw new Error(`Unable to load ${src}`);
    return response.text();
  })))
    .then(parts => {
      const encoded = parts.join('').replace(/\s+/g, '');
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'image/webp' });
      heroPhoto.style.backgroundImage = `url("${URL.createObjectURL(blob)}")`;
    })
    .catch(error => console.error('Cache Compass hero image failed to load:', error));
}

const features = document.querySelector('#features');
if (features) {
  const story = document.createElement('section');
  story.className = 'sl-story';
  story.setAttribute('aria-label', 'Why Second Life inventories get big');
  story.innerHTML = `
    <div class="sl-story-copy">
      <p class="eyebrow">HOW THE MONSTER HAPPENED</p>
      <h2>Second Life is worth collecting.<em>Your clutter isn’t.</em></h2>
      <p>You shopped. You decorated. You changed bodies. You grabbed event gifts. You saved landmarks. You unpacked the fatpack twice. You kept the demo because maybe you’d need it later. None of that was a mistake. It’s just how a Second Life inventory becomes a monster.</p>
      <p><strong>Cache Compass was built for the monster.</strong></p>
    </div>`;
  features.insertAdjacentElement('afterend', story);
}

const toggle = document.querySelector('.nav-toggle');
const nav = document.querySelector('.site-nav');
if (toggle && nav) {
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });

  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    nav.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  }));
}
