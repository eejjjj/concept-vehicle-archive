/* EMAX · homepage entry intro video
 * Full-viewport contain on black · audio fade last 3s · pixelate+opacity fade last 1s
 */

const EmaxIntroVideo = (() => {
  const AUDIO_FADE_S = 3;
  const PIXEL_FADE_S = 1;
  const PIXEL_MAX = 56;

  let playing = false;
  let raf = 0;
  let tmpCanvas = null;
  let onDone = null;

  function els() {
    return {
      root: document.getElementById('emax-intro'),
      video: document.getElementById('emax-intro-video'),
      canvas: document.getElementById('emax-intro-pixel'),
      skip: document.getElementById('emax-intro-skip'),
    };
  }

  function skip() {
    if (!playing) return;
    complete(true);
  }

  function getTmp() {
    if (!tmpCanvas) tmpCanvas = document.createElement('canvas');
    return tmpCanvas;
  }

  function fitCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { w, h };
  }

  function containRect(cw, ch, vw, vh) {
    if (!vw || !vh) return { x: 0, y: 0, w: cw, h: ch };
    const scale = Math.min(cw / vw, ch / vh);
    const w = vw * scale;
    const h = vh * scale;
    return { x: (cw - w) * 0.5, y: (ch - h) * 0.5, w, h };
  }

  function drawPixelatedContain(ctx, video, cw, ch, blockSize) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    const box = containRect(cw, ch, video.videoWidth, video.videoHeight);
    const block = Math.max(1, blockSize);
    if (block <= 1.05) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(video, box.x, box.y, box.w, box.h);
      return;
    }
    const sw = Math.max(1, Math.ceil(box.w / block));
    const sh = Math.max(1, Math.ceil(box.h / block));
    const tmp = getTmp();
    if (tmp.width !== sw || tmp.height !== sh) {
      tmp.width = sw;
      tmp.height = sh;
    }
    const tctx = tmp.getContext('2d');
    tctx.imageSmoothingEnabled = true;
    tctx.clearRect(0, 0, sw, sh);
    tctx.drawImage(video, 0, 0, sw, sh);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, sw, sh, box.x, box.y, box.w, box.h);
  }

  function cleanup() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    playing = false;
    const { root, video, canvas } = els();
    if (video) {
      try {
        video.pause();
      } catch (_) {}
    }
    if (root) {
      root.hidden = true;
      root.setAttribute('aria-hidden', 'true');
      root.classList.remove('is-pixelating');
      root.style.opacity = '';
    }
    /* Do not remove body.is-emax-intro here — app.js owns that lifecycle.
       Stripping it in play()'s cleanup() races BookViewer.init and can
       burn the pixelate reveal under the overlay (esp. fast mobile skip). */
    if (canvas) {
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function complete(ok) {
    const cb = onDone;
    onDone = null;
    cleanup();
    if (cb) cb(ok);
  }

  function tick() {
    if (!playing) return;
    const { root, video, canvas } = els();
    if (!root || !video || !canvas) {
      complete(false);
      return;
    }

    const dur = video.duration;
    const t = video.currentTime;
    if (!Number.isFinite(dur) || dur <= 0) {
      raf = requestAnimationFrame(tick);
      return;
    }

    const remain = Math.max(0, dur - t);

    if (!video.muted) {
      video.volume =
        remain <= AUDIO_FADE_S
          ? Math.max(0, Math.min(1, remain / AUDIO_FADE_S))
          : 1;
    }

    if (remain <= PIXEL_FADE_S) {
      const u = 1 - remain / PIXEL_FADE_S;
      const eased = u * u * (3 - 2 * u);
      const block = 1 + (PIXEL_MAX - 1) * eased;
      root.classList.add('is-pixelating');
      root.style.opacity = String(Math.max(0, 1 - eased));
      const { w, h } = fitCanvas(canvas);
      drawPixelatedContain(canvas.getContext('2d'), video, w, h, block);
    } else {
      root.classList.remove('is-pixelating');
      root.style.opacity = '1';
    }

    if (video.ended || remain <= 0.04) {
      complete(true);
      return;
    }

    raf = requestAnimationFrame(tick);
  }

  function play() {
    const { root, video, canvas, skip: skipBtn } = els();
    if (!root || !video || !canvas) return Promise.resolve(false);

    cleanup();
    return new Promise((resolve) => {
      onDone = resolve;
      playing = true;
      document.body.classList.add('is-emax-intro');
      root.hidden = false;
      root.setAttribute('aria-hidden', 'false');
      root.style.opacity = '1';
      root.classList.remove('is-pixelating');

      if (skipBtn && !skipBtn.dataset.bound) {
        skipBtn.dataset.bound = '1';
        skipBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          skip();
        });
      }

      video.currentTime = 0;
      video.volume = 1;
      video.muted = false;
      const src =
        typeof window.assetPath === 'function'
          ? window.assetPath('videos/emaxintro.m4v')
          : video.getAttribute('src');
      if (src && video.getAttribute('src') !== src) video.src = src;

      const fail = () => complete(false);
      video.addEventListener('error', fail, { once: true });

      const startTick = () => {
        if (!playing) return;
        raf = requestAnimationFrame(tick);
      };

      const tryPlay = async () => {
        try {
          await video.play();
          startTick();
        } catch (_) {
          try {
            video.muted = true;
            await video.play();
            startTick();
          } catch (err) {
            console.warn('[EmaxIntroVideo] play failed:', err);
            fail();
          }
        }
      };

      if (video.readyState >= 2) tryPlay();
      else {
        video.addEventListener('loadeddata', tryPlay, { once: true });
        video.load();
        setTimeout(() => {
          if (playing && video.readyState < 2) fail();
        }, 10000);
      }
    });
  }

  function consumeEntryFlag() {
    try {
      if (sessionStorage.getItem('cva:emax-entry') === '1') {
        sessionStorage.removeItem('cva:emax-entry');
        return true;
      }
    } catch (_) {}
    return false;
  }

  return { play, skip, consumeEntryFlag };
})();

window.EmaxIntroVideo = EmaxIntroVideo;
