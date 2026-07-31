/* emax · 3D 精装书
 *
 * 结构参考精装相册 / Stripe Press：
 *
 *   Y+  ┌─ 封皮上沿 (board) ──── 飘口 ──┐
 *       │   封面 Front (+Z)             │
 *  X-   │   书脊 Spine（装饰块）                │  X+ 开口（内页内缩 = 飘口）
 *       │   hinge 槽：封面/封底靠书脊侧         │
 *       │   封底 Back (-Z)              │
 *   Y-  └─ 封皮下沿 ────────────────────┘
 *
 *  Z+ = 封面方向 · X+ = 开口侧 · 书芯(page block)在封面/封底之间
 */

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BookReader, PAGE_W as READER_PAGE_W } from './book-reader.js';
import { SPREAD_COUNT, spreadPages } from './book-pages.js';
import { BOOK_CHAPTERS, pageToSpread, spreadLeftPage, spreadRightPage } from './book-chapters.js';

const HDR_URL =
  'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr';

function ap(path) {
  return window.assetPath(String(path).replace(/^\//, ''));
}

const ASSETS = {
  cover: ap('assets/cover.png'),
  back: ap('assets/back.png'),
  spine: ap('assets/spine.png'),
  page: ap('assets/page.png'),
  grooveMask: ap('assets/groove-mask.png'),
  spineGrooveMask: ap('assets/spine-groove-mask.png'),
  lenticular: [ap('assets/lenticular-a.png'), ap('assets/lenticular-b.png'), ap('assets/lenticular-c.png')],
};

const BookViewer = (() => {
  /* ── 尺寸（单位：scene units）── */
  const COVER_W = 2.2;
  const COVER_H = 2.2;
  const SPINE_T = COVER_W * (296 / 3189);
  /** 飘口：约为封面宽度的 2% */
  const CASE_MARGIN = COVER_W * 0.02;
  const BOARD_T = 0.016;
  const PAGE_EPS = 0.0004;
  /** 书芯离书脊侧内缩，避免与书脊 mesh 共面闪烁 */
  const PAGE_SPINE_GAP = 0.006;
  /** 书壳共面微重叠，消除封面/书脊之间的渲染缝隙 */
  const SHELL_OVERLAP = 0.0008;
  /** 封皮外沿圆角（略小于 BOARD_T，保持精装书比例） */
  const EDGE_BEVEL = 0.0032;
  const CORNER_SEGMENTS = 8;

  /* ── 凹槽：封面/封底 hinge + 书脊装饰块 ── */
  const COVER_GROOVE_D = 0.009;
  const HINGE_GROOVE_D = 0.008;
  const HINGE_GROOVE_HALF_W = 0.024;
  const SPINE_GROOVE_D = 0.006;
  const LENTICULAR_INSET = 0.003;
  const LENTICULAR_Z = 0.0012;

  const EMBOSS_STrength = 3.2;
  const VIEW_MARGIN = 1.08;
  /**
   * Default hero pose on /emax/ — match reference screenshot:
   * low look-up, cover dominant, thick white page-block on RIGHT + BOTTOM,
   * spine only a thin left edge, slight clockwise roll.
   */
  const DEFAULT_ROT_X = -0.42;
  const DEFAULT_ROT_Y = -0.50;
  const DEFAULT_ROT_Z = -0.08;
  const CLOSED_CAM_Y = -0.34;
  const CLOSED_CAM_X = -0.12;
  const CLOSED_FOV = 36;

  let canvas = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let bookGroup = null;
  let viewSphere = null;
  let pmrem = null;
  let rafId = 0;
  let active = false;
  let clock = null;

  let rotX = DEFAULT_ROT_X;
  let rotY = DEFAULT_ROT_Y;
  let rotZ = DEFAULT_ROT_Z;
  let targetRotX = DEFAULT_ROT_X;
  let targetRotY = DEFAULT_ROT_Y;
  let targetRotZ = DEFAULT_ROT_Z;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let pointerDownX = 0;
  let pointerDownY = 0;
  let pointerMoved = false;
  let pointerCaptured = false;
  let lastTapTime = 0;
  let lastTapX = 0;
  let lastTapY = 0;

  const DRAG_THRESHOLD = 6;
  const DBL_TAP_MS = 420;
  const DBL_TAP_DIST = 12;
  const MOBILE_BOOK_MQ = '(max-width: 900px)';
  const PINCH_OUT_RATIO = 1.22;
  const PINCH_IN_RATIO = 0.78;
  const PINCH_MIN_START = 28;

  let coverTexRef = null;
  let envMapRef = null;
  let lenticularMesh = null;
  /** >1 = pixelated render scale; 1 = full resolution */
  let pixelBlock = 1;
  let pixelRevealStart = 0;
  let pixelPass = null;
  /** Intro ended before BookViewer was ready — reveal on init */
  let pendingEntranceReveal = false;

  /** closed | opening | reading */
  let mode = 'closed';
  let reader = null;
  let opening = false;

  /** Mobile pinch: pointerId → {x,y} */
  const pinchPointers = new Map();
  let pinchStartDist = 0;
  let pinchArmed = false;
  let pinchTriggered = false;

  const PIXEL_REVEAL_MAX = 72;
  const PIXEL_REVEAL_MS = 1100;
  /** Match reader page width so handoff cover size stays continuous */
  const READER_GUTTER = 0.0008;
  const READER_FOV = 34;
  /** 1) face-on · 2) handoff + open cover */
  const FACE_MS = 680;
  const COVER_OPEN_MS = 640;
  const STAGE_ROTATE_MS = 580;

  const loader = new THREE.TextureLoader();

  function loadTex(url, colorSpace = THREE.SRGBColorSpace) {
    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (tex) => {
          tex.colorSpace = colorSpace;
          tex.anisotropy = 8;
          resolve(tex);
        },
        undefined,
        reject,
      );
    });
  }

  function imageFromTexture(tex) {
    const img = tex.image;
    if (img instanceof HTMLImageElement || img instanceof HTMLCanvasElement) return img;
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    return c;
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

  function rectCenterSize(r, w, h) {
    return {
      x: ((r.u0 + r.u1) * 0.5 - 0.5) * w,
      y: ((r.v0 + r.v1) * 0.5 - 0.5) * h,
      width: (r.u1 - r.u0) * w,
      height: (r.v1 - r.v0) * h,
    };
  }

  function inkNormalFromImage(img, strength = EMBOSS_STrength) {
    const w = img.width;
    const h = img.height;
    const src = document.createElement('canvas');
    src.width = w;
    src.height = h;
    const sctx = src.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(img, 0, 0);
    const gray = sctx.getImageData(0, 0, w, h).data;

    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const octx = out.getContext('2d');
    const normal = octx.createImageData(w, h);

    function lum(x, y) {
      const i = (y * w + x) * 4;
      return (0.299 * gray[i] + 0.587 * gray[i + 1] + 0.114 * gray[i + 2]) / 255;
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const xl = lum(Math.max(0, x - 1), y);
        const xr = lum(Math.min(w - 1, x + 1), y);
        const yt = lum(x, Math.max(0, y - 1));
        const yb = lum(x, Math.min(h - 1, y + 1));
        const ink = 1 - lum(x, y);
        const dx = (xr - xl) * strength * ink;
        const dy = (yb - yt) * strength * ink;
        const nx = -dx;
        const ny = -dy;
        const nz = 1;
        const len = Math.hypot(nx, ny, nz) || 1;
        const i = (y * w + x) * 4;
        normal.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
        normal.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
        normal.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
        normal.data[i + 3] = 255;
      }
    }
    octx.putImageData(normal, 0, 0);
    const tex = new THREE.CanvasTexture(out);
    tex.colorSpace = THREE.NoColorSpace;
    return tex;
  }

  /** 锐利浅凹槽：硬边 smoothstep，不做渐变深坑；outward 为 true 时沿 +Z 位移 */
  function displaceGroove(geometry, maskTex, depth, flipV = false, outward = false) {
    const img = imageFromTexture(maskTex);
    const w = img.width;
    const h = img.height;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(img, 0, 0);
    const data = c.getContext('2d').getImageData(0, 0, w, h).data;
    const pos = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    const sign = outward ? 1 : -1;
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      const vy = flipV ? 1 - v : v;
      const px = Math.min(w - 1, Math.max(0, Math.floor(u * w)));
      const py = Math.min(h - 1, Math.max(0, Math.floor(vy * h)));
      const m = data[(py * w + px) * 4] / 255;
      const g = m >= 0.52 ? 1 : THREE.MathUtils.smoothstep(0.38, 0.52, m);
      if (g > 0.001) pos.setZ(i, pos.getZ(i) + sign * depth * g);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  /** Box 指定面的凹槽（书脊外立面 -X：沿 +X 内凹） */
  function displaceGrooveOnBoxFace(geometry, maskTex, depth, face = 'negX', flipV = false) {
    const img = imageFromTexture(maskTex);
    const w = img.width;
    const h = img.height;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(img, 0, 0);
    const data = c.getContext('2d').getImageData(0, 0, w, h).data;

    const { width: bx, height: by, depth: bz } = geometry.parameters;
    const pos = geometry.attributes.position;
    const eps = Math.min(bx, by, bz) * 0.051;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      let u;
      let v;
      let inwardX = 0;
      let inwardY = 0;
      let inwardZ = 0;

      if (face === 'negX' && Math.abs(x + bx / 2) <= eps) {
        u = 1 - (z + bz / 2) / bz;
        v = (y + by / 2) / by;
        inwardX = 1;
      } else if (face === 'posX' && Math.abs(x - bx / 2) <= eps) {
        u = (z + bz / 2) / bz;
        v = (y + by / 2) / by;
        inwardX = -1;
      } else {
        continue;
      }

      const vy = flipV ? 1 - v : v;
      const px = Math.min(w - 1, Math.max(0, Math.floor(u * w)));
      const py = Math.min(h - 1, Math.max(0, Math.floor(vy * h)));
      const m = data[(py * w + px) * 4] / 255;
      const g = m >= 0.52 ? 1 : THREE.MathUtils.smoothstep(0.38, 0.52, m);
      if (g > 0.001) {
        pos.setXYZ(
          i,
          x + inwardX * depth * g,
          y + inwardY * depth * g,
          z + inwardZ * depth * g,
        );
      }
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  /** 封面/封底靠书脊侧的竖向 hinge 槽（spineU：书脊在 UV 的哪一侧） */
  function displaceHingeGroove(geometry, depth, spineU = 0.04, halfWidth = HINGE_GROOVE_HALF_W) {
    const pos = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i);
      const g = THREE.MathUtils.smoothstep(spineU + halfWidth, spineU - halfWidth, u);
      const edgeFade = THREE.MathUtils.smoothstep(0.012, 0.045, u);
      if (g > 0.001) pos.setZ(i, pos.getZ(i) - depth * g * edgeFade);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  /** 封底 hinge：书脊在 UV 高 u 一侧 */
  function displaceBackHingeGroove(geometry, depth, spineU = 0.96, halfWidth = HINGE_GROOVE_HALF_W) {
    const pos = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i);
      const g = THREE.MathUtils.smoothstep(spineU - halfWidth, spineU + halfWidth, u);
      const edgeFade = THREE.MathUtils.smoothstep(0.012, 0.045, 1 - u);
      if (g > 0.001) pos.setZ(i, pos.getZ(i) - depth * g * edgeFade);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  /** Box 外棱圆角：封面/书脊厚边用 */
  function bevelBoxEdges(geometry, radius) {
    const { width, height, depth } = geometry.parameters;
    const hx = width / 2;
    const hy = height / 2;
    const hz = depth / 2;
    const r = Math.min(radius, hx * 0.42, hy * 0.42, hz * 0.42);
    const pos = geometry.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const sx = x < 0 ? -1 : 1;
      const sy = y < 0 ? -1 : 1;
      const sz = z < 0 ? -1 : 1;
      const ox = Math.abs(x);
      const oy = Math.abs(y);
      const oz = Math.abs(z);

      const nearX = ox > hx - r;
      const nearY = oy > hy - r;
      const nearZ = oz > hz - r;
      if (!((nearX && nearY) || (nearX && nearZ) || (nearY && nearZ))) continue;

      const inner = new THREE.Vector3(
        sx * (nearX ? hx - r : ox),
        sy * (nearY ? hy - r : oy),
        sz * (nearZ ? hz - r : oz),
      );

      if (nearX && nearY && nearZ) {
        const dir = new THREE.Vector3(x, y, z).sub(inner);
        if (dir.lengthSq() > 1e-10) {
          dir.normalize().multiplyScalar(r).add(inner);
          pos.setXYZ(i, dir.x, dir.y, dir.z);
        } else {
          pos.setXYZ(i, inner.x, inner.y, inner.z);
        }
        continue;
      }

      if (nearX && nearY) {
        pos.setXYZ(i, inner.x, inner.y, z);
      } else if (nearX && nearZ) {
        pos.setXYZ(i, inner.x, y, inner.z);
      } else if (nearY && nearZ) {
        pos.setXYZ(i, x, inner.y, inner.z);
      }
    }

    pos.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  /** 外角 1/8 球角（封皮外沿） */
  function addCornerFilletBall(group, mat, x, y, z, radius, sx, sy, sz) {
    const phiStart = sx > 0 ? 0 : Math.PI;
    const phiLen = Math.PI / 2;
    const thetaStart = sy > 0 ? 0 : Math.PI / 2;
    const thetaLen = Math.PI / 2;
    const geo = new THREE.SphereGeometry(
      radius,
      CORNER_SEGMENTS,
      CORNER_SEGMENTS,
      phiStart,
      phiLen,
      thetaStart,
      thetaLen,
    );
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    group.add(mesh);
  }

  /** 封面 ↔ 书脊外转折：沿 Y 的 1/4 圆柱（消除 L 形硬棱） */
  function addSpineJunctionFillets(group, mat, W, H, zFace, boardT, bevel) {
    const ySpan = H - bevel * 2;
    if (ySpan <= 0) return;
    const cx = -W / 2 - boardT + bevel;
    const cz = zFace > 0 ? zFace - bevel : zFace + bevel;
    const start = zFace > 0 ? Math.PI / 2 : Math.PI;

    const geo = new THREE.CylinderGeometry(
      bevel,
      bevel,
      ySpan,
      CORNER_SEGMENTS,
      1,
      true,
      start,
      Math.PI / 2,
    );
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, 0, cz);
    group.add(mesh);
  }

  /** 封面靠书脊侧微重叠，避免与书脊之间的可见缝 */
  function weldCoverToSpine(geometry, W, overlap, spineSide = 'left') {
    const pos = geometry.attributes.position;
    const spineX = spineSide === 'left' ? -W / 2 : W / 2;
    const band = W * 0.05;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const t = spineSide === 'left'
        ? THREE.MathUtils.smoothstep(spineX + band, spineX, x)
        : THREE.MathUtils.smoothstep(spineX - band, spineX, x);
      if (t > 0) pos.setX(i, x + (spineSide === 'left' ? overlap * t : -overlap * t));
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  /** 封面/封底外沿：圆角厚边（取代独立平面条） */
  function addCoverEdgeWrap(group, edge, W, H, z, boardT, bevel = EDGE_BEVEL) {
    /* Thickness grows toward book interior: front −Z, back +Z */
    const side = Math.sign(z) || 1;
    const lipZ = z - side * boardT * 0.5;

    const foreGeo = new THREE.BoxGeometry(boardT, H, boardT, 1, 16, 2);
    bevelBoxEdges(foreGeo, bevel);
    const fore = new THREE.Mesh(foreGeo, edge);
    fore.position.set(W / 2 - boardT * 0.5, 0, lipZ);
    group.add(fore);

    const topGeo = new THREE.BoxGeometry(W, boardT, boardT, 16, 1, 2);
    bevelBoxEdges(topGeo, bevel);
    const top = new THREE.Mesh(topGeo, edge);
    top.position.set(0, H / 2 - boardT * 0.5, lipZ);
    group.add(top);

    const bottomGeo = new THREE.BoxGeometry(W, boardT, boardT, 16, 1, 2);
    bevelBoxEdges(bottomGeo, bevel);
    const bottom = new THREE.Mesh(bottomGeo, edge);
    bottom.position.set(0, -H / 2 + boardT * 0.5, lipZ);
    group.add(bottom);

    const corners = [
      [W / 2 - bevel, H / 2 - bevel],
      [W / 2 - bevel, -H / 2 + bevel],
      [-W / 2 + bevel, H / 2 - bevel],
      [-W / 2 + bevel, -H / 2 + bevel],
    ];
    corners.forEach(([px, py]) => {
      addCornerFilletBall(
        group,
        edge,
        px,
        py,
        lipZ + side * (boardT / 2 - bevel),
        bevel,
        px >= 0 ? 1 : -1,
        py >= 0 ? 1 : -1,
        side,
      );
    });
  }

  /** 凹槽边缘法线：concave 为内凹槽（书脊/封面 -Z 方向） */
  function grooveRimNormal(maskTex, strength = 5.5, concave = false) {
    const img = imageFromTexture(maskTex);
    const w = img.width;
    const h = img.height;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(img, 0, 0);
    const data = c.getContext('2d').getImageData(0, 0, w, h).data;
    const out = c.getContext('2d').createImageData(w, h);
    const rimSign = concave ? -1 : 1;

    function sample(x, y) {
      const px = Math.min(w - 1, Math.max(0, x));
      const py = Math.min(h - 1, Math.max(0, y));
      return data[(py * w + px) * 4] / 255;
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const m = sample(x, y);
        const dx = sample(x + 1, y) - sample(x - 1, y);
        const dy = sample(x, y + 1) - sample(x, y - 1);
        const edge = Math.hypot(dx, dy) * strength * (0.35 + m * 0.65);
        const nx = rimSign * -dx * edge;
        const ny = rimSign * dy * edge;
        const nz = 1;
        const len = Math.hypot(nx, ny, nz) || 1;
        const i = (y * w + x) * 4;
        out.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
        out.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
        out.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
        out.data[i + 3] = 255;
      }
    }
    c.getContext('2d').putImageData(out, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.NoColorSpace;
    return tex;
  }

  function coverSilverMat(envMap, map, grooveNormal) {
    return new THREE.MeshPhysicalMaterial({
      color: 0xb2b8c1,
      metalness: 0.92,
      roughness: 0.56,
      map,
      normalMap: grooveNormal,
      normalScale: new THREE.Vector2(0.95, 0.95),
      envMap,
      envMapIntensity: 1.68,
      clearcoat: 0.14,
      clearcoatRoughness: 0.6,
    });
  }

  function coverLiningMat(envMap, map, normalMap) {
    return new THREE.MeshPhysicalMaterial({
      color: 0xb2b8c1,
      metalness: 0.92,
      roughness: 0.56,
      map,
      normalMap,
      normalScale: new THREE.Vector2(0.36, 0.36),
      envMap,
      envMapIntensity: 1.68,
      clearcoat: 0.14,
      clearcoatRoughness: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
  }

  function spineBoardMat(envMap, map, normalMap) {
    const mat = inkSilverMat(envMap, map, normalMap);
    mat.side = THREE.DoubleSide;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = -1;
    return mat;
  }

  /** 书芯：白色纸感 + page.png 横纹 bump（page.png 本身偏暗，不用作 color map） */
  function pagePaperMat(pageTex, layout = 'fore') {
    const bump = new THREE.Texture(pageTex.image);
    bump.colorSpace = THREE.NoColorSpace;
    bump.wrapS = THREE.RepeatWrapping;
    bump.wrapT = THREE.RepeatWrapping;
    if (layout === 'fore') {
      bump.repeat.set(1, Math.max(8, Math.round(34)));
      bump.rotation = Math.PI / 2;
      bump.center.set(0.5, 0.5);
    } else if (layout === 'top') {
      bump.repeat.set(Math.max(8, Math.round(28)), 1);
    } else {
      bump.repeat.set(Math.max(8, Math.round(28)), 1);
      bump.rotation = Math.PI;
      bump.center.set(0.5, 0.5);
    }
    bump.needsUpdate = true;
    return new THREE.MeshStandardMaterial({
      color: 0xfffdf9,
      bumpMap: bump,
      bumpScale: 0.006,
      roughness: 0.9,
      metalness: 0,
    });
  }

  /** 书芯六面：+X 开口 / ±Y 切边 / 其余白纸 */
  function pageBlockMaterials(pageTex) {
    const paper = pagePaperMat(pageTex, 'top');
    return [
      pagePaperMat(pageTex, 'fore'),
      pagePaperMat(pageTex, 'fore'),
      pagePaperMat(pageTex, 'top'),
      pagePaperMat(pageTex, 'bottom'),
      paper,
      paper,
    ];
  }

  /** 封皮板厚度填充：向书脊侧延伸，与书脊内立面齐平；厚度朝书芯内侧长，不盖住封面/封底贴图 */
  function addCoverBoardFill(group, mat, W, H, zFace, boardT) {
    const fillGeo = new THREE.BoxGeometry(W + boardT, H, boardT, 16, 16, 2);
    bevelBoxEdges(fillGeo, EDGE_BEVEL * 0.85);
    const fill = new THREE.Mesh(fillGeo, mat);
    /* zFace>0 封面：向 -Z 内长；zFace<0 封底：向 +Z 内长 */
    const inward = Math.sign(zFace) || 1;
    fill.position.set(-boardT * 0.5, 0, zFace - inward * boardT * 0.5);
    group.add(fill);
  }

  function boardEdgeMat(envMap) {
    return new THREE.MeshPhysicalMaterial({
      color: 0xb6bcc5,
      metalness: 0.92,
      roughness: 0.52,
      envMap,
      envMapIntensity: 1.64,
      clearcoat: 0.12,
      clearcoatRoughness: 0.56,
    });
  }

  function inkSilverMat(envMap, map, normalMap) {
    return new THREE.MeshPhysicalMaterial({
      color: 0xb0b6bf,
      metalness: 0.93,
      roughness: 0.54,
      map,
      normalMap,
      normalScale: new THREE.Vector2(0.42, 0.42),
      envMap,
      envMapIntensity: 1.62,
      clearcoat: 0.12,
      clearcoatRoughness: 0.58,
    });
  }

  /** page.png 横纹 · fore=开口侧 · top/bottom=上下切口 */
  function pageMat(pageTex, layout) {
    const map = new THREE.Texture(pageTex.image);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 8;

    const bump = new THREE.Texture(pageTex.image);
    bump.colorSpace = THREE.NoColorSpace;
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping;

    if (layout === 'fore') {
      map.repeat.set(1, Math.max(8, Math.round(34)));
      map.rotation = Math.PI / 2;
      map.center.set(0.5, 0.5);
    } else if (layout === 'top') {
      map.repeat.set(Math.max(8, Math.round(28)), 1);
    } else {
      map.repeat.set(Math.max(8, Math.round(28)), 1);
      map.rotation = Math.PI;
      map.center.set(0.5, 0.5);
    }
    map.needsUpdate = true;

    bump.repeat.copy(map.repeat);
    bump.rotation = map.rotation;
    bump.center.copy(map.center);
    bump.needsUpdate = true;

    return new THREE.MeshStandardMaterial({
      map,
      bumpMap: bump,
      bumpScale: 0.005,
      color: 0xfffdf9,
      roughness: 0.92,
      metalness: 0,
      side: THREE.DoubleSide,
    });
  }

  function lenticularMat(texs) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        texA: { value: texs[0] },
        texB: { value: texs[1] },
        texC: { value: texs[2] },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormalW;
        varying vec3 vViewW;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vViewW = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D texA;
        uniform sampler2D texB;
        uniform sampler2D texC;
        varying vec2 vUv;
        varying vec3 vNormalW;
        varying vec3 vViewW;
        void main() {
          vec3 n = normalize(vNormalW);
          vec3 v = normalize(vViewW);
          vec3 t = normalize(cross(n, vec3(0.0, 1.0, 0.0)));
          float parallax = dot(normalize(v - n * dot(v, n)), t);
          float blend = clamp(parallax * 1.6 + 0.5, 0.0, 1.0);
          vec3 c;
          if (blend < 0.5) c = mix(texture2D(texA, vUv).rgb, texture2D(texB, vUv).rgb, smoothstep(0.0, 0.5, blend) * 2.0);
          else c = mix(texture2D(texB, vUv).rgb, texture2D(texC, vUv).rgb, smoothstep(0.5, 1.0, blend) * 2.0);
          float ridge = sin(vUv.y * 380.0 + parallax * 4.0);
          c *= 0.89 + 0.11 * ridge;
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
    mat.depthWrite = false;
    mat.side = THREE.DoubleSide;
    return mat;
  }

  async function buildBook(envMap) {
    const [spineTex, pageTex, grooveMask, spineGrooveMask, backTex, coverTex, ...lentTexs] =
      await Promise.all([
        loadTex(ASSETS.spine),
        loadTex(ASSETS.page),
        loadTex(ASSETS.grooveMask, THREE.NoColorSpace),
        loadTex(ASSETS.spineGrooveMask, THREE.NoColorSpace),
        loadTex(ASSETS.back),
        loadTex(ASSETS.cover),
        ...ASSETS.lenticular.map((u) => loadTex(u)),
      ]);

    const W = COVER_W;
    const H = COVER_H;
    const T = SPINE_T;
    const hz = T / 2;

    /* 书芯边界：书脊侧留 PAGE_SPINE_GAP，开口/上/下内缩 CASE_MARGIN */
    const px0 = -W / 2 + PAGE_SPINE_GAP;
    const px1 = W / 2 - CASE_MARGIN;
    const py0 = -H / 2 + CASE_MARGIN;
    const py1 = H / 2 - CASE_MARGIN;
    const pz0 = -hz + BOARD_T;
    const pz1 = hz - BOARD_T;

    const blockW = px1 - px0;
    const blockH = py1 - py0;
    const blockT = pz1 - pz0;
    const blockCx = (px0 + px1) / 2;
    const blockCy = (py0 + py1) / 2;
    const blockCz = (pz0 + pz1) / 2;

    const grooveRect = maskBoundsFromImage(imageFromTexture(grooveMask));
    const lentRect = insetRect(grooveRect, LENTICULAR_INSET);
    const lent = rectCenterSize(lentRect, W, H);

    const backNormal = inkNormalFromImage(imageFromTexture(backTex));
    const coverNormal = inkNormalFromImage(imageFromTexture(coverTex));
    const spineNormal = inkNormalFromImage(imageFromTexture(spineTex));
    const spineGrooveNormal = grooveRimNormal(spineGrooveMask, 5.5, true);
    const coverGrooveNormal = grooveRimNormal(grooveMask, 5.5, true);
    const liningMat = coverLiningMat(envMap, coverTex, coverNormal);

    const group = new THREE.Group();
    const edge = boardEdgeMat(envMap);
    const shell = new THREE.Group();
    shell.name = 'case-shell';

    /* ── 1. 书芯：page.png 贴图块 ── */
    const pages = new THREE.Group();
    pages.name = 'page-block';

    const pageBlock = new THREE.Mesh(
      new THREE.BoxGeometry(blockW, blockH, blockT),
      pageBlockMaterials(pageTex),
    );
    pageBlock.position.set(blockCx, blockCy, blockCz);
    pageBlock.renderOrder = 1;
    pages.add(pageBlock);

    group.add(pages);

    /* ── 2. 封皮：封面/封底/书脊（三边不封死，留飘口） ── */
    const coverGeo = new THREE.PlaneGeometry(W, H, 128, 128);
    displaceGroove(coverGeo, grooveMask, COVER_GROOVE_D, false);
    displaceHingeGroove(coverGeo, HINGE_GROOVE_D);
    weldCoverToSpine(coverGeo, W, SHELL_OVERLAP, 'left');

    const backGeo = new THREE.PlaneGeometry(W, H, 128, 128);
    displaceBackHingeGroove(backGeo, HINGE_GROOVE_D);
    /* Mesh is rotated Y=π, so weld the local +X edge → world −X (spine) */
    weldCoverToSpine(backGeo, W, SHELL_OVERLAP, 'right');

    const cover = new THREE.Mesh(coverGeo, coverSilverMat(envMap, coverTex, coverGrooveNormal));
    cover.name = 'cover-front';
    cover.position.z = hz;
    cover.renderOrder = 2;
    shell.add(cover);

    addCoverBoardFill(shell, liningMat, W, H, hz, BOARD_T);

    const back = new THREE.Mesh(backGeo, inkSilverMat(envMap, backTex, backNormal));
    back.name = 'cover-back';
    back.position.z = -hz;
    back.rotation.y = Math.PI;
    back.renderOrder = 2;
    shell.add(back);

    addCoverBoardFill(shell, liningMat, W, H, -hz, BOARD_T);

    /* 书脊：内立面与封面左缘齐平，外立面 -X 开槽 */
    const spineOuterX = -W / 2 - BOARD_T;
    const spineBoardGeo = new THREE.BoxGeometry(BOARD_T, H, T, 2, 128, 32);
    displaceGrooveOnBoxFace(spineBoardGeo, spineGrooveMask, SPINE_GROOVE_D, 'negX', false);
    bevelBoxEdges(spineBoardGeo, EDGE_BEVEL);

    const spineOuterMat = spineBoardMat(envMap, spineTex, spineGrooveNormal);
    spineOuterMat.normalScale = new THREE.Vector2(0.88, 0.88);
    const spineInnerMat = spineBoardMat(envMap, spineTex, spineNormal);
    const spineSideMat = boardEdgeMat(envMap);

    const spineBoard = new THREE.Mesh(spineBoardGeo, [
      spineInnerMat,
      spineOuterMat,
      spineSideMat,
      spineSideMat,
      spineSideMat,
      spineSideMat,
    ]);
    spineBoard.position.set(-W / 2 - BOARD_T / 2, 0, 0);
    spineBoard.renderOrder = 2;
    shell.add(spineBoard);

    addCoverEdgeWrap(shell, edge, W, H, hz, BOARD_T);
    addCoverEdgeWrap(shell, edge, W, H, -hz, BOARD_T);
    addSpineJunctionFillets(shell, edge, W, H, hz, BOARD_T, EDGE_BEVEL);
    addSpineJunctionFillets(shell, edge, W, H, -hz, BOARD_T, EDGE_BEVEL);

    [
      [-W / 2 + EDGE_BEVEL, H / 2 - EDGE_BEVEL, hz - BOARD_T + EDGE_BEVEL, -1, 1, 1],
      [-W / 2 + EDGE_BEVEL, -H / 2 + EDGE_BEVEL, hz - BOARD_T + EDGE_BEVEL, -1, -1, 1],
      [-W / 2 + EDGE_BEVEL, H / 2 - EDGE_BEVEL, -hz + BOARD_T - EDGE_BEVEL, -1, 1, -1],
      [-W / 2 + EDGE_BEVEL, -H / 2 + EDGE_BEVEL, -hz + BOARD_T - EDGE_BEVEL, -1, -1, -1],
      [-W / 2 - BOARD_T + EDGE_BEVEL, H / 2 - EDGE_BEVEL, hz - EDGE_BEVEL, -1, 1, 1],
      [-W / 2 - BOARD_T + EDGE_BEVEL, -H / 2 + EDGE_BEVEL, hz - EDGE_BEVEL, -1, -1, 1],
      [-W / 2 - BOARD_T + EDGE_BEVEL, H / 2 - EDGE_BEVEL, -hz + EDGE_BEVEL, -1, 1, -1],
      [-W / 2 - BOARD_T + EDGE_BEVEL, -H / 2 + EDGE_BEVEL, -hz + EDGE_BEVEL, -1, -1, -1],
    ].forEach(([x, y, z, sx, sy, sz]) => {
      addCornerFilletBall(shell, edge, x, y, z, EDGE_BEVEL, sx, sy, sz);
    });

    group.add(shell);

    /* ── 3. 光栅片 ── */
    const lenticular = new THREE.Mesh(
      new THREE.PlaneGeometry(lent.width, lent.height),
      lenticularMat(lentTexs),
    );
    lenticular.position.set(lent.x, lent.y, hz + LENTICULAR_Z);
    lenticular.renderOrder = 10;
    lenticular.name = 'lenticular';
    group.add(lenticular);
    lenticularMesh = lenticular;

    group.updateMatrixWorld(true);
    viewSphere = new THREE.Sphere();
    new THREE.Box3().setFromObject(group).getBoundingSphere(viewSphere);
    coverTexRef = coverTex;
    return group;
  }

  function tween(ms, fn, ease = (t) => 1 - (1 - t) ** 3) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ms);
        fn(ease(t), t);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  /** Soft physical ease: slow lift-off, peak mid-swing, soft land */
  function easePhysical(t) {
    return 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));
  }

  function readingCameraPose() {
    const { w, h } = getDisplaySize();
    const aspect = Math.max(0.2, w / Math.max(1, h));
    const spreadW = READER_PAGE_W * 2 + READER_GUTTER;
    const dist =
      (spreadW / (2 * Math.tan(THREE.MathUtils.degToRad(READER_FOV * 0.5)) * aspect)) * 1.14;
    return {
      position: new THREE.Vector3(0, 0.015, dist),
      lookAt: new THREE.Vector3(0, 0, 0),
      fov: READER_FOV,
      aspect,
    };
  }

  /** Closed-cover framing — matches scaled hardcover sitting on the right half */
  function coverCameraPose() {
    const { w, h } = getDisplaySize();
    const aspect = Math.max(0.2, w / Math.max(1, h));
    const dist =
      (READER_PAGE_W / (2 * Math.tan(THREE.MathUtils.degToRad(READER_FOV * 0.5)) * aspect)) * 1.06;
    return {
      position: new THREE.Vector3(READER_PAGE_W * 0.5, 0.02, dist),
      lookAt: new THREE.Vector3(READER_PAGE_W * 0.5, 0, 0),
      fov: READER_FOV,
      aspect,
    };
  }

  function applyCameraPose(from, to, t) {
    camera.fov = THREE.MathUtils.lerp(from.fov, to.fov, t);
    camera.position.lerpVectors(from.position, to.position, t);
    const look = new THREE.Vector3().lerpVectors(from.lookAt, to.lookAt, t);
    camera.lookAt(look);
    camera.updateProjectionMatrix();
  }

  function updateReaderHud(spreadIndex, spec) {
    const hud = document.getElementById('book-reader-hud');
    if (!hud) return;
    const left = spec?.left != null ? spec.left + 1 : spreadLeftPage(spreadIndex);
    const right = spec?.right != null ? spec.right + 1 : spreadRightPage(spreadIndex);
    const label =
      left != null && right != null && right <= 160
        ? `${String(left).padStart(3, '0')} – ${String(right).padStart(3, '0')}`
        : right != null
          ? String(right).padStart(3, '0')
          : String(left).padStart(3, '0');
    hud.textContent = label;
    hud.hidden = false;
  }

  function setReadingChrome(on) {
    document.body.classList.toggle('is-book-reading', on);
    if (!on) document.body.classList.remove('is-book-pre-rotate');
    const bar = document.getElementById('book-reader-bar');
    const hint = document.getElementById('book-open-hint');
    const toc = document.querySelector('.emax-toc');
    if (bar) bar.hidden = !on;
    if (hint) hint.hidden = on;
    if (toc) toc.hidden = on;
    canvas?.classList.toggle('is-reading', on);
    /* Lock page scroll only on mobile full-bleed reader; desktop keeps page scroll */
    if (isMobileBook()) {
      if (on) {
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
      } else {
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
      }
    } else {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
  }

  function setOpeningChrome(on) {
    document.body.classList.toggle('is-book-opening', on);
    if (!on && !document.body.classList.contains('is-book-reading')) {
      document.body.classList.remove('is-book-pre-rotate');
    }
  }

  function reducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Mobile open/close: upright staging pose before/after CW 90° settle */
  function setStagePreRotate(on) {
    document.body.classList.toggle('is-book-pre-rotate', on);
  }

  function waitStageRotate(ms = STAGE_ROTATE_MS) {
    const stage = document.querySelector('.emax-book-stage');
    if (!stage || reducedMotion()) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        stage.removeEventListener('transitionend', onEnd);
        resolve();
      };
      const onEnd = (e) => {
        if (e.target !== stage) return;
        if (e.propertyName && e.propertyName !== 'transform') return;
        finish();
      };
      stage.addEventListener('transitionend', onEnd);
      setTimeout(finish, ms + 100);
    });
  }

  async function waitFrames(n = 2) {
    for (let i = 0; i < n; i += 1) {
      await new Promise((r) => requestAnimationFrame(r));
    }
  }

  async function waitForReadableCanvas(min = 80, tries = 24) {
    for (let i = 0; i < tries; i += 1) {
      const { w, h } = getDisplaySize();
      if (w >= min && h >= min) return true;
      await waitFrames(1);
    }
    return false;
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
        if (!reader || opening) return;
        reader.goToSpread(pageToSpread(ch.page));
        nav.querySelectorAll('.book-reader-bar__chapter').forEach((el) => {
          el.classList.toggle('is-active', el.dataset.chapter === ch.id);
        });
      });
      nav.appendChild(btn);
    });

    back?.addEventListener('click', () => {
      if (mode === 'reading' && !opening) closeBook();
    });
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

  async function openBook() {
    if (opening || mode !== 'closed') return;
    opening = true;

    try {
      reader = new BookReader({
        scene,
        camera,
        renderer,
        canvas,
        envMap: envMapRef,
        coverTex: coverTexRef,
        onSpreadChange: (spreadIndex, spec) => {
          updateReaderHud(spreadIndex, spec);
          syncReaderNav(spreadIndex);
        },
      });

      await Promise.race([
        reader.init(),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Reader init timed out')), 12000);
        }),
      ]);

      bindReaderNav();
      mode = 'opening';

      const startRotX = rotX;
      const startRotY = rotY;
      const startRotZ = rotZ;
      bookGroup.position.set(0, 0, 0);
      bookGroup.scale.set(1, 1, 1);

      /* 1) Face-on — finish before anything else */
      await tween(FACE_MS, (t) => {
        rotX = THREE.MathUtils.lerp(startRotX, 0, t);
        rotY = THREE.MathUtils.lerp(startRotY, 0, t);
        rotZ = THREE.MathUtils.lerp(startRotZ, 0, t);
        targetRotX = rotX;
        targetRotY = rotY;
        targetRotZ = rotZ;
        bookGroup.rotation.set(rotX, rotY, rotZ);
        camera.lookAt(viewSphere.center);
      }, easePhysical);

      /* 2) Reader layout (mobile: upright → CW 90° settle → open cover) */
      setOpeningChrome(true);
      setReadingChrome(true);
      if (isMobileBook()) setStagePreRotate(true);
      const hud = document.getElementById('book-reader-hud');
      if (hud) hud.hidden = true;

      fitCamera();
      await waitForReadableCanvas();
      fitCamera();

      if (isMobileBook()) {
        await waitFrames(1);
        setStagePreRotate(false); /* ease into default CW 90° */
        await waitStageRotate();
        fitCamera();
        reader.resize();
      }

      /* Same-frame handoff: cover framing + hide 3D book before cover anim */
      fitCamera();
      const fromPose = coverCameraPose();
      camera.fov = fromPose.fov;
      camera.position.copy(fromPose.position);
      camera.lookAt(fromPose.lookAt);
      camera.updateProjectionMatrix();
      reader.showClosedCover();
      bookGroup.visible = false;
      bookGroup.position.set(0, 0, 0);
      bookGroup.rotation.set(0, 0, 0);
      bookGroup.scale.set(1, 1, 1);
      renderFrame();

      await reader.playCoverOpen(COVER_OPEN_MS, {
        from: fromPose,
        to: readingCameraPose(),
      });

      /* Settle on reading framing after cover open */
      const readPose = readingCameraPose();
      camera.fov = readPose.fov;
      camera.position.copy(readPose.position);
      camera.lookAt(readPose.lookAt);
      camera.updateProjectionMatrix();
      reader.resize();

      if (hud) {
        updateReaderHud(reader.getSpread(), spreadPages(reader.getSpread()));
      }

      setOpeningChrome(false);
      mode = 'reading';
      reader.bindControls();
      canvas.focus({ preventScroll: true });
    } catch (err) {
      console.error('[BookViewer] openBook failed:', err);
      reader?.dispose();
      reader = null;
      bookGroup.visible = true;
      bookGroup.position.set(0, 0, 0);
      bookGroup.scale.set(1, 1, 1);
      mode = 'closed';
      setOpeningChrome(false);
      setReadingChrome(false);
      setStagePreRotate(false);
      fitBookToView();
    } finally {
      opening = false;
    }
  }

  async function closeBook() {
    if (opening || mode !== 'reading') return;
    opening = true;

    reader?.unbindControls();
    reader?.hide();

    const hud = document.getElementById('book-reader-hud');
    if (hud) hud.hidden = true;

    bookGroup.visible = true;
    bookGroup.position.set(0, 0, 0);
    bookGroup.scale.set(1, 1, 1);
    /* Face-on while mobile stage spins back, then rest to idle tilt */
    rotX = targetRotX = 0;
    rotY = targetRotY = 0;
    rotZ = targetRotZ = 0;
    bookGroup.rotation.set(0, 0, 0);

    if (isMobileBook()) {
      setOpeningChrome(true);
      fitCamera();
      await waitFrames(1);
      setStagePreRotate(true); /* CW 90° → upright */
      await waitStageRotate();
    }

    setReadingChrome(false);
    setOpeningChrome(false);
    setStagePreRotate(false);
    mode = 'closed';

    rotX = targetRotX = DEFAULT_ROT_X;
    rotY = targetRotY = DEFAULT_ROT_Y;
    rotZ = targetRotZ = DEFAULT_ROT_Z;
    bookGroup.rotation.set(DEFAULT_ROT_X, DEFAULT_ROT_Y, DEFAULT_ROT_Z);
    fitBookToView();
    opening = false;
  }

  function isMobileReaderRotated() {
    return (
      !!canvas &&
      window.matchMedia('(max-width: 900px)').matches &&
      !document.body.classList.contains('is-book-pre-rotate') &&
      (document.body.classList.contains('is-book-reading') ||
        document.body.classList.contains('is-book-opening'))
    );
  }

  function getDisplaySize() {
    if (!canvas) return { w: 1, h: 1 };
    /* CSS rotate(90deg) on the stage makes getBoundingClientRect() return
       the screen AABB (portrait). Use layout client size instead. */
    if (isMobileReaderRotated()) {
      return {
        w: Math.max(1, canvas.clientWidth),
        h: Math.max(1, canvas.clientHeight),
      };
    }
    const host = canvas.parentElement || canvas;
    const rect = host.getBoundingClientRect();
    return {
      w: Math.max(1, rect.width),
      h: Math.max(1, rect.height),
    };
  }

  function ensurePixelPass(bw, bh) {
    if (!pixelPass) {
      const passScene = new THREE.Scene();
      const passCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const rt = new THREE.WebGLRenderTarget(bw, bh, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.NearestFilter,
        generateMipmaps: false,
      });
      const quad = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.MeshBasicMaterial({
          map: rt.texture,
          toneMapped: false,
          transparent: true,
          depthTest: false,
          depthWrite: false,
        }),
      );
      passScene.add(quad);
      pixelPass = { rt, scene: passScene, camera: passCamera, quad };
      return;
    }
    if (pixelPass.rt.width !== bw || pixelPass.rt.height !== bh) {
      pixelPass.rt.setSize(bw, bh);
      pixelPass.quad.material.map = pixelPass.rt.texture;
      pixelPass.quad.material.needsUpdate = true;
    }
  }

  function disposePixelPass() {
    pixelPass?.rt?.dispose();
    pixelPass?.quad?.geometry?.dispose();
    pixelPass?.quad?.material?.dispose();
    pixelPass = null;
  }

  function fitCamera() {
    const { w, h } = getDisplaySize();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const dpr = Math.min(window.devicePixelRatio, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
  }

  function renderFrame() {
    if (pixelBlock > 1.05) {
      const { w, h } = getDisplaySize();
      const dpr = Math.min(window.devicePixelRatio, 2);
      const scale = pixelBlock;
      const bw = Math.max(12, Math.round((w * dpr) / scale));
      const bh = Math.max(12, Math.round((h * dpr) / scale));
      ensurePixelPass(bw, bh);
      renderer.setRenderTarget(pixelPass.rt);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(pixelPass.scene, pixelPass.camera);
      return;
    }
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  }

  function updatePixelReveal() {
    if (!pixelRevealStart) return;
    const t = Math.min(1, (performance.now() - pixelRevealStart) / PIXEL_REVEAL_MS);
    const eased = 1 - (1 - t) ** 3;
    pixelBlock = PIXEL_REVEAL_MAX * (1 - eased) + 1;
    if (t >= 1) {
      pixelRevealStart = 0;
      pixelBlock = 1;
      canvas.classList.remove('is-pixel-revealing');
    }
  }

  function holdPixelated() {
    pixelRevealStart = 0;
    pixelBlock = PIXEL_REVEAL_MAX;
    canvas?.classList.add('is-pixel-revealing');
  }

  function startPixelReveal() {
    if (!canvas || !active) return;
    pendingEntranceReveal = false;
    pixelRevealStart = performance.now();
    pixelBlock = PIXEL_REVEAL_MAX;
    canvas.classList.add('is-pixel-revealing');
  }

  /**
   * Called when homepage intro ends (or is skipped).
   * Mobile: wait 2 frames so shell unhide + layout settle before animating.
   */
  function startEntranceReveal() {
    if (!canvas || !active) {
      pendingEntranceReveal = true;
      holdPixelated();
      return;
    }
    const run = () => {
      if (!active || !canvas) return;
      fitCamera();
      startPixelReveal();
    };
    if (isMobileBook()) {
      requestAnimationFrame(() => {
        requestAnimationFrame(run);
      });
      return;
    }
    run();
  }

  /** Hold pixelated during intro; otherwise reveal (or flush pending skip) */
  function schedulePixelReveal() {
    if (!canvas) return;
    if (document.body.classList.contains('is-emax-intro')) {
      holdPixelated();
      return;
    }
    if (pendingEntranceReveal) {
      startEntranceReveal();
      return;
    }
    startPixelReveal();
  }

  function fitBookToView() {
    if (!camera || !viewSphere) return;
    camera.fov = CLOSED_FOV;
    fitCamera();
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const radius = viewSphere.radius * VIEW_MARGIN;
    const dist = radius / Math.sin(fov * 0.5);
    camera.position.set(
      viewSphere.center.x + radius * CLOSED_CAM_X,
      viewSphere.center.y + radius * CLOSED_CAM_Y,
      viewSphere.center.z + dist,
    );
    camera.lookAt(viewSphere.center);
    camera.updateProjectionMatrix();
  }

  function onResize() {
    if (!active) return;
    if (mode === 'reading' && reader) {
      fitCamera();
      reader.resize();
    } else if (mode === 'opening') {
      fitCamera();
    } else fitBookToView();
  }

  function isMobileBook() {
    return window.matchMedia(MOBILE_BOOK_MQ).matches;
  }

  function clearPinch() {
    pinchPointers.clear();
    pinchStartDist = 0;
    pinchArmed = false;
    pinchTriggered = false;
  }

  function stopClosedDrag(e) {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove('is-dragging');
    if (pointerCaptured) {
      try {
        canvas.releasePointerCapture?.(e?.pointerId);
      } catch (_) {}
      pointerCaptured = false;
    }
  }

  function onPinchPointerDown(e) {
    if (!active || !isMobileBook()) return;
    pinchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchPointers.size < 2) return;

    const pts = [...pinchPointers.values()];
    pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    pinchArmed = pinchStartDist >= PINCH_MIN_START;
    pinchTriggered = false;
    stopClosedDrag(e);
    reader?.cancelPointer?.();
  }

  function onPinchPointerMove(e) {
    if (!active || !isMobileBook() || !pinchPointers.has(e.pointerId)) return;
    pinchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinchArmed || pinchTriggered || pinchPointers.size < 2 || opening) return;

    const pts = [...pinchPointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const ratio = dist / Math.max(1, pinchStartDist);

    if (mode === 'closed' && ratio >= PINCH_OUT_RATIO) {
      pinchTriggered = true;
      openBook();
      return;
    }
    if (mode === 'reading' && ratio <= PINCH_IN_RATIO) {
      pinchTriggered = true;
      closeBook();
    }
  }

  function onPinchPointerUp(e) {
    if (!pinchPointers.has(e.pointerId)) return;
    pinchPointers.delete(e.pointerId);
    if (pinchPointers.size < 2) {
      pinchArmed = false;
      pinchStartDist = 0;
      pinchTriggered = false;
    }
  }

  function onPointerDown(e) {
    if (!active || opening || mode !== 'closed') return;
    if (isMobileBook() && pinchPointers.size >= 1) return;

    pointerDownX = e.clientX;
    pointerDownY = e.clientY;
    pointerMoved = false;
    pointerCaptured = false;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  }

  function onPointerMove(e) {
    if (!dragging || mode !== 'closed') return;
    if (isMobileBook() && pinchPointers.size >= 2) return;

    const dx = e.clientX - pointerDownX;
    const dy = e.clientY - pointerDownY;
    if (!pointerMoved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      pointerMoved = true;
      canvas.classList.add('is-dragging');
      if (!pointerCaptured) {
        canvas.setPointerCapture?.(e.pointerId);
        pointerCaptured = true;
      }
    }
    if (!pointerMoved) return;

    targetRotY += (e.clientX - lastX) * 0.008;
    targetRotX += (e.clientY - lastY) * 0.008;
    targetRotX = THREE.MathUtils.clamp(targetRotX, -1.1, 1.1);
    lastX = e.clientX;
    lastY = e.clientY;
  }

  function tryOpenOnDoubleTap(e) {
    const now = performance.now();
    const dist = Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY);
    if (now - lastTapTime < DBL_TAP_MS && dist < DBL_TAP_DIST) {
      lastTapTime = 0;
      openBook();
      return true;
    }
    lastTapTime = now;
    lastTapX = e.clientX;
    lastTapY = e.clientY;
    return false;
  }

  function onPointerUp(e) {
    onPinchPointerUp(e);
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove('is-dragging');
    if (pointerCaptured) {
      canvas.releasePointerCapture?.(e.pointerId);
      pointerCaptured = false;
    }

    /* Desktop only — mobile opens via pinch-out */
    if (!isMobileBook() && !pointerMoved && mode === 'closed' && !opening) {
      tryOpenOnDoubleTap(e);
    }
  }

  function onDoubleClick(e) {
    if (!active || opening || mode !== 'closed') return;
    if (isMobileBook()) return;
    e.preventDefault();
    lastTapTime = 0;
    openBook();
  }

  function bindPointer() {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerdown', onPinchPointerDown);
    canvas.addEventListener('dblclick', onDoubleClick);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointermove', onPinchPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('resize', onResize);
  }

  function unbindPointer() {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointerdown', onPinchPointerDown);
    canvas.removeEventListener('dblclick', onDoubleClick);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointermove', onPinchPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('resize', onResize);
    clearPinch();
  }

  function animate() {
    if (!active) return;
    const dt = Math.min(clock.getDelta(), 0.032);
    if (mode === 'closed' && !opening) {
      updatePixelReveal();
      rotX += (targetRotX - rotX) * (1 - Math.exp(-dt * 10));
      rotY += (targetRotY - rotY) * (1 - Math.exp(-dt * 10));
      rotZ += (targetRotZ - rotZ) * (1 - Math.exp(-dt * 10));
      bookGroup.rotation.set(rotX, rotY, rotZ);
    } else if (mode === 'reading' && reader) {
      reader.tick();
    }
    renderFrame();
    rafId = requestAnimationFrame(animate);
  }

  async function waitForCanvasSize(maxTries = 40) {
    for (let i = 0; i < maxTries; i++) {
      if (canvas.clientWidth >= 40 && canvas.clientHeight >= 40) return;
      await new Promise((r) => requestAnimationFrame(r));
    }
  }

  function getLenticularScreenRect() {
    if (!lenticularMesh || !camera || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const vw = Math.max(1, rect.width);
    const vh = Math.max(1, rect.height);
    lenticularMesh.updateMatrixWorld(true);
    const { width: w, height: h } = lenticularMesh.geometry.parameters;
    const corners = [
      new THREE.Vector3(-w / 2, -h / 2, 0),
      new THREE.Vector3(w / 2, -h / 2, 0),
      new THREE.Vector3(-w / 2, h / 2, 0),
      new THREE.Vector3(w / 2, h / 2, 0),
    ];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of corners) {
      c.applyMatrix4(lenticularMesh.matrixWorld);
      c.project(camera);
      const sx = (c.x * 0.5 + 0.5) * vw + rect.left;
      const sy = (-c.y * 0.5 + 0.5) * vh + rect.top;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }
    return {
      left: minX,
      top: minY,
      width: maxX - minX,
      height: maxY - minY,
      centerX: (minX + maxX) * 0.5,
      centerY: (minY + maxY) * 0.5,
    };
  }

  function showError(err) {
    if (!canvas) return;
    canvas.classList.add('is-error', 'is-loaded');
    console.error('[BookViewer]', err);
    const tip = document.createElement('p');
    tip.className = 'detail-visual__fallback';
    tip.textContent = `3D book failed: ${err?.message || err}. Use local server (bash preview.sh).`;
    canvas.parentElement?.appendChild(tip);
  }

  async function init(containerId) {
    canvas = document.getElementById(containerId);
    if (!canvas || active) return false;

    try {
      active = true;
      clock = new THREE.Clock();

      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.58;
      renderer.sortObjects = true;

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(32, 1, 0.05, 80);

      await waitForCanvasSize();

      pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      let envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = envMap;

      await new Promise((resolve) => {
        new RGBELoader().load(
          HDR_URL,
          (hdr) => {
            envMap = pmrem.fromEquirectangular(hdr).texture;
            scene.environment = envMap;
            hdr.dispose();
            resolve();
          },
          undefined,
          () => resolve(),
        );
      });

      const key = new THREE.DirectionalLight(0xfff8f0, 3.1);
      key.position.set(-4.5, 5.5, 7.5);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xc8d4e4, 0.95);
      fill.position.set(4, -1.5, 3.5);
      scene.add(fill);
      const rim = new THREE.DirectionalLight(0xf0f4fa, 1.65);
      rim.position.set(5, 2.5, -4.5);
      scene.add(rim);
      const front = new THREE.DirectionalLight(0xf4f6fa, 1.25);
      front.position.set(0, 1, 9);
      scene.add(front);
      const spineLight = new THREE.DirectionalLight(0xe8ecf2, 1.1);
      spineLight.position.set(-9, 2, 2);
      scene.add(spineLight);
      scene.add(new THREE.AmbientLight(0xa8b0bc, 0.68));
      scene.add(new THREE.HemisphereLight(0xd8dde8, 0x202428, 0.42));

      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => {
          requestAnimationFrame(() => onResize());
        });
        ro.observe(canvas);
        canvas.__bookRO = ro;
        if (canvas.parentElement) ro.observe(canvas.parentElement);
      }

      bookGroup = await buildBook(envMap);
      envMapRef = envMap;
      scene.add(bookGroup);
      bookGroup.rotation.set(DEFAULT_ROT_X, DEFAULT_ROT_Y, DEFAULT_ROT_Z);

      fitBookToView();
      bindPointer();
      requestAnimationFrame(() => fitBookToView());

      rafId = requestAnimationFrame(animate);
      canvas.classList.add('is-loaded');
      schedulePixelReveal();
      return true;
    } catch (err) {
      active = false;
      showError(err);
      return false;
    }
  }

  function destroy() {
    active = false;
    cancelAnimationFrame(rafId);
    pixelRevealStart = 0;
    pendingEntranceReveal = false;
    canvas?.classList.remove('is-pixel-revealing');
    disposePixelPass();
    reader?.dispose();
    reader = null;
    setReadingChrome(false);
    unbindPointer();
    canvas?.__bookRO?.disconnect();
    pmrem?.dispose();
    renderer?.dispose();
    scene = null;
    camera = null;
    bookGroup = null;
    viewSphere = null;
    lenticularMesh = null;
    canvas = null;
    mode = 'closed';
    opening = false;
  }

  return { init, destroy, getLenticularScreenRect, startEntranceReveal };
})();

window.BookViewer = BookViewer;
document.dispatchEvent(new CustomEvent('book:ready'));
