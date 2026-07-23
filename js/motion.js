/* Motion · wild.as-inspired easing & transitions (vanilla) */

const Motion = (() => {
  const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function overlay() {
    return document.getElementById('transition');
  }

  async function fadeOut(ms = 680) {
    const el = overlay();
    if (!el) return;
    el.classList.add('is-active');
    await wait(ms);
  }

  async function fadeIn(ms = 480) {
    const el = overlay();
    if (!el) return;
    el.classList.remove('is-active');
    await wait(ms);
  }

  async function pageExit(url, ms = 680) {
    await fadeOut(ms);
    window.location.href = url;
  }

  function staggerIn(elements, { base = 0, step = 90, duration = 1000 } = {}) {
    elements.forEach((el, i) => {
      el.style.setProperty('--reveal-delay', `${base + i * step}ms`);
      el.style.setProperty('--reveal-dur', `${duration}ms`);
      el.classList.add('motion-reveal');
      requestAnimationFrame(() => el.classList.add('is-in'));
    });
  }

  function revealChrome() {
    document.body.classList.add('is-chrome-in');
  }

  function bootPageEnter() {
    document.body.classList.add('is-page-enter');
    requestAnimationFrame(() => {
      document.body.classList.add('is-page-enter-active');
    });
  }

  return {
    easeOutExpo,
    fadeOut,
    fadeIn,
    pageExit,
    staggerIn,
    revealChrome,
    bootPageEnter,
  };
})();
