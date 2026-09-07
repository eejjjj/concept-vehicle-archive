/* Shared book constants · emax detail transition */

const BookShared = (() => {
  const COVER = 2.2;
  const SPINE_T = COVER * (296 / 3189);
  const ARCHIVE_COVER = 0.92;
  const ARCHIVE_SPINE_T = ARCHIVE_COVER * (296 / 3189);
  const DETAIL_ROT_X = 0.06;
  const DETAIL_ROT_Y = 0.18;
  const DETAIL_FOV = 32;
  const VIEW_MARGIN = 1.08;
  const TRANSITION_KEY = 'cva-book-transition';
  const LENTICULAR_INSET = 0.003;

  let lenticularUvPromise = null;

  function assetPath(path) {
    return (window.assetPath || ((p) => p))(path);
  }

  function maskBoundsFromImage(img, threshold = 128) {
    const w = img.width;
    const h = img.height;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, w, h);
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    let hit = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4] > threshold) {
          hit = true;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    if (!hit) return { u0: 0.25, v0: 0.25, u1: 0.75, v1: 0.75 };
    return {
      u0: minX / w,
      v0: 1 - maxY / h,
      u1: maxX / w,
      v1: 1 - minY / h,
    };
  }

  function insetRect(r, inset) {
    const dw = (r.u1 - r.u0) * inset;
    const dh = (r.v1 - r.v0) * inset;
    return { u0: r.u0 + dw, v0: r.v0 + dh, u1: r.u1 - dw, v1: r.v1 - dh };
  }

  function loadLenticularUvBounds() {
    if (lenticularUvPromise) return lenticularUvPromise;
    lenticularUvPromise = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(insetRect(maskBoundsFromImage(img), LENTICULAR_INSET));
      img.onerror = () => resolve({ u0: 0.34, v0: 0.34, u1: 0.66, v1: 0.66 });
      img.src = assetPath('assets/groove-mask.png');
    });
    return lenticularUvPromise;
  }

  function prefetchLenticularLayout() {
    loadLenticularUvBounds();
  }

  /** 估算 /emax/ 光栅片在屏幕上的位置（与 book-three 封面布局一致） */
  async function estimateLenticularScreenRect() {
    const uv = await loadLenticularUvBounds();
    const canvas = estimateEmaxCanvasRect();
    const bookFill = 0.9;
    const coverW = canvas.width * bookFill * Math.cos(DETAIL_ROT_Y * 0.92);
    const coverH = canvas.height * bookFill * Math.cos(DETAIL_ROT_X * 0.55);
    const uC = (uv.u0 + uv.u1) * 0.5;
    const vC = (uv.v0 + uv.v1) * 0.5;
    const lentW = (uv.u1 - uv.u0) * coverW;
    const lentH = (uv.v1 - uv.v0) * coverH;
    const coverCx = canvas.centerX + canvas.width * DETAIL_ROT_Y * 0.11;
    const coverCy = canvas.centerY + canvas.height * DETAIL_ROT_X * 0.07;
    const offsetX = (uC - 0.5) * coverW;
    const offsetY = (0.5 - vC) * coverH;
    const centerX = coverCx + offsetX;
    const centerY = coverCy + offsetY;
    return {
      left: centerX - lentW * 0.5,
      top: centerY - lentH * 0.5,
      width: lentW,
      height: lentH,
      centerX,
      centerY,
    };
  }

  function cssPx(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!v) return fallback;
    if (v.endsWith('px')) return parseFloat(v);
    return fallback;
  }

  /** Estimate #book-canvas screen rect on /emax/ (same rules as style.css). */
  function estimateEmaxCanvasRect() {
    const canvas = document.getElementById('book-canvas');
    if (canvas) {
      const r = canvas.getBoundingClientRect();
      if (r.width >= 40 && r.height >= 40) {
        return {
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height,
          centerX: r.left + r.width * 0.5,
          centerY: r.top + r.height * 0.5,
        };
      }
    }

    const margin = cssPx('--margin', 80);
    const headerTop = cssPx('--header-top', 40);
    const logoH = cssPx('--logo-h', 28);
    const bookStagePadTop = Math.max(24, window.innerHeight * 0.05);
    const bookStageTop = headerTop + logoH + 16 + bookStagePadTop;
    const size = Math.min(
      window.innerWidth - margin * 2 - 16,
      window.innerHeight - bookStageTop - 88,
      1020,
    );
    const left = (window.innerWidth - size) * 0.5;
    const top = bookStageTop;
    return {
      left,
      top,
      width: size,
      height: size,
      centerX: left + size * 0.5,
      centerY: top + size * 0.5,
    };
  }

  function setTransition(data) {
    try {
      sessionStorage.setItem(TRANSITION_KEY, JSON.stringify({ ...data, ts: Date.now() }));
    } catch {
      /* ignore */
    }
  }

  function consumeTransition() {
    try {
      const raw = sessionStorage.getItem(TRANSITION_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(TRANSITION_KEY);
      const data = JSON.parse(raw);
      if (Date.now() - (data.ts || 0) > 12000) return null;
      return data;
    } catch {
      return null;
    }
  }

  function spineAsset() {
    return window.assetPath('assets/spine.png');
  }

  return {
    COVER,
    SPINE_T,
    ARCHIVE_COVER,
    ARCHIVE_SPINE_T,
    DETAIL_ROT_X,
    DETAIL_ROT_Y,
    DETAIL_FOV,
    VIEW_MARGIN,
    TRANSITION_KEY,
    estimateEmaxCanvasRect,
    estimateLenticularScreenRect,
    prefetchLenticularLayout,
    setTransition,
    consumeTransition,
    spineAsset,
  };
})();

window.BookShared = BookShared;
