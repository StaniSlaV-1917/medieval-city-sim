// Процедурные спрайты зданий (пиксель-арт, вид 3/4).
import { Building, BuildingType } from '../world/buildings';
import { MATERIAL_COLORS, ROOF_COLORS, rgb, shade, mix, RGB, hex } from './palette';
import { makeCanvas, ctx2d, hash2 } from './atlas';
import { TILE } from './camera';

export interface BuildingSprite {
  canvas: HTMLCanvasElement;
  /** Смещение левого верхнего угла спрайта относительно (b.x*TILE, b.y*TILE) */
  ox: number;
  oy: number;
  /** Источники света (окна) в px относительно (b.x*TILE, b.y*TILE) */
  lights: { x: number; y: number; r: number; warm: number }[];
  /** Труба — откуда идёт дым (px относительно b.x*TILE, b.y*TILE) или null */
  chimney: { x: number; y: number } | null;
  wallH: number;
}

const cache = new Map<string, BuildingSprite>();

export function clearBuildingSpriteCache(): void {
  cache.clear();
}

export function getBuildingSprite(b: Building, snow: boolean, damaged = 0): BuildingSprite {
  const key = `${b.id}:${b.type}:${b.w}x${b.h}:${b.material}:${b.roof}:${b.stories}:${b.variant}:${snow ? 1 : 0}:${damaged}`;
  const c = cache.get(key);
  if (c) return c;
  const s = buildSprite(b, snow);
  if (damaged >= 3) applyStage(s, b, damaged - 3);
  else if (damaged) applyDamage(s, b, damaged);
  cache.set(key, s);
  return s;
}

/** Стадии стройки: 0 фундамент, 1 каркас, 2 стены, 3 крыша (почти готово) */
function applyStage(s: BuildingSprite, b: Building, stage: number): void {
  const g = ctx2d(s.canvas);
  const W = s.canvas.width;
  const H = s.canvas.height;
  const footH = b.h * TILE;
  const wallH = s.wallH;
  s.lights = [];
  s.chimney = null;
  if (stage >= 3) {
    // крыша: закрыть треть крыши «недостроенной» — снять правый край
    g.clearRect(W * 0.65, 0, W * 0.35, H - wallH - 2);
    g.fillStyle = '#5a3d22';
    for (let x = Math.floor(W * 0.65); x < W; x += 4) g.fillRect(x, 4, 1, H - wallH - 6);
    return;
  }
  g.clearRect(0, 0, W, H);
  // площадка
  g.fillStyle = '#8a7a66';
  g.fillRect(1, H - footH - 2, W - 2, footH + 1);
  g.fillStyle = '#6f6356';
  for (let y = H - footH; y < H; y += 3) g.fillRect(1, y, W - 2, 1);
  if (stage >= 1) {
    // каркас: столбы и балки
    g.fillStyle = '#7a5a3a';
    for (let x = 2; x < W - 2; x += 8) g.fillRect(x, H - wallH - footH + 6, 2, wallH + footH - 7);
    g.fillRect(1, H - wallH - footH + 6, W - 2, 2);
    g.fillRect(1, H - wallH - 2, W - 2, 2);
    for (let x = 6; x < W - 6; x += 16) {
      for (let k = 0; k < 6; k++) g.fillRect(x + k, H - wallH - footH + 8 + k, 1, 1);
    }
  }
  if (stage >= 2) {
    // стены без крыши
    g.fillStyle = rgb(MATERIAL_COLORS[b.material].wall);
    g.fillRect(1, H - wallH, W - 2, wallH - 1);
    g.fillStyle = rgb(MATERIAL_COLORS[b.material].wallDark);
    for (let y = H - wallH + 3; y < H - 1; y += 3) g.fillRect(1, y, W - 2, 1);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(1, H - wallH - footH + 6, W - 2, footH - 6);
  }
  // леса, бочка, доски
  g.fillStyle = '#a07a4a';
  g.fillRect(2, H - 5, 10, 3);
  g.fillRect(W - 12, H - 6, 9, 4);
}

/** Повреждения: 1 — закопчённое и обгоревшее, 2 — руины */
function applyDamage(s: BuildingSprite, b: Building, level: number): void {
  const g = ctx2d(s.canvas);
  const W = s.canvas.width;
  const H = s.canvas.height;
  if (level === 1) {
    g.fillStyle = 'rgba(20,16,12,0.45)';
    g.fillRect(0, 0, W, H);
    // прорехи в крыше
    for (let k = 0; k < 6; k++) {
      const x = (hash2(b.id, k, 11) * (W - 8)) | 0;
      const y = (hash2(b.id, k, 12) * (H - s.wallH - 8)) | 0;
      g.clearRect(x, y, 4 + ((hash2(b.id, k, 13) * 6) | 0), 3 + ((hash2(b.id, k, 14) * 4) | 0));
    }
    s.lights = [];
    return;
  }
  // руины: оставить только низ стен + завалы
  g.clearRect(0, 0, W, H - Math.min(10, s.wallH));
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.fillRect(0, H - Math.min(10, s.wallH), W, Math.min(10, s.wallH));
  const footH = b.h * TILE;
  for (let k = 0; k < b.w * b.h * 3; k++) {
    const x = (hash2(b.id, k, 21) * (W - 6)) | 0;
    const y = H - footH - 6 + ((hash2(b.id, k, 22) * (footH + 2)) | 0);
    const dark = hash2(b.id, k, 23) > 0.5;
    g.fillStyle = dark ? '#3a332c' : '#6a5f52';
    g.fillRect(x, y, 3 + ((hash2(b.id, k, 24) * 5) | 0), 2 + ((hash2(b.id, k, 25) * 3) | 0));
  }
  // обугленные балки
  g.fillStyle = '#1e1a16';
  for (let k = 0; k < 3; k++) {
    const x = 4 + ((hash2(b.id, k, 31) * (W - 10)) | 0);
    g.fillRect(x, H - footH - 8, 2, footH - 2 + ((hash2(b.id, k, 32) * 8) | 0));
  }
  s.lights = [];
  s.chimney = null;
}

function wallHeightFor(b: Building): number {
  switch (b.type) {
    case BuildingType.Castle:
      return 30;
    case BuildingType.Cathedral:
      return 28;
    case BuildingType.TownHall:
      return 22;
    case BuildingType.FireTower:
      return 34;
    case BuildingType.Monastery:
      return 20;
    case BuildingType.Well:
      return 6;
    case BuildingType.Pillory:
      return 2;
    case BuildingType.MarketStall:
      return 8;
    case BuildingType.Mill:
      return 20;
    default:
      return 10 + (b.stories - 1) * 8;
  }
}

function buildSprite(b: Building, snow: boolean): BuildingSprite {
  const T = TILE;
  const wallH = wallHeightFor(b);
  const W = b.w * T;
  const Hfoot = b.h * T;
  const extra = b.type === BuildingType.Cathedral ? 26 : b.type === BuildingType.TownHall ? 16 : b.type === BuildingType.Castle ? 14 : b.type === BuildingType.FireTower ? 10 : 8;
  const SW = W + 2;
  const SH = Hfoot + wallH + extra;
  const cv = makeCanvas(SW, SH);
  const g = ctx2d(cv);
  const ox = -1;
  const oy = -(wallH + extra);
  const sprite: BuildingSprite = { canvas: cv, ox, oy, lights: [], chimney: null, wallH };
  const v = (k: number) => hash2(b.variant, k, b.id);

  // Координаты внутри спрайта: фасад занимает [SH - wallH, SH), крыша — [extra, SH - wallH)
  const facadeY = SH - wallH;
  const roofY0 = extra;
  const roofY1 = facadeY;
  const ctxDraw = { g, b, v, snow, SW, SH, W, wallH, facadeY, roofY0, roofY1, sprite, extra };

  switch (b.type) {
    case BuildingType.Well:
      drawWell(ctxDraw);
      break;
    case BuildingType.Pillory:
      drawPillory(ctxDraw);
      break;
    case BuildingType.MarketStall:
      drawStall(ctxDraw);
      break;
    case BuildingType.Castle:
      drawCastle(ctxDraw);
      break;
    case BuildingType.Cathedral:
      drawCathedral(ctxDraw);
      break;
    case BuildingType.FireTower:
      drawFireTower(ctxDraw);
      break;
    default:
      drawGeneric(ctxDraw);
  }
  return sprite;
}

interface D {
  g: CanvasRenderingContext2D;
  b: Building;
  v: (k: number) => number;
  snow: boolean;
  SW: number;
  SH: number;
  W: number;
  wallH: number;
  facadeY: number;
  roofY0: number;
  roofY1: number;
  sprite: BuildingSprite;
  extra: number;
}

function drawRoof(d: D, x0: number, x1: number, y0: number, y1: number, roof: Building['roof'], style: 'gable' | 'hip' | 'flat' = 'gable', ridgeFrac = 0.42): void {
  const { g, snow } = d;
  const rc = ROOF_COLORS[roof];
  const w = x1 - x0;
  const h = y1 - y0;
  if (h <= 0) return;
  const ridge = y0 + Math.round(h * ridgeFrac);
  // задний скат (темнее)
  g.fillStyle = rgb(rc.dark);
  g.fillRect(x0, y0, w, ridge - y0);
  // передний скат
  g.fillStyle = rgb(rc.light);
  g.fillRect(x0, ridge, w, y1 - ridge);
  // текстура
  if (roof === 'tile' || roof === 'slate') {
    g.fillStyle = rgb(rc.line);
    for (let y = y0 + 2; y < y1; y += 3) {
      const off = ((y - y0) / 3) % 2 === 0 ? 0 : 2;
      for (let x = x0 + off; x < x1; x += 4) g.fillRect(x, y, 1, 1);
      g.fillStyle = y < ridge ? rgb(shade(rc.dark, 0.85)) : rgb(shade(rc.light, 0.85));
      g.fillRect(x0, y + 1, w, 1);
      g.fillStyle = rgb(rc.line);
    }
  } else if (roof === 'thatch') {
    for (let y = y0 + 1; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        const hv = hash2(x, y, d.b.id);
        if (hv > 0.55) {
          g.fillStyle = y < ridge ? rgb(shade(rc.dark, 0.9 + hv * 0.2)) : rgb(shade(rc.light, 0.9 + hv * 0.2));
          g.fillRect(x, y, 2, 1);
        }
      }
    }
  } else {
    // wood: вертикальные доски
    g.fillStyle = rgb(rc.line);
    for (let x = x0 + 3; x < x1; x += 4) g.fillRect(x, y0, 1, h);
  }
  if (style === 'hip') {
    // скосы по бокам: треугольники темнее
    g.fillStyle = rgb(shade(rc.dark, 0.8));
    const k = Math.min(6, Math.floor(w / 4));
    for (let i = 0; i < k; i++) {
      g.fillRect(x0 + i, y0 + i * 2, 1, h - i * 4 > 0 ? h - i * 4 : 1);
      g.fillRect(x1 - 1 - i, y0 + i * 2, 1, h - i * 4 > 0 ? h - i * 4 : 1);
    }
  }
  // конёк
  g.fillStyle = rgb(shade(rc.line, 0.9));
  g.fillRect(x0, ridge, w, 1);
  g.fillStyle = rgb(shade(rc.light, 1.15));
  g.fillRect(x0, ridge + 1, w, 1);
  // карниз
  g.fillStyle = rgb(shade(rc.line, 0.7));
  g.fillRect(x0, y1 - 1, w, 1);
  // снег
  if (snow) {
    g.fillStyle = 'rgba(240,245,250,0.92)';
    g.fillRect(x0, y0, w, Math.max(1, ridge - y0 - 1));
    g.fillStyle = 'rgba(240,245,250,0.75)';
    g.fillRect(x0, ridge + 2, w, Math.max(1, Math.floor((y1 - ridge) * 0.6)));
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let x = x0; x < x1; x += 3) g.fillRect(x, y1 - 2, 2, 1);
  }
}

function drawWallTexture(d: D, x0: number, y0: number, w: number, h: number, material: Building['material'], darkenSides = true): void {
  const { g } = d;
  const mc = MATERIAL_COLORS[material];
  g.fillStyle = rgb(mc.wall);
  g.fillRect(x0, y0, w, h);
  if (material === 'timber') {
    g.fillStyle = rgb(mc.beam);
    g.fillRect(x0, y0, w, 1);
    g.fillRect(x0, y0 + h - 1, w, 1);
    for (let x = x0; x < x0 + w; x += 8) g.fillRect(x, y0, 1, h);
    g.fillRect(x0 + w - 1, y0, 1, h);
    // диагонали
    for (let x = x0 + 8; x < x0 + w - 4; x += 16) {
      for (let k = 0; k < Math.min(h - 2, 6); k++) g.fillRect(x + 1 + k, y0 + 1 + k, 1, 1);
    }
    if (h > 12) {
      g.fillRect(x0, y0 + Math.floor(h / 2), w, 1);
    }
  } else if (material === 'stone') {
    g.fillStyle = rgb(mc.wallDark);
    for (let y = y0 + 2; y < y0 + h; y += 3) {
      g.fillRect(x0, y, w, 1);
      const off = ((y - y0) / 3) % 2 === 0 ? 0 : 3;
      for (let x = x0 + off; x < x0 + w; x += 6) g.fillRect(x, y - 2, 1, 2);
    }
    // неровность
    for (let k = 0; k < (w * h) / 24; k++) {
      const hx = hash2(k, 1, d.b.id);
      const hy = hash2(k, 2, d.b.id);
      g.fillStyle = rgb(shade(mc.wall, 1.1));
      g.fillRect(x0 + ((hx * (w - 2)) | 0), y0 + ((hy * (h - 2)) | 0), 2, 1);
    }
  } else if (material === 'brick') {
    g.fillStyle = rgb(mc.wallDark);
    for (let y = y0 + 1; y < y0 + h; y += 2) {
      const off = ((y - y0 - 1) / 2) % 2 === 0 ? 0 : 2;
      for (let x = x0 + off; x < x0 + w; x += 4) g.fillRect(x, y, 1, 1);
      g.fillRect(x0, y + 1, w, 1);
    }
  } else {
    // wood: горизонтальные доски
    g.fillStyle = rgb(mc.wallDark);
    for (let y = y0 + 2; y < y0 + h; y += 3) g.fillRect(x0, y, w, 1);
    g.fillStyle = rgb(mc.beam);
    g.fillRect(x0, y0, 1, h);
    g.fillRect(x0 + w - 1, y0, 1, h);
  }
  if (darkenSides) {
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(x0, y0, 1, h);
    g.fillRect(x0 + w - 1, y0, 1, h);
    g.fillRect(x0, y0 + h - 1, w, 1);
  }
}

function drawDoor(d: D, x: number, yBottom: number, w = 6, h = 8, arch = true): void {
  const { g } = d;
  g.fillStyle = '#3a2614';
  g.fillRect(x, yBottom - h, w, h);
  g.fillStyle = '#5a3d22';
  g.fillRect(x + 1, yBottom - h + 1, w - 2, h - 1);
  g.fillStyle = '#3a2614';
  g.fillRect(x + Math.floor(w / 2), yBottom - h + 1, 1, h - 1);
  if (arch) {
    g.fillStyle = '#3a2614';
    g.fillRect(x + 1, yBottom - h - 1, w - 2, 1);
  }
  // ручка
  g.fillStyle = '#d9b24a';
  g.fillRect(x + w - 3, yBottom - Math.floor(h / 2), 1, 1);
  // порог
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(x - 1, yBottom - 1, w + 2, 1);
}

function drawWindow(d: D, x: number, y: number, w = 4, h = 5, bars = false): void {
  const { g, sprite } = d;
  g.fillStyle = '#2d2a3a';
  g.fillRect(x, y, w, h);
  g.fillStyle = '#5c6f9a';
  g.fillRect(x + 1, y + 1, w - 2, h - 2);
  g.fillStyle = '#2d2a3a';
  g.fillRect(x + Math.floor(w / 2), y + 1, 1, h - 2);
  if (bars) {
    g.fillRect(x + 1, y + Math.floor(h / 2), w - 2, 1);
  }
  // подоконник
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.fillRect(x, y + h, w, 1);
  sprite.lights.push({ x: x + w / 2 + sprite.ox, y: y + h / 2 + sprite.oy, r: 14, warm: 1 });
}

function drawChimney(d: D, x: number, y: number): void {
  const { g, sprite } = d;
  g.fillStyle = '#6b6560';
  g.fillRect(x, y, 3, 6);
  g.fillStyle = '#4e4945';
  g.fillRect(x - 1, y - 1, 5, 2);
  g.fillStyle = '#8a837c';
  g.fillRect(x + 1, y + 2, 1, 3);
  sprite.chimney = { x: x + 1.5 + sprite.ox, y: y - 1 + sprite.oy };
}

function drawSign(d: D, x: number, y: number, type: BuildingType): void {
  const { g } = d;
  // кронштейн
  g.fillStyle = '#3a2614';
  g.fillRect(x, y, 6, 1);
  g.fillRect(x + 5, y, 1, 2);
  // доска
  let col: RGB = hex('#c9a95a');
  let sym: RGB = hex('#5a3d22');
  switch (type) {
    case BuildingType.Tavern:
      col = hex('#8a3a2a');
      sym = hex('#e8c860');
      break;
    case BuildingType.Bakery:
      col = hex('#d9b24a');
      sym = hex('#7a4a1a');
      break;
    case BuildingType.Butcher:
      col = hex('#b03030');
      sym = hex('#f0d0c0');
      break;
    case BuildingType.Smithy:
      col = hex('#444');
      sym = hex('#d0d0d0');
      break;
    case BuildingType.Merchant:
    case BuildingType.Warehouse:
      col = hex('#2a6a8a');
      sym = hex('#e8d890');
      break;
    case BuildingType.Carpenter:
    case BuildingType.Sawmill:
      col = hex('#8a6a3a');
      sym = hex('#f0e0b0');
      break;
    case BuildingType.Tannery:
      col = hex('#7a5a3a');
      sym = hex('#e0c090');
      break;
    case BuildingType.Mason:
      col = hex('#777');
      sym = hex('#eee');
      break;
    default:
      break;
  }
  g.fillStyle = rgb(col);
  g.fillRect(x + 2, y + 2, 7, 6);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(x + 2, y + 2, 7, 1);
  g.fillStyle = rgb(sym);
  g.fillRect(x + 4, y + 4, 3, 2);
  if (type === BuildingType.Tavern) g.fillRect(x + 7, y + 4, 1, 2);
}

function drawGeneric(d: D): void {
  const { g, b, v, SW, SH, W, wallH, facadeY, roofY0, roofY1, snow } = d;
  const x0 = 1;
  const x1 = 1 + W;
  // Специальные: мельница — каменный низ, деревянный верх
  const mat = b.material;
  // Тень под зданием (на земле)
  g.fillStyle = 'rgba(0,0,0,0.15)';
  g.fillRect(0, SH - 2, SW, 2);
  // Фасад
  drawWallTexture(d, x0, facadeY, W, wallH, mat);
  if (b.type === BuildingType.Mill) {
    drawWallTexture(d, x0, facadeY, W, Math.floor(wallH / 2), 'wood');
  }
  // Крыша
  const style: 'gable' | 'hip' = b.w >= 5 && v(1) > 0.5 ? 'hip' : 'gable';
  drawRoof(d, x0 - 1, x1 + 1, roofY0 + 2, roofY1, b.roof, style, b.roof === 'thatch' ? 0.38 : 0.42);
  // Слуховое окно / башенка для 2-этажных
  if (b.stories >= 2 && v(2) > 0.5) {
    const dx = x0 + 4 + Math.floor(v(3) * (W - 12));
    const dy = roofY1 - 8;
    g.fillStyle = rgb(MATERIAL_COLORS[mat].wall);
    g.fillRect(dx, dy, 6, 6);
    g.fillStyle = rgb(ROOF_COLORS[b.roof].dark);
    g.fillRect(dx - 1, dy - 2, 8, 2);
    drawWindow(d, dx + 1, dy + 1, 4, 4);
  }
  // Труба
  if (b.type !== BuildingType.Stable && b.type !== BuildingType.Warehouse) {
    const cx = x0 + 3 + Math.floor(v(4) * (W - 8));
    drawChimney(d, cx, roofY0 + 1);
    if (b.type === BuildingType.Smithy || b.type === BuildingType.Bakery) {
      // большая труба
      g.fillStyle = '#5a5550';
      g.fillRect(cx - 1, roofY0, 5, 8);
      g.fillStyle = '#3e3a37';
      g.fillRect(cx - 2, roofY0 - 1, 7, 2);
    }
  }
  // Дверь: в столбце doorX
  const doorCol = b.doorX - b.x;
  const doorX = x0 + doorCol * TILE + 5;
  const doorW = b.type === BuildingType.Tavern || b.type === BuildingType.Stable || b.type === BuildingType.Barracks || b.type === BuildingType.Warehouse ? 8 : 6;
  const doorH = Math.min(wallH - 1, 8 + (b.stories - 1) * 1);
  if (b.type === BuildingType.Smithy) {
    // открытый проём с горном
    g.fillStyle = '#1e1612';
    g.fillRect(doorX - 2, facadeY + 1, 10, wallH - 1);
    g.fillStyle = '#ff7a1a';
    g.fillRect(doorX + 1, SH - 4, 4, 2);
    g.fillStyle = '#ffd060';
    g.fillRect(doorX + 2, SH - 4, 2, 1);
    d.sprite.lights.push({ x: doorX + 3 + d.sprite.ox, y: SH - 4 + d.sprite.oy, r: 20, warm: 1.5 });
  } else {
    drawDoor(d, doorX, SH - 1, doorW, doorH, mat === 'stone' || mat === 'brick');
  }
  // Окна
  const rows = b.stories;
  for (let r = 0; r < rows; r++) {
    const wy = facadeY + 2 + r * 8;
    for (let c = 0; c < b.w; c++) {
      if (c === doorCol && r === rows - 1) continue;
      if (hash2(c, r, b.variant) < 0.25 && b.w > 2) continue;
      const wx = x0 + c * TILE + 6;
      drawWindow(d, wx, wy, 4, 5, b.type === BuildingType.Prison);
    }
  }
  // Вывеска
  if (isShop(b.type)) drawSign(d, doorX + doorW + 1, facadeY + 1, b.type);
  // Крест у часовни/монастыря
  if (b.type === BuildingType.Chapel || b.type === BuildingType.Monastery) {
    const cx = x0 + Math.floor(W / 2);
    g.fillStyle = '#e8e0c8';
    g.fillRect(cx, roofY0 - 4, 1, 7);
    g.fillRect(cx - 1, roofY0 - 2, 3, 1);
  }
  // Флаг у казармы/ратуши
  if (b.type === BuildingType.Barracks || b.type === BuildingType.Manor) {
    const fx = x0 + 3;
    g.fillStyle = '#5a3d22';
    g.fillRect(fx, roofY0 - 5, 1, 9);
    g.fillStyle = b.type === BuildingType.Barracks ? '#b02020' : '#2a4a9a';
    g.fillRect(fx + 1, roofY0 - 5, 5, 3);
  }
  // Бочки у таверны
  if (b.type === BuildingType.Tavern) {
    const bx = x0 + 1;
    g.fillStyle = '#7a5a3a';
    g.fillRect(bx, SH - 6, 4, 5);
    g.fillStyle = '#4a3a2a';
    g.fillRect(bx, SH - 5, 4, 1);
    g.fillRect(bx, SH - 3, 4, 1);
  }
  // Мельница: окно на крыше
  if (b.type === BuildingType.Mill) {
    g.fillStyle = '#5a3d22';
    g.fillRect(x0 + 2, roofY0 + 2, 3, 3);
  }
  void snow;
}

function isShop(t: BuildingType): boolean {
  return (
    t === BuildingType.Tavern ||
    t === BuildingType.Bakery ||
    t === BuildingType.Butcher ||
    t === BuildingType.Smithy ||
    t === BuildingType.Merchant ||
    t === BuildingType.Carpenter ||
    t === BuildingType.Tannery ||
    t === BuildingType.Mason ||
    t === BuildingType.Warehouse ||
    t === BuildingType.Sawmill
  );
}

function drawCastle(d: D): void {
  const { g, b, SW, SH, W, wallH, facadeY, roofY0, snow } = d;
  const x0 = 1;
  g.fillStyle = 'rgba(0,0,0,0.15)';
  g.fillRect(0, SH - 2, SW, 2);
  // Основной корпус
  drawWallTexture(d, x0, facadeY, W, wallH, 'stone');
  // Крыша: плоская площадка с зубцами + донжон
  const topY = roofY0 + 4;
  g.fillStyle = rgb(MATERIAL_COLORS.stone.wallDark);
  g.fillRect(x0, topY, W, facadeY - topY);
  g.fillStyle = rgb(shade(MATERIAL_COLORS.stone.wall, 0.95));
  g.fillRect(x0 + 2, topY + 2, W - 4, facadeY - topY - 4);
  // зубцы
  g.fillStyle = rgb(MATERIAL_COLORS.stone.wall);
  for (let x = x0; x < x0 + W; x += 4) g.fillRect(x, topY - 3, 2, 3);
  g.fillStyle = rgb(shade(MATERIAL_COLORS.stone.wall, 0.8));
  for (let x = x0; x < x0 + W; x += 4) g.fillRect(x, facadeY - 3, 2, 3);
  // донжон
  const kw = Math.floor(W * 0.36);
  const kx = x0 + Math.floor((W - kw) / 2);
  const kh = Math.floor((facadeY - topY) * 0.7) + 14;
  const ky = topY + Math.floor((facadeY - topY) * 0.15);
  drawWallTexture(d, kx, ky, kw, kh, 'stone');
  g.fillStyle = rgb(ROOF_COLORS.slate.dark);
  g.fillRect(kx - 1, ky - 5, kw + 2, 5);
  g.fillStyle = rgb(ROOF_COLORS.slate.light);
  g.fillRect(kx - 1, ky - 3, kw + 2, 2);
  for (let x = kx - 1; x < kx + kw + 1; x += 3) {
    g.fillStyle = rgb(MATERIAL_COLORS.stone.wall);
    g.fillRect(x, ky - 7, 2, 2);
  }
  drawWindow(d, kx + 3, ky + 4, 4, 6);
  drawWindow(d, kx + kw - 7, ky + 4, 4, 6);
  if (kw > 24) drawWindow(d, kx + Math.floor(kw / 2) - 2, ky + 4, 4, 6);
  // флаг
  g.fillStyle = '#3a2614';
  g.fillRect(kx + Math.floor(kw / 2), ky - 14, 1, 8);
  g.fillStyle = '#b02020';
  g.fillRect(kx + Math.floor(kw / 2) + 1, ky - 14, 6, 4);
  g.fillStyle = '#e8c860';
  g.fillRect(kx + Math.floor(kw / 2) + 3, ky - 13, 2, 2);
  // угловые башни
  for (const tx of [x0 - 1, x0 + W - 9]) {
    const th = wallH + 14;
    const ty = SH - th;
    drawWallTexture(d, tx, ty, 10, th, 'stone');
    g.fillStyle = rgb(ROOF_COLORS.slate.dark);
    g.fillRect(tx - 1, ty - 2, 12, 3);
    for (let k = 0; k < 5; k++) {
      g.fillStyle = rgb(k % 2 ? ROOF_COLORS.slate.dark : ROOF_COLORS.slate.light);
      g.fillRect(tx + k, ty - 3 - k * 2, 10 - k * 2, 2);
    }
    drawWindow(d, tx + 3, ty + 6, 3, 5, true);
    drawWindow(d, tx + 3, ty + 16, 3, 5, true);
  }
  // ворота
  const doorCol = b.doorX - b.x;
  const dx = x0 + doorCol * TILE + 2;
  g.fillStyle = '#2a1a0e';
  g.fillRect(dx, SH - 14, 12, 13);
  g.fillStyle = '#5a3d22';
  g.fillRect(dx + 1, SH - 13, 10, 12);
  g.fillStyle = '#2a1a0e';
  for (let y = SH - 12; y < SH - 1; y += 3) g.fillRect(dx + 1, y, 10, 1);
  for (let x = dx + 3; x < dx + 12; x += 3) g.fillRect(x, SH - 13, 1, 12);
  // окна по фасаду
  for (let c = 1; c < b.w - 1; c++) {
    if (c === doorCol || c === doorCol + 1) continue;
    drawWindow(d, x0 + c * TILE + 6, facadeY + 6, 4, 6, true);
  }
  if (snow) {
    g.fillStyle = 'rgba(240,245,250,0.85)';
    g.fillRect(x0 + 2, topY + 2, W - 4, 3);
  }
}

function drawCathedral(d: D): void {
  const { g, b, SW, SH, W, wallH, facadeY, roofY0, roofY1, snow } = d;
  const x0 = 1;
  g.fillStyle = 'rgba(0,0,0,0.15)';
  g.fillRect(0, SH - 2, SW, 2);
  drawWallTexture(d, x0, facadeY, W, wallH, 'stone');
  // крутая крыша
  drawRoof(d, x0 - 1, x0 + W + 1, roofY0 + 6, roofY1, 'slate', 'gable', 0.5);
  // контрфорсы
  g.fillStyle = rgb(MATERIAL_COLORS.stone.wallDark);
  for (let x = x0 + 8; x < x0 + W - 4; x += 16) g.fillRect(x, facadeY, 2, wallH);
  // колокольня слева
  const tw = 18;
  const tx = x0 + 4;
  const th = wallH + (roofY1 - roofY0) + 14;
  const ty = SH - th;
  drawWallTexture(d, tx, ty, tw, th, 'stone');
  // шпиль
  for (let k = 0; k < 12; k++) {
    g.fillStyle = rgb(k % 2 ? ROOF_COLORS.slate.dark : ROOF_COLORS.slate.light);
    const ww = tw + 2 - Math.floor((k * (tw + 2)) / 12);
    g.fillRect(tx - 1 + Math.floor((tw + 2 - ww) / 2), ty - 2 - k, ww, 1);
  }
  g.fillStyle = '#e8d890';
  g.fillRect(tx + Math.floor(tw / 2), ty - 20, 1, 7);
  g.fillRect(tx + Math.floor(tw / 2) - 1, ty - 18, 3, 1);
  // колокол
  g.fillStyle = '#1e1a16';
  g.fillRect(tx + 6, ty + 6, 6, 8);
  g.fillStyle = '#c9a240';
  g.fillRect(tx + 8, ty + 9, 2, 3);
  drawWindow(d, tx + 7, ty + 22, 4, 8);
  // розетка
  const rx = x0 + Math.floor(W * 0.62);
  g.fillStyle = '#2d2a3a';
  g.fillRect(rx - 5, facadeY + 3, 10, 10);
  g.fillStyle = '#9a4a7a';
  g.fillRect(rx - 4, facadeY + 4, 8, 8);
  g.fillStyle = '#d9b24a';
  g.fillRect(rx - 1, facadeY + 4, 2, 8);
  g.fillRect(rx - 4, facadeY + 7, 8, 2);
  d.sprite.lights.push({ x: rx + d.sprite.ox, y: facadeY + 8 + d.sprite.oy, r: 16, warm: 0.6 });
  // большой вход
  const doorCol = b.doorX - b.x;
  const dx = x0 + doorCol * TILE + 3;
  drawDoor(d, dx, SH - 1, 10, 14, true);
  // окна-стрельчатые
  for (let c = 2; c < b.w; c++) {
    if (c === doorCol) continue;
    drawWindow(d, x0 + c * TILE + 6, facadeY + 16, 4, 8);
  }
  if (snow) {
    g.fillStyle = 'rgba(240,245,250,0.6)';
    g.fillRect(tx, ty - 1, tw, 2);
  }
}

function drawFireTower(d: D): void {
  const { g, b, SW, SH, W, wallH } = d;
  const x0 = 1;
  g.fillStyle = 'rgba(0,0,0,0.15)';
  g.fillRect(0, SH - 2, SW, 2);
  // каркас
  const h = wallH + 10;
  const y0 = SH - h;
  g.fillStyle = '#5a3d22';
  g.fillRect(x0 + 2, y0, 3, h);
  g.fillRect(x0 + W - 5, y0, 3, h);
  g.fillStyle = '#7a5a3a';
  for (let y = y0 + 4; y < SH; y += 6) g.fillRect(x0 + 3, y, W - 6, 2);
  // диагонали
  g.fillStyle = '#4a3220';
  for (let y = y0 + 6; y < SH - 6; y += 12) {
    for (let k = 0; k < Math.min(W - 8, 8); k++) g.fillRect(x0 + 4 + k, y + k, 1, 1);
  }
  // площадка с крышей
  g.fillStyle = '#6a4a2a';
  g.fillRect(x0, y0 - 2, W + 2, 3);
  g.fillStyle = rgb(ROOF_COLORS.wood.dark);
  g.fillRect(x0 - 1, y0 - 8, W + 4, 3);
  g.fillStyle = rgb(ROOF_COLORS.wood.light);
  g.fillRect(x0 + 1, y0 - 10, W - 2, 2);
  // колокол
  g.fillStyle = '#c9a240';
  g.fillRect(x0 + Math.floor(W / 2) - 2, y0 - 6, 4, 4);
  g.fillStyle = '#8a6a20';
  g.fillRect(x0 + Math.floor(W / 2) - 1, y0 - 2, 2, 1);
  // вёдра
  g.fillStyle = '#8a7a6a';
  g.fillRect(x0 + 3, SH - 5, 3, 4);
  g.fillRect(x0 + 8, SH - 5, 3, 4);
  d.sprite.lights.push({ x: x0 + W / 2 + d.sprite.ox, y: y0 - 5 + d.sprite.oy, r: 12, warm: 1 });
  void b;
}

function drawWell(d: D): void {
  const { g, SH } = d;
  // каменное кольцо
  g.fillStyle = '#6f6a62';
  g.fillRect(2, SH - 7, 13, 6);
  g.fillStyle = '#8f8a80';
  g.fillRect(3, SH - 7, 11, 1);
  g.fillStyle = '#2a3a5a';
  g.fillRect(5, SH - 6, 7, 3);
  // стойки и крыша
  g.fillStyle = '#5a3d22';
  g.fillRect(3, SH - 16, 1, 10);
  g.fillRect(13, SH - 16, 1, 10);
  g.fillStyle = rgb(ROOF_COLORS.wood.dark);
  g.fillRect(1, SH - 19, 15, 3);
  g.fillStyle = rgb(ROOF_COLORS.wood.light);
  g.fillRect(2, SH - 18, 13, 1);
  g.fillStyle = '#8a7a6a';
  g.fillRect(7, SH - 14, 3, 3);
}

function drawPillory(d: D): void {
  const { g, SH } = d;
  g.fillStyle = '#5a3d22';
  g.fillRect(7, SH - 14, 2, 13);
  g.fillStyle = '#7a5a3a';
  g.fillRect(3, SH - 12, 10, 4);
  g.fillStyle = '#2a1a0e';
  g.fillRect(5, SH - 11, 2, 2);
  g.fillRect(9, SH - 11, 2, 2);
}

function drawStall(d: D): void {
  const { g, b, SH, W } = d;
  const x0 = 1;
  const cols: [string, string][] = [
    ['#c03030', '#f0f0f0'],
    ['#2a6a9a', '#f0f0f0'],
    ['#3a8a3a', '#f0f0f0'],
    ['#c08020', '#f0f0f0'],
  ];
  const [c1, c2] = cols[b.variant % cols.length];
  // прилавок
  g.fillStyle = '#7a5a3a';
  g.fillRect(x0, SH - 7, W, 6);
  g.fillStyle = '#5a3d22';
  g.fillRect(x0, SH - 3, W, 1);
  // товары
  const goods = ['#d9b24a', '#c04040', '#8ab040', '#e0e0e0', '#a06030'];
  for (let k = 0; k < Math.floor(W / 5); k++) {
    g.fillStyle = goods[(b.variant + k) % goods.length];
    g.fillRect(x0 + 2 + k * 5, SH - 10, 3, 3);
  }
  // стойки
  g.fillStyle = '#5a3d22';
  g.fillRect(x0 + 1, SH - 20, 1, 13);
  g.fillRect(x0 + W - 2, SH - 20, 1, 13);
  // навес полосатый
  for (let x = 0; x < W + 2; x += 3) {
    g.fillStyle = Math.floor(x / 3) % 2 === 0 ? c1 : c2;
    g.fillRect(x, SH - 24, 3, 5);
  }
  g.fillStyle = 'rgba(0,0,0,0.2)';
  g.fillRect(0, SH - 19, W + 2, 1);
}

export { mix };
