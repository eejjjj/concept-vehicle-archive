/**
 * EMAX · 3D 平铺阅读器
 * 锁线装订中缝 · 拖拽跟随卷曲翻页 · 硫酸纸叠层 · 160p spread
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  pageUrl,
  liningUrl,
  spreadPages,
  SPREAD_COUNT,
  isVellumPage,
  isSilverPage,
  isSilverDecalPage,
  vellumStackFrom,
  vellumLeftStackFrom,
} from './book-pages.js?v=p13';

const PAGE_W = 1.05;
const PAGE_H = 1.05;
const GUTTER = 0.0008;
/** Overlay valley — in front of static sheets, behind the curling flip sheet */
const GUTTER_SHADE_Z = 0.0058;
const FLIP_Z = 0.0086;
const FLIP_ORDER = 12;
/** Curl mesh — denser silhouette, still light enough for drag */
const SEG_X = 48;
const SEG_Y = 16;
const FLIP_MS = 16.7;
/** Match OS-style hold: first page immediately, then this delay, then interval */
export const HOLD_DELAY = 400;
export const HOLD_INTERVAL = 32;
const COMMIT_THRESHOLD = 0.8;
/** Drag distance scale — <1 shortens the swipe needed for a full turn */
const FLIP_SPAN_SCALE = 0.75;
/** Each page is 3 columns: outer tap-turn · mid/gutter grab */
const PAGE_ZONE = 1 / 3;
const TAP_SLOP = 10;
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

/**
 * Light paper stock: very slight cool grey wash + fibre grain. No yellow.
 * Listed black spreads use a slightly heavier wash.
 */
const PAPER_TINT = new THREE.Color(0xe2e3e6);
const PAPER_GRAIN = 0.012;
const PAPER_GRAY = 0.04;
const PAPER_GRAIN_HEAVY = 0.014;
const PAPER_GRAY_HEAVY = 0.05;
const PAPER_LIFT_HEAVY = 0.005;
/** 1-based: both endpapers + listed black pages */
const HEAVY_PAPER_PAGES = new Set([
  11, 12, 13, 50, 51, 52, 53, 74, 75, 78, 79, 84, 85, 101, 106, 107, 108, 109,
  118, 120, 121, 126, 131, 134, 135, 137, 146, 147, 148, 149, 150, 151,
]);

function isHeavyPaperPage(page1) {
  return page1 != null && HEAVY_PAPER_PAGES.has(page1);
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

function patchPaperMaterial(mat, { heavy = false, gutter = true } = {}) {
  const gray = heavy ? PAPER_GRAY_HEAVY : PAPER_GRAY;
  const grain = heavy ? PAPER_GRAIN_HEAVY : PAPER_GRAIN;
  const lift = heavy ? PAPER_LIFT_HEAVY : 0;
  mat.toneMapped = false;
  mat.customProgramCacheKey = () =>
    `${heavy ? 'emax-paper-print-v10h3' : 'emax-paper-print-v10'}${gutter ? '' : '-ng'}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPaperTint = { value: PAPER_TINT };
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
	float speckle = fract(sin(dot(vMapUv * vec2(480.0, 480.0), vec2(12.9898, 78.233))) * 43758.5453);
	float fibre = fract(sin(dot(vMapUv * vec2(28.0, 720.0), vec2(39.346, 11.135))) * 23421.631);
	float grainN = (speckle * 0.55 + fibre * 0.45) - 0.5;
	printRgb *= 1.0 - grainN * uPaperGrain;
	float dark = 1.0 - smoothstep(0.0, 0.16, lum);
	printRgb += vec3(uPaperLift * dark);
	printRgb += vec3(grainN * uPaperLift * 0.7 * dark);
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

function patchVellumMaterial(mat) {
  mat.toneMapped = false;
  mat.customProgramCacheKey = () => 'emax-vellum-warm-v2';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPaperTint = { value: VELLUM_TINT };
    shader.uniforms.uInkFloor = { value: VELLUM_INK };
    shader.uniforms.uPaperGrain = { value: VELLUM_GRAIN };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
#include <common>
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

/** Unlit silver for the curling sheet — Physical + curl = a white specular streak. */
const _silverFlipStock = { front: null, back: null };
function silverFlipStockMat(side = THREE.FrontSide) {
  const key = side === THREE.BackSide ? 'back' : 'front';
  if (!_silverFlipStock[key]) {
    _silverFlipStock[key] = new THREE.MeshBasicMaterial({
      color: 0xc2c4c8,
      toneMapped: false,
      side,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
  }
  return _silverFlipStock[key];
}

/** Print overlay on silver stock. Multiply for ink fields; Normal for PNG decals (white stays white). */
function silverPrintMat(tex, { side = THREE.FrontSide, decal = false } = {}) {
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
  return new THREE.MeshBasicMaterial(mat);
}

function pageMat(tex, { silver = false, heavy = false, gutter = true } = {}) {
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
  return patchPaperMaterial(mat, { heavy, gutter });
}

function pageBackMat(tex, { counterMirror = true, vellum = false, silver = false, heavy = false, gutter = true } = {}) {
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
  return vellum ? patchVellumMaterial(mat) : patchPaperMaterial(mat, { heavy, gutter });
}

/** Match the resting top-sheet opacity of that vellum pile. */
function vellumFlipOpacity(page1) {
  const stack = vellumStackFrom(page1) || vellumLeftStackFrom(page1);
  if (!stack) return VELLUM_OPACITY;
  return stack.length > 3 ? 0.4 : 0.52;
}

function vellumMat(tex, opacity = VELLUM_OPACITY) {
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
    }),
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
  const geo = new THREE.PlaneGeometry(pageW, pageH, SEG_X, SEG_Y);
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
    shadow.renderOrder = 3;
    group.add(shadow);

    const dash = new THREE.Mesh(geo, threadMat);
    dash.position.set(0, y, 0.00135);
    dash.renderOrder = 4;
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
    depthTest: true,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.026, PAGE_H * 0.998), mat);
  mesh.position.set(0, 0, GUTTER_SHADE_Z);
  mesh.renderOrder = 7;
  return mesh;
}

/**
 * Finger travel 0..1 → curl parameter.
 * Compensates hinge foreshortening so free-edge X stays ~linear with the finger
 * (plain angle*=π feels fast early / dead late past ~80%).
 */
function fingerToCurlProgress(finger) {
  const f = THREE.MathUtils.clamp(finger, 0, 1);
  return Math.acos(THREE.MathUtils.clamp(1 - 2 * f, -1, 1)) / Math.PI;
}

/**
 * Unified large page curl (no top/bottom corner bias).
 * `progress` is curl parameter 0..1 (≈ turn angle / π).
 */
function applyCurl(geometry, progress, pageW) {
  const pos = geometry.attributes.position;
  if (!geometry.userData.basePositions) {
    geometry.userData.basePositions = Float32Array.from(pos.array);
  }
  const src = geometry.userData.basePositions;
  const arr = pos.array;
  const e = THREE.MathUtils.clamp(progress, 0, 1);
  const angle = e * Math.PI;
  /* Gentler radius shrink — late phase stays readable with the finger */
  const radius = THREE.MathUtils.lerp(pageW * 0.3, pageW * 0.11, e);
  const count = pos.count;
  const sinA = Math.sin(angle);
  const cosA = Math.cos(angle);
  const zMax = pageW * 0.045;
  const inset = 1 - 0.012 * Math.sin(e * Math.PI);

  for (let i = 0, i3 = 0; i < count; i += 1, i3 += 3) {
    const bx = src[i3];
    const by = src[i3 + 1];

    if (angle < 1e-5) {
      arr[i3] = bx;
      arr[i3 + 1] = by;
      arr[i3 + 2] = 0;
      continue;
    }

    const R = radius;
    const arc = angle * R;
    let x;
    let z;
    if (bx <= arc) {
      const phi = bx / Math.max(1e-6, R);
      x = R * Math.sin(phi);
      z = R * (1 - Math.cos(phi));
    } else {
      const rem = bx - arc;
      x = R * sinA + rem * cosA;
      z = R * (1 - cosA) + rem * sinA;
    }

    arr[i3] = x * inset;
    arr[i3 + 1] = by;
    arr[i3 + 2] = Math.min(z * 0.28, zMax);
  }

  pos.needsUpdate = true;
  /* Keep rest-pose normals — Physical silver otherwise flashes white on curl */
}

/** Curl sheet + keep flipGroup unrotated (curl owns the turn). */
function applyPageFlip(flipGroup, geometry, progress) {
  if (flipGroup) {
    flipGroup.rotation.y = 0;
    flipGroup.position.z = FLIP_Z;
  }
  applyCurl(geometry, progress, PAGE_W);
}

function resetPageFlip(flipGroup, geometry) {
  resetCurl(geometry);
  if (!flipGroup) return;
  flipGroup.rotation.y = 0;
  flipGroup.position.z = FLIP_Z;
}

function easeFlip(t) {
  /* ease-out quint — used by button / tap flips only */
  const u = 1 - t;
  return 1 - u * u * u * u * u;
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
  constructor({ scene, camera, renderer, canvas, envMap, coverTex, onSpreadChange }) {
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
    this._flipFront = new THREE.Mesh(this._flipGeo, paperMat());
    this._flipFront.renderOrder = FLIP_ORDER;
    this._flipFrontPrint = new THREE.Mesh(this._flipGeo, paperMat());
    this._flipFrontPrint.visible = false;
    this._flipFrontPrint.frustumCulled = false;
    this._flipFrontPrint.renderOrder = FLIP_ORDER + 1;
    this._flipFront.add(this._flipFrontPrint);
    this._flipBack = new THREE.Mesh(this._flipGeo, paperMat(0xf2f2f2));
    this._flipBack.material.side = THREE.BackSide;
    this._flipBack.renderOrder = FLIP_ORDER;
    this._flipBackPrint = new THREE.Mesh(this._flipGeo, paperMat(0xf2f2f2));
    this._flipBackPrint.visible = false;
    this._flipBackPrint.frustumCulled = false;
    this._flipBackPrint.renderOrder = FLIP_ORDER + 1;
    this._flipBack.add(this._flipBackPrint);

    this.flipGroup = new THREE.Group();
    this.flipGroup.add(this._flipFront);
    this.flipGroup.add(this._flipBack);
    this.flipGroup.visible = false;
    this.flipGroup.position.z = FLIP_Z;
    this.flipGroup.renderOrder = FLIP_ORDER;
    g.add(this.flipGroup);

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
      applyClosedBookShellLook(gltf.scene, this.envMap);
      this.caseShell = fitOpenSpreadModel(gltf.scene);
      this.caseShell.traverse((obj) => {
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
    this.caseGroup.add(this.leftStack);
    this.caseGroup.add(this.rightStack);

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
      const leftStack = vellumLeftStackFrom(spec.left + 1);
      if (leftStack) leftStack.forEach((p1) => jobs.push(this._tex(p1 - 1)));
    }
    if (spec.right != null) {
      jobs.push(this._tex(spec.right));
      const stack = vellumStackFrom(spec.right + 1);
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
      const rightStack = vellumStackFrom(p1);
      const leftStack = vellumLeftStackFrom(p1);
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
    for (const m of this._flipUnder) {
      m.visible = false;
      this._meshPool.push(m);
      this.group.remove(m);
    }
    this._flipUnder = [];
    for (const m of this._flipUnderHidden) {
      m.visible = true;
    }
    this._flipUnderHidden = [];
  }

  _clearPages() {
    this._clearFlipUnder();
    for (const m of this._pageMeshes) {
      m.visible = false;
      if (m.geometry && m.geometry !== SHARED_SHEET_GEO) {
        m.geometry.dispose();
      }
      this._meshPool.push(m);
      this.group.remove(m);
    }
    this._pageMeshes = [];
    this.leftMesh = null;
    this.rightMesh = null;
    this._rightUnder = [];
    this._leftUnder = [];
  }

  _acquireSheet(mat, x, z, order, printMat = null) {
    let mesh = this._meshPool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(SHARED_SHEET_GEO, mat);
    } else {
      mesh.material = mat;
      mesh.visible = true;
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
    const key = `${page1}|${mirror ? 1 : 0}|${opacity == null ? 'solid' : opacity.toFixed(3)}|${silver ? 'ag10' : 'p'}`;
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
    else mat = pageMat(face, { heavy: isHeavyPaperPage(page1) });

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
      const mirror = mirrorVellum && !isBase && isVellumPage(p1);
      const opacity = isBase
        ? null
        : THREE.MathUtils.lerp(botOp, topOp, 1 - i / vellumCount);
      const mats = !srcTex
        ? paperMat(isBase ? 0xf2f2f2 : 0xe8e8e8)
        : this._matForPage(p1, srcTex, { opacity, mirror });
      const mesh = this._sheetFromPageMat(
        mats,
        xCenter,
        0.0003 + (n - 1 - i) * 0.0007,
        4 + (n - 1 - i),
      );
      mesh.userData.page1 = p1;
      mesh.userData.mirrored = mirror;
      mesh.visible = true;
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
    const stack = vellumStackFrom(page1);

    if (!stack) {
      const tex = this._texReadySync(pageIndex0);
      if (!tex) return null;
      const mats = this._matForPage(page1, tex);
      const mesh = this._sheetFromPageMat(mats, x, 0.0004, 4);
      mesh.userData.page1 = page1;
      return mesh;
    }

    const { top, under } = this._buildStackMeshesSync(stack, x);
    this._rightUnder = under;
    return top;
  }

  /** Left-side stack: e.g. 026…022 — vellum sheets mirrored (seen from back)；null = 前环衬 */
  _buildLeftStackSync(pageIndex0) {
    const x = this._leftX();
    if (pageIndex0 == null) return this._buildLiningSheet(x);

    const page1 = pageIndex0 + 1;
    const stack = vellumLeftStackFrom(page1);

    if (!stack) {
      const srcTex = this._texReadySync(pageIndex0);
      if (!srcTex) return null;
      const mirror = isVellumPage(page1);
      const mats = this._matForPage(page1, srcTex, { mirror });
      const mesh = this._sheetFromPageMat(mats, x, 0.0004, 4);
      mesh.userData.page1 = page1;
      mesh.userData.mirrored = mirror;
      return mesh;
    }

    const { top, under } = this._buildStackMeshesSync(stack, x, { mirrorVellum: true });
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

    for (const m of retiring) {
      if (!m || this._pageMeshes.includes(m)) continue;
      m.visible = false;
      this.group.remove(m);
      this._meshPool.push(m);
    }

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
   * While flipping page P, show P±2 underneath immediately (no black void).
   * Vellum piles already have the remaining sheets — keep them, do not
   * swap in a clearer P±2 stack.
   */
  _showFlipUnderlay(dir, liftedPage1) {
    this._clearFlipUnder();

    const inVellum =
      dir === 'fwd' ? vellumStackFrom(liftedPage1) : vellumLeftStackFrom(liftedPage1);
    if (inVellum) return;

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
    const stack =
      dir === 'fwd'
        ? vellumStackFrom(under1) || [under1]
        : vellumLeftStackFrom(under1) || [under1];

    this._prefetchPages(stack);

    const n = stack.length;
    for (let i = n - 1; i >= 0; i -= 1) {
      const p1 = stack[i];
      const isBase = i === n - 1;
      const tex = this._texReadySync(p1 - 1);
      const opacity = isBase
        ? null
        : THREE.MathUtils.lerp(0.38, 0.58, 1 - i / Math.max(1, n - 1));
      const mirror = mirrorLeft && !isBase && isVellumPage(p1);
      const matOrPair = tex
        ? this._matForPage(p1, tex, { opacity, mirror })
        : paperMat(0x1a1a1a);
      const stock = matOrPair.print ? matOrPair.stock : matOrPair;
      const printMat = matOrPair.print || null;
      const mesh = this._meshPool.pop() || new THREE.Mesh(SHARED_SHEET_GEO, stock);
      mesh.material = stock;
      mesh.visible = true;
      mesh.position.set(x, 0, 0.0003 + (n - 1 - i) * 0.00045);
      mesh.renderOrder = 3 + (n - 1 - i);
      mesh.userData.page1 = p1;
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
   * Left page: outer | mid | gutter (spine)
   * Right page: gutter (spine) | mid | outer
   */
  _pageZone(clientX, clientY) {
    if (!this.coverOpen || this.flipping) return null;
    const p = clientToCanvasLayout(this.canvas, clientX, clientY);
    const L = this._screenLayout();
    const inRect = (r) =>
      r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    let side = null;
    let rect = null;
    if (inRect(L.left)) {
      side = 'left';
      rect = L.left;
    } else if (inRect(L.right)) {
      side = 'right';
      rect = L.right;
    }
    if (!side || !rect) return null;
    const t = (p.x - rect.x) / Math.max(1, rect.w);
    let col;
    if (side === 'left') {
      col = t < PAGE_ZONE ? 'outer' : t < PAGE_ZONE * 2 ? 'mid' : 'gutter';
    } else {
      col = t > 1 - PAGE_ZONE ? 'outer' : t > PAGE_ZONE ? 'mid' : 'gutter';
    }
    return { side, col, rect, p };
  }

  _hitTest(clientX, clientY) {
    if (!this.coverOpen || this.flipping) return null;
    const p = clientToCanvasLayout(this.canvas, clientX, clientY);
    const L = this._screenLayout();
    const inRect = (r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    const spec = spreadPages(this.spread);
    if (inRect(L.right) && spec?.right != null && this.spread < SPREAD_COUNT - 1) {
      return { dir: 'fwd', pageWidthPx: L.right.w };
    }
    if (inRect(L.left) && spec?.left != null && this.spread > 0) {
      return { dir: 'back', pageWidthPx: L.left.w };
    }
    return null;
  }

  _hitTestEdge(clientX, clientY) {
    if (!this.coverOpen || this.flipping) return null;
    const zone = this._pageZone(clientX, clientY);
    if (!zone || zone.col !== 'outer') return null;
    const spec = spreadPages(this.spread);
    if (
      zone.side === 'right' &&
      spec?.right != null &&
      this.spread < SPREAD_COUNT - 1
    ) {
      return { dir: 'fwd', pageWidthPx: zone.rect.w };
    }
    if (zone.side === 'left' && spec?.left != null && this.spread > 0) {
      return { dir: 'back', pageWidthPx: zone.rect.w };
    }
    return null;
  }

  _updateHoverCursor(e) {
    if (!this.coverOpen || this.flipping || this._drag || this._edgeTap) return;
    if (this._hitTestEdge(e.clientX, e.clientY)) {
      this.canvas.style.cursor = 'pointer';
      return;
    }
    const zone = this._pageZone(e.clientX, e.clientY);
    this.canvas.style.cursor = zone ? 'grab' : '';
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
    let onLeft = inRect(L.left);
    let onRight = inRect(L.right);

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
      resetPageFlip(this.flipGroup, this._flipGeo);
      this.flipGroup.visible = false;
      this.flipGroup.scale.x = 1;
    }
    if (this.leftMesh) this.leftMesh.visible = true;
    if (this.rightMesh) this.rightMesh.visible = true;
    this._clearFlipUnder?.();
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
      this._flipFront.material = silverFlipStockMat(THREE.FrontSide);
      this._flipFrontPrint.material = silverPrintMat(frontMap, {
        side: THREE.FrontSide,
        decal: frontDecal,
      });
      this._flipFrontPrint.visible = true;
    } else {
      this._flipFrontPrint.visible = false;
      this._flipFront.material = frontMap
        ? frontVellum
          ? vellumMat(frontMap, frontVellumOp)
          : pageMat(frontMap, { heavy: frontHeavy, gutter: false })
        : paperMat();
    }
    if (backSilver && backTex) {
      const backMap = (!mirrored && !backVellum) ? mirroredTex(backTex) : backTex;
      this._flipBack.material = silverFlipStockMat(THREE.BackSide);
      this._flipBackPrint.material = silverPrintMat(backMap, {
        side: THREE.BackSide,
        decal: backDecal,
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
            gutter: false,
          })
        : paperMat(0xf2f2f2);
      if (backVellum && this._flipBack.material) {
        this._flipBack.material.opacity = backVellumOp;
      }
    }
    this._flipBack.material.polygonOffset = false;
    this._flipFront.material.polygonOffset = false;
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
    this._flipFrontVellumOp = frontVellumOp;
    this._flipBackVellumOp = backVellumOp;
  }

  _prepareFlip(dir) {
    const spec = spreadPages(this.spread);
    const nextIndex = dir === 'fwd' ? this.spread + 1 : this.spread - 1;
    const nextSpec = spreadPages(nextIndex);
    if (!spec) return false;

    resetPageFlip(this.flipGroup, this._flipGeo);

    if (dir === 'fwd') {
      if (spec.right == null) return false;
      const frontTex = this._texReadySync(spec.right);
      if (!frontTex) return false;
      const liftedPage1 = spec.right + 1;
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
        frontVellumOp: frontVellum ? vellumFlipOpacity(liftedPage1) : VELLUM_OPACITY,
        backVellumOp: backVellum ? vellumFlipOpacity(backPage1) : VELLUM_OPACITY,
      };
      this._setFlipMaterials(frontTex, backTex, false, fwdOpts);
      this.flipGroup.scale.x = 1;
      this.flipGroup.position.x = 0;
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
            frontVellumOp: this._flipFrontVellumOp,
            backVellumOp: this._flipBackVellumOp,
          });
        });
      }
    } else {
      if (spec.left == null) return false;
      const frontTex = this._texReadySync(spec.left);
      if (!frontTex) return false;
      const liftedPage1 = spec.left + 1;
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
        frontVellumOp: frontVellum ? vellumFlipOpacity(liftedPage1) : VELLUM_OPACITY,
        backVellumOp: backVellum ? vellumFlipOpacity(backPage1) : VELLUM_OPACITY,
      };
      this._setFlipMaterials(frontTex, backTex, true, backOpts);
      this.flipGroup.scale.x = -1;
      this.flipGroup.position.x = 0;
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
            frontVellumOp: this._flipFrontVellumOp,
            backVellumOp: this._flipBackVellumOp,
          });
        });
      }
    }

    this._prefetchSpread(nextIndex);
    this._flipDir = dir;
    applyPageFlip(this.flipGroup, this._flipGeo, 0);
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

  /** Finger progress → curl + stack (edge speed stays even with the finger). */
  _applyFlipVisual(fingerProgress, dir) {
    const curl = fingerToCurlProgress(fingerProgress);
    applyPageFlip(this.flipGroup, this._flipGeo, curl);
    this._updateStacks(this.spread, fingerProgress, dir);
  }

  _onPointerDown(e) {
    this._stopKeyHold();
    if (!this.coverOpen || this.flipping) return;
    /* Ignore secondary finger — pinch-to-close is handled by BookViewer */
    if (e.isPrimary === false) return;
    if (e.button != null && e.button !== 0) return;
    /* Upright portrait: native pan only — swipe-to-flip fights horizontal scroll */
    if (isPortraitPanMode()) return;

    const mobile = isMobileReaderRotated();
    const edge = this._hitTestEdge(e.clientX, e.clientY);
    if (edge) {
      e.preventDefault();
      const p = clientToCanvasLayout(this.canvas, e.clientX, e.clientY);
      this._edgeTap = {
        dir: edge.dir,
        pageWidthPx: edge.pageWidthPx,
        mobile,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: p.x,
        startY: p.y,
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

    const hit = this._hitTest(e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    if (!this._prepareFlip(hit.dir)) return;

    const p = clientToCanvasLayout(this.canvas, e.clientX, e.clientY);
    this._drag = {
      ...hit,
      mobile: false,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: p.x,
      startY: p.y,
      progress: 0,
      ready: true,
      lastX: p.x,
      lastY: p.y,
    };
    this._drag.span = this._flipSpanForDrag(this._drag);
    this._dragPending = null;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.canvas.style.cursor = 'grabbing';
    this._applyFlipVisual(0, hit.dir);
  }

  _promoteEdgeTapToDrag() {
    const tap = this._edgeTap;
    if (!tap) return false;
    if (!this._prepareFlip(tap.dir)) {
      this._edgeTap = null;
      this.canvas.style.cursor = '';
      return false;
    }
    this._drag = {
      dir: tap.dir,
      pageWidthPx: tap.pageWidthPx,
      mobile: !!tap.mobile,
      startClientX: tap.startClientX,
      startClientY: tap.startClientY,
      startX: tap.startX,
      startY: tap.startY,
      progress: 0,
      ready: true,
      lastX: tap.startX,
      lastY: tap.startY,
    };
    this._drag.span = this._flipSpanForDrag(this._drag);
    this._dragPending = null;
    this._edgeTap = null;
    this.canvas.style.cursor = 'grabbing';
    this._applyFlipVisual(0, tap.dir);
    return true;
  }

  _onPointerMove(e) {
    if (this.flipping) return;

    if (this._edgeTap && !this._drag) {
      const dx = e.clientX - this._edgeTap.startClientX;
      const dy = e.clientY - this._edgeTap.startClientY;
      if (Math.hypot(dx, dy) < TAP_SLOP) return;
      if (!this._promoteEdgeTapToDrag()) return;
    }

    if (!this._drag) {
      if (!isPortraitPanMode()) this._updateHoverCursor(e);
      return;
    }

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
      if (!this._prepareFlip(dir)) {
        this.cancelPointer();
        return;
      }
      this._drag.dir = dir;
      this._drag.ready = true;
      this._drag.span = this._flipSpanForDrag(this._drag);
      this._applyFlipVisual(0, dir);
    }

    if (!this._drag.ready) return;

    const p = clientToCanvasLayout(this.canvas, e.clientX, e.clientY);
    this._drag.lastX = p.x;
    this._drag.lastY = p.y;
    const { progress } = this._progressFromPointer(
      p.x,
      p.y,
      this._drag,
      e.clientY,
    );
    this._drag.progress = progress;
    /* Coalesce to one curl update per render frame */
    this._dragPending = { progress, dir: this._drag.dir };
  }

  async _onPointerUp(e) {
    if (this._edgeTap) {
      const dir = this._edgeTap.dir;
      const pointerId = this._edgeTap.pointerId;
      this._edgeTap = null;
      this.canvas.releasePointerCapture?.(pointerId);
      this._updateHoverCursor(e);
      if (dir === 'fwd') await this.next();
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
      resetPageFlip(this.flipGroup, this._flipGeo);
      this.flipGroup.visible = false;
      if (this.leftMesh) this.leftMesh.visible = true;
      if (this.rightMesh) this.rightMesh.visible = true;
      this._clearFlipUnder();
      return;
    }

    /* Paint the last dragged pose before land / cancel */
    this._applyFlipVisual(drag.progress, drag.dir);

    if (forcedCommit || drag.progress >= COMMIT_THRESHOLD) {
      await this._landFlip(drag.dir, drag.progress);
    } else {
      await this._cancelFlip(drag.progress, drag.dir);
    }
  }

  async _cancelFlip(fromProgress, dir = 'fwd') {
    this.flipping = true;
    await tween(
      Math.max(FLIP_MS * 0.5, FLIP_MS * fromProgress * 0.45),
      (t) => {
        this._applyFlipVisual(fromProgress * (1 - t), dir);
      },
      easeLinear,
    );
    resetPageFlip(this.flipGroup, this._flipGeo);
    this.flipGroup.visible = false;
    this.flipGroup.scale.x = 1;
    if (this.leftMesh) this.leftMesh.visible = true;
    if (this.rightMesh) this.rightMesh.visible = true;
    this._clearFlipUnder();
    this._updateStacks(this.spread);
    this.flipping = false;
  }

  /**
   * Instant land after drag commit — no settle tween.
   */
  async _landFlip(dir, fromProgress = 1) {
    this.flipping = true;
    const nextSpread = dir === 'fwd' ? this.spread + 1 : this.spread - 1;
    this._applyFlipVisual(1, dir);
    await this._ensureSpreadTextures(nextSpread);
    this.spread = nextSpread;
    this._installSpreadSync(nextSpread);
    resetPageFlip(this.flipGroup, this._flipGeo);
    this.flipGroup.visible = false;
    this.flipGroup.scale.x = 1;
    this._clearFlipUnder();
    this.flipping = false;
    queueMicrotask(() => this._prefetchNeighbors(nextSpread));
  }

  /** Animated full turn — used by next()/prev() taps only. */
  async _commitFlip(dir, fromProgress = 0) {
    this.flipping = true;
    const nextSpread = dir === 'fwd' ? this.spread + 1 : this.spread - 1;
    const prefetch = this._ensureSpreadTextures(nextSpread);
    const remain = Math.max(0, 1 - fromProgress);
    const ms = FLIP_MS * Math.max(remain, 0.2);

    await Promise.all([
      tween(
        ms,
        (t) => {
          this._applyFlipVisual(fromProgress + remain * t, dir);
        },
        easeFlip,
      ),
      prefetch,
    ]);

    this.spread = nextSpread;
    this._installSpreadSync(nextSpread);
    resetPageFlip(this.flipGroup, this._flipGeo);
    this.flipGroup.visible = false;
    this.flipGroup.scale.x = 1;
    this._clearFlipUnder();
    this.flipping = false;

    queueMicrotask(() => this._prefetchNeighbors(nextSpread));
  }

  async next() {
    if (this.flipping || this._drag || this.spread >= SPREAD_COUNT - 1) return;
    if (!this._prepareFlip('fwd')) return;
    await this._commitFlip('fwd', 0);
  }

  async prev() {
    if (this.flipping || this._drag || this.spread <= 0) return;
    if (!this._prepareFlip('back')) return;
    await this._commitFlip('back', 0);
  }

  async goToSpread(spreadIndex) {
    const target = THREE.MathUtils.clamp(spreadIndex, 0, SPREAD_COUNT - 1);
    if (target === this.spread || this.flipping) return;
    this.flipping = true;
    this.spread = target;
    await this._loadSpread(this.spread);
    this.flipping = false;
  }

  getSpread() {
    return this.spread;
  }

  tick() {
    this._layout = null;
    if (!this._dragPending || !this._drag) return;
    const { progress, dir } = this._dragPending;
    this._dragPending = null;
    this._applyFlipVisual(progress, dir);
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
