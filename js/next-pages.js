/** NEXT 内页：nextpages1 (环衬 + 1–40) · nextpages2 (41–80) · nextpages3 (81–120) · nextpages4 (121–160) */
export const PAGE_COUNT = 160;

export function pageFolder(page1) {
  if (page1 <= 40) return 'nextpages1';
  if (page1 <= 80) return 'nextpages2';
  if (page1 <= 120) return 'nextpages3';
  return 'nextpages4';
}

/** @param {number} page1 1-based. Suffix after 副本2 is the page number, unpadded. */
export function pageFileName(page1) {
  return `261019_next_内页_副本2${page1}.jpg`;
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
