const assetMap = {
  'assets/cleanup-dashboard.webp': 'assets/cleanup-dashboard.svg',
  'assets/inventory-review.webp': 'assets/inventory-review.svg'
};

document.querySelectorAll('img[src]').forEach(img => {
  const replacement = assetMap[img.getAttribute('src')];
  if (replacement) img.setAttribute('src', replacement);
});

const artStyles = document.createElement('link');
artStyles.rel = 'stylesheet';
artStyles.href = 'art.css';
document.head.appendChild(artStyles);

// Rebuild the user-supplied wide hero image from same-origin text chunks.
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
    const heroUrl = URL.createObjectURL(blob);
    const heroImageStyle = document.createElement('style');
    heroImageStyle.textContent = `.hero-clean::after{background-image:url("${heroUrl}")!important;}`;
    document.head.appendChild(heroImageStyle);
  })
  .catch(error => {
    console.error('Cache Compass hero image failed to load:', error);
  });

const heroTitle = document.querySelector('#hero-title');
const heroBenefits = document.querySelector('.hero-benefits');
const problemStrip = document.querySelector('.problem-strip');
if (heroTitle) {
  heroTitle.innerHTML = '<span class="hero-the">THE</span><span class="hero-inventory">INVENTORY</span><span class="hero-finalboss">FINAL BOSS.</span>';
}
if (heroBenefits && problemStrip) {
  const benefitBand = document.createElement('section');
  benefitBand.className = 'hero-benefit-band';
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.appendChild(heroBenefits);
  benefitBand.appendChild(shell);
  problemStrip.insertAdjacentElement('beforebegin', benefitBand);
}

const features = document.querySelector('#features');
if (features) {
  const story = document.createElement('section');
  story.className = 'sl-story';
  story.setAttribute('aria-label', 'Why Second Life inventories get big');
  story.innerHTML = `
    <div class="shell sl-story-copy">
      <p class="eyebrow">HOW THE MONSTER HAPPENED</p>
      <h2>Second Life is worth collecting.<em>Your clutter isn’t.</em></h2>
      <p>You shopped. You decorated. You changed bodies. You grabbed event gifts. You saved landmarks. You unpacked the fatpack twice. You kept the demo because maybe you’d need it later. None of that was a mistake. It’s just how a Second Life inventory becomes a monster.</p>
      <p><strong>Cache Compass was built for the monster.</strong></p>
    </div>`;
  features.insertAdjacentElement('afterend', story);
}

const how = document.querySelector('#how');
if (how) {
  const life = document.createElement('section');
  life.className = 'sl-life';
  life.setAttribute('aria-label', 'The things worth keeping in Second Life');
  life.innerHTML = `
    <div class="sl-life-grid">
      <article class="sl-life-card explore">
        <div class="sl-life-copy"><strong>Keep the adventure</strong><span>Places, experiences, and landmarks that are part of your Second Life.</span></div>
      </article>
      <article class="sl-life-card create">
        <div class="sl-life-copy"><strong>Keep what matters</strong><span>Homes, looks, objects, and memories — without letting the leftovers bury them.</span></div>
      </article>
    </div>`;
  how.insertAdjacentElement('afterend', life);
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
    toggle.setAttribute('aria-expanded','false');
  }));
}
