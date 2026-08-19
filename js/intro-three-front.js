/* 风动片 · InstancedMesh · 正交正面 · 侧光 PBR · 指针风场（同 index，仅视角正交） */

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CORE_SIZE, INTRO_ZONES, cellToZone, zoneAt, zoneHref } from './intro-zones.js';

const IntroGrid = (() => {
  const STIFFNESS = 44;
  const DAMPING = 5.8;
  const COUPLING = 13.5;
  const WIND_GAIN = 3.35;
  const IDLE_BREEZE = 0.038;
  const MAX_ANGLE = 2.78;
  const POINTER_FLIP_MAX = Math.PI / 2 * 0.92;
  const GAP_PX = 4;
  const FLAP_DEPTH = 0.05;
  const CELL_PX = 96;
  const FILL_MARGIN = 1.04;
  const POINTER_MOVE_MIN = 4;
  /** Mobile: drag past this cancels tap-to-enter (desktop unchanged) */
  const MOBILE_TAP_MOVE_MAX = 14;
  const MOBILE_INTRO_MQ = '(max-width: 900px)';
  /** Mic blow → wind (mobile only) */
  const BLOW_FLOOR = 0.018;
  const BLOW_CEIL = 0.15;
  const BLOW_ATTACK = 0.68;
  const BLOW_RELEASE = 0.1;
  const BLOW_GAIN = 3.1;
  const BLOW_SPIKE_DECAY = 0.52;
  const BLOW_DIR_SMOOTH = 0.32;
  const BLOW_STEREO_SMOOTH = 0.38;
  /** L/R pan threshold — only stereo pan above this switches lanes */
  const BLOW_LANE_THRESHOLD = 0.18;
  const BLOW_LANE_SMOOTH = 0.36;
  const BLOW_STEREO_MIN = 0.13;
  const BLOW_LANE_X = { left: 0.24, center: 0.5, right: 0.76 };
  const HDR_URL =
    'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr';
  const LOOK_AT = new THREE.Vector3(0, 0, 0);
  const FRONT_VIEW_H = 8.4;
  const FRONT_DISTANCE = 18;

  let canvas = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let mesh = null;
  let wallGroup = null;
  let cellSize = 0;
  let pmrem = null;
  let resizeObserver = null;
  let flaps = [];
  let cols = 0;
  let rows = 0;
  let windRadius = 3;
  let wallCoverage = null;
  let active = false;
  let rafId = 0;
  let clock = null;
  let canvasRect = null;
  let padCol = 0;
  let padRow = 0;
  let gridStartX = 0;
  let gridStartY = 0;
  let zoneTextures = {};
  let artMeshes = [];
  let hoveredZone = null;
  const zoneFadeState = new Map();
  let texturesLoaded = false;
  let transitioning = false;
  let zoomTransitionActive = false;
  let zoomBurstT = 0;

  const EMAX_ZC = 0;
  const EMAX_ZR = 0;
  const EMAX_LIFT_Z = 0.92;
  const EMAX_LIFT_SPREAD = 0.32;
  const EMAX_LIFT_RISE = 0.22;
  const EMAX_LIFT_SPRING = 36;
  const EMAX_LIFT_DAMP = 8.5;
  const COLOR_EMAX = new THREE.Color(0x8b7cff);
  const COLOR_EMAX_HOT = new THREE.Color(0xc4b8ff);

  const ZONE_ART_MAX = 0.92;
  const ZONE_FADE_IN = 10;
  const ZONE_FADE_OUT = 10;

  const dummy = new THREE.Object3D();
  const raycaster = new THREE.Raycaster();
  const mouseLocal = new THREE.Vector3();
  const ndc = new THREE.Vector2();
  const wallPlane = new THREE.Plane();
  const planeNormal = new THREE.Vector3(0, 0, 1);
  const planePoint = new THREE.Vector3();
  const hitPoint = new THREE.Vector3();
  const localPoint = new THREE.Vector3();
  const flapWorld = new THREE.Vector3();
  const flapNdc = new THREE.Vector3();
  const spotColor = new THREE.Color();
  const COLOR_BASE = new THREE.Color(0x3a4048);
  const COLOR_RING = new THREE.Color(0x5a626c);
  const COLOR_HOT = new THREE.Color(0xb4c0cc);

  let mouse = { x: -9999, y: -9999, vx: 0, vy: 0, onScreen: false };
  let prevMouse = { x: -9999, y: -9999, t: 0 };
  /** @type {null | { id: number, startX: number, startY: number, moved: boolean, zone: { zc: number, zr: number } | null }} */
  let touchGesture = null;

  let blowLevel = 0;
  let blowCtx = null;
  let blowAnalyser = null;
  let blowAnalyserL = null;
  let blowAnalyserR = null;
  let blowStream = null;
  let blowTime = null;
  let blowTimeL = null;
  let blowTimeR = null;
  let blowFreq = null;
  let blowStarting = false;
  let blowEnabled = false;
  let blowHasStereo = false;
  /** Stereo pan from mic L/R energy: −1 left, +1 right */
  let blowStereo = 0;
  /** Instant level + spike for loud blow punch */
  let blowSpike = 0;
  let blowPrevRaw = 0;
  /** Rolling peak for adaptive loud/soft normalization */
  let blowPeakTrack = 0.045;
  /** Wind lane: −1 left · 0 center-bottom · +1 right */
  let blowLane = 0;
  let blowPanBias = 0;
  let blowPanRaw = 0;
  /** Quiet-room spectral baseline for pan calibration */
  let blowBaseline = null;
  let blowTargetSx = null;
  let blowTargetSy = null;
  /** Smoothed wind direction in screen space */
  let blowWindDir = { x: 0, y: -1 };

  function updateCanvasRect() {
    if (canvas) canvasRect = canvas.getBoundingClientRect();
  }

  function viewportSize() {
    updateCanvasRect();
    const w = Math.round(canvasRect?.width || window.innerWidth);
    const h = Math.round(canvasRect?.height || window.innerHeight);
    return { w: Math.max(w, 1), h: Math.max(h, 1) };
  }

  function updateWallPlane() {
    if (!wallGroup) return;
    wallGroup.updateMatrixWorld(true);
    planeNormal.set(0, 0, 1).applyQuaternion(wallGroup.quaternion);
    planePoint.set(0, 0, 0).applyMatrix4(wallGroup.matrixWorld);
    wallPlane.setFromNormalAndCoplanarPoint(planeNormal, planePoint);
  }

  function setupCamera() {
    camera.position.set(0, 0, FRONT_DISTANCE);
    camera.lookAt(LOOK_AT);
    camera.updateProjectionMatrix();
  }

  function disposeArtMeshes() {
    for (const m of artMeshes) {
      wallGroup.remove(m);
      m.geometry.dispose();
      if (m.material.map) m.material.map.dispose();
      m.material.dispose();
    }
    artMeshes = [];
  }

  function disposeMesh() {
    disposeArtMeshes();
    if (!mesh) return;
    wallGroup.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    mesh = null;
    flaps = [];
  }

  function assetUrl(path) {
    return (window.assetPath || ((p) => p))(path);
  }

  function loadZoneTextures() {
    if (texturesLoaded) return Promise.resolve();
    const loader = new THREE.TextureLoader();
    return Promise.all(
      INTRO_ZONES.map(
        (z) =>
          new Promise((resolve, reject) => {
            loader.load(
              assetUrl(`assets/intro/${z.file}`),
              (tex) => {
                tex.colorSpace = THREE.SRGBColorSpace;
                zoneTextures[z.id] = tex;
                resolve();
              },
              undefined,
              reject,
            );
          }),
      ),
    ).then(() => {
      texturesLoaded = true;
      if (active && flaps.length) buildZoneArt();
    });
  }

  function createArtMesh(zoneId, tileCol, tileRow) {
    const baseTex = zoneTextures[zoneId];
    if (!baseTex) return null;

    const tex = baseTex.clone();
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(1 / 3, 1 / 3);
    tex.offset.set(tileCol / 3, 1 - (tileRow + 1) / 3);

    const geo = new THREE.PlaneGeometry(cellSize * 0.94, cellSize * 0.94);
    geo.translate(0, -cellSize / 2, FLAP_DEPTH * 0.55);

    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      opacity: 0,
      metalness: 0.05,
      roughness: 0.82,
      depthWrite: false,
    });

    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 2;
    return m;
  }

  function buildZoneArt() {
    disposeArtMeshes();
    if (!texturesLoaded || !wallGroup) return;

    for (const f of flaps) {
      f.zc = null;
      f.zr = null;
      f.artMesh = null;

      const info = cellToZone(f.col, f.row, padCol, padRow);
      if (!info) continue;

      const zone = zoneAt(info.zc, info.zr);
      if (!zone) continue;

      f.zc = info.zc;
      f.zr = info.zr;

      const art = createArtMesh(zone.id, info.tileCol, info.tileRow);
      if (!art) continue;

      f.artMesh = art;
      artMeshes.push(art);
      wallGroup.add(art);
    }
  }

  /** 正交相机：cover 铺满视口（无左右/上下黑边），风动片保持正方形不变形 */
  function syncCameraToGrid(totalW, totalH) {
    const { w, h } = viewportSize();
    const canvasAspect = w / h;
    const gridAspect = totalW / totalH;

    let viewW;
    let viewH;
    if (canvasAspect >= gridAspect) {
      viewW = totalW;
      viewH = totalW / canvasAspect;
    } else {
      viewH = totalH;
      viewW = totalH * canvasAspect;
    }

    camera.left = -viewW / 2;
    camera.right = viewW / 2;
    camera.top = viewH / 2;
    camera.bottom = -viewH / 2;
    camera.updateProjectionMatrix();
    setupCamera();
    updateWallPlane();
  }

  function gapForCell(cell) {
    return cell * (GAP_PX / CELL_PX);
  }

  function ensureSymmetric(count, core) {
    let n = Math.max(core, count);
    if ((n - core) % 2 !== 0) n += 1;
    return n;
  }

  function computeGridTopology(cov) {
    const { w, h } = viewportSize();
    const gapFactor = GAP_PX / CELL_PX;
    const colCount = ensureSymmetric(Math.ceil(w / CELL_PX), CORE_SIZE);
    let cell = cov.width / (colCount + (colCount - 1) * gapFactor);
    const gap = gapForCell(cell);
    const rowCount = ensureSymmetric(
      Math.ceil((cov.height + gap) / (cell + gap)),
      CORE_SIZE,
    );
    return { cols: colCount, rows: rowCount, cell: cell * FILL_MARGIN };
  }

  function fitCellToScreen(cov, colCount, rowCount, seedCell) {
    const gapFactor = GAP_PX / CELL_PX;
    let cell = seedCell || cov.width / (colCount + (colCount - 1) * gapFactor);

    updateCanvasRect();
    for (let i = 0; i < 8; i++) {
      const layout = layoutGrid(cov, cell, colCount, rowCount);
      syncCameraToGrid(layout.totalW, layout.totalH);
      const local = gridVisualBounds(layout.startX, layout.startY, cell, colCount, rowCount);
      const screen = projectBoundsToScreen(local);
      const scale = neededCoverScale(screen);
      if (scale <= 1.001) return cell;
      cell *= scale;
    }
    return cell;
  }

  function layoutGrid(cov, cell, colCount, rowCount) {
    const gap = gapForCell(cell);
    const totalW = colCount * cell + (colCount - 1) * gap;
    const totalH = rowCount * cell + (rowCount - 1) * gap;
    return {
      startX: -totalW / 2 + cell / 2,
      startY: totalH / 2,
      totalW,
      totalH,
    };
  }

  function gridVisualBounds(startX, startY, cell, colCount, rowCount) {
    const gap = gapForCell(cell);
    return {
      left: startX - cell / 2,
      right: startX + (colCount - 1) * (cell + gap) + cell / 2,
      top: startY,
      bottom: startY - (rowCount - 1) * (cell + gap) - cell,
    };
  }

  function wallLocalToScreen(lx, ly, out) {
    if (!canvasRect) updateCanvasRect();
    flapWorld.set(lx, ly, 0);
    wallGroup.localToWorld(flapWorld);
    flapNdc.copy(flapWorld).project(camera);
    out.x = (flapNdc.x * 0.5 + 0.5) * canvasRect.width + canvasRect.left;
    out.y = (-flapNdc.y * 0.5 + 0.5) * canvasRect.height + canvasRect.top;
    return out;
  }

  function projectBoundsToScreen(bounds) {
    const pts = [
      [bounds.left, bounds.top],
      [bounds.right, bounds.top],
      [bounds.left, bounds.bottom],
      [bounds.right, bounds.bottom],
    ];
    const p = { x: 0, y: 0 };
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [lx, ly] of pts) {
      wallLocalToScreen(lx, ly, p);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, maxX, minY, maxY };
  }

  function neededCoverScale(screenBounds, pad = 1) {
    updateCanvasRect();
    const cL = canvasRect.left + pad;
    const cT = canvasRect.top + pad;
    const cR = canvasRect.left + canvasRect.width - pad;
    const cB = canvasRect.top + canvasRect.height - pad;
    const gw = screenBounds.maxX - screenBounds.minX;
    const gh = screenBounds.maxY - screenBounds.minY;
    let scale = 1;
    if (screenBounds.minX > cL && gw > 0) {
      scale = Math.max(scale, 1 + (screenBounds.minX - cL) / (gw * 0.5));
    }
    if (screenBounds.maxX < cR && gw > 0) {
      scale = Math.max(scale, 1 + (cR - screenBounds.maxX) / (gw * 0.5));
    }
    if (screenBounds.minY > cT && gh > 0) {
      scale = Math.max(scale, 1 + (screenBounds.minY - cT) / (gh * 0.5));
    }
    if (screenBounds.maxY < cB && gh > 0) {
      scale = Math.max(scale, 1 + (cB - screenBounds.maxY) / (gh * 0.5));
    }
    return scale;
  }

  function buildFlaps(preserveState) {
    fitCamera();
    wallCoverage = getWallCoverage();
    const cov = wallCoverage;
    const topology = computeGridTopology(cov);
    const newCols = topology.cols;
    const newRows = topology.rows;
    const cell = fitCellToScreen(cov, newCols, newRows, topology.cell);
    const topologyChanged = !mesh
      || newCols !== cols
      || newRows !== rows
      || Math.abs(cell - cellSize) > 0.001;

    cellSize = cell;

    const saved = preserveState && flaps.length
      ? flaps.map((f) => ({
        col: f.col,
        row: f.row,
        angle: f.angle,
        velocity: f.velocity,
        offX: f.offX,
        offY: f.offY,
        offZ: f.offZ,
        offVX: f.offVX,
        offVY: f.offVY,
        offVZ: f.offVZ,
      }))
      : null;

    if (topologyChanged) {
      disposeMesh();
      cols = newCols;
      rows = newRows;

      const geometry = new THREE.BoxGeometry(cellSize, cellSize, FLAP_DEPTH);
      geometry.translate(0, -cellSize / 2, 0);

      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 0.94,
        roughness: 0.3,
        envMapIntensity: 0.62,
      });

      mesh = new THREE.InstancedMesh(geometry, material, cols * rows);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cols * rows * 3), 3);
      wallGroup.add(mesh);

      flaps = [];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const ix = row * cols + col;
          let angle = 0;
          let velocity = 0;
          let offX = 0;
          let offY = 0;
          let offZ = 0;
          let offVX = 0;
          let offVY = 0;
          let offVZ = 0;
          if (saved) {
            const match = saved.find((s) => s.col === col && s.row === row);
            if (match) {
              angle = match.angle;
              velocity = match.velocity;
              offX = match.offX || 0;
              offY = match.offY || 0;
              offZ = match.offZ || 0;
              offVX = match.offVX || 0;
              offVY = match.offVY || 0;
              offVZ = match.offVZ || 0;
            }
          }
          flaps.push({
            ix,
            col,
            row,
            x: 0,
            y: 0,
            baseX: 0,
            baseY: 0,
            angle,
            velocity,
            offX,
            offY,
            offZ,
            offVX,
            offVY,
            offVZ,
            zc: null,
            zr: null,
            artMesh: null,
            neighbors: buildNeighbors(ix, col, row),
          });
        }
      }
    }

    const { startX, startY, totalW, totalH } = layoutGrid(cov, cellSize, cols, rows);
    padCol = Math.floor((cols - CORE_SIZE) / 2);
    padRow = Math.floor((rows - CORE_SIZE) / 2);
    gridStartX = startX;
    gridStartY = startY;
    windRadius = Math.max(totalW, totalH) * 0.22;
    const gap = gapForCell(cellSize);

    for (const f of flaps) {
      f.baseX = startX + f.col * (cellSize + gap);
      f.baseY = startY - f.row * (cellSize + gap);
      f.x = f.baseX;
      f.y = f.baseY;
    }

    syncCameraToGrid(totalW, totalH);

    if (topologyChanged && texturesLoaded) buildZoneArt();

    syncMatrices();
    updateSpotlightColors(false);
    updateEntranceCursor();
  }

  function fitCamera() {
    if (!camera || !renderer) return;
    const { w, h } = viewportSize();
    const aspect = w / h;
    const viewH = FRONT_VIEW_H;
    const viewW = viewH * aspect;
    camera.left = -viewW / 2;
    camera.right = viewW / 2;
    camera.top = viewH / 2;
    camera.bottom = -viewH / 2;
    camera.updateProjectionMatrix();
    setupCamera();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(w, h, false);
    updateCanvasRect();
    updateWallPlane();
  }

  function getWallCoverage() {
    const { w, h } = viewportSize();
    const aspect = w / h;
    const viewH = FRONT_VIEW_H;
    const viewW = viewH * aspect;
    const padY = viewH * 0.05;
    return {
      minX: -viewW / 2,
      maxX: viewW / 2,
      minY: -viewH / 2 - padY,
      maxY: viewH / 2,
      width: viewW,
      height: viewH + padY,
      cx: 0,
      cy: -padY / 2,
    };
  }

  function buildNeighbors(ix, col, row) {
    const list = [];
    if (col > 0) list.push(ix - 1);
    if (col < cols - 1) list.push(ix + 1);
    if (row > 0) list.push(ix - cols);
    if (row < rows - 1) list.push(ix + cols);
    return list;
  }


  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  }

  function lerpNum(a, b, t) {
    return a + (b - a) * t;
  }

  function applyZoomCamera(progress, center, startW, startH) {
    const e = easeInOutCubic(progress);
    const viewW = lerpNum(startW, startW * 0.035, e);
    const viewH = lerpNum(startH, startH * 0.035, e);
    const panX = lerpNum(0, center.x, e);
    const panY = lerpNum(0, center.y, e);
    camera.left = panX - viewW / 2;
    camera.right = panX + viewW / 2;
    camera.top = panY + viewH / 2;
    camera.bottom = panY - viewH / 2;
    camera.updateProjectionMatrix();
    updateWallPlane();
  }

  function fadeGridForZoom(progress) {
    if (!mesh?.instanceColor) return;
    const black = new THREE.Color(0x000000);
    const fade = new THREE.Color();
    for (const f of flaps) {
      if (isEmaxZone(f.zc, f.zr)) {
        fade.copy(COLOR_EMAX_HOT).lerp(black, Math.min(1, progress * 3.4));
        mesh.setColorAt(f.ix, fade);
        if (f.artMesh) {
          f.artMesh.material.opacity = Math.max(0, 1 - progress * 2.8);
        }
      } else {
        fade.copy(COLOR_BASE).lerp(black, Math.min(1, progress * 2.6));
        mesh.setColorAt(f.ix, fade);
      }
    }
    mesh.instanceColor.needsUpdate = true;
  }

  function waitMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function playEmaxZoomTransition(url) {
    transitioning = true;
    zoomTransitionActive = true;
    stopBlowMic();
    unbindPointer();
    hoveredZone = null;
    document.getElementById('entrance')?.classList.remove('is-emax-hint');
    document.body.classList.add('is-emax-zoom');

    const center = emaxZoneCenterLocal();
    const startW = camera.right - camera.left;
    const startH = camera.top - camera.bottom;
    const dur = 640;
    const t0 = performance.now();

    await new Promise((resolve) => {
      function frame(now) {
        const t = Math.min(1, (now - t0) / dur);
        zoomBurstT = t;
        applyZoomCamera(t, center, startW, startH);
        wallGroup.position.z = lerpNum(0, -2.2, easeInOutCubic(t));
        fadeGridForZoom(t);

        const dt = Math.min(clock.getDelta(), 0.032);
        updateEmaxLift(dt, true);
        syncMatrices();
        renderer.render(scene, camera);

        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });

    fadeGridForZoom(1);
    renderer.render(scene, camera);

    const overlay = document.getElementById('transition');
    if (overlay) {
      overlay.classList.add('is-active');
      await waitMs(160);
    }

    try {
      sessionStorage.setItem('cva:emax-entry', '1');
    } catch (_) {}

    window.location.href = url;
  }

  function emaxBurstDirection(f) {
    const center = emaxZoneCenterLocal();
    let dx = f.baseX - center.x;
    let dy = f.baseY - center.y;
    let dist = Math.hypot(dx, dy);
    if (dist > cellSize * 0.08) {
      return { nx: dx / dist, ny: dy / dist };
    }
    const lc = f.col - padCol - EMAX_ZC * 3;
    const lr = f.row - padRow - EMAX_ZR * 3;
    dx = lc - 1;
    dy = 1 - lr;
    dist = Math.hypot(dx, dy);
    if (dist < 0.001) return { nx: 0, ny: 1 };
    return { nx: dx / dist, ny: dy / dist };
  }

  function emaxZoneCenterLocal() {
    const gap = gapForCell(cellSize);
    const c0 = padCol + EMAX_ZC * 3;
    const r0 = padRow + EMAX_ZR * 3;
    return {
      x: gridStartX + (c0 + 1) * (cellSize + gap),
      y: gridStartY - (r0 + 1) * (cellSize + gap),
    };
  }

  function emaxCenterInfluence(f) {
    const center = emaxZoneCenterLocal();
    const dx = f.baseX - center.x;
    const dy = f.baseY - center.y;
    const maxDist = cellSize * 2.05;
    const dist = Math.hypot(dx, dy);
    const t = Math.max(0, 1 - dist / maxDist);
    return {
      w: t * t * (3 - 2 * t),
      dx,
      dy,
      dist: dist || 1,
    };
  }

  function updateEmaxLift(dt, emaxActive) {
    for (const f of flaps) {
      let targetX = 0;
      let targetY = 0;
      let targetZ = 0;

      if (emaxActive && isEmaxZone(f.zc, f.zr)) {
        if (zoomTransitionActive) {
          const { nx, ny } = emaxBurstDirection(f);
          const e = easeInOutCubic(zoomBurstT);
          const spread = cellSize * (0.55 + e * 3.8);
          targetX = nx * spread;
          targetY = ny * spread + cellSize * 0.18 * e;
          targetZ = EMAX_LIFT_Z * (2.4 + e * 5.2);
        } else {
          const { w, dx, dy, dist } = emaxCenterInfluence(f);
          const nx = dx / dist;
          const ny = dy / dist;
          targetZ = w * EMAX_LIFT_Z;
          targetX = nx * w * cellSize * EMAX_LIFT_SPREAD;
          targetY = ny * w * cellSize * EMAX_LIFT_SPREAD + w * cellSize * EMAX_LIFT_RISE;
        }
      }

      const spring = zoomTransitionActive ? EMAX_LIFT_SPRING * 1.35 : EMAX_LIFT_SPRING;
      const damp = zoomTransitionActive ? EMAX_LIFT_DAMP * 0.82 : EMAX_LIFT_DAMP;
      f.offVX += (targetX - f.offX) * spring * dt - f.offVX * damp * dt;
      f.offVY += (targetY - f.offY) * spring * dt - f.offVY * damp * dt;
      f.offVZ += (targetZ - f.offZ) * spring * dt - f.offVZ * damp * dt;
      f.offX += f.offVX * dt;
      f.offY += f.offVY * dt;
      f.offZ += f.offVZ * dt;
    }
  }

  function syncMatrices() {
    if (!mesh) return;
    for (const f of flaps) {
      dummy.position.set(f.baseX + f.offX, f.baseY + f.offY, f.offZ);
      dummy.rotation.set(f.angle, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(f.ix, dummy.matrix);
      if (f.artMesh) {
        f.artMesh.position.copy(dummy.position);
        f.artMesh.rotation.copy(dummy.rotation);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  function pointerToColRow(local) {
    const gap = gapForCell(cellSize);
    const col = Math.floor((local.x - gridStartX + cellSize * 0.5) / (cellSize + gap));
    const row = Math.floor((gridStartY - local.y) / (cellSize + gap));
    return { col, row };
  }

  function updateHoveredZone() {
    hoveredZone = null;
    if (!mouse.onScreen || !pointerLocalFromScreen(mouse.x, mouse.y, mouseLocal)) {
      updateEntranceCursor();
      return;
    }

    const { col, row } = pointerToColRow(mouseLocal);
    const info = cellToZone(col, row, padCol, padRow);
    if (info) hoveredZone = { zc: info.zc, zr: info.zr };
    updateEntranceCursor();
  }

  function updateEntranceCursor() {
    const entrance = document.getElementById('entrance');
    if (!entrance) return;
    const zone = hoveredZone ? zoneAt(hoveredZone.zc, hoveredZone.zr) : null;
    entrance.style.cursor = zoneHref(zone) ? 'pointer' : '';
    entrance.classList.toggle('is-emax-hint', zone?.id === 'emax');
  }

  function isEmaxZone(zc, zr) {
    return zc === EMAX_ZC && zr === EMAX_ZR;
  }

  function coreGridScreenBounds() {
    updateCanvasRect();
    updateWallPlane();
    const gap = gapForCell(cellSize);
    const lx0 = gridStartX + padCol * (cellSize + gap) - cellSize * 0.5;
    const lx1 = gridStartX + (padCol + CORE_SIZE) * (cellSize + gap) - cellSize * 0.5;
    const lyTop = gridStartY - padRow * (cellSize + gap);
    const lyBottom = gridStartY - (padRow + CORE_SIZE) * (cellSize + gap) - cellSize;
    const corners = [
      [lx0, lyTop],
      [lx1, lyTop],
      [lx0, lyBottom],
      [lx1, lyBottom],
    ];
    const p = { x: 0, y: 0 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [lx, ly] of corners) {
      wallLocalToScreen(lx, ly, p);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, maxX, minY, maxY };
  }

  function zoneScreenRect(zc, zr) {
    updateCanvasRect();
    updateWallPlane();
    const gap = gapForCell(cellSize);
    const c0 = padCol + zc * 3;
    const r0 = padRow + zr * 3;
    const lx0 = gridStartX + c0 * (cellSize + gap) - cellSize * 0.5;
    const lx1 = gridStartX + (c0 + 3) * (cellSize + gap) - cellSize * 0.5;
    const lyTop = gridStartY - r0 * (cellSize + gap);
    const lyBottom = gridStartY - (r0 + 3) * (cellSize + gap) - cellSize;
    const corners = [
      [lx0, lyTop],
      [lx1, lyTop],
      [lx0, lyBottom],
      [lx1, lyBottom],
    ];
    const p = { x: 0, y: 0 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [lx, ly] of corners) {
      wallLocalToScreen(lx, ly, p);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
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

  function zoneKey(zc, zr) {
    return `${zc},${zr}`;
  }

  function zoneFadeOpacity(key) {
    let state = zoneFadeState.get(key);
    if (!state) {
      state = { opacity: 0 };
      zoneFadeState.set(key, state);
    }
    return state;
  }

  function updateZoneArtOpacity(dt) {
    const swipeKey = hoveredZone ? zoneKey(hoveredZone.zc, hoveredZone.zr) : null;

    for (const z of INTRO_ZONES) {
      const key = zoneKey(z.zc, z.zr);
      const swipe = zoneFadeOpacity(key);
      const swipeTarget = key === swipeKey ? ZONE_ART_MAX : 0;
      const swipeRate = swipeTarget > swipe.opacity ? ZONE_FADE_IN : ZONE_FADE_OUT;
      swipe.opacity += (swipeTarget - swipe.opacity) * (1 - Math.exp(-dt * swipeRate));
      if (swipe.opacity < 0.004) swipe.opacity = 0;
    }

    for (const f of flaps) {
      if (!f.artMesh || f.zc == null) continue;
      const swipe = zoneFadeState.get(zoneKey(f.zc, f.zr));
      f.artMesh.material.opacity = swipe?.opacity || 0;
    }
  }

  function flapScreenPos(f, out) {
    return wallLocalToScreen(f.baseX + f.offX, f.baseY + f.offY, out);
  }

  function pointerMetrics() {
    updateCanvasRect();
    const minDim = Math.min(canvasRect.width, canvasRect.height);
    return {
      minDim,
      hotPx: minDim * 0.045,
      ringPx: minDim * 0.135,
      windPx: minDim * 0.24,
    };
  }

  function updateSpotlightColors(hasPointer) {
    if (!mesh?.instanceColor) return;

    const mobileBlow = isMobileIntro() && (blowLevel > 0.045 || blowSpike > 0.08);
    if (!hasPointer && !mobileBlow) {
      for (const f of flaps) mesh.setColorAt(f.ix, COLOR_BASE);
      mesh.instanceColor.needsUpdate = true;
      return;
    }

    updateCanvasRect();
    const { hotPx, ringPx } = pointerMetrics();
    const hotSq = hotPx * hotPx;
    const ringSq = ringPx * ringPx;
    const mx = mouse.x;
    const my = mouse.y;
    const screen = { x: 0, y: 0 };
    const emaxHovered = hoveredZone && isEmaxZone(hoveredZone.zc, hoveredZone.zr);
    const blowSpotX = blowTargetSx ?? (canvasRect ? canvasRect.left + canvasRect.width * 0.5 : 0);
    const blowSpotY = blowTargetSy ?? (canvasRect ? canvasRect.top + canvasRect.height * 0.5 : 0);
    const blowHotSq = hotSq * (1.15 + (blowLevel + blowSpike) * 1.1);
    const blowRingSq = ringSq * (1.08 + (blowLevel + blowSpike) * 0.65);

    for (const f of flaps) {
      flapScreenPos(f, screen);
      let dx = screen.x - mx;
      let dy = screen.y - my;
      let distSq = dx * dx + dy * dy;
      let hot = hasPointer ? Math.exp(-distSq / hotSq) : 0;
      let ring = hasPointer ? Math.exp(-distSq / ringSq) * (1 - hot * 0.9) : 0;

      if (mobileBlow && blowTargetSx != null) {
        const bdx = screen.x - blowSpotX;
        const bdy = screen.y - blowSpotY;
        const bDistSq = bdx * bdx + bdy * bdy;
        const blowVis = Math.min(1.1, blowLevel + blowSpike * 0.85);
        const bHot = Math.exp(-bDistSq / blowHotSq) * blowVis;
        const bRing = Math.exp(-bDistSq / blowRingSq) * blowVis * 0.88;
        hot = Math.max(hot, bHot);
        ring = Math.max(ring, bRing);
      }

      if (isEmaxZone(f.zc, f.zr) && emaxHovered) {
        const cw = emaxCenterInfluence(f).w;
        const glow = Math.min(1, hot * 0.92 + ring * 0.42 + cw * 0.78);
        spotColor.copy(COLOR_BASE);
        spotColor.lerp(COLOR_EMAX, glow * 0.88);
        spotColor.lerp(COLOR_EMAX_HOT, Math.min(1, hot * (0.5 + cw * 0.5)));
      } else {
        spotColor.copy(COLOR_BASE);
        spotColor.lerp(COLOR_RING, Math.min(1, ring * 0.88));
        spotColor.lerp(COLOR_HOT, Math.min(1, hot));
        if (emaxHovered) spotColor.lerp(COLOR_BASE, 0.42);
      }

      mesh.setColorAt(f.ix, spotColor);
    }

    mesh.instanceColor.needsUpdate = true;
  }

  /** 射线投射到倾斜墙面 → 局部坐标（与视觉指针位置一致） */
  function pointerLocalFromScreen(sx, sy, target) {
    updateCanvasRect();
    updateWallPlane();
    if (!canvasRect || canvasRect.width < 1) return false;

    ndc.set(
      ((sx - canvasRect.left) / canvasRect.width) * 2 - 1,
      -((sy - canvasRect.top) / canvasRect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(wallPlane, hitPoint)) return false;

    target.copy(hitPoint);
    wallGroup.worldToLocal(target);
    return true;
  }

  function neighborCoupling(f, key) {
    let sum = 0;
    const n = f.neighbors.length;
    if (!n) return 0;
    for (let i = 0; i < n; i++) sum += flaps[f.neighbors[i]][key];
    return sum / n - f[key];
  }

  function pointerFlipInfluence(dist, radius) {
    const t = Math.max(0, 1 - dist / radius);
    return t * t * (3 - 2 * t);
  }

  function rmsFromTimeDomain(buf) {
    let sumSq = 0;
    for (let i = 0; i < buf.length; i += 1) {
      const v = (buf[i] - 128) / 128;
      sumSq += v * v;
    }
    return Math.sqrt(sumSq / buf.length);
  }

  function stopBlowMic() {
    blowEnabled = false;
    blowLevel = 0;
    blowSpike = 0;
    blowPrevRaw = 0;
    blowStarting = false;
    blowStereo = 0;
    blowHasStereo = false;
    blowPeakTrack = 0.045;
    blowLane = 0;
    blowPanBias = 0;
    blowPanRaw = 0;
    blowBaseline = null;
    blowTargetSx = null;
    blowTargetSy = null;
    blowWindDir.x = 0;
    blowWindDir.y = -1;
    if (blowStream) {
      blowStream.getTracks().forEach((t) => t.stop());
      blowStream = null;
    }
    if (blowCtx) {
      try {
        blowCtx.close();
      } catch (_) {}
      blowCtx = null;
    }
    blowAnalyser = null;
    blowAnalyserL = null;
    blowAnalyserR = null;
    blowTime = null;
    blowTimeL = null;
    blowTimeR = null;
    blowFreq = null;
  }

  async function ensureBlowMic() {
    if (!isMobileIntro() || blowEnabled || blowStarting || transitioning) return;
    if (!blowMicSupported()) {
      updateBlowMicHint();
      return;
    }
    blowStarting = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: { ideal: 2 },
        },
        video: false,
      });
      if (!active || !isMobileIntro() || transitioning) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const ctx = new Ctx();
      if (ctx.state === 'suspended') await ctx.resume();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.05;
      source.connect(analyser);

      const track = stream.getAudioTracks()[0];
      const channels = track?.getSettings?.()?.channelCount || 1;
      blowHasStereo = channels >= 2;
      if (blowHasStereo) {
        const splitter = ctx.createChannelSplitter(2);
        source.connect(splitter);
        blowAnalyserL = ctx.createAnalyser();
        blowAnalyserR = ctx.createAnalyser();
        blowAnalyserL.fftSize = 512;
        blowAnalyserR.fftSize = 512;
        blowAnalyserL.smoothingTimeConstant = 0.08;
        blowAnalyserR.smoothingTimeConstant = 0.08;
        splitter.connect(blowAnalyserL, 0);
        splitter.connect(blowAnalyserR, 1);
        blowTimeL = new Uint8Array(blowAnalyserL.fftSize);
        blowTimeR = new Uint8Array(blowAnalyserR.fftSize);
      }

      blowStream = stream;
      blowCtx = ctx;
      blowAnalyser = analyser;
      blowTime = new Uint8Array(analyser.fftSize);
      blowFreq = new Uint8Array(analyser.frequencyBinCount);
      blowBaseline = new Float32Array(analyser.frequencyBinCount);
      blowEnabled = true;
      blowLane = 0;
      blowStereo = 0;
      blowPanBias = 0;
      ensureDefaultBlowTarget();
    } catch (err) {
      console.info('[IntroGridFront] Blow mic unavailable:', err?.message || err);
    } finally {
      blowStarting = false;
      updateBlowMicHint();
    }
  }

  function blowMicSupported() {
    return !!(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
  }

  const BLOW_HINT_DEFAULT = 'SWIPE TO EXPLORE · BLOW TO TRY · TAP TO ENTER';
  const BLOW_HINT_NO_MIC = 'SWIPE · TAP TO ENTER · BLOW NEEDS HTTPS PREVIEW';
  const BLOW_HINT_MIC_ON = 'SWIPE · TAP TO ENTER · BLOW ACTIVE';

  function updateBlowMicHint() {
    const el = document.querySelector('.entrance__touch-hint');
    if (!el || !isMobileIntro()) return;
    if (!blowMicSupported()) {
      el.textContent = BLOW_HINT_NO_MIC;
      el.classList.add('is-blow-blocked');
    } else if (blowEnabled) {
      el.textContent = BLOW_HINT_MIC_ON;
      el.classList.remove('is-blow-blocked');
    } else {
      el.textContent = BLOW_HINT_DEFAULT;
      el.classList.remove('is-blow-blocked');
    }
  }

  function updateBlowBaseline() {
    if (!blowBaseline || !blowFreq || blowLevel > 0.032) return;
    for (let i = 0; i < blowFreq.length; i += 1) {
      blowBaseline[i] += (blowFreq[i] - blowBaseline[i]) * 0.055;
    }
  }

  /** Blow spectrum minus baseline → horizontal pan cue (mono fallback) */
  function spectralDeltaPanH() {
    if (!blowBaseline || !blowFreq) return 0;
    const fn = blowFreq.length;
    let wSum = 0;
    let dSum = 0;
    const binStart = Math.floor(fn * 0.1);
    const binEnd = Math.floor(fn * 0.88);
    for (let i = binStart; i < binEnd; i += 1) {
      const d = Math.max(0, blowFreq[i] - blowBaseline[i] - 5);
      wSum += i * d;
      dSum += d;
    }
    if (dSum < 90) return 0;
    const centroid = wSum / dSum;
    return THREE.MathUtils.clamp(((centroid / fn) - 0.5) / 0.34, -1, 1);
  }

  /** Stereo pan, else calibrated spectral delta — never time-buffer halves */
  function measureBlowPan() {
    /* Mono / ambiguous mic → stay on center-bottom field (no spectral guessing) */
    if (!blowHasStereo || Math.abs(blowStereo) < BLOW_STEREO_MIN) return 0;
    return blowStereo;
  }

  function snapBlowLane(pan) {
    if (pan < -BLOW_LANE_THRESHOLD) return -1;
    if (pan > BLOW_LANE_THRESHOLD) return 1;
    return 0;
  }

  /** Bottom-anchored wind origin: center (default) · left · right */
  function blowAnchorPoint(lane) {
    const bounds = coreGridScreenBounds();
    const w = Math.max(bounds.maxX - bounds.minX, 1);
    const h = Math.max(bounds.maxY - bounds.minY, 1);
    const centerX = (bounds.minX + bounds.maxX) * 0.5;
    const bottomY = bounds.maxY - h * 0.02;
    if (lane === -1) return { x: bounds.minX + w * BLOW_LANE_X.left, y: bottomY };
    if (lane === 1) return { x: bounds.minX + w * BLOW_LANE_X.right, y: bottomY };
    return { x: centerX, y: bottomY };
  }

  function ensureDefaultBlowTarget() {
    if (!isMobileIntro()) return;
    blowLane = 0;
    const spot = blowAnchorPoint(0);
    blowTargetSx = spot.x;
    blowTargetSy = spot.y;
  }

  /** Lane corridor + vertical reach — intensity widens both */
  function blowFieldWeight(screenX, screenY, intensity) {
    const bounds = coreGridScreenBounds();
    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxY - bounds.minY;
    const anchor = blowAnchorPoint(blowLane);
    const reach = THREE.MathUtils.clamp(intensity, 0, 1.6);
    const sigmaX = blowLane === 0
      ? w * (0.12 + reach * 0.28)
      : w * (0.14 + reach * 0.24);
    const sigmaY = h * (0.08 + reach * 0.62);
    const dx = screenX - anchor.x;
    const dy = screenY - anchor.y;
    const horiz = Math.exp(-(dx * dx) / (sigmaX * sigmaX));
    const vert = Math.exp(-(dy * dy) / (sigmaY * sigmaY));
    return horiz * vert;
  }

  function updateBlowLane() {
    const pan = measureBlowPan();
    blowPanRaw = pan;

    if (blowLevel < 0.034) {
      blowLane += (0 - blowLane) * 0.18;
      if (Math.abs(blowLane) < 0.2) blowLane = 0;
      else blowLane = Math.sign(blowLane);
    } else if (Math.abs(pan) >= BLOW_LANE_THRESHOLD) {
      const targetLane = snapBlowLane(pan);
      blowLane += (targetLane - blowLane) * BLOW_LANE_SMOOTH;
      if (Math.abs(blowLane) < 0.25) blowLane = 0;
      else blowLane = Math.sign(blowLane);
    } else {
      /* Blowing but no clear stereo L/R → center-bottom */
      blowLane += (0 - blowLane) * 0.24;
      if (Math.abs(blowLane) < 0.2) blowLane = 0;
    }

    const spot = blowAnchorPoint(blowLane);
    blowTargetSx = spot.x;
    blowTargetSy = spot.y;
  }

  /** Wind from below grid bottom toward active lane anchor */
  function updateBlowDirection() {
    updateCanvasRect();
    if (!canvasRect || blowTargetSx == null || blowTargetSy == null) return;

    const bounds = coreGridScreenBounds();
    const originX = bounds.minX + (bounds.maxX - bounds.minX) * 0.5;
    const originY = bounds.maxY + Math.min(28, (bounds.maxY - bounds.minY) * 0.07);
    let wdx = blowTargetSx - originX;
    let wdy = blowTargetSy - originY;
    const len = Math.hypot(wdx, wdy);
    if (len < 6) {
      wdx = 0;
      wdy = -1;
    } else {
      wdx /= len;
      wdy /= len;
    }

    const smooth = blowLevel > 0.05 ? BLOW_DIR_SMOOTH : 0.08;
    blowWindDir.x += (wdx - blowWindDir.x) * smooth;
    blowWindDir.y += (wdy - blowWindDir.y) * smooth;
    const nLen = Math.hypot(blowWindDir.x, blowWindDir.y) || 1;
    blowWindDir.x /= nLen;
    blowWindDir.y /= nLen;
  }

  function updateBlowStereo() {
    if (blowHasStereo && blowAnalyserL && blowAnalyserR && blowTimeL && blowTimeR && blowLevel > 0.04) {
      blowAnalyserL.getByteTimeDomainData(blowTimeL);
      blowAnalyserR.getByteTimeDomainData(blowTimeR);
      const l = rmsFromTimeDomain(blowTimeL);
      const r = rmsFromTimeDomain(blowTimeR);
      const total = l + r + 0.0001;
      if (Math.abs(l - r) / total < 0.07) {
        blowStereo *= 0.86;
        if (Math.abs(blowStereo) < 0.025) blowStereo = 0;
        return;
      }
      const pan = THREE.MathUtils.clamp((r - l) / total, -1, 1);
      blowStereo += (pan - blowStereo) * BLOW_STEREO_SMOOTH;
    } else {
      blowStereo *= 0.9;
      if (Math.abs(blowStereo) < 0.02) blowStereo = 0;
    }
  }

  function updateBlowLevel() {
    if (!isMobileIntro() || !blowEnabled || !blowAnalyser || !blowTime) {
      blowLevel *= 0.78;
      blowSpike *= 0.72;
      if (blowLevel < 0.012) blowLevel = 0;
      if (blowSpike < 0.015) blowSpike = 0;
      blowStereo *= 0.88;
      return;
    }
    if (blowCtx?.state === 'suspended') {
      blowCtx.resume().catch(() => {});
    }

    /* Time-domain RMS — reacts faster than FFT averages */
    blowAnalyser.getByteTimeDomainData(blowTime);
    const rms = rmsFromTimeDomain(blowTime);

    blowPeakTrack = Math.max(blowPeakTrack * 0.993, rms, 0.028);
    const adaptive = THREE.MathUtils.clamp(rms / (blowPeakTrack * 1.08 + 0.018), 0, 1.4);

    /* High-band energy favors breath/noise over speech fundamentals */
    let hiss = 0;
    if (blowFreq) {
      blowAnalyser.getByteFrequencyData(blowFreq);
      const fn = blowFreq.length;
      const start = Math.floor(fn * 0.28);
      let hSum = 0;
      for (let i = start; i < fn; i += 1) hSum += blowFreq[i];
      hiss = hSum / Math.max(1, fn - start) / 255;
    }

    const mixed = adaptive * 0.78 + hiss * 0.32;
    const raw = Math.max(0, Math.min(1, (mixed - BLOW_FLOOR) / (BLOW_CEIL - BLOW_FLOOR)));
    const shaped = Math.pow(raw, 0.78);
    const rise = Math.max(0, shaped - blowPrevRaw);
    blowPrevRaw = shaped;
    const k = shaped > blowLevel ? BLOW_ATTACK : BLOW_RELEASE;
    blowLevel += (shaped - blowLevel) * k;
    if (blowLevel < 0.012) blowLevel = 0;

    const spikeIn = Math.max(rise * 4.8, adaptive - blowLevel * 0.85, shaped - blowLevel);
    blowSpike = Math.max(blowSpike * (1 - BLOW_SPIKE_DECAY), spikeIn * 1.48);
    if (blowSpike < 0.018) blowSpike = 0;

    if (blowLevel > 0.035) {
      updateBlowStereo();
      updateBlowLane();
      updateBlowDirection();
    } else {
      updateBlowBaseline();
      blowLane += (0 - blowLane) * 0.1;
      if (Math.abs(blowLane) < 0.15) blowLane = 0;
      ensureDefaultBlowTarget();
    }
  }

  function simulate(dt) {
    if (!flaps.length) return;

    const t = clock.getElapsedTime();
    updateBlowLevel();
    const hasPointer = mouse.onScreen && pointerLocalFromScreen(mouse.x, mouse.y, mouseLocal);
    updateCanvasRect();

    const windSpeed = Math.hypot(mouse.vx, mouse.vy);
    const pointerMoving = windSpeed > POINTER_MOVE_MIN;
    const moveFactor = pointerMoving ? Math.min(1, windSpeed / 42) : 0;
    const windDirY = windSpeed > 0.05 ? mouse.vy / windSpeed : 0;

    const metrics = hasPointer ? pointerMetrics() : null;
    const windPx = metrics ? metrics.windPx : windRadius;
    const windSq = windPx * windPx;
    const coreSq = (windPx * 0.42) ** 2;
    const flipRadius = metrics ? Math.max(metrics.ringPx * 2.4, metrics.hotPx * 5) : windRadius;
    const engage = 0.22 + moveFactor * 0.78;
    const mx = mouse.x;
    const my = mouse.y;
    const screen = { x: 0, y: 0 };
    const blowing = isMobileIntro() && (blowLevel > 0.038 || blowSpike > 0.055);
    const blowSoft = blowLevel;
    const blowHard = Math.min(2.0, blowSpike);
    const hardFactor = blowHard * (0.42 + blowHard * 0.58);
    const blowIntensity = THREE.MathUtils.clamp(blowSoft * 0.55 + hardFactor * 1.08, 0, 1.65);
    const blowPunch = blowSoft + blowHard * 2.05;
    const blowMetrics = pointerMetrics();
    const radiusMul = 0.12 + blowIntensity * 1.82 + blowHard * 0.52;
    const windMul = 0.18 + blowIntensity * 1.38 + blowHard * 0.48;
    const flipScale = 0.2 + blowIntensity * 1.12 + blowHard * 0.55;
    const blowFlipRadius = Math.max(blowMetrics.ringPx * 3.35, blowMetrics.hotPx * 6.4) * radiusMul;
    const blowWindPx = blowMetrics.windPx * windMul;
    const blowWindSq = blowWindPx * blowWindPx;
    const blowCoreSq = (blowWindPx * 0.42) ** 2;
    const blowEngage = Math.min(1.15, 0.04 + blowIntensity * 1.05 + blowHard * 0.32);
    const blowMx = blowTargetSx;
    const blowMy = blowTargetSy;
    const bwx = blowWindDir.x;
    const bwy = blowWindDir.y;
    const blowDirY = Math.abs(bwy) > 0.08 ? Math.sign(bwy) : -1;

    const emaxHovered = hoveredZone && isEmaxZone(hoveredZone.zc, hoveredZone.zr);

    for (const f of flaps) {
      const phase = f.col * 0.44 + f.row * 0.36;
      let force = Math.sin(t * 0.32 + phase) * IDLE_BREEZE;
      const isEmaxFlap = isEmaxZone(f.zc, f.zr);
      let springMul = 1;
      let dampMul = 1;
      let ripple = 1;

      if (hasPointer) {
        flapScreenPos(f, screen);
        const sdx = screen.x - mx;
        const sdy = screen.y - my;
        const screenDistSq = sdx * sdx + sdy * sdy;
        const dist = Math.sqrt(screenDistSq);
        let flipInfluence = pointerFlipInfluence(dist, flipRadius);
        const zone = Math.exp(-screenDistSq / windSq);
        const core = Math.exp(-screenDistSq / coreSq);
        const gust = (0.95 + Math.min(windSpeed * 0.008, 2.5)) * WIND_GAIN * zone * moveFactor;

        const dx = (f.baseX + f.offX) - mouseLocal.x;
        const dy = (f.baseY + f.offY) - mouseLocal.y;
        const localDist = Math.hypot(dx, dy);

        force += (-dy / (localDist || 1)) * gust * 1.85 + windDirY * gust * 1.05;

        const flipSign = Math.abs(windDirY) > 0.08
          ? Math.sign(windDirY)
          : (Math.abs(sdy) > 2 ? Math.sign(sdy) : 1);
        if (isEmaxFlap && emaxHovered) {
          flipInfluence = Math.min(1, flipInfluence + emaxCenterInfluence(f).w * 0.35);
        }
        let targetAngle = POINTER_FLIP_MAX * flipInfluence * engage * flipSign;
        if (isEmaxFlap && emaxHovered) {
          targetAngle *= 1 + emaxCenterInfluence(f).w * 0.28;
        }
        force += (targetAngle - f.angle) * (14 + flipInfluence * 42) * engage;

        if (zone > 0.01) {
          const turb = gust * (0.72 + core * 0.62) * (0.35 + flipInfluence * 0.65);
          force += Math.sin(t * 5.8 + phase) * turb;
          f.velocity += (-dy / (localDist || 1)) * gust * dt * (4 + flipInfluence * 5);
        }

        springMul = 1 - flipInfluence * 0.94;
        dampMul = 1 - flipInfluence * 0.52;
        ripple = 1 + flipInfluence * 2.1 + zone * 0.6;
      }

      /* Mobile blow: per-flap 1/9 flip (same kernel as swipe, no texture) */
      if (blowing && blowMx != null && blowMy != null) {
        flapScreenPos(f, screen);
        const fieldMul = 0.06 + blowFieldWeight(screen.x, screen.y, blowIntensity) * 0.94;
        const sdx = screen.x - blowMx;
        const sdy = screen.y - blowMy;
        const screenDistSq = sdx * sdx + sdy * sdy;
        const dist = Math.sqrt(screenDistSq);
        let flipInfluence = pointerFlipInfluence(dist, blowFlipRadius) * flipScale * fieldMul;
        const zone = Math.exp(-screenDistSq / blowWindSq) * fieldMul;
        const core = Math.exp(-screenDistSq / blowCoreSq) * fieldMul;
        const gust = (0.5 + blowPunch * 1.15) * WIND_GAIN * BLOW_GAIN * zone * blowEngage;

        if (pointerLocalFromScreen(blowMx, blowMy, mouseLocal)) {
          const dx = (f.baseX + f.offX) - mouseLocal.x;
          const dy = (f.baseY + f.offY) - mouseLocal.y;
          const localDist = Math.hypot(dx, dy);
          force += (-dy / (localDist || 1)) * gust * 1.95 + blowDirY * gust * 1.12;
          if (zone > 0.01) {
            f.velocity += (-dy / (localDist || 1)) * gust * dt * (4.2 + flipInfluence * 5.5);
          }
        }

        const flipSign = Math.abs(blowDirY) > 0.08
          ? blowDirY
          : (Math.abs(sdy) > 2 ? Math.sign(sdy) : -1);
        let targetAngle = POINTER_FLIP_MAX * flipInfluence * blowEngage * flipSign;
        force += (targetAngle - f.angle) * (10 + flipInfluence * 46 + blowHard * 96 * blowEngage) * blowEngage;

        if (zone > 0.01) {
          const turb = gust * (0.78 + core * 0.68) * (0.38 + flipInfluence * 0.72);
          force += Math.sin(t * (8.2 + blowSpike * 4) + phase) * turb;
        }
        if (blowSpike > 0.05 && flipInfluence > 0.06) {
          f.velocity += flipSign * blowHard * dt * (36 + flipInfluence * 44);
        }

        springMul = Math.min(springMul, 1 - flipInfluence * 0.94);
        dampMul = Math.min(dampMul, 1 - flipInfluence * 0.52);
        ripple = Math.max(ripple, 1 + flipInfluence * 2.1 + zone * 0.6);
      }

      const couple = neighborCoupling(f, 'angle');
      f.velocity +=
        (-STIFFNESS * springMul * f.angle -
          DAMPING * dampMul * f.velocity +
          COUPLING * couple * ripple +
          force) *
        dt;
      f.angle += f.velocity * dt;
      f.angle = THREE.MathUtils.clamp(f.angle, -MAX_ANGLE, MAX_ANGLE);
    }

    updateHoveredZone();
    updateEmaxLift(dt, hoveredZone && isEmaxZone(hoveredZone.zc, hoveredZone.zr));
    syncMatrices();
    updateSpotlightColors(hasPointer || blowing);
    updateZoneArtOpacity(dt);
  }

  function animate() {
    if (!active || transitioning) return;
    simulate(Math.min(clock.getDelta(), 0.032));
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(animate);
  }

  function isMobileIntro() {
    return window.matchMedia(MOBILE_INTRO_MQ).matches;
  }

  function isChromeTarget(el) {
    return !!el?.closest?.('.site-header, .site-footer, a, button');
  }

  function clearMobilePointer() {
    touchGesture = null;
    mouse.onScreen = false;
    mouse.vx = 0;
    mouse.vy = 0;
    hoveredZone = null;
    updateEntranceCursor();
  }

  async function activateZoneAt(zc, zr) {
    const zone = zoneAt(zc, zr);
    const href = zoneHref(zone);
    if (!href) return;

    if (zone.id === 'emax') {
      await playEmaxZoomTransition(assetUrl(href));
      return;
    }

    const url = assetUrl(href);
    if (window.Motion?.pageExit) window.Motion.pageExit(url);
    else window.location.href = url;
  }

  function onPointerMove(e) {
    if (!active) return;
    const now = performance.now();
    const dt = Math.max(1, now - prevMouse.t);
    mouse.vx = ((e.clientX - prevMouse.x) / dt) * 16;
    mouse.vy = ((e.clientY - prevMouse.y) / dt) * 16;
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.onScreen = true;
    prevMouse = { x: e.clientX, y: e.clientY, t: now };

    if (touchGesture && e.pointerId === touchGesture.id) {
      const dx = e.clientX - touchGesture.startX;
      const dy = e.clientY - touchGesture.startY;
      if (dx * dx + dy * dy > MOBILE_TAP_MOVE_MAX * MOBILE_TAP_MOVE_MAX) {
        touchGesture.moved = true;
      }
      updateHoveredZone();
    }
  }

  function onPointerLeave(e) {
    if (e.relatedTarget !== null) return;
    if (touchGesture) return;
    mouse.onScreen = false;
    mouse.vx = 0;
    mouse.vy = 0;
    hoveredZone = null;
    updateEntranceCursor();
    document.getElementById('entrance')?.classList.remove('is-emax-hint');
  }

  function onPointerDown(e) {
    if (!active || transitioning) return;
    onPointerMove(e);
    updateHoveredZone();

    /* Mobile: press+drag = wind; short tap on lift = enter. Desktop keeps click-on-down. */
    if (isMobileIntro()) {
      if (isChromeTarget(e.target)) {
        touchGesture = null;
        return;
      }
      /* First touch also unlocks mic for blow-to-wind (needs user gesture) */
      ensureBlowMic();
      /* Kill first-sample velocity spike from offscreen prev coords */
      mouse.vx = 0;
      mouse.vy = 0;
      prevMouse = { x: e.clientX, y: e.clientY, t: performance.now() };
      touchGesture = {
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        zone: hoveredZone ? { zc: hoveredZone.zc, zr: hoveredZone.zr } : null,
      };
      return;
    }

    if (!hoveredZone) return;
    activateZoneAt(hoveredZone.zc, hoveredZone.zr);
  }

  function onPointerUp(e) {
    if (!active) return;

    if (touchGesture && e.pointerId === touchGesture.id) {
      const g = touchGesture;
      const wasTap = !g.moved && !transitioning;
      const startZone = g.zone;
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.onScreen = true;
      updateHoveredZone();
      const endZone = hoveredZone;
      clearMobilePointer();

      if (!wasTap || !startZone || isChromeTarget(e.target)) return;
      if (!endZone || endZone.zc !== startZone.zc || endZone.zr !== startZone.zr) return;
      activateZoneAt(startZone.zc, startZone.zr);
      return;
    }

    onPointerMove(e);
  }

  function onPointerCancel(e) {
    if (touchGesture && e.pointerId === touchGesture.id) {
      clearMobilePointer();
    }
  }

  function relayout() {
    if (!active) return;
    fitCamera();
    buildFlaps(true);
    if (isMobileIntro()) {
      const spot = blowAnchorPoint(blowLane);
      blowTargetSx = spot.x;
      blowTargetSy = spot.y;
    }
  }

  function scheduleRelayout() {
    requestAnimationFrame(relayout);
  }

  function applyEnvironment(envMap, intensity) {
    scene.environment = envMap;
    if (mesh) {
      mesh.material.envMapIntensity = intensity;
      mesh.material.needsUpdate = true;
    }
  }

  function loadEnvironment() {
    pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    applyEnvironment(pmrem.fromScene(new RoomEnvironment(), 0.04).texture, 0.6);

    new RGBELoader().load(
      HDR_URL,
      (hdr) => {
        applyEnvironment(pmrem.fromEquirectangular(hdr).texture, 0.78);
        hdr.dispose();
      },
      undefined,
      () => console.info('[IntroGridFront] HDR skipped, using RoomEnvironment.'),
    );
  }

  function onVisibilityChange() {
    /* Mic off while backgrounded; next touch re-requests on return */
    if (document.hidden) stopBlowMic();
  }

  function bindPointer() {
    const opts = { passive: true };
    window.addEventListener('pointermove', onPointerMove, opts);
    window.addEventListener('mousemove', onPointerMove, opts);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp, opts);
    window.addEventListener('pointercancel', onPointerCancel, opts);
    window.addEventListener('pointerout', onPointerLeave);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', () => {
      if (isMobileIntro()) clearMobilePointer();
      else mouse.onScreen = false;
    });
  }

  function unbindPointer() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('mousemove', onPointerMove);
    window.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('pointerout', onPointerLeave);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }

  function bindResize() {
    window.addEventListener('resize', scheduleRelayout);
    window.addEventListener('scroll', updateCanvasRect, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', scheduleRelayout);
      window.visualViewport.addEventListener('scroll', updateCanvasRect);
    }
    if (typeof ResizeObserver !== 'undefined' && canvas) {
      resizeObserver = new ResizeObserver(scheduleRelayout);
      resizeObserver.observe(canvas);
      if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);
    }
    window.addEventListener('load', scheduleRelayout, { once: true });
  }

  function unbindResize() {
    window.removeEventListener('resize', scheduleRelayout);
    window.removeEventListener('scroll', updateCanvasRect);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', scheduleRelayout);
      window.visualViewport.removeEventListener('scroll', updateCanvasRect);
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
  }

  function init(containerId) {
    canvas = document.getElementById(containerId);
    if (!canvas || active) return;

    try {
      active = true;
      clock = new THREE.Clock();

      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
      renderer.setClearColor(0x000000, 1);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.84;
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x000000);

      camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 80);

      wallGroup = new THREE.Group();
      scene.add(wallGroup);

      fitCamera();

      const keyLight = new THREE.DirectionalLight(0xf0f2f6, 1.45);
      keyLight.position.set(-11, 9, 15);
      scene.add(keyLight);

      const fill = new THREE.DirectionalLight(0x3a4555, 0.14);
      fill.position.set(7, -3, 9);
      scene.add(fill);

      const frontLight = new THREE.DirectionalLight(0xe6eaef, 0.38);
      frontLight.position.set(0, 0.5, 16);
      scene.add(frontLight);

      scene.add(new THREE.AmbientLight(0x889098, 0.1));

      loadEnvironment();
      buildFlaps(false);
      loadZoneTextures().catch((err) => {
        console.error('[IntroGridFront] Zone textures failed:', err);
      });
      scheduleRelayout();
      bindPointer();
      bindResize();
      ensureDefaultBlowTarget();
      updateBlowMicHint();
      window.matchMedia(MOBILE_INTRO_MQ).addEventListener('change', updateBlowMicHint);
      rafId = requestAnimationFrame(animate);
    } catch (err) {
      active = false;
      console.error('[IntroGridFront]', err);
      showInitError(err);
    }
  }

  function showInitError(err) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText('Wind wall failed to start. Use a local server (not file://).', 24, 40);
    ctx.fillText(String(err && err.message ? err.message : err), 24, 64);
  }

  function destroy() {
    active = false;
    cancelAnimationFrame(rafId);
    rafId = 0;
    touchGesture = null;
    stopBlowMic();

    unbindPointer();
    unbindResize();

    disposeMesh();

    for (const tex of Object.values(zoneTextures)) tex.dispose();
    zoneTextures = {};
    texturesLoaded = false;
    hoveredZone = null;
    zoneFadeState.clear();

    if (wallGroup && scene) scene.remove(wallGroup);
    wallGroup = null;
    wallCoverage = null;

    if (pmrem) {
      pmrem.dispose();
      pmrem = null;
    }

    if (renderer) {
      renderer.dispose();
      renderer = null;
    }

    scene = null;
    camera = null;
    canvas = null;
    canvasRect = null;
    flaps = [];
  }

  return { init, destroy };
})();

window.IntroGrid = IntroGrid;
window.__introReady = true;
document.dispatchEvent(new CustomEvent('intro:ready'));
