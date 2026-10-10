// Атлас спрайтов: один большой offscreen canvas, из которого рисуем участки.
export interface SpriteRef {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Точка привязки (относительно x,y) — обычно низ-центр */
  ax: number;
  ay: number;
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  return g;
}

/** Простой шельф-аллокатор ячеек в атласе */
export class Atlas {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  private shelfY = 0;
  private shelfH = 0;
  private cursorX = 0;
  readonly size: number;

  constructor(size = 2048) {
    this.size = size;
    this.canvas = makeCanvas(size, size);
    this.g = ctx2d(this.canvas);
  }

  /** Выделить область w×h; вернуть ссылку (пустую, рисовать через ref.canvas/g) */
  alloc(w: number, h: number, ax = w / 2, ay = h): SpriteRef {
    w = Math.ceil(w) + 1;
    h = Math.ceil(h) + 1;
    if (this.cursorX + w > this.size) {
      this.shelfY += this.shelfH;
      this.shelfH = 0;
      this.cursorX = 0;
    }
    if (this.shelfY + h > this.size) {
      // Атлас переполнен — создаём новый (старые ссылки остаются валидными)
      this.canvas = makeCanvas(this.size, this.size);
      this.g = ctx2d(this.canvas);
      this.shelfY = 0;
      this.shelfH = 0;
      this.cursorX = 0;
    }
    const ref: SpriteRef = { canvas: this.canvas, x: this.cursorX, y: this.shelfY, w: w - 1, h: h - 1, ax, ay };
    this.cursorX += w;
    if (h > this.shelfH) this.shelfH = h;
    return ref;
  }
}

/** Пиксельная «кисть»: рисует прямоугольники целыми пикселями */
export function px(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  g.fillStyle = color;
  g.fillRect(x | 0, y | 0, w | 0, h | 0);
}

/** Детерминированный хеш для шума по координатам */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
