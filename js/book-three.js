/* 001 · 3D 精装书
 *
 * 结构参考 Stripe Press 详情页（press.stripe.com）：
 *
 *   Y+  ┌─ 封皮上沿 (board) ─┐
 *       │   封面 Front (+Z)  │
 *  X-   │   书脊 Spine       │  X+ 书芯开口（内页，内缩一圈）
 *       │   封底 Back (-Z)   │
 *   Y-  └─ 封皮下沿 ─────────┘
 *
 *  Z+ = 封面方向 · X+ = 开口侧 · 书芯(page block)在封面/封底之间
 */

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

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
  const CASE_MARGIN = 0.048;
  const BOARD_T = 0.016;
  const PAGE_EPS = 0.0006;

  /* ── 凹槽：浅但可见、边缘锐利 ── */
  const COVER_GROOVE_D = 0.008;
  const SPINE_GROOVE_D = 0.005;
  const LENTICULAR_INSET = 0.003;
  const LENTICULAR_Z = 0.0012;

  const EMBOSS_STrength = 3.2;
  const VIEW_MARGIN = 1.32;

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

  let rotX = 0.06;
  let rotY = 0.18;
  let targetRotX = 0.06;
  let targetRotY = 0.18;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

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

  /** 锐利浅凹槽：硬边 smoothstep，不做渐变深坑 */
  function displaceGroove(geometry, maskTex, depth, flipV = false) {
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
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      const vy = flipV ? 1 - v : v;
      const px = Math.min(w - 1, Math.max(0, Math.floor(u * w)));
      const py = Math.min(h - 1, Math.max(0, Math.floor(vy * h)));
      const m = data[(py * w + px) * 4] / 255;
      const g = m >= 0.52 ? 1 : THREE.MathUtils.smoothstep(0.38, 0.52, m);
      if (g > 0.001) pos.setZ(i, pos.getZ(i) - depth * g);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  /** 凹槽边缘法线：辅助浅槽在光下可见，封面材质本身无条纹 */
  function grooveRimNormal(maskTex, strength = 5.5) {
    const img = imageFromTexture(maskTex);
    const w = img.width;
    const h = img.height;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(img, 0, 0);
    const data = c.getContext('2d').getImageData(0, 0, w, h).data;
    const out = c.getContext('2d').createImageData(w, h);

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
        const nx = -dx * edge;
        const ny = dy * edge;
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

  function coverSilverMat(envMap, grooveNormal) {
    return new THREE.MeshPhysicalMaterial({
      color: 0xa9aeb4,
      metalness: 0.72,
      roughness: 0.78,
      normalMap: grooveNormal,
      normalScale: new THREE.Vector2(0.95, 0.95),
      envMap,
      envMapIntensity: 1.14,
      clearcoat: 0.07,
      clearcoatRoughness: 0.78,
    });
  }

  function boardEdgeMat(envMap) {
    return new THREE.MeshPhysicalMaterial({
      color: 0xaeb3b9,
      metalness: 0.8,
      roughness: 0.7,
      envMap,
      envMapIntensity: 1.05,
      clearcoat: 0.06,
      clearcoatRoughness: 0.65,
    });
  }

  function inkSilverMat(envMap, map, normalMap) {
    return new THREE.MeshPhysicalMaterial({
      color: 0xb8bdc3,
      metalness: 0.82,
      roughness: 0.66,
      map,
      normalMap,
      normalScale: new THREE.Vector2(0.36, 0.36),
      envMap,
      envMapIntensity: 1.02,
      clearcoat: 0.04,
      clearcoatRoughness: 0.6,
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
    const [spineTex, pageTex, grooveMask, spineGrooveMask, backTex, ...lentTexs] =
      await Promise.all([
        loadTex(ASSETS.spine),
        loadTex(ASSETS.page),
        loadTex(ASSETS.grooveMask, THREE.NoColorSpace),
        loadTex(ASSETS.spineGrooveMask, THREE.NoColorSpace),
        loadTex(ASSETS.back),
        ...ASSETS.lenticular.map((u) => loadTex(u)),
      ]);

    const W = COVER_W;
    const H = COVER_H;
    const T = SPINE_T;
    const hz = T / 2;

    /* 书芯边界：书脊(x-)齐平，开口/上/下三边内缩 CASE_MARGIN */
    const px0 = -W / 2;
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
    const spineNormal = inkNormalFromImage(imageFromTexture(spineTex));
    const coverGrooveNormal = grooveRimNormal(grooveMask);

    const group = new THREE.Group();
    const edge = boardEdgeMat(envMap);

    /* ── 1. 书芯：内页三边切口（在封皮之内，贴书脊）── */
    const pages = new THREE.Group();
    pages.name = 'page-block';

    const fore = new THREE.Mesh(
      new THREE.PlaneGeometry(blockT, blockH),
      pageMat(pageTex, 'fore'),
    );
    fore.position.set(W / 2 - CASE_MARGIN * 0.52, blockCy, blockCz);
    fore.rotation.y = Math.PI / 2;
    fore.renderOrder = 2;
    pages.add(fore);

    const top = new THREE.Mesh(
      new THREE.PlaneGeometry(blockW, blockT),
      pageMat(pageTex, 'top'),
    );
    top.position.set(blockCx, py1 + PAGE_EPS, blockCz);
    top.rotation.x = -Math.PI / 2;
    pages.add(top);

    const bottom = new THREE.Mesh(
      new THREE.PlaneGeometry(blockW, blockT),
      pageMat(pageTex, 'bottom'),
    );
    bottom.position.set(blockCx, py0 - PAGE_EPS, blockCz);
    bottom.rotation.x = Math.PI / 2;
    pages.add(bottom);

    group.add(pages);

    /* ── 2. 封皮：前/后封面 + 书脊 + 四边书壳厚边 ── */
    const coverGeo = new THREE.PlaneGeometry(W, H, 128, 128);
    displaceGroove(coverGeo, grooveMask, COVER_GROOVE_D, false);

    const spineGeo = new THREE.PlaneGeometry(T, H, 24, 128);
    displaceGroove(spineGeo, spineGrooveMask, SPINE_GROOVE_D, true);

    const cover = new THREE.Mesh(coverGeo, coverSilverMat(envMap, coverGrooveNormal));
    cover.position.z = hz;
    group.add(cover);

    const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), inkSilverMat(envMap, backTex, backNormal));
    back.position.z = -hz;
    back.rotation.y = Math.PI;
    group.add(back);

    const spine = new THREE.Mesh(spineGeo, inkSilverMat(envMap, spineTex, spineNormal));
    spine.position.x = -W / 2;
    spine.rotation.y = -Math.PI / 2;
    group.add(spine);

    const topBoard = new THREE.Mesh(new THREE.PlaneGeometry(W, T), edge);
    topBoard.position.y = H / 2;
    topBoard.rotation.x = -Math.PI / 2;
    group.add(topBoard);

    const bottomBoard = new THREE.Mesh(new THREE.PlaneGeometry(W, T), edge);
    bottomBoard.position.y = -H / 2;
    bottomBoard.rotation.x = Math.PI / 2;
    group.add(bottomBoard);

    /* 开口侧封皮外沿（与上下边对称，补全书脊对侧） */
    const foreBoard = new THREE.Mesh(new THREE.PlaneGeometry(T, H), edge);
    foreBoard.position.set(W / 2, 0, 0);
    foreBoard.rotation.y = Math.PI / 2;
    group.add(foreBoard);

    /* ── 3. 光栅片 ── */
    const lenticular = new THREE.Mesh(
      new THREE.PlaneGeometry(lent.width, lent.height),
      lenticularMat(lentTexs),
    );
    lenticular.position.set(lent.x, lent.y, hz + LENTICULAR_Z);
    lenticular.renderOrder = 10;
    group.add(lenticular);

    group.updateMatrixWorld(true);
    viewSphere = new THREE.Sphere();
    new THREE.Box3().setFromObject(group).getBoundingSphere(viewSphere);
    return group;
  }

  function fitCamera() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
  }

  function fitBookToView() {
    if (!camera || !viewSphere) return;
    fitCamera();
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const radius = viewSphere.radius * VIEW_MARGIN;
    const dist = radius / Math.sin(fov * 0.5);
    camera.position.set(
      viewSphere.center.x,
      viewSphere.center.y + radius * 0.06,
      viewSphere.center.z + dist,
    );
    camera.lookAt(viewSphere.center);
    camera.updateProjectionMatrix();
  }

  function onResize() {
    if (!active) return;
    fitBookToView();
  }

  function onPointerDown(e) {
    if (!active) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.classList.add('is-dragging');
    canvas.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    if (!dragging) return;
    targetRotY += (e.clientX - lastX) * 0.008;
    targetRotX += (e.clientY - lastY) * 0.008;
    targetRotX = THREE.MathUtils.clamp(targetRotX, -1.1, 1.1);
    lastX = e.clientX;
    lastY = e.clientY;
  }

  function onPointerUp(e) {
    dragging = false;
    canvas.classList.remove('is-dragging');
    canvas.releasePointerCapture?.(e.pointerId);
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
    rotX += (targetRotX - rotX) * (1 - Math.exp(-dt * 10));
    rotY += (targetRotY - rotY) * (1 - Math.exp(-dt * 10));
    bookGroup.rotation.x = rotX;
    bookGroup.rotation.y = rotY;
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(animate);
  }

  async function waitForCanvasSize(maxTries = 40) {
    for (let i = 0; i < maxTries; i++) {
      if (canvas.clientWidth >= 40 && canvas.clientHeight >= 40) return;
      await new Promise((r) => requestAnimationFrame(r));
    }
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
      renderer.toneMappingExposure = 1.14;
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

      const key = new THREE.DirectionalLight(0xfff6ee, 1.95);
      key.position.set(-4.5, 5.5, 7.5);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0x98a8b8, 0.38);
      fill.position.set(4, -1.5, 3.5);
      scene.add(fill);
      const rim = new THREE.DirectionalLight(0xd0dce8, 0.85);
      rim.position.set(5, 2.5, -4.5);
      scene.add(rim);
      scene.add(new THREE.AmbientLight(0x686e78, 0.36));

      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => {
          requestAnimationFrame(() => fitBookToView());
        });
        ro.observe(canvas);
        canvas.__bookRO = ro;
        if (canvas.parentElement) ro.observe(canvas.parentElement);
      }

      bookGroup = await buildBook(envMap);
      scene.add(bookGroup);

      fitBookToView();
      bindPointer();
      requestAnimationFrame(() => fitBookToView());

      rafId = requestAnimationFrame(animate);
      canvas.classList.add('is-loaded');
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
    unbindPointer();
    canvas?.__bookRO?.disconnect();
    pmrem?.dispose();
    renderer?.dispose();
    scene = null;
    camera = null;
    bookGroup = null;
    viewSphere = null;
    canvas = null;
  }

  return { init, destroy };
})();

window.BookViewer = BookViewer;
document.dispatchEvent(new CustomEvent('book:ready'));
