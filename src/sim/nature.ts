// Природа (фаза 13): деревья рубят и они отрастают, месторождения иссякают, ягоды-грибы-травы
// и рыба восстанавливаются по сезонам, дичь плодится, туман рассеивается, рудознатец ищет руду.
import type { Simulation } from './game';
import { Tile } from '../world/tiles';
import type { Building } from '../world/buildings';
import { World, PropType, ResourceKind, HIDDEN_RESOURCES, idx, inBounds, isWaterTile } from '../world/world';
import { reveal } from '../world/landscape';
import { TICKS_PER_DAY, TICKS_PER_HOUR, Season } from '../core/time';
import { AnimalKind, Animal } from './animals';

export const LOGS_PER_TREE = 6;
const STUMP_DAYS = 10; // пень → поросль
const SAPLING_DAYS = 14; // поросль → дерево

/** Срубить ближайшее дерево рядом с точкой; true — дерево повалено (пень остаётся) */
export function fellTree(sim: Simulation, x: number, y: number, r = 2): boolean {
  const world = sim.world;
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < world.props.length; i++) {
    const p = world.props[i];
    if (p.type !== PropType.Tree && p.type !== PropType.Pine) continue;
    const d = Math.abs(p.x - x) + Math.abs(p.y - y);
    if (d <= r && d < bd && !world.inside[idx(world, p.x, p.y)]) {
      bd = d;
      best = i;
    }
  }
  if (best < 0) return false;
  const p = world.props[best];
  p.type = PropType.Stump;
  p.solid = false;
  p.born = sim.tick;
  p.variant = 0;
  const i = idx(world, p.x, p.y);
  if (world.tiles[i] === Tile.Forest) world.tiles[i] = Tile.Grass;
  world.solidProp[i] = -1;
  sim.pathfinder.invalidateRect(p.x, p.y, 1, 1);
  sim.tileVersion++;
  return true;
}

/** Посадить поросль (рощу сажает правитель) */
export function plantSapling(sim: Simulation, x: number, y: number): boolean {
  const world = sim.world;
  if (!inBounds(world, x, y)) return false;
  const i = idx(world, x, y);
  const t = world.tiles[i] as Tile;
  if ((t !== Tile.Grass && t !== Tile.Meadow) || world.buildingAt[i] >= 0 || world.solidProp[i] >= 0 || world.inside[i]) return false;
  if (world.props.some((p) => p.x === x && p.y === y)) return false;
  world.props.push({ type: PropType.Bush, x, y, ox: 0.5, oy: 0.6, variant: 0, solid: false, born: sim.tick });
  sim.tileVersion++;
  return true;
}

/** Рост: пни → поросль → деревья (раз в день) */
function growForest(sim: Simulation): void {
  const world = sim.world;
  const tick = sim.tick;
  let changed = false;
  for (const p of world.props) {
    if (p.born === undefined) continue;
    const i = idx(world, p.x, p.y);
    if (p.type === PropType.Stump && tick - p.born > STUMP_DAYS * TICKS_PER_DAY && sim.rng.chance(0.5)) {
      p.type = PropType.Bush;
      p.variant = 0;
      p.born = tick;
      changed = true;
    } else if (p.type === PropType.Bush && p.variant === 0 && tick - p.born > SAPLING_DAYS * TICKS_PER_DAY && sim.rng.chance(0.5)) {
      if (world.buildingAt[i] >= 0 || world.inside[i]) continue;
      p.type = sim.rng.chance(0.3) ? PropType.Pine : PropType.Tree;
      p.variant = sim.rng.int(0, 3);
      p.solid = true;
      p.born = undefined;
      world.tiles[i] = Tile.Forest;
      world.solidProp[i] = world.props.indexOf(p);
      sim.pathfinder.invalidateRect(p.x, p.y, 1, 1);
      changed = true;
    }
  }
  if (changed) sim.tileVersion++;
}

/** Взять ресурс с ближайшего тайла в радиусе; возвращает сколько взято (0 — иссякло) */
export function takeResource(world: World, x: number, y: number, kind: ResourceKind, r: number, amount: number): number {
  let best = -1;
  let bd = Infinity;
  for (let yy = Math.max(0, y - r); yy <= Math.min(world.h - 1, y + r); yy++)
    for (let xx = Math.max(0, x - r); xx <= Math.min(world.w - 1, x + r); xx++) {
      const i = yy * world.w + xx;
      if (world.resource[i] !== kind || world.resourceAmount[i] <= 0 || !world.discovered[i]) continue;
      const d = Math.abs(xx - x) + Math.abs(yy - y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
  if (best < 0) return 0;
  const take = Math.min(amount, world.resourceAmount[best]);
  world.resourceAmount[best] -= Math.round(take) || (take > 0 ? 1 : 0);
  if (world.resourceAmount[best] <= 0) world.resourceAmount[best] = 0;
  return take;
}

/** Сколько ресурса осталось в радиусе */
export function resourceNear(world: World, x: number, y: number, kind: ResourceKind, r: number): number {
  let sum = 0;
  for (let yy = Math.max(0, y - r); yy <= Math.min(world.h - 1, y + r); yy++)
    for (let xx = Math.max(0, x - r); xx <= Math.min(world.w - 1, x + r); xx++) {
      const i = yy * world.w + xx;
      if (world.resource[i] === kind && world.discovered[i]) sum += world.resourceAmount[i];
    }
  return sum;
}

/** Сезонное восстановление: ягоды, грибы, травы, рыба (раз в день) */
function regenGatherables(sim: Simulation): void {
  const world = sim.world;
  const s = sim.season;
  const n = world.w * world.h;
  for (let i = 0; i < n; i++) {
    const r = world.resource[i];
    if (!r) continue;
    const a = world.resourceAmount[i];
    if (r === ResourceKind.Berries) {
      if ((s === Season.Summer || s === Season.Autumn) && a < 30) world.resourceAmount[i] = a + 2;
      else if (s === Season.Winter && a > 0) world.resourceAmount[i] = Math.max(0, a - 3);
    } else if (r === ResourceKind.Mushrooms) {
      if (s === Season.Autumn && a < 15) world.resourceAmount[i] = a + 2;
      else if (s === Season.Winter && a > 0) world.resourceAmount[i] = Math.max(0, a - 2);
    } else if (r === ResourceKind.Herbs) {
      if ((s === Season.Spring || s === Season.Summer) && a < 15) world.resourceAmount[i] = a + 1;
      else if (s === Season.Winter && a > 0) world.resourceAmount[i] = Math.max(0, a - 2);
    } else if (r === ResourceKind.Fish) {
      const max = world.tiles[i] === Tile.Lake ? 25 : 14;
      if (a < max && s !== Season.Winter) world.resourceAmount[i] = a + 1;
    }
  }
}

/** Дичь: олени и кабаны живут на опушках, популяция растёт до предела по площади леса */
function regenGame(sim: Simulation): void {
  const world = sim.world;
  let forest = 0;
  for (let i = 0; i < world.w * world.h; i++) if (world.tiles[i] === Tile.Forest) forest++;
  const cap = Math.max(4, Math.min(36, Math.round(forest / 500)));
  const game = sim.animals.filter((a) => a.alive && (a.kind === AnimalKind.Deer || a.kind === AnimalKind.Boar)).length;
  if (game >= cap) return;
  const born = Math.max(1, Math.round(cap * 0.08));
  for (let k = 0; k < born; k++) spawnGame(sim);
}

export function spawnGame(sim: Simulation): Animal | null {
  const world = sim.world;
  const rng = sim.rng;
  for (let t = 0; t < 60; t++) {
    const x = rng.int(2, world.w - 3);
    const y = rng.int(2, world.h - 3);
    const i = idx(world, x, y);
    if (world.inside[i] || world.buildingAt[i] >= 0) continue;
    const tt = world.tiles[i] as Tile;
    if (tt !== Tile.Grass && tt !== Tile.Meadow) continue;
    let forestNear = false;
    for (let dy = -2; dy <= 2 && !forestNear; dy++) for (let dx = -2; dx <= 2; dx++) if (inBounds(world, x + dx, y + dy) && world.tiles[idx(world, x + dx, y + dy)] === Tile.Forest) forestNear = true;
    if (!forestNear) continue;
    const kind = rng.chance(0.65) ? AnimalKind.Deer : AnimalKind.Boar;
    const a: Animal = { kind, x, y, px: x, py: y, tx: x, ty: y, dir: 0, wait: rng.int(0, 60), anim: 0, homeX: x, homeY: y, alive: true };
    sim.animals.push(a);
    return a;
  }
  return null;
}

/** Туман: горожане разведывают округу */
function revealAround(sim: Simulation): void {
  const world = sim.world;
  if (!world.fog) return;
  let any = false;
  for (const c of sim.citizens) {
    if (!c.alive || c.inside >= 0) continue;
    if (reveal(world, Math.round(c.x), Math.round(c.y), 6)) any = true;
  }
  if (any) sim.region.exploredVersion++;
}

/** Открыть скрытый ресурс рядом с точкой; возвращает вид найденного */
export function discoverNear(sim: Simulation, x: number, y: number, r: number): ResourceKind {
  const world = sim.world;
  let found: ResourceKind = ResourceKind.None;
  for (let yy = Math.max(0, y - r); yy <= Math.min(world.h - 1, y + r); yy++)
    for (let xx = Math.max(0, x - r); xx <= Math.min(world.w - 1, x + r); xx++) {
      const i = yy * world.w + xx;
      const k = world.resource[i] as ResourceKind;
      if (!HIDDEN_RESOURCES.has(k) || world.discovered[i]) continue;
      world.discovered[i] = 1;
      if (k === ResourceKind.Iron) world.tiles[i] = Tile.IronOre;
      if (k === ResourceKind.Salt && !isWaterTile(world.tiles[i] as Tile) && world.buildingAt[i] < 0) world.tiles[i] = Tile.Salt;
      found = k;
    }
  if (found) {
    sim.tileVersion++;
    sim.pathfinder.invalidateRect(x - r, y - r, r * 2 + 1, r * 2 + 1);
  }
  return found;
}

/** Множитель плодородия для фермы: средняя плодородность полей в радиусе работы */
export function farmFertility(world: World, b: Building, r = 14): number {
  let sum = 0;
  let n = 0;
  for (let y = b.y - r; y <= b.y + b.h + r; y++)
    for (let x = b.x - r; x <= b.x + b.w + r; x++) {
      if (!inBounds(world, x, y)) continue;
      const i = idx(world, x, y);
      if (world.tiles[i] === Tile.Field) {
        sum += world.fertility[i];
        n++;
      }
    }
  if (!n) return 0.25;
  // мало полей — мало урожая; 30+ тайлов — полная сила
  return Math.min(1, n / 30) * (0.5 + sum / n) ;
}


/** Ежетиковое обновление природы (вызывается из Region) */
export function updateNature(sim: Simulation): void {
  const t = sim.tick;
  if (t % 20 === 7) revealAround(sim);
  if (t % TICKS_PER_DAY === TICKS_PER_HOUR * 3) {
    growForest(sim);
    regenGatherables(sim);
    regenGame(sim);
  }
}

