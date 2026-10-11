// Раскладка облачков без перекрытий (чистая функция, тестируется без DOM).
export interface BubbleItem {
  id: number;
  /** Точка привязки (над головой говорящего), экранные px */
  ax: number;
  ay: number;
  w: number;
  h: number;
  priority: number;
  /** Показывать всегда (выбранный, избранный) */
  pinned: boolean;
}

export interface PlacedBubble extends BubbleItem {
  x: number;
  y: number;
}

export interface LayoutOpts {
  viewW: number;
  viewH: number;
  /** Отступы под постоянные панели */
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** Сколько не закреплённых облачков показывать */
  limit: number;
  /** Зазор между облачками */
  gap?: number;
  /** Прямоугольники интерфейса, которые нельзя перекрывать (окна, панели) */
  obstacles?: { x: number; y: number; w: number; h: number }[];
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlapArea(a: Rect, b: Rect): number {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

/**
 * Размещает облачки: сначала по приоритету, каждое — над головой говорящего; при конфликте сдвигает
 * вверх или в стороны (кандидаты строятся от краёв уже размещённых), менее важные без места скрываются.
 */
export function layoutBubbles(items: BubbleItem[], o: LayoutOpts): PlacedBubble[] {
  const gap = o.gap ?? 3;
  const sorted = [...items].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.priority - a.priority || a.id - b.id);
  const placed: PlacedBubble[] = [];
  const rects: Rect[] = [];
  const fixed = o.obstacles ? o.obstacles.length : 0;
  if (o.obstacles) rects.push(...o.obstacles);
  let shown = 0;
  const minX = o.left;
  const maxX = o.viewW - o.right;
  const minY = o.top;
  const maxY = o.viewH - o.bottom;
  for (const it of sorted) {
    if (!it.pinned && shown >= o.limit) continue;
    const w = it.w;
    const h = it.h;
    const clampX = (x: number): number => Math.max(minX, Math.min(maxX - w, x));
    const clampY = (y: number): number => Math.max(minY, Math.min(maxY - h, y));
    const baseX = clampX(it.ax - w / 2);
    const baseY = clampY(it.ay - h - 8);
    const cands: { x: number; y: number }[] = [{ x: baseX, y: baseY }];
    // Кандидаты: над, слева и справа от каждого конфликтующего прямоугольника (ближайшие первыми)
    const conflicts = rects.filter((r) => overlapArea({ x: baseX, y: baseY, w, h }, r) > 0);
    for (const r of conflicts) {
      cands.push({ x: baseX, y: clampY(r.y - h - gap) });
      cands.push({ x: clampX(r.x - w - gap), y: baseY });
      cands.push({ x: clampX(r.x + r.w + gap), y: baseY });
      cands.push({ x: clampX(r.x - w - gap), y: clampY(r.y - h - gap) });
      cands.push({ x: clampX(r.x + r.w + gap), y: clampY(r.y - h - gap) });
    }
    for (let k = 1; k <= 3; k++) cands.push({ x: baseX, y: clampY(baseY - (h + gap) * k) });
    let best: { x: number; y: number; cost: number } | null = null;
    for (const c of cands) {
      const r = { x: c.x, y: c.y, w, h };
      let cost = 0;
      for (const p of rects) {
        cost += overlapArea(r, p);
        if (cost > 0 && !it.pinned) break;
      }
      // не слишком далеко от говорящего
      const dist = Math.abs(c.x + w / 2 - it.ax) + Math.abs(c.y + h - it.ay);
      if (cost === 0 && dist > w + h * 3 + 40 && !it.pinned) continue;
      const total = cost * 10 + dist;
      if (!best || total < best.cost) best = { x: c.x, y: c.y, cost: total };
      if (cost === 0) break;
    }
    if (!best) continue;
    const r = { x: best.x, y: best.y, w, h };
    const overlaps = rects.some((p) => overlapArea(r, p) > 0);
    if (overlaps && !it.pinned) continue;
    void fixed;
    rects.push(r);
    placed.push({ ...it, x: best.x, y: best.y });
    if (!it.pinned) shown++;
  }
  return placed;
}
