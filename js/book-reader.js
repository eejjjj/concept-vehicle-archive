/**
 * EMAX · 平铺阅读器
 * 锁线装订中缝 · 切口揭页（FlippingBook / iBooks 折痕）· 硫酸纸叠层 · 160p spread
 * book_spread.glb 只做打开书壳背景，不参与命中。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SPREAD_COUNT, spreadPages } from './book-pages.js?v=p13';
import * as emaxPages from './book-pages.js?v=p13';
import * as nextPages from './next-pages.js?v=n7';

/** Set by BookReader when a volume has no printed pages yet. */
let plainPaper = false;
/** EMAX catalog, or NEXT when that volume is open. */
let catalog = emaxPages;
const BLANK_PAGE_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP48ukNAAWwAtPacHMoAAAAAElFTkSuQmCC';

function pageUrl(index) {
  if (!plainPaper) return catalog.pageUrl(index);
  if (index < 0 || index > 159) return null;
  return BLANK_PAGE_URL;
}

function liningUrl() {
  return plainPaper ? BLANK_PAGE_URL : catalog.liningUrl();
}

function isVellumPage(page1) {
  return plainPaper ? false : catalog.isVellumPage(page1);
}

function isSilverPage(page1) {
  return plainPaper ? false : catalog.isSilverPage(page1);
}

function isSilverDecalPage(page1) {
  return plainPaper ? false : catalog.isSilverDecalPage(page1);
}

function vellumStackFrom(page1) {
  return plainPaper ? null : catalog.vellumStackFrom(page1);
}

function vellumLeftStackFrom(page1) {
  return plainPaper ? null : catalog.vellumLeftStackFrom(page1);
}

/** 1 = full sheet. NEXT short pages (025–038) are narrower. */
function pageWidthRatio(page1) {
  if (plainPaper || page1 == null || typeof catalog.pageWidthRatio !== 'function') return 1;
  const r = catalog.pageWidthRatio(page1);
  return r > 0 && r <= 1 ? r : 1;
}

function shortStackFrom(page1) {
  if (plainPaper || typeof catalog.shortStackFrom !== 'function') return null;
  return catalog.shortStackFrom(page1);
}

function shortStackLeftFrom(page1) {
  if (plainPaper || typeof catalog.shortStackLeftFrom !== 'function') return null;
  return catalog.shortStackLeftFrom(page1);
}

/** Soft fore-edge shadow. Dark at u=0, gone by u=1. */
let SHORT_SHADOW_MAT = null;
let SHORT_SHADOW_GEO = null;
function shortShadowMaterial() {
  if (SHORT_SHADOW_MAT) return SHORT_SHADOW_MAT;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 8;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, c.width, 0);
  grad.addColorStop(0, 'rgba(36,36,38,0.16)');
  grad.addColorStop(0.22, 'rgba(36,36,38,0.07)');
  grad.addColorStop(0.55, 'rgba(36,36,38,0.025)');
  grad.addColorStop(1, 'rgba(36,36,38,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  SHORT_SHADOW_MAT = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  SHORT_SHADOW_GEO = new THREE.PlaneGeometry(1, PAGE_H);
  return SHORT_SHADOW_MAT;
}

const PAGE_W = 1.05;
const PAGE_H = 1.05;
const GUTTER = 0.0008;
/** Match static sheet z so a held page does not perspective-scale at the gutter */
const FLIP_Z = 0.00068;
/**
 * Valley overlay sits in front of the stay sheet (FLIP_Z) so the spine does not
 * blink off when a turn starts, and behind stitches (0.001) / flap (FLIP_Z+0.0014)
 * so it does not stripe the peeling corner.
 */
const GUTTER_SHADE_Z = FLIP_Z + 0.00018;
const FLIP_ORDER = 12;
/** Vellum piles sit behind the held sheet and the gutter overlay */
const STACK_Z0 = 0.00012;
const STACK_DZ = 0.00007;

function sheetStackZ(fromBottom) {
  return STACK_Z0 + fromBottom * STACK_DZ;
}
const FLIP_MS = 16.7;
/** Full-page scripted turn (keyboard / tap / hold-release at 0%). */
const TURN_MS = 180;
/** Tiny remaining peels still need a beat so they do not pop. */
const TURN_MIN_MS = 70;

function flipTravelMs(x0, y0, x1, y1) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  return Math.max(
    TURN_MIN_MS,
    Math.round(TURN_MS * Math.min(1, dist / (PAGE_W * 2))),
  );
}
/** Match OS-style hold: first page immediately, then this delay, then interval */
export const HOLD_DELAY = 400;
export const HOLD_INTERVAL = 32;
/** Release past the spine (follow-point x < 0) lands the turn */
const COMMIT_THRESHOLD = 0.48;
/** Drag distance scale — used only for mobile swipe → progress */
const FLIP_SPAN_SCALE = 0.75;
/** Outer half of each page starts a peel; inner half (gutter) does not */
const PAGE_ZONE = 0.5;
/** Outer fraction that starts an edge peel / tap-turn */
const PEEL_ZONE = 0.5;
/** Top/bottom fraction treated as a true corner grab */
const PEEL_CORNER = 0.24;
const TAP_SLOP = 10;
/**
 * NEXT 023 name charts. Boxes are the full page (u,v from the top-left).
 * A tap jumps; moving across the box recolors that chart's bars.
 */
const DIR_CHARTS = [
  { id: 'ruiyang', spread: 12, u0: 200 / 1020, u1: 317 / 1020, v0: 490 / 1024, v1: 612 / 1024 },
  { id: 'fengming', spread: 13, u0: 350 / 1020, u1: 467 / 1020, v0: 660 / 1024, v1: 781 / 1024 },
  { id: 'yazhou', spread: 14, u0: 508 / 1020, u1: 624 / 1020, v0: 381 / 1024, v1: 502 / 1024 },
  { id: 'linli', spread: 15, u0: 660 / 1020, u1: 777 / 1020, v0: 198 / 1024, v1: 319 / 1024 },
  { id: 'zhelin', spread: 19, u0: 814 / 1020, u1: 931 / 1020, v0: 799 / 1024, v1: 920 / 1024 },
];
/** Exposed fore-edge of a longer sheet → the spread that edge belongs to. */
const EDGE_JUMP_SPREAD = {
  24: 12,
  27: 13,
  29: 14,
  31: 15,
  39: 19,
};
/** NEXT 040–041. The thermal plate is centered on the gutter, one half per page. */
const HEAT_SHEET = 1559;
const HEAT_PLATE = {
  left: { x0: 756, x1: 1558, y0: 394, y1: 1146 },
  right: { x0: 0, x1: 802, y0: 394, y1: 1146 },
};
const HEAT_RES = 640;

function heatInk(t) {
  const u = Math.max(0, Math.min(1, t));
  const stops = [
    [0.0, 72, 6, 0, 0],
    [0.16, 176, 18, 6, 150],
    [0.4, 236, 78, 10, 210],
    [0.7, 255, 196, 48, 236],
    [1.0, 255, 252, 240, 255],
  ];
  let i = 1;
  while (i < stops.length - 1 && u > stops[i][0]) i += 1;
  const a = stops[i - 1];
  const b = stops[i];
  const k = (u - a[0]) / Math.max(1e-4, b[0] - a[0]);
  return [
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
    a[3] + (b[3] - a[3]) * k,
    a[4] + (b[4] - a[4]) * k,
  ];
}

function plateBox(side, w, h) {
  const src = HEAT_PLATE[side];
  const sx = w / HEAT_SHEET;
  const sy = h / HEAT_SHEET;
  return {
    x0: src.x0 * sx,
    x1: src.x1 * sx,
    y0: src.y0 * sy,
    y1: src.y1 * sy,
  };
}

/**
 * 042–043 false color → °C.
 * Blue ambient, green body, red hardware, pale cores hottest.
 */
function thermalCelsius(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  if (d > 1e-4) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1) || 1);
  const hue = h >= 300 ? 0 : Math.min(230, h);
  const stops = [
    [230, 21],
    [200, 28.5],
    [160, 36],
    [120, 49],
    [80, 68],
    [45, 92],
    [15, 118],
    [0, 136],
  ];
  let temp = stops[stops.length - 1][1];
  for (let i = 0; i < stops.length - 1; i += 1) {
    const [h0, t0] = stops[i];
    const [h1, t1] = stops[i + 1];
    if (hue <= h0 && hue >= h1) {
      const u = (h0 - hue) / (h0 - h1);
      temp = t0 + (t1 - t0) * u;
      break;
    }
  }
  if (sat < 0.35 && l > 0.58) {
    const hot = 156 + (l - 0.58) * 70;
    const w = Math.min(1, (0.35 - sat) / 0.22) * Math.min(1, (l - 0.58) / 0.14);
    temp += (hot - temp) * w;
  }
  return temp;
}

function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** Vertical gray bars inside one chart, ignoring the hanging guide line. */
function scanDirBars(data, w, h, chart) {
  const x0 = Math.max(0, Math.floor(chart.u0 * w) + 2);
  const x1 = Math.min(w, Math.ceil(chart.u1 * w) - 2);
  const y0 = Math.max(0, Math.floor(chart.v0 * h) + 2);
  const y1 = Math.min(h, Math.ceil(chart.v1 * h) - 2);
  const bw = x1 - x0;
  const bh = y1 - y0;
  if (bw < 4 || bh < 4) return [];
  const lum = (x, y) => data[(y * w + x) * 4];
  const drop = new Uint8Array(bw);
  const yAbove = Math.max(0, y0 - 14);
  for (let x = x0; x < x1; x += 1) {
    let n = 0;
    for (let y = yAbove; y < y0; y += 1) if (lum(x, y) > 40) n += 1;
    if (n > 6) {
      const i = x - x0;
      drop[i] = 1;
      if (i > 0) drop[i - 1] = 1;
      if (i + 1 < bw) drop[i + 1] = 1;
    }
  }
  const mask = new Uint8Array(bw * bh);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (drop[x - x0]) continue;
      if (lum(x, y) > 52) mask[(y - y0) * bw + (x - x0)] = 1;
    }
  }
  const seen = new Uint8Array(bw * bh);
  const stack = [];
  const bars = [];
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i] || seen[i]) continue;
    stack.length = 0;
    stack.push(i);
    seen[i] = 1;
    let minx = i % bw;
    let maxx = minx;
    let miny = (i / bw) | 0;
    let maxy = miny;
    let n = 0;
    while (stack.length) {
      const p = stack.pop();
      const px = p % bw;
      const py = (p / bw) | 0;
      n += 1;
      if (px < minx) minx = px;
      if (px > maxx) maxx = px;
      if (py < miny) miny = py;
      if (py > maxy) maxy = py;
      if (px > 0) {
        const q = p - 1;
        if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
      if (px + 1 < bw) {
        const q = p + 1;
        if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
      if (py > 0) {
        const q = p - bw;
        if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
      if (py + 1 < bh) {
        const q = p + bw;
        if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    const barW = maxx - minx + 1;
    const barH = maxy - miny + 1;
    if (n < 24 || barH < 14 || barW < 2 || barW > 18 || barH < barW * 2) continue;
    const count = barW * barH;
    const index = new Uint32Array(count);
    const alpha = new Uint8Array(count);
    let k = 0;
    for (let yy = miny; yy <= maxy; yy += 1) {
      for (let xx = minx; xx <= maxx; xx += 1) {
        const value = lum(xx + x0, yy + y0);
        if (value < 34) continue;
        index[k] = (yy + y0) * w + (xx + x0);
        alpha[k] = value > 68 ? 255 : Math.min(255, Math.round(((value - 34) / 34) * 255));
        k += 1;
      }
    }
    if (k < 16) continue;
    bars.push({ index: index.subarray(0, k), alpha: alpha.subarray(0, k) });
  }
  return bars;
}
/** Case bleed beyond pages — small hardcover overhang */
const CASE_BLEED = 0.012;
/** Max visible fore-edge stack width (left/right) */
const STACK_MAX = 0.022;
/** Reader case only — slightly flatter silver than the closed /emax book */
const SHELL_ALBEDO = 0.68;
const SHELL_ENV = 0.20;
const SHELL_METAL_MAX = 0.70;
const SHELL_ROUGH_MIN = 0.52;
const SPREAD_SHELL_URL = 'assets/book_spread.glb';
/** Signature stitches — size/gap from ref; only on listed spreads */
const STITCH_COUNT = 6;
const STITCH_LEN = 0.059;
const STITCH_GAP = 0.091;
const STITCH_THICK = 0.0017;
/** 1-based left pages 008,024,…152 → spread indices */
const STITCH_SPREADS = new Set([4, 12, 20, 28, 36, 44, 52, 60, 68, 76]);
/** Slightly tighter framing so case + stacks stay inside canvas */
const VIEW_FIT = 1.16;

/** Phone landscape: same chrome as CVA_MQ.phoneLandscape */
function isPhoneLandscape() {
  return window.matchMedia(
    window.CVA_MQ?.phoneLandscape
      || '(max-width: 900px) and (orientation: landscape), (pointer: coarse) and (hover: none) and (orientation: landscape) and (max-width: 1100px), (max-width: 1100px) and (max-height: 600px) and (orientation: landscape)',
  ).matches;
}

/** Landscape spread frame: visible short edge, not layout innerHeight. */
function phoneShellFrame() {
  const fromCss = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--reader-vvh'),
  );
  const vv = window.visualViewport?.height;
  const shortEdge = Math.min(window.innerWidth || 0, window.innerHeight || 0);
  const h = Math.max(
    1,
    Math.round((Number.isFinite(fromCss) && fromCss > 0 ? fromCss : 0) || vv || shortEdge || 1),
  );
  return { w: h * 2, h };
}
const VELLUM_OPACITY = 0.5;

function ap(path) {
  return window.assetPath(String(path).replace(/^\//, ''));
}

/** Phone / coarse landscape */
export function isPhoneReader() {
  return window.matchMedia(
    window.CVA_MQ?.phone
      || '(max-width: 900px), (pointer: coarse) and (hover: none) and (max-height: 600px), (pointer: coarse) and (hover: none) and (orientation: landscape) and (max-width: 1100px), (max-width: 1100px) and (max-height: 600px) and (orientation: landscape)',
  ).matches;
}

/** Portrait phone, upright spread: pan only — no swipe-to-flip */
export function isPortraitPanMode() {
  if (document.body.classList.contains('is-reader-portrait-pan')) return true;
  return (
    document.body.dataset.page === 'emax-pages' &&
    window.matchMedia(window.CVA_MQ?.phonePortrait || '(max-width: 900px) and (orientation: portrait)').matches &&
    document.body.classList.contains('is-book-reading')
  );
}

/** Mobile landscape (or old portrait CSS-rotate): stage is landscape-oriented */
function isMobileReaderRotated() {
  if (isPortraitPanMode()) return false;
  return (
    window.matchMedia(window.CVA_MQ?.phone || '(max-width: 900px)').matches &&
    window.matchMedia('(orientation: portrait)').matches &&
    !document.body.classList.contains('is-book-pre-rotate') &&
    (document.body.classList.contains('is-book-reading') ||
      document.body.classList.contains('is-book-opening'))
  );
}

function canvasLayoutSize(canvas) {
  return {
    w: Math.max(1, canvas.clientWidth || 1),
    h: Math.max(1, canvas.clientHeight || 1),
  };
}

function offsetInStage(el, stage) {
  let x = 0;
  let y = 0;
  let n = el;
  while (n && n !== stage) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.parentElement;
  }
  return { x, y };
}

function clientToCanvasLayout(canvas, clientX, clientY) {
  const { w, h } = canvasLayoutSize(canvas);
  if (!isMobileReaderRotated()) {
    const r = canvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top, w, h };
  }
  const stage = canvas.closest('.emax-book-stage');
  if (!stage) {
    const r = canvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top, w, h };
  }
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  /* Inverse of translate(-50%,-50%) rotate(90deg): (ux,uy)->(uy,-ux) */
  const uy = clientX - cx;
  const ux = cy - clientY;
  const sx = ux + sw / 2;
  const sy = uy + sh / 2;
  const off = offsetInStage(canvas, stage);
  return { x: sx - off.x, y: sy - off.y, w, h };
}

function layoutToClient(canvas, x, y) {
  if (!isMobileReaderRotated()) {
    const r = canvas.getBoundingClientRect();
    return { x: r.left + x, y: r.top + y };
  }
  const stage = canvas.closest('.emax-book-stage');
  if (!stage) {
    const r = canvas.getBoundingClientRect();
    return { x: r.left + x, y: r.top + y };
  }
  const off = offsetInStage(canvas, stage);
  const sx = x + off.x;
  const sy = y + off.y;
  const ux = sx - stage.clientWidth / 2;
  const uy = sy - stage.clientHeight / 2;
  return {
    x: uy + window.innerWidth / 2,
    y: window.innerHeight / 2 - ux,
  };
}

/**
 * 冷灰纸纹
 * Cool-gray paper wash plus fibre grain. The heavier lift keeps crushed
 * blacks from turning into a void. NEXT uses it on every sheet. EMAX uses
 * the heavier lift only on the listed black pages.
 */
const PAPER_TINT = new THREE.Color(0xe2e3e6);
const PAPER_GRAIN = 0.012;
const PAPER_GRAY = 0.04;
const PAPER_GRAIN_HEAVY = 0.014;
const PAPER_GRAY_HEAVY = 0.05;
const PAPER_LIFT_HEAVY = 0.005;
/**
 * NEXT full sheets keep the same wash and the same black lift.
 * The speckle is quieter, and the dark-area grain is off.
 * Short sheets stay on the heavy grain.
 */
const PAPER_TEXTURE_QUIET = 0.3;
const PAPER_GRAIN_QUIET = PAPER_GRAIN_HEAVY * PAPER_TEXTURE_QUIET;
/** 1-based EMAX black pages. NEXT ignores this and washes every sheet. */
const HEAVY_PAPER_PAGES = new Set([
  11, 12, 13, 50, 51, 52, 53, 74, 75, 78, 79, 84, 85, 101, 106, 107, 108, 109,
  118, 120, 121, 126, 131, 134, 135, 137, 146, 147, 148, 149, 150, 151,
]);

function isHeavyPaperPage(page1) {
  if (page1 == null) return false;
  if (isNextVolume()) return true;
  return HEAVY_PAPER_PAGES.has(page1);
}

function isShortPaperPage(page1) {
  if (plainPaper || page1 == null || !isNextVolume()) return false;
  return typeof catalog.isShortPage === 'function' && catalog.isShortPage(page1);
}

/** NEXT pages that are not short sheets. Lining counts as a full sheet. */
function usesQuietPaperGrain(page1) {
  return isNextVolume() && !isShortPaperPage(page1);
}

/** 017–020 and 025–038. A tilted crease shears these narrower sheets. */
function horizontalFlipOnly(page1) {
  return isShortPaperPage(page1);
}

/** NEXT 017–020 only: a much paler wash of the 2/9 highlight blue (#3471FF). */
const DRAFT_TINT = new THREE.Color(0xa3c2ff);
const DRAFT_WASH = 0.28;
const DRAFT_GRAIN = 0.02;

function isDraftPaperPage(page1) {
  if (plainPaper || page1 == null || !isNextVolume()) return false;
  return typeof catalog.isDraftPage === 'function' && catalog.isDraftPage(page1);
}

function attachPaperWorld(shader) {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      /* glsl */ `
#include <common>
attribute vec3 restPos;
varying float vGutterAx;
`,
    )
    .replace(
      '#include <project_vertex>',
      /* glsl */ `
#include <project_vertex>
vGutterAx = abs((modelMatrix * vec4(restPos, 1.0)).xyz.x);
`,
    );
}

function patchPaperMaterial(mat, { heavy = false, gutter = true, draft = false, page1 = null } = {}) {
  const quiet = !draft && usesQuietPaperGrain(page1);
  const gray = draft ? DRAFT_WASH : heavy ? PAPER_GRAY_HEAVY : PAPER_GRAY;
  const grain = draft ? DRAFT_GRAIN : quiet ? PAPER_GRAIN_QUIET : heavy ? PAPER_GRAIN_HEAVY : PAPER_GRAIN;
  const lift = heavy && !draft ? PAPER_LIFT_HEAVY : 0;
  const tint = draft ? DRAFT_TINT : PAPER_TINT;
  mat.toneMapped = false;
  mat.customProgramCacheKey = () =>
    `${draft ? 'emax-paper-print-draft9' : quiet ? 'emax-paper-print-v11q' : heavy ? 'emax-paper-print-v11h3' : 'emax-paper-print-v11'}${gutter ? '' : '-ng'}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPaperTint = { value: tint };
    shader.uniforms.uPaperGrain = { value: grain };
    shader.uniforms.uPaperGray = { value: gray };
    shader.uniforms.uPaperLift = { value: lift };
    attachPaperWorld(shader);
    const gutterGlsl = gutter
      ? /* glsl */ `
	float ax = vGutterAx;
	float gSoft = 1.0 - smoothstep(0.0012, 0.018, ax);
	float gLine = 1.0 - smoothstep(0.0, 0.0016, ax);
	float darkPage = 1.0 - smoothstep(0.08, 0.42, lum);
	printRgb *= 1.0 - gSoft * mix(0.08, 0.2, darkPage);
	printRgb = mix(printRgb, vec3(0.0), gLine * mix(0.16, 0.72, darkPage));
`
      : '';
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
#include <common>
varying float vGutterAx;
uniform vec3 uPaperTint;
uniform float uPaperGrain;
uniform float uPaperGray;
uniform float uPaperLift;
`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	vec3 printRgb = sampledDiffuseColor.rgb;
	float lum = dot(printRgb, vec3(0.2126, 0.7152, 0.0722));
	printRgb = mix(printRgb, vec3(lum), uPaperGray * 0.2);
	printRgb = mix(printRgb, uPaperTint, uPaperGray * smoothstep(0.5, 1.0, lum));
	float n1 = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
	float n2 = fract(sin(dot(gl_FragCoord.xy + vec2(0.73, 1.17), vec2(39.346, 11.135))) * 23421.631);
	float grainN = (n1 * 0.62 + n2 * 0.38) - 0.5;
	printRgb *= 1.0 - grainN * uPaperGrain;
	float dark = 1.0 - smoothstep(0.0, 0.16, lum);
	printRgb += vec3(uPaperLift * dark);
	printRgb += vec3(grainN * uPaperLift * ${quiet ? '0.0' : '0.7'} * dark);
	${gutterGlsl}
	diffuseColor = vec4(printRgb, diffuseColor.a * sampledDiffuseColor.a);
#endif
`,
      );
  };
  mat.needsUpdate = true;
  return mat;
}

/** Tracing-paper stock: warm ivory remap (vellum only). */
const VELLUM_TINT = new THREE.Color(0xf5f3ef);
const VELLUM_INK = new THREE.Color(0x2a2927);
const VELLUM_GRAIN = 0.032;

function patchVellumMaterial(mat, { gutter = false } = {}) {
  mat.toneMapped = false;
  if (!mat.clippingPlanes) mat.clippingPlanes = [];
  mat.customProgramCacheKey = () =>
    `emax-vellum-warm-v3${gutter ? '-g' : ''}-c${mat.clippingPlanes?.length || 0}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPaperTint = { value: VELLUM_TINT };
    shader.uniforms.uInkFloor = { value: VELLUM_INK };
    shader.uniforms.uPaperGrain = { value: VELLUM_GRAIN };
    if (gutter) attachPaperWorld(shader);
    const gutterGlsl = gutter
      ? /* glsl */ `
	float lum = dot(printRgb, vec3(0.2126, 0.7152, 0.0722));
	float ax = vGutterAx;
	float gSoft = 1.0 - smoothstep(0.0012, 0.018, ax);
	float gLine = 1.0 - smoothstep(0.0, 0.0016, ax);
	float darkPage = 1.0 - smoothstep(0.08, 0.42, lum);
	printRgb *= 1.0 - gSoft * mix(0.08, 0.2, darkPage);
	printRgb = mix(printRgb, vec3(0.0), gLine * mix(0.16, 0.72, darkPage));
`
      : '';
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
#include <common>
${gutter ? 'varying float vGutterAx;' : ''}
uniform vec3 uPaperTint;
uniform vec3 uInkFloor;
uniform float uPaperGrain;
`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	vec3 printRgb = mix( uInkFloor, uPaperTint, sampledDiffuseColor.rgb );
	float grain = fract( sin( dot( vMapUv * vec2( 640.0, 640.0 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
	printRgb *= 1.0 - ( grain - 0.5 ) * uPaperGrain;
	${gutterGlsl}
	diffuseColor = vec4( printRgb, diffuseColor.a * sampledDiffuseColor.a );
#endif
`,
      );
  };
  mat.needsUpdate = true;
  return mat;
}

/** Shared matte silver cardstock — no print map. */
const _silverStock = { front: null, back: null };
function silverStockMat(side = THREE.FrontSide) {
  const key = side === THREE.BackSide ? 'back' : 'front';
  if (!_silverStock[key]) {
    _silverStock[key] = new THREE.MeshPhysicalMaterial({
      color: 0xc2c4c8,
      metalness: 0.68,
      roughness: 0.54,
      envMapIntensity: 0.85,
      clearcoat: 0.08,
      clearcoatRoughness: 0.62,
      sheen: 0.14,
      sheenColor: new THREE.Color(0xc8ccd2),
      sheenRoughness: 0.82,
      side,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
  }
  return _silverStock[key];
}

/**
 * Flip-only clone of resting silver stock (own instance so clip planes do
 * not leak onto the shared static card). Same grade + spine darkening so
 * the silver filter stays on the sheet while it peels.
 */
const _silverFlipLit = { front: null, back: null };
function silverFlipStockLit(side = THREE.FrontSide) {
  const key = side === THREE.BackSide ? 'back' : 'front';
  if (!_silverFlipLit[key]) {
    _silverFlipLit[key] = patchGutterFollow(silverStockMat(side).clone(), {
      physical: true,
    });
  }
  return _silverFlipLit[key];
}

/**
 * Keep spine darkening on a flipped sheet. Static pages already get this
 * from patchPaperMaterial + the world gutter overlay; the overlay sits
 * behind the opaque peel, so the travelling sheet must carry it itself.
 */
function patchGutterFollow(mat, { physical = false } = {}) {
  if (mat.userData.gutterFollow) return mat;
  mat.userData.gutterFollow = true;
  const prev = mat.onBeforeCompile;
  mat.customProgramCacheKey = () =>
    `emax-gutter-follow-${physical ? 'phys' : 'basic'}-v1`;
  mat.onBeforeCompile = (shader) => {
    prev?.(shader);
    if (!shader.vertexShader.includes('attribute vec3 restPos')) {
      attachPaperWorld(shader);
    }
    if (!shader.fragmentShader.includes('varying float vGutterAx')) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        /* glsl */ `
#include <common>
varying float vGutterAx;
`,
      );
    }
    if (shader.fragmentShader.includes('emax-gutter-follow')) return;
    if (physical) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        /* glsl */ `
	// emax-gutter-follow
	float ax = vGutterAx;
	float gSoft = 1.0 - smoothstep(0.0012, 0.018, ax);
	float gLine = 1.0 - smoothstep(0.0, 0.0016, ax);
	float lum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
	float darkPage = 1.0 - smoothstep(0.08, 0.42, lum);
	outgoingLight *= 1.0 - gSoft * mix(0.08, 0.2, darkPage);
	outgoingLight = mix(outgoingLight, vec3(0.0), gLine * mix(0.16, 0.72, darkPage));
#include <opaque_fragment>
`,
      );
    } else {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        /* glsl */ `
#include <map_fragment>
#ifdef USE_MAP
	// emax-gutter-follow
	float ax = vGutterAx;
	float gSoft = 1.0 - smoothstep(0.0012, 0.018, ax);
	float gLine = 1.0 - smoothstep(0.0, 0.0016, ax);
	float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
	float darkPage = 1.0 - smoothstep(0.08, 0.42, lum);
	diffuseColor.rgb *= 1.0 - gSoft * mix(0.08, 0.2, darkPage);
	diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.0), gLine * mix(0.16, 0.72, darkPage));
#endif
`,
      );
    }
  };
  mat.needsUpdate = true;
  return mat;
}

/** Print overlay on silver stock. Multiply for ink fields; Normal for PNG decals (white stays white). */
function silverPrintMat(tex, { side = THREE.FrontSide, decal = false, gutter = false } = {}) {
  const mat = {
    map: tex,
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    side,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  };
  if (decal) {
    mat.blending = THREE.NormalBlending;
  } else {
    mat.blending = THREE.CustomBlending;
    mat.blendEquation = THREE.AddEquation;
    mat.blendSrc = THREE.DstColorFactor;
    mat.blendDst = THREE.ZeroFactor;
  }
  const print = new THREE.MeshBasicMaterial(mat);
  return gutter ? patchGutterFollow(print) : print;
}

function pageMat(tex, { silver = false, heavy = false, gutter = true, draft = false, page1 = null } = {}) {
  if (silver) return silverStockMat();
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    color: 0xffffff,
    toneMapped: false,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: gutter ? 1 : 0,
    polygonOffsetUnits: gutter ? 1 : 0,
  });
  return patchPaperMaterial(mat, { heavy, gutter, draft, page1 });
}

function pageBackMat(tex, { counterMirror = true, vellum = false, silver = false, heavy = false, gutter = true, draft = false, page1 = null } = {}) {
  const map = counterMirror ? mirroredTex(tex) : tex;
  if (silver) return silverStockMat(THREE.BackSide);
  const mat = new THREE.MeshBasicMaterial({
    map,
    color: 0xffffff,
    toneMapped: false,
    transparent: vellum,
    opacity: vellum ? VELLUM_OPACITY : 1,
    depthWrite: !vellum,
    side: THREE.BackSide,
  });
  return vellum
    ? patchVellumMaterial(mat, { gutter })
    : patchPaperMaterial(mat, { heavy, gutter, draft, page1 });
}

/** Match the resting top-sheet opacity of that vellum pile. */
function vellumFlipOpacity(page1) {
  const stack = vellumStackFrom(page1) || vellumLeftStackFrom(page1);
  if (!stack) return VELLUM_OPACITY;
  return stack.length > 3 ? 0.4 : 0.52;
}

function vellumMat(tex, opacity = VELLUM_OPACITY, { gutter = false } = {}) {
  return patchVellumMaterial(
    new THREE.MeshBasicMaterial({
      map: tex,
      color: 0xffffff,
      transparent: true,
      opacity,
      depthWrite: false,
      toneMapped: false,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      clippingPlanes: [],
    }),
    { gutter },
  );
}

/** Shared static sheet geo — never dispose per-spread */
const SHARED_SHEET_GEO = new THREE.PlaneGeometry(PAGE_W, PAGE_H);
bindRestPos(SHARED_SHEET_GEO);

function loadTex(loader, url) {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

/** Horizontal flip for through-page view (left-side vellum) */
function mirroredTex(tex) {
  if (!tex) return tex;
  if (tex.userData.mirroredClone) return tex.userData.mirroredClone;
  const t = tex.clone();
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.repeat.x = -1;
  t.offset.x = 1;
  t.needsUpdate = true;
  tex.userData.mirroredClone = t;
  return t;
}

function paperMat(color = 0xf5f5f5) {
  return new THREE.MeshBasicMaterial({
    color,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}

function makeSheetMesh(pageW, pageH, xCenter, faceMat) {
  const mesh = new THREE.Mesh(SHARED_SHEET_GEO, faceMat);
  mesh.position.set(xCenter, 0, 0);
  return mesh;
}

/** Rest-pose vertex so gutter shading stays on the bound edge during curl. */
function bindRestPos(geo) {
  const pos = geo.attributes.position;
  if (!pos || geo.attributes.restPos) return geo;
  geo.setAttribute('restPos', pos.clone());
  return geo;
}

function makePageGeo(pageW, pageH) {
  /* 1×1: fold is a clip plane, not a deformed grid (grid folds staircase). */
  const geo = new THREE.PlaneGeometry(pageW, pageH, 1, 1);
  geo.translate(pageW / 2, 0, 0);
  geo.userData.basePositions = Float32Array.from(geo.attributes.position.array);
  bindRestPos(geo);
  return geo;
}

function resetCurl(geometry) {
  const pos = geometry.attributes.position;
  const src = geometry.userData.basePositions;
  if (!src) return;
  pos.array.set(src);
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

function buildBinding() {
  const group = new THREE.Group();
  group.visible = false;
  group.name = 'signatureStitches';

  const threadMat = new THREE.MeshBasicMaterial({
    color: 0xefeeec,
    toneMapped: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.78,
  });
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x1c1b19,
    toneMapped: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.06,
  });

  const rad = STITCH_THICK * 0.38;
  const geo = new THREE.CylinderGeometry(rad, rad, STITCH_LEN, 8);
  const shadowGeo = new THREE.CylinderGeometry(rad * 1.15, rad * 1.15, STITCH_LEN * 1.01, 8);

  const blockH = STITCH_COUNT * STITCH_LEN + (STITCH_COUNT - 1) * STITCH_GAP;
  const y0 = -blockH * 0.5;

  for (let i = 0; i < STITCH_COUNT; i += 1) {
    const y = y0 + i * (STITCH_LEN + STITCH_GAP) + STITCH_LEN * 0.5;

    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.position.set(0.00016, y - 0.0001, 0.001);
    shadow.renderOrder = FLIP_ORDER;
    group.add(shadow);

    const dash = new THREE.Mesh(geo, threadMat);
    dash.position.set(0, y, 0.00135);
    dash.renderOrder = FLIP_ORDER;
    group.add(dash);
  }
  return group;
}

function buildGutterShade() {
  const w = 256;
  const h = 8;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  const valley = ctx.createLinearGradient(0, 0, w, 0);
  valley.addColorStop(0, 'rgba(0,0,0,0)');
  valley.addColorStop(0.36, 'rgba(0,0,0,0)');
  valley.addColorStop(0.44, 'rgba(0,0,0,0.05)');
  valley.addColorStop(0.49, 'rgba(0,0,0,0.14)');
  valley.addColorStop(0.5, 'rgba(0,0,0,0.48)');
  valley.addColorStop(0.51, 'rgba(0,0,0,0.14)');
  valley.addColorStop(0.56, 'rgba(0,0,0,0.05)');
  valley.addColorStop(0.64, 'rgba(0,0,0,0)');
  valley.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = valley;
  ctx.fillRect(0, 0, w, h);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;

  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    /* Test against the flap (closer, writes depth) so the valley does not
     * paint over the peeling corner. Stay sits behind this z. */
    depthTest: true,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.026, PAGE_H * 0.998), mat);
  mesh.position.set(0, 0, GUTTER_SHADE_Z);
  mesh.frustumCulled = false;
  /* After stay (10/11), before stitches (12) and flap (14+) */
  mesh.renderOrder = FLIP_ORDER - 1;
  return mesh;
}

/** Contact shadow along the crease — GPU falloff, no rectangle overlay. */
function makeCreaseShadowMat() {
  const mat = new THREE.MeshBasicMaterial({
    color: 0x0c0b0a,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    opacity: 1,
    side: THREE.DoubleSide,
  });
  mat.userData.foldM = new THREE.Vector2();
  mat.userData.foldN = new THREE.Vector2();
  mat.userData.lift = 0;
  mat.userData.edgeSoft = 0;
  mat.customProgramCacheKey = () => 'emax-crease-shadow-v5';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFoldM = { value: mat.userData.foldM };
    shader.uniforms.uFoldN = { value: mat.userData.foldN };
    shader.uniforms.uLift = { value: mat.userData.lift };
    shader.uniforms.uEdgeSoft = { value: mat.userData.edgeSoft };
    mat.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vCreaseRest;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vCreaseRest = position.xy;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec2 uFoldM;
uniform vec2 uFoldN;
uniform float uLift;
uniform float uEdgeSoft;
varying vec2 vCreaseRest;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `float d = abs(dot(vCreaseRest - uFoldM, uFoldN));
float contact = exp(-d * 11.0);
float wash = exp(-d * 3.6);
float a = (contact * 0.22 + wash * 0.09) * uLift;
/* Short sheets: feather the rectangle so the edge does not cut off on the page below. */
float fore = smoothstep(0.0, 0.16, ${PAGE_W.toFixed(4)} - vCreaseRest.x);
float vert = smoothstep(0.0, 0.09, ${PAGE_H.toFixed(4)} * 0.5 - abs(vCreaseRest.y));
a *= mix(1.0, fore * vert, step(0.5, uEdgeSoft));
float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
a += (dither - 0.5) * 0.004;
diffuseColor.a *= max(a, 0.0);
#include <opaque_fragment>`,
      );
  };
  return mat;
}

function buildCreaseShadow(geo) {
  const mesh = new THREE.Mesh(geo, makeCreaseShadowMat());
  mesh.name = 'creaseShadow';
  mesh.frustumCulled = false;
  mesh.renderOrder = FLIP_ORDER - 1;
  mesh.position.z = 0.0001;
  mesh.visible = false;
  return mesh;
}

/**
 * Crease-space flap lighting. `kind` 0 = corner shade, 1 = ridge sheen.
 * Must follow the fold — a UV blob lands in the wrong place after reflection.
 */
function makeFlapLightMat(kind) {
  const mat = new THREE.MeshBasicMaterial({
    color: kind === 1 ? 0xfffcf4 : 0x0e0d0c,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    opacity: 1,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
  mat.userData.foldM = new THREE.Vector2();
  mat.userData.foldN = new THREE.Vector2();
  mat.userData.lift = 0;
  mat.customProgramCacheKey = () => `emax-flap-light-v5-${kind}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFoldM = { value: mat.userData.foldM };
    shader.uniforms.uFoldN = { value: mat.userData.foldN };
    shader.uniforms.uLift = { value: mat.userData.lift };
    mat.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vFlapRest;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vFlapRest = position.xy;`,
      );
    const falloff =
      kind === 1
        ? `float ridge = exp(-towardFree * 32.0) * (1.0 - exp(-towardFree * 140.0));
diffuseColor.a *= ridge * uLift * 0.16;`
        : `float shade = smoothstep(0.0, 0.42, towardFree) * (1.0 - smoothstep(0.48, 1.05, towardFree));
diffuseColor.a *= shade * uLift * 0.14;`;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec2 uFoldM;
uniform vec2 uFoldN;
uniform float uLift;
varying vec2 vFlapRest;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `float towardFree = max(0.0, -dot(vFlapRest - uFoldM, uFoldN));
${falloff}
#include <opaque_fragment>`,
      );
  };
  return mat;
}

function applyFlapLight(mat, nx, ny, mx, my, lift) {
  if (!mat?.userData) return;
  mat.userData.foldM.set(mx, my);
  mat.userData.foldN.set(nx, ny);
  mat.userData.lift = lift;
  const sh = mat.userData.shader;
  if (sh?.uniforms?.uLift) sh.uniforms.uLift.value = lift;
}

function buildFlapLightMesh(name, geo, mat, order, z) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  mesh.position.z = z;
  mesh.visible = false;
  return mesh;
}

/**
 * Paper length from the grabbed edge point to a spine corner.
 * Finger is clamped inside both circles so the sheet cannot tear.
 */
function constrainFollow(px, py, pageW, pageH, cornerY) {
  const top = pageH * 0.5;
  const bot = -pageH * 0.5;
  let x = THREE.MathUtils.clamp(px, -pageW, pageW);
  let y = THREE.MathUtils.clamp(py, bot - pageH * 0.12, top + pageH * 0.12);

  const clampCircle = (cx, cy, r) => {
    const dx = x - cx;
    const dy = y - cy;
    const d2 = dx * dx + dy * dy;
    const r2 = r * r;
    if (d2 <= r2 || d2 < 1e-12) return;
    const d = Math.sqrt(d2);
    x = cx + (dx / d) * r;
    y = cy + (dy / d) * r;
  };

  clampCircle(0, bot, Math.hypot(pageW, cornerY - bot));
  clampCircle(0, top, Math.hypot(pageW, cornerY - top));
  x = THREE.MathUtils.clamp(x, -pageW, pageW);
  return { x, y };
}

function followProgress(fingerX, pageW) {
  return THREE.MathUtils.clamp((pageW - fingerX) / (2 * pageW), 0, 1);
}

/**
 * Householder reflection across the crease in the flip group's local XY.
 * Short pages scale that group on X only. A diagonal reflection does not
 * commute with that scale, so the flap is conjugated back into local space
 * and still meets the world-space crease. sx = ±1 leaves the matrix unchanged.
 */
function setReflectionMatrix(out, nx, ny, mx, my, sx = 1) {
  const invSx = 1 / (sx || 1);
  let nwx = nx * invSx;
  let nwy = ny;
  const nlen = Math.hypot(nwx, nwy) || 1;
  nwx /= nlen;
  nwy /= nlen;
  const mxw = sx * mx;
  const myw = my;
  const a = 1 - 2 * nwx * nwx;
  const b = -2 * nwx * nwy;
  const c = 1 - 2 * nwy * nwy;
  const k = 2 * (nwx * mxw + nwy * myw);
  const tx = nwx * k;
  const ty = nwy * k;
  out.set(
    a, b * invSx, 0, tx * invSx,
    b * sx, c, 0, ty,
    0, 0, 1, 0,
    0, 0, 0, 1,
  );
}

function resetPageFlip(flipGroup, geometry, flapGroup) {
  resetCurl(geometry);
  if (!flipGroup) return;
  flipGroup.rotation.y = 0;
  flipGroup.position.z = FLIP_Z;
  if (flapGroup) {
    flapGroup.visible = false;
    flapGroup.matrix.identity();
  }
}

function easeFlip(t) {
  /* ease-out cubic — same curve for keyboard, tap, and hold-release */
  const u = 1 - t;
  return 1 - u * u * u;
}

function easeLinear(t) {
  return t;
}

function tween(ms, fn, ease = easeFlip) {
  return new Promise((resolve) => {
    if (ms <= 0) {
      fn(1);
      resolve();
      return;
    }
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      fn(ease(t));
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

/** Light paper-edge strip from page.png — white stock, rotated 90° */
function makePaperEdgeTexture(pageTex) {
  const img = pageTex.image;
  const w = 64;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f4f4';
  ctx.fillRect(0, 0, w, h);
  if (img) {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(Math.PI / 2);
    ctx.globalAlpha = 0.45;
    ctx.drawImage(img, -h / 2, -w / 2, h, w);
    ctx.restore();
  }
  /* Soften both thickness free-edges (less 1px stair-step on L/R stacks) */
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      let a = 1;
      if (x < 3) a = [0.35, 0.7, 0.92][x];
      else if (x >= w - 3) a = [0.92, 0.7, 0.35][x - (w - 3)];
      d[i + 3] = Math.round(255 * a);
    }
  }
  ctx.putImageData(imgData, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 10);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

/** Procedural matte-silver board (no printed cover map) */
function makeMatteSilverTexture() {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  /* Matte silver cardstock — even, low-contrast, paper grain */
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, '#a8adb4');
  g.addColorStop(0.5, '#b0b5bc');
  g.addColorStop(1, '#a6abb2');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  /* Fibre grain, not brushed metal */
  for (let i = 0; i < 2800; i += 1) {
    const x = (i * 47) % s;
    const y = (i * 91) % s;
    const v = 150 + (i % 40);
    ctx.fillStyle = `rgba(${v}, ${v + 1}, ${v + 2}, 0.055)`;
    ctx.fillRect(x, y, 1 + (i % 2), 1 + (i % 2));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

/** Spine cloth strip — slightly deeper silver than the boards */
function makeCaseSpineTexture() {
  const w = 64;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, '#9ba0a7');
  g.addColorStop(0.18, '#a6abb2');
  g.addColorStop(0.5, '#aeb3ba');
  g.addColorStop(0.82, '#a6abb2');
  g.addColorStop(1, '#9ba0a7');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  /* Soft hinge grooves at spine edges */
  const groove = ctx.createLinearGradient(0, 0, w, 0);
  groove.addColorStop(0, 'rgba(40,42,46,0.28)');
  groove.addColorStop(0.08, 'rgba(40,42,46,0)');
  groove.addColorStop(0.92, 'rgba(40,42,46,0)');
  groove.addColorStop(1, 'rgba(40,42,46,0.28)');
  ctx.fillStyle = groove;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 400; i += 1) {
    const x = (i * 17) % w;
    const y = (i * 53) % h;
    const v = 160 + (i % 30);
    ctx.fillStyle = `rgba(${v}, ${v + 1}, ${v + 2}, 0.04)`;
    ctx.fillRect(x, y, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

function loadGltf(url) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(url, resolve, undefined, reject);
  });
}

function meshMaterials(obj) {
  if (!obj?.material) return [];
  return Array.isArray(obj.material) ? obj.material : [obj.material];
}

function isCaseShellMat(m) {
  const n = m?.name || '';
  return /白色封面/.test(n) || /Material\.007/.test(n) || /条纹/.test(n);
}

function isNextVolume() {
  return document.body?.dataset?.slug === 'next';
}

/** NEXT shell: original GLB material, almost no metal, rough, dark gray.
 *  #4c4c4c keeps the rim neutral under the cool studio lights, a little
 *  darker than the previous cool gray. */
const NEXT_SHELL_COLOR = 0x4c4c4c;

function applyNextReaderShell(root, envMap) {
  const seen = new Set();
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = false;
    obj.receiveShadow = false;
    for (const m of meshMaterials(obj)) {
      if (!m || seen.has(m) || !isCaseShellMat(m)) continue;
      seen.add(m);
      if (m.color) m.color.setHex(NEXT_SHELL_COLOR);
      if (typeof m.metalness === 'number') m.metalness = 0;
      if (typeof m.roughness === 'number') m.roughness = 0.95;
      if (typeof m.clearcoat === 'number') m.clearcoat = 0;
      if (typeof m.sheen === 'number') m.sheen = 0;
      if (m.emissive) {
        m.emissive.setRGB(0, 0, 0);
        m.emissiveIntensity = 0;
      }
      if (envMap && 'envMap' in m) {
        m.envMap = envMap;
        m.envMapIntensity = 0.05;
      }
      m.needsUpdate = true;
    }
  });
}

/** Open-reader shell: same GLB, softer metal response than the closed /emax book. */
function applyClosedBookShellLook(root, envMap) {
  const seen = new Set();
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = false;
    obj.receiveShadow = false;
    for (const m of meshMaterials(obj)) {
      if (!m || seen.has(m)) continue;
      seen.add(m);
      if (isCaseShellMat(m)) {
        if (m.color) m.color.multiplyScalar(SHELL_ALBEDO);
        if (typeof m.metalness === 'number' && m.metalness > SHELL_METAL_MAX) {
          m.metalness = SHELL_METAL_MAX;
        }
        if (typeof m.roughness === 'number' && m.roughness < SHELL_ROUGH_MIN) {
          m.roughness = SHELL_ROUGH_MIN;
        }
        if (m.emissive) {
          m.emissive.setRGB(0, 0, 0);
          m.emissiveIntensity = 0;
        }
      }
      if (envMap && 'envMap' in m) {
        m.envMap = envMap;
        if (isCaseShellMat(m)) m.envMapIntensity = SHELL_ENV;
        else if (m.envMapIntensity == null) m.envMapIntensity = 0.72;
      }
      m.needsUpdate = true;
    }
  });
}

/**
 * book_spread.glb ships with the open shell in X=height, Y=thickness, Z=spread.
 * Cover-square recess is cut into Y≈0 (outer). Keep that face on −Z so it
 * sits on the back of the boards, not against the pages.
 * Reader: X = spread, Y = page-up, Z+ toward camera.
 */
function fitOpenSpreadModel(sceneRoot) {
  const wrapper = new THREE.Group();
  wrapper.name = 'glb-spread-shell';

  const yaw = new THREE.Group();
  yaw.rotation.y = Math.PI / 2;
  yaw.add(sceneRoot);

  const pitch = new THREE.Group();
  pitch.rotation.x = Math.PI / 2;
  pitch.add(yaw);
  wrapper.add(pitch);
  wrapper.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(wrapper);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  pitch.position.sub(center);

  const targetH = caseSpreadHeight();
  const targetW = PAGE_W * 2 + GUTTER + CASE_BLEED * 2;
  const sx = targetW / Math.max(1e-6, size.x);
  const sy = targetH / Math.max(1e-6, size.y);
  wrapper.scale.setScalar(Math.max(sx, sy));
  wrapper.updateMatrixWorld(true);

  const placed = new THREE.Box3().setFromObject(wrapper);
  wrapper.position.z -= placed.max.z + 0.0012;
  wrapper.updateMatrixWorld(true);
  return wrapper;
}

function caseSpreadWidth() {
  return PAGE_W * 2 + GUTTER + CASE_BLEED * 2 + STACK_MAX * 2;
}

function caseSpreadHeight() {
  return PAGE_H + CASE_BLEED * 2;
}

/** left/right stack widths in world units for a spread (+ optional in-flight flip) */
function stackWidths(spreadIndex, flipProgress = 0, flipDir = null) {
  const maxS = Math.max(1, SPREAD_COUNT - 1);
  let leftT = spreadIndex / maxS;
  let rightT = 1 - leftT;
  const step = 1 / maxS;
  if (flipDir === 'fwd') {
    leftT += flipProgress * step;
    rightT -= flipProgress * step;
  } else if (flipDir === 'back') {
    leftT -= flipProgress * step;
    rightT += flipProgress * step;
  }
  return {
    left: Math.max(0, Math.min(1, leftT)) * STACK_MAX,
    right: Math.max(0, Math.min(1, rightT)) * STACK_MAX,
  };
}

export class BookReader {
  constructor({ scene, camera, renderer, canvas, envMap, coverTex, onSpreadChange, plain = false }) {
    plainPaper = !!plain;
    catalog = !plainPaper && isNextVolume() ? nextPages : emaxPages;
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.canvas = canvas;
    this.envMap = envMap;
    this.coverTex = coverTex;
    this.liningTex = null;
    this.onSpreadChange = onSpreadChange || (() => {});

    this.loader = new THREE.TextureLoader();
    this.texCache = new Map();
    this.texReady = new Map();
    this._pmrem = null;
    /** Reuse page materials — avoids shader/setup hitch every flip */
    this._pageMatCache = new Map();
    this.group = new THREE.Group();
    this.group.visible = false;

    this.spread = 0;
    this.flipping = false;
    this.coverOpen = false;
    this.leftMesh = null;
    this.rightMesh = null;
    /** @type {THREE.Mesh[]} */
    this._pageMeshes = [];
    /** Under-sheets kept visible while top sheet flips */
    this._rightUnder = [];
    this._leftUnder = [];
    /** Temporary underlay shown during an active flip (page ± 2) */
    this._flipUnder = [];
    this._flipUnderHidden = [];
    this._flipUnderToken = 0;
    /** Recycled static page meshes */
    this._meshPool = [];

    this._drag = null;
    this._dragPending = null;
    this._edgeTap = null;
    this._layout = null;
    this._flipGeo = null;
    this._flipFront = null;
    this._flipBack = null;
    this._foldPlane = new THREE.Plane();
    this._foldClip = [this._foldPlane];
    this._foldPlaneInv = new THREE.Plane();
    this._foldClipInv = [this._foldPlaneInv];
    this._pageBoundPlanes = [
      new THREE.Plane(),
      new THREE.Plane(),
      new THREE.Plane(),
      new THREE.Plane(),
    ];
    this._boundTmpN = new THREE.Vector3();
    this._boundTmpP = new THREE.Vector3();
    this._clipStayMesh = null;
    this._liftedPage1 = null;
    this._foldLocalN = new THREE.Vector3();
    this._foldLocalM = new THREE.Vector3();
    this._foldWorldN = new THREE.Vector3();
    this._foldWorldM = new THREE.Vector3();

    this.caseGroup = null;
    this.caseShell = null;
    this.leftStack = null;
    this.rightStack = null;
    this._stackMat = null;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onKeyBlur = this._onKeyBlur.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._controlsBound = false;
    this._keyHoldDir = null;
    this._keyHoldDelay = 0;
    this._keyHoldRepeat = 0;
    /** Grabbed edge Y in page-local space (0 = centre) */
    this._foldCornerY = -PAGE_H * 0.28;
    this._foldFollowY = this._foldCornerY;
    this._foldFingerX = PAGE_W;
    this._foldFingerY = this._foldCornerY;
  }

  _ensureEnvMap() {
    if (this.envMap) {
      if (!this.scene.environment) this.scene.environment = this.envMap;
      return;
    }
    if (!this.renderer) return;
    this._pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = this._pmrem.fromScene(new RoomEnvironment(), 0.06).texture;
    this.scene.environment = this.envMap;
  }

  async init() {
    this._ensureEnvMap();
    if (this.renderer) this.renderer.localClippingEnabled = true;
    this._buildScene();
    this.scene.add(this.group);
    await this._buildCase();
    try {
      this.liningTex = await loadTex(this.loader, liningUrl());
    } catch (err) {
      console.warn('[BookReader] lining tex failed, fallback to cover', err);
      this.liningTex = this.coverTex;
    }
    await this._loadSpread(this.spread);
  }

  _buildScene() {
    const g = this.group;
    /* Match closed 3D book on /emax: cool studio key/fill/rim + spine + soft ambient */
    g.add(new THREE.AmbientLight(0xb4bcc6, 0.22));
    g.add(new THREE.HemisphereLight(0xe0e4ee, 0x2a2e34, 0.28));
    const key = new THREE.DirectionalLight(0xfff8f0, 0.78);
    key.position.set(-6.8, 3.6, 3.2);
    g.add(key);
    const fill = new THREE.DirectionalLight(0xc8d4e4, 0.32);
    fill.position.set(5.5, -1.2, 2.2);
    g.add(fill);
    const rim = new THREE.DirectionalLight(0xf0f4fa, 0.52);
    rim.position.set(4.5, 2.2, -5.5);
    g.add(rim);
    const front = new THREE.DirectionalLight(0xf4f6fa, 0.28);
    front.position.set(-1.2, 2.4, 8);
    g.add(front);
    const spine = new THREE.DirectionalLight(0xe8ecf2, 0.42);
    spine.position.set(-8, 1.6, 1.2);
    g.add(spine);

    /* Case + stacks sit under pages */
    this.caseGroup = new THREE.Group();
    this.caseGroup.name = 'caseShell';
    this.caseGroup.visible = false;
    this.caseGroup.position.z = -0.002;
    g.add(this.caseGroup);

    this.binding = buildBinding();
    g.add(this.binding);
    this.gutterShade = buildGutterShade();
    g.add(this.gutterShade);

    /* Radial contact blob looked like a pupil on the landing page — omit. */

    this._flipGeo = makePageGeo(PAGE_W, PAGE_H);
    const makeFlipMesh = (mat, order) => {
      const mesh = new THREE.Mesh(this._flipGeo, mat);
      mesh.renderOrder = order;
      mesh.frustumCulled = false;
      return mesh;
    };
    this._flipFront = makeFlipMesh(paperMat(), FLIP_ORDER - 2);
    this._flipFrontPrint = makeFlipMesh(paperMat(), FLIP_ORDER - 1);
    this._flipFrontPrint.visible = false;
    this._flipBack = makeFlipMesh(paperMat(0xf2f2f2), FLIP_ORDER - 2);
    this._flipBack.material.side = THREE.BackSide;
    this._flipBackPrint = makeFlipMesh(paperMat(0xf2f2f2), FLIP_ORDER - 1);
    this._flipBackPrint.visible = false;
    this._flipBackPrint.material.side = THREE.BackSide;

    this._flapFront = makeFlipMesh(this._flipFront.material, FLIP_ORDER + 4);
    this._flapFrontPrint = makeFlipMesh(this._flipFrontPrint.material, FLIP_ORDER + 5);
    this._flapFrontPrint.visible = false;
    this._flapBack = makeFlipMesh(this._flipBack.material, FLIP_ORDER + 2);
    this._flapBackPrint = makeFlipMesh(this._flipBackPrint.material, FLIP_ORDER + 3);
    this._flapBackPrint.visible = false;
    for (const m of [this._flapFront, this._flapFrontPrint, this._flapBack, this._flapBackPrint]) {
      m.position.z = 0.0014;
    }

    this._creaseShadow = buildCreaseShadow(this._flipGeo);
    this._flapShadeMat = makeFlapLightMat(0);
    this._flapSheenMat = makeFlapLightMat(1);
    this._flapShade = buildFlapLightMesh(
      'flapShade',
      this._flipGeo,
      this._flapShadeMat,
      FLIP_ORDER + 6,
      0.00152,
    );
    this._flapSheen = buildFlapLightMesh(
      'flapSheen',
      this._flipGeo,
      this._flapSheenMat,
      FLIP_ORDER + 7,
      0.00158,
    );

    this.flipGroup = new THREE.Group();
    this.flipGroup.add(this._flipFront);
    this.flipGroup.add(this._flipFrontPrint);
    this.flipGroup.add(this._flipBack);
    this.flipGroup.add(this._flipBackPrint);
    this.flapGroup = new THREE.Group();
    this.flapGroup.name = 'pageFlap';
    this.flapGroup.visible = false;
    this.flapGroup.matrixAutoUpdate = false;
    this.flapGroup.add(this._flapFront);
    this.flapGroup.add(this._flapFrontPrint);
    this.flapGroup.add(this._flapBack);
    this.flapGroup.add(this._flapBackPrint);
    this.flapGroup.add(this._flapShade);
    this.flapGroup.add(this._flapSheen);
    this.flipGroup.add(this.flapGroup);
    this.flipGroup.add(this._creaseShadow);
    this.flipGroup.visible = false;
    this.flipGroup.position.z = FLIP_Z;
    this.flipGroup.renderOrder = FLIP_ORDER;
    g.add(this.flipGroup);
    this._foldMeshes = [
      this._flipFront,
      this._flipFrontPrint,
      this._flipBack,
      this._flipBackPrint,
      this._flapFront,
      this._flapFrontPrint,
      this._flapBack,
      this._flapBackPrint,
      this._flapShade,
      this._flapSheen,
    ];

    const coverFace = new THREE.MeshBasicMaterial({
      map: this.coverTex,
      toneMapped: false,
    });
    this.coverMesh = new THREE.Mesh(new THREE.PlaneGeometry(PAGE_W, PAGE_H * 1.01), coverFace);
    this.coverPivot = new THREE.Group();
    this.coverPivot.position.set(0, 0, 0.003);
    this.coverMesh.position.set(PAGE_W / 2 + GUTTER / 2, 0, 0);
    this.coverPivot.add(this.coverMesh);
    g.add(this.coverPivot);
  }

  async _buildCase() {
    const pageTex = await loadTex(this.loader, ap('assets/page.png'));

    try {
      const gltf = await loadGltf(ap(SPREAD_SHELL_URL));
      if (isNextVolume()) applyNextReaderShell(gltf.scene, this.envMap);
      else applyClosedBookShellLook(gltf.scene, this.envMap);
      this.caseShell = fitOpenSpreadModel(gltf.scene);
      this.caseShell.traverse((obj) => {
        obj.raycast = () => {};
        if (obj.isMesh) obj.renderOrder = 0;
      });
      this.caseGroup.add(this.caseShell);
    } catch (err) {
      console.warn('[BookReader] book_spread.glb failed, using flat shell', err);
      const fallback = new THREE.Mesh(
        new THREE.PlaneGeometry(caseSpreadWidth(), caseSpreadHeight()),
        new THREE.MeshPhysicalMaterial({
          color: 0xaeaeae,
          metalness: 0.92,
          roughness: 0.56,
          envMap: this.envMap || null,
          envMapIntensity: 0.36,
        }),
      );
      fallback.position.z = -0.001;
      fallback.renderOrder = 0;
      fallback.raycast = () => {};
      this.caseShell = fallback;
      this.caseGroup.add(fallback);
    }

    const edgeMap = makePaperEdgeTexture(pageTex);
    this._stackMat = new THREE.MeshBasicMaterial({
      map: edgeMap,
      color: 0xffffff,
      toneMapped: false,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    /* Unit plane scaled in X for thickness; Y = page height */
    const stackGeo = new THREE.PlaneGeometry(1, PAGE_H);
    this.leftStack = new THREE.Mesh(stackGeo, this._stackMat);
    this.rightStack = new THREE.Mesh(stackGeo.clone(), this._stackMat);
    this.leftStack.position.set(-(PAGE_W + GUTTER / 2), 0, 0.0004);
    this.rightStack.position.set(PAGE_W + GUTTER / 2, 0, 0.0004);
    this.leftStack.renderOrder = 2;
    this.rightStack.renderOrder = 2;
    this.leftStack.raycast = () => {};
    this.rightStack.raycast = () => {};
    this.caseGroup.add(this.leftStack);
    this.caseGroup.add(this.rightStack);
    this.caseGroup.raycast = () => {};

    this._updateStacks(this.spread);
  }

  _caseFrameSize() {
    if (!this.caseShell) return { w: caseSpreadWidth(), h: caseSpreadHeight() };
    this.caseShell.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(this.caseShell).getSize(new THREE.Vector3());
    return {
      w: Math.max(caseSpreadWidth(), size.x),
      h: Math.max(caseSpreadHeight(), size.y),
    };
  }

  _updateStacks(spreadIndex, flipProgress = 0, flipDir = null) {
    if (!this.leftStack || !this.rightStack) return;
    const { left, right } = stackWidths(spreadIndex, flipProgress, flipDir);
    const minW = 0.0008;

    if (left < minW) {
      this.leftStack.visible = false;
    } else {
      this.leftStack.visible = true;
      this.leftStack.scale.x = left;
      this.leftStack.position.x = -(PAGE_W + GUTTER / 2) - left * 0.5;
    }

    if (right < minW) {
      this.rightStack.visible = false;
    } else {
      this.rightStack.visible = true;
      this.rightStack.scale.x = right;
      this.rightStack.position.x = PAGE_W + GUTTER / 2 + right * 0.5;
    }
  }

  _leftX() {
    return -(PAGE_W / 2) + 0.0004;
  }

  _rightX() {
    return PAGE_W / 2 - 0.0004;
  }

  /** Spine x of the held sheet, matching the static page’s bound edge. */
  _flipAnchorX(dir) {
    return dir === 'fwd' ? this._rightX() - PAGE_W / 2 : this._leftX() + PAGE_W / 2;
  }

  async _tex(index) {
    if (index == null) return null;
    if (this.texReady.has(index)) return this.texReady.get(index);
    if (this.texCache.has(index)) return this.texCache.get(index);
    const p = loadTex(this.loader, pageUrl(index)).then((tex) => {
      /* Dropped while in-flight (HD pages — don't keep GPU copies of old spreads) */
      if (!this.texCache.has(index)) {
        tex.dispose();
        return tex;
      }
      this.texReady.set(index, tex);
      /* Upload to GPU during idle prefetch — avoids hitch on commit */
      try {
        this.renderer.initTexture(tex);
      } catch (_) {
        /* older three — ignore */
      }
      return tex;
    });
    this.texCache.set(index, p);
    return p;
  }

  _texReadySync(index) {
    if (index == null) return null;
    return this.texReady.get(index) || null;
  }

  _prefetchPages(page1List) {
    return Promise.all(page1List.map((p1) => this._tex(p1 - 1)));
  }

  _prefetchSpread(spreadIndex) {
    const spec = spreadPages(spreadIndex);
    if (!spec) return Promise.resolve();
    const jobs = [];
    if (spec.left != null) {
      jobs.push(this._tex(spec.left));
      const leftStack = shortStackLeftFrom(spec.left + 1) || vellumLeftStackFrom(spec.left + 1);
      if (leftStack) leftStack.forEach((p1) => jobs.push(this._tex(p1 - 1)));
    }
    if (spec.right != null) {
      jobs.push(this._tex(spec.right));
      const stack = shortStackFrom(spec.right + 1) || vellumStackFrom(spec.right + 1);
      if (stack) stack.forEach((p1) => jobs.push(this._tex(p1 - 1)));
    }
    return Promise.all(jobs);
  }

  _pageIndicesForSpread(spreadIndex) {
    const ids = new Set();
    const spec = spreadPages(spreadIndex);
    if (!spec) return ids;
    const add = (index0) => {
      if (index0 == null) return;
      ids.add(index0);
      const p1 = index0 + 1;
      const rightStack = shortStackFrom(p1) || vellumStackFrom(p1);
      const leftStack = shortStackLeftFrom(p1) || vellumLeftStackFrom(p1);
      if (rightStack) rightStack.forEach((n) => ids.add(n - 1));
      if (leftStack) leftStack.forEach((n) => ids.add(n - 1));
    };
    add(spec.left);
    add(spec.right);
    return ids;
  }

  /** Keep current ±3 spreads in GPU; 2048 pages would OOM if all 160 stayed resident. */
  _prunePageTextures(centerSpread) {
    const keep = new Set();
    for (let s = centerSpread - 3; s <= centerSpread + 3; s++) {
      if (s < 0 || s >= SPREAD_COUNT) continue;
      for (const i of this._pageIndicesForSpread(s)) keep.add(i);
    }
    for (const index of [...this.texReady.keys()]) {
      if (keep.has(index)) continue;
      const tex = this.texReady.get(index);
      const mirror = tex?.userData?.mirroredClone;
      if (mirror) {
        mirror.dispose();
        tex.userData.mirroredClone = null;
      }
      tex?.dispose();
      this.texReady.delete(index);
      this.texCache.delete(index);
    }
    for (const key of [...this._pageMatCache.keys()]) {
      const page1 = Number(String(key).split('|')[0]);
      if (keep.has(page1 - 1)) continue;
      this._pageMatCache.delete(key);
    }
  }

  async _ensureSpreadTextures(spreadIndex) {
    await this._prefetchSpread(spreadIndex);
  }

  _clearFlipUnder() {
    this._flipUnderToken += 1;
    for (const m of this._flipUnder) this._releaseMesh(m);
    this._flipUnder = [];
    for (const m of this._flipUnderHidden) {
      m.visible = true;
    }
    this._flipUnderHidden = [];
  }

  _clearPages() {
    this._clearFlipUnder();
    for (const m of this._pageMeshes) this._releaseMesh(m);
    this._pageMeshes = [];
    this.leftMesh = null;
    this.rightMesh = null;
    this._rightUnder = [];
    this._leftUnder = [];
  }

  _clearShortShadow(mesh) {
    const shadow = mesh?.userData?.shortShadowMesh;
    if (!shadow) return;
    mesh.remove(shadow);
    mesh.userData.shortShadowMesh = null;
  }

  /**
   * Narrow sheets stay bound to the gutter. A full sheet is unchanged.
   * Short sheets get a light fore-edge shadow on the page underneath.
   */
  _fitSheet(mesh, side, page1) {
    this._clearShortShadow(mesh);
    const ratio = pageWidthRatio(page1);
    mesh.scale.set(ratio, 1, 1);
    const fullX = side === 'right' ? this._rightX() : this._leftX();
    const shift = (1 - ratio) * PAGE_W * 0.5;
    mesh.position.x = side === 'right' ? fullX - shift : fullX + shift;
    mesh.position.y = 0;
    if (ratio >= 0.999) return;
    shortShadowMaterial();
    const shadow = new THREE.Mesh(SHORT_SHADOW_GEO, SHORT_SHADOW_MAT);
    const shadowW = 0.034;
    const tuck = 0.0012;
    const localHalf = PAGE_W * 0.5;
    if (side === 'right') {
      shadow.scale.set(shadowW / ratio, 1, 1);
      shadow.position.set(localHalf + (shadowW * 0.5 - tuck) / ratio, 0, -0.00004);
    } else {
      shadow.scale.set(-shadowW / ratio, 1, 1);
      shadow.position.set(-localHalf - (shadowW * 0.5 - tuck) / ratio, 0, -0.00004);
    }
    shadow.renderOrder = (mesh.renderOrder || 0) + 1;
    shadow.frustumCulled = false;
    mesh.add(shadow);
    mesh.userData.shortShadowMesh = shadow;
  }

  _releaseMesh(mesh) {
    if (!mesh) return;
    this._detachDirColor(mesh);
    this._detachHeat(mesh);
    this._clearShortShadow(mesh);
    mesh.visible = false;
    mesh.scale.set(1, 1, 1);
    this.group.remove(mesh);
    if (mesh.geometry && mesh.geometry !== SHARED_SHEET_GEO) {
      mesh.geometry.dispose();
    }
    this._meshPool.push(mesh);
  }

  _acquireSheet(mat, x, z, order, printMat = null) {
    let mesh = this._meshPool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(SHARED_SHEET_GEO, mat);
    } else {
      this._clearShortShadow(mesh);
      mesh.material = mat;
      mesh.visible = true;
      mesh.scale.set(1, 1, 1);
    }
    mesh.position.set(x, 0, z);
    mesh.renderOrder = order;
    this._bindPrintOverlay(mesh, printMat, order);
    this.group.add(mesh);
    this._pageMeshes.push(mesh);
    return mesh;
  }

  /** Multiply the scan over a silver stock mesh (child shares the same geo). */
  _bindPrintOverlay(mesh, printMat, order) {
    let overlay = mesh.userData.printOverlay;
    if (!printMat) {
      if (overlay) overlay.visible = false;
      return;
    }
    if (!overlay) {
      overlay = new THREE.Mesh(mesh.geometry, printMat);
      overlay.frustumCulled = false;
      mesh.add(overlay);
      mesh.userData.printOverlay = overlay;
    }
    overlay.material = printMat;
    overlay.visible = true;
    overlay.renderOrder = (order ?? mesh.renderOrder) + 1;
  }

  _trackPage(mesh) {
    /* sheets should go through _acquireSheet; keep for cover lining path */
    this._pageMeshes.push(mesh);
    this.group.add(mesh);
    return mesh;
  }

  _matForPage(page1, tex, { opacity = null, mirror = false } = {}) {
    const face = mirror ? mirroredTex(tex) : tex;
    const silver = opacity == null && isSilverPage(page1);
    const draft = opacity == null && isDraftPaperPage(page1);
    const key = `${page1}|${mirror ? 1 : 0}|${opacity == null ? 'solid' : opacity.toFixed(3)}|${silver ? 'ag10' : draft ? 'draft' : 'p'}`;
    const cached = this._pageMatCache.get(key);
    if (cached) return cached;

    let mat;
    if (silver) {
      mat = {
        stock: silverStockMat(THREE.FrontSide),
        print: silverPrintMat(face, {
          side: THREE.FrontSide,
          decal: isSilverDecalPage(page1),
        }),
      };
    } else if (opacity != null) mat = vellumMat(face, opacity);
    else if (isVellumPage(page1)) mat = vellumMat(face);
    else mat = pageMat(face, { heavy: isHeavyPaperPage(page1), draft, page1 });

    this._pageMatCache.set(key, mat);
    return mat;
  }

  _sheetFromPageMat(mats, x, z, order) {
    if (mats && mats.print) {
      return this._acquireSheet(mats.stock, x, z, order, mats.print);
    }
    return this._acquireSheet(mats, x, z, order);
  }

  async _makePageFace(pageIndex0, opacity = null) {
    const tex = this._texReadySync(pageIndex0) || (await this._tex(pageIndex0));
    return this._matForPage(pageIndex0 + 1, tex, { opacity });
  }

  /**
   * Build a vertical stack of sheets (top→bottom page list).
   * Sync — textures should already be ready; missing maps get a paper stand-in
   * so deep vellum piles (026 / 042 left) never drop middle sheets.
   */
  _buildStackMeshesSync(stack, xCenter, opts = {}) {
    const mirrorVellum = !!opts.mirrorVellum;
    const opaqueShort = !!opts.opaqueShort;
    const side = xCenter >= 0 ? 'right' : 'left';
    const n = stack.length;
    const vellumCount = Math.max(1, n - 1);
    /* Deeper piles need lighter sheets so 022–025 / 038–041 still read through */
    const topOp = n > 3 ? 0.4 : 0.52;
    const botOp = n > 3 ? 0.26 : 0.38;
    let top = null;
    const under = [];
    for (let i = n - 1; i >= 0; i -= 1) {
      const p1 = stack[i];
      const isBase = i === n - 1;
      const isTop = i === 0;
      const srcTex = this._texReadySync(p1 - 1);
      const mirror = !opaqueShort && mirrorVellum && !isBase && isVellumPage(p1);
      const opacity = opaqueShort || isBase
        ? null
        : THREE.MathUtils.lerp(botOp, topOp, 1 - i / vellumCount);
      const mats = !srcTex
        ? paperMat(isBase ? 0xf2f2f2 : 0xe8e8e8)
        : this._matForPage(p1, srcTex, { opacity, mirror });
      const mesh = this._sheetFromPageMat(
        mats,
        xCenter,
        sheetStackZ(n - 1 - i),
        4 + (n - 1 - i),
      );
      mesh.userData.page1 = p1;
      mesh.userData.mirrored = mirror;
      mesh.visible = true;
      this._fitSheet(mesh, side, p1);
      if (isTop) top = mesh;
      else under.push(mesh);
    }
    return { top, under };
  }

  /** Endpaper from emaxpages1/260623_emax0.jpg (before 001 / after 160) */
  _makeLiningMat() {
    const map = this.liningTex || this.coverTex;
    return patchPaperMaterial(
      new THREE.MeshBasicMaterial({
        map,
        color: 0xffffff,
        toneMapped: false,
      }),
      { heavy: true },
    );
  }

  _buildLiningSheet(xCenter) {
    const mesh = this._acquireSheet(this._makeLiningMat(), xCenter, 0.0004, 4);
    mesh.userData.lining = true;
    return mesh;
  }

  /** Right-side stack: e.g. 023…027；null = 后环衬 */
  _buildRightStackSync(pageIndex0) {
    const x = this._rightX();
    if (pageIndex0 == null) return this._buildLiningSheet(x);

    const page1 = pageIndex0 + 1;
    const stack = shortStackFrom(page1) || vellumStackFrom(page1);

    if (!stack) {
      const tex = this._texReadySync(pageIndex0);
      if (!tex) return null;
      const mats = this._matForPage(page1, tex);
      const mesh = this._sheetFromPageMat(mats, x, 0.0004, 4);
      mesh.userData.page1 = page1;
      this._fitSheet(mesh, 'right', page1);
      return mesh;
    }

    const { top, under } = this._buildStackMeshesSync(stack, x, {
      opaqueShort: !!shortStackFrom(page1),
    });
    this._rightUnder = under;
    return top;
  }

  /** Left-side stack: e.g. 026…022 — vellum sheets mirrored (seen from back)；null = 前环衬 */
  _buildLeftStackSync(pageIndex0) {
    const x = this._leftX();
    if (pageIndex0 == null) return this._buildLiningSheet(x);

    const page1 = pageIndex0 + 1;
    const stack = shortStackLeftFrom(page1) || vellumLeftStackFrom(page1);

    if (!stack) {
      const srcTex = this._texReadySync(pageIndex0);
      if (!srcTex) return null;
      const mirror = isVellumPage(page1);
      const mats = this._matForPage(page1, srcTex, { mirror });
      const mesh = this._sheetFromPageMat(mats, x, 0.0004, 4);
      mesh.userData.page1 = page1;
      mesh.userData.mirrored = mirror;
      this._fitSheet(mesh, 'left', page1);
      return mesh;
    }

    const { top, under } = this._buildStackMeshesSync(stack, x, {
      mirrorVellum: true,
      opaqueShort: !!shortStackLeftFrom(page1),
    });
    this._leftUnder = under;
    return top;
  }

  _prefetchNeighbors(spreadIndex) {
    this._prefetchSpread(spreadIndex + 1);
    this._prefetchSpread(spreadIndex - 1);
    this._prefetchSpread(spreadIndex + 2);
    this._prefetchSpread(spreadIndex - 2);
  }

  /** Install spread without black gap — mount new sheets, then retire old. */
  async _installSpread(spreadIndex) {
    await this._ensureSpreadTextures(spreadIndex);
    this._installSpreadSync(spreadIndex);
  }

  /**
   * Sync install — textures must already be ready.
   * Used at end of flip so we don't hitch waiting on network mid-settle.
   */
  _installSpreadSync(spreadIndex) {
    const spec = spreadPages(spreadIndex);
    if (!spec) return;

    this._clearVellumStayClip();

    const retiring = [...this._pageMeshes, ...this._flipUnder];
    this._flipUnderToken += 1;
    this._pageMeshes = [];
    this._flipUnder = [];
    this._flipUnderHidden = [];
    this._rightUnder = [];
    this._leftUnder = [];
    this.leftMesh = null;
    this.rightMesh = null;

    this.leftMesh = this._buildLeftStackSync(spec.left);
    this.rightMesh = this._buildRightStackSync(spec.right);
    this._mountDirColor(spec);

    for (const m of retiring) {
      if (!m || this._pageMeshes.includes(m)) continue;
      this._releaseMesh(m);
    }
    this._mountHeat(spec);
    this._prepareGun(spec);

    if (this.binding) {
      this.binding.visible = STITCH_SPREADS.has(spreadIndex);
    }
    this._updateStacks(spreadIndex);

    /* DOM HUD/nav after meshes are up — avoids layout work blocking the reveal */
    const notify = this.onSpreadChange;
    if (typeof notify === 'function') {
      queueMicrotask(() => notify(spreadIndex, spec));
    }
    queueMicrotask(() => this._prunePageTextures(spreadIndex));
  }

  async _loadSpread(spreadIndex) {
    const spec = spreadPages(spreadIndex);
    if (!spec) return;

    await this._installSpread(spreadIndex);
    this._prefetchNeighbors(spreadIndex);
  }

  /**
   * Even vellum versos (024/026/040/042) fake their odd recto under the sheet
   * at rest. During an LTR turn that recto also rides `_flapBack`. Clip the
   * static under copy to the crease so the stay still shows print through
   * tracing paper, without a second full copy glued to the left page.
   */
  _clipLiftedVellumRecto(liftedPage1) {
    const otherSide = liftedPage1 - 1;
    const match = (m) => m && m.userData?.page1 === otherSide;
    const mesh =
      this._leftUnder.find(match) || this._pageMeshes.find(match) || null;
    if (this._clipStayMesh && this._clipStayMesh !== mesh) {
      this._clearVellumStayClip();
    }
    this._clipStayMesh = mesh;
  }

  /**
   * While flipping page P, show P±2 underneath immediately (no black void).
   * Vellum piles already have the remaining sheets — keep them, do not
   * swap in a clearer P±2 stack.
   */
  _showFlipUnderlay(dir, liftedPage1) {
    this._clearFlipUnder();

    const inVellum =
      dir === 'fwd' ? vellumStackFrom(liftedPage1) : vellumLeftStackFrom(liftedPage1);
    if (inVellum) {
      if (dir === 'back' && isVellumPage(liftedPage1) && liftedPage1 % 2 === 0) {
        this._clipLiftedVellumRecto(liftedPage1);
      }
      return;
    }
    const inShort =
      dir === 'fwd' ? shortStackFrom(liftedPage1) : shortStackLeftFrom(liftedPage1);
    if (inShort) return;

    const under1 = dir === 'fwd' ? liftedPage1 + 2 : liftedPage1 - 2;
    const permanent = dir === 'fwd' ? this._rightUnder : this._leftUnder;
    for (const m of permanent) {
      m.visible = false;
      this._flipUnderHidden.push(m);
    }

    const x = dir === 'fwd' ? this._rightX() : this._leftX();

    /* Past first/last content page → show endpaper lining instead of bare case */
    if (under1 < 1 || under1 > 160) {
      const mesh = this._meshPool.pop() || new THREE.Mesh(SHARED_SHEET_GEO, this._makeLiningMat());
      mesh.material = this._makeLiningMat();
      mesh.visible = true;
      mesh.position.set(x, 0, 0.0004);
      mesh.renderOrder = 3;
      mesh.userData.lining = true;
      this._bindPrintOverlay(mesh, null, 3);
      this.group.add(mesh);
      this._flipUnder.push(mesh);
      return;
    }

    const mirrorLeft = dir === 'back';
    const side = dir === 'fwd' ? 'right' : 'left';
    const shortUnder = dir === 'fwd' ? shortStackFrom(under1) : shortStackLeftFrom(under1);
    const stack =
      shortUnder
      || (dir === 'fwd'
        ? vellumStackFrom(under1) || [under1]
        : vellumLeftStackFrom(under1) || [under1]);

    this._prefetchPages(stack);

    const n = stack.length;
    for (let i = n - 1; i >= 0; i -= 1) {
      const p1 = stack[i];
      const isBase = i === n - 1;
      const tex = this._texReadySync(p1 - 1);
      const opacity = shortUnder || isBase
        ? null
        : THREE.MathUtils.lerp(0.38, 0.58, 1 - i / Math.max(1, n - 1));
      const mirror = !shortUnder && mirrorLeft && !isBase && isVellumPage(p1);
      const matOrPair = tex
        ? this._matForPage(p1, tex, { opacity, mirror })
        : paperMat(0xf2f2f2);
      const stock = matOrPair.print ? matOrPair.stock : matOrPair;
      const printMat = matOrPair.print || null;
      const mesh = this._meshPool.pop() || new THREE.Mesh(SHARED_SHEET_GEO, stock);
      mesh.material = stock;
      mesh.visible = true;
      mesh.position.set(x, 0, sheetStackZ(n - 1 - i));
      mesh.renderOrder = 3 + (n - 1 - i);
      mesh.userData.page1 = p1;
      this._fitSheet(mesh, side, p1);
      this._bindPrintOverlay(mesh, printMat, mesh.renderOrder);
      this.group.add(mesh);
      this._flipUnder.push(mesh);
    }
  }

  _fitCamera() {
    const { w, h } = canvasLayoutSize(this.canvas);
    const slot = this.canvas?.closest('.detail-visual--book');
    const pane = this.canvas?.closest('.book-reader-pane');
    const slotR = slot?.getBoundingClientRect();
    const paneR = pane?.getBoundingClientRect();
    const portraitPan = isPortraitPanMode();
    const phoneLand = isPhoneLandscape();
    const shell = phoneLand ? phoneShellFrame() : null;
    const frameW = portraitPan
      ? w
      : Math.max(1, slotR?.width || (phoneLand ? shell.w : w));
    const frameH = portraitPan
      ? Math.max(1, w * 0.5)
      : Math.max(1, slotR?.height || paneR?.height || (phoneLand ? shell.h : h));
    const aspect = Math.max(0.2, w / Math.max(1, h));
    this.camera.aspect = aspect;
    const fovSlot = 34;
    const slotAspect = Math.max(0.2, frameW / frameH);
    const { w: spreadW, h: spreadH } = this._caseFrameSize();
    const fitW =
      spreadW / (2 * Math.tan(THREE.MathUtils.degToRad(fovSlot * 0.5)) * slotAspect);
    const fitH = spreadH / (2 * Math.tan(THREE.MathUtils.degToRad(fovSlot * 0.5)));
    const dist = Math.max(fitW, fitH) * VIEW_FIT;
    const coverV = Math.max(h / frameH, 1);
    this.camera.fov = THREE.MathUtils.radToDeg(
      2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fovSlot) * 0.5) * coverV),
    );
    this.camera.position.set(0, 0.012, dist);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this._layout = null;
  }

  /** Project world → canvas layout pixels (pre CSS-rotate) */
  _worldToLayout(x, y, z = 0) {
    const { w, h } = canvasLayoutSize(this.canvas);
    const v = new THREE.Vector3(x, y, z);
    this.group.updateMatrixWorld(true);
    v.applyMatrix4(this.group.matrixWorld);
    v.project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * w,
      y: (-v.y * 0.5 + 0.5) * h,
    };
  }

  _screenLayout() {
    if (this._layout) return this._layout;
    const tl = this._worldToLayout(-PAGE_W - GUTTER / 2, PAGE_H / 2);
    const tr = this._worldToLayout(PAGE_W + GUTTER / 2, PAGE_H / 2);
    const bl = this._worldToLayout(-PAGE_W - GUTTER / 2, -PAGE_H / 2);
    const br = this._worldToLayout(PAGE_W + GUTTER / 2, -PAGE_H / 2);
    const mid = this._worldToLayout(0, 0);
    this._layout = {
      left: { x: tl.x, y: tl.y, w: mid.x - tl.x, h: bl.y - tl.y },
      right: { x: mid.x, y: tr.y, w: br.x - mid.x, h: br.y - tr.y },
      midX: mid.x,
    };
    return this._layout;
  }

  /**
   * Screen rect of the top sheet. Short pages stop at their fore-edge,
   * so the longer sheet showing outside this rect is not part of the hit.
   */
  _contentRect(side) {
    const L = this._screenLayout();
    const full = side === 'right' ? L.right : L.left;
    if (!full) return null;
    const spec = spreadPages(this.spread);
    const index0 = side === 'right' ? spec?.right : spec?.left;
    if (index0 == null) return full;
    const ratio = pageWidthRatio(index0 + 1);
    if (ratio >= 0.999) return full;
    const w = full.w * ratio;
    if (side === 'right') return { x: full.x, y: full.y, w, h: full.h };
    return { x: full.x + full.w - w, y: full.y, w, h: full.h };
  }

  /**
   * Left page: outer | mid | gutter (spine)
   * Right page: gutter (spine) | mid | outer
   */
  _pageZone(clientX, clientY) {
    if (!this.coverOpen || this.flipping) return null;
    const p = clientToCanvasLayout(this.canvas, clientX, clientY);
    const inRect = (r) =>
      r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    let side = null;
    let rect = null;
    if (inRect(this._contentRect('left'))) {
      side = 'left';
      rect = this._contentRect('left');
    } else if (inRect(this._contentRect('right'))) {
      side = 'right';
      rect = this._contentRect('right');
    }
    if (!side || !rect) return null;
    const t = (p.x - rect.x) / Math.max(1, rect.w);
    const v = (p.y - rect.y) / Math.max(1, rect.h);
    let col;
    if (side === 'left') {
      col = t < PAGE_ZONE ? 'outer' : t < PAGE_ZONE * 2 ? 'mid' : 'gutter';
    } else {
      col = t > 1 - PAGE_ZONE ? 'outer' : t > PAGE_ZONE ? 'mid' : 'gutter';
    }
    const outerT = side === 'left' ? t : 1 - t;
    const row = v < PEEL_CORNER ? 'top' : v > 1 - PEEL_CORNER ? 'bot' : 'mid';
    const peel = outerT <= PEEL_ZONE;
    const localY =
      row === 'top' ? PAGE_H * 0.5 : row === 'bot' ? -PAGE_H * 0.5 : PAGE_H * (0.5 - v);
    return { side, col, row, peel, rect, p, localY };
  }

  /** Page-local follow point. +x is toward the free edge (works with left-page scale.x = -1). */
  _layoutToPageLocal(layoutX, layoutY, dir) {
    const r = this._contentRect(dir === 'fwd' ? 'right' : 'left');
    if (!r || !(r.w > 0) || !(r.h > 0)) {
      return { x: PAGE_W, y: 0 };
    }
    const u = dir === 'fwd' ? (layoutX - r.x) / r.w : (r.x + r.w - layoutX) / r.w;
    const v = (layoutY - r.y) / r.h;
    return {
      x: u * PAGE_W,
      y: PAGE_H * (0.5 - v),
    };
  }

  _hitTest(clientX, clientY) {
    if (!this.coverOpen || this.flipping) return null;
    const p = clientToCanvasLayout(this.canvas, clientX, clientY);
    const inRect = (r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    const spec = spreadPages(this.spread);
    const right = this._contentRect('right');
    const left = this._contentRect('left');
    if (inRect(right) && spec?.right != null && this.spread < SPREAD_COUNT - 1) {
      return { dir: 'fwd', pageWidthPx: right.w };
    }
    if (inRect(left) && spec?.left != null && this.spread > 0) {
      return { dir: 'back', pageWidthPx: left.w };
    }
    return null;
  }

  _hitTestEdge(clientX, clientY) {
    if (!this.coverOpen || this.flipping) return null;
    const zone = this._pageZone(clientX, clientY);
    if (!zone || !zone.peel) return null;
    const spec = spreadPages(this.spread);
    if (
      zone.side === 'right' &&
      spec?.right != null &&
      this.spread < SPREAD_COUNT - 1
    ) {
      return { dir: 'fwd', pageWidthPx: zone.rect.w, cornerY: zone.localY };
    }
    if (zone.side === 'left' && spec?.left != null && this.spread > 0) {
      return { dir: 'back', pageWidthPx: zone.rect.w, cornerY: zone.localY };
    }
    return null;
  }

  _updateHoverCursor(e) {
    if (!this.coverOpen || this.flipping || this._drag || this._edgeTap) return;
    if (this._gunActiveSpread() && this._pageZone(e.clientX, e.clientY)) {
      this.canvas.style.cursor = 'none';
      return;
    }
    if (this._dirHotspotAt(e.clientX, e.clientY) || this._edgeJumpAt(e.clientX, e.clientY) || this._hitTestEdge(e.clientX, e.clientY)) {
      this.canvas.style.cursor = 'pointer';
      return;
    }
    if (this._heatPlateAt(e.clientX, e.clientY) != null) {
      this.canvas.style.cursor = 'ew-resize';
      return;
    }
    this.canvas.style.cursor = '';
  }

  _hitTestSpread(clientX, clientY) {
    if (!this.coverOpen || this.flipping) return null;
    const L = this._screenLayout();
    const spec = spreadPages(this.spread);
    const canFwd = this.spread < SPREAD_COUNT - 1 && spec?.right != null;
    const canBack = this.spread > 0 && spec?.left != null;
    if (!canFwd && !canBack) return null;

    const p = clientToCanvasLayout(this.canvas, clientX, clientY);
    const inRect = (r) =>
      r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    const left = this._contentRect('left');
    const right = this._contentRect('right');
    let onLeft = inRect(left);
    let onRight = inRect(right);

    /* On the longer sheet beside a short page: no turn. */
    if (!onLeft && !onRight && (inRect(L.left) || inRect(L.right))) return null;

    /* Fallback: AABB of CSS-rotated canvas (layout map can miss on some phones) */
    if (!onLeft && !onRight) {
      const r = this.canvas.getBoundingClientRect();
      if (
        clientX < r.left ||
        clientX > r.right ||
        clientY < r.top ||
        clientY > r.bottom
      ) {
        return null;
      }
    }

    return {
      pageWidthPx: Math.max(L.left?.w || 0, L.right?.w || 0, 48),
      canFwd,
      canBack,
    };
  }

  /**
   * Enter flat reading immediately (no cover handoff) — used by /emax/pages.
   * Default spread 0 = 环衬 + 001.
   */
  async enterOpen(spreadIndex = 0) {
    this.group.visible = true;
    this.group.position.set(0, 0, 0);
    if (this.coverPivot) this.coverPivot.visible = false;
    if (this.caseGroup) this.caseGroup.visible = true;
    await this._loadSpread(spreadIndex);
    this.coverOpen = true;
    if (this.leftMesh) this.leftMesh.visible = true;
    if (this.rightMesh) this.rightMesh.visible = true;
    if (this.binding) {
      this.binding.visible = STITCH_SPREADS.has(this.spread);
    }
    this._updateStacks(this.spread);
    this._fitCamera();
  }

  /**
   * Show closed cover ready for handoff.
   * Keep inner pages hidden so page 001 never flashes under/without the cover.
   */
  showClosedCover() {
    this.group.visible = true;
    this.group.position.set(0, 0, 0);
    this.coverPivot.visible = true;
    this.coverPivot.rotation.y = 0;
    if (this.rightMesh) this.rightMesh.visible = false;
    if (this.leftMesh) this.leftMesh.visible = false;
    if (this.binding) this.binding.visible = false;
    if (this.caseGroup) this.caseGroup.visible = false;
    this.coverOpen = false;
  }

  /**
   * Open cover while camera travels. Optional onCoverMoving(t) fires every tick
   * so the 3D book can stay up until the hinge is clearly in motion (no static grey hold).
   */
  async playCoverOpen(durationMs = 640, cameraTravel = null) {
    this.showClosedCover();

    const easeHinge = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);
    const openAngle = Math.PI * 0.93;
    const from = cameraTravel?.from;
    const to = cameraTravel?.to;
    if (from) {
      this.camera.fov = from.fov;
      this.camera.position.copy(from.position);
      this.camera.lookAt(from.lookAt);
      this.camera.updateProjectionMatrix();
    }

    await tween(
      durationMs,
      (t) => {
        this.coverPivot.rotation.y = -t * openAngle;
        cameraTravel?.onCoverMoving?.(t);
        /* Reveal pages only once the cover has swung enough */
        if (this.rightMesh) this.rightMesh.visible = t > 0.12;
        if (this.leftMesh) this.leftMesh.visible = t > 0.28;
        if (from && to) {
          this.camera.fov = THREE.MathUtils.lerp(from.fov, to.fov, t);
          this.camera.position.lerpVectors(from.position, to.position, t);
          const look = new THREE.Vector3().lerpVectors(from.lookAt, to.lookAt, t);
          this.camera.lookAt(look);
          this.camera.updateProjectionMatrix();
        }
      },
      easeHinge,
    );

    this.coverPivot.visible = false;
    if (this.leftMesh) this.leftMesh.visible = true;
    if (this.rightMesh) this.rightMesh.visible = true;
    if (this.caseGroup) this.caseGroup.visible = true;
    if (this.spread !== 0 || !this.rightMesh) {
      await this._loadSpread(0);
    }
    this._updateStacks(this.spread);
    this.coverOpen = true;
  }

  bindControls() {
    if (this._controlsBound) return;
    this._controlsBound = true;
    this.canvas.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onKeyBlur);
  }

  unbindControls() {
    if (!this._controlsBound) return;
    this._controlsBound = false;
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onKeyBlur);
    this._stopKeyHold();
    this.cancelPointer();
  }

  /** Abort in-progress page drag (e.g. second finger starts a pinch) */
  cancelPointer() {
    this._edgeTap = null;
    if (!this._drag && !this.flipGroup?.visible) {
      this._dragPending = null;
      return;
    }
    this._drag = null;
    this._dragPending = null;
    if (this.flipGroup) {
      this.flipGroup.visible = false;
      this.flipGroup.scale.x = 1;
      this._resetFlipSheet();
    }
    if (this.leftMesh) this.leftMesh.visible = true;
    if (this.rightMesh) this.rightMesh.visible = true;
    this._clearFlipUnder?.();
    this._resetFoldPose();
    if (this.canvas) this.canvas.style.cursor = '';
  }

  _keyDir(e) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') return 'fwd';
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') return 'back';
    return null;
  }

  _stopKeyHold() {
    if (this._keyHoldDelay) {
      clearTimeout(this._keyHoldDelay);
      this._keyHoldDelay = 0;
    }
    if (this._keyHoldRepeat) {
      clearInterval(this._keyHoldRepeat);
      this._keyHoldRepeat = 0;
    }
    this._keyHoldDir = null;
  }

  _startKeyHold(dir) {
    this._stopKeyHold();
    this._keyHoldDir = dir;
    if (dir === 'fwd') this.next();
    else this.prev();
    if (this._filmLock) return;
    this._keyHoldDelay = window.setTimeout(() => {
      this._keyHoldDelay = 0;
      if (this._keyHoldDir !== dir) return;
      const pump = () => {
        if (this._keyHoldDir !== dir) return;
        if (dir === 'fwd') this.next();
        else this.prev();
      };
      pump();
      this._keyHoldRepeat = window.setInterval(pump, HOLD_INTERVAL);
    }, HOLD_DELAY);
  }

  _onKeyDown(e) {
    if (!this.coverOpen || this._drag) return;
    const dir = this._keyDir(e);
    if (!dir) return;
    e.preventDefault();
    if (e.repeat) return;
    this._startKeyHold(dir);
  }

  _onKeyUp(e) {
    const dir = this._keyDir(e);
    if (!dir) return;
    if (this._keyHoldDir === dir) this._stopKeyHold();
  }

  _onKeyBlur() {
    this._stopKeyHold();
  }

  _setFlipMaterials(frontTex, backTex, mirrored, {
    frontVellum = false,
    backVellum = false,
    frontSilver = false,
    backSilver = false,
    frontDecal = false,
    backDecal = false,
    frontHeavy = false,
    backHeavy = false,
    frontDraft = false,
    backDraft = false,
    frontPage1 = null,
    backPage1 = null,
    frontVellumOp = VELLUM_OPACITY,
    backVellumOp = VELLUM_OPACITY,
  } = {}) {
    /*
     * Left flips use flipGroup.scale.x = -1. WebGLRenderer already reverses
     * frontFace when the world matrix determinant is negative — do NOT also
     * swap FrontSide/BackSide or the held sheet is culled (looks transparent).
     * Counter-mirror the front map so UV still matches the static left page.
     */
    const frontMap =
      frontTex && mirrored ? mirroredTex(frontTex) : frontTex;
    if (frontSilver && frontMap) {
      this._flipFront.material = silverFlipStockLit(THREE.FrontSide);
      this._flipFrontPrint.material = silverPrintMat(frontMap, {
        side: THREE.FrontSide,
        decal: frontDecal,
        gutter: true,
      });
      this._flipFrontPrint.visible = true;
    } else {
      this._flipFrontPrint.visible = false;
      this._flipFront.material = frontMap
        ? frontVellum
          ? vellumMat(frontMap, frontVellumOp, { gutter: true })
          : pageMat(frontMap, { heavy: frontHeavy, gutter: true, draft: frontDraft, page1: frontPage1 })
        : paperMat();
    }
    if (backSilver && backTex) {
      const backMap = (!mirrored && !backVellum) ? mirroredTex(backTex) : backTex;
      this._flipBack.material = silverFlipStockLit(THREE.BackSide);
      this._flipBackPrint.material = silverPrintMat(backMap, {
        side: THREE.BackSide,
        decal: backDecal,
        gutter: true,
      });
      this._flipBackPrint.visible = true;
    } else {
      this._flipBackPrint.visible = false;
      this._flipBack.material = backTex
        ? pageBackMat(backTex, {
            counterMirror: !mirrored && !backVellum,
            vellum: backVellum,
            silver: false,
            heavy: backHeavy,
            gutter: true,
            draft: backDraft,
            page1: backPage1,
          })
        : paperMat(0xf2f2f2);
      if (backVellum && this._flipBack.material) {
        this._flipBack.material.opacity = backVellumOp;
      }
    }
    this._flipBack.material.polygonOffset = backSilver
      ? true
      : false;
    this._flipFront.material.polygonOffset = frontSilver
      ? true
      : false;
    this._flipFront.material.side = THREE.FrontSide;
    this._flipBack.material.side = THREE.BackSide;
    this._flipFrontTex = frontTex;
    this._flipFrontVellum = frontVellum;
    this._flipBackVellum = backVellum;
    this._flipFrontSilver = frontSilver;
    this._flipBackSilver = backSilver;
    this._flipFrontDecal = frontDecal;
    this._flipBackDecal = backDecal;
    this._flipFrontHeavy = frontHeavy;
    this._flipBackHeavy = backHeavy;
    this._flipFrontDraft = frontDraft;
    this._flipBackDraft = backDraft;
    this._flipFrontPage1 = frontPage1;
    this._flipBackPage1 = backPage1;
    this._flipFrontVellumOp = frontVellumOp;
    this._flipBackVellumOp = backVellumOp;
    this._syncFlapMaterials();
  }

  /**
   * Reflection matrix has det<0, so FrontSide faces the camera on the flap.
   * Stay keeps BackSide for the reverse; flap gets its own FrontSide copy
   * of the NEXT/PREV page so the peel is not a mirror of the current sheet.
   */
  _flapFaceMat(src, key) {
    if (!src) return src;
    /*
     * Reusing one flap material across a draft page and a white page keeps the
     * previous uniforms. Three only runs onBeforeCompile when that material's
     * program key is new, so a later white page would still draw the orange wash.
     * A new sheet variant gets its own material.
     */
    const paperKey = typeof src.customProgramCacheKey === 'function'
      ? src.customProgramCacheKey()
      : '';
    let dst = this[key];
    if (!dst || dst.type !== src.type || dst.userData.paperKey !== paperKey) {
      dst?.dispose();
      dst = src.clone();
      dst.userData = { ...dst.userData, paperKey };
      this[key] = dst;
    } else {
      dst.map = src.map;
      if (src.color && dst.color) dst.color.copy(src.color);
      dst.opacity = src.opacity;
      dst.transparent = src.transparent;
      dst.depthWrite = src.depthWrite;
      dst.depthTest = src.depthTest;
      dst.toneMapped = src.toneMapped;
      dst.blending = src.blending;
      dst.blendSrc = src.blendSrc;
      dst.blendDst = src.blendDst;
      dst.blendEquation = src.blendEquation;
      dst.polygonOffset = src.polygonOffset;
      dst.polygonOffsetFactor = src.polygonOffsetFactor;
      dst.polygonOffsetUnits = src.polygonOffsetUnits;
      if ('metalness' in dst) dst.metalness = src.metalness;
      if ('roughness' in dst) dst.roughness = src.roughness;
      if ('envMapIntensity' in dst) dst.envMapIntensity = src.envMapIntensity;
      if ('envMap' in dst) dst.envMap = src.envMap;
      if ('sheen' in dst) dst.sheen = src.sheen;
      if ('sheenColor' in dst && src.sheenColor) dst.sheenColor.copy(src.sheenColor);
      if ('sheenRoughness' in dst) dst.sheenRoughness = src.sheenRoughness;
      if ('clearcoat' in dst) dst.clearcoat = src.clearcoat;
      if ('clearcoatRoughness' in dst) dst.clearcoatRoughness = src.clearcoatRoughness;
    }
    dst.onBeforeCompile = src.onBeforeCompile;
    dst.customProgramCacheKey = src.customProgramCacheKey;
    dst.userData.gutterFollow = src.userData.gutterFollow;
    dst.side = THREE.FrontSide;
    dst.clippingPlanes = src.clippingPlanes || [];
    dst.clipShadows = false;
    dst.needsUpdate = true;
    return dst;
  }

  _syncFlapMaterials() {
    if (!this._flapFront) return;
    /* Tracing paper: the current print must ride on the flap (transparent).
     * Opaque sheets keep the flap front hidden so the next/prev page shows. */
    if (this._flipFrontVellum) {
      this._flapFront.material = this._flapFaceMat(
        this._flipFront.material,
        '_flapFrontOwn',
      );
      this._flapFront.visible = true;
    } else {
      this._flapFront.visible = false;
    }
    this._flapFrontPrint.visible = false;
    this._flapBack.material = this._flapFaceMat(this._flipBack.material, '_flapBackOwn');
    this._flapBack.visible = true;
    if (this._flipBackPrint.visible) {
      this._flapBackPrint.material = this._flapFaceMat(
        this._flipBackPrint.material,
        '_flapBackPrintOwn',
      );
      this._flapBackPrint.visible = true;
    } else {
      this._flapBackPrint.visible = false;
    }
  }

  _setGutterOverlay(on) {
    if (this.gutterShade) this.gutterShade.visible = on;
    if (this.binding) {
      this.binding.visible = on && STITCH_SPREADS.has(this.spread);
    }
  }

  _applyClipPlanes(mesh, planes) {
    const m = mesh?.material;
    if (!m) return;
    m.clippingPlanes = planes;
    m.clipShadows = false;
    m.needsUpdate = true;
  }

  /**
   * Tracing paper is transparent, so a stay sheet that is not clipped in the
   * peeled triangle shows through the flap as a second copy of the same print.
   * Static left/right stacks sit outside flipGroup (LTR uses scale.x = -1), so
   * they are hidden; the stay is `_flipFront` in the same space as the crease.
   */
  _clearVellumStayClip() {
    const mesh = this._clipStayMesh;
    if (mesh) {
      this._applyClipPlanes(mesh, []);
      this._applyClipPlanes(mesh.userData?.printOverlay, []);
    }
    this._clipStayMesh = null;
  }

  _restoreFlipStayMeshes() {
    this._syncStayVisibility(true);
  }

  /**
   * Stay = unpeeled remainder of the turning leaf. Hide it once the crease
   * sits on the spine — the leftover is a 1px white sliver in the gutter.
   */
  _syncStayVisibility(keepStay) {
    if (this._flipFront) this._flipFront.visible = keepStay;
    if (this._flipFrontPrint) {
      this._flipFrontPrint.visible = keepStay && !!this._flipFrontSilver;
    }
    const hideVellumBack = this._flipDir === 'back' && this._flipFrontVellum;
    if (this._flipBack) this._flipBack.visible = keepStay && !hideVellumBack;
    if (this._flipBackPrint) {
      this._flipBackPrint.visible = keepStay && !!this._flipBackSilver;
    }
  }

  _updatePageBoundClip() {
    const g = this.flipGroup;
    if (!g) return;
    g.updateMatrixWorld(true);
    const set = (plane, nx, ny, px, py) => {
      this._boundTmpN.set(nx, ny, 0).transformDirection(g.matrixWorld).normalize();
      this._boundTmpP.set(px, py, 0).applyMatrix4(g.matrixWorld);
      plane.setFromNormalAndCoplanarPoint(this._boundTmpN, this._boundTmpP);
    };
    const xL = -PAGE_W - GUTTER;
    const xR = PAGE_W;
    const yT = PAGE_H * 0.5;
    const yB = -PAGE_H * 0.5;
    set(this._pageBoundPlanes[0], 1, 0, xL, 0);
    set(this._pageBoundPlanes[1], -1, 0, xR, 0);
    set(this._pageBoundPlanes[2], 0, 1, 0, yB);
    set(this._pageBoundPlanes[3], 0, -1, 0, yT);
  }

  _setFoldClipping(on) {
    const planes = on ? this._foldClip : [];
    const seen = new Set();
    const apply = (mesh) => {
      const m = mesh?.material;
      if (!m || seen.has(m)) return;
      seen.add(m);
      m.clippingPlanes = planes;
      m.clipShadows = false;
      m.needsUpdate = true;
    };
    for (const mesh of this._foldMeshes || []) apply(mesh);
    apply(this._clipStayMesh);
    apply(this._clipStayMesh?.userData?.printOverlay);
    const bounds = on ? this._pageBoundPlanes : [];
    this._applyClipPlanes(
      this._creaseShadow,
      on ? this._foldClipInv.concat(bounds) : [],
    );
  }

  _setPeelShadow(on, nx, ny, mx, my, len) {
    const lift = on
      ? THREE.MathUtils.smoothstep(len, PAGE_W * 0.012, PAGE_W * 0.42)
      : 0;
    const show = on && lift > 0.015;
    applyFlapLight(this._creaseShadow?.material, nx, ny, mx, my, lift);
    const creaseMat = this._creaseShadow?.material;
    if (creaseMat?.userData) {
      const p1 = this._liftedPage1;
      const soft = p1 >= 25 && p1 <= 38 ? 1 : 0;
      creaseMat.userData.edgeSoft = soft;
      const sh = creaseMat.userData.shader;
      if (sh?.uniforms?.uEdgeSoft) sh.uniforms.uEdgeSoft.value = soft;
    }
    if (this._creaseShadow) this._creaseShadow.visible = show;
    applyFlapLight(this._flapShadeMat, nx, ny, mx, my, lift);
    applyFlapLight(this._flapSheenMat, nx, ny, mx, my, lift);
    if (this._flapShade) this._flapShade.visible = show;
    if (this._flapSheen) this._flapSheen.visible = show;
    return lift;
  }

  _resetFlipSheet() {
    resetPageFlip(this.flipGroup, this._flipGeo, this.flapGroup);
    this._setFoldClipping(false);
    this._setPeelShadow(false, 0, 0, 0, 0, 0);
    this._clearVellumStayClip();
    this._liftedPage1 = null;
    this._restoreFlipStayMeshes();
    this._setGutterOverlay(true);
  }

  /**
   * Stay sheet + mirrored flap, both clipped to the crease.
   * GPU clip is a straight line — no grid staircase.
   */
  _applyFoldPose(fingerX, fingerY, cornerY) {
    if (this.flipGroup) {
      this.flipGroup.rotation.y = 0;
      this.flipGroup.position.z = FLIP_Z;
    }
    /* Narrow sheets only travel across the gutter. A vertical finger
     * would tilt the crease and shear the scaled flap. */
    const horizontal = horizontalFlipOnly(this._liftedPage1);
    if (horizontal) fingerY = cornerY;
    const p = constrainFollow(fingerX, fingerY, PAGE_W, PAGE_H, cornerY);
    if (horizontal) p.y = cornerY;
    this._foldFingerX = p.x;
    this._foldFingerY = p.y;
    const dx = p.x - PAGE_W;
    const dy = p.y - cornerY;
    const len = Math.hypot(dx, dy);
    if (!this.flapGroup || len < PAGE_W * 0.004) {
      this._setFoldClipping(false);
      this._setPeelShadow(false, 0, 0, 0, 0, 0);
      if (this.flapGroup) this.flapGroup.visible = false;
      this._syncStayVisibility(true);
      return;
    }
    const nx = dx / len;
    const ny = dy / len;
    const mx = (PAGE_W + p.x) * 0.5;
    const my = (cornerY + p.y) * 0.5;
    this._foldLocalN.set(nx, ny, 0);
    this._foldLocalM.set(mx, my, 0);
    this.flipGroup.updateMatrixWorld(true);
    this._foldWorldN.copy(this._foldLocalN).transformDirection(this.flipGroup.matrixWorld);
    this._foldWorldN.normalize();
    this._foldWorldM.copy(this._foldLocalM).applyMatrix4(this.flipGroup.matrixWorld);
    this._foldPlane.setFromNormalAndCoplanarPoint(this._foldWorldN, this._foldWorldM);
    this._foldPlaneInv.copy(this._foldPlane).negate();
    this._updatePageBoundClip();
    this._setFoldClipping(true);
    setReflectionMatrix(
      this.flapGroup.matrix,
      nx,
      ny,
      mx,
      my,
      this.flipGroup.scale.x,
    );
    this.flapGroup.visible = true;
    this._setPeelShadow(true, nx, ny, mx, my, len);
    /* Crease on the spine → stay collapses to a white gutter hairline */
    this._syncStayVisibility(mx > PAGE_W * 0.04);
  }

  _prepareFlip(dir) {
    const spec = spreadPages(this.spread);
    const nextIndex = dir === 'fwd' ? this.spread + 1 : this.spread - 1;
    const nextSpec = spreadPages(nextIndex);
    if (!spec) return false;

    resetPageFlip(this.flipGroup, this._flipGeo, this.flapGroup);
    this._setFoldClipping?.(false);
    this._setPeelShadow?.(false, 0, 0, 0, 0, 0);
    this._clearVellumStayClip();
    this._restoreFlipStayMeshes();

    let liftedPage1 = null;
    if (dir === 'fwd') {
      if (spec.right == null) return false;
      const frontTex = this._texReadySync(spec.right);
      if (!frontTex) return false;
      liftedPage1 = spec.right + 1;
      const frontVellum = isVellumPage(liftedPage1);
      const frontSilver = !frontVellum && isSilverPage(liftedPage1);
      const backIndex = nextSpec?.left ?? null;
      const backTex = this._texReadySync(backIndex);
      const backPage1 = backIndex != null ? backIndex + 1 : null;
      const backVellum = backPage1 != null && isVellumPage(backPage1);
      const backSilver = backPage1 != null && !backVellum && isSilverPage(backPage1);
      const fwdOpts = {
        frontVellum,
        backVellum,
        frontSilver,
        backSilver,
        frontDecal: frontSilver && isSilverDecalPage(liftedPage1),
        backDecal: backSilver && isSilverDecalPage(backPage1),
        frontHeavy: isHeavyPaperPage(liftedPage1),
        backHeavy: backPage1 == null || isHeavyPaperPage(backPage1),
        frontDraft: isDraftPaperPage(liftedPage1),
        backDraft: backPage1 != null && isDraftPaperPage(backPage1),
        frontPage1: liftedPage1,
        backPage1,
        frontVellumOp: frontVellum ? vellumFlipOpacity(liftedPage1) : VELLUM_OPACITY,
        backVellumOp: backVellum ? vellumFlipOpacity(backPage1) : VELLUM_OPACITY,
      };
      this._setFlipMaterials(frontTex, backTex, false, fwdOpts);
      this.flipGroup.scale.set(pageWidthRatio(liftedPage1), 1, 1);
      this.flipGroup.position.x = this._flipAnchorX('fwd');
      if (this.rightMesh) this.rightMesh.visible = false;
      this._showFlipUnderlay('fwd', liftedPage1);
      if (backIndex != null && !backTex) {
        this._tex(backIndex).then((t) => {
          if (!this.flipGroup.visible) return;
          this._setFlipMaterials(this._flipFrontTex || frontTex, t, false, {
            frontVellum: this._flipFrontVellum,
            backVellum: this._flipBackVellum,
            frontSilver: this._flipFrontSilver,
            backSilver: this._flipBackSilver,
            frontDecal: this._flipFrontDecal,
            backDecal: this._flipBackDecal,
            frontHeavy: this._flipFrontHeavy,
            backHeavy: this._flipBackHeavy,
            frontDraft: this._flipFrontDraft,
            backDraft: this._flipBackDraft,
            frontPage1: this._flipFrontPage1,
            backPage1: this._flipBackPage1,
            frontVellumOp: this._flipFrontVellumOp,
            backVellumOp: this._flipBackVellumOp,
          });
        });
      }
    } else {
      if (spec.left == null) return false;
      const frontTex = this._texReadySync(spec.left);
      if (!frontTex) return false;
      liftedPage1 = spec.left + 1;
      const frontVellum = isVellumPage(liftedPage1);
      const frontSilver = !frontVellum && isSilverPage(liftedPage1);
      const backIndex = nextSpec?.right ?? null;
      const backTex = this._texReadySync(backIndex);
      const backPage1 = backIndex != null ? backIndex + 1 : null;
      const backVellum = backPage1 != null && isVellumPage(backPage1);
      const backSilver = backPage1 != null && !backVellum && isSilverPage(backPage1);
      const backOpts = {
        frontVellum,
        backVellum,
        frontSilver,
        backSilver,
        frontDecal: frontSilver && isSilverDecalPage(liftedPage1),
        backDecal: backSilver && isSilverDecalPage(backPage1),
        frontHeavy: isHeavyPaperPage(liftedPage1),
        backHeavy: backPage1 == null || isHeavyPaperPage(backPage1),
        frontDraft: isDraftPaperPage(liftedPage1),
        backDraft: backPage1 != null && isDraftPaperPage(backPage1),
        frontPage1: liftedPage1,
        backPage1,
        frontVellumOp: frontVellum ? vellumFlipOpacity(liftedPage1) : VELLUM_OPACITY,
        backVellumOp: backVellum ? vellumFlipOpacity(backPage1) : VELLUM_OPACITY,
      };
      this._setFlipMaterials(frontTex, backTex, true, backOpts);
      this.flipGroup.scale.set(-pageWidthRatio(liftedPage1), 1, 1);
      this.flipGroup.position.x = this._flipAnchorX('back');
      if (this.leftMesh) this.leftMesh.visible = false;
      this._showFlipUnderlay('back', liftedPage1);
      if (backIndex != null && !backTex) {
        this._tex(backIndex).then((t) => {
          if (!this.flipGroup.visible) return;
          this._setFlipMaterials(this._flipFrontTex || frontTex, t, true, {
            frontVellum: this._flipFrontVellum,
            backVellum: this._flipBackVellum,
            frontSilver: this._flipFrontSilver,
            backSilver: this._flipBackSilver,
            frontDecal: this._flipFrontDecal,
            backDecal: this._flipBackDecal,
            frontHeavy: this._flipFrontHeavy,
            backHeavy: this._flipBackHeavy,
            frontDraft: this._flipFrontDraft,
            backDraft: this._flipBackDraft,
            frontPage1: this._flipFrontPage1,
            backPage1: this._flipBackPage1,
            frontVellumOp: this._flipFrontVellumOp,
            backVellumOp: this._flipBackVellumOp,
          });
          if (this._flipFrontVellum && this._liftedPage1) {
            this._clipLiftedVellumRecto(this._liftedPage1);
          }
          if (this.flapGroup?.visible) this._setFoldClipping(true);
        });
      }
    }

    this._prefetchSpread(nextIndex);
    this._flipDir = dir;
    this._liftedPage1 = liftedPage1;
    this._applyFoldPose(PAGE_W, this._foldCornerY, this._foldCornerY);
    this.flipGroup.visible = true;
    return true;
  }

  _progressFromPointer(layoutX, layoutY, drag, clientY) {
    const L = this._screenLayout();
    /*
     * Span = reachable travel from this drag's start (not full page size).
     * Using pageW/pageH as span made progress top out ~¾ when the finger
     * hit the screen edge before delta/span reached 1.
     */
    let span = drag.span;
    if (!(span > 0)) {
      span = this._flipSpanForDrag(drag, L);
      drag.span = span;
    }
    let progress;
    if (drag.mobile && clientY != null && drag.startClientY != null) {
      const up = drag.startClientY - clientY;
      const delta = drag.dir === 'fwd' ? up : -up;
      progress = THREE.MathUtils.clamp(delta / span, 0, 1);
    } else if (drag.dir === 'fwd') {
      progress = THREE.MathUtils.clamp((drag.startX - layoutX) / span, 0, 1);
    } else {
      progress = THREE.MathUtils.clamp((layoutX - drag.startX) / span, 0, 1);
    }
    return { progress };
  }

  /** Distance the finger can still travel to finish a full turn from drag start. */
  _flipSpanForDrag(drag, layout) {
    const L = layout || this._screenLayout();
    const pad = 16;
    let span;
    if (drag.mobile) {
      if (drag.dir === 'fwd') {
        /* Swipe up toward top of screen */
        span = Math.max(96, drag.startClientY - pad);
      } else {
        /* Swipe down toward bottom */
        span = Math.max(96, window.innerHeight - drag.startClientY - pad);
      }
    } else if (drag.dir === 'fwd') {
      /* Drag toward far left of the spread */
      const targetX = (L.left?.x ?? 0) + pad;
      span = Math.max(64, drag.startX - targetX);
    } else {
      const targetX = (L.right?.x ?? 0) + (L.right?.w ?? 0) - pad;
      span = Math.max(64, targetX - drag.startX);
    }
    return Math.max(48, span * FLIP_SPAN_SCALE);
  }

  _resetFoldPose() {
    this._foldCornerY = -PAGE_H * 0.28;
    this._foldFollowY = this._foldCornerY;
    this._foldFingerX = PAGE_W;
    this._foldFingerY = this._foldCornerY;
  }

  /** Keep the crease on the same fold model as a held drag (no pose jump). */
  async _animateFold(fromX, fromY, toX, toY, dir) {
    const cy = this._foldCornerY ?? -PAGE_H * 0.28;
    const ms = flipTravelMs(fromX, fromY, toX, toY);
    await tween(
      ms,
      (t) => {
        const p = constrainFollow(
          THREE.MathUtils.lerp(fromX, toX, t),
          THREE.MathUtils.lerp(fromY, toY, t),
          PAGE_W,
          PAGE_H,
          cy,
        );
        this._foldFollowY = p.y;
        this._applyFoldPose(p.x, p.y, cy);
        this._updateStacks(this.spread, followProgress(p.x, PAGE_W), dir);
      },
      easeFlip,
    );
  }

  /** Finger progress 0..1 → fold (scripted turns). */
  _applyFlipVisual(fingerProgress, dir) {
    const cy = this._foldCornerY ?? -PAGE_H * 0.28;
    const t = THREE.MathUtils.clamp(fingerProgress, 0, 1);
    const fx = THREE.MathUtils.lerp(PAGE_W, -PAGE_W, t);
    const fy = THREE.MathUtils.lerp(cy, this._foldFollowY ?? cy, t);
    this._applyFoldPose(fx, fy, cy);
    this._updateStacks(this.spread, t, dir);
  }

  _applyFoldFinger(layoutX, layoutY, dir) {
    const local = this._layoutToPageLocal(layoutX, layoutY, dir);
    const cy = this._foldCornerY ?? -PAGE_H * 0.28;
    const p = constrainFollow(local.x, local.y, PAGE_W, PAGE_H, cy);
    this._foldFollowY = p.y;
    this._applyFoldPose(p.x, p.y, cy);
    const progress = followProgress(p.x, PAGE_W);
    this._updateStacks(this.spread, progress, dir);
    return progress;
  }

  _heatActiveSpread() {
    if (!isNextVolume() || !this.coverOpen || this.flipping) return false;
    const spec = spreadPages(this.spread);
    return spec?.left === 39 && spec?.right === 40;
  }

  _gunActiveSpread() {
    if (!isNextVolume() || !this.coverOpen || this.flipping) return false;
    const spec = spreadPages(this.spread);
    return spec?.left === 41 && spec?.right === 42;
  }

  _heatPlateAt(clientX, clientY) {
    if (!this._heatActiveSpread()) return null;
    const zone = this._pageZone(clientX, clientY);
    if (!zone) return null;
    const state = zone.side === 'left' ? this._heat?.left : this._heat?.right;
    if (!state) return null;
    const box = state.plate;
    const x = ((zone.p.x - zone.rect.x) / Math.max(1, zone.rect.w)) * state.w;
    const y = ((zone.p.y - zone.rect.y) / Math.max(1, zone.rect.h)) * state.h;
    if (x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1) return null;
    const half = box.x1 - box.x0;
    const along = x - box.x0;
    const t = zone.side === 'left' ? along / (half * 2) : (half + along) / (half * 2);
    return { t, zone, state };
  }

  _ensureHeatSide(side, image) {
    const w = image.naturalWidth || image.width;
    const h = image.naturalHeight || image.height;
    if (!w || !h) return null;
    if (!this._heat) this._heat = { hot: false, then: 0 };
    const prev = this._heat[side];
    if (prev && prev.w === w && prev.h === h) return prev;
    const plate = plateBox(side, w, h);
    const gray = document.createElement('canvas');
    gray.width = w;
    gray.height = h;
    const gctx = gray.getContext('2d', { willReadFrequently: true });
    gctx.drawImage(image, 0, 0, w, h);
    const x0 = Math.max(0, Math.floor(plate.x0));
    const y0 = Math.max(0, Math.floor(plate.y0));
    const bw = Math.max(1, Math.min(w - x0, Math.ceil(plate.x1) - x0));
    const bh = Math.max(1, Math.min(h - y0, Math.ceil(plate.y1) - y0));
    const pixels = gctx.getImageData(x0, y0, bw, bh);
    const src = pixels.data;
    for (let i = 0; i < src.length; i += 4) {
      const lum = src[i] * 0.2126 + src[i + 1] * 0.7152 + src[i + 2] * 0.0722;
      src[i] = lum;
      src[i + 1] = lum;
      src[i + 2] = lum;
      src[i + 3] = 255;
    }
    gctx.clearRect(0, 0, w, h);
    gctx.putImageData(pixels, x0, y0);

    const wipeCanvas = document.createElement('canvas');
    wipeCanvas.width = w;
    wipeCanvas.height = h;
    const wipeTex = new THREE.CanvasTexture(wipeCanvas);
    wipeTex.colorSpace = THREE.SRGBColorSpace;
    wipeTex.generateMipmaps = false;
    wipeTex.minFilter = THREE.LinearFilter;
    wipeTex.magFilter = THREE.LinearFilter;
    const wipeMesh = new THREE.Mesh(SHARED_SHEET_GEO, new THREE.MeshBasicMaterial({
      map: wipeTex,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    }));
    wipeMesh.name = `heatWipe-${side}`;
    wipeMesh.frustumCulled = false;
    wipeMesh.visible = false;
    wipeMesh.position.z = 0.00024;
    wipeMesh.renderOrder = 8;

    const heatN = HEAT_RES;
    const heatCanvas = document.createElement('canvas');
    heatCanvas.width = heatN;
    heatCanvas.height = heatN;
    const heatCtx = heatCanvas.getContext('2d', { willReadFrequently: true });
    const heatImg = heatCtx.createImageData(heatN, heatN);
    const heatTex = new THREE.CanvasTexture(heatCanvas);
    heatTex.colorSpace = THREE.SRGBColorSpace;
    heatTex.generateMipmaps = false;
    heatTex.minFilter = THREE.LinearFilter;
    heatTex.magFilter = THREE.LinearFilter;
    const heatMesh = new THREE.Mesh(SHARED_SHEET_GEO, new THREE.MeshBasicMaterial({
      map: heatTex,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    }));
    heatMesh.name = `heatTrail-${side}`;
    heatMesh.frustumCulled = false;
    heatMesh.visible = false;
    heatMesh.position.z = 0.00032;
    heatMesh.renderOrder = 9;

    const state = {
      side, w, h, plate, gray,
      wipeCanvas,
      wipeCtx: wipeCanvas.getContext('2d'),
      wipeTex,
      wipeMesh,
      heatN,
      heat: new Float32Array(heatN * heatN),
      heatCanvas,
      heatCtx,
      heatImg,
      heatTex,
      heatMesh,
      last: null,
    };
    this._heat[side] = state;
    return state;
  }

  _detachHeat(mesh) {
    if (!mesh) return;
    for (const key of ['heatWipe', 'heatTrail']) {
      const child = mesh.userData[key];
      if (child?.parent === mesh) mesh.remove(child);
      mesh.userData[key] = null;
    }
  }

  _mountHeat(spec) {
    const on = isNextVolume() && spec?.left === 39 && spec?.right === 40 && this.leftMesh && this.rightMesh;
    if (!on) {
      this._clearHeatWipe();
      this._detachHeat(this.leftMesh);
      this._detachHeat(this.rightMesh);
      return;
    }
    const leftImg = this.leftMesh.material?.map?.image;
    const rightImg = this.rightMesh.material?.map?.image;
    if (!leftImg || !rightImg) return;
    const left = this._ensureHeatSide('left', leftImg);
    const right = this._ensureHeatSide('right', rightImg);
    if (!left || !right) return;
    const host = (mesh, state) => {
      this._detachHeat(mesh);
      mesh.add(state.wipeMesh);
      mesh.add(state.heatMesh);
      mesh.userData.heatWipe = state.wipeMesh;
      mesh.userData.heatTrail = state.heatMesh;
      state.wipeMesh.renderOrder = (mesh.renderOrder || 4) + 4;
      state.heatMesh.renderOrder = (mesh.renderOrder || 4) + 5;
    };
    host(this.leftMesh, left);
    host(this.rightMesh, right);
    this._clearHeatWipe();
  }

  _clearHeatWipe() {
    const heat = this._heat;
    if (!heat) return;
    for (const state of [heat.left, heat.right]) {
      if (!state) continue;
      state.wipeCtx.clearRect(0, 0, state.w, state.h);
      state.wipeTex.needsUpdate = true;
      state.wipeMesh.visible = false;
    }
  }

  _paintHeatCut(t) {
    const heat = this._heat;
    if (!heat?.left || !heat?.right) return;
    const paint = (state) => {
      const { wipeCtx: ctx, w, h, plate, gray } = state;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      const half = plate.x1 - plate.x0;
      const along = t * half * 2 - (state.side === 'right' ? half : 0);
      const soft = Math.max(12, w * 0.014);
      if (along >= half + soft) {
        state.wipeMesh.visible = false;
        state.wipeTex.needsUpdate = true;
        return;
      }
      ctx.drawImage(gray, 0, 0);
      if (along > -soft) {
        const cut = plate.x0 + along;
        ctx.globalCompositeOperation = 'destination-in';
        const g = ctx.createLinearGradient(cut - soft, 0, cut + soft * 0.4, 0);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
      }
      const showLine = along >= (state.side === 'right' ? 1.5 : 0) && along <= half;
      if (showLine) {
        const x = Math.round(plate.x0 + along);
        ctx.fillStyle = 'rgba(255, 168, 42, 0.45)';
        ctx.fillRect(x - 3, plate.y0, 7, plate.y1 - plate.y0);
        ctx.fillStyle = 'rgba(255, 252, 244, 0.96)';
        ctx.fillRect(x - 1, plate.y0, 2, plate.y1 - plate.y0);
      }
      state.wipeMesh.visible = true;
      state.wipeTex.needsUpdate = true;
    };
    paint(heat.left);
    paint(heat.right);
  }

  _onHeatPlate(state, u, v) {
    const plate = state.plate;
    if (!plate || !state.w || !state.h) return false;
    const x = u * state.w;
    const y = v * state.h;
    return x >= plate.x0 && x <= plate.x1 && y >= plate.y0 && y <= plate.y1;
  }

  _splatHeat(state, x, y, down) {
    const n = state.heatN;
    const buf = state.heat;
    const plate = state.plate;
    const radius = (down ? 0.078 : 0.05) * n;
    const amount = down ? 1.25 : 0.85;
    const sigma = radius * 0.45;
    const x0 = Math.max(0, Math.floor(x - radius));
    const y0 = Math.max(0, Math.floor(y - radius));
    const x1 = Math.min(n - 1, Math.ceil(x + radius));
    const y1 = Math.min(n - 1, Math.ceil(y + radius));
    const inv = 1 / (2 * sigma * sigma);
    for (let py = y0; py <= y1; py += 1) {
      for (let px = x0; px <= x1; px += 1) {
        if (plate && state.w && state.h) {
          const ix = (px / (n - 1)) * state.w;
          const iy = (py / (n - 1)) * state.h;
          if (ix >= plate.x0 && ix <= plate.x1 && iy >= plate.y0 && iy <= plate.y1) continue;
        }
        const d2 = (px - x) * (px - x) + (py - y) * (py - y);
        if (d2 > radius * radius) continue;
        const i = py * n + px;
        buf[i] = Math.min(1.35, buf[i] + amount * Math.exp(-d2 * inv));
      }
    }
    state.heatMesh.visible = true;
    this._heat.hot = true;
    if (!this._heat.then) this._heat.then = performance.now();
  }

  _stampHeat(state, u, v, down) {
    const n = state.heatN;
    const x = u * (n - 1);
    const y = v * (n - 1);
    const last = state.last;
    const jumped = !last || Math.hypot(u - last.u, v - last.v) > 0.2;
    if (jumped) this._splatHeat(state, x, y, down);
    else {
      const dist = Math.hypot(x - last.x, y - last.y);
      const steps = Math.max(1, Math.ceil(dist / 4));
      for (let i = 1; i <= steps; i += 1) {
        const k = i / steps;
        this._splatHeat(state, last.x + (x - last.x) * k, last.y + (y - last.y) * k, false);
      }
      if (down) this._splatHeat(state, x, y, true);
    }
    state.last = { u, v, x, y };
  }

  _uploadHeat(state) {
    const buf = state.heat;
    const d = state.heatImg.data;
    for (let i = 0; i < buf.length; i += 1) {
      const t = buf[i];
      const p = i * 4;
      if (t < 0.012) {
        d[p] = 0;
        d[p + 1] = 0;
        d[p + 2] = 0;
        d[p + 3] = 0;
        continue;
      }
      const ink = heatInk(Math.min(1, t));
      d[p] = ink[0];
      d[p + 1] = ink[1];
      d[p + 2] = ink[2];
      d[p + 3] = ink[3];
    }
    state.heatCtx.putImageData(state.heatImg, 0, 0);
    state.heatTex.needsUpdate = true;
    state.heatMesh.visible = true;
  }

  _prepareGun(spec) {
    const on = isNextVolume() && spec?.left === 41 && spec?.right === 42 && this.leftMesh && this.rightMesh;
    if (!on) {
      this._hideGun();
      return;
    }
    const leftImg = this.leftMesh.material?.map?.image;
    const rightImg = this.rightMesh.material?.map?.image;
    if (leftImg) this._ensureGunPixels('left', leftImg);
    if (rightImg) this._ensureGunPixels('right', rightImg);
  }

  _ensureGunPixels(side, image) {
    const w = image.naturalWidth || image.width;
    const h = image.naturalHeight || image.height;
    if (!w || !h) return null;
    if (!this._gun) this._gun = {};
    const prev = this._gun[side];
    if (prev && prev.w === w && prev.h === h && prev.data) return prev;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, w, h);
    const state = { w, h, data: ctx.getImageData(0, 0, w, h).data };
    this._gun[side] = state;
    return state;
  }

  _sampleGunTemp(zone) {
    const image = (zone.side === 'left' ? this.leftMesh : this.rightMesh)?.material?.map?.image;
    if (!image) return null;
    const state = this._ensureGunPixels(zone.side, image);
    if (!state) return null;
    const px = ((zone.p.x - zone.rect.x) / Math.max(1, zone.rect.w)) * state.w;
    const py = ((zone.p.y - zone.rect.y) / Math.max(1, zone.rect.h)) * state.h;
    const x0 = Math.max(0, Math.floor(px) - 2);
    const y0 = Math.max(0, Math.floor(py) - 2);
    const x1 = Math.min(state.w - 1, Math.floor(px) + 2);
    const y1 = Math.min(state.h - 1, Math.floor(py) + 2);
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const i = (y * state.w + x) * 4;
        r += state.data[i];
        g += state.data[i + 1];
        b += state.data[i + 2];
        n += 1;
      }
    }
    if (!n) return null;
    return thermalCelsius(r / n, g / n, b / n);
  }

  _gunScreenRect() {
    const left = this._contentRect('left');
    const right = this._contentRect('right');
    if (!left && !right) return null;
    const x0 = left ? left.x : right.x;
    const y0 = Math.min(left ? left.y : right.y, right ? right.y : left.y);
    const x1 = right ? right.x + right.w : left.x + left.w;
    const y1 = Math.max(left ? left.y + left.h : 0, right ? right.y + right.h : 0);
    const corners = [
      layoutToClient(this.canvas, x0, y0),
      layoutToClient(this.canvas, x1, y0),
      layoutToClient(this.canvas, x0, y1),
      layoutToClient(this.canvas, x1, y1),
    ];
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
      x: minX,
      y: minY,
      w: Math.max(...xs) - minX,
      h: Math.max(...ys) - minY,
    };
  }

  _ensureGunEl() {
    if (this._gunEl) return this._gunEl;
    const root = document.createElement('div');
    root.className = 'temp-gun';
    root.hidden = true;
    root.innerHTML = '<span class="temp-gun__cross" aria-hidden="true"></span><span class="temp-gun__readout"></span>';
    document.body.appendChild(root);
    this._gunEl = root;
    this._gunCross = root.querySelector('.temp-gun__cross');
    this._gunReadout = root.querySelector('.temp-gun__readout');
    return root;
  }

  _hideGun() {
    if (this._gun) {
      this._gun.live = false;
      this._gun.target = null;
      this._gun.shownTemp = null;
      this._gun.then = 0;
    }
    if (this._gunEl) this._gunEl.hidden = true;
  }

  _placeGun(clientX, clientY, celsius) {
    const rect = this._gunScreenRect();
    if (!rect || rect.w < 8 || rect.h < 8) {
      this._hideGun();
      return;
    }
    const el = this._ensureGunEl();
    const text = `${celsius.toFixed(1)}°C`;
    if (!this._gun) this._gun = {};
    if (this._gun.readout !== text) {
      this._gun.readout = text;
      this._gunReadout.textContent = text;
    }
    el.hidden = false;
    el.style.left = `${rect.x}px`;
    el.style.top = `${rect.y}px`;
    el.style.width = `${rect.w}px`;
    el.style.height = `${rect.h}px`;
    const lx = clientX - rect.x;
    const ly = clientY - rect.y;
    this._gunCross.style.left = `${lx}px`;
    this._gunCross.style.top = `${ly}px`;
    const lw = this._gunReadout.offsetWidth || 64;
    const lh = this._gunReadout.offsetHeight || 14;
    const gap = 16;
    const pad = 4;
    const spots = [
      [lx + gap, ly + 8],
      [lx + gap, ly - 8 - lh],
      [lx - gap - lw, ly + 8],
      [lx - gap - lw, ly - 8 - lh],
    ];
    const fits = (px, py) => px >= pad && py >= pad && px + lw <= rect.w - pad && py + lh <= rect.h - pad;
    const found = spots.find(([px, py]) => fits(px, py));
    const x = found ? found[0] : Math.min(rect.w - lw - pad, Math.max(pad, lx + gap));
    const y = found ? found[1] : Math.min(rect.h - lh - pad, Math.max(pad, ly + 8));
    this._gunReadout.style.left = `${x}px`;
    this._gunReadout.style.top = `${y}px`;
    this._gun.clientX = clientX;
    this._gun.clientY = clientY;
  }

  _gunPointer(e) {
    if (!this._gunActiveSpread()) {
      if (this._gun?.live) this._hideGun();
      return;
    }
    const zone = this._pageZone(e.clientX, e.clientY);
    if (!zone) {
      if (this._gun?.live) {
        this._hideGun();
        this.canvas.style.cursor = '';
      }
      return;
    }
    const temp = this._sampleGunTemp(zone);
    if (temp == null) return;
    if (!this._gun) this._gun = {};
    if (this._gun.shownTemp == null) this._gun.shownTemp = temp;
    this._gun.target = temp;
    this._gun.live = true;
    this._gun.then = this._gun.then || performance.now();
    this._placeGun(e.clientX, e.clientY, this._gun.shownTemp);
    if (this._gunEl && !this._gunEl.hidden) this.canvas.style.cursor = 'none';
  }

  _easeGun() {
    const gun = this._gun;
    if (!gun?.live) return;
    if (this.flipping || this._drag || !this._gunActiveSpread()) {
      this._hideGun();
      return;
    }
    if (gun.target == null || gun.clientX == null) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - (gun.then || now)) / 1000);
    gun.then = now;
    const k = 1 - Math.pow(0.04, dt);
    gun.shownTemp += (gun.target - gun.shownTemp) * k;
    this._placeGun(gun.clientX, gun.clientY, gun.shownTemp);
  }

  _heatPointer(e, down) {
    if (!this._heatActiveSpread()) return;
    const zone = this._pageZone(e.clientX, e.clientY);
    if (!zone) {
      this._clearHeatWipe();
      if (this._heat?.left) this._heat.left.last = null;
      if (this._heat?.right) this._heat.right.last = null;
      return;
    }
    const state = zone.side === 'left' ? this._heat?.left : this._heat?.right;
    if (!state) return;
    const u = (zone.p.x - zone.rect.x) / Math.max(1, zone.rect.w);
    const v = (zone.p.y - zone.rect.y) / Math.max(1, zone.rect.h);
    if (this._onHeatPlate(state, u, v)) state.last = null;
    else this._stampHeat(state, u, v, down);
    const plate = this._heatPlateAt(e.clientX, e.clientY);
    if (plate) this._paintHeatCut(plate.t);
    else this._clearHeatWipe();
  }

  _coolHeat() {
    const heat = this._heat;
    if (!heat?.hot) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - (heat.then || now)) / 1000);
    heat.then = now;
    if (dt <= 0) return;
    const keep = Math.pow(0.32, dt);
    let hot = false;
    for (const state of [heat.left, heat.right]) {
      if (!state) continue;
      const buf = state.heat;
      let max = 0;
      for (let i = 0; i < buf.length; i += 1) {
        const v = buf[i] * keep;
        buf[i] = v > 0.01 ? v : 0;
        if (v > max) max = v;
      }
      if (max < 0.012) {
        state.heatMesh.visible = false;
        continue;
      }
      hot = true;
      this._uploadHeat(state);
    }
    heat.hot = hot;
  }

  _detachDirColor(mesh) {
    const overlay = this._dirColorMesh;
    if (!overlay || overlay.parent !== mesh) return;
    mesh.remove(overlay);
    overlay.visible = false;
  }

  _ensureDirColorMesh(w, h) {
    if (this._dirColorMesh && this._dirColorCanvas?.width === w) return;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.premultiplyAlpha = false;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(SHARED_SHEET_GEO, mat);
    mesh.name = 'dirChartColor';
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.position.z = 0.00022;
    this._dirColorCanvas = canvas;
    this._dirColorCtx = canvas.getContext('2d', { willReadFrequently: true });
    this._dirColorTex = tex;
    this._dirColorMesh = mesh;
    this._dirPixels = this._dirColorCtx.createImageData(w, h);
    this._dirPainted = [];
  }

  _mountDirColor(spec) {
    const page1 = spec?.right != null ? spec.right + 1 : 0;
    if (!isNextVolume() || page1 !== 23 || !this.rightMesh) {
      this._clearDirColors();
      if (this._dirColorMesh?.parent) this._dirColorMesh.parent.remove(this._dirColorMesh);
      return;
    }
    const image = this.rightMesh.material?.map?.image;
    const w = image?.naturalWidth || image?.width;
    const h = image?.naturalHeight || image?.height;
    if (!w || !h) return;
    this._ensureDirColorMesh(w, h);
    if (this._dirColorMesh.parent !== this.rightMesh) this.rightMesh.add(this._dirColorMesh);
    this._dirColorMesh.renderOrder = (this.rightMesh.renderOrder || 4) + 3;
    this._dirColorMesh.visible = false;
    if (!this._dirBars) this._scanDirCharts(image, w, h);
  }

  _scanDirCharts(image, w, h) {
    const ctx = this._dirColorCtx;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(image, 0, 0, w, h);
    let data;
    try {
      data = ctx.getImageData(0, 0, w, h).data;
    } catch (_) {
      this._dirBars = DIR_CHARTS.map((chart) => ({ ...chart, bars: [] }));
      return;
    }
    ctx.clearRect(0, 0, w, h);
    this._dirBars = DIR_CHARTS.map((chart) => ({
      ...chart,
      bars: scanDirBars(data, w, h, chart),
    }));
    this._dirPixels = ctx.createImageData(w, h);
    this._dirPainted = [];
  }

  _dirHotspotAt(clientX, clientY) {
    if (!isNextVolume() || !this.coverOpen || this.flipping || !this._dirBars) return null;
    const spec = spreadPages(this.spread);
    if (spec?.right == null || spec.right + 1 !== 23) return null;
    const zone = this._pageZone(clientX, clientY);
    if (!zone || zone.side !== 'right') return null;
    const u = (zone.p.x - zone.rect.x) / Math.max(1, zone.rect.w);
    const v = (zone.p.y - zone.rect.y) / Math.max(1, zone.rect.h);
    return this._dirBars.find((chart) => u >= chart.u0 && u <= chart.u1 && v >= chart.v0 && v <= chart.v1) || null;
  }

  _clearDirColors() {
    const pixels = this._dirPixels;
    const painted = this._dirPainted;
    if (!pixels || !painted?.length) {
      this._dirActiveId = null;
      if (this._dirColorMesh) this._dirColorMesh.visible = false;
      return;
    }
    const d = pixels.data;
    for (let i = 0; i < painted.length; i += 1) {
      const p = painted[i];
      d[p] = 0;
      d[p + 1] = 0;
      d[p + 2] = 0;
      d[p + 3] = 0;
    }
    painted.length = 0;
    this._dirColorCtx.putImageData(pixels, 0, 0);
    if (this._dirColorTex) this._dirColorTex.needsUpdate = true;
    this._dirActiveId = null;
    if (this._dirColorMesh) this._dirColorMesh.visible = false;
  }

  _showDirColors(chart) {
    if (!chart?.bars?.length || !this._dirPixels) return;
    this._clearDirColors();
    const d = this._dirPixels.data;
    const painted = this._dirPainted;
    const base = Math.random();
    chart.bars.forEach((bar, i) => {
      const hue = (base + i * 0.61803398875) % 1;
      const [r, g, b] = hslToRgb(hue, 0.9, 0.54 + (i % 3) * 0.06);
      const index = bar.index;
      const alpha = bar.alpha;
      for (let k = 0; k < index.length; k += 1) {
        const p = index[k] * 4;
        d[p] = r;
        d[p + 1] = g;
        d[p + 2] = b;
        d[p + 3] = alpha[k];
        painted.push(p);
      }
    });
    this._dirColorCtx.putImageData(this._dirPixels, 0, 0);
    this._dirColorTex.needsUpdate = true;
    this._dirActiveId = chart.id;
    if (this._dirColorMesh) this._dirColorMesh.visible = true;
  }

  _hoverDirChart(clientX, clientY) {
    if (this._dirPress) return;
    const hot = this._dirHotspotAt(clientX, clientY);
    if (!hot) {
      if (this._dirActiveId) this._clearDirColors();
      return;
    }
    if (hot.id !== this._dirActiveId) this._showDirColors(hot);
  }

  /**
   * The strip of a longer sheet showing past a short page.
   * Right edges step out toward later sections; the left edge is 024.
   */
  _edgeJumpAt(clientX, clientY) {
    if (!isNextVolume() || !this.coverOpen || this.flipping) return null;
    const p = clientToCanvasLayout(this.canvas, clientX, clientY);
    const L = this._screenLayout();
    const pick = (side) => {
      const full = side === 'right' ? L.right : L.left;
      const top = this._contentRect(side);
      const unders = side === 'right' ? this._rightUnder : this._leftUnder;
      if (!full || !top || !(full.w > 0) || !unders?.length) return null;
      if (p.y < full.y || p.y > full.y + full.h) return null;
      if (p.x < full.x || p.x > full.x + full.w) return null;
      if (p.x >= top.x && p.x <= top.x + top.w) return null;
      const u = (p.x - full.x) / full.w;
      let best = null;
      for (const mesh of unders) {
        const page1 = mesh.userData?.page1;
        const spread = EDGE_JUMP_SPREAD[page1];
        if (spread == null) continue;
        const ratio = pageWidthRatio(page1);
        const covers = side === 'right' ? u <= ratio + 0.006 : u >= 1 - ratio - 0.006;
        if (!covers) continue;
        if (!best || ratio < best.ratio) best = { page1, spread, ratio };
      }
      if (!best || best.spread === this.spread) return null;
      return best;
    };
    return pick('right') || pick('left');
  }

  _onPointerDown(e) {
    this._stopKeyHold();
    if (this.coverOpen && !this.flipping) this._heatPointer(e, true);
    if (!this.coverOpen || this.flipping) return;
    /* Ignore secondary finger — pinch-to-close is handled by BookViewer */
    if (e.isPrimary === false) return;
    if (e.button != null && e.button !== 0) return;
    const chart = this._dirHotspotAt(e.clientX, e.clientY);
    if (chart) {
      e.preventDefault();
      this._dirPress = {
        id: chart.id,
        spread: chart.spread,
        x: e.clientX,
        y: e.clientY,
        pointerId: e.pointerId,
      };
      if (this._dirActiveId !== chart.id) this._showDirColors(chart);
      this.canvas.setPointerCapture?.(e.pointerId);
      this.canvas.style.cursor = 'pointer';
      return;
    }
    const edgeJump = this._edgeJumpAt(e.clientX, e.clientY);
    if (edgeJump) {
      e.preventDefault();
      this._edgeJumpPress = {
        spread: edgeJump.spread,
        x: e.clientX,
        y: e.clientY,
        pointerId: e.pointerId,
      };
      this.canvas.setPointerCapture?.(e.pointerId);
      this.canvas.style.cursor = 'pointer';
      return;
    }
    /* Upright portrait: native pan only — swipe-to-flip fights horizontal scroll */
    if (isPortraitPanMode()) return;

    const mobile = isMobileReaderRotated();
    const edge = this._hitTestEdge(e.clientX, e.clientY);
    if (edge) {
      e.preventDefault();
      const p = clientToCanvasLayout(this.canvas, e.clientX, e.clientY);
      this._foldCornerY = edge.cornerY;
      this._foldFollowY = edge.cornerY;
      this._edgeTap = {
        dir: edge.dir,
        pageWidthPx: edge.pageWidthPx,
        mobile,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: p.x,
        startY: p.y,
        cornerY: edge.cornerY,
      };
      this.canvas.setPointerCapture?.(e.pointerId);
      this.canvas.style.cursor = 'pointer';
      return;
    }

    if (mobile) {
      const soft = this._hitTestSpread(e.clientX, e.clientY);
      if (!soft || (!soft.canFwd && !soft.canBack)) return;
      e.preventDefault();
      const p = clientToCanvasLayout(this.canvas, e.clientX, e.clientY);
      this._drag = {
        dir: null,
        ready: false,
        mobile: true,
        canFwd: soft.canFwd,
        canBack: soft.canBack,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: p.x,
        startY: p.y,
        progress: 0,
        pageWidthPx: soft.pageWidthPx,
        lastX: p.x,
        lastY: p.y,
      };
      this._dragPending = null;
      this.canvas.setPointerCapture?.(e.pointerId);
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    /* Desktop: outer half of each page starts a turn (gutter half is inert). */
  }

  /** 088–089 is the film gate: a drag must not peel into the video.
   *  017–020 can be held again; the crease stays horizontal. */
  _holdFlipBlocked() {
    return this._isFilmGate();
  }

  /** NEXT 088–089. Forward leaves this spread into the helmet film. */
  _isFilmGate() {
    if (!isNextVolume()) return false;
    const spec = spreadPages(this.spread);
    return spec?.left === 87 && spec?.right === 88;
  }

  _promoteEdgeTapToDrag() {
    const tap = this._edgeTap;
    if (!tap) return false;
    if (!this._prepareFlip(tap.dir)) {
      this._edgeTap = null;
      this.canvas.style.cursor = '';
      return false;
    }
    this._foldCornerY = tap.cornerY ?? this._foldCornerY;
    this._foldFollowY = this._foldCornerY;
    const horizontal = horizontalFlipOnly(this._liftedPage1);
    this._drag = {
      dir: tap.dir,
      pageWidthPx: tap.pageWidthPx,
      mobile: !!tap.mobile,
      follow: !tap.mobile && !horizontal,
      startClientX: tap.startClientX,
      startClientY: tap.startClientY,
      startX: tap.startX,
      startY: tap.startY,
      progress: 0,
      ready: true,
      lastX: tap.startX,
      lastY: tap.startY,
      cornerY: this._foldCornerY,
    };
    this._drag.span = this._flipSpanForDrag(this._drag);
    this._dragPending = null;
    this._edgeTap = null;
    this.canvas.style.cursor = 'grabbing';
    this._applyFlipVisual(0, tap.dir);
    return true;
  }

  _onPointerMove(e) {
    if (this.flipping) {
      this._hideGun();
      return;
    }
    if (!this._drag && !this._dirPress && !this._edgeJumpPress) this._heatPointer(e, false);
    if (this._drag || this._dirPress || this._edgeJumpPress) this._hideGun();
    else this._gunPointer(e);

    if (this._dirPress) {
      const hot = this._dirHotspotAt(e.clientX, e.clientY);
      if (hot && hot.id !== this._dirActiveId) this._showDirColors(hot);
      else if (!hot && this._dirActiveId) this._clearDirColors();
      return;
    }

    if (this._edgeJumpPress) return;

    if (this._edgeTap && !this._drag) {
      const dx = e.clientX - this._edgeTap.startClientX;
      const dy = e.clientY - this._edgeTap.startClientY;
      if (Math.hypot(dx, dy) < TAP_SLOP) return;
      if (this._holdFlipBlocked(this._edgeTap.dir)) {
        this._edgeTap.holdBlocked = true;
        return;
      }
      if (!this._promoteEdgeTapToDrag()) return;
    }

    if (!this._drag) {
      this._hoverDirChart(e.clientX, e.clientY);
      if (!isPortraitPanMode()) this._updateHoverCursor(e);
      return;
    }
    this._hideGun();

    if (this._drag.mobile && !this._drag.ready) {
      const dy = this._drag.startClientY - e.clientY; /* up + */
      const dx = e.clientX - this._drag.startClientX;
      if (Math.hypot(dx, dy) < 10) return;
      /* Screen up → next, screen down → previous */
      const dir = dy > 0 ? 'fwd' : 'back';
      if (dir === 'fwd' && !this._drag.canFwd) {
        this.cancelPointer();
        return;
      }
      if (dir === 'back' && !this._drag.canBack) {
        this.cancelPointer();
        return;
      }
      if (this._holdFlipBlocked(dir)) {
        this.cancelPointer();
        return;
      }
      if (!this._prepareFlip(dir)) {
        this.cancelPointer();
        return;
      }
      this._drag.dir = dir;
      this._drag.ready = true;
      this._drag.follow = false;
      const startLocal = this._layoutToPageLocal(
        this._drag.startX,
        this._drag.startY,
        dir,
      );
      this._foldCornerY = THREE.MathUtils.clamp(startLocal.y, -PAGE_H * 0.5, PAGE_H * 0.5);
      this._foldFollowY = this._foldCornerY;
      this._drag.span = this._flipSpanForDrag(this._drag);
      this._applyFlipVisual(0, dir);
    }

    if (!this._drag.ready) return;

    const p = clientToCanvasLayout(this.canvas, e.clientX, e.clientY);
    this._drag.lastX = p.x;
    this._drag.lastY = p.y;
    if (this._drag.follow) {
      this._drag.progress = this._applyFoldFinger(p.x, p.y, this._drag.dir);
      this._dragPending = null;
      return;
    }
    const { progress } = this._progressFromPointer(
      p.x,
      p.y,
      this._drag,
      e.clientY,
    );
    this._drag.progress = progress;
    this._dragPending = { progress, dir: this._drag.dir };
  }

  async _onPointerUp(e) {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') this._hideGun();
    if (this._edgeJumpPress) {
      const press = this._edgeJumpPress;
      this._edgeJumpPress = null;
      this.canvas.releasePointerCapture?.(press.pointerId);
      const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
      const hot = this._edgeJumpAt(e.clientX, e.clientY);
      if (moved <= TAP_SLOP && hot && hot.spread === press.spread) {
        await this.goToSpread(press.spread);
        return;
      }
      this._updateHoverCursor(e);
      return;
    }
    if (this._dirPress) {
      const press = this._dirPress;
      this._dirPress = null;
      try { this.canvas.releasePointerCapture?.(press.pointerId); } catch (_) { /* synthetic pointers are not captured */ }
      const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
      const hot = this._dirHotspotAt(e.clientX, e.clientY);
      if (moved <= TAP_SLOP && hot && hot.id === press.id) {
        this._clearDirColors();
        await this._flipToSpread(press.spread);
        return;
      }
      this._hoverDirChart(e.clientX, e.clientY);
      this._updateHoverCursor(e);
      return;
    }
    if (this._edgeTap) {
      const tap = this._edgeTap;
      const pointerId = tap.pointerId;
      this._edgeTap = null;
      this.canvas.releasePointerCapture?.(pointerId);
      this._updateHoverCursor(e);
      if (tap.holdBlocked) {
        this.canvas.style.cursor = '';
        return;
      }
      if (tap.dir === 'fwd') await this.next();
      else await this.prev();
      return;
    }
    if (!this._drag) return;
    await this._finishDrag(e.pointerId, false);
    this._updateHoverCursor(e);
  }

  async _finishDrag(pointerId, forcedCommit) {
    const drag = this._drag;
    if (!drag) return;
    this._drag = null;
    this._dragPending = null;
    this.canvas.releasePointerCapture?.(pointerId);
    this.canvas.style.cursor = '';

    if (!drag.ready || this.flipping) {
      this.flipGroup.visible = false;
      this._resetFlipSheet();
      if (this.leftMesh) this.leftMesh.visible = true;
      if (this.rightMesh) this.rightMesh.visible = true;
      this._clearFlipUnder();
      this._resetFoldPose();
      return;
    }

    /* Paint the last dragged pose before land / cancel */
    if (drag.follow && drag.lastX != null) {
      drag.progress = this._applyFoldFinger(drag.lastX, drag.lastY, drag.dir);
    } else {
      this._applyFlipVisual(drag.progress, drag.dir);
    }

    if (forcedCommit || drag.progress >= COMMIT_THRESHOLD) {
      await this._commitFlip(drag.dir, drag.progress);
    } else {
      await this._cancelFlip(drag.progress, drag.dir);
    }
  }

  async _cancelFlip(fromProgress, dir = 'fwd') {
    this.flipping = true;
    const cy = this._foldCornerY ?? -PAGE_H * 0.28;
    const fromX =
      this._foldFingerX ?? THREE.MathUtils.lerp(PAGE_W, -PAGE_W, fromProgress);
    const fromY = this._foldFingerY ?? cy;
    await this._animateFold(fromX, fromY, PAGE_W, cy, dir);
    this.flipGroup.visible = false;
    this.flipGroup.scale.x = 1;
    this._resetFlipSheet();
    if (this.leftMesh) this.leftMesh.visible = true;
    if (this.rightMesh) this.rightMesh.visible = true;
    this._clearFlipUnder();
    this._updateStacks(this.spread);
    this._resetFoldPose();
    this.flipping = false;
  }

  /** Animated full turn — keyboard, tap, and drag-release commit. */
  async _commitFlip(dir, fromProgress = 0) {
    this.flipping = true;
    const nextSpread = dir === 'fwd' ? this.spread + 1 : this.spread - 1;
    const prefetch = this._ensureSpreadTextures(nextSpread);
    const cy = this._foldCornerY ?? -PAGE_H * 0.28;
    const fromX =
      this._foldFingerX ?? THREE.MathUtils.lerp(PAGE_W, -PAGE_W, fromProgress);
    const fromY = this._foldFingerY ?? this._foldFollowY ?? cy;
    const toY = this._foldFollowY ?? cy;

    await Promise.all([
      this._animateFold(fromX, fromY, -PAGE_W, toY, dir),
      prefetch,
    ]);

    this.spread = nextSpread;
    this._installSpreadSync(nextSpread);
    this.flipGroup.visible = false;
    this.flipGroup.scale.x = 1;
    this._resetFlipSheet();
    this._clearFlipUnder();
    this._resetFoldPose();
    this.flipping = false;

    queueMicrotask(() => this._prefetchNeighbors(nextSpread));
  }

  async next() {
    if (this.flipping || this._drag || this._filmLock || this.spread >= SPREAD_COUNT - 1) return;
    if (this._isFilmGate() && typeof this.onFilmGate === 'function') {
      this._stopKeyHold();
      this._filmLock = true;
      this.onFilmGate();
      return;
    }
    if (!this._prepareFlip('fwd')) return;
    await this._commitFlip('fwd', 0);
  }

  async prev() {
    if (this.flipping || this._drag || this._filmLock || this.spread <= 0) return;
    if (!this._prepareFlip('back')) return;
    await this._commitFlip('back', 0);
  }

  setFilmLock(on) {
    this._filmLock = !!on;
  }

  filmLocked() {
    return !!this._filmLock;
  }

  async goToSpread(spreadIndex) {
    const target = THREE.MathUtils.clamp(spreadIndex, 0, SPREAD_COUNT - 1);
    if (target === this.spread || this.flipping) return;
    this.flipping = true;
    this.spread = target;
    await this._loadSpread(this.spread);
    this.flipping = false;
  }

  /** Turn one spread at a time until `spreadIndex`, using the normal peel. */
  async _flipToSpread(spreadIndex) {
    const target = THREE.MathUtils.clamp(spreadIndex | 0, 0, SPREAD_COUNT - 1);
    if (target === this.spread || this.flipping || this._drag) return;
    this._stopKeyHold();
    this.flipping = true;
    const dir = target > this.spread ? 'fwd' : 'back';
    try {
      while (this.spread !== target) {
        const step = dir === 'fwd' ? this.spread + 1 : this.spread - 1;
        await this._ensureSpreadTextures(step);
        this.flipping = false;
        if (dir === 'fwd') await this.next();
        else await this.prev();
        this.flipping = true;
        if (this.spread !== step) break;
      }
    } finally {
      this.flipping = false;
    }
  }

  getSpread() {
    return this.spread;
  }

  tick() {
    this._layout = null;
    this._coolHeat();
    this._easeGun();
    if (!this._dragPending || !this._drag) return;
    const pending = this._dragPending;
    this._dragPending = null;
    if (pending.follow) {
      this._drag.progress = this._applyFoldFinger(pending.x, pending.y, pending.dir);
      return;
    }
    this._applyFlipVisual(pending.progress, pending.dir);
  }

  resize() {
    if (!this.coverOpen) return;
    this._fitCamera();
  }

  hide() {
    this.group.visible = false;
    this.unbindControls();
  }

  show() {
    this.group.visible = true;
  }

  dispose() {
    this.unbindControls();
    this._clearPages();
    this.scene.remove(this.group);
    this.texCache.clear();
    this.texReady.clear();
    this._pmrem?.dispose();
    this._pmrem = null;
  }
}

export { PAGE_W, PAGE_H, SPREAD_COUNT };
