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

// Make the footer's Back to top control reliable even when the URL already contains #top.
const backToTop = document.querySelector('.footer-links a[href="#top"]');
if (backToTop) {
  backToTop.addEventListener('click', event => {
    event.preventDefault();
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
  });
}

// Plain-English alt account and avatar-license guidance.
document.querySelectorAll('#faq details').forEach(detail => {
  const summary = detail.querySelector('summary');
  const answer = detail.querySelector('p');
  if (summary && answer && summary.textContent.trim() === 'Can I use it on an alt?') {
    answer.textContent = 'Yes. Cache Compass works with whichever avatar is currently logged into Firestorm. To switch, log into the other avatar in Firestorm and reopen Cache Compass. The standard license covers up to 3 avatars, with options for 5 or 10 avatars for residents with a larger collection of alts. Cache Compass never asks for or stores your Second Life password.';
  }
});

// Add recovery and additional-avatar FAQs without disturbing the existing FAQ markup.
const faqList = document.querySelector('#faq .faq-list');
const addFaq = (question, answer) => {
  if (!faqList) return;
  const alreadyExists = Array.from(faqList.querySelectorAll('summary'))
    .some(summary => summary.textContent.trim() === question);
  if (alreadyExists) return;

  const detail = document.createElement('details');
  const summary = document.createElement('summary');
  const paragraph = document.createElement('p');
  summary.textContent = question;
  paragraph.textContent = answer;
  detail.append(summary, paragraph);
  faqList.appendChild(detail);
};

addFaq(
  'What if I get a new computer?',
  'No problem. Install Cache Compass on your new Windows computer, open Firestorm, and log into an Avatar already registered to your license. Using the same registered Avatar on a new computer does not use another Alt slot.'
);

addFaq(
  'What if I need to reinstall Cache Compass?',
  'Just reinstall Cache Compass, open Firestorm, and log into one of your registered Avatars. Reinstalling Cache Compass does not use another Alt slot.'
);

addFaq(
  'What if I need more Alt spots?',
  'You can add more Alt spots through the Cache Compass kiosk at any time, up to a total of 30 active Avatars. Your existing registered Avatars stay exactly as they are and the additional capacity is added to your existing license. If you need more than 30, contact Cache Compass support.'
);

// Make the self-service 30-avatar limit clear near pricing.
const pricingSection = document.querySelector('#pricing .shell');
if (pricingSection && !document.querySelector('#avatar-cap-note')) {
  const capNote = document.createElement('p');
  capNote.id = 'avatar-cap-note';
  capNote.className = 'pricing-note';
  capNote.innerHTML = '<strong>Need more Alt spots later?</strong> Add capacity through the in-world kiosk up to a total of 30 active Avatars. Larger accounts can contact support.';

  const systemRequirements = Array.from(pricingSection.querySelectorAll('.pricing-note'))
    .find(note => note.textContent.includes('System requirements:'));
  if (systemRequirements) {
    systemRequirements.insertAdjacentElement('beforebegin', capNote);
  } else {
    pricingSection.appendChild(capNote);
  }
}

// Keep the website's short refund language aligned with the published policy.
if (pricingSection) {
  const refundNote = Array.from(pricingSection.querySelectorAll('.pricing-note'))
    .find(note => note.textContent.includes('All sales are final. No refunds.'));
  if (refundNote) {
    refundNote.innerHTML = '<strong>Digital software purchases are generally final after delivery or activation.</strong> Duplicate charges, failed provisioning, unresolved verified Cache Compass technical failures, purchasing-system errors, and any refunds required by law are handled under our <a href="/refund-policy.html">Refund Policy</a>.';
  }
}

// Surface the legal package from the site footer without changing the existing layout structure.
const footerLinks = document.querySelector('.footer-links');
if (footerLinks) {
  const legalLinks = [
    ['Terms & License', '/terms.html'],
    ['Privacy Policy', '/privacy-policy.html'],
    ['Refund Policy', '/refund-policy.html']
  ];
  legalLinks.forEach(([label, href]) => {
    if (!footerLinks.querySelector(`a[href="${href}"]`)) {
      const link = document.createElement('a');
      link.href = href;
      link.textContent = label;
      footerLinks.appendChild(link);
    }
  });
}
