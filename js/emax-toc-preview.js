/* EMAX TOC · desktop: hover preview · mobile: tap accordion (≠ desktop) */

(() => {
  const PREVIEW_SIZE = 256;
  const MAX_BLOCK = 48;
  const REVEAL_MS = 780;
  const MOBILE_MQ = '(max-width: 900px)';
  const imageCache = new Map();
  let tmpCanvas = null;
  /** @type {null | (() => void)} */
  let closeActiveMobile = null;

  function isMobileToc() {
    return window.matchMedia(MOBILE_MQ).matches;
  }

  function isFineHover() {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  }

  function resolveSrc(row) {
    const src = row.dataset.tocSrc;
    if (src) {
      return typeof window.assetPath === 'function' ? window.assetPath(src) : `../${src}`;
    }
    const page1 = Number(row.dataset.tocPage);
    if (!page1) return null;
    const folder = page1 <= 80 ? 'emaxpages1' : 'emaxpages2';
    const path = `${folder}/260623_emax${page1}.jpg`;
    return typeof window.assetPath === 'function' ? window.assetPath(path) : `../${path}`;
  }

  function loadImage(key, url) {
    if (imageCache.has(key)) return imageCache.get(key);
    const p = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
    imageCache.set(key, p);
    return p;
  }

  function getTmp() {
    if (!tmpCanvas) tmpCanvas = document.createElement('canvas');
    return tmpCanvas;
  }

  /** Center-crop source to square, then draw pixelated into square canvas */
  function drawPixelSquare(ctx, img, size, blockSize) {
    const nw = img.naturalWidth || img.width;
    const nh = img.naturalHeight || img.height;
    const side = Math.min(nw, nh);
    const sx = (nw - side) / 2;
    const sy = (nh - side) / 2;

    const block = Math.max(1, blockSize);
    if (block <= 1.05) {
      ctx.imageSmoothingEnabled = true;
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      return;
    }

    const sw = Math.max(1, Math.ceil(size / block));
    const tmp = getTmp();
    if (tmp.width !== sw || tmp.height !== sw) {
      tmp.width = sw;
      tmp.height = sw;
    }
    const tctx = tmp.getContext('2d');
    tctx.imageSmoothingEnabled = true;
    tctx.clearRect(0, 0, sw, sw);
    tctx.drawImage(img, sx, sy, side, side, 0, 0, sw, sw);

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(tmp, 0, 0, sw, sw, 0, 0, size, size);
  }

  function bindRow(row) {
    const url = resolveSrc(row);
    if (!url) return;
    const cacheKey = row.dataset.tocSrc || `page:${row.dataset.tocPage}`;

    const trigger = row.querySelector('.emax-toc__entry');
    const canvas = row.querySelector('.emax-toc__preview-canvas');
    if (!trigger || !canvas) return;

    trigger.tabIndex = 0;
    trigger.setAttribute('role', 'button');
    const label = trigger.querySelector('.emax-toc__title')?.textContent?.trim();
    trigger.setAttribute(
      'aria-label',
      label ? `Show preview for ${label}` : 'Show chapter preview',
    );
    trigger.setAttribute('aria-expanded', 'false');

    const ctx = canvas.getContext('2d');
    let img = null;
    let raf = 0;
    let animating = false;
    let active = false;

    const paint = (block) => {
      if (!img) return;
      drawPixelSquare(ctx, img, PREVIEW_SIZE, block);
    };

    const ensureImage = async () => {
      if (img) return img;
      img = await loadImage(cacheKey, url);
      paint(MAX_BLOCK);
      return img;
    };

    const reveal = () => {
      if (!img || animating) return;
      animating = true;
      row.classList.remove('is-preview-clear');
      const start = performance.now();

      const step = (now) => {
        if (!active) {
          animating = false;
          return;
        }
        const t = Math.min(1, (now - start) / REVEAL_MS);
        const eased = 1 - (1 - t) ** 3;
        const block = MAX_BLOCK * (1 - eased) + 1 * eased;
        paint(block);
        if (t < 1) {
          raf = requestAnimationFrame(step);
        } else {
          paint(1);
          row.classList.add('is-preview-clear');
          animating = false;
        }
      };
      raf = requestAnimationFrame(step);
    };

    const resetPixel = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      animating = false;
      row.classList.remove('is-preview-clear');
      if (img) paint(MAX_BLOCK);
    };

    const open = async () => {
      if (active) return;
      active = true;
      row.classList.add('is-previewing');
      trigger.setAttribute('aria-expanded', 'true');
      row.querySelector('.emax-toc__preview')?.setAttribute('aria-hidden', 'false');
      if (isMobileToc()) closeActiveMobile = close;
      try {
        await ensureImage();
        if (!active) return;
        reveal();
      } catch (_) {
        /* missing asset — keep empty slot */
      }
    };

    const close = () => {
      if (!active) return;
      active = false;
      row.classList.remove('is-previewing');
      trigger.setAttribute('aria-expanded', 'false');
      row.querySelector('.emax-toc__preview')?.setAttribute('aria-hidden', 'true');
      resetPixel();
      if (closeActiveMobile === close) closeActiveMobile = null;
    };

    const flashInsideHint = () => {
      const btn = document.getElementById('emax-inside-btn');
      if (!btn) return;
      btn.classList.remove('is-hint-flash');
      void btn.offsetWidth;
      btn.classList.add('is-hint-flash');
    };

    /* Desktop: hover / focus only — unchanged */
    if (isFineHover()) {
      trigger.addEventListener('mouseenter', () => {
        if (isMobileToc()) return;
        open();
      });
      trigger.addEventListener('mouseleave', () => {
        if (isMobileToc()) return;
        close();
      });
      trigger.addEventListener('focus', () => {
        if (isMobileToc()) return;
        open();
      });
      trigger.addEventListener('blur', () => {
        if (isMobileToc()) return;
        if (!trigger.contains(document.activeElement)) close();
      });
    }

    /* Mobile: tap to toggle · one open at a time · tap outside closes
       Desktop: click chapter text flashes INSIDE (no TOC link) */
    trigger.addEventListener('click', (e) => {
      flashInsideHint();
      if (!isMobileToc()) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (active) {
        close();
        return;
      }
      if (closeActiveMobile && closeActiveMobile !== close) closeActiveMobile();
      open();
    });

    const insideBtn = document.getElementById('emax-inside-btn');
    if (insideBtn && !insideBtn.dataset.hintFlashBound) {
      insideBtn.dataset.hintFlashBound = '1';
      insideBtn.addEventListener('animationend', (ev) => {
        if (ev.animationName === 'emax-inside-hint') {
          insideBtn.classList.remove('is-hint-flash');
        }
      });
    }

    if (typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              loadImage(cacheKey, url).catch(() => {});
              io.disconnect();
            }
          });
        },
        { rootMargin: '120px' },
      );
      io.observe(row);
    }
  }

  function onDocPointerDown(e) {
    if (!isMobileToc() || !closeActiveMobile) return;
    const t = e.target;
    if (t?.closest?.('.emax-toc__row--preview')) return;
    closeActiveMobile();
  }

  function init() {
    document.querySelectorAll('.emax-toc__row--preview').forEach(bindRow);
    document.addEventListener('pointerdown', onDocPointerDown, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
