// Строительство по воле правителя (фаза 14): размещение с проверками, дороги, зоны (поля, выпас,
// роща, жилой участок), снос с возвратом, улучшение, очередь строек, управление рабочими.
import type { Simulation } from './game';
import { Building, BuildingType, BUILDING_DEFS, District, Material, Roof } from '../world/buildings';
import { Tile, TILE_INFO } from '../world/tiles';
import { World, PropType, ResourceKind, idx, inBounds, isRoadTile, isWaterTile, isWalkableAt } from '../world/world';
import { BuildItem, NearReq, NEAR_NAMES, catalogItem } from '../data/buildCatalog';
import { Good } from '../economy/goods';
import { EventKind } from '../events/chronicle';
import { plantSapling } from './nature';
import { findHousing } from './construction';
import { interrupt } from '../ai/brain';
import { Profession, isChild, isElder } from './citizen';
import { assignJob, professionFor } from './population';

export interface PlaceCheck {
  ok: boolean;
  reason: string;
  /** Тайлы футпринта с признаком допустимости */
  tiles: { x: number; y: number; ok: boolean }[];
  door: { x: number; y: number; ok: boolean };
}

/** Тайл пригоден под фундамент (здания можно ставить и за стенами) */
export function tileBuildable(world: World, x: number, y: number): boolean {
  if (!inBounds(world, x, y)) return false;
  const i = idx(world, x, y);
  if (world.buildingAt[i] >= 0) return false;
  const sp = world.solidProp[i];
  if (sp >= 0) {
    // деревья и кусты вырубят при стройке; ограды, камни — нет
    const p = world.props[sp];
    if (!p || !(p.type === PropType.Tree || p.type === PropType.Pine || p.type === PropType.Bush || p.type === PropType.DeadTree)) return false;
  }
  const t = world.tiles[i] as Tile;
  return t === Tile.Grass || t === Tile.Meadow || t === Tile.Mud || t === Tile.Garden || t === Tile.Field || t === Tile.Pasture || t === Tile.Sand || t === Tile.Forest;
}

/** Единственные на город по воле правителя (остальные «уникальные» в генераторе можно строить ещё) */
const UNIQUE_BUILD = new Set<BuildingType>([BuildingType.Castle, BuildingType.TownHall, BuildingType.Cathedral]);

/** Дверь по ориентации: 0 юг, 1 запад, 2 север, 3 восток */
export function doorFor(x: number, y: number, w: number, h: number, facing: number): { x: number; y: number } {
  const mx = x + Math.floor(w / 2);
  const my = y + Math.floor(h / 2);
  if (facing === 1) return { x: x - 1, y: my };
  if (facing === 2) return { x: mx, y: y - 1 };
  if (facing === 3) return { x: x + w, y: my };
  return { x: mx, y: y + h };
}

function nearOk(world: World, x: number, y: number, w: number, h: number, req: NearReq, r: number): boolean {
  for (let yy = y - r; yy <= y + h + r; yy++)
    for (let xx = x - r; xx <= x + w + r; xx++) {
      if (!inBounds(world, xx, yy)) continue;
      const i = idx(world, xx, yy);
      const t = world.tiles[i] as Tile;
      switch (req) {
        case 'water': if (isWaterTile(t)) return true; break;
        case 'forest': if (t === Tile.Forest) return true; break;
        case 'stone': if ((t === Tile.Rock || t === Tile.Quarry) && world.resource[i] === ResourceKind.Stone && world.resourceAmount[i] > 0) return true; break;
        case 'clay': if (t === Tile.Clay) return true; break;
        case 'road': if (isRoadTile(t)) return true; break;
        case 'field': if (t === Tile.Field) return true; break;
        case 'iron': if (t === Tile.IronOre) return true; break;
        case 'swamp': if (t === Tile.Swamp) return true; break;
        case 'salt': if (t === Tile.Salt) return true; break;
      }
    }
  return false;
}

/** Проверка размещения здания */
export function checkPlace(sim: Simulation, item: BuildItem, x: number, y: number, facing: number): PlaceCheck {
  const world = sim.world;
  const type = item.type!;
  const def = BUILDING_DEFS[type];
  const w = def.minW;
  const h = def.minH;
  const tiles: PlaceCheck['tiles'] = [];
  let ok = true;
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) {
      const t = tileBuildable(world, xx, yy) && !(world.explored[idx(world, xx, yy)] === 0);
      if (!t) ok = false;
      tiles.push({ x: xx, y: yy, ok: t });
    }
  const d = doorFor(x, y, w, h, facing);
  const doorOk = inBounds(world, d.x, d.y) && world.buildingAt[idx(world, d.x, d.y)] < 0 && isWalkableAt(world, d.x, d.y) && !isWaterTile(world.tiles[idx(world, d.x, d.y)] as Tile);
  let reason = '';
  if (!ok) reason = 'Место занято или непригодно';
  else if (!doorOk) reason = 'Перед дверью должно быть свободно';
  else if (UNIQUE_BUILD.has(type) && world.buildings.some((b) => b.type === type && b.w > 0 && b.condition > 0)) reason = `${def.name} в городе может быть только один`;
  else if (item.minPop && sim.stats.population < item.minPop) reason = `Нужно население не меньше ${item.minPop}`;
  else if (item.near && !nearOk(world, x, y, w, h, item.near, item.nearR ?? 6)) reason = `Нужно ставить ${NEAR_NAMES[item.near]}`;
  // не рвать дороги и стены
  if (!reason) {
    for (const t of tiles) {
      const tt = world.tiles[idx(world, t.x, t.y)] as Tile;
      if (tt === Tile.Road || tt === Tile.Plaza || tt === Tile.Bridge || tt === Tile.Gate) {
        reason = 'Нельзя строить на улице';
        t.ok = false;
      }
    }
  }
  return { ok: !reason && ok && doorOk, reason, tiles, door: { ...d, ok: doorOk } };
}

function refreshProps(world: World): void {
  world.solidProp.fill(-1);
  world.props.forEach((p, i) => {
    if (p.solid) world.solidProp[idx(world, p.x, p.y)] = i;
  });
}

/** Заложить здание по воле правителя: стройплощадка в очереди, материалы подвезут строители */
export function placeBuilding(sim: Simulation, item: BuildItem, x: number, y: number, facing: number): Building | null {
  const chk = checkPlace(sim, item, x, y, facing);
  if (!chk.ok) return null;
  const world = sim.world;
  const type = item.type!;
  const def = BUILDING_DEFS[type];
  const w = def.minW;
  const h = def.minH;
  const district = world.district[idx(world, x, y)] as District;
  const material: Material = def.material === 'any' ? (type === BuildingType.Shack ? 'wood' : sim.rng.pick(['timber', 'wood'] as Material[])) : def.material;
  const roof: Roof = def.roof === 'any' ? (material === 'stone' ? 'slate' : sim.rng.pick(['tile', 'wood', 'thatch'] as Roof[])) : def.roof;
  const d = chk.door;
  const b: Building = {
    id: world.buildings.length, type, x, y, w, h, doorX: d.x, doorY: d.y, facing, material, roof, stories: def.stories,
    variant: sim.rng.int(0, 1000), name: '', residents: [], workers: [], owner: -1, condition: 0, storage: {}, district, lit: false, underConstruction: 0, buildStage: 0,
    maxWorkers: def.workers, priority: 0,
  };
  if (type === BuildingType.Tavern) b.name = sim.rng.pick(['Новый двор', 'У ворот', 'Пять подков', 'Тихий омут', 'Герб правителя']);
  // стоимость работ — из казны сразу
  sim.treasury -= item.money;
  b.storage['_cost_money'] = item.money;
  for (const [g, n] of Object.entries(item.cost)) b.storage[`_need_${g}`] = n ?? 0;
  world.buildings.push(b);
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) {
      const i = idx(world, xx, yy);
      world.buildingAt[i] = b.id;
      world.tiles[i] = Tile.Floor;
    }
  const di = idx(world, d.x, d.y);
  if (!isRoadTile(world.tiles[di] as Tile)) world.tiles[di] = Tile.Dirt;
  world.props = world.props.filter((p) => !(p.x >= x && p.x < x + w && p.y >= y && p.y < y + h));
  refreshProps(world);
  sim.pathfinder.invalidateRect(x - 1, y - 1, w + 2, h + 2);
  sim.buildingVersion++;
  sim.tileVersion++;
  sim.construction.queue.push(b.id);
  sim.chronicle.log(sim.tick, EventKind.Info, `По воле правителя заложен${def.name.endsWith('а') ? 'а' : def.name.endsWith('я') ? 'а' : ''} ${def.name.toLowerCase()}.`, d.x, d.y, [], 0.5);
  sim.events.emit('build:placed', { id: b.id, type });
  return b;
}

/** Материалы, которых стройке ещё не хватает (по каталогу; для старых стройплощадок — по площади) */
export function materialsLeft(b: Building): Partial<Record<Good, number>> {
  const out: Partial<Record<Good, number>> = {};
  let any = false;
  for (const k of Object.keys(b.storage)) {
    if (!k.startsWith('_need_')) continue;
    any = true;
    const g = k.slice(6) as Good;
    const left = (b.storage[k] ?? 0) - (b.storage[`_got_${g}`] ?? 0);
    if (left > 0.01) out[g] = left;
  }
  if (!any) {
    // отстройка руин и старые стройки: доски и камень по площади
    const area = b.w * b.h;
    const stone = b.material === 'stone' || b.material === 'brick' ? Math.ceil(area * 0.6) : Math.ceil(area * 0.15);
    const planks = Math.ceil(area * 0.5);
    b.storage['_need_planks'] = planks;
    b.storage['_need_stone'] = stone;
    return materialsLeft(b);
  }
  return out;
}

// ---------------------------------------------------------------- Дороги

/** Линия Брезенхема со снапом к 45°: от (x0,y0) к (x1,y1) */
export function snappedLine(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
  let dx = x1 - x0;
  let dy = y1 - y0;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  // снап: горизонталь, вертикаль или диагональ
  if (adx > ady * 2.5) dy = 0;
  else if (ady > adx * 2.5) dx = 0;
  else {
    const m = Math.max(adx, ady);
    dx = Math.sign(dx) * m;
    dy = Math.sign(dy) * m;
  }
  const out: { x: number; y: number }[] = [];
  const n = Math.max(Math.abs(dx), Math.abs(dy));
  for (let k = 0; k <= n; k++) {
    const x = x0 + Math.round((dx * k) / Math.max(1, n));
    const y = y0 + Math.round((dy * k) / Math.max(1, n));
    out.push({ x, y });
    // 4-связность на диагоналях
    if (dx && dy && k < n) out.push({ x: x0 + Math.round((dx * (k + 1)) / n), y });
  }
  return out;
}

export function roadTileOk(world: World, x: number, y: number, paved: boolean): boolean {
  if (!inBounds(world, x, y)) return false;
  const i = idx(world, x, y);
  if (world.buildingAt[i] >= 0 || !world.explored[i]) return false;
  const t = world.tiles[i] as Tile;
  if (t === Tile.Wall || t === Tile.Tower || t === Tile.Floor || t === Tile.Lake || t === Tile.Rock || t === Tile.IronOre) return false;
  if (t === Tile.Water || t === Tile.Shallow) {
    // мостки только через узкую воду (ручьи, мелководье)
    let span = 0;
    for (let k = -3; k <= 3; k++) if (inBounds(world, x + k, y) && isWaterTile(world.tiles[idx(world, x + k, y)] as Tile)) span++;
    let spanV = 0;
    for (let k = -3; k <= 3; k++) if (inBounds(world, x, y + k) && isWaterTile(world.tiles[idx(world, x, y + k)] as Tile)) spanV++;
    return Math.min(span, spanV) <= 3;
  }
  if (paved && t === Tile.Road) return false;
  if (!paved && (t === Tile.Road || t === Tile.Dirt || t === Tile.Plaza || t === Tile.Bridge || t === Tile.Gate)) return false;
  return true;
}

/** Проложить дорогу по тайлам; мощёная требует камень (берётся со складов, оплата из казны). Возвращает число тайлов */
export function buildRoad(sim: Simulation, tiles: { x: number; y: number }[], paved: boolean): number {
  const world = sim.world;
  let n = 0;
  const seen = new Set<number>();
  for (const t of tiles) {
    const i = idx(world, t.x, t.y);
    if (seen.has(i)) continue;
    seen.add(i);
    if (!roadTileOk(world, t.x, t.y, paved)) continue;
    const cur = world.tiles[i] as Tile;
    if (isWaterTile(cur)) {
      if (!takeMaterial(sim, 'planks', 2)) break;
      world.tiles[i] = Tile.Bridge;
    } else if (paved) {
      if (!takeMaterial(sim, 'stone', 1)) break;
      world.tiles[i] = Tile.Road;
    } else world.tiles[i] = Tile.Dirt;
    // убрать пропы и ресурсы под дорогой
    world.props = world.props.filter((p) => !(p.x === t.x && p.y === t.y && p.solid));
    if (world.resource[i] === ResourceKind.Berries || world.resource[i] === ResourceKind.Herbs || world.resource[i] === ResourceKind.Mushrooms) world.resource[i] = 0;
    n++;
  }
  if (n) {
    refreshProps(world);
    const xs = tiles.map((t) => t.x);
    const ys = tiles.map((t) => t.y);
    sim.pathfinder.invalidateRect(Math.min(...xs) - 1, Math.min(...ys) - 1, Math.max(...xs) - Math.min(...xs) + 3, Math.max(...ys) - Math.min(...ys) + 3);
    sim.tileVersion++;
  }
  return n;
}

/** Взять материал со складов/производств (оплата владельцу из казны по рыночной цене) */
export function takeMaterial(sim: Simulation, good: Good, n: number): boolean {
  const price = Math.max(1, Math.round(sim.market.prices[good] * n));
  if (sim.treasury < price) return false;
  const src = sim.world.buildings.find((b) => b.w > 0 && (b.storage[good] ?? 0) >= n && b.underConstruction === undefined);
  if (!src) return false;
  src.storage[good] -= n;
  sim.treasury -= price;
  const owner = src.owner >= 0 ? sim.citizens[src.owner] : null;
  if (owner && owner.alive) owner.money += price;
  else sim.treasury += price;
  sim.market.flow(good, 'стройка правителя', -n);
  return true;
}

/** Сколько материала доступно на складах (для подсказок) */
export function materialAvailable(sim: Simulation, good: Good): number {
  let s = 0;
  for (const b of sim.world.buildings) if (b.w > 0 && b.underConstruction === undefined) s += b.storage[good] ?? 0;
  return Math.floor(s);
}

// ---------------------------------------------------------------- Зоны

export function paintZone(sim: Simulation, zone: 'field' | 'pasture' | 'grove', cx: number, cy: number, r: number): number {
  const world = sim.world;
  let n = 0;
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++) {
      if (!inBounds(world, x, y) || Math.hypot(x - cx, y - cy) > r + 0.3) continue;
      const i = idx(world, x, y);
      if (!world.explored[i] || world.buildingAt[i] >= 0 || world.solidProp[i] >= 0 || world.inside[i]) continue;
      const t = world.tiles[i] as Tile;
      if (zone === 'grove') {
        if (plantSapling(sim, x, y)) n++;
        continue;
      }
      if (t !== Tile.Grass && t !== Tile.Meadow && !(zone === 'field' && t === Tile.Pasture) && !(zone === 'pasture' && t === Tile.Field)) continue;
      world.tiles[i] = zone === 'field' ? Tile.Field : Tile.Pasture;
      world.props = world.props.filter((p) => !(p.x === x && p.y === y));
      n++;
    }
  if (n) {
    refreshProps(world);
    sim.pathfinder.invalidateRect(cx - r - 1, cy - r - 1, r * 2 + 3, r * 2 + 3);
    sim.tileVersion++;
  }
  return n;
}

/** Жилой участок: дома ставятся вдоль дорог, примыкающих к прямоугольнику, фасадом к улице */
export function placePlot(sim: Simulation, x0: number, y0: number, x1: number, y1: number): Building[] {
  const world = sim.world;
  const rx0 = Math.min(x0, x1);
  const ry0 = Math.min(y0, y1);
  const rx1 = Math.max(x0, x1);
  const ry1 = Math.max(y0, y1);
  const item = catalogItem('house')!;
  const shack = catalogItem('shack')!;
  const placed: Building[] = [];
  const tryAt = (bx: number, by: number, facing: number): boolean => {
    for (const it of [item, shack]) {
      const def = BUILDING_DEFS[it.type!];
      const w = def.minW;
      const h = def.minH;
      if (bx < rx0 || by < ry0 || bx + w - 1 > rx1 || by + h - 1 > ry1) continue;
      const b = placeBuilding(sim, it, bx, by, facing);
      if (b) {
        placed.push(b);
        return true;
      }
    }
    return false;
  };
  // дороги вдоль границ участка
  for (let x = rx0; x <= rx1; x++) {
    // дорога снизу → дом фасадом на юг
    if (inBounds(world, x, ry1 + 1) && isRoadTile(world.tiles[idx(world, x, ry1 + 1)] as Tile)) {
      const w = BUILDING_DEFS[BuildingType.House].minW;
      if ((x - rx0) % w === Math.floor(w / 2)) tryAt(x - Math.floor(w / 2), ry1 - BUILDING_DEFS[BuildingType.House].minH + 1, 0);
    }
    // дорога сверху → фасад на север
    if (inBounds(world, x, ry0 - 1) && isRoadTile(world.tiles[idx(world, x, ry0 - 1)] as Tile)) {
      const w = BUILDING_DEFS[BuildingType.House].minW;
      if ((x - rx0) % w === Math.floor(w / 2)) tryAt(x - Math.floor(w / 2), ry0, 2);
    }
  }
  for (let y = ry0; y <= ry1; y++) {
    const h = BUILDING_DEFS[BuildingType.House].minH;
    if (inBounds(world, rx0 - 1, y) && isRoadTile(world.tiles[idx(world, rx0 - 1, y)] as Tile) && (y - ry0) % h === Math.floor(h / 2)) tryAt(rx0, y - Math.floor(h / 2), 1);
    if (inBounds(world, rx1 + 1, y) && isRoadTile(world.tiles[idx(world, rx1 + 1, y)] as Tile) && (y - ry0) % h === Math.floor(h / 2)) tryAt(rx1 - BUILDING_DEFS[BuildingType.House].minW + 1, y - Math.floor(h / 2), 3);
  }
  // задние дворы — сады
  for (let y = ry0; y <= ry1; y++)
    for (let x = rx0; x <= rx1; x++) {
      const i = idx(world, x, y);
      if (world.buildingAt[i] < 0 && (world.tiles[i] === Tile.Grass || world.tiles[i] === Tile.Meadow)) world.tiles[i] = Tile.Garden;
    }
  if (placed.length) sim.tileVersion++;
  return placed;
}

// ---------------------------------------------------------------- Снос и улучшение

export function demolishBuilding(sim: Simulation, id: number): string {
  const world = sim.world;
  const b = world.buildings[id];
  if (!b || b.w <= 0) return 'Здания нет.';
  if (b.type === BuildingType.Castle) return 'Замок лорда снести нельзя.';
  const def = BUILDING_DEFS[b.type];
  // жильцы и работники
  for (const cid of b.residents) {
    const c = sim.citizens[cid];
    if (!c || !c.alive) continue;
    if (c.inside === b.id) {
      c.inside = -1;
      c.x = b.doorX;
      c.y = b.doorY;
      c.px = c.x;
      c.py = c.y;
      interrupt(sim, c);
    }
    c.home = -1;
  }
  const former = b.residents.slice();
  b.residents = [];
  b.condition = 0; // чтобы переселение не вернуло в это же здание
  for (const cid of b.workers) {
    const c = sim.citizens[cid];
    if (!c || !c.alive) continue;
    if (c.inside === b.id) {
      c.inside = -1;
      c.x = b.doorX;
      c.y = b.doorY;
      interrupt(sim, c);
    }
    c.workplace = -1;
    c.profession = Profession.Laborer;
  }
  b.workers = [];
  for (const c of sim.citizens) if (c.alive && c.inside === b.id) {
    c.inside = -1;
    c.x = b.doorX;
    c.y = b.doorY;
    interrupt(sim, c);
  }
  // возврат половины материалов на склад (или деньгами в казну)
  const area = b.w * b.h;
  const refund: Partial<Record<Good, number>> = { planks: Math.ceil(area * 0.25), stone: b.material === 'stone' ? Math.ceil(area * 0.3) : Math.ceil(area * 0.07) };
  if (b.underConstruction !== undefined) for (const g of ['planks', 'stone'] as Good[]) refund[g] = Math.floor((b.storage[`_got_${g}`] ?? 0) * 0.5);
  const wh = world.buildings.find((o) => o.w > 0 && o.type === BuildingType.Warehouse && o.condition > 0 && o.underConstruction === undefined);
  const parts: string[] = [];
  for (const [g, n] of Object.entries(refund) as [Good, number][]) {
    if (!n) continue;
    if (wh) {
      wh.storage[g] = (wh.storage[g] ?? 0) + n;
      sim.market.flow(g, 'снос', n);
    } else sim.treasury += Math.round(n * sim.market.prices[g] * 0.5);
    parts.push(`${n} ${g === 'planks' ? 'досок' : 'камня'}`);
  }
  // освободить тайлы
  for (let yy = b.y; yy < b.y + b.h; yy++)
    for (let xx = b.x; xx < b.x + b.w; xx++) {
      const i = idx(world, xx, yy);
      if (world.buildingAt[i] === b.id) {
        world.buildingAt[i] = -1;
        world.tiles[i] = Tile.Dirt;
      }
    }
  const q = sim.construction.queue.indexOf(b.id);
  if (q >= 0) sim.construction.queue.splice(q, 1);
  const name = b.name ? `«${b.name}»` : def.name.toLowerCase();
  b.w = 0;
  b.h = 0;
  b.residents = [];
  b.storage = {};
  b.condition = 0;
  b.underConstruction = undefined;
  for (const cid of former) findHousing(sim, sim.citizens[cid]);
  sim.pathfinder.invalidate();
  sim.buildingVersion++;
  sim.tileVersion++;
  sim.chronicle.log(sim.tick, EventKind.Info, `Снесён${def.name.endsWith('а') ? 'а' : ''} ${name}${parts.length ? ` (на склад вернули ${parts.join(', ')})` : ''}.`, b.doorX, b.doorY, [], 0.5);
  sim.events.emit('build:demolished', { id: b.id, type: b.type });
  return `Снесено: ${name}.`;
}

/** Следующая ступень улучшения жилья */
export function upgradePlan(b: Building): { type: BuildingType; material: Material; roof: Roof; stories: number; label: string; cost: Partial<Record<Good, number>>; money: number } | null {
  if (b.type === BuildingType.Shack) return { type: BuildingType.House, material: 'wood', roof: 'wood', stories: 1, label: 'лачуга → дом', cost: { planks: 8, stone: 1 }, money: 20 };
  if (b.type === BuildingType.House && b.material === 'wood') return { type: BuildingType.House, material: 'timber', roof: 'tile', stories: Math.max(1, b.stories), label: 'дом → фахверк', cost: { planks: 10, stone: 4 }, money: 35 };
  if (b.type === BuildingType.House && b.material === 'timber') return { type: BuildingType.House, material: 'stone', roof: 'slate', stories: 2, label: 'фахверк → камень', cost: { planks: 6, stone: 14 }, money: 60 };
  return null;
}

export function upgradeBuilding(sim: Simulation, id: number): string {
  const b = sim.world.buildings[id];
  if (!b || b.w <= 0) return 'Здания нет.';
  if (b.underConstruction !== undefined) return 'Здание ещё строится.';
  const plan = upgradePlan(b);
  if (!plan) return 'Это здание улучшить нельзя.';
  if (sim.treasury < plan.money) return `В казне нет ${plan.money} монет.`;
  sim.treasury -= plan.money;
  b.upgradeTo = { type: plan.type, material: plan.material, roof: plan.roof, stories: plan.stories };
  b.underConstruction = 0;
  b.buildStage = 0;
  for (const k of Object.keys(b.storage)) if (k.startsWith('_need_') || k.startsWith('_got_') || k.startsWith('_paid')) delete b.storage[k];
  for (const [g, n] of Object.entries(plan.cost)) b.storage[`_need_${g}`] = n ?? 0;
  sim.construction.queue.push(b.id);
  sim.buildingVersion++;
  sim.chronicle.log(sim.tick, EventKind.Info, `Правитель велел улучшить жильё: ${plan.label}.`, b.doorX, b.doorY, [], 0.4);
  return `Улучшение начато: ${plan.label}.`;
}

/** По завершении стройки применить улучшение */
export function applyUpgrade(sim: Simulation, b: Building): void {
  if (!b.upgradeTo) return;
  const u = b.upgradeTo;
  b.type = u.type;
  b.material = u.material;
  b.roof = u.roof;
  b.stories = u.stories;
  b.upgradeTo = undefined;
  b.variant = sim.rng.int(0, 1000);
  for (const cid of b.residents) {
    const c = sim.citizens[cid];
    if (c && c.alive) c.mood += 8;
  }
}

// ---------------------------------------------------------------- Очередь и рабочие

export function queueMove(sim: Simulation, id: number, dir: -1 | 1): void {
  const q = sim.construction.queue;
  const i = q.indexOf(id);
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= q.length) return;
  [q[i], q[j]] = [q[j], q[i]];
}

export function setUrgent(sim: Simulation, id: number): void {
  const b = sim.world.buildings[id];
  if (!b) return;
  b.priority = b.priority === 2 ? 0 : 2;
  const q = sim.construction.queue;
  const i = q.indexOf(id);
  if (i > 0 && b.priority === 2) {
    q.splice(i, 1);
    q.unshift(id);
  }
}

export function setPaused(sim: Simulation, id: number, v: boolean): void {
  const b = sim.world.buildings[id];
  if (b) b.paused = v;
}

/** Нанять ещё одного работника (безработный взрослый поблизости) */
export function hireWorker(sim: Simulation, b: Building): string {
  const def = BUILDING_DEFS[b.type];
  if (!def.workers) return 'Здесь не работают.';
  const max = b.maxWorkers ?? def.workers;
  if (b.workers.length >= max) return 'Мест нет — увеличьте предел.';
  if (b.closed) return 'Здание закрыто.';
  const cands = sim.citizens.filter((c) => c.alive && !isChild(c) && !isElder(c) && c.workplace < 0 && !c.actionData.visitor && c.profession !== Profession.Guard && c.profession !== Profession.Lord && c.profession !== Profession.Noble && c.profession !== Profession.Beggar);
  if (!cands.length) return 'Нет свободных рук в городе.';
  cands.sort((p, q) => Math.hypot(p.x - b.doorX, p.y - b.doorY) - Math.hypot(q.x - b.doorX, q.y - b.doorY));
  const c = cands[0];
  assignJob(sim, c, b, professionFor(b.type, b.workers.length));
  interrupt(sim, c);
  return `${c.firstName} ${c.lastName} нанят${c.sex === 'f' ? 'а' : ''}.`;
}

export function fireWorker(sim: Simulation, b: Building): string {
  if (!b.workers.length) return 'Работников нет.';
  const id = b.workers[b.workers.length - 1];
  const c = sim.citizens[id];
  b.workers.pop();
  if (c) {
    c.workplace = -1;
    c.profession = Profession.Laborer;
    if (c.inside === b.id) {
      c.inside = -1;
      c.x = b.doorX;
      c.y = b.doorY;
    }
    interrupt(sim, c);
    c.mood -= 6;
    if (b.owner === c.id) b.owner = b.workers[0] ?? -1;
    return `${c.firstName} ${c.lastName} уволен${c.sex === 'f' ? 'а' : ''}.`;
  }
  return 'Уволен.';
}

export function setMaxWorkers(sim: Simulation, b: Building, n: number): void {
  const def = BUILDING_DEFS[b.type];
  b.maxWorkers = Math.max(0, Math.min(def.workers + 4, n));
  while (b.workers.length > b.maxWorkers) fireWorker(sim, b);
}

export function setClosed(sim: Simulation, b: Building, v: boolean): void {
  b.closed = v;
  if (v) for (const cid of b.workers) {
    const c = sim.citizens[cid];
    if (c && c.alive && c.inside === b.id) {
      c.inside = -1;
      c.x = b.doorX;
      c.y = b.doorY;
      interrupt(sim, c);
    }
  }
}

export { TILE_INFO, PropType };
export { farmFertility } from './nature';
