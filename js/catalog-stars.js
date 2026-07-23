/* Catalog · 星点背景（不依赖 Three.js，确保至少能看到闪烁网格） */
(function () {
  const STAR_SPACING = 56;
  const STAR_SIZE = 2;

  let canvas = null;
  let ctx = null;
  let stars = [];
  let size = { w: 0, h: 0 };
  let rafId = 0;
  let t0 = 0;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function viewport() {
    const r = canvas.getBoundingClientRect();
    return { w: Math.max(Math.round(r.width), 1), h: Math.max(Math.round(r.height), 1) };
  }

  function build() {
    const { w, h } = viewport();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = { w, h };
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stars = [];
    for (let y = STAR_SPACING * 0.5; y < h; y += STAR_SPACING) {
      for (let x = STAR_SPACING * 0.5; x < w; x += STAR_SPACING) {
        stars.push({
          x: Math.round(x - STAR_SIZE * 0.5),
          y: Math.round(y - STAR_SIZE * 0.5),
          phase: Math.random() * Math.PI * 2,
          speed: reduced ? 0 : 0.35 + Math.random() * 2.4,
          min: 0.04 + Math.random() * 0.12,
          max: 0.28 + Math.random() * 0.58,
        });
      }
    }
  }

  function draw(now) {
    if (!ctx) return;
    const t = (now - t0) * 0.001;
    ctx.clearRect(0, 0, size.w, size.h);
    for (const s of stars) {
      const wave = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * s.speed + s.phase);
      const a = s.min + (s.max - s.min) * wave;
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.fillRect(s.x, s.y, STAR_SIZE, STAR_SIZE);
    }
    rafId = requestAnimationFrame(draw);
  }

  function boot() {
    canvas = document.getElementById('catalog-stars');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    build();
    t0 = performance.now();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(draw);
    window.addEventListener('resize', build);
    canvas.dataset.ready = '1';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
