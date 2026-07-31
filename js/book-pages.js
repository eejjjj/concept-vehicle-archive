/** EMAX 内页：emaxpages2 (1–80) · emaxpages1 (81–160) */
export const PAGE_COUNT = 160;

/** @param {number} page1 1-based page number */
export function pageFolder(page1) {
  return page1 <= 80 ? 'emaxpages2' : 'emaxpages1';
}

export function pageUrl(index) {
  const n = index + 1;
  if (n < 1 || n > PAGE_COUNT) return null;
  return window.assetPath(`${pageFolder(n)}/260623_emax${n}.jpg`);
}

export function allPageUrls() {
  return Array.from({ length: PAGE_COUNT }, (_, i) => pageUrl(i));
}

/**
 * spread 0 = 环衬 + 第 1 页
 * spread n>0 = 第 (2n) 与 (2n+1) 页（1-based 为 2n+1, 2n+2）…末跨可能只有左页
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
 * e.g. 26 → [26,25,24,23,22]
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
