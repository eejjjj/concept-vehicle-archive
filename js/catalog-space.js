/* Catalog · CV/HUD 识别标签 · 宇宙空间（星点由 catalog-stars.js 负责） */

import * as THREE from 'three';

const CatalogSpace = (() => {
  const SIDE_IMAGES = {
    1: 'assets/001-side.png',
    2: 'assets/002-side.png',
  };

  function sideImageUrl(id) {
    const path = SIDE_IMAGES[id];
    return path ? window.assetPath(path) : null;
  }

  const LAYOUT = [
    { id: 1, w: 2.18, h: 1.42, x: -3.1, y: 0.95, z: -1.6 },
    { id: 2, w: 1.52, h: 1.02, x: 2.85, y: -0.55, z: 0.75 },
    { id: 3, w: 1.05, h: 0.72, x: -1.15, y: -1.75, z: 2.05 },
    { id: 4, w: 1.88, h: 1.22, x: 0.95, y: 2.05, z: -0.65 },
    { id: 5, w: 1.18, h: 0.82, x: -2.45, y: -0.35, z: 1.85 },
    { id: 6, w: 1.62, h: 1.08, x: 3.35, y: 1.35, z: -0.25 },
    { id: 7, w: 1.28, h: 0.86, x: 0.35, y: 0.25, z: -2.65 },
    { id: 8, w: 1.38, h: 0.92, x: -1.75, y: 2.15, z: 1.15 },
    { id: 9, w: 2.02, h: 1.32, x: 1.95, y: -1.95, z: 2.15 },
  ];

  let sceneCanvas = null;
  let hudLayer = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let cosmosGroup = null;
  let modules = [];
  let active = false;
  let rafId = 0;
  let clock = null;

  let orbitTheta = 0.08;
  let orbitPhi = 1.42;
  let orbitRadius = 10.5;
  let targetTheta = 0.08;
  let targetPhi = 1.42;
  let targetRadius = 10.5;

  let dragging = false;
  let moved = false;
  let lastX = 0;
  let lastY = 0;
  let downX = 0;
  let downY = 0;
  let hovered = null;

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const projCenter = new THREE.Vector3();
  const projRight = new THREE.Vector3();
  const projUp = new THREE.Vector3();

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function viewportSize(el) {
    const rect = el.getBoundingClientRect();
    return {
      w: Math.max(Math.round(rect.width), 1),
      h: Math.max(Math.round(rect.height), 1),
    };
  }

  function fitRenderer() {
    if (!renderer || !camera || !sceneCanvas) return;
    const { w, h } = viewportSize(sceneCanvas);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function updateCamera() {
    const x = orbitRadius * Math.sin(orbitPhi) * Math.sin(orbitTheta);
    const y = orbitRadius * Math.cos(orbitPhi);
    const z = orbitRadius * Math.sin(orbitPhi) * Math.cos(orbitTheta);
    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);
  }

  function makeHitPlane(w, h) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    mesh.userData.isHit = true;
    return mesh;
  }

  function makeHudElement(vehicle, isOpen) {
    const el = document.createElement('article');
    el.className = `catalog-hud${isOpen ? ' is-open' : ' is-locked'}`;
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', isOpen ? '0' : '-1');
    el.setAttribute('aria-label', isOpen ? vehicle.name : `Module ${pad(vehicle.id)} locked`);

    const match = isOpen ? (vehicle.id === 1 ? 98 : 100) : 0;
    const sideUrl = sideImageUrl(vehicle.id);
    const visual = isOpen && sideUrl
      ? `<img class="catalog-hud__img" src="${sideUrl}" alt="">`
      : `<div class="catalog-hud__empty" aria-hidden="true"><span>EMPTY</span><span>CONTENT</span></div>`;

    el.innerHTML = `
      <div class="catalog-hud__tag">${isOpen ? `Vehicle.Side · ${vehicle.code}` : 'Archive.Sealed'}</div>
      <div class="catalog-hud__frame">
        <span class="catalog-hud__corner catalog-hud__corner--tl"></span>
        <span class="catalog-hud__corner catalog-hud__corner--tr"></span>
        <span class="catalog-hud__corner catalog-hud__corner--bl"></span>
        <span class="catalog-hud__corner catalog-hud__corner--br"></span>
        <div class="catalog-hud__visual">${visual}</div>
        <div class="catalog-hud__scan" aria-hidden="true"></div>
      </div>
      <div class="catalog-hud__readout">
        <div class="catalog-hud__row">
          <span class="catalog-hud__key">Module</span>
          <span class="catalog-hud__val">${pad(vehicle.id)} / 09</span>
        </div>
        <div class="catalog-hud__row">
          <span class="catalog-hud__key">Match</span>
          <span class="catalog-hud__val${isOpen ? ' catalog-hud__val--hot' : ''}">${isOpen ? `${match}%` : '— —'}</span>
        </div>
        <div class="catalog-hud__row">
          <span class="catalog-hud__key">Access</span>
          <span class="catalog-hud__bar"><i style="width:${isOpen ? match : 8}%"></i></span>
        </div>
        ${isOpen
          ? `<div class="catalog-hud__row"><span class="catalog-hud__key">Class</span><span class="catalog-hud__val catalog-hud__val--name">${vehicle.name}</span></div>`
          : `<div class="catalog-hud__row"><span class="catalog-hud__key">Signal</span><span class="catalog-hud__val">NO DATA</span></div>`}
      </div>
    `;
    hudLayer.appendChild(el);
    return el;
  }

  function buildModules() {
    modules = [];
    if (hudLayer) hudLayer.innerHTML = '';
    while (cosmosGroup.children.length) {
      const child = cosmosGroup.children[0];
      cosmosGroup.remove(child);
      child.traverse((obj) => {
        obj.geometry?.dispose();
        obj.material?.dispose?.();
      });
    }

    LAYOUT.forEach((slot) => {
      const vehicle = typeof VEHICLES !== 'undefined'
        ? VEHICLES.find((v) => v.id === slot.id)
        : null;
      if (!vehicle) return;

      const isOpen = Boolean(vehicle.available);
      const group = new THREE.Group();
      group.position.set(slot.x, slot.y, slot.z);
      group.add(makeHitPlane(slot.w, slot.h));

      const hudEl = makeHudElement(vehicle, isOpen);

      group.userData = {
        vehicle,
        isOpen,
        frameW: slot.w,
        frameH: slot.h,
        hudEl,
        baseY: slot.y,
        floatPhase: Math.random() * Math.PI * 2,
        shakeT: 0,
      };

      cosmosGroup.add(group);
      modules.push(group);
    });
  }

  function projectHud(group) {
    const { frameW, frameH, hudEl } = group.userData;
    const { w: vw, h: vh } = viewportSize(sceneCanvas);

    group.updateMatrixWorld(true);
    cosmosGroup.updateMatrixWorld(true);

    projCenter.set(0, 0, 0);
    group.localToWorld(projCenter);

    projRight.set(frameW * 0.5, 0, 0);
    group.localToWorld(projRight);

    projUp.set(0, frameH * 0.5, 0);
    group.localToWorld(projUp);

    projCenter.project(camera);
    projRight.project(camera);
    projUp.project(camera);

    if (projCenter.z > 1) {
      hudEl.style.opacity = '0';
      hudEl.style.pointerEvents = 'none';
      return;
    }

    const cx = (projCenter.x * 0.5 + 0.5) * vw;
    const cy = (-projCenter.y * 0.5 + 0.5) * vh;
    const rx = (projRight.x * 0.5 + 0.5) * vw;
    const ty = (-projUp.y * 0.5 + 0.5) * vh;

    const width = Math.max(Math.abs(rx - cx) * 2, 48);
    const height = Math.max(Math.abs(ty - cy) * 2, 36);
    const depthFade = THREE.MathUtils.clamp(1 - (projCenter.z + 1) * 0.14, 0.18, 1);

    hudEl.style.opacity = String(depthFade);
    hudEl.style.pointerEvents = 'none';
    hudEl.style.width = `${width}px`;
    hudEl.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`;
    hudEl.style.setProperty('--hud-h', `${height}px`);
  }

  function updateHuds() {
    if (!hudLayer || !camera || !sceneCanvas) return;
    modules.forEach((group) => {
      group.quaternion.copy(camera.quaternion);
      projectHud(group);
    });
  }

  function setHover(group) {
    if (hovered === group) return;
    if (hovered?.userData.hudEl) hovered.userData.hudEl.classList.remove('is-hover');
    hovered = group;
    if (hovered?.userData.isOpen) {
      hovered.userData.hudEl?.classList.add('is-hover');
      sceneCanvas.classList.add('is-hover-open');
    } else {
      sceneCanvas.classList.remove('is-hover-open');
    }
  }

  function pointerToNdc(e) {
    const rect = sceneCanvas.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function pickModule(e) {
    pointerToNdc(e);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(
      modules.map((g) => g.children.find((c) => c.userData.isHit)).filter(Boolean),
      false,
    );
    return hits.length ? hits[0].object.parent : null;
  }

  function triggerShake(group) {
    group.userData.shakeT = 0.42;
    group.userData.hudEl?.classList.add('is-shake');
    setTimeout(() => group.userData.hudEl?.classList.remove('is-shake'), 420);
  }

  function navigateTo(group) {
    const v = group.userData.vehicle;
    if (!v?.available || typeof vehicleUrl !== 'function') return;
    if (typeof Motion !== 'undefined' && Motion.pageExit) {
      Motion.pageExit(vehicleUrl(v));
    } else {
      window.location.href = vehicleUrl(v);
    }
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    dragging = true;
    moved = false;
    downX = e.clientX;
    downY = e.clientY;
    lastX = e.clientX;
    lastY = e.clientY;
    sceneCanvas.classList.add('is-dragging');
    sceneCanvas.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (dragging) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) moved = true;
      targetTheta += dx * 0.0052;
      targetPhi = THREE.MathUtils.clamp(targetPhi + dy * 0.0048, 0.35, 2.75);
      lastX = e.clientX;
      lastY = e.clientY;
      if (moved) setHover(null);
      return;
    }
    const hit = pickModule(e);
    setHover(hit && hit.userData.isOpen ? hit : null);
  }

  function onPointerUp(e) {
    sceneCanvas.classList.remove('is-dragging');
    if (dragging && !moved) {
      const hit = pickModule(e);
      if (hit) {
        if (hit.userData.isOpen) navigateTo(hit);
        else triggerShake(hit);
      }
    }
    dragging = false;
  }

  function onWheel(e) {
    e.preventDefault();
    targetRadius = THREE.MathUtils.clamp(targetRadius + e.deltaY * 0.012, 6.2, 16.5);
  }

  function onResize() {
    fitRenderer();
  }

  function bindEvents() {
    sceneCanvas.addEventListener('pointerdown', onPointerDown);
    sceneCanvas.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    sceneCanvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', onResize);
  }

  function unbindEvents() {
    sceneCanvas?.removeEventListener('pointerdown', onPointerDown);
    sceneCanvas?.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    sceneCanvas?.removeEventListener('wheel', onWheel);
    window.removeEventListener('resize', onResize);
  }

  function animate() {
    if (!active) return;
    const t = clock.getElapsedTime();
    const dt = Math.min(clock.getDelta(), 0.032);
    const smooth = 1 - Math.exp(-dt * 9);

    orbitTheta += (targetTheta - orbitTheta) * smooth;
    orbitPhi += (targetPhi - orbitPhi) * smooth;
    orbitRadius += (targetRadius - orbitRadius) * smooth;
    updateCamera();

    cosmosGroup.rotation.y += dt * 0.018;

    modules.forEach((group) => {
      const d = group.userData;
      group.position.y = d.baseY + Math.sin(t * 0.55 + d.floatPhase) * 0.11;
    });

    updateHuds();
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(animate);
  }

  async function waitForCanvasSize(maxTries = 60) {
    for (let i = 0; i < maxTries; i++) {
      const { w, h } = viewportSize(sceneCanvas);
      if (w >= 40 && h >= 40) return;
      await new Promise((r) => requestAnimationFrame(r));
    }
  }

  async function init(sceneId) {
    sceneCanvas = document.getElementById(sceneId);
    if (!sceneCanvas || active) return false;

    try {
      active = true;
      clock = new THREE.Clock();

      hudLayer = document.createElement('div');
      hudLayer.className = 'catalog-space__huds';
      document.getElementById('catalog-space')?.appendChild(hudLayer);

      await waitForCanvasSize();

      renderer = new THREE.WebGLRenderer({
        canvas: sceneCanvas,
        antialias: true,
        alpha: true,
      });
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
      updateCamera();

      cosmosGroup = new THREE.Group();
      scene.add(cosmosGroup);
      buildModules();

      fitRenderer();
      bindEvents();
      sceneCanvas.classList.add('is-loaded');
      document.getElementById('catalog-space')?.classList.add('is-ready');
      rafId = requestAnimationFrame(animate);
      return true;
    } catch (err) {
      active = false;
      console.error('[CatalogSpace]', err);
      throw err;
    }
  }

  function destroy() {
    active = false;
    cancelAnimationFrame(rafId);
    unbindEvents();
    hudLayer?.remove();
    modules.forEach((g) => {
      g.traverse((obj) => {
        obj.geometry?.dispose();
        obj.material?.dispose?.();
      });
    });
    renderer?.dispose();
    scene = null;
    camera = null;
    cosmosGroup = null;
    modules = [];
    sceneCanvas = null;
    hudLayer = null;
  }

  return { init, destroy };
})();

window.CatalogSpace = CatalogSpace;
window.__catalogReady = true;
document.dispatchEvent(new CustomEvent('catalog:ready'));
