/* 风动片 · InstancedMesh · 斜透视 · 侧光 PBR · 指针风场 */

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const IntroGrid = (() => {
  const STIFFNESS = 58;
  const DAMPING = 7.5;
  const COUPLING = 6.5;
  const WIND_GAIN = 1.35;
  const IDLE_BREEZE = 0.04;
  const GAP = 0.075;
  const FLAP_DEPTH = 0.1;
  const CELL_PX = 60;
  const HDR_URL =
    'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr';
  const LOOK_AT = new THREE.Vector3(0.5, -0.1, 0);

  let canvas = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let mesh = null;
  let wallGroup = null;
  let pmrem = null;
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

  let mouse = { x: -9999, y: -9999, vx: 0, vy: 0, onScreen: false };
  let prevMouse = { x: -9999, y: -9999, t: 0 };

  function updateCanvasRect() {
    if (canvas) canvasRect = canvas.getBoundingClientRect();
  }

  function updateWallPlane() {
    if (!wallGroup) return;
    wallGroup.updateMatrixWorld(true);
    planeNormal.set(0, 0, 1).applyQuaternion(wallGroup.quaternion);
    planePoint.set(0, 0, 0).applyMatrix4(wallGroup.matrixWorld);
    wallPlane.setFromNormalAndCoplanarPoint(planeNormal, planePoint);
  }

  function setupCamera() {
    camera.position.set(-5.8, 0.95, 10.6);
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

  function fitCamera() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    setupCamera();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    updateCanvasRect();
    updateWallPlane();
  }

  function getWallCoverage() {
    updateWallPlane();
    const samples = [
      [-1, -1], [1, -1], [-1, 1], [1, 1],
      [0, -1], [0, 1], [-1, 0], [1, 0],
    ];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const [nx, ny] of samples) {
      ndc.set(nx, ny);
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(wallPlane, hitPoint)) continue;
      localPoint.copy(hitPoint);
      wallGroup.worldToLocal(localPoint);
      minX = Math.min(minX, localPoint.x);
      maxX = Math.max(maxX, localPoint.x);
      minY = Math.min(minY, localPoint.y);
      maxY = Math.max(maxY, localPoint.y);
    }

    const pad = 0.28;
    minX -= pad;
    maxX += pad;
    minY -= pad;
    maxY += pad;

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

  function buildFlaps() {
    disposeMesh();
    wallCoverage = getWallCoverage();
    const cov = wallCoverage;

    cols = Math.max(9, Math.floor(window.innerWidth / CELL_PX));
    rows = Math.max(6, Math.floor(window.innerHeight / CELL_PX));

    const flapW = (cov.width - GAP * (cols + 1)) / cols;
    const flapH = (cov.height - GAP * (rows + 1)) / rows;
    const totalW = cols * flapW + (cols - 1) * GAP;
    const totalH = rows * flapH + (rows - 1) * GAP;

    windRadius = Math.max(cov.width, cov.height) * 0.18;

    const geometry = new THREE.BoxGeometry(flapW, flapH, FLAP_DEPTH);
    geometry.translate(0, -flapH / 2, 0);

    const material = new THREE.MeshStandardMaterial({
      color: 0x282c32,
      metalness: 0.94,
      roughness: 0.3,
      envMapIntensity: 0.55,
    });

    mesh = new THREE.InstancedMesh(geometry, material, cols * rows);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    wallGroup.add(mesh);

    flaps = [];
    const startX = cov.cx - totalW / 2;
    const startY = cov.cy + totalH / 2;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const ix = row * cols + col;
        flaps.push({
          ix,
          col,
          row,
          x: startX + col * (flapW + GAP) + flapW / 2,
          y: startY - row * (flapH + GAP) - flapH / 2,
          angle: 0,
          velocity: 0,
          angleY: 0,
          velocityY: 0,
          neighbors: buildNeighbors(ix, col, row),
        });
      }
    }

    syncMatrices();
  }

  function syncMatrices() {
    if (!mesh) return;
    for (const f of flaps) {
      dummy.position.set(f.x, f.y, 0);
      dummy.rotation.set(f.angle, f.angleY, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(f.ix, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** 屏幕坐标 → 墙面局部坐标（主方案，不依赖射线是否命中） */
  function pointerLocalFromScreen(sx, sy, target) {
    if (!wallCoverage) return false;
    if (!canvasRect || canvasRect.width === 0) updateCanvasRect();

    const u = THREE.MathUtils.clamp((sx - canvasRect.left) / canvasRect.width, 0, 1);
    const v = THREE.MathUtils.clamp((sy - canvasRect.top) / canvasRect.height, 0, 1);

    target.x = wallCoverage.minX + u * wallCoverage.width;
    target.y = wallCoverage.maxY - v * wallCoverage.height;
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

    const windSpeed = Math.hypot(mouse.vx, mouse.vy);
    const windDirX = windSpeed > 0.05 ? mouse.vx / windSpeed : 0;
    const windDirY = windSpeed > 0.05 ? mouse.vy / windSpeed : 0;

    for (const f of flaps) {
      const phase = f.col * 0.44 + f.row * 0.36;
      let forceX = Math.sin(t * 0.32 + phase) * IDLE_BREEZE;
      let forceY = Math.cos(t * 0.28 + phase * 1.05) * IDLE_BREEZE * 0.25;

      if (hasPointer) {
        const dx = f.x - mouseLocal.x;
        const dy = f.y - mouseLocal.y;
        const dist = Math.hypot(dx, dy);
        const distSq = dist * dist;
        const falloff = Math.exp(-distSq / (windRadius * windRadius));
        const gust = (0.65 + Math.min(windSpeed * 0.006, 2)) * WIND_GAIN * falloff;

        forceX += (-dy / (dist || 1)) * gust + windDirY * gust * 0.55;
        forceY += (dx / (dist || 1)) * gust * 0.35 + windDirX * gust * 0.25;

        if (falloff > 0.08) {
          f.velocity += (-dy / (dist || 1)) * gust * dt * 3.2;
          f.velocityY += (dx / (dist || 1)) * gust * dt * 1.6;
        }
      }

      const coupleX = neighborCoupling(f, 'angle');
      const coupleY = neighborCoupling(f, 'angleY');

      f.velocity += (-STIFFNESS * f.angle - DAMPING * f.velocity + COUPLING * coupleX + forceX) * dt;
      f.velocityY += (-STIFFNESS * f.angleY - DAMPING * f.velocityY + COUPLING * coupleY * 0.4 + forceY) * dt;
      f.angle += f.velocity * dt;
      f.angleY += f.velocityY * dt;

      f.angle = THREE.MathUtils.clamp(f.angle, -1.2, 1.2);
      f.angleY = THREE.MathUtils.clamp(f.angleY, -0.35, 0.35);
    }

    syncMatrices();
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

  function onResize() {
    if (!active) return;
    fitCamera();
    buildFlaps();
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
    window.addEventListener('pointerdown', onPointerMove, opts);
    window.addEventListener('pointerup', onPointerMove, opts);
    window.addEventListener('pointerout', onPointerLeave);
    window.addEventListener('blur', () => {
      mouse.onScreen = false;
    });
  }

  function unbindPointer() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerdown', onPointerMove);
    window.removeEventListener('pointerup', onPointerMove);
    window.removeEventListener('pointerout', onPointerLeave);
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

      camera = new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 0.1, 80);

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
      buildFlaps();
      bindPointer();
      rafId = requestAnimationFrame(animate);
      window.addEventListener('resize', onResize);
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
    window.removeEventListener('resize', onResize);

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
