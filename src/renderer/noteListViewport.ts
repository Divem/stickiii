const OVERSCAN = 4;

export function noteListRange(total: number, top: number, height: number, rowHeight: number): { start: number; end: number } {
  const visible = Math.ceil(height / rowHeight);
  const start = Math.min(Math.max(0, total - visible), Math.max(0, Math.floor(top / rowHeight) - OVERSCAN));
  return { start, end: Math.min(total, start + visible + 2 * OVERSCAN) };
}

export function noteListScroll(top: number, height: number, index: number, rowHeight: number): number {
  const rowTop = index * rowHeight;
  return rowTop < top ? rowTop : rowTop + rowHeight > top + height ? Math.max(0, rowTop + rowHeight - height) : top;
}
