// A* по тайловой сетке с бинарной кучей и кэшем путей.
import { World, moveCost, inBounds } from './world';

class MinHeap {
  private keys = new Float64Array(4096);
  private vals = new Int32Array(4096);
  size = 0;
  push(key: number, val: number): void {
    if (this.size >= this.keys.length) {
      const nk = new Float64Array(this.keys.length * 2);
      nk.set(this.keys);
      this.keys = nk;
      const nv = new Int32Array(this.vals.length * 2);
      nv.set(this.vals);
      this.vals = nv;
    }
    const k = this.keys;
    const v = this.vals;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): number {
    const k = this.keys;
    const v = this.vals;
    const top = v[0];
    const n = --this.size;
    if (n > 0) {
      const lastK = k[n];
      const lastV = v[n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && k[r] < k[l] ? r : l;
        if (k[m] >= lastK) break;
        k[i] = k[m];
        v[i] = v[m];
        i = m;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return top;
  }
  clear(): void {
    this.size = 0;
  }
}

export class Pathfinder {
  private world: World;
  private gScore: Float32Array;
  private cameFrom: Int32Array;
  private closed: Uint8Array;
  private stamp: Uint32Array;
  private curStamp = 1;
  private heap = new MinHeap();
  private cache = new Map<number, Int32Array | null>();
  /** Статистика */
  stats = { searches: 0, cacheHits: 0, expanded: 0 };
  private costCache: Float32Array;
  costDirty = true;

  constructor(world: World) {
    this.world = world;
    const n = world.w * world.h;
    this.gScore = new Float32Array(n);
    this.cameFrom = new Int32Array(n);
    this.closed = new Uint8Array(n);
    this.stamp = new Uint32Array(n);
    this.costCache = new Float32Array(n);
    this.rebuildCosts();
  }

  /** Пересчитать стоимости тайлов (после изменения карты) */
  rebuildCosts(): void {
    const w = this.world;
    for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) this.costCache[y * w.w + x] = moveCost(w, x, y);
    this.cache.clear();
    this.costDirty = false;
  }

  invalidate(): void {
    this.costDirty = true;
  }

  cost(i: number): number {
    return this.costCache[i];
  }

  /**
   * Путь от тайла from до тайла to (индексы). Возвращает массив индексов, не включая from, включая to.
   * null — пути нет.
   */
  find(fromX: number, fromY: number, toX: number, toY: number): Int32Array | null {
    if (this.costDirty) this.rebuildCosts();
    const w = this.world;
    if (!inBounds(w, fromX, fromY) || !inBounds(w, toX, toY)) return null;
    const W = w.w;
    const from = fromY * W + fromX;
    const to = toY * W + toX;
    if (from === to) return new Int32Array(0);
    const key = from * (W * w.h) + to;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      this.stats.cacheHits++;
      return cached;
    }
    // Обратный путь в кэше?
    const rkey = to * (W * w.h) + from;
    const rc = this.cache.get(rkey);
    if (rc !== undefined) {
      this.stats.cacheHits++;
      if (rc === null) return null;
      const out = new Int32Array(rc.length);
      // rc: from 'to' к 'from' (не включая to, включая from). Нам нужно: не включая from, включая to.
      for (let i = 0; i < rc.length - 1; i++) out[i] = rc[rc.length - 2 - i];
      out[rc.length - 1] = to;
      this.cache.set(key, out);
      return out;
    }
    const res = this.search(from, to);
    if (this.cache.size > 30000) this.cache.clear();
    this.cache.set(key, res);
    return res;
  }

  private search(from: number, to: number): Int32Array | null {
    this.stats.searches++;
    const w = this.world;
    const W = w.w;
    const H = w.h;
    const cost = this.costCache;
    if (cost[to] === Infinity || cost[from] === Infinity) return null;
    const stamp = ++this.curStamp;
    if (stamp === 0xffffffff) {
      this.stamp.fill(0);
      this.curStamp = 1;
    }
    const gS = this.gScore;
    const came = this.cameFrom;
    const closed = this.closed;
    const st = this.stamp;
    const heap = this.heap;
    heap.clear();
    const tx = to % W;
    const ty = (to / W) | 0;
    // Октильная эвристика с весом 1.25 (чуть неоптимальные пути, зато в разы меньше раскрытий)
    const HW = 1.25;
    const h = (i: number) => {
      const x = i % W;
      const y = (i / W) | 0;
      const dx = Math.abs(x - tx);
      const dy = Math.abs(y - ty);
      return (Math.max(dx, dy) + 0.4142 * Math.min(dx, dy)) * HW;
    };
    st[from] = stamp;
    gS[from] = 0;
    came[from] = -1;
    closed[from] = 0;
    heap.push(h(from), from);
    let expanded = 0;
    const maxExpand = W * H;
    while (heap.size > 0) {
      const cur = heap.pop();
      if (cur === to) {
        // восстановить путь
        let len = 0;
        for (let p = cur; p !== from; p = came[p]) len++;
        const out = new Int32Array(len);
        let i = len - 1;
        for (let p = cur; p !== from; p = came[p]) out[i--] = p;
        this.stats.expanded += expanded;
        return out;
      }
      if (closed[cur] && st[cur] === stamp) continue;
      closed[cur] = 1;
      expanded++;
      if (expanded > maxExpand) break;
      const cx = cur % W;
      const cy = (cur / W) | 0;
      const g = gS[cur];
      // 4 направления + диагонали (только если оба ортогональных соседа проходимы)
      for (let d = 0; d < 8; d++) {
        const dx = DX[d];
        const dy = DY[d];
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        const c = cost[ni];
        if (c === Infinity) continue;
        let step = c;
        if (d >= 4) {
          // диагональ — проверка срезания углов
          if (cost[cy * W + nx] === Infinity || cost[ny * W + cx] === Infinity) continue;
          step = c * 1.4142;
        }
        const ng = g + step;
        if (st[ni] === stamp) {
          if (closed[ni]) continue;
          if (ng >= gS[ni]) continue;
        } else {
          st[ni] = stamp;
          closed[ni] = 0;
        }
        gS[ni] = ng;
        came[ni] = cur;
        heap.push(ng + h(ni), ni);
      }
    }
    this.stats.expanded += expanded;
    return null;
  }

  /** Достижимость (BFS по проходимым тайлам) — для проверок */
  reachableMask(fromX: number, fromY: number): Uint8Array {
    if (this.costDirty) this.rebuildCosts();
    const w = this.world;
    const W = w.w;
    const H = w.h;
    const mask = new Uint8Array(W * H);
    const start = fromY * W + fromX;
    if (this.costCache[start] === Infinity) return mask;
    const stack = [start];
    mask[start] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      const cx = cur % W;
      const cy = (cur / W) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d];
        const ny = cy + DY[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (mask[ni] || this.costCache[ni] === Infinity) continue;
        mask[ni] = 1;
        stack.push(ni);
      }
    }
    return mask;
  }
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
