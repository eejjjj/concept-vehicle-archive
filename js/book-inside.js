/**
 * /emax/inside · standalone flat reader (no 3D hardcover handoff)
 */
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BookReader, HOLD_DELAY, HOLD_INTERVAL, isPortraitPanMode } from './book-reader.js?v=flip31';
import { spreadPages, SPREAD_COUNT } from './book-pages.js?v=p6';
import { BOOK_CHAPTERS, pageToSpread, spreadLeftPage, spreadRightPage } from './book-chapters.js';

function ap(path) {
  return window.assetPath(String(path).replace(/^\//, ''));
}

const HDR_URL =
  'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr';

function emaxUrl() {
  return ap('emax/');
}

const PORTRAIT_MQ = '(max-width: 900px) and (orientation: portrait)';

const BookInside = (() => {
  let canvas = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let reader = null;
  let rafId = 0;
  let active = false;
  let pmrem = null;
  let portraitMq = null;
  let panDrag = null;

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

  function syncTurnButtons(spreadIndex, spec) {
    const prev = document.getElementById('book-reader-prev');
    const next = document.getElementById('book-reader-next');
    const pages = spec || spreadPages(spreadIndex);
    if (prev) prev.disabled = spreadIndex <= 0 || pages?.left == null;
    if (next) next.disabled = spreadIndex >= SPREAD_COUNT - 1 || pages?.right == null;
  }

  function bindReaderTurn() {
    const prev = document.getElementById('book-reader-prev');
    const next = document.getElementById('book-reader-next');
    if (!prev || prev.dataset.bound) return;
    prev.dataset.bound = '1';
    bindHoldTurn(prev, 'back');
    bindHoldTurn(next, 'fwd');
  }

  let holdToken = 0;

  function stopHoldTurn() {
    holdToken += 1;
  }

  function bindHoldTurn(btn, dir) {
    if (!btn) return;
    let pointerId = null;
    let delayTimer = 0;
    let repeatTimer = 0;
    let fromPointer = false;
    let ignoreClickUntil = 0;

    const turn = () => {
      if (!reader || btn.disabled) return;
      if (dir === 'fwd') reader.next();
      else reader.prev();
    };

    const releaseCapture = () => {
      if (pointerId == null) return;
      try {
        btn.releasePointerCapture(pointerId);
      } catch (_) {}
      pointerId = null;
    };

    const stop = () => {
      if (delayTimer) {
        clearTimeout(delayTimer);
        delayTimer = 0;
      }
      if (repeatTimer) {
        clearInterval(repeatTimer);
        repeatTimer = 0;
      }
      holdToken += 1;
      releaseCapture();
    };

    const pump = () => {
      if (btn.disabled || !reader) {
        stop();
        return;
      }
      turn();
    };

    const startRepeat = () => {
      ignoreClickUntil = performance.now() + 600;
      pump();
      repeatTimer = window.setInterval(pump, HOLD_INTERVAL);
    };

    btn.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      if (btn.disabled) return;
      stop();
      fromPointer = true;
      pointerId = e.pointerId;
      btn.setPointerCapture?.(e.pointerId);
      turn();
      delayTimer = window.setTimeout(() => {
        delayTimer = 0;
        startRepeat();
      }, HOLD_DELAY);
    });

    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('lostpointercapture', stop);

    btn.addEventListener('click', (e) => {
      if (fromPointer || performance.now() < ignoreClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        fromPointer = false;
        return;
      }
      turn();
    });

    btn.addEventListener('contextmenu', (e) => e.preventDefault());
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

    /* iOS <a> ignores :active — press class so 3D Book flashes purple. */
    if (back && !back.dataset.pressBound) {
      back.dataset.pressBound = '1';
      const pressOn = (e) => {
        if (e.pointerType === 'mouse' && e.button != null && e.button !== 0) return;
        back.classList.add('is-pressed');
      };
      const pressOff = () => back.classList.remove('is-pressed');
      back.addEventListener('pointerdown', pressOn);
      back.addEventListener('pointerup', pressOff);
      back.addEventListener('pointercancel', pressOff);
      back.addEventListener('pointerleave', pressOff);
    }

    back?.addEventListener('click', (e) => {
      e.preventDefault();
      back?.classList.remove('is-pressed');
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
    syncPortraitPanMode();
  }

  function syncPortraitPanMode() {
    const pan = window.matchMedia(PORTRAIT_MQ).matches;
    document.body.classList.toggle('is-reader-portrait-pan', pan);
    const hint = document.getElementById('reader-rotate-hint');
    if (hint) hint.hidden = !pan;
    if (!pan) {
      const pane = readerPane();
      if (pane) pane.scrollLeft = 0;
      panDrag = null;
    }
  }

  function readerPane() {
    return document.getElementById('book-reader-pane')
      || document.querySelector('.book-reader-pane')
      || document.querySelector('.emax-book-stage .detail-visual--book');
  }

  function onPanPointerDown(e) {
    if (!isPortraitPanMode()) return;
    if (e.isPrimary === false) return;
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest?.('.book-reader-turn, .book-reader-bar, a, button')) return;
    const pane = readerPane();
    if (!pane) return;
    panDrag = {
      id: e.pointerId,
      x: e.clientX,
      sl: pane.scrollLeft,
    };
    pane.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  function onPanPointerMove(e) {
    if (!panDrag || e.pointerId !== panDrag.id) return;
    const pane = readerPane();
    if (!pane) return;
    pane.scrollLeft = panDrag.sl + (e.clientX - panDrag.x);
    e.preventDefault();
  }

  function onPanPointerUp(e) {
    if (!panDrag || e.pointerId !== panDrag.id) return;
    const pane = readerPane();
    pane?.releasePointerCapture?.(e.pointerId);
    panDrag = null;
  }

  function getDisplaySize() {
    if (!canvas) return { w: 1, h: 1 };
    const mobileRotated =
      window.matchMedia('(max-width: 900px)').matches &&
      window.matchMedia('(orientation: portrait)').matches &&
      !isPortraitPanMode() &&
      !document.body.classList.contains('is-book-pre-rotate') &&
      document.body.classList.contains('is-book-reading');
    if (mobileRotated) {
      return {
        w: Math.max(1, canvas.clientWidth),
        h: Math.max(1, canvas.clientHeight),
      };
    }
    const r = canvas.getBoundingClientRect();
    if (isPortraitPanMode()) {
      return {
        w: Math.max(1, canvas.clientWidth || r.width),
        h: Math.max(1, canvas.clientHeight || r.height),
      };
    }
    return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
  }

  function onOrientationChange() {
    syncPortraitPanMode();
    requestAnimationFrame(() => onResize());
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
      renderer.toneMappingExposure = 1.0;
      renderer.setClearColor(0x000000, 1);

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(34, 1, 0.05, 40);
      camera.position.set(0, 0.015, 3);

      pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      let envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = envMap;
      await new Promise((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const timer = setTimeout(done, 2800);
        new RGBELoader().load(
          HDR_URL,
          (hdr) => {
            clearTimeout(timer);
            envMap = pmrem.fromEquirectangular(hdr).texture;
            scene.environment = envMap;
            hdr.dispose();
            done();
          },
          undefined,
          () => {
            clearTimeout(timer);
            done();
          },
        );
      });

      const coverTex = await loadCoverTex();
      reader = new BookReader({
        scene,
        camera,
        renderer,
        canvas,
        envMap,
        coverTex,
        onSpreadChange: (spreadIndex, spec) => {
          updateReaderHud(spreadIndex, spec);
          syncReaderNav(spreadIndex);
          syncTurnButtons(spreadIndex, spec);
        },
      });

      await reader.init();
      await reader.enterOpen(0);
      bindReaderNav();
      bindReaderTurn();
      updateReaderHud(0, spreadPages(0));
      syncReaderNav(0);
      syncTurnButtons(0, spreadPages(0));
      reader.bindControls();

      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => requestAnimationFrame(() => onResize()));
        ro.observe(canvas);
        const pane = canvas.closest('.book-reader-pane') || canvas.parentElement;
        if (pane) ro.observe(pane);
        canvas.__insideRO = ro;
      }
      window.addEventListener('resize', onResize);
      window.addEventListener('orientationchange', onOrientationChange);
      const pane = canvas.closest('.book-reader-pane') || canvas.parentElement;
      pane?.addEventListener('pointerdown', onPanPointerDown);
      window.addEventListener('pointermove', onPanPointerMove);
      window.addEventListener('pointerup', onPanPointerUp);
      window.addEventListener('pointercancel', onPanPointerUp);
      if (!portraitMq) {
        portraitMq = window.matchMedia(PORTRAIT_MQ);
        const onMq = () => onOrientationChange();
        if (typeof portraitMq.addEventListener === 'function') {
          portraitMq.addEventListener('change', onMq);
        } else {
          portraitMq.addListener(onMq);
        }
        canvas.__portraitMqHandler = onMq;
      }

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
    window.removeEventListener('orientationchange', onOrientationChange);
    window.removeEventListener('pointermove', onPanPointerMove);
    window.removeEventListener('pointerup', onPanPointerUp);
    window.removeEventListener('pointercancel', onPanPointerUp);
    canvas?.closest('.book-reader-pane')?.removeEventListener('pointerdown', onPanPointerDown);
    canvas?.parentElement?.removeEventListener('pointerdown', onPanPointerDown);
    panDrag = null;
    if (portraitMq && canvas?.__portraitMqHandler) {
      const onMq = canvas.__portraitMqHandler;
      if (typeof portraitMq.removeEventListener === 'function') {
        portraitMq.removeEventListener('change', onMq);
      } else {
        portraitMq.removeListener(onMq);
      }
      canvas.__portraitMqHandler = null;
    }
    portraitMq = null;
    document.body.classList.remove('is-reader-portrait-pan');
    canvas?.__insideRO?.disconnect();
    stopHoldTurn();
    reader?.dispose();
    reader = null;
    pmrem?.dispose();
    pmrem = null;
    renderer?.dispose();
    scene = null;
    camera = null;
    canvas = null;
  }

  return { init, destroy };
})();

window.BookInside = BookInside;
document.dispatchEvent(new CustomEvent('book-inside:ready'));
