/**
 * EMAX · 3D 平铺阅读器
 * 锁线装订中缝 · 拖拽跟随卷曲翻页 · 硫酸纸叠层 · 160p spread
 */
import * as THREE from 'three';
import {
  pageUrl,
  spreadPages,
  SPREAD_COUNT,
  isVellumPage,
  vellumStackFrom,
  vellumLeftStackFrom,
} from './book-pages.js';

const PAGE_W = 1.05;
const PAGE_H = 1.05;
const GUTTER = 0.0008;
/** Curl mesh — keep light for 60fps drag on retina */
const SEG_X = 28;
const SEG_Y = 14;
const FLIP_MS = 560;
const COMMIT_THRESHOLD = 0.28;
const STITCH_COUNT = 14;
const VIEW_FIT = 1.14;
const VELLUM_OPACITY = 0.5;

/** Mobile reading: stage CSS-rotated 90° CW — use layout size, not AABB */
function isMobileReaderRotated() {
  return (
    window.matchMedia('(max-width: 900px)').matches &&
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
 * Print-on-paper look:
 * - Whites land on warm stock (not pure #fff)
 * - Blacks lift off scene #000 so ink ≠ background void
 * - Soft grain for fibre / press texture
 */
const PAPER_TINT = new THREE.Color(0xe4e0d8);
const INK_FLOOR = new THREE.Color(0x2c2a26);
const PAPER_GRAIN = 0.04;

function patchPaperMaterial(mat) {
  mat.toneMapped = false;
  mat.customProgramCacheKey = () => 'emax-paper-print-v1';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPaperTint = { value: PAPER_TINT };
    shader.uniforms.uInkFloor = { value: INK_FLOOR };
    shader.uniforms.uPaperGrain = { value: PAPER_GRAIN };
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
	/* Remap print: #000 → warm ink floor (above scene black), #fff → paper stock */
	vec3 printRgb = mix( uInkFloor, uPaperTint, sampledDiffuseColor.rgb );
	/* Soft fibre grain — stable in UV space */
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

function pageMat(tex) {
  return patchPaperMaterial(
    new THREE.MeshBasicMaterial({
      map: tex,
      color: 0xffffff,
      toneMapped: false,
      side: THREE.FrontSide,
    }),
  );
}

function pageBackMat(tex, { counterMirror = true, vellum = false } = {}) {
  return patchPaperMaterial(
    new THREE.MeshBasicMaterial({
      map: counterMirror ? mirroredTex(tex) : tex,
      color: 0xffffff,
      toneMapped: false,
      transparent: vellum,
      opacity: vellum ? VELLUM_OPACITY : 1,
      depthWrite: !vellum,
      side: THREE.BackSide,
    }),
  );
}

function vellumMat(tex, opacity = VELLUM_OPACITY) {
  return patchPaperMaterial(
    new THREE.MeshBasicMaterial({
      map: tex,
      color: 0xffffff,
      transparent: true,
      opacity,
      depthWrite: false,
      toneMapped: false,
      side: THREE.FrontSide,
    }),
  );
}

/** Shared static sheet geo — never dispose per-spread */
const SHARED_SHEET_GEO = new THREE.PlaneGeometry(PAGE_W, PAGE_H);

function loadTex(loader, url) {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        tex.generateMipmaps = false;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
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
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.x = -1;
  t.offset.x = 1;
  t.needsUpdate = true;
  tex.userData.mirroredClone = t;
  return t;
}

function paperMat(color = 0xf4f0e8) {
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

function makePageGeo(pageW, pageH) {
  const geo = new THREE.PlaneGeometry(pageW, pageH, SEG_X, SEG_Y);
  geo.translate(pageW / 2, 0, 0);
  geo.userData.basePositions = Float32Array.from(geo.attributes.position.array);
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

/**
 * Rolling-cylinder curl — continuous field, soft cone toward grab corner.
 * Normals skipped: flip sheets use MeshBasicMaterial.
 */
function applyCurl(geometry, progress, pageW, pivotY = 0) {
  const pos = geometry.attributes.position;
  if (!geometry.userData.basePositions) {
    geometry.userData.basePositions = Float32Array.from(pos.array);
  }
  const src = geometry.userData.basePositions;
  const arr = pos.array;
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  const e = p * p * p * (p * (p * 6 - 15) + 10);
  const angle = e * Math.PI;
  const radius = THREE.MathUtils.lerp(pageW * 0.58, pageW * 0.12, e * e);
  const invH = 1 / PAGE_H;
  const count = pos.count;
  const sinA = Math.sin(angle);
  const cosA = Math.cos(angle);
  const floatAmp = Math.sin(e * Math.PI) * pageW * 0.018;

  for (let i = 0, i3 = 0; i < count; i += 1, i3 += 3) {
    const bx = src[i3];
    const by = src[i3 + 1];
    const cy = (by - pivotY) * invH;
    const cone = 1 - 0.18 * (1 - e) * cy * cy;
    const a = angle * cone;

    if (a < 1e-5) {
      arr[i3] = bx;
      arr[i3 + 1] = by;
      arr[i3 + 2] = 0;
      continue;
    }

    const R = radius;
    const arc = a * R;
    let x;
    let z;
    if (bx <= arc) {
      const phi = bx / Math.max(1e-6, R);
      x = R * Math.sin(phi);
      z = R * (1 - Math.cos(phi));
    } else {
      /* Use full-angle basis when cone≈1 (common); else local a */
      if (cone > 0.985) {
        const rem = bx - arc;
        x = R * sinA + rem * cosA;
        z = R * (1 - cosA) + rem * sinA;
      } else {
        const rem = bx - arc;
        const sa = Math.sin(a);
        const ca = Math.cos(a);
        x = R * sa + rem * ca;
        z = R * (1 - ca) + rem * sa;
      }
    }

    arr[i3] = x;
    arr[i3 + 1] = by;
    arr[i3 + 2] = z + floatAmp * (bx / pageW);
  }

  pos.needsUpdate = true;
}

function easeFlip(t) {
  /* ease-out quint — settles cleanly without a late hitch feel */
  const u = 1 - t;
  return 1 - u * u * u * u * u;
}

function tween(ms, fn, ease = easeFlip) {
  return new Promise((resolve) => {
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

function buildBinding() {
  const group = new THREE.Group();
  const threadMat = new THREE.MeshBasicMaterial({
    color: 0xf7f4ee,
    toneMapped: false,
    depthWrite: false,
  });
  const step = PAGE_H / (STITCH_COUNT + 1);
  for (let i = 1; i <= STITCH_COUNT; i += 1) {
    const y = -PAGE_H * 0.5 + step * i;
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.0008, 0.0065, 0.001), threadMat);
    dash.position.set(0, y, 0.0012);
    dash.renderOrder = 3;
    group.add(dash);
  }
  return group;
}

function buildGutterShade() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 4;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.38, 'rgba(0,0,0,0.06)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.2)');
  g.addColorStop(0.62, 'rgba(0,0,0,0.06)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 4);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;

  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.07, PAGE_H * 0.998), mat);
  mesh.position.set(0, 0, 0.0007);
  mesh.renderOrder = 2;
  return mesh;
}

/** Soft radial blob cast onto the destination page during a flip */
function buildFlipShadow() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.34)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.14)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);

  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;

  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PAGE_W * 0.92, PAGE_H * 0.92), mat);
  mesh.visible = false;
  mesh.renderOrder = 1;
  return mesh;
}

export class BookReader {
  constructor({ scene, camera, renderer, canvas, envMap, coverTex, onSpreadChange }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.canvas = canvas;
    this.envMap = envMap;
    this.coverTex = coverTex;
    this.onSpreadChange = onSpreadChange || (() => {});

    this.loader = new THREE.TextureLoader();
    this.texCache = new Map();
    this.texReady = new Map();
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
    /** Mobile: wait for horizontal swipe before choosing flip dir */
    this._swipeArm = null;
    this._layout = null;
    this._flipGeo = null;
    this._flipFront = null;
    this._flipBack = null;
    this.flipShadow = null;

    this._onKey = this._onKey.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._controlsBound = false;
  }

  async init() {
    this._buildScene();
    this.scene.add(this.group);
    await this._loadSpread(this.spread);
  }

  _buildScene() {
    const g = this.group;
    g.add(new THREE.AmbientLight(0xffffff, 0.35));

    this.binding = buildBinding();
    g.add(this.binding);
    this.gutterShade = buildGutterShade();
    g.add(this.gutterShade);

    this.flipShadow = buildFlipShadow();
    g.add(this.flipShadow);

    this._flipGeo = makePageGeo(PAGE_W, PAGE_H);
    this._flipFront = new THREE.Mesh(this._flipGeo, paperMat());
    this._flipBack = new THREE.Mesh(this._flipGeo, paperMat(0xeeeae2));
    this._flipBack.material.side = THREE.BackSide;

    this.flipGroup = new THREE.Group();
    this.flipGroup.add(this._flipFront);
    this.flipGroup.add(this._flipBack);
    this.flipGroup.visible = false;
    this.flipGroup.position.z = 0.0025;
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

  _acquireSheet(mat, x, z, order) {
    let mesh = this._meshPool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(SHARED_SHEET_GEO, mat);
    } else {
      mesh.material = mat;
      mesh.visible = true;
    }
    mesh.position.set(x, 0, z);
    mesh.renderOrder = order;
    this.group.add(mesh);
    this._pageMeshes.push(mesh);
    return mesh;
  }

  _trackPage(mesh) {
    /* sheets should go through _acquireSheet; keep for cover lining path */
    this._pageMeshes.push(mesh);
    this.group.add(mesh);
    return mesh;
  }

  _matForPage(page1, tex, { opacity = null, mirror = false } = {}) {
    const face = mirror ? mirroredTex(tex) : tex;
    if (opacity != null) return vellumMat(face, opacity);
    if (isVellumPage(page1)) return vellumMat(face);
    return pageMat(tex);
  }

  async _makePageFace(pageIndex0, opacity = null) {
    const tex = this._texReadySync(pageIndex0) || (await this._tex(pageIndex0));
    return this._matForPage(pageIndex0 + 1, tex, { opacity });
  }

  /**
   * Build a vertical stack of sheets (top→bottom page list).
   * Sync — textures must already be ready.
   */
  _buildStackMeshesSync(stack, xCenter, opts = {}) {
    const mirrorVellum = !!opts.mirrorVellum;
    const n = stack.length;
    let top = null;
    const under = [];
    for (let i = n - 1; i >= 0; i -= 1) {
      const p1 = stack[i];
      const isBase = i === n - 1;
      const isTop = i === 0;
      const srcTex = this._texReadySync(p1 - 1);
      if (!srcTex) continue;
      const mirror = mirrorVellum && !isBase && isVellumPage(p1);
      const opacity = isBase
        ? null
        : THREE.MathUtils.lerp(0.38, 0.58, 1 - i / Math.max(1, n - 1));
      const mat = isBase
        ? pageMat(srcTex)
        : this._matForPage(p1, srcTex, { opacity, mirror });
      const mesh = this._acquireSheet(
        mat,
        xCenter,
        0.0003 + (n - 1 - i) * 0.00045,
        4 + (n - 1 - i),
      );
      mesh.userData.page1 = p1;
      mesh.userData.mirrored = mirror;
      if (isTop) top = mesh;
      else under.push(mesh);
    }
    return { top, under };
  }

  /** Right-side stack: e.g. 023…027 */
  _buildRightStackSync(pageIndex0) {
    const page1 = pageIndex0 + 1;
    const stack = vellumStackFrom(page1);
    const x = this._rightX();

    if (!stack) {
      const tex = this._texReadySync(pageIndex0);
      if (!tex) return null;
      const mat = this._matForPage(page1, tex);
      const mesh = this._acquireSheet(mat, x, 0.0004, 4);
      mesh.userData.page1 = page1;
      return mesh;
    }

    const { top, under } = this._buildStackMeshesSync(stack, x);
    this._rightUnder = under;
    return top;
  }

  /** Left-side stack: e.g. 026…022 — vellum sheets mirrored (seen from back) */
  _buildLeftStackSync(pageIndex0) {
    const x = this._leftX();
    if (pageIndex0 == null) {
      const lining = patchPaperMaterial(
        new THREE.MeshBasicMaterial({
          map: this.coverTex,
          color: 0xffffff,
          toneMapped: false,
        }),
      );
      const mesh = this._acquireSheet(lining, x, 0.0004, 4);
      return mesh;
    }

    const page1 = pageIndex0 + 1;
    const stack = vellumLeftStackFrom(page1);

    if (!stack) {
      const srcTex = this._texReadySync(pageIndex0);
      if (!srcTex) return null;
      const mirror = isVellumPage(page1);
      const mat = this._matForPage(page1, srcTex, { mirror });
      const mesh = this._acquireSheet(mat, x, 0.0004, 4);
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
  _installSpread(spreadIndex) {
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
    if (spec.right != null) {
      this.rightMesh = this._buildRightStackSync(spec.right);
    }

    for (const m of retiring) {
      if (!m || this._pageMeshes.includes(m)) continue;
      m.visible = false;
      this.group.remove(m);
      this._meshPool.push(m);
    }

    this.onSpreadChange(spreadIndex, spec);
  }

  async _loadSpread(spreadIndex) {
    const spec = spreadPages(spreadIndex);
    if (!spec) return;

    await this._ensureSpreadTextures(spreadIndex);
    this._installSpread(spreadIndex);
    this._prefetchNeighbors(spreadIndex);
  }

  /**
   * While flipping page P, show P±2 underneath immediately (no black void).
   * Sync only — uses cached textures; missing pages get a paper placeholder.
   * fwd: P+2 on the right; back: P-2 on the left.
   */
  _showFlipUnderlay(dir, liftedPage1) {
    this._clearFlipUnder();

    const under1 = dir === 'fwd' ? liftedPage1 + 2 : liftedPage1 - 2;
    if (under1 < 1 || under1 > 160) return;

    const permanent = dir === 'fwd' ? this._rightUnder : this._leftUnder;
    for (const m of permanent) {
      m.visible = false;
      this._flipUnderHidden.push(m);
    }

    const x = dir === 'fwd' ? this._rightX() : this._leftX();
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
      const mat = tex
        ? isBase
          ? pageMat(tex)
          : this._matForPage(p1, tex, { opacity, mirror })
        : paperMat(0x1a1a1a);
      const mesh = this._meshPool.pop() || new THREE.Mesh(SHARED_SHEET_GEO, mat);
      mesh.material = mat;
      mesh.visible = true;
      mesh.position.set(x, 0, 0.0003 + (n - 1 - i) * 0.00045);
      mesh.renderOrder = 3 + (n - 1 - i);
      mesh.userData.page1 = p1;
      this.group.add(mesh);
      this._flipUnder.push(mesh);
    }
  }

  _fitCamera() {
    const { w, h } = canvasLayoutSize(this.canvas);
    const aspect = Math.max(0.2, w / Math.max(1, h));
    this.camera.aspect = aspect;
    this.camera.fov = 34;
    this.camera.updateProjectionMatrix();
    const spreadW = PAGE_W * 2 + GUTTER;
    const dist =
      (spreadW / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)) * aspect)) *
      VIEW_FIT;
    this.camera.position.set(0, 0.015, dist);
    this.camera.lookAt(0, 0, 0);
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

  _hitTest(clientX, clientY) {
    if (!this.coverOpen || this.flipping) return null;
    const p = clientToCanvasLayout(this.canvas, clientX, clientY);
    const L = this._screenLayout();
    const inRect = (r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    const spec = spreadPages(this.spread);
    if (inRect(L.right) && spec?.right != null && this.spread < SPREAD_COUNT - 1) {
      const cy = (p.y - L.right.y) / Math.max(1, L.right.h);
      const pivotY = THREE.MathUtils.clamp((0.5 - cy) * PAGE_H, -PAGE_H * 0.45, PAGE_H * 0.45);
      return { dir: 'fwd', corner: cy < 0.5 ? 'top' : 'bottom', pivotY, pageWidthPx: L.right.w };
    }
    if (inRect(L.left) && spec?.left != null && this.spread > 0) {
      const cy = (p.y - L.left.y) / Math.max(1, L.left.h);
      const pivotY = THREE.MathUtils.clamp((0.5 - cy) * PAGE_H, -PAGE_H * 0.45, PAGE_H * 0.45);
      return { dir: 'back', corner: cy < 0.5 ? 'top' : 'bottom', pivotY, pageWidthPx: L.left.w };
    }
    return null;
  }

  /** Soft contact shadow on the page the sheet is turning onto */
  _updateFlipShadow(progress, dir, pivotY) {
    if (!this.flipShadow) return;
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const e = p * p * (3 - 2 * p);
    /* Peak mid-turn, fade at ends */
    const strength = Math.sin(e * Math.PI);
    if (strength < 0.02) {
      this.flipShadow.visible = false;
      return;
    }
    this.flipShadow.visible = true;
    this.flipShadow.material.opacity = 0.22 * strength;

    const ontoLeft = dir === 'fwd';
    const xCenter = ontoLeft ? this._leftX() : this._rightX();
    /* Shadow creeps from spine toward free edge as the page turns */
    const travel = (e - 0.5) * PAGE_W * 0.35;
    this.flipShadow.position.set(
      xCenter + (ontoLeft ? travel : -travel),
      pivotY * 0.15,
      0.0011,
    );
    const sx = THREE.MathUtils.lerp(0.55, 1.05, strength);
    const sy = THREE.MathUtils.lerp(0.7, 1.0, strength);
    this.flipShadow.scale.set(sx, sy, 1);
  }

  _hideFlipShadow() {
    if (!this.flipShadow) return;
    this.flipShadow.visible = false;
    this.flipShadow.material.opacity = 0;
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
    if (this.spread !== 0 || !this.rightMesh) {
      await this._loadSpread(0);
    }
    this.coverOpen = true;
  }

  bindControls() {
    if (this._controlsBound) return;
    this._controlsBound = true;
    this.canvas.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
    window.addEventListener('keydown', this._onKey);
  }

  unbindControls() {
    if (!this._controlsBound) return;
    this._controlsBound = false;
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
    window.removeEventListener('keydown', this._onKey);
    this.cancelPointer();
  }

  /** Abort in-progress page drag (e.g. second finger starts a pinch) */
  cancelPointer() {
    this._swipeArm = null;
    if (!this._drag && !this.flipGroup?.visible) {
      this._dragPending = null;
      return;
    }
    this._drag = null;
    this._dragPending = null;
    if (this.flipGroup) this.flipGroup.visible = false;
    if (this.leftMesh) this.leftMesh.visible = true;
    if (this.rightMesh) this.rightMesh.visible = true;
    this._clearFlipUnder?.();
    if (this.flipShadow) this.flipShadow.visible = false;
    if (this.canvas) this.canvas.style.cursor = '';
  }

  _onKey(e) {
    if (!this.coverOpen || this.flipping || this._drag) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      e.preventDefault();
      this.next();
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      this.prev();
    }
  }

  _setFlipMaterials(frontTex, backTex, mirrored, { frontVellum = false, backVellum = false } = {}) {
    /*
     * Left flips use flipGroup.scale.x = -1. WebGLRenderer already reverses
     * frontFace when the world matrix determinant is negative — do NOT also
     * swap FrontSide/BackSide or the held sheet is culled (looks transparent).
     * Counter-mirror the front map so UV still matches the static left page.
     */
    const frontMap =
      frontTex && mirrored ? mirroredTex(frontTex) : frontTex;
    this._flipFront.material = frontMap
      ? frontVellum
        ? vellumMat(frontMap, VELLUM_OPACITY)
        : pageMat(frontMap)
      : paperMat();
    this._flipBack.material = backTex
      ? pageBackMat(backTex, {
          /*
           * Right flip: BackSide alone mirrors UV → counterMirror.
           * Left flip (scale.x=-1): geometry already mirrors — skip counter
           * or the verso (page−1) reads mirrored.
           */
          counterMirror: !mirrored && !backVellum,
          vellum: backVellum,
        })
      : paperMat(0xf2eee6);
    this._flipBack.material.polygonOffset = true;
    this._flipBack.material.polygonOffsetFactor = 1;
    this._flipBack.material.polygonOffsetUnits = 1;
    this._flipFront.material.side = THREE.FrontSide;
    this._flipBack.material.side = THREE.BackSide;
    this._flipFrontTex = frontTex;
    this._flipFrontVellum = frontVellum;
    this._flipBackVellum = backVellum;
  }

  _prepareFlip(dir) {
    const spec = spreadPages(this.spread);
    const nextIndex = dir === 'fwd' ? this.spread + 1 : this.spread - 1;
    const nextSpec = spreadPages(nextIndex);
    if (!spec) return false;

    resetCurl(this._flipGeo);

    if (dir === 'fwd') {
      if (spec.right == null) return false;
      let frontTex = this._texReadySync(spec.right);
      if (!frontTex) this._tex(spec.right); /* kick load; allow gesture with paper */
      const liftedPage1 = spec.right + 1;
      const frontVellum = isVellumPage(liftedPage1);
      const backIndex = nextSpec?.left ?? null;
      const backTex = this._texReadySync(backIndex);
      const backVellum = backIndex != null && isVellumPage(backIndex + 1);
      this._setFlipMaterials(frontTex, backTex, false, { frontVellum, backVellum });
      this.flipGroup.scale.x = 1;
      this.flipGroup.position.x = 0;
      if (this.rightMesh) this.rightMesh.visible = false;
      /* Show page+2 under the lift immediately */
      this._showFlipUnderlay('fwd', liftedPage1);
      if (!frontTex) {
        this._tex(spec.right).then((t) => {
          if (!this.flipGroup.visible) return;
          this._setFlipMaterials(t, this._texReadySync(backIndex), false, {
            frontVellum,
            backVellum: this._flipBackVellum,
          });
        });
      }
      if (backIndex != null && !backTex) {
        this._tex(backIndex).then((t) => {
          if (!this.flipGroup.visible) return;
          this._setFlipMaterials(this._flipFrontTex || frontTex, t, false, {
            frontVellum: this._flipFrontVellum,
            backVellum: this._flipBackVellum,
          });
        });
      }
    } else {
      if (spec.left == null) return false;
      let frontTex = this._texReadySync(spec.left);
      if (!frontTex) this._tex(spec.left);
      const liftedPage1 = spec.left + 1;
      const frontVellum = isVellumPage(liftedPage1);
      const backIndex = nextSpec?.right ?? null;
      const backTex = this._texReadySync(backIndex);
      const backVellum = backIndex != null && isVellumPage(backIndex + 1);
      this._setFlipMaterials(frontTex, backTex, true, { frontVellum, backVellum });
      this.flipGroup.scale.x = -1;
      this.flipGroup.position.x = 0;
      if (this.leftMesh) this.leftMesh.visible = false;
      /* Show page-2 under the lift immediately */
      this._showFlipUnderlay('back', liftedPage1);
      if (!frontTex) {
        this._tex(spec.left).then((t) => {
          if (!this.flipGroup.visible) return;
          this._setFlipMaterials(t, this._texReadySync(backIndex), true, {
            frontVellum,
            backVellum: this._flipBackVellum,
          });
        });
      }
      if (backIndex != null && !backTex) {
        this._tex(backIndex).then((t) => {
          if (!this.flipGroup.visible) return;
          this._setFlipMaterials(this._flipFrontTex || frontTex, t, true, {
            frontVellum: this._flipFrontVellum,
            backVellum: this._flipBackVellum,
          });
        });
      }
    }

    this._prefetchSpread(nextIndex);
    applyCurl(this._flipGeo, 0, PAGE_W, 0);
    this.flipGroup.visible = true;
    return true;
  }

  _mobileSwipeSpan() {
    return Math.max(72, Math.min(window.innerWidth, window.innerHeight) * 0.36);
  }

  _progressFromPointer(layoutX, layoutY, drag, clientX = null, clientY = null) {
    const L = this._screenLayout();
    const rect = drag.dir === 'fwd' ? L.right : L.left;
    const mobile = isMobileReaderRotated();
    let progress;
    if (
      mobile &&
      clientY != null &&
      drag.startClientY != null
    ) {
      /* Rotated stage: screen vertical = page turn — up → next, down → prev */
      const span = this._mobileSwipeSpan();
      if (drag.dir === 'fwd') {
        progress = THREE.MathUtils.clamp((drag.startClientY - clientY) / span, 0, 1);
      } else {
        progress = THREE.MathUtils.clamp((clientY - drag.startClientY) / span, 0, 1);
      }
    } else {
      const span = Math.max(48, rect.w * 0.88);
      if (drag.dir === 'fwd') {
        progress = THREE.MathUtils.clamp((drag.startX - layoutX) / span, 0, 1);
      } else {
        progress = THREE.MathUtils.clamp((layoutX - drag.startX) / span, 0, 1);
      }
    }
    const cy = (layoutY - rect.y) / Math.max(1, Math.abs(rect.h) || 1);
    const pivotY = THREE.MathUtils.clamp((0.5 - cy) * PAGE_H, -PAGE_H * 0.45, PAGE_H * 0.45);
    return { progress, pivotY };
  }

  _beginDrag(dir, clientX, clientY, pointerId) {
    if (!this._prepareFlip(dir)) return false;
    const p = clientToCanvasLayout(this.canvas, clientX, clientY);
    const L = this._screenLayout();
    const rect = dir === 'fwd' ? L.right : L.left;
    const cy = (p.y - rect.y) / Math.max(1, Math.abs(rect.h) || 1);
    const pivotY = THREE.MathUtils.clamp((0.5 - cy) * PAGE_H, -PAGE_H * 0.45, PAGE_H * 0.45);
    this._drag = {
      dir,
      corner: cy < 0.5 ? 'top' : 'bottom',
      pivotY,
      pageWidthPx: rect.w,
      startX: p.x,
      startY: p.y,
      startClientX: clientX,
      startClientY: clientY,
      progress: 0,
      ready: true,
      lastX: p.x,
      lastY: p.y,
    };
    this._dragPending = null;
    this._swipeArm = null;
    this.canvas.setPointerCapture?.(pointerId);
    this.canvas.style.cursor = 'grabbing';
    applyCurl(this._flipGeo, 0, PAGE_W, pivotY);
    this._updateFlipShadow(0, dir, pivotY);
    return true;
  }

  _onPointerDown(e) {
    if (!this.coverOpen || this.flipping) return;
    /* Ignore secondary finger — pinch-to-close is handled by BookViewer */
    if (e.isPrimary === false) return;

    /* Mobile rotated: arm vertical swipe — up = next, down = prev */
    if (isMobileReaderRotated()) {
      const r = this.canvas.getBoundingClientRect();
      const pad = 8;
      if (
        e.clientX < r.left - pad ||
        e.clientX > r.right + pad ||
        e.clientY < r.top - pad ||
        e.clientY > r.bottom + pad
      ) {
        return;
      }
      e.preventDefault();
      this._swipeArm = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
      };
      this.canvas.setPointerCapture?.(e.pointerId);
      return;
    }

    const hit = this._hitTest(e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    this._beginDrag(hit.dir, e.clientX, e.clientY, e.pointerId);
  }

  _onPointerMove(e) {
    if (this.flipping) return;

    if (this._swipeArm && e.pointerId === this._swipeArm.pointerId && !this._drag) {
      const dx = e.clientX - this._swipeArm.startClientX;
      const dy = e.clientY - this._swipeArm.startClientY;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      if (ady < 8) return;
      /* Prefer vertical; ignore mostly-horizontal drags (pinch / accidental) */
      if (ady < adx * 0.85) return;

      /* Up → next, down → prev */
      const dir = dy < 0 ? 'fwd' : 'back';
      const startX = this._swipeArm.startClientX;
      const startY = this._swipeArm.startClientY;
      const pointerId = this._swipeArm.pointerId;
      this._swipeArm = null;

      if (dir === 'fwd' && this.spread >= SPREAD_COUNT - 1) return;
      if (dir === 'back' && this.spread <= 0) return;
      if (!this._beginDrag(dir, startX, startY, pointerId)) return;
      /* Fall through to apply current sample as first progress */
    }

    if (!this._drag || !this._drag.ready) return;
    const p = clientToCanvasLayout(this.canvas, e.clientX, e.clientY);
    this._drag.lastX = p.x;
    this._drag.lastY = p.y;
    const { progress, pivotY } = this._progressFromPointer(
      p.x,
      p.y,
      this._drag,
      e.clientX,
      e.clientY,
    );
    this._drag.progress = progress;
    this._drag.pivotY = pivotY;
    /* Coalesce to one curl update per render frame */
    this._dragPending = { progress, pivotY, dir: this._drag.dir };
  }

  async _onPointerUp(e) {
    if (this._swipeArm && e.pointerId === this._swipeArm.pointerId) {
      this._swipeArm = null;
      this.canvas.releasePointerCapture?.(e.pointerId);
      this.canvas.style.cursor = '';
      return;
    }

    if (!this._drag) return;
    const drag = this._drag;
    this._drag = null;
    this._dragPending = null;
    this._swipeArm = null;
    this.canvas.releasePointerCapture?.(e.pointerId);
    this.canvas.style.cursor = '';

    if (!drag.ready || this.flipping) {
      this.flipGroup.visible = false;
      if (this.leftMesh) this.leftMesh.visible = true;
      if (this.rightMesh) this.rightMesh.visible = true;
      this._clearFlipUnder();
      this._hideFlipShadow();
      return;
    }

    if (drag.progress >= COMMIT_THRESHOLD) {
      await this._commitFlip(drag.dir, drag.progress, drag.pivotY);
    } else {
      await this._cancelFlip(drag.progress, drag.pivotY, drag.dir);
    }
  }

  async _cancelFlip(fromProgress, pivotY, dir = 'fwd') {
    this.flipping = true;
    await tween(Math.max(120, FLIP_MS * fromProgress * 0.5), (t) => {
      const p = fromProgress * (1 - t);
      applyCurl(this._flipGeo, p, PAGE_W, pivotY);
      this._updateFlipShadow(p, dir, pivotY);
    });
    this.flipGroup.visible = false;
    this.flipGroup.scale.x = 1;
    if (this.leftMesh) this.leftMesh.visible = true;
    if (this.rightMesh) this.rightMesh.visible = true;
    this._clearFlipUnder();
    this._hideFlipShadow();
    this.flipping = false;
  }

  async _commitFlip(dir, fromProgress = 0, pivotY = 0) {
    this.flipping = true;
    const nextSpread = dir === 'fwd' ? this.spread + 1 : this.spread - 1;
    const prefetch = this._ensureSpreadTextures(nextSpread);
    const ms = Math.max(160, FLIP_MS * (1 - fromProgress));

    /* Finish curl only — no mesh rebuild / DPR changes mid-animation */
    await Promise.all([
      tween(ms, (t) => {
        const p = fromProgress + (1 - fromProgress) * t;
        applyCurl(this._flipGeo, p, PAGE_W, pivotY);
        this._updateFlipShadow(p, dir, pivotY);
      }),
      prefetch,
    ]);

    /* New pages mount while old + curled sheet still cover the view */
    this.spread = nextSpread;
    this._installSpread(nextSpread);

    /* Reveal on next frame so GPU has the new maps composited */
    await new Promise((r) => requestAnimationFrame(r));
    this.flipGroup.visible = false;
    this.flipGroup.scale.x = 1;
    resetCurl(this._flipGeo);
    this._hideFlipShadow();
    this.flipping = false;

    this._prefetchNeighbors(nextSpread);
  }

  async next() {
    if (this.flipping || this._drag || this.spread >= SPREAD_COUNT - 1) return;
    if (!this._prepareFlip('fwd')) return;
    await this._commitFlip('fwd', 0, -PAGE_H * 0.2);
  }

  async prev() {
    if (this.flipping || this._drag || this.spread <= 0) return;
    if (!this._prepareFlip('back')) return;
    await this._commitFlip('back', 0, -PAGE_H * 0.2);
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
    const { progress, pivotY, dir } = this._dragPending;
    this._dragPending = null;
    applyCurl(this._flipGeo, progress, PAGE_W, pivotY);
    this._updateFlipShadow(progress, dir, pivotY);
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
  }
}

export { PAGE_W, PAGE_H, SPREAD_COUNT };
