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

const features = document.querySelector('#features');
if (features) {
  const story = document.createElement('section');
  story.className = 'sl-story';
  story.setAttribute('aria-label', 'Second Life lifestyle');
  story.innerHTML = `
    <div class="shell sl-story-copy">
      <p class="eyebrow">WHY INVENTORIES GET BIG</p>
      <h2>Second Life is worth collecting.<em>Your clutter isn’t.</em></h2>
      <p>We shop, decorate, build, travel, take photos, save landmarks, collect animations, and keep the things that make our Second Life ours. Cache Compass is built to help keep the accumulation manageable without treating your inventory like disposable data.</p>
    </div>`;
  features.insertAdjacentElement('afterend', story);
}

const how = document.querySelector('#how');
if (how) {
  const life = document.createElement('section');
  life.className = 'sl-life';
  life.setAttribute('aria-label', 'Life in Second Life');
  life.innerHTML = `
    <div class="sl-life-grid">
      <article class="sl-life-card explore">
        <div class="sl-life-copy"><strong>Explore</strong><span>Places, experiences, and landmarks worth keeping.</span></div>
      </article>
      <article class="sl-life-card create">
        <div class="sl-life-copy"><strong>Create</strong><span>Homes, looks, objects, and memories that become part of your inventory.</span></div>
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
