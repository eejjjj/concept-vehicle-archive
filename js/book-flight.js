/* Archive → emax · full-screen flight · full detail book model */

import * as THREE from 'three';
import { BookViewer } from './book-three.js';

const BS = () => window.BookShared;
const FLAT_X = Math.PI / 2 - 0.1;

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function projectScreenBox(object, camera, vw, vh) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const corners = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const c of corners) {
    c.project(camera);
    const sx = (c.x * 0.5 + 0.5) * vw;
    const sy = (-c.y * 0.5 + 0.5) * vh;
    minX = Math.min(minX, sx);
    maxX = Math.max(maxX, sx);
    minY = Math.min(minY, sy);
    maxY = Math.max(maxY, sy);
  }

  return {
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) * 0.5,
    centerY: (minY + maxY) * 0.5,
  };
}

function fitObjectToRect(object, camera, vw, vh, rect, rotX, rotY, fov) {
  object.rotation.set(rotX, rotY, 0);
  object.updateMatrixWorld(true);

  const center = new THREE.Vector3();
  new THREE.Box3().setFromObject(object).getCenter(center);

  camera.fov = fov;
  camera.aspect = vw / vh;

  let dist = 4.2;
  for (let i = 0; i < 36; i++) {
    camera.position.set(center.x, center.y + dist * 0.06, center.z + dist);
    camera.lookAt(center);
    camera.updateProjectionMatrix();

    const pb = projectScreenBox(object, camera, vw, vh);
    if (pb.width < 2) break;

    const scale = Math.min(rect.width / pb.width, rect.height / pb.height);
    dist *= scale ** 0.62;

    const dx = rect.centerX - pb.centerX;
    const dy = rect.centerY - pb.centerY;
    camera.position.x += (dx / vw) * dist * 0.42;
    camera.position.y -= (dy / vh) * dist * 0.42;
  }

  camera.lookAt(center);
  camera.updateProjectionMatrix();

  return center.clone();
}

async function animateToEmax({ canvas, targetRect, startRotX = FLAT_X, startRotY = 0 }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const ctx = await BookViewer.bootstrap(canvas);
  const { bookGroup, camera, renderer, scene, dispose } = ctx;

  const endRotX = BS().DETAIL_ROT_X;
  const endRotY = BS().DETAIL_ROT_Y;
  const fov = BS().DETAIL_FOV;

  renderer.setClearColor(0x000000, 1);
  renderer.setSize(vw, vh, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  camera.aspect = vw / vh;
  camera.fov = fov;
  camera.updateProjectionMatrix();

  const dur = 1200;
  const t0 = performance.now();
  let lookAt = new THREE.Vector3();

  await new Promise((resolve) => {
    function frame(now) {
      const t = Math.min(1, (now - t0) / dur);
      const e = easeOutCubic(t);

      const rotX = startRotX + (endRotX - startRotX) * e;
      const rotY = startRotY + (endRotY - startRotY) * e;

      const bg = new THREE.Color(0xe8e8e6).lerp(new THREE.Color(0x000000), e);
      renderer.setClearColor(bg, 1);
      document.body.style.backgroundColor = `#${bg.getHexString()}`;

      if (t < 0.999) {
        const partial = { ...targetRect, width: targetRect.width * (0.55 + e * 0.45) };
        lookAt = fitObjectToRect(bookGroup, camera, vw, vh, partial, rotX, rotY, fov);
        renderer.render(scene, camera);
        requestAnimationFrame(frame);
      } else {
        lookAt = fitObjectToRect(bookGroup, camera, vw, vh, targetRect, endRotX, endRotY, fov);
        renderer.render(scene, camera);
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });

  const handoff = {
    fromArchive: true,
    slug: 'emax',
    rotX: endRotX,
    rotY: endRotY,
    camera: {
      position: camera.position.toArray(),
      fov: camera.fov,
    },
    lookAt: lookAt.toArray(),
    viewport: { w: vw, h: vh },
  };

  dispose();
  return handoff;
}

export const BookFlight = { animateToEmax };
