import { clamp } from '../core/math';

export const TILE = 16;

export class Camera {
  /** Центр камеры в мировых пикселях */
  x = 0;
  y = 0;
  zoom = 2;
  targetX = 0;
  targetY = 0;
  targetZoom = 2;
  viewW = 800;
  viewH = 600;
  worldW = 0;
  worldH = 0;
  /** Следовать за объектом: функция, возвращающая позицию в мировых px */
  follow: (() => { x: number; y: number } | null) | null = null;
  private smooth = true;

  constructor(worldW: number, worldH: number) {
    this.worldW = worldW;
    this.worldH = worldH;
  }

  resize(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
  }

  setImmediate(x: number, y: number, zoom?: number): void {
    this.x = this.targetX = x;
    this.y = this.targetY = y;
    if (zoom !== undefined) this.zoom = this.targetZoom = zoom;
    this.clampTarget();
    this.x = this.targetX;
    this.y = this.targetY;
  }

  moveBy(dx: number, dy: number): void {
    this.targetX += dx;
    this.targetY += dy;
    this.follow = null;
    this.clampTarget();
  }

  panTo(x: number, y: number, zoom?: number): void {
    this.targetX = x;
    this.targetY = y;
    if (zoom !== undefined) this.targetZoom = zoom;
    this.clampTarget();
  }

  /** Зум вокруг экранной точки */
  zoomAt(factor: number, sx: number, sy: number): void {
    const before = this.screenToWorld(sx, sy);
    this.targetZoom = clamp(this.targetZoom * factor, 0.5, 6);
    // пересчитать позицию так, чтобы точка под курсором осталась на месте (с учётом targetZoom)
    const z = this.targetZoom;
    const wx = before.x;
    const wy = before.y;
    this.targetX = wx - (sx - this.viewW / 2) / z;
    this.targetY = wy - (sy - this.viewH / 2) / z;
    this.clampTarget();
  }

  private clampTarget(): void {
    const halfW = this.viewW / 2 / this.targetZoom;
    const halfH = this.viewH / 2 / this.targetZoom;
    const margin = 32;
    this.targetX = clamp(this.targetX, halfW - margin, this.worldW - halfW + margin);
    this.targetY = clamp(this.targetY, halfH - margin, this.worldH - halfH + margin);
    if (this.worldW < halfW * 2) this.targetX = this.worldW / 2;
    if (this.worldH < halfH * 2) this.targetY = this.worldH / 2;
  }

  update(dt: number): void {
    if (this.follow) {
      const p = this.follow();
      if (p) {
        this.targetX = p.x;
        this.targetY = p.y;
        this.clampTarget();
      } else this.follow = null;
    }
    const k = this.smooth ? 1 - Math.pow(0.001, dt) : 1;
    this.x += (this.targetX - this.x) * k;
    this.y += (this.targetY - this.y) * k;
    const zk = 1 - Math.pow(0.0005, dt);
    this.zoom += (this.targetZoom - this.zoom) * zk;
    if (Math.abs(this.zoom - this.targetZoom) < 0.001) this.zoom = this.targetZoom;
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.viewW / 2) / this.zoom + this.x, y: (sy - this.viewH / 2) / this.zoom + this.y };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - this.x) * this.zoom + this.viewW / 2, y: (wy - this.y) * this.zoom + this.viewH / 2 };
  }

  /** Видимый прямоугольник в мировых px */
  viewRect(): { x0: number; y0: number; x1: number; y1: number } {
    const hw = this.viewW / 2 / this.zoom;
    const hh = this.viewH / 2 / this.zoom;
    return { x0: this.x - hw, y0: this.y - hh, x1: this.x + hw, y1: this.y + hh };
  }
}
