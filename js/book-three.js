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
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { BookReader, PAGE_W as READER_PAGE_W } from './book-reader.js?v=flip14';
import { SPREAD_COUNT, spreadPages } from './book-pages.js?v=p4';
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
  bookSide: ap('assets/book_side.png'),
  cloth: ap('assets/cloth.png'),
  grooveMask: ap('assets/groove-mask.png'),
  spineGrooveMask: ap('assets/spine-groove-mask.png'),
  lenticular: [ap('assets/lenticular-a.png'), ap('assets/lenticular-b.png'), ap('assets/lenticular-c.png')],
  /** Closed hardcover shell — textures applied at runtime */
  bookModel: ap('assets/archival_hardcover_book_untextured_update.glb'),
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

  const DRAG_THRESHOLD = 6;
  const MOBILE_BOOK_MQ = '(max-width: 900px)';

  let coverTexRef = null;
  let envMapRef = null;
  let lenticularMesh = null;
  let lenticularPhase = 0;
  let lenticularPhaseReady = false;
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

  function loadGltf(url) {
    return new Promise((resolve, reject) => {
      new GLTFLoader().load(url, resolve, undefined, reject);
    });
  }

  /**
   * Model ships without UVs — project planar UVs in model space:
   * cover faces = XZ, spine faces = YZ.
   */
  function applyPlanarUVs(geometry, mode = 'cover') {
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const pos = geometry.attributes.position;
    const uvs = new Float32Array(pos.count * 2);
    const sx = Math.max(1e-8, bb.max.x - bb.min.x);
    const sy = Math.max(1e-8, bb.max.y - bb.min.y);
    const sz = Math.max(1e-8, bb.max.z - bb.min.z);
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      let u;
      let v;
      if (mode === 'spine') {
        u = (y - bb.min.y) / sy;
        v = (z - bb.min.z) / sz;
      } else if (mode === 'coverBack') {
        /* Viewed from the outside after X−90°, +X reads right-to-left without this. */
        u = 1 - (x - bb.min.x) / sx;
        v = (z - bb.min.z) / sz;
      } else if (mode === 'cloth') {
        u = (y - bb.min.y) / sy;
        v = (z - bb.min.z) / sz;
      } else if (mode === 'block') {
        if (sx >= sy && sx >= sz) {
          u = (x - bb.min.x) / sx;
          v = sz >= sy ? (z - bb.min.z) / sz : (y - bb.min.y) / sy;
        } else if (sz >= sy) {
          u = (z - bb.min.z) / sz;
          v = (y - bb.min.y) / sy;
        } else {
          u = (x - bb.min.x) / sx;
          v = (y - bb.min.y) / sy;
        }
      } else {
        u = (x - bb.min.x) / sx;
        v = (z - bb.min.z) / sz;
      }
      uvs[i * 2] = u;
      uvs[i * 2 + 1] = v;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.attributes.uv.needsUpdate = true;
  }

  /**
   * GLB: Y = thickness (front on −Y), Z = height, spine at X=0.
   * Site: Z+ cover, Y+ up, spine −X. Scale face to COVER_W.
   */
  function fitArchivalBookModel(sceneRoot) {
    const wrapper = new THREE.Group();
    wrapper.name = 'glb-shell';
    const raw = sceneRoot;
    raw.rotation.x = -Math.PI / 2;
    wrapper.add(raw);
    wrapper.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(wrapper);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    raw.position.sub(center);
    const face = Math.max(size.x, size.y, 1e-6);
    wrapper.scale.setScalar(COVER_W / face);
    wrapper.updateMatrixWorld(true);
    return wrapper;
  }

  function applyClothUVs(geometry) {
    applyPlanarUVs(geometry, 'cloth');
  }

  function uvModeForMeshName(name) {
    const n = String(name || '');
    if (/spine cloth/i.test(n)) return 'cloth';
    if (/spine/i.test(n)) return 'spine';
    if (/book block/i.test(n)) return 'block';
    return 'cover';
  }

  function meshLabel(obj) {
    /* GLB nodes arrive as Front_Cover — normalize for matching */
    return String(obj.name || obj.parent?.name || '').replace(/_/g, ' ');
  }

  /** Solid box matching a mesh bbox — used when the GLB is missing faces. */
  function solidBoxFromGeometry(geometry) {
    geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox;
    const w = Math.max(1e-6, max.x - min.x);
    const h = Math.max(1e-6, max.y - min.y);
    const d = Math.max(1e-6, max.z - min.z);
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate((min.x + max.x) * 0.5, (min.y + max.y) * 0.5, (min.z + max.z) * 0.5);
    return geo;
  }

  /** Grow only the outer (−X) spine face so layers stay separated. */
  function thickenSpineOutward(geometry, extra) {
    return thickenAlongX(geometry, extra, 0);
  }

  /** Model X: min = outer spine, max = inward. Preserves hole topology. */
  function thickenAlongX(geometry, towardMin = 0, towardMax = 0) {
    const geo = geometry.clone();
    geo.computeBoundingBox();
    const mid = 0.5 * (geo.boundingBox.min.x + geo.boundingBox.max.x);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      pos.setX(i, x <= mid ? x - towardMin : x + towardMax);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    return geo;
  }

  /** Pull ±Y wrap off the cover outer faces so the spine/cover seam doesn't z-fight. */
  function insetExtremesY(geometry, eps) {
    geometry.computeBoundingBox();
    const minY = geometry.boundingBox.min.y;
    const maxY = geometry.boundingBox.max.y;
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const y = pos.getY(i);
      if (y <= minY + 1e-8) pos.setY(i, y + eps);
      else if (y >= maxY - 1e-8) pos.setY(i, y - eps);
    }
    pos.needsUpdate = true;
    geometry.computeBoundingBox();
  }

  /** Drop triangles that lie on an axis-aligned cap (the hinge/cover join wall). */
  function stripAxisCap(geometry, axis, plane, eps = 2e-6) {
    const pos = geometry.attributes.position;
    const idx = geometry.index;
    if (!pos || !idx) return geometry;
    const get =
      axis === 0 ? (i) => pos.getX(i) : axis === 1 ? (i) => pos.getY(i) : (i) => pos.getZ(i);
    const keep = [];
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i);
      const b = idx.getX(i + 1);
      const c = idx.getX(i + 2);
      if (
        Math.abs(get(a) - plane) < eps &&
        Math.abs(get(b) - plane) < eps &&
        Math.abs(get(c) - plane) < eps
      ) {
        continue;
      }
      keep.push(a, b, c);
    }
    geometry.setIndex(keep);
    return geometry;
  }

  /**
   * Fuse the hinge strip into the cover board so the 书脊槽 and boards
   * are one closed shell — no hairline at glancing angles.
   */
  function fuseHingeIntoCover(coverMesh, hingeMesh) {
    if (!coverMesh || !hingeMesh) return;
    const coverGeo = coverMesh.geometry;
    const hingeGeo = hingeMesh.geometry;
    coverGeo.computeBoundingBox();
    hingeGeo.computeBoundingBox();
    stripAxisCap(coverGeo, 0, coverGeo.boundingBox.min.x);
    stripAxisCap(hingeGeo, 0, hingeGeo.boundingBox.max.x);
    if (coverGeo.attributes.uv && !hingeGeo.attributes.uv) coverGeo.deleteAttribute('uv');
    if (hingeGeo.attributes.uv && !coverGeo.attributes.uv) hingeGeo.deleteAttribute('uv');
    const merged = mergeGeometries([coverGeo, hingeGeo], false);
    if (!merged) return;
    const welded = mergeVertices(merged, 1e-5);
    welded.computeVertexNormals();
    welded.computeBoundingBox();
    coverMesh.geometry = welded;
    hingeMesh.visible = false;
  }

  /** Tuck hinge end-caps behind the spine sheet (keeps groove profile). */
  function nudgeMinX(mesh, dx) {
    if (!mesh) return;
    const geo = mesh.geometry;
    geo.computeBoundingBox();
    const minX = geo.boundingBox.min.x;
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      if (pos.getX(i) <= minX + 1e-7) pos.setX(i, minX + dx);
    }
    pos.needsUpdate = true;
  }

  /** Grow the cover-side of a hinge so it slightly overlaps the board and hides the join. */
  function nudgeMaxX(mesh, dx) {
    if (!mesh) return;
    const geo = mesh.geometry;
    geo.computeBoundingBox();
    const maxX = geo.boundingBox.max.x;
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      if (pos.getX(i) >= maxX - 1e-7) pos.setX(i, maxX + dx);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingBox();
  }

  /**
   * GLB spine is a boolean-cut sheet: each hole's Z-loop cuts the whole width,
   * which shows as hairline seams. Rebuild a wrap with real X-thickness so
   * head/tail ends read as a closed board, not two paper-thin faces.
   */
  function replaceSpineAsCleanHoledWrap(spineMesh, recessMesh) {
    const s = geoBox(spineMesh);
    const r = recessMesh ? geoBox(recessMesh) : s;
    const yInset = 0.00012;
    const y0 = s.min.y + yInset;
    const y1 = s.max.y - yInset;
    const z0 = s.min.z;
    const z1 = s.max.z;
    const hy0 = -0.006;
    const hy1 = 0.006;
    const holeZ0 = 0.033;
    const holeSize = 0.012;
    const holeStride = 0.024;
    const holeCount = 9;
    const xOuter = s.min.x - 0.0004;
    const xInner = Math.max(s.max.x, r.min.x) + 0.0002;
    const depth = Math.max(0.00135, xInner - xOuter);
    const x0 = xOuter;

    const shape = new THREE.Shape();
    shape.moveTo(y0, z0);
    shape.lineTo(y1, z0);
    shape.lineTo(y1, z1);
    shape.lineTo(y0, z1);
    shape.closePath();

    for (let i = 0; i < holeCount; i += 1) {
      const za = holeZ0 + i * holeStride;
      const zb = za + holeSize;
      const hole = new THREE.Path();
      hole.moveTo(hy0, za);
      hole.lineTo(hy0, zb);
      hole.lineTo(hy1, zb);
      hole.lineTo(hy1, za);
      hole.closePath();
      shape.holes.push(hole);
    }

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: false,
      steps: 1,
      curveSegments: 1,
    });
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const y = pos.getX(i);
      const z = pos.getY(i);
      const x = x0 + pos.getZ(i);
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    applyPlanarUVs(geo, 'spine');
    spineMesh.geometry = geo;
  }

  /** Cap head/tail of the spine so wrap + backing read as one closed thickness. */
  function addSpineEndCaps(spineMesh, recessMesh) {
    const s = geoBox(spineMesh);
    const r = recessMesh ? geoBox(recessMesh) : s;
    const x0 = Math.min(s.min.x, r.min.x);
    const x1 = Math.max(s.max.x, r.max.x);
    const y0 = s.min.y;
    const y1 = s.max.y;
    const capZ = Math.max(0.00055, (x1 - x0) * 0.45);
    const makeCap = (zCenter) => {
      const geo = new THREE.BoxGeometry(x1 - x0, y1 - y0, capZ);
      geo.translate((x0 + x1) * 0.5, (y0 + y1) * 0.5, zCenter);
      applyPlanarUVs(geo, 'spine');
      const mesh = new THREE.Mesh(geo);
      mesh.name = 'Spine Cover Cap';
      spineMesh.add(mesh);
    };
    makeCap(s.min.z + capZ * 0.5);
    makeCap(s.max.z - capZ * 0.5);
  }

  /** Expand a cover board to X=0 so it meets the spine; hide the hinge gap. */
  function extendCoverToSpine(mesh, uvMode) {
    mesh.geometry.computeBoundingBox();
    const { min, max } = mesh.geometry.boundingBox;
    const geo = new THREE.BoxGeometry(max.x - 0, max.y - min.y, max.z - min.z);
    geo.translate(max.x * 0.5, (min.y + max.y) * 0.5, (min.z + max.z) * 0.5);
    applyPlanarUVs(geo, uvMode);
    mesh.geometry = geo;
  }

  function stretchCoverMinX(mesh, newMinX) {
    const geo = mesh.geometry;
    geo.computeBoundingBox();
    const oldMin = geo.boundingBox.min.x;
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      if (pos.getX(i) <= oldMin + 1e-5) pos.setX(i, newMinX);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingBox();
  }

  function geoBox(mesh) {
    mesh.geometry.computeBoundingBox();
    return mesh.geometry.boundingBox;
  }

  /**
   * Gray paper in cover/spine maps would tint silver. Keep dark ink, bleach the rest.
   */
  function silverInkMap(tex) {
    const img = imageFromTexture(tex);
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, c.width, c.height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      if (lum > 0.28) {
        d[i] = 255;
        d[i + 1] = 255;
        d[i + 2] = 255;
      }
    }
    ctx.putImageData(id, 0, 0);
    const out = new THREE.CanvasTexture(c);
    out.colorSpace = THREE.SRGBColorSpace;
    out.anisotropy = tex.anisotropy || 8;
    out.needsUpdate = true;
    return out;
  }

  /**
   * Book block: grow only in board thickness (model Y) to the inner covers.
   * Keep original X/Z so 飘口 remains on head, tail, and fore-edge.
   */
  function fillBookBlock(blockMesh, frontMesh, backMesh) {
    const f = geoBox(frontMesh);
    const b = geoBox(backMesh);
    const o = geoBox(blockMesh);
    const INTO = 0.00035;
    const minX = o.min.x;
    const maxX = o.max.x;
    const minZ = o.min.z;
    const maxZ = o.max.z;
    const minY = f.max.y - INTO;
    const maxY = b.min.y + INTO;
    const geo = new THREE.BoxGeometry(maxX - minX, maxY - minY, maxZ - minZ);
    geo.translate((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5);
    blockMesh.geometry = geo;
    return { minY, maxY };
  }

  /** 1mm spine cloth: keep X width + 飘口 Z, match filled block thickness. */
  function fillSpineCloth(clothMesh, blockY) {
    const c = geoBox(clothMesh);
    const geo = new THREE.BoxGeometry(
      c.max.x - c.min.x,
      blockY.maxY - blockY.minY,
      c.max.z - c.min.z,
    );
    geo.translate(
      (c.min.x + c.max.x) * 0.5,
      (blockY.minY + blockY.maxY) * 0.5,
      (c.min.z + c.max.z) * 0.5,
    );
    applyClothUVs(geo);
    clothMesh.geometry = geo;
  }

  /** Fine linen weave — no photo texture. */
  function makeClothWeaveMap() {
    const s = 128;
    const c = document.createElement('canvas');
    c.width = s;
    c.height = s;
    const ctx = c.getContext('2d');
    const id = ctx.createImageData(s, s);
    const d = id.data;
    for (let y = 0; y < s; y += 1) {
      for (let x = 0; x < s; x += 1) {
        const n = ((x * 17 + y * 31) % 7) - 3;
        const warp = (x + n * 0.15) % 3 < 1.45 ? 1 : 0;
        const weft = (y + n * 0.12) % 3 < 1.45 ? 1 : 0;
        const v = 150 + warp * 38 + weft * 28 + n;
        const i = (y * s + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, v));
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(id, 0, 0);
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.NoColorSpace;
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.anisotropy = 8;
    map.repeat.set(8, 28);
    map.needsUpdate = true;
    return map;
  }

  /** Matte silver cardstock: soft metal plus paper-like diffuse bounce. */
  function matteSilverMat(envMap, map, normalMap, opts = {}) {
    const mat = new THREE.MeshPhysicalMaterial({
      color: opts.color ?? 0x5e636a,
      metalness: opts.metalness ?? 0.62,
      roughness: opts.roughness ?? 0.56,
      map: map || null,
      normalMap: normalMap || null,
      normalScale: opts.normalScale ?? new THREE.Vector2(0.7, 0.7),
      envMap,
      envMapIntensity: opts.envMapIntensity ?? 0.82,
      clearcoat: opts.clearcoat ?? 0.16,
      clearcoatRoughness: opts.clearcoatRoughness ?? 0.50,
      sheen: opts.sheen ?? 0.52,
      sheenColor: opts.sheenColor ?? new THREE.Color(0xc8cdd3),
      sheenRoughness: opts.sheenRoughness ?? 0.74,
      side: opts.side ?? THREE.DoubleSide,
      flatShading: false,
      polygonOffset: !!opts.polygonOffset,
      polygonOffsetFactor: opts.polygonOffsetFactor ?? 0,
      polygonOffsetUnits: opts.polygonOffsetUnits ?? 0,
    });
    if (map) {
      map.colorSpace = THREE.SRGBColorSpace;
      map.needsUpdate = true;
    }
    return mat;
  }

  function flipWindingAndNormals(geometry) {
    const index = geometry.index;
    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const b = index.getX(i + 1);
        index.setX(i + 1, index.getX(i + 2));
        index.setX(i + 2, b);
      }
      index.needsUpdate = true;
    }
    const nrm = geometry.attributes.normal;
    if (nrm) {
      for (let i = 0; i < nrm.count; i += 1) {
        nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
      }
      nrm.needsUpdate = true;
    } else {
      geometry.computeVertexNormals();
    }
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

  function cloneMap(src, colorSpace) {
    const map = src.clone();
    map.colorSpace = colorSpace;
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = src.anisotropy || 8;
    map.needsUpdate = true;
    return map;
  }

  /** Dark block with clustered, slightly uneven pale-gray page-edge lines. */
  function darkPageEdgeMap() {
    const w = 256;
    const h = 512;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#22211c';
    ctx.fillRect(0, 0, w, h);

    const rnd = (n) => {
      const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
      return x - Math.floor(x);
    };

    /* Signature-like clusters: tight lines, uneven gaps between groups */
    const groups = [2, 4, 1, 3, 2, 3, 1, 2];
    const raw = [];
    let y = 0;
    groups.forEach((count, g) => {
      y += 22 + rnd(g + 2) * 54;
      for (let i = 0; i < count; i += 1) {
        y += i === 0 ? 0 : 3 + rnd(raw.length + 40) * 9;
        raw.push(y);
      }
    });
    const y0 = raw[0];
    const span = Math.max(1, raw[raw.length - 1] - y0);
    const top = 18;
    const bot = h - 18;
    raw.forEach((ry, n) => {
      const baseY = top + ((ry - y0) / span) * (bot - top);
      const amp = 0.6 + rnd(n + 8) * 1.8;
      const waves = 1 + Math.floor(rnd(n + 21) * 3);
      const phase = rnd(n + 33) * Math.PI * 2;
      const a = 0.14 + rnd(n + 5) * 0.18;
      ctx.fillStyle = `rgba(88, 86, 80, ${a})`;
      for (let x = 0; x < w; x += 1) {
        const wobble =
          Math.sin((x / w) * Math.PI * 2 * waves + phase) * amp +
          (rnd(n * 100 + x) - 0.5) * 0.7;
        const py = Math.round(baseY + wobble);
        if (py < 1 || py >= h - 1) continue;
        if (rnd(n * 80 + x * 3) < 0.07) continue;
        ctx.fillRect(x, py, 1, 1);
      }
    });

    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.needsUpdate = true;
    return map;
  }

  /** 书芯：封面/封底朝向面纯色，切口画浅灰细线模拟纸页 */
  function pageBlockMaterials() {
    const map = darkPageEdgeMap();
    const edge = new THREE.MeshStandardMaterial({
      map,
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0,
    });
    const face = new THREE.MeshStandardMaterial({
      color: 0x22211c,
      roughness: 0.9,
      metalness: 0,
    });
    /* BoxGeometry groups: +x -x +y -y +z -z ; Y = thickness toward covers */
    return [edge, edge, face, face, edge, edge];
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
        uPhase: { value: 0 },
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
        uniform float uPhase;
        varying vec2 vUv;
        varying vec3 vNormalW;
        varying vec3 vViewW;
        void main() {
          vec3 n = normalize(vNormalW);
          vec3 v = normalize(vViewW);
          vec3 tRaw = cross(n, vec3(0.0, 1.0, 0.0));
          vec3 t = length(tRaw) < 0.001 ? vec3(1.0, 0.0, 0.0) : normalize(tRaw);
          float parallax = dot(v, t);
          float az = atan(dot(v, t), dot(v, n));
          /* More cycles per orbit + sharper A falloff: a small turn swaps frames. */
          float cycle = fract((az / 6.2831853 + 0.5 + uPhase) * 3.0);
          float tri = cycle * 3.0;
          float dA = min(abs(tri), abs(tri - 3.0));
          float dB = abs(tri - 1.0);
          float dC = abs(tri - 2.0);
          float wA = pow(max(0.0, 1.0 - dA), 2.6);
          float wB = max(0.0, 1.0 - dB);
          float wC = max(0.0, 1.0 - dC);
          float wsum = max(1e-5, wA + wB + wC);
          vec3 c =
            (texture2D(texA, vUv).rgb * wA +
             texture2D(texB, vUv).rgb * wB +
             texture2D(texC, vUv).rgb * wC) / wsum;
          float ridge = sin(vUv.y * 380.0 + parallax * 14.0);
          c *= 0.89 + 0.11 * ridge;
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
    mat.depthWrite = false;
    mat.side = THREE.DoubleSide;
    return mat;
  }

  function lenticularViewAzimuth() {
    if (!lenticularMesh || !camera) return 0;
    lenticularMesh.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const n = new THREE.Vector3(0, 0, 1).transformDirection(lenticularMesh.matrixWorld).normalize();
    const origin = new THREE.Vector3().setFromMatrixPosition(lenticularMesh.matrixWorld);
    const v = camera.position.clone().sub(origin).normalize();
    const tRaw = new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 1, 0));
    const t = tRaw.lengthSq() < 1e-8 ? new THREE.Vector3(1, 0, 0) : tRaw.normalize();
    return Math.atan2(v.dot(t), v.dot(n));
  }

  function updateLenticularBlend() {
    const mat = lenticularMesh?.material;
    if (!mat?.uniforms?.uPhase) return;
    if (!lenticularPhaseReady) {
      lenticularPhase = -lenticularViewAzimuth() / (Math.PI * 2) - 0.5;
      lenticularPhaseReady = true;
    }
    mat.uniforms.uPhase.value = lenticularPhase;
  }

  async function buildBook(envMap) {
    const texPack = await Promise.all([
      loadTex(ASSETS.spine),
      loadTex(ASSETS.grooveMask, THREE.NoColorSpace),
      loadTex(ASSETS.spineGrooveMask, THREE.NoColorSpace),
      loadTex(ASSETS.back),
      loadTex(ASSETS.cover),
      ...ASSETS.lenticular.map((u) => loadTex(u)),
    ]);
    const [spineTex, , , backTex, coverTex, ...lentTexs] =
      texPack;
    const gltf = await loadGltf(ASSETS.bookModel);

    const SILVER = 0x5e636a;
    const backInk = silverInkMap(backTex);
    backInk.wrapS = THREE.RepeatWrapping;
    backInk.repeat.x = -1;
    backInk.offset.x = 1;
    backInk.needsUpdate = true;
    const spineInk = silverInkMap(spineTex);

    /*
     * Keep GLB topology for hinges (smooth 书脊槽) and spine (9 square wells).
     * Only close hollow back/block shells, and grow the block in thickness.
     */
    const meshIndex = {};
    gltf.scene.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.geometry = obj.geometry.clone();
      meshIndex[meshLabel(obj)] = obj;
    });
    const frontMesh = meshIndex['Front Cover'];
    const backMesh = meshIndex['Back Cover'];
    const spineMesh = meshIndex['Spine Cover'];
    const blockMesh = meshIndex['Book Block'];
    const clothMesh = meshIndex['Spine Cloth'];
    const recessBackMesh = meshIndex['Spine Recess Backing'];
    const frontHinge = meshIndex['Front Cover Hinge Transition'];
    const backHinge = meshIndex['Back Cover Hinge Transition'];

    backMesh.geometry = solidBoxFromGeometry(backMesh.geometry);

    /* Clean holed wrap — GLB boolean seams ran the full spine width. */
    replaceSpineAsCleanHoledWrap(spineMesh, recessBackMesh);
    /* One closed board: hinge groove fused into front/back, no join wall. */
    fuseHingeIntoCover(frontMesh, frontHinge);
    fuseHingeIntoCover(backMesh, backHinge);
    nudgeMinX(frontMesh, 0.00022);
    nudgeMinX(backMesh, 0.00022);
    applyPlanarUVs(frontMesh.geometry, 'cover');
    applyPlanarUVs(backMesh.geometry, 'cover');
    if (recessBackMesh) {
      recessBackMesh.geometry = thickenAlongX(recessBackMesh.geometry, 0, 0.0004);
      applyPlanarUVs(recessBackMesh.geometry, 'spine');
      insetExtremesY(recessBackMesh.geometry, 0.00012);
    }
    addSpineEndCaps(spineMesh, recessBackMesh);

    const blockY = fillBookBlock(blockMesh, frontMesh, backMesh);
    if (clothMesh) fillSpineCloth(clothMesh, blockY);

    gltf.scene.traverse((obj) => {
      if (!obj.isMesh) return;
      const name = meshLabel(obj);
      if (
        name === 'Back Cover' ||
        name === 'Spine Cover' ||
        name === 'Book Block' ||
        name === 'Spine Cloth' ||
        name === 'Spine Recess Backing'
      ) {
        return;
      }
      applyPlanarUVs(obj.geometry, uvModeForMeshName(name));
    });

    const matSilver = matteSilverMat(envMap, null, null, {
      color: SILVER,
    });
    const matBack = matteSilverMat(envMap, backInk, null, {
      color: SILVER,
    });
    const matSpine = matteSilverMat(envMap, spineInk, null, {
      color: SILVER,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const clothMap = makeClothWeaveMap();
    const clothBump = clothMap.clone();
    const matCloth = new THREE.MeshStandardMaterial({
      map: clothMap,
      bumpMap: clothBump,
      bumpScale: 0.005,
      color: 0x3a3568,
      emissive: 0x3a3568,
      emissiveIntensity: 0.03,
      roughness: 0.88,
      metalness: 0,
      envMap,
      envMapIntensity: 0.16,
      side: THREE.DoubleSide,
    });
    const matWell = matteSilverMat(envMap, spineInk, null, {
      color: SILVER,
      side: THREE.FrontSide,
    });
    const matHinge = matteSilverMat(envMap, null, null, {
      color: SILVER,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const matBlock = pageBlockMaterials();

    const group = new THREE.Group();
    const shell = fitArchivalBookModel(gltf.scene);
    shell.name = 'case-shell';

    shell.traverse((obj) => {
      if (!obj.isMesh) return;
      const name = meshLabel(obj);
      obj.castShadow = false;
      obj.receiveShadow = false;
      obj.frustumCulled = true;

      if (/Front Cover Center Insert/i.test(name)) {
        obj.visible = false;
      } else if (/Front Cover Recess Floor/i.test(name)) {
        obj.material = matSilver;
        obj.visible = true;
        obj.renderOrder = 2;
      } else if (/Front Cover Hinge/i.test(name) || /Back Cover Hinge/i.test(name)) {
        obj.material = matHinge;
        obj.renderOrder = 4;
      } else if (/^Front Cover$/i.test(name)) {
        obj.material = matSilver;
        obj.renderOrder = 3;
      } else if (/^Back Cover$/i.test(name)) {
        obj.material = matBack;
        obj.renderOrder = 3;
      } else if (/Spine Cover/i.test(name)) {
        obj.material = matSpine;
        obj.renderOrder = 5;
      } else if (/Spine Cloth/i.test(name)) {
        obj.material = matCloth;
        obj.visible = true;
        obj.renderOrder = 2;
      } else if (/Spine Recess/i.test(name)) {
        obj.material = matWell;
        obj.visible = true;
        obj.renderOrder = 1;
      } else if (/Book Block/i.test(name)) {
        obj.material = matBlock;
        obj.renderOrder = 1;
      } else {
        obj.material = matSilver;
        obj.renderOrder = 2;
      }
    });

    shell.traverse((obj) => {
      if (obj.isMesh && /^Front Cover$/i.test(meshLabel(obj))) obj.name = 'cover-front';
      if (obj.isMesh && /^Back Cover$/i.test(meshLabel(obj))) obj.name = 'cover-back';
    });

    group.add(shell);

    shell.updateMatrixWorld(true);
    let recessMesh = null;
    let insertMesh = null;
    shell.traverse((obj) => {
      if (!obj.isMesh) return;
      const n = meshLabel(obj);
      if (/Front Cover Recess Floor/i.test(n)) recessMesh = obj;
      if (/Front Cover Center Insert/i.test(n)) insertMesh = obj;
    });
    const recessBox = new THREE.Box3().setFromObject(recessMesh || insertMesh || shell);
    const insertBox = new THREE.Box3().setFromObject(insertMesh || recessMesh || shell);
    const recessSize = recessBox.getSize(new THREE.Vector3());
    const recessCenter = recessBox.getCenter(new THREE.Vector3());
    /* Sheet sits inside a slightly larger well — rim from Recess Floor. */
    const rim = Math.min(recessSize.x, recessSize.y) * 0.03;
    const lentW = Math.max(0.01, recessSize.x - rim * 2);
    const lentH = Math.max(0.01, recessSize.y - rim * 2);
    const zOut = Math.max(recessBox.max.z, insertBox.max.z);
    const zIn = Math.min(recessBox.max.z, insertBox.max.z);
    const lenticular = new THREE.Mesh(
      new THREE.PlaneGeometry(lentW, lentH),
      lenticularMat(lentTexs),
    );
    lenticular.position.set(
      recessCenter.x,
      recessCenter.y,
      zIn + (zOut - zIn) * 0.28,
    );
    lenticular.renderOrder = 10;
    lenticular.name = 'lenticular';
    group.add(lenticular);
    lenticularMesh = lenticular;

    group.updateMatrixWorld(true);
    viewSphere = new THREE.Sphere();
    new THREE.Box3().setFromObject(group).getBoundingSphere(viewSphere);
    coverTexRef = coverTex;
    window.__bookGroup = group;
    window.__bookDebug = [];
    group.traverse((obj) => {
      if (!obj.isMesh) return;
      const b = new THREE.Box3().setFromObject(obj);
      const s = b.getSize(new THREE.Vector3());
      window.__bookDebug.push({
        name: obj.name || meshLabel(obj),
        vis: obj.visible,
        map: !!(obj.material && obj.material.map),
        size: [+s.x.toFixed(4), +s.y.toFixed(4), +s.z.toFixed(4)],
        z: [+b.min.z.toFixed(4), +b.max.z.toFixed(4)],
      });
    });
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
    /* Reader lives on /emax/inside — no in-page 3D→flat handoff */
    if (opening) return;
    location.assign(ap('emax/inside/'));
  }

  async function closeBook() {
    /* Reading mode is a separate page; nothing to close here */
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

  function onPointerDown(e) {
    if (!active || opening || mode !== 'closed') return;

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

  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove('is-dragging');
    if (pointerCaptured) {
      canvas.releasePointerCapture?.(e.pointerId);
      pointerCaptured = false;
    }
  }

  function bindPointer() {
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('resize', onResize);
  }

  function unbindPointer() {
    canvas.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('resize', onResize);
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
      updateLenticularBlend();
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

      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
      renderer.setClearColor(0x000000, 1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.32;
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

      const key = new THREE.DirectionalLight(0xfff8f0, 1.65);
      key.position.set(-4.5, 5.5, 7.5);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xc8d4e4, 1.24);
      fill.position.set(4, -1.5, 3.5);
      scene.add(fill);
      const rim = new THREE.DirectionalLight(0xf0f4fa, 1.15);
      rim.position.set(5, 2.5, -4.5);
      scene.add(rim);
      const front = new THREE.DirectionalLight(0xf4f6fa, 1.08);
      front.position.set(0, 1, 9);
      scene.add(front);
      const spineLight = new THREE.DirectionalLight(0xe8ecf2, 1.25);
      spineLight.position.set(-9, 2, 2);
      scene.add(spineLight);
      scene.add(new THREE.AmbientLight(0xb4bcc6, 0.86));
      scene.add(new THREE.HemisphereLight(0xe0e4ee, 0x2a2e34, 0.68));

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
      window.__setBookRot = (x, y, z) => {
        rotX = targetRotX = x;
        rotY = targetRotY = y;
        rotZ = targetRotZ = z;
      };
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
    lenticularPhaseReady = false;
    canvas = null;
    mode = 'closed';
    opening = false;
  }

  return { init, destroy, getLenticularScreenRect, startEntranceReveal };
})();

window.BookViewer = BookViewer;
document.dispatchEvent(new CustomEvent('book:ready'));
