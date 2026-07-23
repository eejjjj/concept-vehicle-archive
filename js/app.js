/* ── Silhouettes ─────────────────────────────────────────────── */
const SIL_A = `<svg viewBox="0 0 240 90" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M8 62 C28 38 52 42 78 38 L168 34 C192 32 218 44 232 52 L236 58 L228 66 C208 74 178 70 148 68 L72 72 C42 74 18 70 8 62Z"/>
  <path d="M62 38 L68 18 C74 12 86 14 92 22 L98 38Z" opacity=".45"/>
  <ellipse cx="48" cy="64" rx="10" ry="10" opacity=".5"/>
  <ellipse cx="188" cy="60" rx="10" ry="10" opacity=".5"/>
</svg>`;

const SIL_B = `<svg viewBox="0 0 240 90" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 58 L36 40 L96 34 L178 36 L220 48 L228 56 L214 66 L138 70 L52 68 L12 58Z"/>
  <rect x="102" y="24" width="48" height="14" rx="1" opacity=".35"/>
  <ellipse cx="58" cy="66" rx="9" ry="9" opacity=".5"/>
  <ellipse cx="182" cy="64" rx="9" ry="9" opacity=".5"/>
</svg>`;

const SILHOUETTES = [SIL_A, SIL_B, SIL_A, SIL_B, SIL_A, SIL_B, SIL_A, SIL_B, SIL_A];

const ARROW = `<svg viewBox="0 0 24 24" stroke-width="1.5"><path d="M7 17L17 7M17 7H7M17 7V17"/></svg>`;
const LOCK = `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.2"><rect x="5" y="11" width="14" height="10" rx="1"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>`;

/* ── Utils ───────────────────────────────────────────────────── */
function pad(n) {
  return String(n).padStart(2, '0');
}

function navigate(url) {
  Motion.pageExit(url);
}

function setDate() {
  /* reserved */
}

function setArchiveMode(on) {
  document.body.classList.toggle('is-archive', on);
  document.body.classList.toggle('is-intro', !on);
}

/* ── Entrance ────────────────────────────────────────────────── */
function initEntrance() {
  const entrance = document.getElementById('entrance');
  const page = document.getElementById('page');
  const introLabel = document.getElementById('site-intro-label');
  if (!entrance || !page) return;

  async function revealArchive(e) {
    if (e) e.preventDefault();
    IntroGrid.destroy();
    entrance.classList.add('is-hidden');
    page.classList.add('is-visible');
    document.body.style.cursor = '';
    setArchiveMode(true);
    Motion.revealChrome();
    revealModules();
    sessionStorage.setItem('cva-entered', '1');
  }

  if (sessionStorage.getItem('cva-entered')) {
    entrance.classList.add('is-hidden');
    page.classList.add('is-visible');
    setArchiveMode(true);
    buildGrid();
    Motion.revealChrome();
    revealModules();
    Motion.bootPageEnter();
    return;
  }

  setArchiveMode(false);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (window.IntroGrid) IntroGrid.init('intro-canvas');
    });
  });

  entrance.addEventListener('click', revealArchive);
  if (introLabel) introLabel.addEventListener('click', revealArchive);
}

function revealModules() {
  document.querySelectorAll('.module').forEach((mod, i) => {
    mod.style.transitionDelay = `${140 + i * 88}ms`;
    requestAnimationFrame(() => mod.classList.add('is-revealed'));
  });
}

/* ── Module Grid ───────────────────────────────────────────────── */
function buildGrid() {
  const grid = document.getElementById('module-grid');
  if (!grid) return;

  grid.innerHTML = '';

  VEHICLES.forEach((v, i) => {
    const mod = document.createElement('article');
    const isOpen = v.available;
    mod.className = `module ${isOpen ? 'is-open' : 'is-locked'}`;
    mod.setAttribute('role', 'listitem');
    mod.setAttribute('aria-label', isOpen ? v.name : `Module ${pad(v.id)} locked`);

    mod.innerHTML = `
      <div class="module__glow"></div>
      <div class="module__index"><strong>${pad(v.id)}</strong> / 09</div>
      ${isOpen ? `<div class="module__arrow">${ARROW}</div>` : ''}
      <div class="module__visual">
        ${isOpen
          ? `<div class="module__silhouette">${SILHOUETTES[i]}</div>`
          : `<div class="module__lock">${LOCK}</div>`}
      </div>
      <div class="module__footer">
        <div class="module__label">
          <div class="module__code">${v.code}</div>
          <div class="module__name">${isOpen ? v.name : '— — —'}</div>
        </div>
        <div class="module__state">${isOpen ? 'Open' : 'Locked'}</div>
      </div>
    `;

    if (isOpen) {
      mod.addEventListener('click', () => navigate(`vehicle.html?id=${v.id}`));
      mod.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate(`vehicle.html?id=${v.id}`);
        }
      });
      mod.setAttribute('tabindex', '0');
    } else {
      mod.addEventListener('click', () => {
        mod.classList.remove('is-shake');
        void mod.offsetWidth;
        mod.classList.add('is-shake');
      });
    }

    grid.appendChild(mod);
  });
}

/* ── Detail Page ─────────────────────────────────────────────── */
function initDetail() {
  const id = new URLSearchParams(location.search).get('id');
  const v = getVehicle(id);

  if (!v || !v.available) {
    navigate('index.html');
    return;
  }

  document.title = `${v.name} — Concept Vehicle Archive`;

  document.getElementById('detail-index').textContent = `${pad(v.id)} / 09`;
  document.getElementById('detail-title').textContent = v.name;
  document.getElementById('detail-year').textContent = `Concept ${v.year}`;
  document.getElementById('detail-tagline').textContent = v.tagline;
  document.getElementById('detail-desc').textContent = v.description;

  const visual = document.getElementById('detail-visual');
  visual.innerHTML = SILHOUETTES[v.id - 1];

  document.getElementById('detail-tags').innerHTML = v.tags
    .map((t) => `<span class="detail-tag">${t}</span>`)
    .join('');

  document.getElementById('detail-specs').innerHTML = Object.entries(v.specs)
    .map(([key, val]) => `
      <div class="detail-spec">
        <div class="detail-spec__key">${key}</div>
        <div class="detail-spec__val">${val}</div>
      </div>
    `)
    .join('');

  Motion.revealChrome();
  Motion.bootPageEnter();

  requestAnimationFrame(() => {
    document.getElementById('detail-body').classList.add('is-visible');
    requestAnimationFrame(() => visual.classList.add('is-loaded'));
  });
}

/* ── Boot ────────────────────────────────────────────────────── */
function bootIndex() {
  if (new URLSearchParams(location.search).has('reset')) {
    sessionStorage.removeItem('cva-entered');
  }

  buildGrid();

  const start = () => {
    if (!window.IntroGrid) {
      console.error('IntroGrid not loaded. Check vendor/three files and use http://localhost, not file://');
      return;
    }
    initEntrance();
  };

  if (window.__introReady && window.IntroGrid) start();
  else document.addEventListener('intro:ready', start, { once: true });
}

document.addEventListener('DOMContentLoaded', () => {
  setDate();

  if (document.body.dataset.page === 'detail') {
    initDetail();
  } else {
    bootIndex();
  }
});
