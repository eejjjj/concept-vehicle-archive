/* Archive effects · text scramble + pixel reveal + chapter accordion */

const ArchiveEffects = (() => {
  const FIXED = new Set([
    ' ',
    '\u00a0',
    '·',
    '：',
    ':',
    '—',
    '–',
    '-',
    '/',
    '=',
    '&',
    '.',
    ',',
    '，',
    '。',
    '、',
    '+',
    '(',
    ')',
    '（',
    '）',
  ]);

  /* Fallback glyphs per class — never cross Latin ↔ CJK (keeps slot width stable) */
  const POOL_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const POOL_LOWER = 'abcdefghijklmnopqrstuvwxyz';
  const POOL_DIGIT = '0123456789';
  const POOL_CJK =
    '一二三四五六七八九十百千万亿零甲乙丙丁戊己庚辛壬癸天地玄黄宇宙洪荒日月星辰春秋冬夏东南西北上下左右前后内外大小高低长短方圆黑白红蓝青黄紫绿金银铜铁木水火山石云风雨雪电雷霜雾设计涌现视觉开发命题档案交通工具凌波出行系统现实意识交织空间数字永生未来外饰内饰核心概念';

  function isFixedChar(c) {
    return FIXED.has(c);
  }

  function charClass(c) {
    if (isFixedChar(c)) return 'fixed';
    if (c >= 'A' && c <= 'Z') return 'upper';
    if (c >= 'a' && c <= 'z') return 'lower';
    if (c >= '0' && c <= '9') return 'digit';
    if (/\p{Script=Han}/u.test(c)) return 'cjk';
    return 'other';
  }

  function fallbackPool(cls) {
    if (cls === 'upper') return POOL_UPPER;
    if (cls === 'lower') return POOL_LOWER;
    if (cls === 'digit') return POOL_DIGIT;
    if (cls === 'cjk') return POOL_CJK;
    return '';
  }

  /** Per-slot pool: only same class as the original glyph (length & script stay put). */
  function poolsForChars(chars) {
    const byClass = { upper: [], lower: [], digit: [], cjk: [], other: [] };
    for (const c of chars) {
      const cls = charClass(c);
      if (cls !== 'fixed' && byClass[cls]) byClass[cls].push(c);
    }

    return chars.map((c) => {
      const cls = charClass(c);
      if (cls === 'fixed') return null;
      if (cls === 'other') return [c];

      const local = [...new Set(byClass[cls])];
      const extra = [...fallbackPool(cls)].filter((ch) => !local.includes(ch));
      const pool = local.length >= 6 ? local : [...local, ...extra];
      return pool.length ? pool : [c];
    });
  }

  function clearScrambleBox(el) {
    const prev = el.__scrambleBox;
    if (!prev) return;
    el.style.height = prev.height;
    el.style.width = prev.width;
    el.style.maxWidth = prev.maxWidth;
    el.style.overflow = prev.overflow;
    el.style.display = prev.display;
    el.__scrambleBox = null;
  }

  function scramble(el, duration = 520) {
    const original = el.dataset.scrambleText || el.textContent;
    el.dataset.scrambleText = original;
    if (el.__scrambleRaf) cancelAnimationFrame(el.__scrambleRaf);
    clearScrambleBox(el);

    /* Reset to final copy before measuring — mid-scramble glyphs skew the box */
    el.textContent = original;

    const chars = [...original];
    const pools = poolsForChars(chars);
    const start = performance.now();

    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    el.__scrambleBox = {
      height: el.style.height,
      width: el.style.width,
      maxWidth: el.style.maxWidth,
      overflow: el.style.overflow,
      display: el.style.display,
    };
    /* Freeze the painted box so proportional scramble can't reflow the frame */
    const freezeBox = !el.closest('.site-nav');
    if (freezeBox) {
      if (cs.display === 'inline') {
        el.style.display = 'inline-block';
        el.style.width = `${Math.ceil(rect.width)}px`;
      }
      el.style.height = `${Math.ceil(rect.height)}px`;
      el.style.maxWidth = `${Math.ceil(rect.width)}px`;
      el.style.overflow = 'hidden';
    }

    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const revealed = Math.floor(t * chars.length);
      /* Always map 1→1 over the same code points — never grow/shrink the string */
      el.textContent = chars
        .map((c, i) => {
          if (!pools[i]) return c;
          if (i < revealed) return c;
          const pool = pools[i];
          return pool[(Math.random() * pool.length) | 0];
        })
        .join('');
      if (t < 1) {
        el.__scrambleRaf = requestAnimationFrame(tick);
      } else {
        el.textContent = original;
        clearScrambleBox(el);
        el.__scrambleRaf = 0;
      }
    };

    el.__scrambleRaf = requestAnimationFrame(tick);
  }

  function bindTextScramble(root) {
    root.querySelectorAll('[data-scramble]').forEach((el) => {
      if (el.closest('.archive-chapter-nav') || el.dataset.scrambleBound) return;
      el.dataset.scrambleBound = '1';
      el.dataset.scrambleText = el.textContent.trim();
      el.addEventListener('mouseenter', () => scramble(el));
      if (!el.closest('.site-nav')) {
        el.addEventListener('focus', () => scramble(el));
      }
    });
  }

  function drawPixelated(ctx, img, w, h, blockSize) {
    const sw = Math.max(1, Math.ceil(w / blockSize));
    const sh = Math.max(1, Math.ceil(h / blockSize));
    if (!drawPixelated._tmp) drawPixelated._tmp = document.createElement('canvas');
    const tmp = drawPixelated._tmp;
    if (tmp.width !== sw || tmp.height !== sh) {
      tmp.width = sw;
      tmp.height = sh;
    }
    const tctx = tmp.getContext('2d');
    tctx.imageSmoothingEnabled = true;
    tctx.clearRect(0, 0, sw, sh);
    tctx.drawImage(img, 0, 0, sw, sh);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(tmp, 0, 0, sw, sh, 0, 0, w, h);
  }

  async function setupPixelReveal(wrap) {
    const img = wrap.querySelector('img');
    if (!img || wrap.dataset.pixelReady) return;
    wrap.dataset.pixelReady = '1';

    if (!img.complete) {
      await new Promise((resolve, reject) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', reject, { once: true });
      }).catch(() => {});
    }
    if (!img.naturalWidth) return;

    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.className = 'pixel-reveal__canvas';
    canvas.width = w;
    canvas.height = h;
    canvas.style.aspectRatio = `${w} / ${h}`;
    wrap.appendChild(canvas);
    img.classList.add('pixel-reveal__source');

    const ctx = canvas.getContext('2d');
    const maxBlock = Math.max(28, Math.min(88, Math.round(Math.max(w, h) / 10)));
    let block = maxBlock;
    let animating = false;

    const render = () => drawPixelated(ctx, img, w, h, block);

    const animateToClear = () => {
      if (animating) return;
      animating = true;
      wrap.classList.add('is-revealing');
      const start = performance.now();
      const dur = 880;

      const step = (now) => {
        const t = Math.min(1, (now - start) / dur);
        const eased = 1 - (1 - t) ** 3;
        block = maxBlock * (1 - eased) + 1 * eased;
        if (block <= 1.05) {
          block = 1;
          ctx.imageSmoothingEnabled = true;
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          wrap.classList.add('is-revealed');
          wrap.classList.remove('is-revealing');
          animating = false;
          return;
        }
        render();
        requestAnimationFrame(step);
      };

      requestAnimationFrame(step);
    };

    render();
    wrap.classList.add('is-pixelated');

    if (wrap.dataset.revealOnOpen === '1') return { reveal: animateToClear };

    if (typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              animateToClear();
              io.disconnect();
            }
          });
        },
        { threshold: 0.2, rootMargin: '0px 0px -8% 0px' },
      );
      io.observe(wrap);
    } else {
      animateToClear();
    }

    return { reveal: animateToClear };
  }

  function bindPixelReveal(root) {
    root.querySelectorAll('.pixel-reveal').forEach((wrap) => {
      setupPixelReveal(wrap);
    });
  }

  function bindChapterAccordion(root) {
    root.querySelectorAll('.archive-chapter__head').forEach((btn) => {
      btn.addEventListener('click', () => {
        const chapter = btn.closest('.archive-chapter');
        if (!chapter) return;
        const open = !chapter.classList.contains('is-open');
        chapter.classList.toggle('is-open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');

        if (open) {
          chapter.querySelectorAll('.pixel-reveal').forEach(async (wrap) => {
            const result = await setupPixelReveal(wrap);
            result?.reveal?.();
          });
        }
      });
    });
  }

  function bindChapterNav(root) {
    const nav = root.querySelector('.archive-chapter-nav');
    if (!nav) return;

    const links = [...nav.querySelectorAll('.archive-chapter-nav__items a[href^="#"]')];

    links.forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.querySelector(a.getAttribute('href'));
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function bindScrollProgress() {
    const nav = document.querySelector('.archive-chapter-nav');
    if (!nav) return;

    const entries = [...nav.querySelectorAll('.archive-chapter-nav__items a[href^="#"]')]
      .map((link) => ({
        link,
        fill: link.querySelector('.archive-chapter-nav__tick-fill'),
        section: document.querySelector(link.getAttribute('href')),
      }))
      .filter((entry) => entry.section && entry.fill);

    if (!entries.length) return;

    const update = () => {
      const marker = window.scrollY + window.innerHeight * 0.35;
      let activeIndex = -1;

      entries.forEach((entry, index) => {
        const top = entry.section.offsetTop;
        const bottom = top + (entry.section.offsetHeight || 1);
        if (marker >= top && marker < bottom) activeIndex = index;
      });

      if (activeIndex < 0) {
        activeIndex = marker < entries[0].section.offsetTop ? 0 : entries.length - 1;
      }

      entries.forEach((entry, index) => {
        const { link, fill, section } = entry;
        const top = section.offsetTop;
        const height = section.offsetHeight || 1;
        link.classList.remove('is-active', 'is-past');

        if (index < activeIndex) {
          link.classList.add('is-past');
          fill.style.width = '100%';
        } else if (index === activeIndex) {
          link.classList.add('is-active');
          const progress = Math.min(1, Math.max(0, (marker - top) / height));
          fill.style.width = `${progress * 100}%`;
        } else {
          fill.style.width = '0%';
        }
      });
    };

    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    update();
  }

  function init(scope = document) {
    bindTextScramble(scope);
    bindPixelReveal(scope);
    bindChapterAccordion(scope);
    bindChapterNav(scope);
    bindScrollProgress();
  }

  return { init, scramble, setupPixelReveal };
})();

window.ArchiveEffects = ArchiveEffects;
