// Процедурная генерация города Вальдмарк по сиду.
import { RNG, hashString } from '../core/rng';
import { Noise2D } from '../core/noise';
import { Tile, TILE_INFO } from './tiles';
import { Building, BuildingType, BUILDING_DEFS, District, Material, Roof } from './buildings';
import { World, Prop, PropType, Gate, idx, inBounds, isRoadTile, tileAt, setTile, isWalkableAt } from './world';

export type CitySize = 'small' | 'medium' | 'large';
export const CITY_SIZES: Record<CitySize, { tiles: number; name: string }> = {
  small: { tiles: 128, name: 'Малый' },
  medium: { tiles: 160, name: 'Средний' },
  large: { tiles: 192, name: 'Большой' },
};

const TAVERN_NAMES = [
  'Пьяный кабан', 'Золотой гусь', 'Три подковы', 'Хромая утка', 'Старый дуб', 'Весёлый мельник',
  'Красный петух', 'Серебряная кружка', 'Королевский олень', 'Под вязом', 'Сытый кот', 'Чёрный ворон',
  'Бочка и пила', 'Жареный фазан', 'Приют странника', 'Полная чаша',
];
const GATE_NAMES = ['Восточные ворота', 'Южные ворота', 'Речные ворота', 'Северные ворота'];

interface Ctx {
  world: World;
  rng: RNG;
  noise: Noise2D;
  W: number;
  H: number;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Множитель радиуса границы по углу */
  boundary: (ang: number) => number;
  nextBuildingId: number;
  /** Запрещённые для застройки тайлы (дороги/площадь/резерв) */
  reserved: Uint8Array;
}

export function generateWorld(seedText: string, size: CitySize = 'medium'): World {
  const seed = hashString(seedText || 'Вальдмарк');
  const rng = new RNG(seed);
  const noise = new Noise2D(seed ^ 0x5bd1e995);
  const W = CITY_SIZES[size].tiles;
  const H = W;
  const n = W * H;
  const world: World = {
    w: W,
    h: H,
    seed,
    seedText,
    sizeName: CITY_SIZES[size].name,
    tiles: new Uint8Array(n),
    height: new Float32Array(n),
    district: new Uint8Array(n).fill(District.Outskirts),
    inside: new Uint8Array(n),
    buildingAt: new Int16Array(n).fill(-1),
    solidProp: new Int16Array(n).fill(-1),
    buildings: [],
    props: [],
    poi: {
      cx: 0,
      cy: 0,
      square: { x: 0, y: 0, w: 0, h: 0 },
      wellX: 0,
      wellY: 0,
      gates: [],
      bridge: { x: 0, y: 0 },
      benches: [],
      strollSpots: [],
      castleHill: { x: 0, y: 0, r: 0 },
      riverCenterX: [],
    },
    wind: { dir: rng.float(0, Math.PI * 2), strength: rng.float(0.2, 0.6) },
  };
  world.tiles.fill(Tile.Grass);

  const ctx: Ctx = {
    world,
    rng,
    noise,
    W,
    H,
    cx: 0,
    cy: 0,
    rx: 0,
    ry: 0,
    boundary: () => 1,
    nextBuildingId: 0,
    reserved: new Uint8Array(n),
  };

  genTerrain(ctx);
  genRiver(ctx);
  placeCity(ctx);
  genWalls(ctx);
  genSquare(ctx);
  genRoads(ctx);
  genDistricts(ctx);
  genHill(ctx);
  placeUniqueBuildings(ctx);
  fillCityBuildings(ctx);
  genOutskirts(ctx);
  connectDoors(ctx);
  genGardensAndProps(ctx);
  finalizeConnectivity(ctx);
  collectPOI(ctx);
  return world;
}

// ---------------------------------------------------------------- Террейн

function genTerrain(ctx: Ctx): void {
  const { world, noise, W, H } = ctx;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = noise.fbm(x / 23, y / 23, 3);
      const i = y * W + x;
      if (v > 0.62) world.tiles[i] = Tile.Meadow;
      world.height[i] = 0;
    }
  }
}

// ---------------------------------------------------------------- Река

function genRiver(ctx: Ctx): void {
  const { world, rng, noise, W, H } = ctx;
  const x0 = W * rng.float(0.2, 0.3);
  const a1 = rng.float(4, 8);
  const l1 = rng.float(28, 46);
  const p1 = rng.float(0, Math.PI * 2);
  const a2 = rng.float(1.5, 3.5);
  const l2 = rng.float(9, 16);
  const p2 = rng.float(0, Math.PI * 2);
  const centers: number[] = [];
  for (let y = 0; y < H; y++) {
    const cxr = x0 + a1 * Math.sin(y / l1 + p1) + a2 * Math.sin(y / l2 + p2) + (noise.value(y / 7, 3.3) - 0.5) * 3;
    centers.push(cxr);
    const width = 2.2 + 0.9 * Math.sin(y / 19 + p2) + noise.value(y / 11, 9.1) * 1.2;
    for (let x = 0; x < W; x++) {
      const d = Math.abs(x + 0.5 - cxr);
      if (d < width) setTile(world, x, y, Tile.Water);
      else if (d < width + 1.1) setTile(world, x, y, Tile.Sand);
    }
  }
  world.poi.riverCenterX = centers;
}

// ---------------------------------------------------------------- Положение города

function placeCity(ctx: Ctx): void {
  const { world, rng, noise, W, H } = ctx;
  const rx = Math.round(W * 0.215);
  const ry = Math.round(H * 0.235);
  let cy = Math.round(H * 0.5 + rng.float(-4, 4));
  let cx = Math.round(W * 0.58);
  // Река не должна пересекать стены
  let riverMax = 0;
  for (let y = cy - ry - 4; y <= cy + ry + 4; y++) {
    const c = world.poi.riverCenterX[Math.max(0, Math.min(H - 1, y))] + 5;
    if (c > riverMax) riverMax = c;
  }
  cx = Math.max(cx, Math.round(riverMax + rx + 7));
  cx = Math.min(cx, W - rx - 10);
  ctx.cx = cx;
  ctx.cy = cy;
  ctx.rx = rx;
  ctx.ry = ry;
  const seedOff = rng.float(0, 100);
  ctx.boundary = (ang: number) => {
    const nx = Math.cos(ang) * 1.7 + seedOff;
    const ny = Math.sin(ang) * 1.7 + seedOff;
    return 1 + (noise.fbm(nx, ny, 2) - 0.5) * 0.14;
  };
  // Маска «внутри стен»
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const rho = Math.sqrt(dx * dx + dy * dy);
      const ang = Math.atan2(dy, dx);
      if (rho < ctx.boundary(ang)) world.inside[y * W + x] = 1;
    }
  }
}

function rhoOf(ctx: Ctx, x: number, y: number): number {
  const dx = (x + 0.5 - ctx.cx) / ctx.rx;
  const dy = (y + 0.5 - ctx.cy) / ctx.ry;
  return Math.sqrt(dx * dx + dy * dy) / ctx.boundary(Math.atan2(dy, dx));
}

function angOf(ctx: Ctx, x: number, y: number): number {
  return Math.atan2((y + 0.5 - ctx.cy) / ctx.ry, (x + 0.5 - ctx.cx) / ctx.rx);
}

// ---------------------------------------------------------------- Стены и ворота

function genWalls(ctx: Ctx): void {
  const { world, W, H, cx, cy } = ctx;
  const wallTiles: number[] = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!world.inside[i]) continue;
      let edge = false;
      for (let dy = -1; dy <= 1 && !edge; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!world.inside[(y + dy) * W + (x + dx)]) {
            edge = true;
            break;
          }
        }
      if (edge) wallTiles.push(i);
    }
  }
  for (const i of wallTiles) {
    world.tiles[i] = Tile.Wall;
    ctx.reserved[i] = 1;
  }
  // Башни — примерно каждые 11 тайлов вдоль стены
  let count = 0;
  const towerEvery = 11;
  // идём по углу
  const steps = 720;
  let lastTowerAt = -999;
  for (let s = 0; s < steps; s++) {
    const ang = (s / steps) * Math.PI * 2;
    // найти тайл стены вдоль луча
    const r = ctx.boundary(ang);
    const tx = Math.floor(cx + Math.cos(ang) * ctx.rx * r);
    const ty = Math.floor(cy + Math.sin(ang) * ctx.ry * r);
    let found = -1;
    for (let dy = -2; dy <= 2 && found < 0; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const xx = tx + dx;
        const yy = ty + dy;
        if (inBounds(world, xx, yy) && world.tiles[yy * W + xx] === Tile.Wall) {
          found = yy * W + xx;
          break;
        }
      }
    if (found < 0) continue;
    const arcLen = (s / steps) * Math.PI * (ctx.rx + ctx.ry);
    if (arcLen - lastTowerAt >= towerEvery) {
      world.tiles[found] = Tile.Tower;
      lastTowerAt = arcLen;
      count++;
    }
  }
  void count;
  // Ворота по 4 сторонам
  const dirs: { dir: 0 | 1 | 2 | 3; ang: number }[] = [
    { dir: 0, ang: 0 },
    { dir: 1, ang: Math.PI / 2 },
    { dir: 2, ang: Math.PI },
    { dir: 3, ang: -Math.PI / 2 },
  ];
  for (const g of dirs) {
    const dx = Math.cos(g.ang);
    const dy = Math.sin(g.ang);
    let gx = cx;
    let gy = cy;
    for (let t = 0; t < Math.max(ctx.rx, ctx.ry) * 1.3; t += 0.5) {
      const x = Math.floor(cx + dx * t);
      const y = Math.floor(cy + dy * t);
      const tt = tileAt(world, x, y);
      if (tt === Tile.Wall || tt === Tile.Tower) {
        gx = x;
        gy = y;
        break;
      }
    }
    // Проём 2 тайла шириной, 3 глубиной
    const horizontal = g.dir === 0 || g.dir === 2;
    for (let a = -1; a <= 1; a++) {
      for (let b = 0; b <= 1; b++) {
        const x = horizontal ? gx + a : gx + b;
        const y = horizontal ? gy + b : gy + a;
        const tt = tileAt(world, x, y);
        if (tt === Tile.Wall || tt === Tile.Tower) setTile(world, x, y, Tile.Gate);
      }
    }
    // Башни по бокам
    for (const side of [-1, 2]) {
      for (let a = -1; a <= 1; a++) {
        const x = horizontal ? gx + a : gx + side;
        const y = horizontal ? gy + side : gy + a;
        const tt = tileAt(world, x, y);
        if (tt === Tile.Wall) setTile(world, x, y, Tile.Tower);
      }
    }
    const gate: Gate = {
      x: horizontal ? gx : gx,
      y: horizontal ? gy : gy,
      dir: g.dir,
      name: GATE_NAMES[g.dir],
    };
    world.poi.gates.push(gate);
  }
}

// ---------------------------------------------------------------- Площадь

function genSquare(ctx: Ctx): void {
  const { world, cx, cy } = ctx;
  const sw = 15;
  const sh = 11;
  const sx = cx - Math.floor(sw / 2);
  const sy = cy - Math.floor(sh / 2);
  world.poi.square = { x: sx, y: sy, w: sw, h: sh };
  world.poi.cx = cx;
  world.poi.cy = cy;
  for (let y = sy; y < sy + sh; y++)
    for (let x = sx; x < sx + sw; x++) {
      setTile(world, x, y, Tile.Plaza);
      ctx.reserved[idx(world, x, y)] = 1;
    }
  world.poi.wellX = cx;
  world.poi.wellY = cy;
}

// ---------------------------------------------------------------- Дороги

function carveTile(ctx: Ctx, x: number, y: number, t: Tile, overwriteBuildings = false): void {
  const { world } = ctx;
  if (!inBounds(world, x, y)) return;
  const i = idx(world, x, y);
  const cur = world.tiles[i] as Tile;
  if (cur === Tile.Water || cur === Tile.Shallow) {
    if (t === Tile.Bridge) world.tiles[i] = Tile.Bridge;
    return;
  }
  if (cur === Tile.Wall || cur === Tile.Tower) return;
  if (cur === Tile.Plaza || cur === Tile.Gate || cur === Tile.Bridge) return;
  if (cur === Tile.Road && t === Tile.Dirt) return;
  if (world.buildingAt[i] >= 0 && !overwriteBuildings) return;
  world.tiles[i] = t;
  ctx.reserved[i] = 1;
}

/** Линия с сохранением 4-связности, ширина 1 или 2 */
function carveLine(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, width: number, t: Tile): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const ex = Math.round(x1);
  const ey = Math.round(y1);
  const dx = Math.abs(ex - x);
  const dy = Math.abs(ey - y);
  const sx = x < ex ? 1 : -1;
  const sy = y < ey ? 1 : -1;
  let err = dx - dy;
  const stamp = (px: number, py: number) => {
    for (let a = 0; a < width; a++) for (let b = 0; b < width; b++) carveTile(ctx, px + a, py + b, t);
  };
  for (let guard = 0; guard < 4000; guard++) {
    stamp(x, y);
    if (x === ex && y === ey) break;
    const e2 = 2 * err;
    let moved = false;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
      moved = true;
    }
    if (e2 < dx) {
      if (moved) stamp(x, y); // промежуточный тайл при диагональном шаге
      err += dx;
      y += sy;
    }
  }
}

/** Линия только по тайлам внутри стен */
function carveLineInside(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, t: Tile): void {
  const { world } = ctx;
  let x = Math.round(x0);
  let y = Math.round(y0);
  const ex = Math.round(x1);
  const ey = Math.round(y1);
  const dx = Math.abs(ex - x);
  const dy = Math.abs(ey - y);
  const sx = x < ex ? 1 : -1;
  const sy = y < ey ? 1 : -1;
  let err = dx - dy;
  const stamp = (px: number, py: number) => {
    if (!inBounds(world, px, py) || !world.inside[idx(world, px, py)]) return;
    carveTile(ctx, px, py, t);
  };
  for (let guard = 0; guard < 4000; guard++) {
    stamp(x, y);
    if (x === ex && y === ey) break;
    const e2 = 2 * err;
    let moved = false;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
      moved = true;
    }
    if (e2 < dx) {
      if (moved) stamp(x, y);
      err += dx;
      y += sy;
    }
  }
}

function carvePolyline(ctx: Ctx, pts: { x: number; y: number }[], width: number, t: Tile): void {
  for (let i = 0; i + 1 < pts.length; i++) carveLine(ctx, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, width, t);
}

function genRoads(ctx: Ctx): void {
  const { world, rng, cx, cy, rx, ry, W, H } = ctx;
  const sq = world.poi.square;

  // Кольцевая дорога вдоль стены (внутри)
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!world.inside[i] || world.tiles[i] === Tile.Wall || world.tiles[i] === Tile.Tower) continue;
      const t = world.tiles[i];
      if (t === Tile.Gate) continue;
      let nearWall = false;
      for (let d = 0; d < 4 && !nearWall; d++) {
        const nx = x + [1, -1, 0, 0][d];
        const ny = y + [0, 0, 1, -1][d];
        const nt = world.tiles[ny * W + nx];
        if (nt === Tile.Wall || nt === Tile.Tower || nt === Tile.Gate) nearWall = true;
      }
      if (nearWall) carveTile(ctx, x, y, Tile.Road);
    }

  // Главные дороги: от площади до ворот и дальше наружу
  for (const g of world.poi.gates) {
    const horizontal = g.dir === 0 || g.dir === 2;
    if (horizontal) {
      const fromX = g.dir === 0 ? sq.x + sq.w : sq.x - 1;
      carveLine(ctx, fromX, cy, g.x, cy, 2, Tile.Road);
      // наружу
      const dir = g.dir === 0 ? 1 : -1;
      const pts: { x: number; y: number }[] = [{ x: g.x, y: cy }];
      let x = g.x;
      let y = cy;
      const endX = g.dir === 0 ? W - 1 : 0;
      while (dir > 0 ? x < endX : x > endX) {
        const step = Math.min(Math.abs(endX - x), rng.int(7, 13));
        x += step * dir;
        if (Math.abs(x - endX) > 4) y += rng.int(-2, 2);
        pts.push({ x, y });
      }
      carvePolyline(ctx, pts, 2, Tile.Dirt);
    } else {
      const fromY = g.dir === 1 ? sq.y + sq.h : sq.y - 1;
      carveLine(ctx, cx, fromY, cx, g.y, 2, Tile.Road);
      const dir = g.dir === 1 ? 1 : -1;
      const pts: { x: number; y: number }[] = [{ x: cx, y: g.y }];
      let x = cx;
      let y = g.y;
      const endY = g.dir === 1 ? H - 1 : 0;
      while (dir > 0 ? y < endY : y > endY) {
        const step = Math.min(Math.abs(endY - y), rng.int(7, 13));
        y += step * dir;
        if (Math.abs(y - endY) > 4) x += rng.int(-2, 2);
        pts.push({ x, y });
      }
      carvePolyline(ctx, pts, 2, Tile.Dirt);
    }
  }

  // Мост через реку на западной дороге
  {
    const g = world.poi.gates.find((q) => q.dir === 2)!;
    // Западная дорога идёт по строкам cy, cy+1 от ворот до реки; найдём, где пересекает воду
    // Проложим ровный участок дороги до реки и мост
    const riverC = world.poi.riverCenterX[cy];
    let bridgeStart = -1;
    for (let x = g.x; x > 0; x--) {
      const t = tileAt(world, x, cy);
      if (t === Tile.Water || t === Tile.Bridge) {
        bridgeStart = x;
        break;
      }
    }
    if (bridgeStart < 0) bridgeStart = Math.round(riverC + 4);
    // Выровнять дорогу до моста по строкам cy, cy+1
    for (let x = Math.round(riverC - 10); x <= g.x; x++) {
      for (let yy = cy; yy <= cy + 1; yy++) {
        const t = tileAt(world, x, yy);
        if (t === Tile.Water || t === Tile.Sand || t === Tile.Shallow) setTile(world, x, yy, Tile.Bridge);
        else carveTile(ctx, x, yy, x > bridgeStart ? Tile.Dirt : Tile.Dirt);
      }
    }
    // Убрать мост там, где он не над водой (песок) — заменим обратно на настил только над водой/песком у воды
    world.poi.bridge = { x: Math.round(riverC), y: cy };
  }

  // Вторичные улицы: искривлённая сетка с разрывами (тупиками)
  const hRows: number[] = [];
  {
    let y = sq.y - 1 - rng.int(7, 8);
    while (y > cy - ry - 2) {
      hRows.push(y);
      y -= rng.int(5, 7);
    }
    y = sq.y + sq.h + rng.int(7, 8);
    while (y < cy + ry + 2) {
      hRows.push(y);
      y += rng.int(5, 7);
    }
  }
  const vCols: number[] = [];
  {
    let x = sq.x - 1 - rng.int(8, 10);
    while (x > cx - rx - 2) {
      vCols.push(x);
      x -= rng.int(7, 9);
    }
    x = sq.x + sq.w + rng.int(8, 10);
    while (x < cx + rx + 2) {
      vCols.push(x);
      x += rng.int(7, 9);
    }
  }
  const insideAt = (x: number, y: number) => inBounds(world, x, y) && world.inside[idx(world, x, y)] === 1 && world.tiles[idx(world, x, y)] !== Tile.Wall && world.tiles[idx(world, x, y)] !== Tile.Tower;
  const carveStreet = (horizontal: boolean, base: number) => {
    // Найти протяжённость внутри стен
    const limit = horizontal ? W : H;
    let a0 = -1;
    let a1 = -1;
    for (let a = 0; a < limit; a++) {
      const x = horizontal ? a : base;
      const y = horizontal ? base : a;
      if (insideAt(x, y)) {
        if (a0 < 0) a0 = a;
        a1 = a;
      }
    }
    if (a0 < 0 || a1 - a0 < 6) return;
    // Разрыв (тупик) с вероятностью
    let gapStart = -1;
    let gapEnd = -1;
    if (rng.chance(0.45) && a1 - a0 > 24) {
      const len = rng.int(7, 13);
      gapStart = rng.int(a0 + 6, a1 - 6 - len);
      gapEnd = gapStart + len;
      // не разрывать на главной дороге
      const mainA = horizontal ? cx : cy;
      if (gapStart <= mainA + 2 && gapEnd >= mainA - 2) gapStart = -1;
    }
    let off = 0;
    let a = a0;
    let prevX = horizontal ? a0 : base;
    let prevY = horizontal ? base : a0;
    while (a < a1) {
      const step = Math.min(a1 - a, rng.int(7, 12));
      a += step;
      off = Math.max(-2, Math.min(2, off + rng.int(-1, 1)));
      const nx = horizontal ? a : base + off;
      const ny = horizontal ? base + off : a;
      const segStart = horizontal ? prevX : prevY;
      const inGap = gapStart >= 0 && segStart >= gapStart && a <= gapEnd + 2;
      if (!inGap) carveLineInside(ctx, prevX, prevY, nx, ny, Tile.Road);
      prevX = nx;
      prevY = ny;
    }
  };
  for (const y of hRows) carveStreet(true, y);
  for (const x of vCols) carveStreet(false, x);

  // Короткие вертикальные переулки внутрь кварталов (дома по обе стороны)
  const alleys = Math.round((rx * ry) / 90);
  for (let k = 0; k < alleys; k++) {
    const y = rng.pick(hRows);
    const x = Math.round(cx + rng.float(-0.9, 0.9) * rx);
    if (!insideAt(x, y) || !isRoadTile(world.tiles[idx(world, x, y)] as Tile)) continue;
    const len = rng.int(4, 7);
    carveLineInside(ctx, x, y - 1, x, y - len, Tile.Road);
  }
  // Трущобы: хаотичные грязные проулки
  for (let k = 0; k < Math.round((rx * ry) / 25); k++) {
    const a = Math.PI + rng.float(-0.75, 0.75);
    const p = polar(ctx, a, rng.float(0.5, 0.95));
    if (!insideAt(p.x, p.y) || world.district[idx(world, p.x, p.y)] !== District.Slums) continue;
    const len = rng.int(3, 6);
    const horiz = rng.chance(0.35);
    const x2 = horiz ? p.x + len * (rng.chance(0.5) ? 1 : -1) : p.x;
    const y2 = horiz ? p.y : p.y + len * (rng.chance(0.5) ? 1 : -1);
    carveLineInside(ctx, p.x, p.y, x2, y2, Tile.Dirt);
  }

  // Набережная/просёлок вдоль реки между мостом и городом не нужен; дорожки к полям — позже
}

// ---------------------------------------------------------------- Кварталы

function genDistricts(ctx: Ctx): void {
  const { world, W, H } = ctx;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!world.inside[i]) {
        world.district[i] = District.Outskirts;
        continue;
      }
      const rho = rhoOf(ctx, x, y);
      const ang = angOf(ctx, x, y); // -PI..PI, 0 — восток, PI/2 — юг
      let d = District.Residential;
      if (rho < 0.38) d = District.Center;
      else if (angDist(ang, -Math.PI / 4) < 0.6 && rho > 0.38) d = District.Noble; // северо-восток
      else if (angDist(ang, Math.PI) < 0.7 && rho > 0.55) d = District.Slums; // запад, у реки
      else if (ang > Math.PI * 0.2 && ang < Math.PI * 0.8) d = District.Craftsmen; // юг
      world.district[i] = d;
    }
  }
}

function angDist(a: number, b: number): number {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

// ---------------------------------------------------------------- Холм

function genHill(ctx: Ctx): void {
  const { world, cx, cy, rx, ry, W, H, noise } = ctx;
  const hx = Math.round(cx + Math.cos(-Math.PI / 4) * rx * 0.62);
  const hy = Math.round(cy + Math.sin(-Math.PI / 4) * ry * 0.62);
  const r = Math.min(rx, ry) * 0.42;
  world.poi.castleHill = { x: hx, y: hy, r };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = x - hx;
      const dy = (y - hy) * 1.1;
      const d = Math.sqrt(dx * dx + dy * dy) / r;
      const h = Math.max(0, 1 - d * d) * (0.85 + noise.value(x / 6, y / 6) * 0.3);
      world.height[y * W + x] = Math.min(1, h);
    }
}

// ---------------------------------------------------------------- Размещение зданий

function canPlace(ctx: Ctx, x: number, y: number, w: number, h: number, requireInside: boolean, allowTiles: Tile[]): boolean {
  const { world } = ctx;
  if (x < 1 || y < 1 || x + w >= world.w - 1 || y + h >= world.h - 1) return false;
  for (let yy = y - 1; yy <= y + h; yy++) {
    for (let xx = x - 1; xx <= x + w; xx++) {
      const i = idx(world, xx, yy);
      const insideFoot = xx >= x && xx < x + w && yy >= y && yy < y + h;
      const t = world.tiles[i] as Tile;
      if (insideFoot) {
        if (requireInside && !world.inside[i]) return false;
        if (ctx.reserved[i]) return false;
        if (world.buildingAt[i] >= 0) return false;
        if (!allowTiles.includes(t)) return false;
      } else {
        // соседние тайлы: не стена, не здание (оставляем зазор по вертикали, по горизонтали допускаем)
        if (t === Tile.Wall || t === Tile.Tower || t === Tile.Gate) return false;
        if (world.buildingAt[i] >= 0) {
          const vertical = yy < y || yy >= y + h;
          if (vertical) return false;
        }
      }
    }
  }
  return true;
}

const BUILDABLE: Tile[] = [Tile.Grass, Tile.Meadow, Tile.Mud, Tile.Sand];

function pickMaterial(ctx: Ctx, type: BuildingType, district: District): { material: Material; roof: Roof } {
  const def = BUILDING_DEFS[type];
  const { rng } = ctx;
  let material: Material;
  let roof: Roof;
  if (def.material !== 'any') material = def.material;
  else {
    switch (district) {
      case District.Noble:
      case District.Center:
        material = rng.weighted<Material>(['stone', 'timber', 'brick'], [3, 3, 1]);
        break;
      case District.Slums:
        material = 'wood';
        break;
      case District.Craftsmen:
        material = rng.weighted<Material>(['timber', 'wood', 'stone'], [4, 2, 1]);
        break;
      default:
        material = rng.weighted<Material>(['timber', 'wood', 'stone'], [4, 3, 1]);
    }
  }
  if (def.roof !== 'any') roof = def.roof;
  else {
    switch (district) {
      case District.Noble:
        roof = rng.weighted<Roof>(['slate', 'tile'], [2, 1]);
        break;
      case District.Center:
        roof = rng.weighted<Roof>(['tile', 'slate', 'wood'], [3, 1, 1]);
        break;
      case District.Slums:
        roof = rng.weighted<Roof>(['thatch', 'wood'], [3, 1]);
        break;
      default:
        roof = rng.weighted<Roof>(['thatch', 'tile', 'wood'], [3, 2, 2]);
    }
  }
  return { material, roof };
}

function addBuilding(ctx: Ctx, type: BuildingType, x: number, y: number, w: number, h: number, doorX: number, doorY: number): Building {
  const { world } = ctx;
  const def = BUILDING_DEFS[type];
  const district = world.district[idx(world, x, y)] as District;
  const { material, roof } = pickMaterial(ctx, type, district);
  const b: Building = {
    id: ctx.nextBuildingId++,
    type,
    x,
    y,
    w,
    h,
    doorX,
    doorY,
    facing: 0,
    material,
    roof,
    stories: def.stories === 1 && (type === BuildingType.House || type === BuildingType.Merchant) && ctx.rng.chance(district === District.Center ? 0.5 : 0.2) ? 2 : def.stories,
    variant: ctx.rng.int(0, 1000),
    name: '',
    residents: [],
    workers: [],
    owner: -1,
    condition: 1,
    storage: {},
    district,
    lit: false,
  };
  if (type === BuildingType.Tavern) b.name = ctx.rng.pick(TAVERN_NAMES);
  world.buildings.push(b);
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) {
      const i = idx(world, xx, yy);
      world.buildingAt[i] = b.id;
      world.tiles[i] = Tile.Floor;
    }
  // Дверь: если не дорога — делаем утоптанную землю
  const di = idx(world, doorX, doorY);
  if (inBounds(world, doorX, doorY)) {
    const t = world.tiles[di] as Tile;
    if (!isRoadTile(t) && t !== Tile.Floor) {
      world.tiles[di] = Tile.Dirt;
    }
    ctx.reserved[di] = 1;
  }
  return b;
}

/** Есть ли рядом (4-соседство) дорога */
function adjacentRoad(ctx: Ctx, x: number, y: number): boolean {
  const { world } = ctx;
  for (let d = 0; d < 4; d++) {
    const nx = x + [1, -1, 0, 0][d];
    const ny = y + [0, 0, 1, -1][d];
    if (inBounds(world, nx, ny) && isRoadTile(world.tiles[idx(world, nx, ny)] as Tile)) return true;
  }
  return false;
}

/** Попытка поставить здание, у которого дверь (doorX,doorY) ниже футпринта и примыкает к дороге */
function tryPlaceWithDoor(ctx: Ctx, type: BuildingType, doorX: number, doorY: number, w: number, h: number, requireInside: boolean): Building | null {
  const { world, rng } = ctx;
  const di = idx(world, doorX, doorY);
  const dt = world.tiles[di] as Tile;
  if (world.buildingAt[di] >= 0) return null;
  if (dt === Tile.Water || dt === Tile.Wall || dt === Tile.Tower || dt === Tile.Forest || dt === Tile.Rock || dt === Tile.Floor) return null;
  if (!isRoadTile(dt) && !adjacentRoad(ctx, doorX, doorY)) return null;
  const offsets: number[] = [];
  for (let o = 0; o < w; o++) offsets.push(o);
  rng.shuffle(offsets);
  for (const o of offsets) {
    const x = doorX - o;
    const y = doorY - h;
    if (canPlace(ctx, x, y, w, h, requireInside, BUILDABLE)) {
      return addBuilding(ctx, type, x, y, w, h, doorX, doorY);
    }
  }
  return null;
}

/** Поиск места для здания рядом с целевой точкой: двери должны выходить на дорогу */
function placeNear(ctx: Ctx, type: BuildingType, tx: number, ty: number, maxR: number, requireInside: boolean, w?: number, h?: number): Building | null {
  const { world, rng } = ctx;
  const def = BUILDING_DEFS[type];
  const bw = w ?? rng.int(def.minW, def.maxW);
  const bh = h ?? rng.int(def.minH, def.maxH);
  // Кандидаты: тайлы дорог (или рядом) в радиусе
  const cands: { x: number; y: number; d: number }[] = [];
  for (let y = ty - maxR; y <= ty + maxR; y++)
    for (let x = tx - maxR; x <= tx + maxR; x++) {
      if (!inBounds(world, x, y)) continue;
      const t = world.tiles[idx(world, x, y)] as Tile;
      if (world.buildingAt[idx(world, x, y)] >= 0) continue;
      if (!(isRoadTile(t) || ((t === Tile.Grass || t === Tile.Meadow || t === Tile.Sand || t === Tile.Mud) && adjacentRoad(ctx, x, y)))) continue;
      if (requireInside && !world.inside[idx(world, x, y)]) continue;
      const dx = x - tx;
      const dy = y - ty;
      cands.push({ x, y, d: dx * dx + dy * dy + rng.float(0, 6) });
    }
  cands.sort((a, b) => a.d - b.d);
  for (const c of cands) {
    const b = tryPlaceWithDoor(ctx, type, c.x, c.y, bw, bh, requireInside);
    if (b) return b;
  }
  return null;
}

function polar(ctx: Ctx, ang: number, rho: number): { x: number; y: number } {
  const rr = rho * ctx.boundary(ang);
  return { x: Math.round(ctx.cx + Math.cos(ang) * ctx.rx * rr), y: Math.round(ctx.cy + Math.sin(ang) * ctx.ry * rr) };
}

function placeUniqueBuildings(ctx: Ctx): void {
  const { world, rng, cx, cy } = ctx;
  const sq = world.poi.square;

  // Колодец в центре площади
  addBuilding(ctx, BuildingType.Well, cx, cy, 1, 1, cx, cy + 1);
  // Позорный столб
  addBuilding(ctx, BuildingType.Pillory, sq.x + 1, sq.y + sq.h - 1, 1, 1, sq.x + 1, sq.y + sq.h);

  // Ратуша: на северной стороне площади, дверь на площадь
  {
    const w = 8;
    const h = 5;
    const x = cx - 4;
    const y = sq.y - h;
    forcePlace(ctx, BuildingType.TownHall, x, y, w, h, cx, sq.y);
  }
  // Собор: восточнее площади, чуть севернее, дверь на юг
  {
    const w = 7;
    const h = 10;
    const x = sq.x + sq.w + 1;
    const y = sq.y - 4;
    const b = forcePlace(ctx, BuildingType.Cathedral, x, y, w, h, x + 3, y + h);
    // дорожка от двери собора к площади
    carveLine(ctx, b.doorX, b.doorY, b.doorX, cy, 1, Tile.Road);
    carveLine(ctx, b.doorX, b.doorY, sq.x + sq.w - 1, b.doorY, 1, Tile.Road);
  }
  // Тюрьма: западнее ратуши
  {
    const w = 5;
    const h = 4;
    const x = sq.x - w - 1;
    const y = sq.y - h;
    const b = forcePlace(ctx, BuildingType.Prison, x, y, w, h, x + 2, y + h);
    carveLine(ctx, b.doorX, b.doorY, sq.x, b.doorY, 1, Tile.Road);
  }
  // Пожарная каланча: юго-западный угол площади (снаружи площади)
  {
    const x = sq.x - 3;
    const y = sq.y + sq.h - 1;
    forcePlace(ctx, BuildingType.FireTower, x, y, 2, 2, x, y + 2);
    carveLine(ctx, x, y + 2, sq.x, y + 2, 1, Tile.Road);
  }
  // Замок на холме (северо-восток)
  {
    const hill = world.poi.castleHill;
    const w = 11;
    const h = 8;
    const x = hill.x - 5;
    const y = hill.y - 4;
    const b = forcePlace(ctx, BuildingType.Castle, x, y, w, h, x + 5, y + h);
    // двор вокруг замка
    for (let yy = y - 2; yy < y + h + 2; yy++)
      for (let xx = x - 2; xx < x + w + 2; xx++) {
        if (!inBounds(world, xx, yy)) continue;
        const i = idx(world, xx, yy);
        if (world.buildingAt[i] >= 0 || isRoadTile(world.tiles[i] as Tile)) continue;
        if (world.tiles[i] === Tile.Wall || world.tiles[i] === Tile.Tower) continue;
        world.tiles[i] = Tile.Garden;
        ctx.reserved[i] = 1;
      }
    // дорога от замка к площади
    carveLine(ctx, b.doorX, b.doorY, b.doorX, b.doorY + 3, 2, Tile.Road);
    const p2 = { x: b.doorX, y: b.doorY + 3 };
    carveLine(ctx, p2.x, p2.y, sq.x + sq.w, sq.y, 1, Tile.Road);
  }
  // Казарма у восточных ворот (внутри)
  {
    const g = world.poi.gates.find((q) => q.dir === 0)!;
    placeNear(ctx, BuildingType.Barracks, g.x - 7, g.y - 4, 8, true, 6, 4);
  }
  // Монастырь с больницей — север
  {
    const p = polar(ctx, -Math.PI / 2 + 0.55, 0.66);
    placeNear(ctx, BuildingType.Monastery, p.x, p.y, 12, true, 8, 6);
  }
  // Таверны
  {
    placeNear(ctx, BuildingType.Tavern, cx - 3, sq.y + sq.h + 2, 8, true);
    const pw = polar(ctx, Math.PI - 0.3, 0.72);
    placeNear(ctx, BuildingType.Tavern, pw.x, pw.y, 12, true);
    const ps = polar(ctx, Math.PI / 2 + 0.4, 0.6);
    placeNear(ctx, BuildingType.Tavern, ps.x, ps.y, 12, true);
    if (ctx.W >= 160) {
      const pe = polar(ctx, 0.3, 0.6);
      placeNear(ctx, BuildingType.Tavern, pe.x, pe.y, 12, true);
    }
  }
  // Ремесленники — юг
  {
    const spots: [BuildingType, number][] = [
      [BuildingType.Smithy, Math.PI / 2 - 0.4],
      [BuildingType.Carpenter, Math.PI / 2 + 0.1],
      [BuildingType.Mason, Math.PI / 2 + 0.5],
      [BuildingType.Smithy, Math.PI / 2 + 0.9],
      [BuildingType.Tannery, Math.PI - 0.5],
      [BuildingType.Carpenter, Math.PI / 2 - 0.9],
    ];
    for (const [t, a] of spots) {
      const p = polar(ctx, a, rng.float(0.5, 0.85));
      placeNear(ctx, t, p.x, p.y, 14, true);
    }
  }
  // Лавки у центра
  {
    const shops: BuildingType[] = [
      BuildingType.Bakery, BuildingType.Butcher, BuildingType.Merchant, BuildingType.Bakery,
      BuildingType.Merchant, BuildingType.Butcher, BuildingType.Merchant, BuildingType.Warehouse,
    ];
    if (ctx.W >= 160) shops.push(BuildingType.Bakery, BuildingType.Merchant);
    for (const t of shops) {
      const a = rng.float(0, Math.PI * 2);
      const p = polar(ctx, a, rng.float(0.25, 0.5));
      placeNear(ctx, t, p.x, p.y, 12, true);
    }
  }
  // Конюшня у восточных ворот
  {
    const g = world.poi.gates.find((q) => q.dir === 0)!;
    placeNear(ctx, BuildingType.Stable, g.x - 6, g.y + 4, 8, true);
  }
  // Особняки — северо-восток (вокруг замка)
  {
    const n = ctx.W >= 192 ? 9 : ctx.W >= 160 ? 7 : 5;
    for (let k = 0; k < n; k++) {
      const a = -Math.PI / 4 + rng.float(-0.7, 0.7);
      const p = polar(ctx, a, rng.float(0.4, 0.9));
      placeNear(ctx, BuildingType.Manor, p.x, p.y, 12, true);
    }
  }
  // Торговые ряды на площади
  {
    const rows = [sq.y + 2, sq.y + sq.h - 3];
    for (const ry of rows) {
      for (let k = 0; k < 4; k++) {
        const x = sq.x + 2 + k * 3;
        if (x + 1 >= cx - 1 && x <= cx + 1) continue; // не загораживать колодец по вертикали
        if (rng.chance(0.85)) addBuilding(ctx, BuildingType.MarketStall, x, ry, 2, 1, x, ry + 1);
      }
    }
  }
}

/** Принудительная постановка (уникальные здания): освобождает тайлы, кроме воды/стен */
function forcePlace(ctx: Ctx, type: BuildingType, x: number, y: number, w: number, h: number, doorX: number, doorY: number): Building {
  const { world } = ctx;
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) {
      const i = idx(world, xx, yy);
      const bid = world.buildingAt[i];
      if (bid >= 0) removeBuilding(ctx, bid);
      world.tiles[i] = Tile.Grass;
      ctx.reserved[i] = 0;
    }
  const b = addBuilding(ctx, type, x, y, w, h, doorX, doorY);
  if (!isRoadTile(world.tiles[idx(world, doorX, doorY)] as Tile)) world.tiles[idx(world, doorX, doorY)] = Tile.Road;
  return b;
}

function removeBuilding(ctx: Ctx, id: number): void {
  const { world } = ctx;
  const b = world.buildings[id];
  if (!b) return;
  for (let yy = b.y; yy < b.y + b.h; yy++)
    for (let xx = b.x; xx < b.x + b.w; xx++) {
      const i = idx(world, xx, yy);
      if (world.buildingAt[i] === id) {
        world.buildingAt[i] = -1;
        world.tiles[i] = Tile.Grass;
      }
    }
  b.w = 0;
  b.h = 0;
  b.type = BuildingType.Well;
  (b as { removed?: boolean }).removed = true;
}

function collectDoorCandidates(ctx: Ctx): number[] {
  const { world, W, H } = ctx;
  const cands: number[] = [];
  for (let y = 2; y < H - 2; y++)
    for (let x = 2; x < W - 2; x++) {
      const i = y * W + x;
      if (!world.inside[i]) continue;
      if (world.buildingAt[i] >= 0) continue;
      const t = world.tiles[i] as Tile;
      if (t === Tile.Plaza) continue;
      if (isRoadTile(t) || ((t === Tile.Grass || t === Tile.Meadow || t === Tile.Mud) && adjacentRoad(ctx, x, y))) cands.push(i);
    }
  return cands;
}

function fillPass(ctx: Ctx, small: boolean): void {
  const { world, rng, W } = ctx;
  const cands = collectDoorCandidates(ctx);
  rng.shuffle(cands);
  for (const i of cands) {
    const x = i % W;
    const y = Math.floor(i / W);
    if (world.buildingAt[i] >= 0) continue;
    const d = world.district[i] as District;
    let options: [BuildingType, number, number][];
    if (d === District.Slums) {
      options = small ? [[BuildingType.Shack, 2, 2]] : [[BuildingType.Shack, 3, 3], [BuildingType.Shack, 3, 2], [BuildingType.Shack, 2, 3], [BuildingType.Shack, 2, 2]];
      if (!small) rng.shuffle(options);
    } else if (d === District.Noble) {
      options = small
        ? [[BuildingType.House, 3, 3]]
        : rng.chance(0.35)
          ? [[BuildingType.Manor, 6, 5], [BuildingType.Manor, 5, 4], [BuildingType.House, 4, 4], [BuildingType.House, 4, 3], [BuildingType.House, 3, 3]]
          : [[BuildingType.House, 4, 4], [BuildingType.House, 4, 3], [BuildingType.House, 3, 4], [BuildingType.House, 3, 3]];
    } else {
      options = small
        ? [[BuildingType.House, 3, 3]]
        : rng.chance(0.5)
          ? [[BuildingType.House, 4, 4], [BuildingType.House, 4, 3], [BuildingType.House, 3, 4], [BuildingType.House, 3, 3]]
          : [[BuildingType.House, 4, 3], [BuildingType.House, 3, 4], [BuildingType.House, 3, 3]];
    }
    for (const [type, w, h] of options) {
      if (tryPlaceWithDoor(ctx, type, x, y, w, h, true)) break;
    }
  }
}

/** Прокладка переулков в пустые карманы кварталов, чтобы застроить их */
function carveInnerLanes(ctx: Ctx, count: number): void {
  const { world, rng, W, H } = ctx;
  const pockets: number[] = [];
  for (let y = 3; y < H - 3; y++)
    for (let x = 3; x < W - 3; x++) {
      const i = y * W + x;
      if (!world.inside[i]) continue;
      const t = world.tiles[i] as Tile;
      if (t !== Tile.Grass && t !== Tile.Meadow && t !== Tile.Mud) continue;
      if (adjacentRoad(ctx, x, y)) continue;
      let nearB = false;
      for (let dy = -1; dy <= 1 && !nearB; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const j = idx(world, x + dx, y + dy);
          if (world.buildingAt[j] >= 0) {
            nearB = true;
            break;
          }
        }
      if (!nearB) pockets.push(i);
    }
  rng.shuffle(pockets);
  let done = 0;
  for (const i of pockets) {
    if (done >= count) break;
    const x = i % W;
    const y = Math.floor(i / W);
    if (adjacentRoad(ctx, x, y)) continue;
    // ещё не прорыт рядом переулок?
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++)
      for (let dx = -2; dx <= 2; dx++) if (isRoadTile(world.tiles[idx(world, x + dx, y + dy)] as Tile)) near = true;
    if (near) continue;
    if (carvePathToRoad(ctx, x, y, 7)) done++;
  }
}

function fillCityBuildings(ctx: Ctx): void {
  fillPass(ctx, false);
  carveInnerLanes(ctx, Math.round((ctx.rx * ctx.ry) / 45));
  fillPass(ctx, false);
  carveInnerLanes(ctx, Math.round((ctx.rx * ctx.ry) / 60));
  fillPass(ctx, false);
  fillPass(ctx, true);
}

// ---------------------------------------------------------------- Предместья

function genOutskirts(ctx: Ctx): void {
  const { world, rng, noise, W, H, cx, cy, rx, ry } = ctx;
  const gates = world.poi.gates;
  const gE = gates.find((g) => g.dir === 0)!;
  const gS = gates.find((g) => g.dir === 1)!;
  const gW = gates.find((g) => g.dir === 2)!;
  const gN = gates.find((g) => g.dir === 3)!;

  // Мельница у реки, рядом с мостом (на восточном берегу, севернее дороги)
  {
    const by = world.poi.bridge.y;
    let placed = false;
    for (let dy = -3; dy >= -10 && !placed; dy--) {
      const y = by + dy;
      const rc = world.poi.riverCenterX[y];
      // найти первый не-водный тайл восточнее реки
      let x = Math.round(rc);
      while (x < W && (tileAt(world, x, y) === Tile.Water)) x++;
      x += 1;
      const w = 4;
      const h = 4;
      if (canPlace(ctx, x, y - h + 1, w, h, false, [Tile.Grass, Tile.Meadow, Tile.Sand])) {
        const b = addBuilding(ctx, BuildingType.Mill, x, y - h + 1, w, h, x + 1, y + 1);
        carveLine(ctx, b.doorX, b.doorY, b.doorX, by, 1, Tile.Dirt);
        // водяное колесо у воды
        world.props.push({ type: PropType.Waterwheel, x: x - 1, y: y - 1, ox: 0.5, oy: 0.5, variant: 0, solid: false });
        placed = true;
      }
    }
  }

  // Лесопилка у северной дороги, близко к лесу
  {
    const y = Math.max(6, gN.y - rng.int(10, 15));
    placeNear(ctx, BuildingType.Sawmill, cx + rng.int(-3, 3), y, 8, false, 5, 4);
  }

  // Каменоломня — северо-восток, скалы
  {
    const qx = Math.min(W - 12, Math.round(cx + rx + 9));
    const qy = Math.max(8, Math.round(cy - ry - 6));
    // скалы
    for (let y = qy - 6; y < qy + 8; y++)
      for (let x = qx - 6; x < qx + 10; x++) {
        if (!inBounds(world, x, y)) continue;
        const i = idx(world, x, y);
        if (world.inside[i] || world.buildingAt[i] >= 0 || isRoadTile(world.tiles[i] as Tile)) continue;
        const dx = (x - qx - 2) / 8;
        const dy = (y - qy - 1) / 7;
        const d = Math.sqrt(dx * dx + dy * dy) + (noise.value(x / 4, y / 4) - 0.5) * 0.5;
        if (d < 0.75) world.tiles[i] = d < 0.45 ? Tile.Quarry : Tile.Rock;
      }
    // дорога от восточных ворот к каменоломне
    const start = { x: gE.x + 3, y: gE.y };
    carvePolyline(ctx, [start, { x: start.x + 5, y: Math.round((start.y + qy) / 2) }, { x: qx, y: qy + 4 }], 1, Tile.Dirt);
    // здание каменоломни
    const b = placeNear(ctx, BuildingType.Quarry, qx, qy + 5, 8, false, 6, 5);
    if (b) {
      // Расчистить проход внутрь каменоломни — тайлы Quarry проходимы
      for (let y = b.y - 3; y < b.y; y++)
        for (let x = b.x; x < b.x + b.w; x++) if (tileAt(world, x, y) === Tile.Rock) setTile(world, x, y, Tile.Quarry);
    }
  }

  // Кладбище с часовней — за южными воротами, в стороне от дороги
  {
    const side = rng.chance(0.5) ? 1 : -1;
    const cxg = cx + side * rng.int(9, 13);
    const cyg = gS.y + rng.int(6, 9);
    const w = 9;
    const h = 7;
    let ok = true;
    for (let y = cyg; y < cyg + h; y++)
      for (let x = cxg; x < cxg + w; x++) {
        if (!inBounds(world, x, y) || world.inside[idx(world, x, y)]) ok = false;
        else {
          const t = world.tiles[idx(world, x, y)] as Tile;
          if (t === Tile.Water || t === Tile.Sand || world.buildingAt[idx(world, x, y)] >= 0) ok = false;
        }
      }
    if (ok) {
      for (let y = cyg; y < cyg + h; y++)
        for (let x = cxg; x < cxg + w; x++) {
          const i = idx(world, x, y);
          if (isRoadTile(world.tiles[i] as Tile)) continue;
          world.tiles[i] = Tile.Cemetery;
          ctx.reserved[i] = 1;
          if ((x - cxg) % 2 === 1 && (y - cyg) % 2 === 1 && rng.chance(0.8) && y < cyg + h - 1)
            world.props.push({ type: PropType.Cross, x, y, ox: 0.5, oy: 0.6, variant: rng.int(0, 2), solid: false });
        }
      // ограда
      for (let x = cxg - 1; x <= cxg + w; x++) {
        for (const y of [cyg - 1, cyg + h]) {
          if (inBounds(world, x, y) && !isRoadTile(tileAt(world, x, y)) && world.buildingAt[idx(world, x, y)] < 0)
            world.props.push({ type: PropType.Fence, x, y, ox: 0.5, oy: 0.5, variant: 0, solid: true });
        }
      }
      for (let y = cyg; y < cyg + h; y++) {
        for (const x of [cxg - 1, cxg + w]) {
          if (inBounds(world, x, y) && !isRoadTile(tileAt(world, x, y)) && world.buildingAt[idx(world, x, y)] < 0)
            world.props.push({ type: PropType.Fence, x, y, ox: 0.5, oy: 0.5, variant: 1, solid: true });
        }
      }
      // часовня внутри, у входа
      const chx = cxg + Math.floor(w / 2) - 1;
      const chy = cyg;
      for (let y = chy; y < chy + 3; y++)
        for (let x = chx; x < chx + 3; x++) {
          ctx.reserved[idx(world, x, y)] = 0;
          world.tiles[idx(world, x, y)] = Tile.Grass;
        }
      // убрать кресты под часовней
      world.props = world.props.filter((p) => !(p.type === PropType.Cross && p.x >= chx && p.x < chx + 3 && p.y >= chy && p.y < chy + 3));
      const chapel = addBuilding(ctx, BuildingType.Chapel, chx, chy, 3, 3, chx + 1, chy + 3);
      // Вход на кладбище: разрыв ограды снизу, дорожка к южной дороге
      const gapX = chapel.doorX;
      world.props = world.props.filter((p) => !(p.type === PropType.Fence && p.y === cyg + h && Math.abs(p.x - gapX) <= 0));
      carveLine(ctx, gapX, cyg + h, gapX, cyg + h + 1, 1, Tile.Dirt);
      carveLine(ctx, gapX, cyg + h + 1, cx, cyg + h + 1, 1, Tile.Dirt);
      // дорожка от двери часовни к воротам кладбища
      carveLine(ctx, gapX, chapel.doorY, gapX, cyg + h, 1, Tile.Dirt);
    }
  }

  // Фермы с полями — юг, восток, запад за рекой
  {
    const farmSpots: { x: number; y: number }[] = [];
    const nFarms = W >= 192 ? 9 : W >= 160 ? 7 : 5;
    const tries = 200;
    for (let t = 0; t < tries && farmSpots.length < nFarms; t++) {
      const a = rng.float(0, Math.PI * 2);
      const r = rng.float(1.22, 1.9);
      const x = Math.round(cx + Math.cos(a) * rx * r);
      const y = Math.round(cy + Math.sin(a) * ry * r);
      if (x < 8 || y < 8 || x > W - 9 || y > H - 9) continue;
      if (world.inside[idx(world, x, y)]) continue;
      const t0 = tileAt(world, x, y);
      if (t0 !== Tile.Grass && t0 !== Tile.Meadow) continue;
      if (farmSpots.some((f) => Math.abs(f.x - x) < 16 && Math.abs(f.y - y) < 13)) continue;
      // не ставить рядом с каменоломней/кладбищем
      let bad = false;
      for (let yy = y - 6; yy <= y + 6 && !bad; yy++)
        for (let xx = x - 8; xx <= x + 8; xx++) {
          const tt = tileAt(world, xx, yy);
          if (tt === Tile.Rock || tt === Tile.Cemetery || tt === Tile.Quarry || tt === Tile.Water) {
            bad = true;
            break;
          }
        }
      if (bad) continue;
      farmSpots.push({ x, y });
    }
    for (const f of farmSpots) {
      // Поле
      const fw = rng.int(7, 11);
      const fh = rng.int(5, 8);
      const fx = f.x - Math.floor(fw / 2);
      const fy = f.y - Math.floor(fh / 2);
      for (let y = fy; y < fy + fh; y++)
        for (let x = fx; x < fx + fw; x++) {
          if (!inBounds(world, x, y)) continue;
          const i = idx(world, x, y);
          const t = world.tiles[i] as Tile;
          if (t === Tile.Grass || t === Tile.Meadow) {
            world.tiles[i] = Tile.Field;
            ctx.reserved[i] = 1;
          }
        }
      // Дорога от ближайших ворот/дороги к ферме
      const nearest = nearestRoadTile(ctx, f.x, f.y + fh, 40);
      const farmDoorX = fx + Math.floor(fw / 2);
      const farmDoorY = fy + fh + 1;
      if (nearest) {
        carvePolyline(ctx, [{ x: nearest.x, y: nearest.y }, { x: farmDoorX, y: nearest.y }, { x: farmDoorX, y: farmDoorY }], 1, Tile.Dirt);
      }
      // Дом фермера рядом с полем (южнее)
      const b = placeNear(ctx, BuildingType.Farm, farmDoorX, farmDoorY, 6, false);
      if (b) {
        if (rng.chance(0.7)) world.props.push({ type: PropType.Hay, x: b.x + b.w + 1, y: b.y + b.h - 1, ox: 0.5, oy: 0.5, variant: 0, solid: false });
      }
    }
  }

  // Лес: дальняя периферия, шумом
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (world.inside[i]) continue;
      const t = world.tiles[i] as Tile;
      if (t !== Tile.Grass && t !== Tile.Meadow) continue;
      if (world.buildingAt[i] >= 0 || ctx.reserved[i]) continue;
      // не ближе 2 тайлов к дороге/зданию
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (!inBounds(world, xx, yy)) continue;
          const j = idx(world, xx, yy);
          const tt = world.tiles[j] as Tile;
          if (isRoadTile(tt) || world.buildingAt[j] >= 0 || tt === Tile.Field || tt === Tile.Cemetery || tt === Tile.Wall || tt === Tile.Tower || tt === Tile.Gate) {
            near = true;
            break;
          }
        }
      if (near) continue;
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const rho = Math.sqrt(dx * dx + dy * dy);
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y) / 10; // ближе к краю — гуще
      const n = noise.fbm(x / 11, y / 11, 3);
      const density = n + Math.max(0, 1 - edge) * 0.3 + Math.max(0, rho - 2.1) * 0.25 - 0.6;
      if (density > 0.06) {
        world.tiles[i] = Tile.Forest;
        world.props.push({ type: n > 0.62 ? PropType.Pine : PropType.Tree, x, y, ox: rng.float(0.3, 0.7), oy: rng.float(0.4, 0.8), variant: rng.int(0, 3), solid: true });
      } else if (density > -0.08 && rng.chance(0.12)) {
        world.props.push({ type: rng.chance(0.6) ? PropType.Tree : PropType.Bush, x, y, ox: rng.float(0.3, 0.7), oy: rng.float(0.4, 0.8), variant: rng.int(0, 3), solid: true });
        world.tiles[i] = Tile.Forest;
      }
    }
  // Камыши у воды
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (world.tiles[i] === Tile.Sand && rng.chance(0.12) && world.buildingAt[i] < 0)
        world.props.push({ type: PropType.Reeds, x, y, ox: rng.float(0.2, 0.8), oy: rng.float(0.3, 0.8), variant: rng.int(0, 2), solid: false });
    }
  void gW;
}

function nearestRoadTile(ctx: Ctx, x: number, y: number, maxR: number): { x: number; y: number } | null {
  const { world } = ctx;
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let yy = y - maxR; yy <= y + maxR; yy++)
    for (let xx = x - maxR; xx <= x + maxR; xx++) {
      if (!inBounds(world, xx, yy)) continue;
      const t = world.tiles[idx(world, xx, yy)] as Tile;
      if (t !== Tile.Dirt && t !== Tile.Road && t !== Tile.Gate) continue;
      if (world.inside[idx(world, xx, yy)]) continue;
      const d = (xx - x) * (xx - x) + (yy - y) * (yy - y);
      if (d < bestD) {
        bestD = d;
        best = { x: xx, y: yy };
      }
    }
  return best;
}

// ---------------------------------------------------------------- Связность

/** Для каждой двери убедиться, что она соединена с дорогой; при необходимости прокопать тропинку */
function connectDoors(ctx: Ctx): void {
  const { world } = ctx;
  for (const b of world.buildings) {
    if (b.w === 0) continue;
    const di = idx(world, b.doorX, b.doorY);
    if (world.buildingAt[di] >= 0) {
      // Дверь застроена — ищем альтернативу (не должно случаться)
      continue;
    }
    const t = world.tiles[di] as Tile;
    if (isRoadTile(t)) continue;
    if (!adjacentRoad(ctx, b.doorX, b.doorY)) carvePathToRoad(ctx, b.doorX, b.doorY, 10);
  }
}

/** BFS от точки до ближайшего дорожного тайла через проходимые (не здания, не вода) тайлы, прокладывая Dirt */
function carvePathToRoad(ctx: Ctx, sx: number, sy: number, maxLen: number): boolean {
  const { world, W } = ctx;
  const start = idx(world, sx, sy);
  const prev = new Map<number, number>();
  const queue: number[] = [start];
  prev.set(start, -1);
  let found = -1;
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const x = cur % W;
    const y = Math.floor(cur / W);
    // глубина
    let depth = 0;
    let p = cur;
    while (prev.get(p)! >= 0) {
      p = prev.get(p)!;
      depth++;
    }
    if (depth > maxLen) continue;
    if (cur !== start && isRoadTile(world.tiles[cur] as Tile)) {
      found = cur;
      break;
    }
    for (let d = 0; d < 4; d++) {
      const nx = x + [1, -1, 0, 0][d];
      const ny = y + [0, 0, 1, -1][d];
      if (!inBounds(world, nx, ny)) continue;
      const ni = idx(world, nx, ny);
      if (prev.has(ni)) continue;
      const t = world.tiles[ni] as Tile;
      if (world.buildingAt[ni] >= 0) continue;
      if (t === Tile.Water || t === Tile.Wall || t === Tile.Tower || t === Tile.Forest || t === Tile.Rock || t === Tile.Floor || t === Tile.Shallow) continue;
      prev.set(ni, cur);
      queue.push(ni);
    }
  }
  if (found < 0) return false;
  let p = prev.get(found)!;
  while (p >= 0 && p !== start) {
    if (!isRoadTile(world.tiles[p] as Tile)) world.tiles[p] = Tile.Dirt;
    ctx.reserved[p] = 1;
    p = prev.get(p)!;
  }
  if (!isRoadTile(world.tiles[start] as Tile)) world.tiles[start] = Tile.Dirt;
  return true;
}

/** Финальная проверка: все двери и дороги достижимы от площади; недостижимые здания удаляются */
function finalizeConnectivity(ctx: Ctx): void {
  const { world, W, H } = ctx;
  const n = W * H;
  const reach = new Uint8Array(n);
  const start = idx(world, world.poi.wellX, world.poi.wellY + 1);
  const stack: number[] = [start];
  reach[start] = 1;
  while (stack.length) {
    const cur = stack.pop()!;
    const x = cur % W;
    const y = Math.floor(cur / W);
    for (let d = 0; d < 4; d++) {
      const nx = x + [1, -1, 0, 0][d];
      const ny = y + [0, 0, 1, -1][d];
      if (!inBounds(world, nx, ny)) continue;
      const ni = idx(world, nx, ny);
      if (reach[ni]) continue;
      if (!isWalkableAt(world, nx, ny)) continue;
      reach[ni] = 1;
      stack.push(ni);
    }
  }
  // Двери, оказавшиеся на непроходимом тайле — переносим на соседний проходимый тайл под фасадом
  for (const b of world.buildings) {
    if (b.w === 0) continue;
    if (isWalkableAt(world, b.doorX, b.doorY)) continue;
    let fixed = false;
    for (let dx = 0; dx < b.w && !fixed; dx++) {
      const x = b.x + dx;
      const y = b.y + b.h;
      if (isWalkableAt(world, x, y)) {
        b.doorX = x;
        b.doorY = y;
        fixed = true;
      }
    }
    if (!fixed) removeBuilding(ctx, b.id);
  }
  // Пробуем соединить недостижимые двери, иначе удаляем здание
  for (const b of world.buildings) {
    if (b.w === 0) continue;
    const di = idx(world, b.doorX, b.doorY);
    if (!reach[di]) {
      // Попробовать прокопать к достижимой дороге
      const ok = carvePathToReachable(ctx, b.doorX, b.doorY, reach, 14);
      if (!ok) removeBuilding(ctx, b.id);
    }
  }
  // Повторный проход достижимости после прокладок — лавки без двери просто удаляем окончательно
  // Удалённые здания помечены w=0; фильтруем, переиндексируем
  const alive = world.buildings.filter((b) => b.w > 0);
  world.buildingAt.fill(-1);
  world.buildings = alive;
  alive.forEach((b, i) => {
    b.id = i;
    for (let yy = b.y; yy < b.y + b.h; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) world.buildingAt[idx(world, xx, yy)] = i;
  });
  // Пропы на тайлах зданий — удалить; твёрдые пропы на дорогах — удалить
  world.props = world.props.filter((p) => {
    if (!inBounds(world, p.x, p.y)) return false;
    const i = idx(world, p.x, p.y);
    if (world.buildingAt[i] >= 0) return false;
    if (p.solid && isRoadTile(world.tiles[i] as Tile)) return false;
    return true;
  });
  world.solidProp.fill(-1);
  world.props.forEach((p, i) => {
    if (p.solid) world.solidProp[idx(world, p.x, p.y)] = i;
  });
}

function carvePathToReachable(ctx: Ctx, sx: number, sy: number, reach: Uint8Array, maxLen: number): boolean {
  const { world, W } = ctx;
  const start = idx(world, sx, sy);
  const prev = new Map<number, number>();
  const depth = new Map<number, number>();
  const queue: number[] = [start];
  prev.set(start, -1);
  depth.set(start, 0);
  let found = -1;
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    if (reach[cur]) {
      found = cur;
      break;
    }
    const dd = depth.get(cur)!;
    if (dd >= maxLen) continue;
    const x = cur % W;
    const y = Math.floor(cur / W);
    for (let d = 0; d < 4; d++) {
      const nx = x + [1, -1, 0, 0][d];
      const ny = y + [0, 0, 1, -1][d];
      if (!inBounds(world, nx, ny)) continue;
      const ni = idx(world, nx, ny);
      if (prev.has(ni)) continue;
      const t = world.tiles[ni] as Tile;
      if (world.buildingAt[ni] >= 0) continue;
      if (t === Tile.Water || t === Tile.Wall || t === Tile.Tower || t === Tile.Rock || t === Tile.Floor || t === Tile.Shallow) continue;
      prev.set(ni, cur);
      depth.set(ni, dd + 1);
      queue.push(ni);
    }
  }
  if (found < 0) return false;
  let p = found;
  while (p >= 0) {
    const t = world.tiles[p] as Tile;
    if (t === Tile.Forest) {
      world.tiles[p] = Tile.Grass;
      // убрать дерево
      world.props = world.props.filter((pr) => !(pr.solid && idx(world, pr.x, pr.y) === p));
    } else if (!isRoadTile(t)) world.tiles[p] = Tile.Dirt;
    reach[p] = 1;
    ctx.reserved[p] = 1;
    p = prev.get(p)!;
  }
  return true;
}

// ---------------------------------------------------------------- Сады и пропы

function genGardensAndProps(ctx: Ctx): void {
  const { world, rng, W, H } = ctx;
  const sq = world.poi.square;
  // Внутренние пустые тайлы внутри стен -> дворы/сады (если не примыкают к дороге) и деревья
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!world.inside[i]) continue;
      const t = world.tiles[i] as Tile;
      if (t !== Tile.Grass && t !== Tile.Meadow && t !== Tile.Mud) continue;
      if (world.buildingAt[i] >= 0) continue;
      const d = world.district[i] as District;
      if (d === District.Slums) {
        world.tiles[i] = rng.chance(0.6) ? Tile.Mud : Tile.Grass;
        if (rng.chance(0.06)) world.props.push({ type: rng.chance(0.5) ? PropType.Barrel : PropType.Crate, x, y, ox: 0.5, oy: 0.5, variant: rng.int(0, 2), solid: false });
        continue;
      }
      if (!adjacentRoad(ctx, x, y)) {
        world.tiles[i] = Tile.Garden;
        if (rng.chance(0.12)) world.props.push({ type: PropType.Tree, x, y, ox: 0.5, oy: 0.6, variant: rng.int(0, 3), solid: true });
        else if (rng.chance(0.15)) world.props.push({ type: PropType.Bush, x, y, ox: rng.float(0.3, 0.7), oy: rng.float(0.3, 0.7), variant: rng.int(0, 2), solid: false });
        else if (rng.chance(0.1)) world.props.push({ type: PropType.Flowers, x, y, ox: 0.5, oy: 0.5, variant: rng.int(0, 3), solid: false });
      } else if (rng.chance(0.05)) {
        world.props.push({ type: rng.chance(0.5) ? PropType.Barrel : PropType.Crate, x, y, ox: 0.5, oy: 0.5, variant: rng.int(0, 2), solid: false });
      }
    }
  // Скамейки на площади
  const benches = [
    { x: sq.x + 1, y: sq.y + 5 },
    { x: sq.x + sq.w - 2, y: sq.y + 5 },
    { x: sq.x + 5, y: sq.y + sq.h - 1 },
    { x: sq.x + sq.w - 6, y: sq.y + sq.h - 1 },
    { x: sq.x + 5, y: sq.y },
    { x: sq.x + sq.w - 6, y: sq.y },
  ];
  for (const b of benches) {
    if (world.buildingAt[idx(world, b.x, b.y)] >= 0) continue;
    world.props.push({ type: PropType.Bench, x: b.x, y: b.y, ox: 0.5, oy: 0.5, variant: 0, solid: false });
    world.poi.benches.push({ x: b.x, y: b.y });
  }
  // Факелы на площади и у ворот
  for (const c of [
    { x: sq.x, y: sq.y },
    { x: sq.x + sq.w - 1, y: sq.y },
    { x: sq.x, y: sq.y + sq.h - 1 },
    { x: sq.x + sq.w - 1, y: sq.y + sq.h - 1 },
  ]) {
    if (world.buildingAt[idx(world, c.x, c.y)] < 0) world.props.push({ type: PropType.Torch, x: c.x, y: c.y, ox: 0.5, oy: 0.5, variant: 0, solid: false });
  }
  for (const g of world.poi.gates) {
    const horizontal = g.dir === 0 || g.dir === 2;
    const inward = g.dir === 0 ? -1 : g.dir === 2 ? 1 : 0;
    const inwardY = g.dir === 1 ? -1 : g.dir === 3 ? 1 : 0;
    const tx = g.x + inward * 2;
    const ty = g.y + inwardY * 2;
    const pts = horizontal ? [{ x: tx, y: ty - 1 }, { x: tx, y: ty + 2 }] : [{ x: tx - 1, y: ty }, { x: tx + 2, y: ty }];
    for (const p of pts) if (inBounds(world, p.x, p.y) && world.buildingAt[idx(world, p.x, p.y)] < 0) world.props.push({ type: PropType.Torch, x: p.x, y: p.y, ox: 0.5, oy: 0.5, variant: 0, solid: false });
  }
  // Фонари на главных улицах внутри стен (редко)
  for (let y = 2; y < H - 2; y += 1)
    for (let x = 2; x < W - 2; x += 1) {
      const i = y * W + x;
      if (!world.inside[i] || world.tiles[i] !== Tile.Road) continue;
      if ((x * 7 + y * 13) % 29 === 0 && rng.chance(0.5) && world.district[i] !== District.Slums) {
        world.props.push({ type: PropType.Lamp, x, y, ox: 0.5, oy: 0.5, variant: 0, solid: false });
      }
    }
  // Телеги у конюшни и склада, бочки у таверн
  for (const b of world.buildings) {
    if (b.w === 0) continue;
    if (b.type === BuildingType.Tavern || b.type === BuildingType.Warehouse || b.type === BuildingType.Stable) {
      const px = b.x + b.w;
      const py = b.y + b.h - 1;
      if (inBounds(world, px, py) && world.buildingAt[idx(world, px, py)] < 0 && !isRoadTile(tileAt(world, px, py)))
        world.props.push({ type: b.type === BuildingType.Tavern ? PropType.Barrel : PropType.Cart, x: px, y: py, ox: 0.5, oy: 0.5, variant: 0, solid: false });
    }
    if (b.type === BuildingType.Sawmill) {
      for (let k = 0; k < 4; k++) {
        const px = b.x - 1 - (k % 2);
        const py = b.y + Math.floor(k / 2) * 2;
        if (inBounds(world, px, py) && world.buildingAt[idx(world, px, py)] < 0 && !isRoadTile(tileAt(world, px, py)))
          world.props.push({ type: k < 2 ? PropType.Log : PropType.Stump, x: px, y: py, ox: 0.5, oy: 0.5, variant: k, solid: false });
      }
    }
  }
}

// ---------------------------------------------------------------- Точки интереса

function collectPOI(ctx: Ctx): void {
  const { world } = ctx;
  const sq = world.poi.square;
  world.poi.strollSpots.push({ x: sq.x + 3, y: sq.y + 3, name: 'площадь' });
  world.poi.strollSpots.push({ x: sq.x + sq.w - 4, y: sq.y + sq.h - 3, name: 'площадь' });
  world.poi.strollSpots.push({ x: world.poi.wellX, y: world.poi.wellY + 2, name: 'колодец' });
  for (const g of world.poi.gates) {
    const inward = g.dir === 0 ? -3 : g.dir === 2 ? 3 : 0;
    const inwardY = g.dir === 1 ? -3 : g.dir === 3 ? 3 : 0;
    world.poi.strollSpots.push({ x: g.x + inward, y: g.y + inwardY, name: g.name });
  }
  // Набережная у моста
  world.poi.strollSpots.push({ x: world.poi.bridge.x + 6, y: world.poi.bridge.y - 1, name: 'берег реки' });
  // Валидация точек: сдвигаем к проходимым
  world.poi.strollSpots = world.poi.strollSpots
    .map((s) => {
      const w = nearestWalkableTile(world, s.x, s.y);
      return w ? { ...s, x: w.x, y: w.y } : null;
    })
    .filter((s): s is { x: number; y: number; name: string } => s !== null);
}

function nearestWalkableTile(world: World, x: number, y: number): { x: number; y: number } | null {
  for (let r = 0; r < 8; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (inBounds(world, xx, yy) && isWalkableAt(world, xx, yy) && TILE_INFO[world.tiles[idx(world, xx, yy)]].cost <= 1.5) return { x: xx, y: yy };
      }
  return null;
}

export { TILE_INFO };
export type { Prop };
