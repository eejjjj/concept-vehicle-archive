/**
 * /emax/model · 3D concept-car specimen (same chrome as /emax/pages, no reader)
 */
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

function ap(path) {
  return window.assetPath(String(path).replace(/^\//, ''));
}

const HDR_URL =
  'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr';
const MODEL_URL = 'assets/ConceptCar.glb';
const DRACO_PATH = 'vendor/three/examples/jsm/libs/draco/gltf/';

const VIEW_MARGIN = 1.12;
const DEFAULT_ROT_X = 0;
const DEFAULT_ROT_Y = 0;
const DEFAULT_ROT_Z = 0;
const MIN_ROT_X = -1.15;
const MAX_ROT_X = 1.15;
const CLOSED_FOV = 36;
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 2.4;
const ZOOM_STEP = 0.22;
const ZOOM_HOLD_DELAY = 320;
const ZOOM_HOLD_PER_SEC = 0.85;
const LANDSCAPE_ZOOM = 1.34;
const PHONE_MQ = window.CVA_MQ?.phone
  || '(max-width: 900px), (pointer: coarse) and (hover: none) and (max-height: 600px), (pointer: coarse) and (hover: none) and (orientation: landscape) and (max-width: 1100px), (max-width: 1100px) and (max-height: 600px) and (orientation: landscape)';
const PORTRAIT_MQ = window.CVA_MQ?.phonePortrait
  || '(max-width: 900px) and (orientation: portrait), (pointer: coarse) and (hover: none) and (orientation: portrait) and (max-width: 500px)';
const PHONE_LANDSCAPE_MQ = window.CVA_MQ?.phoneLandscape
  || '(max-width: 900px) and (orientation: landscape), (pointer: coarse) and (hover: none) and (orientation: landscape) and (max-width: 1100px), (max-width: 1100px) and (max-height: 600px) and (orientation: landscape)';
const DRAG_THRESHOLD = 6;
const LIGHT_MAT_NAMES = new Set([
  '材质.001',
  '材质.002',
  '材质.007',
  '材质.011',
  '材质.012',
  'ninebot',
]);

function emaxUrl() {
  return ap('emax/');
}

function emaxPagesUrl() {
  return ap('emax/pages/');
}

const EmaxModel = (() => {
  let canvas = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let carGroup = null;
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
  let pointers = new Map();
  let pinch = null;
  let lightsOn = true;
  let lightMats = [];
  let themeRevealed = false;
  let viewZoom = 1;
  let zoomHold = null;
  let lastLandscape = null;
  let lastDrawW = 0;
  let lastDrawH = 0;
  let fitRaf = 0;

  function isPhoneLandscape() {
    return window.matchMedia(PHONE_LANDSCAPE_MQ).matches;
  }

  function isLandscapeLayout() {
    if (isPhoneLandscape()) return true;
    const vv = window.visualViewport;
    if (vv?.width && vv?.height) return vv.width > vv.height;
    return window.innerWidth > window.innerHeight;
  }

  function defaultZoom() {
    return isPhone() && isLandscapeLayout() ? LANDSCAPE_ZOOM : 1;
  }

  function syncDefaultZoom() {
    const { w, h } = getDisplaySize();
    const landscape = isPhone() && w > h;
    if (lastLandscape === landscape) return false;
    lastLandscape = landscape;
    viewZoom = landscape ? LANDSCAPE_ZOOM : 1;
    return true;
  }

  function visualFrame() {
    const root = getComputedStyle(document.documentElement);
    const cssW = parseFloat(root.getPropertyValue('--reader-vvw'));
    const cssH = parseFloat(root.getPropertyValue('--reader-vvh'));
    const vv = window.visualViewport;
    const w = Number.isFinite(cssW) && cssW > 40
      ? cssW
      : Math.round(vv?.width || window.innerWidth || 0);
    const h = Number.isFinite(cssH) && cssH > 40
      ? cssH
      : Math.round(vv?.height || window.innerHeight || 0);
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }

  function getDisplaySize() {
    if (!canvas) return { w: 1, h: 1 };
    const r = canvas.getBoundingClientRect();
    let w = canvas.clientWidth || r.width;
    let h = canvas.clientHeight || r.height;
    if (w < 40 || h < 40) {
      const slot = canvas.closest('.detail-visual--book') || canvas.parentElement;
      const sr = slot?.getBoundingClientRect();
      w = Math.max(w, sr?.width || 0, 1);
      h = Math.max(h, sr?.height || 0, 1);
    }
    if (isPhone()) {
      const frame = visualFrame();
      if (h > frame.h + 1) h = frame.h;
      if (w > frame.w + 1) w = frame.w;
    }
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }

  function fitRenderer() {
    if (!renderer || !camera || !canvas) return false;
    const { w, h } = getDisplaySize();
    const bw = Math.round(w);
    const bh = Math.round(h);
    camera.aspect = bw / Math.max(1, bh);
    if (bw === lastDrawW && bh === lastDrawH) {
      camera.updateProjectionMatrix();
      return false;
    }
    lastDrawW = bw;
    lastDrawH = bh;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(bw, bh, false);
    camera.updateProjectionMatrix();
    return true;
  }

  function syncZoomButtons() {
    const wrap = document.getElementById('model-zoom');
    if (!wrap) return;
    const inn = wrap.querySelector('[data-zoom="in"]');
    const out = wrap.querySelector('[data-zoom="out"]');
    if (inn) inn.disabled = viewZoom >= ZOOM_MAX - 1e-6;
    if (out) out.disabled = viewZoom <= ZOOM_MIN + 1e-6;
  }

  function fitCarToView() {
    if (!camera || !viewSphere) return;
    camera.fov = CLOSED_FOV;
    fitRenderer();
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov * 0.5) * camera.aspect);
    const radius = viewSphere.radius * VIEW_MARGIN;
    const fitDist = Math.max(
      radius / Math.sin(vFov * 0.5),
      radius / Math.sin(hFov * 0.5),
    );
    const dist = fitDist / viewZoom;
    camera.near = Math.max(0.05, dist / 120);
    camera.far = Math.max(80, dist * 8);
    camera.position.set(
      viewSphere.center.x,
      viewSphere.center.y - radius * 0.08,
      viewSphere.center.z + dist,
    );
    camera.lookAt(
      viewSphere.center.x,
      viewSphere.center.y - radius * 0.07,
      viewSphere.center.z,
    );
    camera.updateProjectionMatrix();
    syncZoomButtons();
    paintNow();
  }

  function paintNow() {
    if (!active || !renderer || !scene || !camera) return;
    if (carGroup) carGroup.rotation.set(rotX, rotY, rotZ);
    renderer.render(scene, camera);
  }

  function applyZoom(next) {
    const clamped = THREE.MathUtils.clamp(next, ZOOM_MIN, ZOOM_MAX);
    if (Math.abs(clamped - viewZoom) < 1e-6) {
      syncZoomButtons();
      return;
    }
    viewZoom = clamped;
    fitCarToView();
  }

  function nudgeZoom(dir) {
    applyZoom(viewZoom + dir * ZOOM_STEP);
  }

  function stopZoomHold(applyClick) {
    if (!zoomHold) return;
    const { dir, btn, holding, pointerId, timer } = zoomHold;
    if (timer) clearTimeout(timer);
    if (pointerId != null && btn) {
      try {
        btn.releasePointerCapture(pointerId);
      } catch (_) {}
    }
    btn?.classList.remove('is-pressed');
    zoomHold = null;
    if (applyClick && !holding) nudgeZoom(dir);
  }

  function tickZoomHold(dt) {
    if (!zoomHold?.holding) return;
    applyZoom(viewZoom + zoomHold.dir * ZOOM_HOLD_PER_SEC * dt);
  }

  function bindZoom() {
    const wrap = document.getElementById('model-zoom');
    if (!wrap || wrap.dataset.bound) return;
    wrap.dataset.bound = '1';
    wrap.addEventListener('contextmenu', (e) => e.preventDefault());
    wrap.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const btn = e.target.closest('[data-zoom]');
      if (!btn || btn.disabled) return;
      if (e.pointerType === 'mouse' && e.button != null && e.button !== 0) return;
      e.preventDefault();
      stopZoomHold(false);
      btn.classList.add('is-pressed');
      btn.setPointerCapture?.(e.pointerId);
      zoomHold = {
        dir: btn.dataset.zoom === 'in' ? 1 : -1,
        btn,
        holding: false,
        pointerId: e.pointerId,
        timer: window.setTimeout(() => {
          if (!zoomHold) return;
          zoomHold.holding = true;
          zoomHold.timer = 0;
        }, ZOOM_HOLD_DELAY),
      };
    });
    wrap.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      stopZoomHold(true);
    });
    wrap.addEventListener('pointercancel', (e) => {
      e.stopPropagation();
      stopZoomHold(false);
    });
  }

  function scheduleFit() {
    if (!active) return;
    if (fitRaf) return;
    fitRaf = requestAnimationFrame(() => {
      fitRaf = 0;
      if (!active) return;
      syncDefaultZoom();
      fitCarToView();
    });
  }

  function onResize() {
    scheduleFit();
  }

  function isPhone() {
    return window.matchMedia(PHONE_MQ).matches;
  }

  const portraitMq = window.matchMedia(PORTRAIT_MQ);

  function syncRotateHint() {
    const hint = document.getElementById('reader-rotate-hint');
    if (!hint) return;
    hint.hidden = !portraitMq.matches;
  }

  function onPortraitMqChange() {
    syncRotateHint();
    scheduleFit();
  }

  function applyReaderViewportHeight() {
    const vv = window.visualViewport;
    const h = Math.round(vv?.height || window.innerHeight || 0);
    const w = Math.round(vv?.width || window.innerWidth || 0);
    const root = document.documentElement;
    root.style.setProperty('--reader-vvh', `${h}px`);
    root.style.setProperty('--reader-vvw', `${w}px`);
  }

  function concealMobileBrowserChrome() {
    const land = window.matchMedia(PHONE_LANDSCAPE_MQ).matches;
    const phone = window.matchMedia(PHONE_MQ).matches;
    const html = document.documentElement;
    const body = document.body;
    html.classList.toggle('is-reader-landscape', land);
    if (!phone) {
      html.style.removeProperty('--reader-vvh');
      html.style.removeProperty('--reader-vvw');
      return;
    }
    applyReaderViewportHeight();
    if (!land) return;
    const lock = () => {
      window.scrollTo(0, 0);
      html.scrollTop = 0;
      body.scrollTop = 0;
      body.style.height = '';
      body.style.minHeight = '';
      html.style.overflow = 'hidden';
      body.style.overflow = 'hidden';
      applyReaderViewportHeight();
    };
    html.style.overflow = 'auto';
    body.style.overflow = 'auto';
    body.style.minHeight = 'calc(100lvh + 80px)';
    window.scrollTo(0, 1);
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      requestAnimationFrame(lock);
    });
    window.setTimeout(lock, 280);
    window.setTimeout(lock, 800);
  }

  function onViewportChrome() {
    if (isPhone()) applyReaderViewportHeight();
    scheduleFit();
  }

  function onOrientationChange() {
    syncRotateHint();
    concealMobileBrowserChrome();
    scheduleFit();
  }

  function bindBarLink(id, urlFn) {
    const el = document.getElementById(id);
    if (!el || el.dataset.pressBound) return;
    el.dataset.pressBound = '1';
    const pressOn = (e) => {
      if (e.pointerType === 'mouse' && e.button != null && e.button !== 0) return;
      el.classList.add('is-pressed');
    };
    const pressOff = () => el.classList.remove('is-pressed');
    el.addEventListener('pointerdown', pressOn);
    el.addEventListener('pointerup', pressOff);
    el.addEventListener('pointercancel', pressOff);
    el.addEventListener('pointerleave', pressOff);
    el.addEventListener('click', (e) => {
      e.preventDefault();
      el.classList.remove('is-pressed');
      const url = urlFn();
      if (window.Motion?.pageExit) Motion.pageExit(url, 0);
      else location.assign(url);
    });
  }

  function bindBack() {
    bindBarLink('book-reader-back', emaxUrl);
    bindBarLink('model-pages-open', emaxPagesUrl);
  }

  function isNinebotMat(m) {
    return !!m && m.name === 'ninebot';
  }

  function isSeatMat(m) {
    return !!m && m.name === '材质.006';
  }

  function prepareSeatSilver(m, envMap) {
    if (!isSeatMat(m) || m.userData.seatSilver) return;
    m.userData.seatSilver = true;
    m.color.setHex(0xd6dae0);
    m.metalness = 0.52;
    m.roughness = 0.40;
    m.metalnessMap = null;
    m.roughnessMap = null;
    if (envMap && 'envMap' in m) {
      m.envMap = envMap;
      m.envMapIntensity = 0.42;
    }
    m.needsUpdate = true;
  }

  function prepareNinebotLight(m) {
    if (!isNinebotMat(m) || m.userData.ninebotLight) return;
    m.userData.ninebotLight = true;
    m.transparent = true;
    m.depthWrite = false;
    m.side = THREE.FrontSide;
    m.metalness = 0;
    m.roughness = Math.max(m.roughness || 0, 0.42);
    m.emissive.set(0xffffff);
    m.emissiveIntensity = 1.85;
    m.needsUpdate = true;
  }

  function isCarLightMaterial(m) {
    if (!m) return false;
    if (LIGHT_MAT_NAMES.has(m.name)) return true;
    if (!m.emissive) return false;
    const glow = m.emissive.r + m.emissive.g + m.emissive.b;
    return glow > 0.05 && (m.emissiveIntensity || 0) > 0.5;
  }

  function collectCarLights(root) {
    const seen = new Set();
    lightMats = [];
    root.traverse((obj) => {
      if (!obj.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!m || seen.has(m) || !isCarLightMaterial(m)) continue;
        seen.add(m);
        lightMats.push({
          mat: m,
          intensity: m.emissiveIntensity,
          color: m.emissive.clone(),
        });
      }
    });
  }

  function syncLightsToggle() {
    const root = document.getElementById('model-lights');
    if (!root) return;
    root.querySelectorAll('[data-lights]').forEach((btn) => {
      const activeBtn = (btn.dataset.lights === 'on') === lightsOn;
      btn.classList.toggle('is-active', activeBtn);
      btn.setAttribute('aria-pressed', activeBtn ? 'true' : 'false');
    });
  }

  function revealDayTheme() {
    if (themeRevealed) return;
    themeRevealed = true;
    document.body.classList.add('is-model-day');
  }

  function applyLights(on) {
    if (!on) revealDayTheme();
    lightsOn = on;
    for (const item of lightMats) {
      if (on) {
        item.mat.emissive.copy(item.color);
        item.mat.emissiveIntensity = item.intensity;
      } else {
        item.mat.emissive.setRGB(0, 0, 0);
        item.mat.emissiveIntensity = 0;
      }
      item.mat.needsUpdate = true;
    }
    syncLightsToggle();
  }

  function onLightsToggleClick(e) {
    const btn = e.target.closest('[data-lights]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    applyLights(btn.dataset.lights === 'on');
  }

  function onLightsPointerDown(e) {
    e.stopPropagation();
  }

  function bindLightsToggle() {
    lightsOn = true;
    const root = document.getElementById('model-lights');
    if (!root) return;
    root.addEventListener('click', onLightsToggleClick);
    root.addEventListener('pointerdown', onLightsPointerDown);
    syncLightsToggle();
  }

  function unbindLightsToggle() {
    const root = document.getElementById('model-lights');
    if (!root) return;
    root.removeEventListener('click', onLightsToggleClick);
    root.removeEventListener('pointerdown', onLightsPointerDown);
  }

  function pinchDistance() {
    if (pointers.size < 2) return 0;
    const pts = [...pointers.values()];
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  function stopRotateDrag() {
    dragging = false;
    pointerMoved = false;
    canvas?.classList.remove('is-dragging');
    if (pointerCaptured) {
      pointerCaptured = false;
    }
  }

  function beginPinch() {
    const dist = pinchDistance();
    pinch = { dist: Math.max(8, dist), zoom: viewZoom };
    stopRotateDrag();
  }

  function endPinch() {
    pinch = null;
    stopRotateDrag();
  }

  function onPointerDown(e) {
    if (!active) return;
    if (e.pointerType === 'mouse' && e.button != null && e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (isPhone() && pointers.size >= 2) {
      beginPinch();
      canvas.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }

    if (pinch) return;

    pointerDownX = e.clientX;
    pointerDownY = e.clientY;
    pointerMoved = false;
    pointerCaptured = false;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  }

  function onPointerMove(e) {
    if (pointers.has(e.pointerId)) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pinch) {
      if (pointers.size >= 2) applyZoom(pinch.zoom * (pinchDistance() / pinch.dist));
      e.preventDefault();
      return;
    }

    if (!dragging) return;
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
    targetRotX = THREE.MathUtils.clamp(targetRotX, MIN_ROT_X, MAX_ROT_X);
    lastX = e.clientX;
    lastY = e.clientY;
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) endPinch();
      try { canvas?.releasePointerCapture?.(e.pointerId); } catch (_) {}
      return;
    }
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove('is-dragging');
    if (pointerCaptured) {
      canvas.releasePointerCapture?.(e.pointerId);
      pointerCaptured = false;
    }
  }

  function onSafariGesture(e) {
    if (!isPhone()) return;
    e.preventDefault();
  }

  function onTouchMovePinch(e) {
    if (!isPhone() || e.touches.length < 2) return;
    e.preventDefault();
  }

  function bindPointer() {
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('gesturestart', onSafariGesture);
    canvas.addEventListener('gesturechange', onSafariGesture);
    canvas.addEventListener('gestureend', onSafariGesture);
    canvas.addEventListener('touchmove', onTouchMovePinch, { passive: false });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onOrientationChange);
    if (portraitMq.addEventListener) portraitMq.addEventListener('change', onPortraitMqChange);
    else portraitMq.addListener(onPortraitMqChange);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onViewportChrome);
      window.visualViewport.addEventListener('scroll', onViewportChrome);
    }
  }

  function unbindPointer() {
    pointers.clear();
    pinch = null;
    canvas?.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    canvas?.removeEventListener('gesturestart', onSafariGesture);
    canvas?.removeEventListener('gesturechange', onSafariGesture);
    canvas?.removeEventListener('gestureend', onSafariGesture);
    canvas?.removeEventListener('touchmove', onTouchMovePinch);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onOrientationChange);
    if (portraitMq.removeEventListener) portraitMq.removeEventListener('change', onPortraitMqChange);
    else portraitMq.removeListener(onPortraitMqChange);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', onViewportChrome);
      window.visualViewport.removeEventListener('scroll', onViewportChrome);
    }
  }

  function animate() {
    if (!active) return;
    const dt = Math.min(clock.getDelta(), 0.032);
    rotX += (targetRotX - rotX) * (1 - Math.exp(-dt * 10));
    rotY += (targetRotY - rotY) * (1 - Math.exp(-dt * 10));
    rotZ += (targetRotZ - rotZ) * (1 - Math.exp(-dt * 10));
    tickZoomHold(dt);
    if (carGroup) carGroup.rotation.set(rotX, rotY, rotZ);
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(animate);
  }

  async function waitForCanvasSize(maxTries = 40) {
    for (let i = 0; i < maxTries; i++) {
      if (canvas.clientWidth >= 40 && canvas.clientHeight >= 40) return;
      await new Promise((r) => requestAnimationFrame(r));
    }
  }

  function loadGltf(url) {
    const draco = new DRACOLoader();
    draco.setDecoderPath(ap(DRACO_PATH));
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          draco.dispose();
          resolve(gltf);
        },
        undefined,
        (err) => {
          draco.dispose();
          reject(err);
        },
      );
    });
  }

  function isCanopyMesh(obj) {
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    if (mats.some((m) => m && m.name === '材质.014')) return true;
    const n = `${obj.name || ''} ${obj.parent?.name || ''}`;
    return /fillet_piece_521/i.test(n);
  }

  function isGripMesh(obj) {
    const n = `${obj.name || ''} ${obj.parent?.name || ''} ${obj.userData?.name || ''}`;
    if (/挤压|#1952|Blend_srf#1952/.test(n)) return true;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m) continue;
      if (m.name === 'Material') return true;
    }
    if (!obj.geometry) return false;
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
    const size = obj.geometry.boundingBox.getSize(new THREE.Vector3());
    const dims = [size.x, size.y, size.z].sort((a, b) => a - b);
    const untextured = mats.some((m) => m && !m.map && m.name === 'Material');
    return dims[0] < 0.01 && dims[2] > 0.3 && untextured;
  }

  function makeBlackGrip(src, envMap) {
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x0c0c0c,
      metalness: 0.15,
      roughness: 0.28,
      clearcoat: 0.35,
      clearcoatRoughness: 0.22,
      envMap: envMap || null,
      envMapIntensity: 0.26,
      side: src?.side ?? THREE.DoubleSide,
      transparent: false,
      opacity: 1,
      depthWrite: true,
    });
    mat.name = 'grip-black';
    return mat;
  }

  function makeBlackGlass(src, envMap) {
    /* Transmission on an alpha canvas reads as milky white; use tinted
       physical glass (opacity + clearcoat) so it stays dark and see-through. */
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x000000,
      metalness: 0,
      roughness: 0.14,
      transmission: 0,
      transparent: true,
      opacity: 0.46,
      depthWrite: true,
      clearcoat: 0.85,
      clearcoatRoughness: 0.12,
      envMap: envMap || null,
      envMapIntensity: 0.32,
      ior: 1.5,
      specularIntensity: 0.85,
      side: src?.side ?? THREE.DoubleSide,
    });
    mat.name = src?.name || 'black-glass';
    return mat;
  }

  function meshName(obj) {
    return `${obj.name || ''} ${obj.parent?.name || ''}`;
  }

  function opaqueShellMaterial(src, envMap) {
    const mat = src.clone();
    mat.transparent = false;
    mat.opacity = 1;
    if ('transmission' in mat) mat.transmission = 0;
    mat.depthWrite = true;
    mat.side = THREE.DoubleSide;
    if (envMap && 'envMap' in mat) {
      mat.envMap = envMap;
      mat.envMapIntensity = 0.26;
    }
    mat.needsUpdate = true;
    return mat;
  }

  function fillSidePanels(root, envMap) {
    let panel = null;
    let body = null;
    root.traverse((obj) => {
      if (!obj.isMesh) return;
      const n = meshName(obj);
      if (!panel && /Blend_srf#2407|#2407/.test(n)) panel = obj;
      if (!body && /Blend_srf#2374|#2374/.test(n)) body = obj;
    });
    if (!panel || !body?.material) return;
    const shell = opaqueShellMaterial(
      Array.isArray(body.material) ? body.material[0] : body.material,
      envMap,
    );
    panel.material = shell;
    panel.visible = true;
    if (panel.parent?.children.some((c) => c.name === 'side-panel-mirror')) return;
    const mirror = panel.clone(true);
    mirror.name = 'side-panel-mirror';
    mirror.material = shell;
    mirror.scale.z = -Math.abs(panel.scale.z || 1);
    if (Math.abs(panel.scale.z) < 1e-8) mirror.scale.z = -1;
    panel.parent.add(mirror);
  }

  function hideStudioContainer(root) {
    /* World AABB only. Local geometry of Blend_srf#2407 is ~100× car-scale
       but the node is scaled ~0.01 — it is the dark side panel, not a backdrop. */
    root.updateMatrixWorld(true);
    const spans = [];
    root.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry) return;
      const box = new THREE.Box3().setFromObject(obj);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      spans.push({ obj, span: Math.max(size.x, size.y, size.z) });
    });
    if (spans.length < 2) return;
    const sorted = spans.map((s) => s.span).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 1;
    for (const { obj, span } of spans) {
      if (span > median * 8) obj.visible = false;
    }
  }

  function isWorldVisible(obj) {
    let p = obj;
    while (p) {
      if (p.visible === false) return false;
      p = p.parent;
    }
    return true;
  }

  function visibleBox(root) {
    const box = new THREE.Box3();
    let found = false;
    root.updateMatrixWorld(true);
    root.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry || !isWorldVisible(obj)) return;
      const b = new THREE.Box3().setFromObject(obj);
      if (b.isEmpty()) return;
      if (!found) {
        box.copy(b);
        found = true;
      } else {
        box.union(b);
      }
    });
    return found ? box : new THREE.Box3().setFromObject(root);
  }

  function frameModel(root) {
    root.updateMatrixWorld(true);
    let box = visibleBox(root);
    let size = box.getSize(new THREE.Vector3());
    if (size.z > size.y * 1.25) {
      root.rotation.x = -Math.PI / 2;
      root.updateMatrixWorld(true);
      box = visibleBox(root);
      size = box.getSize(new THREE.Vector3());
    }
    const center = box.getCenter(new THREE.Vector3());
    root.position.sub(center);
    root.updateMatrixWorld(true);
    viewSphere = visibleBox(root).getBoundingSphere(new THREE.Sphere());
  }

  function materialLuma(m) {
    if (!m?.color) return 1;
    return m.color.r * 0.2126 + m.color.g * 0.7152 + m.color.b * 0.0722;
  }

  function bindCarEnv(m, envMap) {
    if (!m || !envMap || !('envMap' in m)) return;
    m.envMap = envMap;
    if (LIGHT_MAT_NAMES.has(m.name)) return;
    /* Dark body paint must not pick up the bright studio HDR as grey fill */
    if (materialLuma(m) < 0.08) m.envMapIntensity = 0.26;
    else if (m.envMapIntensity == null) m.envMapIntensity = 0.55;
  }

  function addStudioLights() {
    /* High-contrast studio: deep blacks, thin white rims — not the silver-book rig */
    const key = new THREE.DirectionalLight(0xfff8f0, 1.18);
    key.position.set(-2.2, 6.4, 5.2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xf4f6fa, 0.88);
    rim.position.set(3.4, 4.8, -5.4);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0x4a5562, 0.07);
    fill.position.set(5.5, -1.2, 2.2);
    scene.add(fill);
    scene.add(new THREE.AmbientLight(0xb4bcc6, 0.035));
    scene.add(new THREE.HemisphereLight(0xc8d0da, 0x08090c, 0.05));
  }

  function showError(err) {
    if (!canvas) return;
    canvas.classList.add('is-error', 'is-loaded');
    document.body.classList.add('is-reader-ready');
    console.error('[EmaxModel]', err);
    const tip = document.createElement('p');
    tip.className = 'detail-visual__fallback';
    tip.textContent = `3D model failed: ${err?.message || err}. Use local server (bash preview.sh).`;
    canvas.parentElement?.appendChild(tip);
  }

  async function init(canvasId = 'model-canvas') {
    if (active) return true;
    canvas = document.getElementById(canvasId);
    if (!canvas) return false;

    active = true;
    clock = new THREE.Clock();
    themeRevealed = false;
    lightsOn = true;
    document.body.classList.remove('is-model-day');
    document.body.classList.add('is-book-reading');
    const bar = document.getElementById('book-reader-bar');
    if (bar) bar.hidden = false;
    bindBack();
    bindZoom();
    bindLightsToggle();
    syncRotateHint();
    if (isPhone()) {
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    }
    concealMobileBrowserChrome();
    viewZoom = defaultZoom();
    lastLandscape = isPhone() && isLandscapeLayout();

    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        premultipliedAlpha: false,
        powerPreference: 'high-performance',
      });
      renderer.setClearColor(0x000000, 0);
      renderer.setClearAlpha(0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;

      scene = new THREE.Scene();
      scene.background = null;
      camera = new THREE.PerspectiveCamera(CLOSED_FOV, 1, 0.05, 80);

      await waitForCanvasSize();
      fitRenderer();

      pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      let envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = envMap;
      scene.environmentIntensity = 0.26;
      await new Promise((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const timer = setTimeout(done, 2800);
        new RGBELoader().load(
          HDR_URL,
          (hdr) => {
            clearTimeout(timer);
            envMap = pmrem.fromEquirectangular(hdr).texture;
            scene.environment = envMap;
            scene.environmentIntensity = 0.26;
            hdr.dispose();
            done();
          },
          undefined,
          () => {
            clearTimeout(timer);
            done();
          },
        );
      });

      addStudioLights();

      const gltf = await loadGltf(ap(MODEL_URL));
      hideStudioContainer(gltf.scene);
      gltf.scene.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.castShadow = false;
        obj.receiveShadow = false;
        obj.frustumCulled = true;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        if (
          obj.name === 'LOGO' ||
          obj.userData?.name === 'LOGO' ||
          mats.some((m) => m && m.name === 'LOGO')
        ) {
          obj.visible = false;
          return;
        }
        if (isCanopyMesh(obj)) {
          const prev = obj.material;
          obj.material = makeBlackGlass(prev, envMap);
          if (prev && prev !== obj.material) prev.dispose?.();
          return;
        }
        if (isGripMesh(obj)) {
          const prev = obj.material;
          obj.material = makeBlackGrip(prev, envMap);
          if (prev && prev !== obj.material) {
            if (Array.isArray(prev)) prev.forEach((m) => m?.dispose?.());
            else prev.dispose?.();
          }
          return;
        }
        for (const m of mats) {
          if (!m) continue;
          if (isNinebotMat(m)) prepareNinebotLight(m);
          if (isSeatMat(m)) prepareSeatSilver(m, envMap);
          if (envMap && 'envMap' in m) bindCarEnv(m, envMap);
          m.needsUpdate = true;
        }
      });
      fillSidePanels(gltf.scene, envMap);
      collectCarLights(gltf.scene);
      applyLights(lightsOn);

      const inner = new THREE.Group();
      inner.add(gltf.scene);
      frameModel(inner);
      carGroup = new THREE.Group();
      carGroup.add(inner);
      carGroup.rotation.set(DEFAULT_ROT_X, DEFAULT_ROT_Y, DEFAULT_ROT_Z);
      scene.add(carGroup);

      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => scheduleFit());
        ro.observe(canvas);
        const vis = canvas.closest('.detail-visual--book');
        if (vis) ro.observe(vis);
        canvas.__modelRO = ro;
      }

      bindPointer();
      fitCarToView();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      animate();
      canvas.classList.add('is-loaded', 'is-reading');
      document.body.classList.add('is-reader-ready');
      return true;
    } catch (err) {
      showError(err);
      return false;
    }
  }

  function destroy() {
    active = false;
    cancelAnimationFrame(rafId);
    unbindPointer();
    unbindLightsToggle();
    themeRevealed = false;
    stopZoomHold(false);
    viewZoom = 1;
    lastLandscape = null;
    lastDrawW = 0;
    lastDrawH = 0;
    if (fitRaf) {
      cancelAnimationFrame(fitRaf);
      fitRaf = 0;
    }
    document.body.classList.remove('is-model-day');
    document.documentElement.classList.remove('is-reader-landscape');
    document.documentElement.style.removeProperty('--reader-vvh');
    document.documentElement.style.removeProperty('--reader-vvw');
    lightMats = [];
    canvas?.__modelRO?.disconnect();
    pmrem?.dispose();
    pmrem = null;
    renderer?.dispose();
    scene = null;
    camera = null;
    carGroup = null;
    viewSphere = null;
    canvas = null;
  }

  return { init, destroy };
})();

window.EmaxModel = EmaxModel;
document.dispatchEvent(new CustomEvent('emax-model:ready'));
