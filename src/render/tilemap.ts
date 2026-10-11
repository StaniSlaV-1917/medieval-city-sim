// Отрисовка земли по чанкам с кэшем.
import { World, idx } from '../world/world';
import { Tile } from '../world/tiles';
import { Season } from '../core/time';
import { SEASON_PALETTES, SeasonPalette, rgb, shade, mix, RGB } from './palette';
import { makeCanvas, ctx2d, hash2 } from './atlas';
import { TILE } from './camera';

export const CHUNK = 32; // тайлов

export class TileMapRenderer {
  private world: World;
  private chunks: (HTMLCanvasElement | null)[];
  private dirty: Uint8Array;
  private cols: number;
  private rows: number;
  private season: Season = Season.Spring;
  /** Степень снега 0..1 (переход) */
  snow = 0;

  constructor(world: World) {
    this.world = world;
    this.cols = Math.ceil(world.w / CHUNK);
    this.rows = Math.ceil(world.h / CHUNK);
    this.chunks = new Array(this.cols * this.rows).fill(null);
    this.dirty = new Uint8Array(this.cols * this.rows).fill(1);
  }

  setSeason(s: Season): void {
    if (s !== this.season) {
      this.season = s;
      this.dirty.fill(1);
    }
  }

  invalidateTile(x: number, y: number): void {
    const cx = (x / CHUNK) | 0;
    const cy = (y / CHUNK) | 0;
    this.dirty[cy * this.cols + cx] = 1;
    // соседние чанки (границы)
    if (x % CHUNK === 0 && cx > 0) this.dirty[cy * this.cols + cx - 1] = 1;
    if (y % CHUNK === 0 && cy > 0) this.dirty[(cy - 1) * this.cols + cx] = 1;
    if (x % CHUNK === CHUNK - 1 && cx < this.cols - 1) this.dirty[cy * this.cols + cx + 1] = 1;
    if (y % CHUNK === CHUNK - 1 && cy < this.rows - 1) this.dirty[(cy + 1) * this.cols + cx] = 1;
  }

  invalidateAll(): void {
    this.dirty.fill(1);
  }

  /** Нарисовать видимые чанки */
  draw(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, budgetMs = 6): void {
    const c0 = Math.max(0, Math.floor(x0 / (CHUNK * TILE)));
    const c1 = Math.min(this.cols - 1, Math.floor(x1 / (CHUNK * TILE)));
    const r0 = Math.max(0, Math.floor(y0 / (CHUNK * TILE)));
    const r1 = Math.min(this.rows - 1, Math.floor(y1 / (CHUNK * TILE)));
    const start = performance.now();
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * this.cols + c;
        if (this.dirty[i] || !this.chunks[i]) {
          if (this.chunks[i] && performance.now() - start > budgetMs) {
            // отложим перерисовку, покажем старый
          } else {
            this.renderChunk(c, r);
            this.dirty[i] = 0;
          }
        }
        const cv = this.chunks[i];
        if (cv) g.drawImage(cv, c * CHUNK * TILE, r * CHUNK * TILE);
      }
    }
  }

  private renderChunk(cx: number, cy: number): void {
    const i = cy * this.cols + cx;
    let cv = this.chunks[i];
    if (!cv) {
      cv = makeCanvas(CHUNK * TILE, CHUNK * TILE);
      this.chunks[i] = cv;
    }
    const g = ctx2d(cv);
    const pal = SEASON_PALETTES[this.season];
    const w = this.world;
    const tx0 = cx * CHUNK;
    const ty0 = cy * CHUNK;
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const x = tx0 + tx;
        const y = ty0 + ty;
        if (x >= w.w || y >= w.h) {
          g.fillStyle = rgb(pal.waterDeep);
          g.fillRect(tx * TILE, ty * TILE, TILE, TILE);
          continue;
        }
        this.drawTile(g, pal, x, y, tx * TILE, ty * TILE);
      }
    }
  }

  private tile(x: number, y: number): Tile {
    const w = this.world;
    if (x < 0 || y < 0 || x >= w.w || y >= w.h) return Tile.Water;
    return w.tiles[idx(w, x, y)] as Tile;
  }

  private drawTile(g: CanvasRenderingContext2D, pal: SeasonPalette, x: number, y: number, px: number, py: number): void {
    const w = this.world;
    const t = this.tile(x, y);
    const n = hash2(x, y, 1);
    const n2 = hash2(x, y, 2);
    const height = w.height[idx(w, x, y)];
    const hillK = 1 + height * 0.18;
    const T = TILE;
    let baseColor: RGB;
    switch (t) {
      case Tile.Grass:
      case Tile.Garden:
      case Tile.Cemetery:
      case Tile.Meadow:
      case Tile.Forest: {
        const b = t === Tile.Meadow ? pal.meadow : t === Tile.Forest ? pal.forestFloor : t === Tile.Garden ? pal.garden : t === Tile.Cemetery ? pal.cemetery : n > 0.5 ? pal.grass : pal.grass2;
        baseColor = shade(b, (0.94 + n2 * 0.12) * hillK);
        g.fillStyle = rgb(baseColor);
        g.fillRect(px, py, T, T);
        if (!pal.snow) {
          // травинки
          const tufts = t === Tile.Meadow ? 4 : 3;
          for (let k = 0; k < tufts; k++) {
            const hx = hash2(x, y, 10 + k);
            const hy = hash2(x, y, 20 + k);
            g.fillStyle = rgb(shade(baseColor, 0.82));
            g.fillRect(px + ((hx * (T - 2)) | 0), py + ((hy * (T - 3)) | 0), 1, 2);
            g.fillStyle = rgb(shade(baseColor, 1.12));
            g.fillRect(px + ((hx * (T - 2)) | 0) + 1, py + ((hy * (T - 3)) | 0) - 1, 1, 2);
          }
          if (t === Tile.Meadow && pal.flowers.length && n2 > 0.55) {
            const fc = pal.flowers[(hash2(x, y, 33) * pal.flowers.length) | 0];
            g.fillStyle = rgb(fc);
            g.fillRect(px + ((hash2(x, y, 34) * (T - 2)) | 0), py + ((hash2(x, y, 35) * (T - 2)) | 0), 2, 2);
            if (n > 0.7) g.fillRect(px + ((hash2(x, y, 36) * (T - 2)) | 0), py + ((hash2(x, y, 37) * (T - 2)) | 0), 2, 2);
          }
          if (t === Tile.Cemetery && n2 > 0.75) {
            g.fillStyle = rgb(shade(baseColor, 0.85));
            g.fillRect(px + 4, py + 6, 3, 1);
          }
        } else {
          // снег: лёгкие пятна
          if (n2 > 0.8) {
            g.fillStyle = rgb(shade(baseColor, 0.93));
            g.fillRect(px + ((n * 12) | 0), py + ((hash2(x, y, 7) * 12) | 0), 3, 2);
          }
        }
        this.drawEdges(g, x, y, px, py, baseColor);
        break;
      }
      case Tile.Dirt:
      case Tile.Mud: {
        const b = t === Tile.Mud ? pal.mud : pal.dirt;
        baseColor = shade(b, (0.93 + n2 * 0.14) * hillK);
        g.fillStyle = rgb(baseColor);
        g.fillRect(px, py, T, T);
        // колеи/камешки
        g.fillStyle = rgb(shade(baseColor, 0.85));
        g.fillRect(px + ((n * 13) | 0), py + ((hash2(x, y, 5) * 13) | 0), 2, 1);
        g.fillStyle = rgb(shade(baseColor, 1.1));
        g.fillRect(px + ((hash2(x, y, 6) * 13) | 0), py + ((hash2(x, y, 7) * 13) | 0), 2, 1);
        if (t === Tile.Mud && !pal.snow && n > 0.6) {
          g.fillStyle = rgb(shade(baseColor, 0.78));
          g.fillRect(px + ((hash2(x, y, 8) * 10) | 0), py + ((hash2(x, y, 9) * 10) | 0), 4, 3);
        }
        this.drawEdges(g, x, y, px, py, baseColor);
        break;
      }
      case Tile.Road:
      case Tile.Plaza:
      case Tile.Gate: {
        const b = t === Tile.Plaza ? pal.plaza : pal.road;
        baseColor = shade(b, 0.94 + n2 * 0.1);
        g.fillStyle = rgb(baseColor);
        g.fillRect(px, py, T, T);
        // брусчатка
        const dark = rgb(shade(baseColor, 0.82));
        const light = rgb(shade(baseColor, 1.08));
        for (let r = 0; r < 4; r++) {
          const off = r % 2 === 0 ? 0 : 2;
          for (let c = 0; c < 4; c++) {
            const sx = px + off + c * 4;
            const sy = py + r * 4;
            const hv = hash2(x * 4 + c, y * 4 + r, 3);
            g.fillStyle = hv > 0.5 ? light : dark;
            g.fillRect(sx, sy + 3, 4, 1);
            g.fillStyle = dark;
            g.fillRect(sx + 3, sy, 1, 4);
          }
        }
        if (pal.snow && n > 0.5) {
          g.fillStyle = 'rgba(240,244,248,0.55)';
          g.fillRect(px + ((n * 8) | 0), py + ((n2 * 8) | 0), 6, 4);
        }
        break;
      }
      case Tile.Bridge: {
        baseColor = shade([150, 110, 70], 0.95 + n2 * 0.1);
        g.fillStyle = rgb(baseColor);
        g.fillRect(px, py, T, T);
        g.fillStyle = rgb(shade(baseColor, 0.75));
        for (let k = 0; k < T; k += 4) g.fillRect(px + k, py, 1, T);
        g.fillStyle = rgb(shade(baseColor, 1.1));
        for (let k = 2; k < T; k += 4) g.fillRect(px + k, py, 1, T);
        // перила сверху/снизу если край
        if (this.tile(x, y - 1) !== Tile.Bridge) {
          g.fillStyle = '#4a3220';
          g.fillRect(px, py, T, 2);
        }
        if (this.tile(x, y + 1) !== Tile.Bridge) {
          g.fillStyle = '#4a3220';
          g.fillRect(px, py + T - 2, T, 2);
        }
        break;
      }
      case Tile.Swamp: {
        baseColor = shade(mix(pal.forestFloor, pal.waterDeep, 0.3), 0.9 + n2 * 0.15);
        g.fillStyle = rgb(baseColor);
        g.fillRect(px, py, T, T);
        // лужи и кочки
        g.fillStyle = rgb(mix(baseColor, pal.water, 0.55));
        g.fillRect(px + ((n * 9) | 0), py + ((hash2(x, y, 41) * 9) | 0), 5, 3);
        g.fillStyle = rgb(shade(baseColor, 1.25));
        g.fillRect(px + ((hash2(x, y, 42) * 12) | 0), py + ((hash2(x, y, 43) * 12) | 0), 2, 2);
        g.fillRect(px + ((hash2(x, y, 44) * 12) | 0), py + ((hash2(x, y, 45) * 12) | 0), 1, 3);
        break;
      }
      case Tile.Clay: {
        baseColor = shade([176, 110, 70], 0.9 + n2 * 0.15);
        g.fillStyle = rgb(baseColor);
        g.fillRect(px, py, T, T);
        g.fillStyle = rgb(shade(baseColor, 0.78));
        g.fillRect(px + ((n * 10) | 0), py + ((hash2(x, y, 46) * 10) | 0), 5, 3);
        g.fillStyle = rgb(shade(baseColor, 1.15));
        g.fillRect(px + ((hash2(x, y, 47) * 12) | 0), py + ((hash2(x, y, 48) * 12) | 0), 3, 1);
        this.drawEdges(g, x, y, px, py, baseColor);
        break;
      }
      case Tile.Salt: {
        baseColor = shade([214, 206, 190], 0.95 + n2 * 0.1);
        g.fillStyle = rgb(baseColor);
        g.fillRect(px, py, T, T);
        g.fillStyle = '#f4f0e8';
        g.fillRect(px + ((n * 12) | 0), py + ((hash2(x, y, 49) * 12) | 0), 3, 2);
        g.fillRect(px + ((hash2(x, y, 50) * 12) | 0), py + ((hash2(x, y, 51) * 12) | 0), 2, 2);
        g.fillStyle = rgb(shade(baseColor, 0.85));
        g.fillRect(px + ((hash2(x, y, 52) * 12) | 0), py + ((hash2(x, y, 53) * 12) | 0), 4, 1);
        break;
      }
      case Tile.IronOre: {
        baseColor = shade(mix(pal.rock, [150, 80, 50], 0.45), 0.9 + n2 * 0.2);
        g.fillStyle = rgb(baseColor);
        g.fillRect(px, py, T, T);
        g.fillStyle = rgb(shade(baseColor, 0.7));
        g.fillRect(px + ((n * 10) | 0), py + ((hash2(x, y, 5) * 10) | 0), 5, 3);
        g.fillStyle = '#c86a3a';
        g.fillRect(px + ((hash2(x, y, 54) * 12) | 0), py + ((hash2(x, y, 55) * 12) | 0), 2, 2);
        g.fillRect(px + ((hash2(x, y, 56) * 12) | 0), py + ((hash2(x, y, 57) * 12) | 0), 2, 1);
        g.fillStyle = rgb(shade(baseColor, 1.2));
        g.fillRect(px + ((n * 10) | 0), py + ((hash2(x, y, 5) * 10) | 0), 5, 1);
        break;
      }
      case Tile.Pasture: {
        baseColor = shade(pal.meadow, (0.9 + n2 * 0.1) * hillK);
        g.fillStyle = rgb(baseColor);
        g.fillRect(px, py, T, T);
        g.fillStyle = rgb(shade(baseColor, 0.85));
        for (let k = 0; k < 3; k++) g.fillRect(px + ((hash2(x, y, 60 + k) * (T - 2)) | 0), py + ((hash2(x, y, 70 + k) * (T - 3)) | 0), 1, 2);
        if (n2 > 0.75) {
          g.fillStyle = '#6a5a40';
          g.fillRect(px + ((hash2(x, y, 80) * 12) | 0), py + ((hash2(x, y, 81) * 12) | 0), 2, 1);
        }
        this.drawEdges(g, x, y, px, py, baseColor);
        break;
      }
      case Tile.Water:
      case Tile.Lake:
      case Tile.Shallow: {
        baseColor = mix(pal.waterDeep, pal.water, t === Tile.Lake ? 0.15 + n2 * 0.3 : 0.3 + n2 * 0.5);
        g.fillStyle = rgb(baseColor);
        g.fillRect(px, py, T, T);
        // блики
        g.fillStyle = rgb(shade(baseColor, 1.25));
        g.fillRect(px + ((n * 12) | 0), py + ((hash2(x, y, 11) * 14) | 0), 3, 1);
        if (n2 > 0.6) g.fillRect(px + ((hash2(x, y, 12) * 12) | 0), py + ((hash2(x, y, 13) * 14) | 0), 2, 1);
        // берег: светлая кромка рядом с сушей
        const edge = rgb(mix(baseColor, [220, 230, 240], 0.5));
        g.fillStyle = edge;
        if (!this.isWater(x, y - 1)) g.fillRect(px, py, T, 1);
        if (!this.isWater(x, y + 1)) g.fillRect(px, py + T - 1, T, 1);
        if (!this.isWater(x - 1, y)) g.fillRect(px, py, 1, T);
        if (!this.isWater(x + 1, y)) g.fillRect(px + T - 1, py, 1, T);
        if (pal.snow) {
          // лёд у берегов
          g.fillStyle = 'rgba(220,235,245,0.5)';
          if (!this.isWater(x, y - 1)) g.fillRect(px, py, T, 3);
          if (!this.isWater(x, y + 1)) g.fillRect(px, py + T - 3, T, 3);
          if (!this.isWater(x - 1, y)) g.fillRect(px, py, 3, T);
          if (!this.isWater(x + 1, y)) g.fillRect(px + T - 3, py, 3, T);
        }
        break;
      }
      case Tile.Sand: {
        baseColor = shade(pal.sand, 0.94 + n2 * 0.1);
        g.fillStyle = rgb(baseColor);
        g.fillRect(px, py, T, T);
        g.fillStyle = rgb(shade(baseColor, 0.88));
        g.fillRect(px + ((n * 13) | 0), py + ((hash2(x, y, 5) * 13) | 0), 2, 1);
        this.drawEdges(g, x, y, px, py, baseColor);
        break;
      }
      case Tile.Field: {
        baseColor = shade(pal.field, 0.95 + n2 * 0.08);
        g.fillStyle = rgb(baseColor);
        g.fillRect(px, py, T, T);
        // борозды — горизонтальные
        g.fillStyle = rgb(shade(baseColor, 0.8));
        for (let k = 1; k < T; k += 4) g.fillRect(px, py + k, T, 1);
        // ростки/колосья
        g.fillStyle = rgb(pal.fieldRow);
        for (let k = 3; k < T; k += 4) {
          for (let c = 0; c < T; c += 3) {
            const hv = hash2(x * 16 + c, y * 16 + k, 4);
            if (hv > 0.3) g.fillRect(px + c + ((hv * 2) | 0), py + k, 1, 2);
          }
        }
        break;
      }
      case Tile.Rock:
      case Tile.Quarry: {
        baseColor = shade(pal.rock, (0.9 + n2 * 0.2) * (t === Tile.Quarry ? 1.1 : 1));
        g.fillStyle = rgb(baseColor);
        g.fillRect(px, py, T, T);
        g.fillStyle = rgb(shade(baseColor, 0.75));
        g.fillRect(px + ((n * 10) | 0), py + ((hash2(x, y, 5) * 10) | 0), 5, 3);
        g.fillStyle = rgb(shade(baseColor, 1.2));
        g.fillRect(px + ((n * 10) | 0), py + ((hash2(x, y, 5) * 10) | 0), 5, 1);
        g.fillStyle = rgb(shade(baseColor, 0.7));
        g.fillRect(px + ((hash2(x, y, 6) * 12) | 0), py + ((hash2(x, y, 7) * 12) | 0), 3, 2);
        break;
      }
      case Tile.Floor: {
        // под зданием — тёмная земля (видна только при разрушении)
        baseColor = shade(pal.dirt, 0.8);
        g.fillStyle = rgb(baseColor);
        g.fillRect(px, py, T, T);
        break;
      }
      case Tile.Wall:
      case Tile.Tower: {
        // основание стены — рисуется объектом; здесь земля
        baseColor = shade(pal.road, 0.9);
        g.fillStyle = rgb(baseColor);
        g.fillRect(px, py, T, T);
        break;
      }
      default: {
        baseColor = pal.grass;
        g.fillStyle = rgb(baseColor);
        g.fillRect(px, py, T, T);
      }
    }
  }

  private isWater(x: number, y: number): boolean {
    const t = this.tile(x, y);
    return t === Tile.Water || t === Tile.Shallow || t === Tile.Lake;
  }

  /** Мягкие переходы: тень по краю рядом с дорогой/водой */
  private drawEdges(g: CanvasRenderingContext2D, x: number, y: number, px: number, py: number, base: RGB): void {
    const T = TILE;
    const dark = rgb(shade(base, 0.86));
    g.fillStyle = dark;
    const isRoad = (t: Tile) => t === Tile.Road || t === Tile.Plaza || t === Tile.Dirt || t === Tile.Gate;
    if (isRoad(this.tile(x, y - 1))) g.fillRect(px, py, T, 1);
    if (isRoad(this.tile(x, y + 1))) g.fillRect(px, py + T - 1, T, 1);
    if (isRoad(this.tile(x - 1, y))) g.fillRect(px, py, 1, T);
    if (isRoad(this.tile(x + 1, y))) g.fillRect(px + T - 1, py, 1, T);
  }
}
