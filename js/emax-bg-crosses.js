/* EMAX · background cross grid · spacing synced with intro wind flaps */

const EmaxCrossField = (() => {
  /** 与 intro-three-front.js 风动片网格一致 */
  const GAP_PX = 4;
  const CELL_PX = 96;
  const CORE_SIZE = 9;
  const FILL_MARGIN = 1.04;

  const ARM = 2.5;
  const PEAK_OPACITY = 0.36;
  const MIN_PERIOD = 3.2;
  const MAX_PERIOD = 5.8;

  let canvas = null;
  let ctx = null;
  let crosses = [];
  let spacing = 96;
  let rafId = 0;
  let active = false;

  function ensureSymmetric(count, core) {
    let n = Math.max(core, count);
    if ((n - core) % 2 !== 0) n += 1;
    return n;
  }

  /** 风动片中心间距（px），与首页 computeGridTopology 一致 */
  function flapPitchPx(viewportW) {
    const gapFactor = GAP_PX / CELL_PX;
    const colCount = ensureSymmetric(Math.ceil(viewportW / CELL_PX), CORE_SIZE);
    const cell = (viewportW / (colCount + (colCount - 1) * gapFactor)) * FILL_MARGIN;
    return cell + cell * gapFactor;
  }

  function crossState(t, period, phase) {
    const p = (((t + phase) % period) + period) % period / period;
    if (p < 0.36) {
      const edge = 0.07;
      const fade = p < edge ? p / edge : p > 0.29 ? (0.36 - p) / edge : 1;
      return { opacity: Math.max(0, fade) * PEAK_OPACITY, rot: 0 };
    }
    if (p < 0.5) return { opacity: 0, rot: 0 };
    if (p < 0.86) {
      const local = (p - 0.5) / 0.36;
      const edge = 0.1;
      const fade = local < edge ? local / edge : local > 0.82 ? (1 - local) / edge : 1;
      return { opacity: Math.max(0, fade) * PEAK_OPACITY, rot: Math.PI / 4 };
    }
    return { opacity: 0, rot: 0 };
  }

  function drawCross(x, y, rot, opacity) {
    if (opacity <= 0.001) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const ink = document.body.classList.contains('is-model-day') ? '0, 0, 0' : '190, 190, 190';
    ctx.strokeStyle = `rgba(${ink}, ${opacity})`;
    ctx.lineWidth = 0.5;
    ctx.lineCap = 'square';
    ctx.beginPath();
    ctx.moveTo(-ARM, 0);
    ctx.lineTo(ARM, 0);
    ctx.moveTo(0, -ARM);
    ctx.lineTo(0, ARM);
    ctx.stroke();
    ctx.restore();
  }

  function buildCrosses(w, h) {
    crosses = [];
    spacing = flapPitchPx(w);
    const ox = (spacing - (w % spacing)) * 0.5;
    const oy = (spacing - (h % spacing)) * 0.5;
    for (let y = oy; y < h; y += spacing) {
      for (let x = ox; x < w; x += spacing) {
        crosses.push({
          x,
          y,
          phase: Math.random() * MAX_PERIOD,
          period: MIN_PERIOD + Math.random() * (MAX_PERIOD - MIN_PERIOD),
        });
      }
    }
  }

  function resize() {
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildCrosses(w, h);
  }

  function frame(now) {
    if (!active || !ctx) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);
    for (const c of crosses) {
      const { opacity, rot } = crossState(now * 0.001, c.period, c.phase);
      drawCross(c.x, c.y, rot, opacity);
    }
    rafId = requestAnimationFrame(frame);
  }

  function destroy() {
    active = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    canvas?.remove();
    canvas = null;
    ctx = null;
    crosses = [];
  }

  function init() {
    if (active || document.body.dataset.slug !== 'emax') return;
    canvas = document.createElement('canvas');
    canvas.className = 'emax-cross-field';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);
    ctx = canvas.getContext('2d');
    active = true;
    resize();
    window.addEventListener('resize', resize);
    rafId = requestAnimationFrame(frame);
  }

  return { init, destroy };
})();

if (document.body.dataset.slug === 'emax') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => EmaxCrossField.init(), { once: true });
  } else {
    EmaxCrossField.init();
  }
}
