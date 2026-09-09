/** EMAX · 章节导航（page 为 1-based 印刷页码，定位到该跨页左页） */
export const BOOK_CHAPTERS = [
  { id: 'p1', label: 'P1', title: 'EMAX', page: 1 },
  { id: 'c1', label: 'C1', title: 'EMERGENCE 涌现', page: 12 },
  { id: 'c1-s1', label: 'C1-S1', title: '外饰设计', page: 20 },
  { id: 'c1-s2', label: 'C1-S2', title: '内饰设计', page: 62 },
  { id: 'c2', label: 'C2', title: '2050 交通工具：凌波出行系统', page: 84 },
  { id: 'c3', label: 'C3', title: '视觉开发：现实与意识交织的空间', page: 120 },
  { id: 'c4', label: 'C4', title: '命题档案：数字永生与未来出行', page: 146 },
];

/** 1-based 页码 → spread index */
export function pageToSpread(pageNum) {
  const n = Math.max(1, Math.min(160, pageNum));
  if (n <= 1) return 0;
  return Math.floor(n / 2);
}

/** spread index → 左页 1-based 页码（无则 null） */
export function spreadLeftPage(spreadIndex) {
  if (spreadIndex <= 0) return null;
  return spreadIndex * 2;
}

/** spread index → 右页 1-based 页码（末跨环衬则为 null） */
export function spreadRightPage(spreadIndex) {
  if (spreadIndex === 0) return 1;
  const right = spreadIndex * 2 + 1;
  if (right > 160) return null;
  return right;
}
