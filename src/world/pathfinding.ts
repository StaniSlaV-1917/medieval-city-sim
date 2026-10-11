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
  /** Иерархический граф для дальних маршрутов */
  hpa: HPA | null = null;

  constructor(world: World) {
    this.world = world;
    const n = world.w * world.h;
    this.gScore = new Float32Array(n);
    this.cameFrom = new Int32Array(n);
    this.closed = new Uint8Array(n);
    this.stamp = new Uint32Array(n);
    this.costCache = new Float32Array(n);
    this.rebuildCosts();
    this.hpa = new HPA(world, this);
  }

  /** Пересчитать стоимости тайлов (после изменения карты) */
  rebuildCosts(): void {
    const w = this.world;
    for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) this.costCache[y * w.w + x] = moveCost(w, x, y);
    this.cache.clear();
    this.costDirty = false;
    this.hpa?.invalidateAll();
  }

  /** Карта изменилась (стройка, снос, вырубка) — пересчитать стоимости при следующем поиске */
  invalidate(): void {
    this.costDirty = true;
  }

  /** Точечное изменение: пересчитать стоимости и граф только вокруг прямоугольника */
  invalidateRect(x: number, y: number, w: number, h: number): void {
    if (this.costDirty) {
      this.rebuildCosts();
      return;
    }
    const wd = this.world;
    for (let yy = Math.max(0, y - 1); yy <= Math.min(wd.h - 1, y + h); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(wd.w - 1, x + w); xx++) this.costCache[yy * wd.w + xx] = moveCost(wd, xx, yy);
    this.cache.clear();
    this.hpa?.invalidateRect(x - 1, y - 1, w + 2, h + 2);
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
    const fx = from % W;
    const fy = (from / W) | 0;
    const tx2 = to % W;
    const ty2 = (to / W) | 0;
    let res: Int32Array | null;
    // Дальние маршруты — через иерархический граф (HPA*), ближние — обычный A*
    if (Math.max(Math.abs(fx - tx2), Math.abs(fy - ty2)) > HPA_MIN_DIST && this.hpa) {
      res = this.hpa.find(from, to);
      if (!res) res = this.search(from, to);
    } else res = this.search(from, to);
    if (this.cache.size > 30000) this.cache.clear();
    this.cache.set(key, res);
    return res;
  }

  /** Дейкстра в прямоугольнике: стоимости от from до каждого из targets (Infinity — недостижим) */
  floodBounded(from: number, targets: number[], x0: number, y0: number, x1: number, y1: number): Float64Array {
    if (this.costDirty) this.rebuildCosts();
    const out = new Float64Array(targets.length).fill(Infinity);
    const W = this.world.w;
    const H = this.world.h;
    const cost = this.costCache;
    if (cost[from] === Infinity) return out;
    const stamp = ++this.curStamp;
    if (stamp === 0xffffffff) {
      this.stamp.fill(0);
      this.curStamp = 1;
    }
    const gS = this.gScore;
    const closed = this.closed;
    const st = this.stamp;
    const heap = this.heap;
    heap.clear();
    st[from] = stamp;
    gS[from] = 0;
    closed[from] = 0;
    heap.push(0, from);
    const want = new Map<number, number>();
    targets.forEach((t, k) => want.set(t, k));
    let left = want.size;
    while (heap.size > 0 && left > 0) {
      const cur = heap.pop();
      if (closed[cur] && st[cur] === stamp) continue;
      closed[cur] = 1;
      const wk = want.get(cur);
      if (wk !== undefined) {
        out[wk] = gS[cur];
        left--;
      }
      const cx = cur % W;
      const cy = (cur / W) | 0;
      const g = gS[cur];
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d];
        const ny = cy + DY[d];
        if (nx < x0 || ny < y0 || nx > x1 || ny > y1 || nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        const c = cost[ni];
        if (c === Infinity) continue;
        let step = c;
        if (d >= 4) {
          if (cost[cy * W + nx] === Infinity || cost[ny * W + cx] === Infinity) continue;
          step = c * 1.4142;
        }
        const ng = g + step;
        if (st[ni] === stamp) {
          if (closed[ni] || ng >= gS[ni]) continue;
        } else {
          st[ni] = stamp;
          closed[ni] = 0;
        }
        gS[ni] = ng;
        heap.push(ng, ni);
      }
    }
    return out;
  }

  /** Локальный A* в прямоугольнике [x0,x1]×[y0,y1] (для HPA*) */
  searchBounded(from: number, to: number, x0: number, y0: number, x1: number, y1: number): Int32Array | null {
    if (this.costDirty) this.rebuildCosts();
    return this.search(from, to, x0, y0, x1, y1);
  }

  private search(from: number, to: number, bx0 = 0, by0 = 0, bx1 = 1e9, by1 = 1e9): Int32Array | null {
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
        if (nx < bx0 || ny < by0 || nx > bx1 || ny > by1) continue;
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

// ---------------------------------------------------------------- HPA*

const CL = 32; // размер кластера
export let HPA_MIN_DIST = 96; // дальше этого — иерархический поиск
export function setHpaMinDist(v: number): void {
  HPA_MIN_DIST = v;
}

interface Cluster {
  cx: number;
  cy: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Узлы-входы (индексы тайлов) */
  nodes: number[];
  /** Внутрикластерные рёбра: ключ a*N+b → стоимость */
  intra: Map<number, number>;
  built: boolean;
}

/**
 * Иерархический поиск пути: карта делится на кластеры CL×CL; на границах кластеров — входы (узлы),
 * внутри кластера узлы связаны локальными A*-путями (считаются лениво и кэшируются). Абстрактный
 * путь ищется A* по графу узлов, затем уточняется локальными путями.
 */
export class HPA {
  private world: World;
  private pf: Pathfinder;
  private cols: number;
  private rows: number;
  private clusters: Cluster[] = [];
  /** Узел → список соседей [узел, стоимость] (межкластерные рёбра) */
  private inter = new Map<number, [number, number][]>();
  private interBuilt: Uint8Array; // по парам кластеров: индекс = cluster*2 + (0: справа, 1: снизу)
  private segCache = new Map<number, Int32Array | null>();
  private heap = new MinHeap();
  stats = { abstractSearches: 0, clusterBuilds: 0 };

  constructor(world: World, pf: Pathfinder) {
    this.world = world;
    this.pf = pf;
    this.cols = Math.ceil(world.w / CL);
    this.rows = Math.ceil(world.h / CL);
    this.interBuilt = new Uint8Array(this.cols * this.rows * 2);
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) this.clusters.push({ cx: c, cy: r, x0: c * CL, y0: r * CL, x1: Math.min(world.w - 1, c * CL + CL - 1), y1: Math.min(world.h - 1, r * CL + CL - 1), nodes: [], intra: new Map(), built: false });
  }

  invalidateAll(): void {
    for (const cl of this.clusters) {
      cl.nodes = [];
      cl.intra.clear();
      cl.built = false;
    }
    this.inter.clear();
    this.interBuilt.fill(0);
    this.segCache.clear();
  }

  /** Пересобрать кластеры, задетые прямоугольником (и их границы с соседями) */
  invalidateRect(x: number, y: number, w: number, h: number): void {
    const c0 = Math.max(0, Math.floor(x / CL));
    const c1 = Math.min(this.cols - 1, Math.floor((x + w - 1) / CL));
    const r0 = Math.max(0, Math.floor(y / CL));
    const r1 = Math.min(this.rows - 1, Math.floor((y + h - 1) / CL));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.resetCluster(c, r);
    this.segCache.clear();
  }

  private resetCluster(c: number, r: number): void {
    const id = r * this.cols + c;
    const cl = this.clusters[id];
    // убрать узлы кластера из межкластерных рёбер (включая соседей)
    for (const n of cl.nodes) {
      for (const [m] of this.inter.get(n) ?? []) {
        const list = this.inter.get(m);
        if (list) this.inter.set(m, list.filter((e) => e[0] !== n));
      }
      this.inter.delete(n);
    }
    cl.nodes = [];
    cl.intra.clear();
    cl.built = false;
    // соседи должны пересобрать общие границы и свои intra
    const neigh = [[c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]];
    for (const [nc, nr] of neigh) {
      if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
      const nid = nr * this.cols + nc;
      const ncl = this.clusters[nid];
      for (const n of ncl.nodes) {
        for (const [m] of this.inter.get(n) ?? []) {
          const list = this.inter.get(m);
          if (list) this.inter.set(m, list.filter((e) => e[0] !== n));
        }
        this.inter.delete(n);
      }
      ncl.nodes = [];
      ncl.intra.clear();
      ncl.built = false;
      this.interBuilt[nid * 2] = 0;
      this.interBuilt[nid * 2 + 1] = 0;
    }
    this.interBuilt[id * 2] = 0;
    this.interBuilt[id * 2 + 1] = 0;
    // границы слева/сверху принадлежат соседям
    if (c > 0) this.interBuilt[(r * this.cols + c - 1) * 2] = 0;
    if (r > 0) this.interBuilt[((r - 1) * this.cols + c) * 2 + 1] = 0;
  }

  private clusterOf(i: number): number {
    const W = this.world.w;
    const x = i % W;
    const y = (i / W) | 0;
    return Math.floor(y / CL) * this.cols + Math.floor(x / CL);
  }

  private addInter(a: number, b: number, cost: number): void {
    const la = this.inter.get(a) ?? [];
    la.push([b, cost]);
    this.inter.set(a, la);
    const lb = this.inter.get(b) ?? [];
    lb.push([a, cost]);
    this.inter.set(b, lb);
  }

  /** Входы на границе кластера id с правым (side 0) или нижним (side 1) соседом */
  private buildBorder(id: number, side: 0 | 1): void {
    if (this.interBuilt[id * 2 + side]) return;
    this.interBuilt[id * 2 + side] = 1;
    const cl = this.clusters[id];
    const W = this.world.w;
    const nid = side === 0 ? id + 1 : id + this.cols;
    if (side === 0 && cl.cx === this.cols - 1) return;
    if (side === 1 && cl.cy === this.rows - 1) return;
    const ncl = this.clusters[nid];
    const len = side === 0 ? cl.y1 - cl.y0 + 1 : cl.x1 - cl.x0 + 1;
    let run = -1;
    const flush = (end: number): void => {
      if (run < 0) return;
      const n = end - run + 1;
      const picks: number[] = [];
      if (n <= 6) picks.push(run + (n >> 1));
      else {
        picks.push(run);
        for (let k = run + 8; k < end; k += 8) picks.push(k);
        picks.push(end);
      }
      for (const k of picks) {
        const a = side === 0 ? (cl.y0 + k) * W + cl.x1 : (cl.y1) * W + cl.x0 + k;
        const b = side === 0 ? (cl.y0 + k) * W + ncl.x0 : (ncl.y0) * W + cl.x0 + k;
        if (!cl.nodes.includes(a)) cl.nodes.push(a);
        if (!ncl.nodes.includes(b)) ncl.nodes.push(b);
        this.addInter(a, b, this.pf.cost(b));
      }
      run = -1;
    };
    for (let k = 0; k < len; k++) {
      const a = side === 0 ? (cl.y0 + k) * W + cl.x1 : (cl.y1) * W + cl.x0 + k;
      const b = side === 0 ? (cl.y0 + k) * W + ncl.x0 : (ncl.y0) * W + cl.x0 + k;
      const open = this.pf.cost(a) !== Infinity && this.pf.cost(b) !== Infinity;
      if (open) {
        if (run < 0) run = k;
      } else flush(k - 1);
    }
    flush(len - 1);
    // соседний кластер получил новые узлы — его внутренние рёбра надо дополнить
    ncl.built = false;
    cl.built = false;
  }

  /** Внутрикластерные рёбра между всеми узлами кластера (ленивая сборка) */
  private buildCluster(id: number): void {
    const cl = this.clusters[id];
    // сначала все четыре границы
    this.buildBorder(id, 0);
    this.buildBorder(id, 1);
    if (cl.cx > 0) this.buildBorder(id - 1, 0);
    if (cl.cy > 0) this.buildBorder(id - this.cols, 1);
    if (cl.built) return;
    cl.built = true;
    this.stats.clusterBuilds++;
    const n = cl.nodes.length;
    for (let i = 0; i < n; i++) {
      const a = cl.nodes[i];
      const rest = cl.nodes.slice(i + 1);
      if (!rest.length) break;
      const d = this.pf.floodBounded(a, rest, cl.x0, cl.y0, cl.x1, cl.y1);
      rest.forEach((b, k) => {
        const key = a < b ? a * 1e7 + b : b * 1e7 + a;
        cl.intra.set(key, d[k]);
      });
    }
  }

  private localPath(a: number, b: number, cl: Cluster): Int32Array | null {
    const key = a * 1e7 + b;
    const c = this.segCache.get(key);
    if (c !== undefined) return c;
    const p = this.pf.searchBounded(a, b, cl.x0, cl.y0, cl.x1, cl.y1);
    if (this.segCache.size > 20000) this.segCache.clear();
    this.segCache.set(key, p);
    return p;
  }


  /** Путь from→to (индексы), не включая from, включая to; null — пути нет */
  find(from: number, to: number): Int32Array | null {
    const W = this.world.w;
    const cf = this.clusterOf(from);
    const ct = this.clusterOf(to);
    if (this.pf.cost(from) === Infinity || this.pf.cost(to) === Infinity) return null;
    if (cf === ct) {
      const cl = this.clusters[cf];
      const direct = this.pf.searchBounded(from, to, cl.x0, cl.y0, cl.x1, cl.y1);
      if (direct) return direct;
    }
    this.stats.abstractSearches++;
    this.buildCluster(cf);
    this.buildCluster(ct);
    const clF = this.clusters[cf];
    const clT = this.clusters[ct];
    // временные рёбра: старт → узлы своего кластера, узлы кластера цели → цель
    const startEdges: [number, number][] = [];
    const ds = this.pf.floodBounded(from, clF.nodes, clF.x0, clF.y0, clF.x1, clF.y1);
    clF.nodes.forEach((n, k) => {
      if (ds[k] !== Infinity) startEdges.push([n, ds[k]]);
    });
    const goalEdges = new Map<number, number>();
    const dt = this.pf.floodBounded(to, clT.nodes, clT.x0, clT.y0, clT.x1, clT.y1);
    clT.nodes.forEach((n, k) => {
      if (dt[k] !== Infinity) goalEdges.set(n, dt[k]);
    });
    if (!startEdges.length || !goalEdges.size) return null;
    // A* по графу узлов
    const tx = to % W;
    const ty = (to / W) | 0;
    const h = (i: number): number => {
      const x = i % W;
      const y = (i / W) | 0;
      const dx = Math.abs(x - tx);
      const dy = Math.abs(y - ty);
      return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy);
    };
    const g = new Map<number, number>();
    const came = new Map<number, number>();
    const closed = new Set<number>();
    const heap = this.heap;
    heap.clear();
    g.set(from, 0);
    for (const [n, c] of startEdges) {
      if (c < (g.get(n) ?? Infinity)) {
        g.set(n, c);
        came.set(n, from);
        heap.push(c + h(n), n);
      }
    }
    let found = false;
    let expanded = 0;
    while (heap.size > 0) {
      const cur = heap.pop();
      if (closed.has(cur)) continue;
      closed.add(cur);
      if (++expanded > 20000) break;
      const gc = g.get(cur)!;
      const gk = goalEdges.get(cur);
      if (gk !== undefined) {
        const total = gc + gk;
        if (total < (g.get(to) ?? Infinity)) {
          g.set(to, total);
          came.set(to, cur);
          heap.push(total, to);
        }
      }
      if (cur === to) {
        found = true;
        break;
      }
      const cid = this.clusterOf(cur);
      this.buildCluster(cid);
      const cl = this.clusters[cid];
      // внутрикластерные
      for (const n of cl.nodes) {
        if (n === cur) continue;
        const key = cur < n ? cur * 1e7 + n : n * 1e7 + cur;
        const c = cl.intra.get(key);
        if (c === undefined || c === Infinity) continue;
        const ng = gc + c;
        if (ng < (g.get(n) ?? Infinity)) {
          g.set(n, ng);
          came.set(n, cur);
          heap.push(ng + h(n), n);
        }
      }
      // межкластерные
      for (const [n, c] of this.inter.get(cur) ?? []) {
        const ng = gc + c;
        if (ng < (g.get(n) ?? Infinity)) {
          g.set(n, ng);
          came.set(n, cur);
          heap.push(ng + h(n), n);
        }
      }
    }
    if (!found) return null;
    // восстановить абстрактный путь и уточнить
    const nodes: number[] = [];
    for (let p: number | undefined = to; p !== undefined; p = came.get(p)) nodes.push(p);
    nodes.reverse();
    const out: number[] = [];
    for (let k = 0; k + 1 < nodes.length; k++) {
      const a = nodes[k];
      const b = nodes[k + 1];
      const ca = this.clusterOf(a);
      const cb = this.clusterOf(b);
      if (ca === cb) {
        const seg = this.localPath(a, b, this.clusters[ca]);
        if (!seg) return null;
        for (const i of seg) out.push(i);
      } else {
        // межкластерное ребро — соседние тайлы
        out.push(b);
      }
    }
    return Int32Array.from(out);
  }
}
