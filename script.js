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

// Keep the primary hero action directly beneath and centered under the main headline.
const heroTitle = document.querySelector('#hero-title');
const bossCta = document.querySelector('.boss-cta');
if (heroTitle && bossCta) {
  heroTitle.insertAdjacentElement('afterend', bossCta);
  bossCta.style.display = 'flex';
  bossCta.style.width = 'max-content';
  bossCta.style.margin = '24px auto 30px';
}

// Plain-English alt account and avatar-license guidance.
document.querySelectorAll('#faq details').forEach(detail => {
  const summary = detail.querySelector('summary');
  const answer = detail.querySelector('p');
  if (summary && answer && summary.textContent.trim() === 'Can I use it on an alt?') {
    answer.textContent = 'Yes. Cache Compass works with whichever avatar is currently logged into Firestorm. To use another avatar, switch accounts in Firestorm first, then open Cache Compass. The standard Cache Compass license covers up to 3 avatars, with 5- and 10-avatar options available if you need more. Cache Compass never asks for or stores your Second Life password.';
  }
});
