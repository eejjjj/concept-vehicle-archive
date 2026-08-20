/** 首页风动片 · 居中 9×9 核心区（3×3 个大框 × 每框 3×3 片） */
export const CORE_SIZE = 9;
export const ZONE_SIZE = 3;

/** 已配置 link 但暂不跳转，设计就绪后从此 Set 移除即可 */
export const DISABLED_ZONE_LINKS = new Set(['next', 'access']);

export const INTRO_ZONES = [
  { id: 'emax', file: 'emax.png', zc: 0, zr: 0, link: 'emax/' },
  { id: 'next', file: 'next.png', zc: 1, zr: 0, link: 'next/' },
  { id: 'access', file: 'g03.png', zc: 2, zr: 0, link: 'access/' },
  { id: 'g04', file: 'g04.png', zc: 0, zr: 1 },
  { id: 'g05', file: 'g05.png', zc: 1, zr: 1 },
  { id: 'g06', file: 'g06.png', zc: 2, zr: 1 },
  { id: 'g07', file: 'g07.png', zc: 0, zr: 2 },
  { id: 'g08', file: 'g08.png', zc: 1, zr: 2 },
  { id: 'g09', file: 'g09.png', zc: 2, zr: 2 },
];

export function zoneAt(zc, zr) {
  return INTRO_ZONES.find((z) => z.zc === zc && z.zr === zr) || null;
}

export function zoneHref(zone) {
  if (!zone?.link || DISABLED_ZONE_LINKS.has(zone.id)) return null;
  return zone.link;
}

export function cellToZone(col, row, padCol, padRow) {
  if (
    col < padCol
    || col >= padCol + CORE_SIZE
    || row < padRow
    || row >= padRow + CORE_SIZE
  ) {
    return null;
  }
  const lc = col - padCol;
  const lr = row - padRow;
  return {
    zc: Math.floor(lc / ZONE_SIZE),
    zr: Math.floor(lr / ZONE_SIZE),
    tileCol: lc % ZONE_SIZE,
    tileRow: lr % ZONE_SIZE,
  };
}
