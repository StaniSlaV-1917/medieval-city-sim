// Главный рендерер: земля, объекты с сортировкой по Y, жители, освещение, частицы.
import { Simulation } from '../sim/game';
import { Camera, TILE } from './camera';
import { TileMapRenderer } from './tilemap';
import { getBuildingSprite } from './buildingSprites';
import { getPropSprite, getWallSprite, getLightSprite, getWarmLightSprite } from './propSprites';
import { Tile } from '../world/tiles';
import { idx, PropType } from '../world/world';
import { BuildingType } from '../world/buildings';
import { daylight, Season, hourOf } from '../core/time';
import { SEASON_PALETTES } from './palette';
import { makeCanvas, ctx2d, hash2 } from './atlas';
import { Citizen, CitizenState } from '../sim/citizen';
import { getCitizenSprite } from './citizenSprites';
import { drawBubbles } from './bubbles';

export interface BubbleOpts {
  density: number;
  favorites: number[];
  topInset: number;
  bottomInset: number;
  obstacles: { x: number; y: number; w: number; h: number }[];
}
import { drawWeather } from './weather';
import { getAnimalSprite } from './animalSprites';
import { drawOverlay } from './overlays';
import { AnimalKind } from '../sim/animals';

interface Drawable {
  y: number; // ключ сортировки (мировые px)
  kind: 0 | 1 | 2 | 3 | 4; // 0 здание, 1 проп, 2 житель, 3 стена, 4 животное
  ref: number;
}

interface Smoke {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

export class Renderer {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  lightCanvas: HTMLCanvasElement;
  lg: CanvasRenderingContext2D;
  camera: Camera;
  tilemap: TileMapRenderer;
  sim: Simulation;
  private drawables: Drawable[] = [];
  private smoke: Smoke[] = [];
  private smokeAcc = 0;
  /** Сдвиг в тиках для интерполяции (0..1) */
  alpha = 0;
  /** Выделенный житель/здание */
  selectedCitizen = -1;
  selectedBuilding = -1;
  bubbleCanvas: HTMLCanvasElement;
  private bg: CanvasRenderingContext2D;
  dpr = 1;
  bubbleOpts: BubbleOpts = { density: 1, favorites: [], topInset: 44, bottomInset: 48, obstacles: [] };
  hoverCitizen = -1;
  /** Отладочная информация */
  debug = { drawn: 0, lights: 0 };
  time = 0;
  showOverlay: 'none' | 'crime' | 'fire' | 'wealth' = 'none';
  private lastTileVersion = 0;

  constructor(canvas: HTMLCanvasElement, sim: Simulation) {
    this.canvas = canvas;
    this.g = ctx2d(canvas);
    this.sim = sim;
    this.camera = new Camera(sim.world.w * TILE, sim.world.h * TILE);
    this.tilemap = new TileMapRenderer(sim.world);
    this.lightCanvas = makeCanvas(canvas.width, canvas.height);
    this.lg = ctx2d(this.lightCanvas);
    // Отдельный холст для облачков: чёткий текст при любом DPR
    this.bubbleCanvas = document.createElement('canvas');
    this.bubbleCanvas.id = 'bubbles';
    canvas.parentElement?.insertBefore(this.bubbleCanvas, canvas.nextSibling);
    this.bg = ctx2d(this.bubbleCanvas);
  }

  resize(w: number, h: number): void {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    this.dpr = dpr;
    this.bubbleCanvas.width = Math.round(w * dpr);
    this.bubbleCanvas.height = Math.round(h * dpr);
    this.bubbleCanvas.style.width = `${w}px`;
    this.bubbleCanvas.style.height = `${h}px`;
    this.bg = ctx2d(this.bubbleCanvas);
    this.canvas.width = w;
    this.canvas.height = h;
    this.lightCanvas.width = w;
    this.lightCanvas.height = h;
    this.g = ctx2d(this.canvas);
    this.lg = ctx2d(this.lightCanvas);
    this.camera.resize(w, h);
  }

  render(dt: number): void {
    this.time += dt;
    const g = this.g;
    const cam = this.camera;
    const sim = this.sim;
    const world = sim.world;
    const season = sim.season;
    const pal = SEASON_PALETTES[season];
    this.tilemap.setSeason(season);
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#1a2a3a';
    g.fillRect(0, 0, W, H);
    g.imageSmoothingEnabled = false;
    const z = cam.zoom;
    const shakeX = sim.shake > 0 ? (Math.random() - 0.5) * sim.shake * 12 : 0;
    const shakeY = sim.shake > 0 ? (Math.random() - 0.5) * sim.shake * 12 : 0;
    const ox = Math.round(W / 2 - cam.x * z + shakeX);
    const oy = Math.round(H / 2 - cam.y * z + shakeY);
    if (sim.tileVersion !== this.lastTileVersion) {
      this.lastTileVersion = sim.tileVersion;
      this.tilemap.invalidateAll();
    }
    g.setTransform(z, 0, 0, z, ox, oy);
    const view = cam.viewRect();
    // Земля
    this.tilemap.draw(g, view.x0, view.y0, view.x1, view.y1);
    this.drawFlood(g, view);
    // Объекты
    this.collectDrawables(view.x0 - 64, view.y0 - 96, view.x1 + 64, view.y1 + 32);
    this.drawables.sort((a, b) => a.y - b.y || a.kind - b.kind || a.ref - b.ref);
    const snow = pal.snow;
    const light = daylight(sim.tick);
    let drawn = 0;
    for (const d of this.drawables) {
      drawn++;
      if (d.kind === 0) this.drawBuilding(g, d.ref, snow);
      else if (d.kind === 1) this.drawProp(g, d.ref, season);
      else if (d.kind === 2) this.drawCitizen(g, sim.citizens[d.ref]);
      else if (d.kind === 4) this.drawAnimal(g, d.ref);
      else this.drawWall(g, d.ref, snow);
    }
    this.debug.drawn = drawn;
    // Выделение
    if (this.selectedBuilding >= 0) {
      const b = world.buildings[this.selectedBuilding];
      if (b) {
        g.strokeStyle = 'rgba(255,230,120,0.9)';
        g.lineWidth = 1 / z;
        g.strokeRect(b.x * TILE + 0.5, b.y * TILE + 0.5, b.w * TILE - 1, b.h * TILE - 1);
      }
    }
    // Дым и огонь
    this.updateSmoke(dt, view);
    this.drawSmoke(g);
    this.drawFires(g, dt);
    this.drawDragon(g);
    drawOverlay(g, this, sim, view);
    // Ночное освещение
    this.drawLighting(light, view, z, ox, oy);
    // Погода
    g.setTransform(1, 0, 0, 1, 0, 0);
    drawWeather(g, this, sim, dt);
    // Облачки речи — на отдельном холсте с учётом DPR
    const bg = this.bg;
    bg.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    bg.clearRect(0, 0, this.canvas.width, this.canvas.height);
    drawBubbles(bg, this, sim, { density: this.bubbleOpts.density, favorites: this.bubbleOpts.favorites, viewW: this.canvas.width, viewH: this.canvas.height, topInset: this.bubbleOpts.topInset, bottomInset: this.bubbleOpts.bottomInset, obstacles: this.bubbleOpts.obstacles });
  }

  private collectDrawables(x0: number, y0: number, x1: number, y1: number): void {
    const world = this.sim.world;
    const out = this.drawables;
    out.length = 0;
    const tx0 = Math.max(0, Math.floor(x0 / TILE));
    const ty0 = Math.max(0, Math.floor(y0 / TILE));
    const tx1 = Math.min(world.w - 1, Math.ceil(x1 / TILE));
    const ty1 = Math.min(world.h - 1, Math.ceil(y1 / TILE));
    // Здания: по тайлам (футпринт), добавить каждое 1 раз
    const seen = new Set<number>();
    for (let y = ty0; y <= ty1; y++) {
      for (let x = tx0; x <= tx1; x++) {
        const i = y * world.w + x;
        const bid = world.buildingAt[i];
        if (bid >= 0 && !seen.has(bid)) {
          seen.add(bid);
          const b = world.buildings[bid];
          out.push({ y: (b.y + b.h) * TILE - 0.5, kind: 0, ref: bid });
        }
        const t = world.tiles[i];
        if (t === Tile.Wall || t === Tile.Tower || t === Tile.Gate) out.push({ y: (y + 1) * TILE - 0.25, kind: 3, ref: i });
      }
    }
    // Пропы
    const props = world.props;
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      if (p.x < tx0 - 1 || p.x > tx1 + 1 || p.y < ty0 - 2 || p.y > ty1 + 1) continue;
      out.push({ y: (p.y + p.oy) * TILE, kind: 1, ref: i });
    }
    // Животные
    const an = this.sim.animals;
    const a = this.alpha;
    for (let i = 0; i < an.length; i++) {
      const z = an[i];
      const ax = z.px + (z.x - z.px) * a;
      const ay = z.py + (z.y - z.py) * a;
      if (ax < tx0 - 1 || ax > tx1 + 1 || ay < ty0 - 1 || ay > ty1 + 1) continue;
      out.push({ y: z.kind === AnimalKind.Bird ? 1e9 : (ay + 0.5) * TILE, kind: 4, ref: i });
    }
    // Жители
    const cs = this.sim.citizens;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (!c.alive || c.inside >= 0) continue;
      const cx = c.px + (c.x - c.px) * a;
      const cy = c.py + (c.y - c.py) * a;
      if (cx < tx0 - 1 || cx > tx1 + 1 || cy < ty0 - 1 || cy > ty1 + 1) continue;
      out.push({ y: (cy + 0.5) * TILE + 0.1, kind: 2, ref: i });
    }
  }

  private drawBuilding(g: CanvasRenderingContext2D, id: number, snow: boolean): void {
    const b = this.sim.world.buildings[id];
    const damaged = b.underConstruction !== undefined ? 3 + Math.min(3, b.buildStage ?? 0) : b.condition <= 0 ? 2 : b.condition < 0.6 ? 1 : 0;
    const s = getBuildingSprite(b, snow, damaged);
    g.drawImage(s.canvas, b.x * TILE + s.ox, b.y * TILE + s.oy);
    if (b.underConstruction !== undefined && b.underConstruction < 1) {
      // леса стройки
      g.fillStyle = 'rgba(120,90,50,0.55)';
      g.fillRect(b.x * TILE, b.y * TILE - 6, b.w * TILE, 4);
      g.fillStyle = '#ffe070';
      g.fillRect(b.x * TILE, b.y * TILE - 6, b.w * TILE * b.underConstruction, 4);
    }
    if (this.selectedBuilding === id) {
      g.globalAlpha = 0.25;
      g.fillStyle = '#ffe070';
      g.fillRect(b.x * TILE + s.ox, b.y * TILE + s.oy, s.canvas.width, s.canvas.height);
      g.globalAlpha = 1;
    }
  }

  private drawProp(g: CanvasRenderingContext2D, i: number, season: Season): void {
    const p = this.sim.world.props[i];
    const s = getPropSprite(p.type, p.variant, season);
    const x = Math.round((p.x + p.ox) * TILE - s.ax);
    const y = Math.round((p.y + p.oy) * TILE - s.ay);
    if (p.type === PropType.Waterwheel) {
      // вращение колеса
      g.save();
      g.translate(x + s.ax, y + s.ay - 8);
      g.rotate(this.time * 0.8);
      g.drawImage(s.canvas, s.x, s.y, s.w, s.h, -s.ax, -s.ay + 8, s.w, s.h);
      g.restore();
      return;
    }
    g.drawImage(s.canvas, s.x, s.y, s.w, s.h, x, y, s.w, s.h);
  }

  private drawAnimal(g: CanvasRenderingContext2D, i: number): void {
    const z = this.sim.animals[i];
    const a = this.alpha;
    const ax = (z.px + (z.x - z.px) * a + 0.5) * TILE;
    const ay = (z.py + (z.y - z.py) * a + 0.5) * TILE;
    const s = getAnimalSprite(z.kind, z.dir, Math.floor(z.anim) % 2);
    if (z.kind === AnimalKind.Bird) {
      g.fillStyle = 'rgba(0,0,0,0.1)';
      g.fillRect(Math.round(ax) - 2, Math.round(ay) + 10, 5, 1);
      g.drawImage(s.canvas, s.x, s.y, s.w, s.h, Math.round(ax - s.ax), Math.round(ay - 22 - s.ay), s.w, s.h);
      return;
    }
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(Math.round(ax) - 3, Math.round(ay) + 1, 6, 1);
    g.drawImage(s.canvas, s.x, s.y, s.w, s.h, Math.round(ax - s.ax), Math.round(ay + 2 - s.ay), s.w, s.h);
  }

  private drawWall(g: CanvasRenderingContext2D, i: number, snow: boolean): void {
    const world = this.sim.world;
    const t = world.tiles[i];
    const x = i % world.w;
    const y = (i / world.w) | 0;
    const s = getWallSprite(t === Tile.Tower ? 'tower' : t === Tile.Gate ? 'gate' : 'wall', i, snow);
    g.drawImage(s.canvas, s.x, s.y, s.w, s.h, x * TILE + 8 - s.ax, (y + 1) * TILE - s.ay, s.w, s.h);
  }

  private drawCitizen(g: CanvasRenderingContext2D, c: Citizen): void {
    const a = this.alpha;
    const cx = (c.px + (c.x - c.px) * a + 0.5) * TILE;
    const cy = (c.py + (c.y - c.py) * a + 0.5) * TILE;
    const moving = c.state === CitizenState.Moving;
    const frame = moving ? (Math.floor(c.animPhase) % 4) : 0;
    const s = getCitizenSprite(c, c.dir, frame);
    const x = Math.round(cx - s.ax);
    const y = Math.round(cy + 3 - s.ay);
    if (c.actionData.cart) {
      const cs = getPropSprite(PropType.Cart, 0, this.sim.season);
      const off = c.dir === 2 ? -14 : c.dir === 1 ? 14 : 0;
      const offY = c.dir === 0 ? -12 : c.dir === 3 ? 12 : 0;
      g.drawImage(cs.canvas, cs.x, cs.y, cs.w, cs.h, Math.round(cx + off - cs.ax), Math.round(cy + offY + 4 - cs.ay), cs.w, cs.h);
    }
    // тень
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(Math.round(cx) - 3, Math.round(cy) + 1, 6, 2);
    g.drawImage(s.canvas, s.x, s.y, s.w, s.h, x, y, s.w, s.h);
    if (this.selectedCitizen === c.id || this.hoverCitizen === c.id) {
      g.strokeStyle = this.selectedCitizen === c.id ? 'rgba(255,230,120,0.95)' : 'rgba(255,255,255,0.6)';
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(Math.round(cx), Math.round(cy) + 2, 6, 3, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }

  // ---------------------------------------------------------------- Дым

  private updateSmoke(dt: number, view: { x0: number; y0: number; x1: number; y1: number }): void {
    const sim = this.sim;
    const world = sim.world;
    const hour = hourOf(sim.tick);
    const season = sim.season;
    const coldBoost = season === Season.Winter ? 1.6 : season === Season.Autumn ? 1.2 : 0.8;
    const wind = world.wind;
    this.smokeAcc += dt;
    const emitEvery = 0.25;
    while (this.smokeAcc > emitEvery) {
      this.smokeAcc -= emitEvery;
      // выбрать несколько видимых зданий с трубами
      const snow = season === Season.Winter;
      for (let k = 0; k < 6; k++) {
        const b = world.buildings[(hash2(k, Math.floor(this.time * 4), sim.tick) * world.buildings.length) | 0];
        if (!b) continue;
        const bx = (b.x + b.w / 2) * TILE;
        const by = b.y * TILE;
        if (bx < view.x0 - 32 || bx > view.x1 + 32 || by < view.y0 - 64 || by > view.y1 + 32) continue;
        const s = getBuildingSprite(b, snow);
        if (!s.chimney) continue;
        // активность: кухни утром/вечером, кузница и пекарня днём
        let p = 0.1 * coldBoost;
        if (b.type === BuildingType.Smithy && hour > 7 && hour < 18) p = 0.9;
        else if (b.type === BuildingType.Bakery && hour > 3 && hour < 14) p = 0.9;
        else if (b.type === BuildingType.Tavern && hour > 11) p = 0.5;
        else if ((hour > 5.5 && hour < 8.5) || (hour > 17 && hour < 21)) p = 0.45 * coldBoost;
        if (b.residents.length === 0 && b.workers.length === 0 && b.type !== BuildingType.Smithy) p *= 0.3;
        if (hash2(b.id, Math.floor(this.time * 4), 7) > p) continue;
        this.smoke.push({
          x: b.x * TILE + s.chimney.x,
          y: b.y * TILE + s.chimney.y,
          vx: Math.cos(wind.dir) * wind.strength * 6 + (Math.random() - 0.5) * 2,
          vy: -6 - Math.random() * 4,
          life: 0,
          maxLife: 2.5 + Math.random() * 2,
          size: 1.5 + Math.random(),
        });
      }
    }
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const s = this.smoke[i];
      s.life += dt;
      if (s.life > s.maxLife) {
        this.smoke[i] = this.smoke[this.smoke.length - 1];
        this.smoke.pop();
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy *= 0.98;
      s.size += dt * 1.6;
    }
    if (this.smoke.length > 400) this.smoke.splice(0, this.smoke.length - 400);
  }

  private drawSmoke(g: CanvasRenderingContext2D): void {
    for (const s of this.smoke) {
      const t = s.life / s.maxLife;
      g.globalAlpha = (1 - t) * 0.35;
      g.fillStyle = '#cfd4da';
      g.beginPath();
      g.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  private drawFlood(g: CanvasRenderingContext2D, view: { x0: number; y0: number; x1: number; y1: number }): void {
    const f = this.sim.flood;
    if (!f) return;
    const w = this.sim.world.w;
    const t = this.time;
    g.fillStyle = 'rgba(60,110,170,0.6)';
    for (const i of f.tiles) {
      const x = (i % w) * TILE;
      const y = ((i / w) | 0) * TILE;
      if (x < view.x0 - 16 || x > view.x1 || y < view.y0 - 16 || y > view.y1) continue;
      g.fillRect(x, y, TILE, TILE);
      if (((i * 7) % 11) === 0) {
        g.fillStyle = 'rgba(220,235,250,0.5)';
        g.fillRect(x + ((t * 20 + i) % 12), y + 6, 4, 1);
        g.fillStyle = 'rgba(60,110,170,0.6)';
      }
    }
  }

  private drawDragon(g: CanvasRenderingContext2D): void {
    const d = this.sim.dragon;
    if (!d) return;
    const x = d.x * TILE;
    const y = d.y * TILE;
    const t = this.time;
    const flap = Math.sin(t * 10);
    // тень
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.ellipse(x, y + 40, 26, 10, 0, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.translate(x, y - 30);
    if (d.dir === 1) g.scale(-1, 1);
    // тело
    g.fillStyle = '#5a1e1e';
    g.beginPath();
    g.ellipse(0, 0, 18, 7, 0, 0, Math.PI * 2);
    g.fill();
    // шея и голова
    g.fillRect(14, -6, 10, 5);
    g.fillRect(22, -10, 10, 7);
    g.fillStyle = '#ffd040';
    g.fillRect(29, -8, 2, 2);
    // хвост
    g.fillStyle = '#5a1e1e';
    for (let k = 0; k < 6; k++) g.fillRect(-18 - k * 4, -2 + Math.sin(t * 6 + k) * 2, 5, 3);
    // крылья
    g.fillStyle = '#7a2a2a';
    g.beginPath();
    g.moveTo(-4, -2);
    g.lineTo(-10, -22 - flap * 10);
    g.lineTo(14, -16 - flap * 12);
    g.lineTo(8, -2);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(-4, 2);
    g.lineTo(-10, 18 + flap * 6);
    g.lineTo(14, 14 + flap * 8);
    g.lineTo(8, 2);
    g.closePath();
    g.fill();
    // пламя
    if (Math.sin(t * 3) > 0.6) {
      g.fillStyle = 'rgba(255,140,30,0.8)';
      g.beginPath();
      g.moveTo(32, -6);
      g.lineTo(50, 4 + Math.random() * 6);
      g.lineTo(44, 14);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  private fireParts: { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; kind: number }[] = [];
  private drawFires(g: CanvasRenderingContext2D, dt: number): void {
    const sim = this.sim;
    const parts = this.fireParts;
    for (const f of sim.fires) {
      const b = sim.world.buildings[f.building];
      if (!b) continue;
      const n = Math.ceil((0.25 + f.intensity) * b.w * b.h * dt * 40);
      for (let k = 0; k < n && parts.length < 1500; k++) {
        const kind = Math.random() < 0.3 ? 1 : 0; // 1 — дым
        parts.push({
          x: (b.x + Math.random() * b.w) * TILE,
          y: (b.y + Math.random() * b.h) * TILE - (kind ? 10 : 2),
          vx: (Math.random() - 0.5) * 6 + Math.cos(sim.weather.windDir) * sim.weather.wind * 10,
          vy: -20 - Math.random() * 25,
          life: 0,
          max: kind ? 2 + Math.random() * 2 : 0.4 + Math.random() * 0.6,
          size: kind ? 2 + Math.random() * 3 : 2 + Math.random() * 3 * (0.4 + f.intensity),
          kind,
        });
      }
      // свечение
      g.globalAlpha = 0.25 * f.intensity;
      g.fillStyle = '#ff8a2a';
      g.fillRect(b.x * TILE - 4, b.y * TILE - 20, b.w * TILE + 8, b.h * TILE + 24);
      g.globalAlpha = 1;
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      if (p.life > p.max) {
        parts[i] = parts[parts.length - 1];
        parts.pop();
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const t = p.life / p.max;
      if (p.kind) {
        g.globalAlpha = (1 - t) * 0.5;
        g.fillStyle = '#3a3634';
        g.beginPath();
        g.arc(p.x, p.y, p.size + t * 4, 0, Math.PI * 2);
        g.fill();
      } else {
        g.globalAlpha = 1 - t * 0.7;
        g.fillStyle = t < 0.3 ? '#fff2a0' : t < 0.6 ? '#ffb030' : '#e0401a';
        g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    g.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- Освещение

  private drawLighting(light: number, view: { x0: number; y0: number; x1: number; y1: number }, z: number, ox: number, oy: number): void {
    const darkness = 1 - light;
    if (darkness < 0.02) return;
    const lg = this.lg;
    const W = this.lightCanvas.width;
    const H = this.lightCanvas.height;
    lg.setTransform(1, 0, 0, 1, 0, 0);
    lg.globalCompositeOperation = 'source-over';
    lg.clearRect(0, 0, W, H);
    // ночь: тёмно-синий
    const a = darkness * 0.78;
    lg.fillStyle = `rgba(12, 16, 48, ${a})`;
    lg.fillRect(0, 0, W, H);
    // Вырезать свет
    lg.globalCompositeOperation = 'destination-out';
    lg.setTransform(z, 0, 0, z, ox, oy);
    const ls = getLightSprite();
    const world = this.sim.world;
    const flicker = 0.9 + 0.1 * Math.sin(this.time * 9);
    let count = 0;
    const snow = this.sim.season === Season.Winter;
    const g = this.g;
    g.setTransform(z, 0, 0, z, ox, oy);
    const glow: { x: number; y: number; r: number; warm: number }[] = [];
    // Окна зданий (только если «обитаемые» и вечер/ночь) — факелы/фонари всегда
    for (const b of world.buildings) {
      const bx = b.x * TILE;
      const by = b.y * TILE;
      if (bx + b.w * TILE < view.x0 - 48 || bx > view.x1 + 48 || by + b.h * TILE < view.y0 - 48 || by > view.y1 + 48) continue;
      if (!b.lit) continue;
      const s = getBuildingSprite(b, snow);
      for (const l of s.lights) {
        const r = l.r * darkness;
        lg.globalAlpha = 0.85 * darkness;
        lg.drawImage(ls, bx + l.x - r, by + l.y - r, r * 2, r * 2);
        glow.push({ x: bx + l.x, y: by + l.y, r: r * 0.7, warm: l.warm });
        count++;
      }
    }
    // Пожары светят
    for (const f of this.sim.fires) {
      const b = world.buildings[f.building];
      if (!b) continue;
      const r = 60 * f.intensity * flicker;
      const fx = (b.x + b.w / 2) * TILE;
      const fy = (b.y + b.h / 2) * TILE;
      lg.globalAlpha = 0.95 * darkness;
      lg.drawImage(ls, fx - r, fy - r, r * 2, r * 2);
      glow.push({ x: fx, y: fy, r: r * 0.8, warm: 2 });
    }
    // Факелы и фонари
    for (const p of world.props) {
      if (p.type !== PropType.Torch && p.type !== PropType.Lamp) continue;
      const px = (p.x + p.ox) * TILE;
      const py = (p.y + p.oy) * TILE - (p.type === PropType.Lamp ? 14 : 12);
      if (px < view.x0 - 48 || px > view.x1 + 48 || py < view.y0 - 48 || py > view.y1 + 48) continue;
      const r = 26 * darkness * flicker;
      lg.globalAlpha = 0.95 * darkness;
      lg.drawImage(ls, px - r, py - r, r * 2, r * 2);
      glow.push({ x: px, y: py, r: r * 0.6, warm: 1.2 });
      count++;
    }
    lg.globalAlpha = 1;
    lg.globalCompositeOperation = 'source-over';
    // Наложить темноту
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.lightCanvas, 0, 0);
    // Тёплое свечение поверх
    g.setTransform(z, 0, 0, z, ox, oy);
    g.globalCompositeOperation = 'lighter';
    const wl = getWarmLightSprite();
    for (const l of glow) {
      g.globalAlpha = 0.3 * darkness * l.warm;
      g.drawImage(wl, l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    }
    // Светящиеся окна
    g.globalAlpha = 0.9 * darkness;
    g.fillStyle = '#ffd56a';
    for (const l of glow) {
      if (l.warm !== 1) continue;
      g.fillRect(l.x - 1.5, l.y - 2, 3, 3.5);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    this.debug.lights = count;
  }

  /** Поиск жителя под экранной точкой */
  pickCitizen(sx: number, sy: number): number {
    const w = this.camera.screenToWorld(sx, sy);
    let best = -1;
    let bestD = 12 * 12;
    const a = this.alpha;
    for (const c of this.sim.citizens) {
      if (!c.alive || c.inside >= 0) continue;
      const cx = (c.px + (c.x - c.px) * a + 0.5) * TILE;
      const cy = (c.py + (c.y - c.py) * a + 0.5) * TILE - 5;
      const dx = cx - w.x;
      const dy = (cy - w.y) * 0.8;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = c.id;
      }
    }
    return best;
  }

  pickBuilding(sx: number, sy: number): number {
    const w = this.camera.screenToWorld(sx, sy);
    const world = this.sim.world;
    const tx = Math.floor(w.x / TILE);
    const ty = Math.floor(w.y / TILE);
    if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return -1;
    const id = world.buildingAt[idx(world, tx, ty)];
    if (id >= 0) return id;
    // фасад выше футпринта: проверить тайлы ниже
    for (let k = 1; k <= 3; k++) {
      const yy = ty + k;
      if (yy >= world.h) break;
      const id2 = world.buildingAt[idx(world, tx, yy)];
      if (id2 >= 0) {
        const b = world.buildings[id2];
        const s = getBuildingSprite(b, false);
        if (w.y >= b.y * TILE + s.oy) return id2;
      }
    }
    return -1;
  }
}
