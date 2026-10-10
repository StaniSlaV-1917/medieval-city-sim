// Пространственный хеш для быстрого поиска соседей (жители).
export class SpatialHash {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  private heads: Int32Array;
  private next: Int32Array;
  private cellOf: Int32Array;

  constructor(width: number, height: number, cell = 4, capacity = 2048) {
    this.cell = cell;
    this.cols = Math.ceil(width / cell) + 1;
    this.rows = Math.ceil(height / cell) + 1;
    this.heads = new Int32Array(this.cols * this.rows).fill(-1);
    this.next = new Int32Array(capacity).fill(-1);
    this.cellOf = new Int32Array(capacity).fill(-1);
  }

  private ensure(n: number): void {
    if (n <= this.next.length) return;
    let cap = this.next.length;
    while (cap < n) cap *= 2;
    const nn = new Int32Array(cap).fill(-1);
    nn.set(this.next);
    this.next = nn;
    const nc = new Int32Array(cap).fill(-1);
    nc.set(this.cellOf);
    this.cellOf = nc;
  }

  clear(): void {
    this.heads.fill(-1);
  }

  insert(id: number, x: number, y: number): void {
    this.ensure(id + 1);
    let cx = (x / this.cell) | 0;
    let cy = (y / this.cell) | 0;
    if (cx < 0) cx = 0;
    if (cy < 0) cy = 0;
    if (cx >= this.cols) cx = this.cols - 1;
    if (cy >= this.rows) cy = this.rows - 1;
    const c = cy * this.cols + cx;
    this.next[id] = this.heads[c];
    this.heads[c] = id;
    this.cellOf[id] = c;
  }

  /** Перебор id в радиусе r (по клеткам; точную дистанцию проверяет вызывающий) */
  query(x: number, y: number, r: number, out: number[]): number[] {
    out.length = 0;
    const c0x = Math.max(0, ((x - r) / this.cell) | 0);
    const c1x = Math.min(this.cols - 1, ((x + r) / this.cell) | 0);
    const c0y = Math.max(0, ((y - r) / this.cell) | 0);
    const c1y = Math.min(this.rows - 1, ((y + r) / this.cell) | 0);
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        let id = this.heads[cy * this.cols + cx];
        while (id >= 0) {
          out.push(id);
          id = this.next[id];
        }
      }
    }
    return out;
  }
}
