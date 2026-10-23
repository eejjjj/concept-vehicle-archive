/* Base path · local root vs GitHub Pages project site */
(function () {
  function detectBase() {
    if (location.protocol === 'file:') return './';
    if (location.hostname.endsWith('github.io')) {
      const seg = location.pathname.split('/').filter(Boolean)[0];
      if (seg) return `/${seg}/`;
    }
    return '/';
  }

  const BASE = detectBase();

  window.__BASE__ = BASE;
  window.assetPath = function assetPath(path) {
    return BASE + String(path).replace(/^\//, '');
  };

  /* Pro Max landscape is ~932–980 CSS px wide, so max-width:900 misses it.
   * Catch phones by short-edge height (≤600) + width ≤1100; iPad Mini landscape is ~744 tall. */
  window.CVA_MQ = {
    phone: '(max-width: 900px), (pointer: coarse) and (hover: none) and (max-height: 600px), (max-width: 1100px) and (max-height: 600px) and (orientation: landscape)',
    phoneLandscape: '(max-width: 900px) and (orientation: landscape), (pointer: coarse) and (hover: none) and (orientation: landscape) and (max-height: 600px), (max-width: 1100px) and (max-height: 600px) and (orientation: landscape)',
    phonePortrait: '(max-width: 900px) and (orientation: portrait)',
  };

  function injectImportMap() {
    if (document.querySelector('script[data-importmap-auto]')) return;
    const el = document.createElement('script');
    el.type = 'importmap';
    el.setAttribute('data-importmap-auto', '');
    el.textContent = JSON.stringify({
      imports: {
        three: assetPath('vendor/three/build/three.module.js'),
        'three/addons/': assetPath('vendor/three/examples/jsm/'),
      },
    });
    document.head.appendChild(el);
  }

  function injectFavicon() {
    if (document.querySelector('link[rel="icon"]')) return;
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    link.href = assetPath('assets/favicon_reverse.svg');
    document.head.appendChild(link);
  }

  injectImportMap();
  injectFavicon();

  var UNLOCK_KEY = 'cva:archive-unlock';
  var unlocked = false;
  try {
    unlocked = sessionStorage.getItem(UNLOCK_KEY) === '1';
  } catch (e) {}
  if (unlocked) document.documentElement.classList.remove('is-locked');
  else document.documentElement.classList.add('is-locked');

  /* Refresh / revisit always starts at the top — browsers otherwise restore scroll. */
  try {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  } catch (e) {}

  function resetScroll() {
    window.scrollTo(0, 0);
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
  }

  resetScroll();
  window.addEventListener('DOMContentLoaded', resetScroll);
  window.addEventListener('load', resetScroll);
  window.addEventListener('pageshow', function () {
    resetScroll();
    requestAnimationFrame(resetScroll);
  });
})();
