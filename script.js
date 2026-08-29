const assetMap = {
  'assets/search-interface.webp': 'assets/search-interface.svg',
  'assets/cleanup-dashboard.webp': 'assets/cleanup-dashboard.svg',
  'assets/inventory-review.webp': 'assets/inventory-review.svg'
};

document.querySelectorAll('img[src]').forEach(img => {
  const replacement = assetMap[img.getAttribute('src')];
  if (replacement) img.setAttribute('src', replacement);
});

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
