const heroPhoto = document.querySelector('.boss-photo');
if (heroPhoto) {
  heroPhoto.style.backgroundImage = 'url("assets/header.jpg")';
}

const features = document.querySelector('#features');
if (features) {
  const existingFeatures = Array.from(features.querySelectorAll('.desktop-feature'));
  const [searchFeature, cleanupFeature, reviewFeature] = existingFeatures;

  if (searchFeature) {
    searchFeature.insertAdjacentHTML('beforebegin', `
      <div class="feature desktop-feature">
        <div class="feature-copy">
          <span class="feature-number">01</span>
          <p class="mini-title">START HERE</p>
          <h3>Start with the viewer you already use.</h3>
          <p>Open Firestorm and let Inventory finish loading. Then use Start Here. Cache Compass detects the avatar already signed in and works alongside your viewer.</p>
          <p><strong>No separate SL login. No manual account picker.</strong></p>
        </div>
        <figure class="app-shot app-shot-real"><img src="assets/screens/welcome.webp" alt="Cache Compass Welcome screen with Firestorm detected and the guided Start Here workflow" width="600" height="355" loading="lazy" /><figcaption>The real Cache Compass Welcome screen with Firestorm detected and the guided Start Here workflow.</figcaption></figure>
      </div>

      <div class="feature reverse desktop-feature">
        <div class="feature-copy">
          <span class="feature-number">02</span>
          <p class="mini-title">PROTECTED FOLDERS</p>
          <h3>Protect what matters before cleanup begins.</h3>
          <p>Protect any folders Cleanup should never touch — outfits, projects, business stock, HUDs, scripts, or anything irreplaceable.</p>
          <p>Built-in safeguards protect sensitive inventory, while <strong>Search Only can still find what’s inside.</strong></p>
        </div>
        <figure class="app-shot app-shot-real"><img src="assets/screens/protected.webp" alt="Cache Compass Protected Folders screen showing user-selected folders and built-in protections" width="600" height="355" loading="lazy" /><figcaption>Protected Folders shows exact user exclusions alongside Cache Compass's built-in safeguards.</figcaption></figure>
      </div>
    `);
  }

  if (searchFeature) {
    searchFeature.className = 'feature desktop-feature';
    const number = searchFeature.querySelector('.feature-number');
    const copy = searchFeature.querySelector('.feature-copy');
    const image = searchFeature.querySelector('img');
    const caption = searchFeature.querySelector('figcaption');
    if (number) number.textContent = '03';
    if (copy) copy.innerHTML = `<span class="feature-number">03</span><p class="mini-title">SEARCH ONLY</p><h3>You remember the words. Cache Compass finds the mess.</h3><p>Creators all name things differently — punctuation, symbols, abbreviations, body tags, version numbers, folder names that don’t match the product name. You shouldn’t have to guess the exact wording.</p><p>Type what you remember — <strong>Reborn shirt</strong>, <strong>Blueberry jeans</strong>, <strong>Legacy heels</strong>, <strong>DEMO</strong> — and let Cache Compass use those words and folder paths to narrow it down.</p><p><strong>Search Only is read-only.</strong> It never moves files.</p>`;
    if (image) {
      image.src = 'assets/screens/search.webp';
      image.alt = 'Cache Compass Search Only screen showing the read-only inventory search interface';
      image.width = 600;
      image.height = 354;
    }
    if (caption) caption.textContent = 'The real Search Only tab: read-only inventory search that never moves files.';
  }

  if (cleanupFeature) {
    cleanupFeature.className = 'feature reverse desktop-feature';
    const copy = cleanupFeature.querySelector('.feature-copy');
    const image = cleanupFeature.querySelector('img');
    const caption = cleanupFeature.querySelector('figcaption');
    if (copy) copy.innerHTML = `<span class="feature-number">04</span><p class="mini-title">CLEANUP</p><h3>Stop hunting for the same junk one folder at a time.</h3><p>Landmarks. Notecards. Demos. Old body sizes. Empty folders. Duplicate copies. Tell Cache Compass what kind of clutter you’re looking for and it builds the pile for you.</p><p><strong>Nothing moves until you review it. You decide what goes.</strong></p>`;
    if (image) {
      image.src = 'assets/screens/cleanup.webp';
      image.alt = 'Cache Compass Cleanup screen showing Duplicate Cleanup and Keyword Cleanup controls';
      image.width = 600;
      image.height = 358;
    }
    if (caption) caption.textContent = 'Cleanup combines duplicate and keyword scans with inventory-type and folder controls.';
  }

  if (reviewFeature) {
    reviewFeature.className = 'feature desktop-feature';
    const copy = reviewFeature.querySelector('.feature-copy');
    const image = reviewFeature.querySelector('img');
    const caption = reviewFeature.querySelector('figcaption');
    if (copy) copy.innerHTML = `<span class="feature-number">05</span><p class="mini-title">REVIEW &amp; MOVE</p><h3>You choose what goes. Cache Compass moves it to Trash.</h3><p>Review the matches, select what you want removed, and Cache Compass moves those items to your Second Life Trash.</p><p><strong>Nothing is permanently deleted by Cache Compass. Empty Trash in-world when you’re ready.</strong></p>`;
    if (image) {
      image.src = 'assets/screens/review.webp';
      image.alt = 'Cache Compass Review screen showing items ready for review before anything is moved';
      image.width = 600;
      image.height = 355;
    }
    if (caption) caption.textContent = 'Review the matches, choose what goes, and move only what you approve.';
  }

  const story = document.createElement('section');
  story.className = 'sl-story';
  story.setAttribute('aria-label', 'A dead end for inventory clutter');
  story.innerHTML = `
    <div class="sl-story-copy">
      <h2>A dead end for inventory clutter.</h2>
      <p>Keep what matters. Find what doesn’t. Review it once, move it to Trash, and stop letting years of leftovers take over your inventory.</p>
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