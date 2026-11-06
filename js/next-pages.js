/** NEXT 内页：nextpages1 (环衬 + 1–80) · nextpages2 (81–160) */
export const PAGE_COUNT = 160;

export function pageFolder(page1) {
  return page1 <= 80 ? 'nextpages1' : 'nextpages2';
}

/** @param {number} page1 1-based. 副本2_ 后为三位页码。 */
export function pageFileName(page1) {
  return `261105_next_内页_副本2_${String(page1).padStart(3, '0')}.jpg`;
}

/** Full sheet is square. Short sheets are narrower, same height, bound at the gutter. */
const FULL_PAGE_W = 1559;
const SHORT_PAGE_W = {
  17: 780, 18: 780, 19: 780, 20: 780,
  25: 1205, 26: 1205,
  27: 1293, 28: 1293,
  29: 1382, 30: 1382,
  31: 1470, 32: 1470, 33: 1470, 34: 1470,
  35: 1470, 36: 1470, 37: 1470, 38: 1470,
};

/** @param {number} page1 1-based. 1 = full sheet. */
export function pageWidthRatio(page1) {
  const w = SHORT_PAGE_W[page1];
  return w ? w / FULL_PAGE_W : 1;
}

export function isShortPage(page1) {
  return SHORT_PAGE_W[page1] != null;
}

/** 017–020 are beige draft sheets, not the white stock. */
export function isDraftPage(page1) {
  return page1 >= 17 && page1 <= 20;
}

/**
 * Right-hand pile, top → bottom.
 * The next sheet is always kept, even when it is the same width, so a held
 * flip reveals it. Later sheets are kept only when they stick out.
 */
export function shortStackFrom(page1) {
  if (!isShortPage(page1)) return null;
  const stack = [page1];
  const next = page1 + 2;
  if (next > PAGE_COUNT) return stack;
  stack.push(next);
  let covered = pageWidthRatio(next);
  if (covered >= 0.999) return stack;
  for (let p = next + 2; p <= PAGE_COUNT; p += 2) {
    const r = pageWidthRatio(p);
    if (r > covered + 0.004) {
      stack.push(p);
      covered = r;
    }
    if (r >= 0.999) break;
  }
  return stack;
}

/**
 * Left-hand pile, top → bottom.
 * The previous sheet is always kept so a held backward flip reveals it.
 */
export function shortStackLeftFrom(page1) {
  if (!isShortPage(page1)) return null;
  const stack = [page1];
  const prev = page1 - 2;
  if (prev < 1) return stack;
  stack.push(prev);
  let covered = pageWidthRatio(prev);
  if (covered >= 0.999) return stack;
  for (let p = prev - 2; p >= 1; p -= 2) {
    const r = pageWidthRatio(p);
    if (r > covered + 0.004) {
      stack.push(p);
      covered = r;
    }
    if (r >= 0.999) break;
  }
  return stack;
}

/** Front/back endpaper (before 001 / after 160) */
export function liningUrl() {
  return window.assetPath('nextpages1/261027_next0.jpg');
}

export function pageUrl(index) {
  const n = index + 1;
  if (n < 1 || n > PAGE_COUNT) return null;
  return window.assetPath(`${pageFolder(n)}/${pageFileName(n)}`);
}

/** NEXT pages are all opaque stock. No tracing-paper runs. */
export function isVellumPage() {
  return false;
}

/** NEXT has no silver-ink pages. */
export function isSilverPage() {
  return false;
}

export function isSilverDecalPage() {
  return false;
}

export function vellumStackFrom() {
  return null;
}

export function vellumLeftStackFrom() {
  return null;
}
