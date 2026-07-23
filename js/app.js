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

const INTRO_HOME = '/index/';
const CATALOG_HOME = '/catalog/';
const STATUS_HOME = '/status/';
const ACCESS_HOME = '/access/';

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

function initLogoHome() {
  document.querySelectorAll('.site-logo').forEach((logo) => {
    logo.setAttribute('href', INTRO_HOME);
    logo.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(INTRO_HOME);
    });
  });
}

function initSiteNav() {
  document.querySelectorAll('.site-nav a[href^="/"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      if (link.classList.contains('is-active')) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      navigate(link.getAttribute('href'));
    });
  });
}

function bootArchivePage() {
  Motion.revealChrome();
  Motion.bootPageEnter();
}

function revealDetailBody() {
  requestAnimationFrame(() => {
    const body = document.getElementById('detail-body');
    if (body) body.classList.add('is-visible');
    const visual = document.getElementById('detail-visual');
    if (visual) requestAnimationFrame(() => visual.classList.add('is-loaded'));
  });
}

/* ── Entrance · /index/ 一级入口 ─────────────────────────────── */
function initEntrance() {
  const entrance = document.getElementById('entrance');
  const introLabel = document.getElementById('site-intro-label');
  if (!entrance) return;

  function goCatalog(e) {
    if (e) e.preventDefault();
    IntroGrid.destroy();
    navigate(CATALOG_HOME);
  }

  entrance.addEventListener('click', goCatalog);
  if (introLabel) introLabel.addEventListener('click', goCatalog);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (window.IntroGrid) IntroGrid.init('intro-canvas');
    });
  });
}

function bootIntro() {
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

function revealModules() {
  document.querySelectorAll('.module').forEach((mod, i) => {
    mod.style.transitionDelay = `${140 + i * 88}ms`;
    requestAnimationFrame(() => mod.classList.add('is-revealed'));
  });
}

/* ── Module Grid · /catalog/ 二级目录页 ─────────────────────── */
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
      mod.addEventListener('click', () => navigate(vehicleUrl(v)));
      mod.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate(vehicleUrl(v));
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

function bootCatalog() {
  document.body.classList.add('is-chrome-in', 'is-page-enter-active');
  Motion.revealChrome();

  const showError = (msg) => {
    const host = document.getElementById('catalog-space');
    if (!host || host.querySelector('.catalog-space__error')) return;
    const tip = document.createElement('p');
    tip.className = 'catalog-space__error';
    tip.textContent = msg;
    host.appendChild(tip);
  };

  const start = async () => {
    try {
      if (!window.CatalogSpace) {
        await new Promise((resolve, reject) => {
          if (window.__catalogReady && window.CatalogSpace) {
            resolve();
            return;
          }
          const timer = setTimeout(() => reject(new Error('Catalog module timeout')), 8000);
          document.addEventListener('catalog:ready', () => {
            clearTimeout(timer);
            resolve();
          }, { once: true });
        });
      }
      if (!window.CatalogSpace) {
        throw new Error('CatalogSpace module did not load');
      }
      const ok = await CatalogSpace.init('catalog-canvas');
      if (!ok) throw new Error('CatalogSpace.init failed');
    } catch (err) {
      console.error('[bootCatalog]', err);
      showError(
        '3D catalog failed to load. Use http://localhost:8765/catalog/ (not file://). '
        + 'Check browser console for details.',
      );
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  setTimeout(() => {
    const host = document.getElementById('catalog-space');
    if (host && !host.classList.contains('is-ready')) {
      showError(
        'Catalog is still loading or failed. Confirm preview server is running, '
        + 'then open http://localhost:8765/catalog/ and hard-refresh (Cmd+Shift+R).',
      );
    }
  }, 4000);
}

/* ── Vehicle Detail · /001/ /002/ ────────────────────────────── */
function initDetail() {
  const slug = document.body.dataset.slug;
  const v = getVehicleBySlug(slug);

  if (!v || !v.available) {
    navigate(CATALOG_HOME);
    return;
  }

  document.title = `${v.name} — Concept Vehicle Archive`;

  document.getElementById('detail-index').textContent = `${pad(v.id)} / 09`;
  document.getElementById('detail-title').textContent = v.name;
  document.getElementById('detail-year').textContent = `Concept ${v.year}`;
  document.getElementById('detail-tagline').textContent = v.tagline;
  document.getElementById('detail-desc').textContent = v.description;

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

  bootArchivePage();
  revealDetailBody();

  function bootBookViewer() {
    const run = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!window.BookViewer) return;
          BookViewer.init('book-canvas');
        });
      });
    };
    if (window.BookViewer) run();
    else document.addEventListener('book:ready', run, { once: true });
  }

  if (slug === '001') {
    bootBookViewer();
    return;
  }

  const visual = document.getElementById('detail-visual');
  if (!visual) return;
  visual.innerHTML = SILHOUETTES[v.id - 1];
  requestAnimationFrame(() => visual.classList.add('is-loaded'));
}

/* ── Status / Access · /status/ /access/ ───────────────────── */
function initSectionPage() {
  bootArchivePage();
  revealDetailBody();
}

/* ── Boot ────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  setDate();
  initLogoHome();
  initSiteNav();

  const page = document.body.dataset.page;
  if (page === 'detail') initDetail();
  else if (page === 'status' || page === 'access') initSectionPage();
  else if (page === 'catalog') bootCatalog();
  else bootIntro();
});
