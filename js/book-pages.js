/** EMAX 内页：emaxpages1 (0 环衬 + 1–80) · emaxpages2 (81–160) */
export const PAGE_COUNT = 160;

/** @param {number} page1 1-based page number */
export function pageFolder(page1) {
  return page1 <= 80 ? 'emaxpages1' : 'emaxpages2';
}

/** Front/back endpaper (before 001 / after 160) */
export function liningUrl() {
  return window.assetPath('emaxpages1/260623_emax0.jpg');
}

const PAGE_FILE = {
  1: '260623_emax1_2.jpg',
  8: '260623_emax8_2.jpg',
  9: '260623_emax9_2.jpg',
  160: '260623_emax160_2.jpg',
};

export function pageUrl(index) {
  const n = index + 1;
  if (n < 1 || n > PAGE_COUNT) return null;
  const file = PAGE_FILE[n] || `260623_emax${n}.jpg`;
  return window.assetPath(`${pageFolder(n)}/${file}`);
}

export function allPageUrls() {
  return Array.from({ length: PAGE_COUNT }, (_, i) => pageUrl(i));
}

/**
 * spread 0 = 环衬 + 第 1 页
 * spread n>0 = 第 (2n) 与 (2n+1) 页（1-based）…末跨为第 160 页 + 后环衬
 * left/right === null → 封面环衬（非空页露壳）
 */
export function spreadPages(spreadIndex) {
  if (spreadIndex < 0) return null;
  if (spreadIndex === 0) return { left: null, right: 0 };
  const left = spreadIndex * 2 - 1;
  const right = spreadIndex * 2;
  if (left >= PAGE_COUNT) return null;
  if (right >= PAGE_COUNT) return { left, right: null };
  return { left, right };
}

/** spread 0 … 80（共 81 跨，覆盖 160 页） */
export const SPREAD_COUNT = Math.floor((PAGE_COUNT + 1) / 2) + 1;

/**
 * 硫酸纸 runs
 * - pages: 半透明页（1-based）
 * - baseRight: 右侧叠层不透明底页
 * - baseLeft: 左侧叠层不透明底页（翻过硫酸纸后透过看到的前一页）
 */
export const VELLUM_RUNS = [
  { pages: [23, 24, 25, 26], baseRight: 27, baseLeft: 22 },
  { pages: [39, 40, 41, 42], baseRight: 43, baseLeft: 38 },
];

/** @param {number} page1 1-based */
export function isVellumPage(page1) {
  return VELLUM_RUNS.some((r) => r.pages.includes(page1));
}

/** Matte silver ink field pages (1-based). Empty: 001/008/009 use paper print like the rest. */
export const SILVER_PAGES = new Set();

/** @param {number} page1 1-based */
export function isSilverPage(page1) {
  return SILVER_PAGES.has(page1);
}

/**
 * 右侧叠层：从当前右页向下（顶→底），末项为不透明底页
 * e.g. 23 → [23,24,25,26,27]
 */
export function vellumStackFrom(page1) {
  for (const run of VELLUM_RUNS) {
    if (run.pages.includes(page1)) {
      const stack = run.pages.filter((p) => p >= page1);
      stack.push(run.baseRight);
      return stack;
    }
  }
  return null;
}

/**
 * 左侧叠层：从当前左页向下（顶→底），末项为不透明底页
 * e.g. 024 → [24,23,22]
 * e.g. 026 → [26,25,24,23,22]（026–027 跨页左侧，与 024–025 同理）
 * e.g. 042 → [42,41,40,39,38]（042–043 跨页左侧，与 040–041 同理）
 */
export function vellumLeftStackFrom(page1) {
  for (const run of VELLUM_RUNS) {
    if (run.pages.includes(page1)) {
      const stack = run.pages.filter((p) => p <= page1).reverse();
      stack.push(run.baseLeft);
      return stack;
    }
  }
  return null;
}
