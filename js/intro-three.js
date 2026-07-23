/* 风动片 · InstancedMesh · 斜透视 · 侧光 PBR · 指针风场 */

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const IntroGrid = (() => {
  const STIFFNESS = 44;
  const DAMPING = 5.8;
  const COUPLING = 13.5;
  const WIND_GAIN = 3.35;
  const IDLE_BREEZE = 0.038;
  const MAX_ANGLE = 2.78;
  const GAP = 0.035;
  const FLAP_DEPTH = 0.05;
  const CELL_PX = 60;
  const FILL_MARGIN = 1.02;
  const POINTER_MOVE_MIN = 4;
  const HDR_URL =
    'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr';
  const LOOK_AT = new THREE.Vector3(0.5, -0.1, 0);

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
  const COLOR_BASE = new THREE.Color(0x282c32);
  const COLOR_RING = new THREE.Color(0x525a64);
  const COLOR_HOT = new THREE.Color(0x98a4b2);

  let mouse = { x: -9999, y: -9999, vx: 0, vy: 0, onScreen: false };
  let prevMouse = { x: -9999, y: -9999, t: 0 };

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
    const { w, h } = viewportSize();
    const aspect = w / h;
    const refAspect = 1.05;
    const fill = Math.pow(refAspect / aspect, 0.38);
    camera.position.set(-5.8 * fill, 0.95, 10.6 / fill);
    camera.lookAt(LOOK_AT);
  }

  function disposeMesh() {
    if (!mesh) return;
    wallGroup.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    mesh = null;
    flaps = [];
  }

  function computeCellSize(cov, colCount, rowCount) {
    const cellW = (cov.width - (colCount - 1) * GAP) / colCount;
    const cellH = (cov.height - (rowCount - 1) * GAP) / rowCount;
    return Math.max(cellW, cellH) * FILL_MARGIN;
  }

  function layoutGrid(cov, cell, colCount, rowCount) {
    const totalW = colCount * cell + (colCount - 1) * GAP;
    const totalH = rowCount * cell + (rowCount - 1) * GAP;
    return {
      startX: cov.cx - totalW / 2 + cell / 2,
      startY: cov.cy + totalH / 2,
      totalW,
      totalH,
    };
  }

  function gridVisualBounds(startX, startY, cell, colCount, rowCount) {
    return {
      left: startX - cell / 2,
      right: startX + (colCount - 1) * (cell + GAP) + cell / 2,
      top: startY,
      bottom: startY - (rowCount - 1) * (cell + GAP) - cell,
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

  function neededCoverScale(screenBounds, pad = 2) {
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

  function fitCellToScreen(cov, colCount, rowCount) {
    let cell = computeCellSize(cov, colCount, rowCount);
    updateCanvasRect();
    for (let i = 0; i < 6; i++) {
      const { startX, startY } = layoutGrid(cov, cell, colCount, rowCount);
      const local = gridVisualBounds(startX, startY, cell, colCount, rowCount);
      const screen = projectBoundsToScreen(local);
      const scale = neededCoverScale(screen);
      if (scale <= 1.002) return cell;
      cell *= scale;
    }
    return cell;
  }

  function buildFlaps(preserveState) {
    wallCoverage = getWallCoverage();
    const cov = wallCoverage;
    const { w, h } = viewportSize();
    const newCols = Math.max(9, Math.floor(w / CELL_PX));
    const newRows = Math.max(6, Math.ceil(h / CELL_PX));
    const cell = fitCellToScreen(cov, newCols, newRows);
    const topologyChanged = !mesh
      || newCols !== cols
      || newRows !== rows
      || Math.abs(cell - cellSize) > 0.001;

    const saved = preserveState && flaps.length
      ? flaps.map((f) => ({ col: f.col, row: f.row, angle: f.angle, velocity: f.velocity }))
      : null;

    if (topologyChanged) {
      disposeMesh();
      cols = newCols;
      rows = newRows;
      cellSize = cell;

      const geometry = new THREE.BoxGeometry(cellSize, cellSize, FLAP_DEPTH);
      geometry.translate(0, -cellSize / 2, 0);

      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 0.94,
        roughness: 0.3,
        envMapIntensity: 0.55,
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
          if (saved) {
            const match = saved.find((s) => s.col === col && s.row === row);
            if (match) {
              angle = match.angle;
              velocity = match.velocity;
            }
          }
          flaps.push({
            ix,
            col,
            row,
            x: 0,
            y: 0,
            angle,
            velocity,
            neighbors: buildNeighbors(ix, col, row),
          });
        }
      }
    }

    const { startX, startY, totalW, totalH } = layoutGrid(cov, cellSize, cols, rows);
    windRadius = Math.max(totalW, totalH) * 0.22;

    for (const f of flaps) {
      f.x = startX + f.col * (cellSize + GAP);
      f.y = startY - f.row * (cellSize + GAP);
    }

    syncMatrices();
    updateSpotlightColors(false);
  }

  function fitCamera() {
    if (!camera || !renderer) return;
    const { w, h } = viewportSize();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    setupCamera();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(w, h, true);
    updateCanvasRect();
    updateWallPlane();
  }

  function getWallCoverage() {
    updateWallPlane();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let u = 0; u <= 6; u++) {
      for (let v = 0; v <= 6; v++) {
        ndc.set((u / 6) * 2 - 1, -((v / 6) * 2 - 1));
        raycaster.setFromCamera(ndc, camera);
        if (!raycaster.ray.intersectPlane(wallPlane, hitPoint)) continue;
        localPoint.copy(hitPoint);
        wallGroup.worldToLocal(localPoint);
        minX = Math.min(minX, localPoint.x);
        maxX = Math.max(maxX, localPoint.x);
        minY = Math.min(minY, localPoint.y);
        maxY = Math.max(maxY, localPoint.y);
      }
    }

    if (!Number.isFinite(minX)) {
      return { minX: -6, maxX: 6, minY: -4, maxY: 4, width: 12, height: 8, cx: 0, cy: 0 };
    }

    const spanY = maxY - minY;
    minY -= spanY * 0.05;

    return {
      minX,
      maxX,
      minY,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
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


  function syncMatrices() {
    if (!mesh) return;
    for (const f of flaps) {
      dummy.position.set(f.x, f.y, 0);
      dummy.rotation.set(f.angle, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(f.ix, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  function flapScreenPos(f, out) {
    return wallLocalToScreen(f.x, f.y, out);
  }

  function pointerMetrics() {
    updateCanvasRect();
    const minDim = Math.min(canvasRect.width, canvasRect.height);
    return {
      minDim,
      hotPx: minDim * 0.05,
      ringPx: minDim * 0.135,
      windPx: minDim * 0.24,
    };
  }

  function updateSpotlightColors(hasPointer) {
    if (!mesh?.instanceColor) return;

    if (!hasPointer) {
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

    for (const f of flaps) {
      flapScreenPos(f, screen);
      const dx = screen.x - mx;
      const dy = screen.y - my;
      const distSq = dx * dx + dy * dy;

      const hot = Math.exp(-distSq / hotSq);
      const ring = Math.exp(-distSq / ringSq) * (1 - hot * 0.9);

      spotColor.copy(COLOR_BASE);
      spotColor.lerp(COLOR_RING, Math.min(1, ring * 0.92));
      spotColor.lerp(COLOR_HOT, Math.min(1, hot));
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

  function simulate(dt) {
    if (!flaps.length) return;

    const t = clock.getElapsedTime();
    const hasPointer = mouse.onScreen && pointerLocalFromScreen(mouse.x, mouse.y, mouseLocal);
    updateCanvasRect();

    const windSpeed = Math.hypot(mouse.vx, mouse.vy);
    const pointerMoving = windSpeed > POINTER_MOVE_MIN;
    const moveFactor = pointerMoving ? Math.min(1, windSpeed / 42) : 0;
    const windDirY = windSpeed > 0.05 ? mouse.vy / windSpeed : 0;

    const { windPx } = hasPointer ? pointerMetrics() : { windPx: windRadius };
    const windSq = windPx * windPx;
    const coreSq = (windPx * 0.42) ** 2;
    const mx = mouse.x;
    const my = mouse.y;
    const screen = { x: 0, y: 0 };

    for (const f of flaps) {
      const phase = f.col * 0.44 + f.row * 0.36;
      let force = Math.sin(t * 0.32 + phase) * IDLE_BREEZE;

      if (hasPointer) {
        flapScreenPos(f, screen);
        const sdx = screen.x - mx;
        const sdy = screen.y - my;
        const screenDistSq = sdx * sdx + sdy * sdy;
        const zone = Math.exp(-screenDistSq / windSq);
        const core = Math.exp(-screenDistSq / coreSq);
        const gust = (0.95 + Math.min(windSpeed * 0.008, 2.5)) * WIND_GAIN * zone * moveFactor;

        const dx = f.x - mouseLocal.x;
        const dy = f.y - mouseLocal.y;
        const dist = Math.hypot(dx, dy);

        /* 单轴（顶铰链 X 向）风压 + 湍流，波及外围 */
        force += (-dy / (dist || 1)) * gust * 1.85 + windDirY * gust * 1.05;

        if (zone > 0.01) {
          const turb = gust * (0.72 + core * 0.62);
          force += Math.sin(t * 5.8 + phase) * turb;
          f.velocity += (-dy / (dist || 1)) * gust * dt * 6.2;
        }

        const springMul = 1 - zone * 0.68;
        const dampMul = 1 - zone * 0.38;
        const couple = neighborCoupling(f, 'angle');
        const ripple = 1 + zone * 1.35;

        f.velocity += (-STIFFNESS * springMul * f.angle - DAMPING * dampMul * f.velocity + COUPLING * couple * ripple + force) * dt;
        f.angle += f.velocity * dt;
        f.angle = THREE.MathUtils.clamp(f.angle, -MAX_ANGLE, MAX_ANGLE);
        continue;
      }

      const couple = neighborCoupling(f, 'angle');

      f.velocity += (-STIFFNESS * f.angle - DAMPING * f.velocity + COUPLING * couple + force) * dt;
      f.angle += f.velocity * dt;
      f.angle = THREE.MathUtils.clamp(f.angle, -MAX_ANGLE, MAX_ANGLE);
    }

    syncMatrices();
    updateSpotlightColors(hasPointer);
  }

  function animate() {
    if (!active) return;
    simulate(Math.min(clock.getDelta(), 0.032));
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(animate);
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
  }

  function onPointerLeave(e) {
    if (e.relatedTarget !== null) return;
    mouse.onScreen = false;
    mouse.vx = 0;
    mouse.vy = 0;
  }

  function relayout() {
    if (!active) return;
    fitCamera();
    buildFlaps(true);
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
    applyEnvironment(pmrem.fromScene(new RoomEnvironment(), 0.04).texture, 0.55);

    new RGBELoader().load(
      HDR_URL,
      (hdr) => {
        applyEnvironment(pmrem.fromEquirectangular(hdr).texture, 0.72);
        hdr.dispose();
      },
      undefined,
      () => console.info('[IntroGrid] HDR skipped, using RoomEnvironment.'),
    );
  }

  function bindPointer() {
    const opts = { passive: true };
    window.addEventListener('pointermove', onPointerMove, opts);
    window.addEventListener('mousemove', onPointerMove, opts);
    window.addEventListener('pointerdown', onPointerMove, opts);
    window.addEventListener('pointerup', onPointerMove, opts);
    window.addEventListener('pointerout', onPointerLeave);
    window.addEventListener('blur', () => {
      mouse.onScreen = false;
    });
  }

  function unbindPointer() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('mousemove', onPointerMove);
    window.removeEventListener('pointerdown', onPointerMove);
    window.removeEventListener('pointerup', onPointerMove);
    window.removeEventListener('pointerout', onPointerLeave);
  }

  function bindResize() {
    window.addEventListener('resize', scheduleRelayout);
    if (typeof ResizeObserver !== 'undefined' && canvas) {
      resizeObserver = new ResizeObserver(scheduleRelayout);
      resizeObserver.observe(canvas);
      if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);
    }
    window.addEventListener('load', scheduleRelayout, { once: true });
  }

  function unbindResize() {
    window.removeEventListener('resize', scheduleRelayout);
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
      renderer.toneMappingExposure = 0.78;
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x000000);

      camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);

      wallGroup = new THREE.Group();
      wallGroup.rotation.x = THREE.MathUtils.degToRad(-7);
      wallGroup.rotation.y = THREE.MathUtils.degToRad(11);
      scene.add(wallGroup);

      fitCamera();

      const keyLight = new THREE.DirectionalLight(0xf0f2f6, 1.45);
      keyLight.position.set(-11, 9, 15);
      scene.add(keyLight);

      const fill = new THREE.DirectionalLight(0x3a4555, 0.14);
      fill.position.set(7, -3, 9);
      scene.add(fill);
      scene.add(new THREE.AmbientLight(0x0a0a0c, 0.06));

      loadEnvironment();
      buildFlaps(false);
      scheduleRelayout();
      bindPointer();
      bindResize();
      rafId = requestAnimationFrame(animate);
    } catch (err) {
      active = false;
      console.error('[IntroGrid]', err);
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

    unbindPointer();
    unbindResize();

    disposeMesh();

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
