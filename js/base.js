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

  injectImportMap();
})();
