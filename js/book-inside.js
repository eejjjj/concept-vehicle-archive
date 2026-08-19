/**
 * /emax/inside · standalone flat reader (no 3D hardcover handoff)
 */
import * as THREE from 'three';
import { BookReader } from './book-reader.js?v=flip07';
import { spreadPages } from './book-pages.js?v=p3';
import { BOOK_CHAPTERS, pageToSpread, spreadLeftPage, spreadRightPage } from './book-chapters.js';

function ap(path) {
  return window.assetPath(String(path).replace(/^\//, ''));
}

function emaxUrl() {
  return ap('emax/');
}

const BookInside = (() => {
  let canvas = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let reader = null;
  let rafId = 0;
  let active = false;

  function updateReaderHud(spreadIndex, spec) {
    const hud = document.getElementById('book-reader-hud');
    if (!hud) return;
    /* Prefer live spreadPages spec: null = endpaper lining (no page number) */
    const left =
      spec && 'left' in spec
        ? spec.left != null
          ? spec.left + 1
          : null
        : spreadLeftPage(spreadIndex);
    const right =
      spec && 'right' in spec
        ? spec.right != null
          ? spec.right + 1
          : null
        : spreadRightPage(spreadIndex);
    const label =
      left != null && right != null
        ? `${String(left).padStart(3, '0')} – ${String(right).padStart(3, '0')}`
        : right != null
          ? String(right).padStart(3, '0')
          : String(left ?? 160).padStart(3, '0');
    hud.textContent = label;
    hud.hidden = false;
  }

  function syncReaderNav(spreadIndex) {
    const nav = document.getElementById('book-reader-nav');
    if (!nav) return;
    let activeId = BOOK_CHAPTERS[0].id;
    for (const ch of BOOK_CHAPTERS) {
      if (pageToSpread(ch.page) <= spreadIndex) activeId = ch.id;
    }
    nav.querySelectorAll('.book-reader-bar__chapter').forEach((el) => {
      el.classList.toggle('is-active', el.dataset.chapter === activeId);
    });
  }

  function bindReaderNav() {
    const nav = document.getElementById('book-reader-nav');
    const back = document.getElementById('book-reader-back');
    if (!nav || nav.dataset.bound) return;
    nav.dataset.bound = '1';

    BOOK_CHAPTERS.forEach((ch) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'book-reader-bar__chapter';
      btn.dataset.chapter = ch.id;
      btn.innerHTML = `<span class="book-reader-bar__code">${ch.label}</span><span class="book-reader-bar__name">${ch.title}</span>`;
      btn.addEventListener('click', () => {
        if (!reader) return;
        reader.goToSpread(pageToSpread(ch.page));
        nav.querySelectorAll('.book-reader-bar__chapter').forEach((el) => {
          el.classList.toggle('is-active', el.dataset.chapter === ch.id);
        });
      });
      nav.appendChild(btn);
    });

    back?.addEventListener('click', (e) => {
      e.preventDefault();
      const url = emaxUrl();
      if (window.Motion?.pageExit) Motion.pageExit(url, 0);
      else location.assign(url);
    });
  }

  function setReadingChrome() {
    document.body.classList.add('is-book-reading');
    const bar = document.getElementById('book-reader-bar');
    if (bar) bar.hidden = false;
    canvas?.classList.add('is-reading');
    if (window.matchMedia('(max-width: 900px)').matches) {
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    }
  }

  function getDisplaySize() {
    if (!canvas) return { w: 1, h: 1 };
    const mobileRotated =
      window.matchMedia('(max-width: 900px)').matches &&
      !document.body.classList.contains('is-book-pre-rotate') &&
      document.body.classList.contains('is-book-reading');
    if (mobileRotated) {
      return {
        w: Math.max(1, canvas.clientWidth),
        h: Math.max(1, canvas.clientHeight),
      };
    }
    const r = canvas.getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
  }

  function onResize() {
    if (!renderer || !camera || !canvas) return;
    const { w, h } = getDisplaySize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    reader?.resize();
  }

  function animate() {
    if (!active) return;
    rafId = requestAnimationFrame(animate);
    reader?.tick();
    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  function loadCoverTex() {
    return new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(
        ap('assets/cover.png'),
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          resolve(tex);
        },
        undefined,
        reject,
      );
    });
  }

  async function init(canvasId = 'book-canvas') {
    if (active) return true;
    canvas = document.getElementById(canvasId);
    if (!canvas) return false;

    active = true;
    setReadingChrome();

    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      renderer.setClearColor(0x000000, 1);

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(34, 1, 0.05, 40);
      camera.position.set(0, 0.015, 3);

      const coverTex = await loadCoverTex();
      reader = new BookReader({
        scene,
        camera,
        renderer,
        canvas,
        coverTex,
        onSpreadChange: (spreadIndex, spec) => {
          updateReaderHud(spreadIndex, spec);
          syncReaderNav(spreadIndex);
        },
      });

      await reader.init();
      await reader.enterOpen(0);
      bindReaderNav();
      updateReaderHud(0, spreadPages(0));
      syncReaderNav(0);
      reader.bindControls();

      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => requestAnimationFrame(() => onResize()));
        ro.observe(canvas);
        if (canvas.parentElement) ro.observe(canvas.parentElement);
        canvas.__insideRO = ro;
      }
      window.addEventListener('resize', onResize);

      onResize();
      /* One painted frame with pages before revealing — avoids empty edge-frame flash */
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      animate();
      canvas.classList.add('is-loaded', 'is-reading');
      document.body.classList.add('is-reader-ready');
      return true;
    } catch (err) {
      console.error('[BookInside] init failed', err);
      destroy();
      canvas?.classList.add('is-error', 'is-loaded');
      return false;
    }
  }

  function destroy() {
    active = false;
    cancelAnimationFrame(rafId);
    window.removeEventListener('resize', onResize);
    canvas?.__insideRO?.disconnect();
    reader?.dispose();
    reader = null;
    renderer?.dispose();
    scene = null;
    camera = null;
    canvas = null;
  }

  return { init, destroy };
})();

window.BookInside = BookInside;
document.dispatchEvent(new CustomEvent('book-inside:ready'));
