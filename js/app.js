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

function sitePath(path) {
  return window.assetPath(String(path).replace(/^\//, ''));
}

function introHome() { return window.__BASE__ || '/'; }
function emaxHome() { return sitePath('emax/'); }
function nextHome() { return sitePath('next/'); }
function accessHome() { return sitePath('access/'); }

/** Header 导航中不可点击的项（页面仍可通过直接 URL 访问） */
const DISABLED_NAV_IDS = new Set(['nav-next', 'nav-access']);

function disableNavLinks() {
  DISABLED_NAV_IDS.forEach((id) => {
    const link = document.getElementById(id);
    if (!link) return;
    link.setAttribute('aria-disabled', 'true');
    link.setAttribute('tabindex', '-1');
    link.removeAttribute('href');
    link.addEventListener('click', (e) => e.preventDefault());
  });
}

/* ── Utils ───────────────────────────────────────────────────── */
function pad(n) {
  return String(n).padStart(2, '0');
}

function navigate(url, ms = 320) {
  Motion.pageExit(url, ms);
}

function setDate() {
  /* reserved */
}

function initLogoHome() {
  document.querySelectorAll('.site-logo').forEach((logo) => {
    logo.setAttribute('href', introHome());
    logo.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(introHome());
    });
  });
}

function initIntroLabel() {
  document.querySelectorAll('.site-intro-label').forEach((label) => {
    label.setAttribute('href', introHome());
    label.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.IntroGrid) IntroGrid.destroy();
      navigate(introHome());
    });
  });
}

function initSiteNav() {
  disableNavLinks();
  document.querySelectorAll('.site-nav a[href]').forEach((link) => {
    if (link.getAttribute('aria-disabled') === 'true') return;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(link.getAttribute('href'), 0);
    });
  });
  if (window.ArchiveEffects) {
    ArchiveEffects.init(document.querySelector('.site-nav') || document);
  }
}

function bootPageChrome(instant = false) {
  Motion.revealChrome();
  Motion.bootPageEnter(instant);
}

function revealDetailBody() {
  requestAnimationFrame(() => {
    const body = document.getElementById('detail-body');
    if (body) body.classList.add('is-visible');
    const visual = document.getElementById('detail-visual');
    if (visual) requestAnimationFrame(() => visual.classList.add('is-loaded'));
  });
}

/* ── Entrance · / 一级入口 ───────────────────────────────────── */
function initEntrance() {
  const entrance = document.getElementById('entrance');
  if (!entrance) return;

  entrance.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

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

/* ── Vehicle Detail · /emax/ /next/ ────────────────────────────── */
function findVehicle(slug) {
  if (typeof getVehicleBySlug === 'function') {
    const v = getVehicleBySlug(slug);
    if (v) return v;
  }
  if (typeof VEHICLES === 'undefined') return null;
  const aliases = { '001': 'emax', '002': 'next' };
  const key = aliases[slug] || slug;
  return VEHICLES.find((item) => (aliases[item.slug] || item.slug) === key);
}

function initArchiveEffects() {
  if (window.ArchiveEffects) ArchiveEffects.init(document);
}

  function resetPageChrome() {
    document.body.classList.remove('is-book-reading', 'is-book-opening', 'is-book-pre-rotate');
    const bar = document.getElementById('book-reader-bar');
    if (bar) bar.hidden = true;
    const transition = document.getElementById('transition');
    if (transition) transition.classList.remove('is-active');
    document.body.classList.add('is-page-enter-active');
  }

  function initDetail() {
    resetPageChrome();
    const slug = document.body.dataset.slug;
  const v = findVehicle(slug);

  if (!v || !v.available) {
    navigate(introHome());
    return;
  }

  document.title = `${v.name} — Concept Vehicle Archive`;

  const fromHomeIntro =
    slug === 'emax' &&
    window.EmaxIntroVideo &&
    EmaxIntroVideo.consumeEntryFlag();

  function bootBookViewer() {
    const canvas = document.getElementById('book-canvas');
    const start = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!window.BookViewer) return;
            BookViewer.init('book-canvas');
          });
        });
      });
    };
    const fail = () => {
      if (!canvas || window.BookViewer) return;
      canvas.classList.add('is-error', 'is-loaded');
      const tip = document.createElement('p');
      tip.className = 'detail-visual__fallback';
      tip.textContent = '3D book module failed to load. Hard-refresh or run: bash preview.sh';
      canvas.parentElement?.appendChild(tip);
    };
    if (window.BookViewer) start();
    else {
      document.addEventListener('book:ready', start, { once: true });
      setTimeout(fail, 10000);
    }
  }

  const skipIntroVideo = window.matchMedia('(max-width: 900px)').matches;

  if (fromHomeIntro && !skipIntroVideo) {
    /* Desktop: keep black cover; play intro, then reveal EMAX */
    document.body.classList.add('is-emax-intro', 'is-page-enter', 'is-page-enter-active');
    const transition = document.getElementById('transition');
    if (transition) transition.classList.remove('is-active');
    revealDetailBody();
    initArchiveEffects();
    if (v.id === 1) bootBookViewer();

    EmaxIntroVideo.play().finally(() => {
      document.body.classList.remove('is-emax-intro');
      Motion.revealChrome();
      Motion.bootPageEnter(true);
      /* After shell is unhidden — mobile needs a frame for WebGL size/paint */
      requestAnimationFrame(() => {
        if (window.BookViewer?.startEntranceReveal) {
          BookViewer.startEntranceReveal();
        }
      });
    });
  } else {
    /* Mobile / no-intro: chrome on immediately; BookViewer reveals itself */
    bootPageChrome(false);
    revealDetailBody();
    initArchiveEffects();
    if (v.id === 1) bootBookViewer();
  }
}

/* ── Access · /access/ ──────────────────────────────────────── */
function initSectionPage() {
  bootPageChrome();
  revealDetailBody();
  initArchiveEffects();
}

/* ── Boot ────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  setDate();
  initLogoHome();
  initIntroLabel();
  initSiteNav();

  const page = document.body.dataset.page;
  if (page === 'detail') initDetail();
  else if (page === 'access') initSectionPage();
  else bootIntro();
});
