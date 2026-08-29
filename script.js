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
  const existingFeatures = Array.from(features.querySelectorAll('.desktop-feature'));
  const [searchFeature, cleanupFeature, reviewFeature] = existingFeatures;

  if (searchFeature) {
    searchFeature.insertAdjacentHTML('beforebegin', `
      <div class="feature desktop-feature">
        <div class="feature-copy">
          <span class="feature-number">01</span>
          <p class="mini-title">START HERE</p>
          <h3>Start with the viewer you already use.</h3>
          <p>Open Firestorm, let Inventory finish loading, then use Start Here. Cache Compass confirms the supported Firestorm session, binds to the avatar currently signed in, and lays out the workflow before anything is searched or moved.</p>
          <p><strong>There is no separate Second Life login or manual account picker.</strong> Your viewer stays authenticated; Cache Compass works alongside it.</p>
        </div>
        <figure class="app-shot app-shot-real"><img src="assets/screens/welcome.webp" alt="Cache Compass Welcome screen with Firestorm detected and the guided Start Here workflow" width="600" height="355" loading="lazy" /><figcaption>The real Cache Compass Welcome screen with Firestorm detected and the guided Start Here workflow.</figcaption></figure>
      </div>

      <div class="feature reverse desktop-feature">
        <div class="feature-copy">
          <span class="feature-number">02</span>
          <p class="mini-title">PROTECTED FOLDERS</p>
          <h3>Protect what matters before cleanup begins.</h3>
          <p>Mark exact folders Cleanup must never include — full-perm masters, favorite wearables, saved outfits, current projects, business or vendor stock, HUDs, scripts, and sentimental or irreplaceable inventory.</p>
          <p>Built-in protections cover personal-inventory-only cleanup, no-copy inventory, system folders, and your exact folder choices. <strong>Search Only can still find items inside protected folders.</strong></p>
          <div class="tag-cloud"><span>No-copy protection</span><span>System folders</span><span>Exact folder IDs</span><span>Search still works</span></div>
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
    if (copy) copy.innerHTML = `<span class="feature-number">03</span><p class="mini-title">SEARCH ONLY</p><h3>Find it without touching it.</h3><p>Search the way you remember an item instead of guessing its exact inventory name. Cache Compass looks through names and folder paths while accounting for punctuation, formatting, and word order.</p><p><strong>Search Only is read-only.</strong> It never moves files. Review what it finds, export the results if you want, then use those results to locate what you need in Second Life.</p><div class="tag-cloud"><span>Read-only</span><span>Store names</span><span>Body sizes</span><span>Product names</span><span>Folder paths</span></div>`;
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
    if (copy) copy.innerHTML = `<span class="feature-number">04</span><p class="mini-title">CLEANUP</p><h3>Find the clutter. Review it. Then clean it.</h3><p>Duplicate Cleanup and Keyword Cleanup can work separately or together. Choose the inventory types you want included, add folder-copy or empty-folder options when useful, and let Cache Compass build the review list.</p><p>Nothing moves while the list is being built. <strong>Results open in Review so you can decide what actually leaves your inventory.</strong></p><div class="tag-cloud"><span>Exact copies</span><span>Keyword cleanup</span><span>Inventory types</span><span>Folder copies</span><span>Empty folders</span></div>`;
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
    if (copy) copy.innerHTML = `<span class="feature-number">05</span><p class="mini-title">REVIEW FIRST</p><h3>Nothing moves until you approve it.</h3><p>Cache Compass can surface thousands of candidates without making the decision for you. The Review screen gives you the names, types, folders, item counts, and inventory UUIDs before any move is approved.</p><p>This real cleanup run surfaced <strong>5,485 items ready for review</strong> while the status still read: <strong>Nothing has moved yet.</strong> Select only what you want Firestorm to move.</p>`;
    if (image) {
      image.src = 'assets/screens/review.webp';
      image.alt = 'Cache Compass Review screen with 5,485 items ready for review before anything is moved';
      image.width = 600;
      image.height = 355;
    }
    if (caption) caption.textContent = 'A real Review run with 5,485 items surfaced before any move is approved.';
  }

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

const privacy = document.querySelector('#privacy');
if (privacy) {
  privacy.insertAdjacentHTML('beforeend', `
    <figure class="app-shot app-shot-real" style="margin:34px 0 0">
      <img src="assets/screens/welcome-safety.webp" alt="Cache Compass Welcome screen showing built-in protections, restore guidance, and important inventory safety notes" width="600" height="356" loading="lazy" />
      <figcaption>Welcome-screen safety guidance, built-in protections, restore behavior, and inventory safety notes.</figcaption>
    </figure>
  `);
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
