// Разрушение, руины, отстройка по стадиям, новые дома, рост и упадок города.
import type { Simulation } from './game';
import { Citizen, CitizenState, Profession, Trait, isChild, isElder, fullName, hasTrait } from './citizen';
import { ACTIONS, ActionDef, actFor, goTo, say, think, remember } from '../ai/actions';
import { makeCtx, interrupt } from '../ai/brain';
import { Building, BuildingType, BUILDING_DEFS, District, Material, Roof, workerCap } from '../world/buildings';
import { EventKind } from '../events/chronicle';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_YEAR } from '../core/time';
import { idx, isRoadTile, nearestWalkable, inBounds } from '../world/world';
import { Tile } from '../world/tiles';
import { isWorkHour } from './schedule';
import { newCitizen, moveIn, assignJob, professionFor, randomTraits } from './population';
import { MALE_NAMES, FEMALE_NAMES, SURNAMES } from './names';
import { dist2 } from '../core/math';
import { materialsLeft, applyUpgrade } from './build';
import type { Good } from '../economy/goods';

export const STAGE_NAMES = ['фундамент', 'каркас', 'стены', 'крыша'];

/** Здание разрушено: жильцы бездомные, рабочие без работы (пока), ставится в очередь на отстройку */
export function onBuildingDestroyed(sim: Simulation, b: Building, cause: string): void {
  b.condition = 0;
  b.lit = false;
  b.underConstruction = 0;
  b.buildStage = 0;
  b.storage = {};
  // жильцы выходят и ищут жильё
  for (const id of b.residents) {
    const c = sim.citizens[id];
    if (!c || !c.alive) continue;
    if (c.inside === b.id) {
      c.inside = -1;
      c.x = b.doorX;
      c.y = b.doorY;
      c.px = c.x;
      c.py = c.y;
      interrupt(sim, c);
    }
    c.actionData.oldHome = b.id;
    c.home = -1;
    remember(c, sim.tick, `Наш дом разрушен (${cause}). Мы остались без крова.`, 0.9, -1, 'homeless');
    c.mood -= 30;
    c.needs.safety = Math.max(0, c.needs.safety - 40);
  }
  const former = b.residents.slice();
  b.residents = [];
  for (const id of former) findHousing(sim, sim.citizens[id]);
  for (const id of b.workers) {
    const c = sim.citizens[id];
    if (c && c.alive && c.inside === b.id) {
      c.inside = -1;
      c.x = b.doorX;
      c.y = b.doorY;
      interrupt(sim, c);
    }
  }
  sim.chronicle.log(sim.tick, EventKind.Disaster, `${sim.buildingDefName(b)} ${b.name ? `«${b.name}» ` : ''}лежит в руинах (${cause}). Горожане разбирают завалы.`, b.doorX, b.doorY, [], 0.8);
  sim.pathfinder.invalidate();
}

/** Поиск жилья бездомному: дом с местом, лучше — родня/друзья */
export function findHousing(sim: Simulation, c: Citizen): boolean {
  if (!c || !c.alive || c.home >= 0) return false;
  let best: Building | null = null;
  let bestScore = -Infinity;
  for (const b of sim.world.buildings) {
    const def = BUILDING_DEFS[b.type];
    if (!def.home || b.condition <= 0 || b.underConstruction !== undefined) continue;
    if (b.type === BuildingType.Barracks || b.type === BuildingType.Castle || b.type === BuildingType.Monastery) continue;
    if (b.residents.length >= def.capacity) continue;
    let s = -dist2(b.x, b.y, c.x, c.y) / 100;
    for (const id of b.residents) {
      const o = sim.citizens[id];
      if (!o) continue;
      if (o.spouse === c.id || o.children.includes(c.id) || c.children.includes(o.id) || o.parents.includes(c.id)) s += 100;
      s += (c.relations.get(id) ?? 0) * 0.3;
    }
    if (b.residents.length === 0) s += 20;
    if (s > bestScore) {
      bestScore = s;
      best = b;
    }
  }
  if (!best) return false;
  c.home = best.id;
  best.residents.push(c.id);
  remember(c, sim.tick, best.residents.length > 1 ? `Приютили в доме ${fullName(sim.citizens[best.residents[0]])}.` : 'Переехал в пустующий дом.', 0.5, -1, 'moved');
  return true;
}

/** Материалы на отстройку */
/** Строительные работы: раз в 50 тиков назначаем строителей по очереди строек */
export function updateConstruction(sim: Simulation): void {
  const tick = sim.tick;
  if (tick % 50 !== 0) return;
  const q = sim.construction.queue;
  // синхронизировать очередь со стройками (руины попадают в конец)
  for (const b of sim.world.buildings) if (b.w > 0 && b.underConstruction !== undefined && b.underConstruction < 1 && !q.includes(b.id)) q.push(b.id);
  for (let i = q.length - 1; i >= 0; i--) {
    const b = sim.world.buildings[q[i]];
    if (!b || b.w <= 0 || b.underConstruction === undefined) q.splice(i, 1);
  }
  const sites = q.map((id) => sim.world.buildings[id]).filter((b) => !b.paused);
  if (!sites.length) return;
  // строители: плотники, каменщики, подёнщики (в рабочие часы), пожарные-добровольцы
  const builders = sim.citizens.filter((c) => {
    if (!c.alive || c.inside >= 0 && c.state === CitizenState.Sleeping) return false;
    if (c.action === 'build' || c.order || c.jailedUntil > tick || c.actionData.visitor) return false;
    if (!(c.profession === Profession.Carpenter || c.profession === Profession.Mason || c.profession === Profession.Laborer || (c.flags & 1 && c.profession !== Profession.Guard))) return false;
    const s = sim.scheduleOf(c);
    const h = (tick % TICKS_PER_DAY) / TICKS_PER_HOUR;
    return isWorkHour({ ...s, workStart: s.workStart || 7, workEnd: s.workEnd || 18 }, h) || (h >= 7 && h < 18 && c.workplace < 0);
  });
  if (!builders.length) return;
  for (const site of sites) {
    const onSite = sim.citizens.filter((c) => c.alive && c.action === 'build' && c.actionData.site === site.id).length;
    const want = Math.min(site.priority === 2 ? 6 : 4, 1 + Math.floor((site.w * site.h) / 8) + (site.priority === 2 ? 2 : 0));
    for (let k = onSite; k < want && builders.length; k++) {
      builders.sort((a, b) => dist2(a.x, a.y, site.doorX, site.doorY) - dist2(b.x, b.y, site.doorX, site.doorY));
      const c = builders.shift()!;
      interrupt(sim, c);
      c.action = 'build';
      c.actionData.site = site.id;
      c.actionData.phase = 0;
      think(c, sim.rng.pick(['Пора отстраивать.', 'Брёвна, камень — и дом будет как новый.', 'Работы на неделю.', 'Разберём завалы.']));
      const spot = nearestWalkable(sim.world, site.doorX + sim.rng.int(-1, 1), site.doorY + sim.rng.int(0, 1), 3);
      const ctx = makeCtx(sim, c);
      if (!spot || !goTo(ctx, spot.x, spot.y)) c.action = '';
    }
  }
}

/** Где взять материал для стройки: склад, лесопилка, каменоломня, двор каменщика */
function materialSource(sim: Simulation, site: Building, good: Good): Building | null {
  let best: Building | null = null;
  let bd = Infinity;
  for (const b of sim.world.buildings) {
    if (b.w <= 0 || b.id === site.id || b.underConstruction !== undefined || b.condition <= 0) continue;
    if ((b.storage[good] ?? 0) < 1) continue;
    if (!(b.type === BuildingType.Warehouse || b.type === BuildingType.Sawmill || b.type === BuildingType.Quarry || b.type === BuildingType.Mason || b.type === BuildingType.Carpenter || b.type === BuildingType.Merchant)) continue;
    const d = dist2(b.doorX, b.doorY, site.doorX, site.doorY);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

const build: ActionDef = {
  id: 'build',
  interruptible: true,
  score(ctx) {
    const { c, sim, hour, sched } = ctx;
    if (c.action !== 'build') return 0;
    const site = sim.world.buildings[c.actionData.site];
    if (!site || site.underConstruction === undefined || site.underConstruction >= 1 || site.paused) return 0;
    if (!isWorkHour({ ...sched, workStart: sched.workStart || 7, workEnd: sched.workEnd || 18 }, hour)) return 0;
    if (c.needs.hunger < 25 || c.needs.energy < 15) return 0;
    return 70;
  },
  start(ctx) {
    const { c, sim } = ctx;
    const site = sim.world.buildings[c.actionData.site];
    if (!site) return false;
    c.actionData.phase = 0;
    const spot = nearestWalkable(sim.world, site.doorX + ctx.rng.int(-1, 1), site.doorY + ctx.rng.int(0, 1), 3);
    if (!spot) return false;
    return goTo(ctx, spot.x, spot.y);
  },
  arrive(ctx) {
    const { c, sim, rng } = ctx;
    const site = sim.world.buildings[c.actionData.site];
    if (!site || site.underConstruction === undefined) return actFor(ctx, 5);
    const phase = c.actionData.phase ?? 0;
    if (phase === 1) {
      // пришёл к источнику материалов: взять и нести на стройку
      const src = sim.world.buildings[c.actionData.haulFrom];
      const good = c.actionData.haulGood === 1 ? 'stone' : 'planks';
      if (src) {
        const left = materialsLeft(site)[good as Good] ?? 0;
        const n = Math.min(6, Math.floor(src.storage[good] ?? 0), Math.ceil(left));
        const price = Math.round(n * sim.market.prices[good as Good]);
        if (n > 0 && sim.treasury >= price) {
          src.storage[good] -= n;
          sim.treasury -= price;
          const owner = src.owner >= 0 ? sim.citizens[src.owner] : null;
          if (owner && owner.alive && owner.id !== c.id) owner.money += price;
          else sim.treasury += price;
          c.inventory[good] = (c.inventory[good] ?? 0) + n;
          c.actionData.hauling = 1;
          sim.market.flow(good as Good, 'стройка', -n);
          if (rng.chance(0.4)) say(c, rng.pick(['Грузим на стройку.', 'Доски — на стройку!', 'Камень пошёл.']), 30, false, sim.tick);
        } else if (rng.chance(0.3)) think(c, price > sim.treasury ? 'Казна не платит за материалы.' : 'Материалов нет.');
      }
      c.actionData.phase = 2;
      const spot = nearestWalkable(sim.world, site.doorX, site.doorY, 3);
      if (spot) goTo(ctx, spot.x, spot.y);
      else actFor(ctx, 10);
      return;
    }
    if (phase === 2) {
      // принёс: сложить на площадке
      for (const good of ['planks', 'stone'] as const) {
        const n = c.inventory[good] ?? 0;
        if (n > 0) {
          site.storage[`_got_${good}`] = (site.storage[`_got_${good}`] ?? 0) + n;
          c.inventory[good] = 0;
        }
      }
      c.actionData.hauling = 0;
      c.actionData.phase = 0;
    }
    c.dir = 3;
    actFor(ctx, 30 * 5);
  },
  tick(ctx) {
    const { c, sim, rng } = ctx;
    const site = sim.world.buildings[c.actionData.site];
    if (!site || site.underConstruction === undefined) return true;
    if ((c.actionData.phase ?? 0) !== 0) return false;
    // материалы: чего не хватает — сходить и принести
    const left = materialsLeft(site);
    const stage = site.buildStage ?? 0;
    const needNow = (g: 'planks' | 'stone'): number => {
      const total = site.storage[`_need_${g}`] ?? 0;
      const got = site.storage[`_got_${g}`] ?? 0;
      // к каждой стадии нужна четверть материалов
      return Math.max(0, Math.ceil((total * (stage + 1)) / 4) - got);
    };
    const missing: ('planks' | 'stone')[] = [];
    if (needNow('planks') > 0 && (left.planks ?? 0) > 0) missing.push('planks');
    if (needNow('stone') > 0 && (left.stone ?? 0) > 0) missing.push('stone');
    if (missing.length) {
      const good = rng.pick(missing);
      const src = materialSource(sim, site, good);
      if (!src) {
        if (rng.chance(0.03)) think(c, rng.pick(['Нет досок — стройка стоит.', 'Ждём камень с каменоломни.', 'На складе пусто.']));
        return false;
      }
      c.actionData.phase = 1;
      c.actionData.haulFrom = src.id;
      c.actionData.haulGood = good === 'stone' ? 1 : 0;
      if (rng.chance(0.5)) think(c, good === 'stone' ? 'Схожу за камнем.' : 'Схожу за досками.');
      goTo(ctx, src.doorX, src.doorY);
      return false;
    }
    let rate = 0.0025;
    if (c.profession === Profession.Carpenter || c.profession === Profession.Mason) rate *= 1.6;
    if (hasTrait(c, Trait.Hardworking)) rate *= 1.2;
    rate /= Math.max(1, (site.w * site.h) / 12);
    site.underConstruction = Math.min(1, (site.underConstruction ?? 0) + rate);
    const newStage = Math.min(3, Math.floor(site.underConstruction * 4));
    if (newStage !== site.buildStage) {
      site.buildStage = newStage;
      sim.buildingVersion++;
      if (rng.chance(0.6)) say(c, rng.pick([`Готов ${STAGE_NAMES[newStage]}!`, 'Хорошо идёт!', 'Ещё немного!']), 35, false, sim.tick);
    }
    c.animPhase += 0.5;
    if (rng.chance(0.03)) say(c, rng.pick(['Тук-тук-тук.', 'Подай доску!', 'Держи камень!', 'Ровнее клади!']), 25, false, sim.tick);
    if (site.underConstruction >= 1) finishConstruction(sim, site);
    return false;
  },
  finish(ctx) {
    const { c, sim } = ctx;
    const site = sim.world.buildings[c.actionData.site];
    if (c.action === 'build' && (!site || site.underConstruction === undefined)) c.action = '';
  },
};

function finishConstruction(sim: Simulation, b: Building): void {
  b.underConstruction = undefined;
  b.buildStage = undefined;
  b.condition = 1;
  applyUpgrade(sim, b);
  for (const k of Object.keys(b.storage)) if (k.startsWith('_need_') || k.startsWith('_got_')) delete b.storage[k];
  if (BUILDING_DEFS[b.type].workers > 0 && !b.workers.length) jobMarket(sim, b);
  const qi = sim.construction.queue.indexOf(b.id);
  if (qi >= 0) sim.construction.queue.splice(qi, 1);
  sim.events.emit('building:done', { id: b.id });
  for (const k of Object.keys(b.storage)) if (k.startsWith('_paid')) delete b.storage[k];
  sim.buildingVersion++;
  sim.pathfinder.invalidate();
  const def = BUILDING_DEFS[b.type];
  // бывшие жильцы возвращаются, если бездомны
  for (const c of sim.citizens) {
    if (!c.alive || c.actionData.oldHome !== b.id) continue;
    c.actionData.oldHome = -1;
    if (b.residents.length >= def.capacity) break;
    if (c.home >= 0) {
      const cur = sim.world.buildings[c.home];
      if (cur.residents.length <= 2 && cur.id !== b.id) continue; // уже обжился в пустом доме
      cur.residents = cur.residents.filter((id) => id !== c.id);
    }
    c.home = b.id;
    b.residents.push(c.id);
    remember(c, sim.tick, 'Наш дом отстроили заново!', 0.7, -1, 'rebuilt');
    c.mood += 20;
  }
  for (const c of sim.citizens) if (c.alive && c.action === 'build' && c.actionData.site === b.id) {
    c.action = '';
    c.state = CitizenState.Idle;
    c.nextThink = sim.tick;
    remember(c, sim.tick, `Отстроил${c.sex === 'f' ? 'а' : ''} ${def.name.toLowerCase()}.`, 0.5, -1, 'built');
  }
  sim.chronicle.log(sim.tick, EventKind.Info, `${def.name} отстроен${def.name.endsWith('а') ? 'а' : def.name.endsWith('я') ? 'а' : ''} заново.`, b.doorX, b.doorY, [], 0.6);
  // новые дома заселяем бездомными/приезжими
  if (def.home) for (const c of sim.citizens) if (c.alive && c.home < 0 && b.residents.length < def.capacity) findHousing(sim, c);
}

// ---------------------------------------------------------------- Новые дома

/** Найти участок под новый дом: внутри стен, у дороги, 3×3 или 4×3 */
export function findLot(sim: Simulation, w: number, h: number): { x: number; y: number; doorX: number; doorY: number } | null {
  const world = sim.world;
  const rng = sim.rng;
  const cands: { x: number; y: number }[] = [];
  for (let y = 3; y < world.h - 3; y++)
    for (let x = 3; x < world.w - 3; x++) {
      const i = idx(world, x, y);
      if (!world.inside[i]) continue;
      if (!isRoadTile(world.tiles[i] as Tile)) continue;
      if (world.tiles[i] === Tile.Plaza) continue;
      cands.push({ x, y });
    }
  rng.shuffle(cands);
  const ok = (x: number, y: number) => {
    if (!inBounds(world, x, y)) return false;
    const i = idx(world, x, y);
    if (!world.inside[i] || world.buildingAt[i] >= 0 || world.solidProp[i] >= 0) return false;
    const t = world.tiles[i] as Tile;
    return t === Tile.Grass || t === Tile.Garden || t === Tile.Meadow || t === Tile.Mud;
  };
  for (let k = 0; k < Math.min(cands.length, 600); k++) {
    const d = cands[k];
    for (let o = 0; o < w; o++) {
      const x0 = d.x - o;
      const y0 = d.y - h;
      let fine = true;
      for (let yy = y0 - 1; yy <= y0 + h - 1 && fine; yy++)
        for (let xx = x0 - 1; xx <= x0 + w; xx++) {
          const inFoot = xx >= x0 && xx < x0 + w && yy >= y0 && yy < y0 + h;
          if (inFoot) {
            if (!ok(xx, yy)) {
              fine = false;
              break;
            }
          } else {
            if (!inBounds(world, xx, yy)) {
              fine = false;
              break;
            }
            const t = world.tiles[idx(world, xx, yy)];
            if (t === Tile.Wall || t === Tile.Tower || t === Tile.Gate) {
              fine = false;
              break;
            }
            if (world.buildingAt[idx(world, xx, yy)] >= 0 && (yy < y0 || yy >= y0 + h)) {
              fine = false;
              break;
            }
          }
        }
      if (fine) return { x: x0, y: y0, doorX: d.x, doorY: d.y };
    }
  }
  return null;
}

export function startNewBuilding(sim: Simulation, type: BuildingType, reason: string): Building | null {
  const def = BUILDING_DEFS[type];
  const w = sim.rng.int(def.minW, def.maxW);
  const h = sim.rng.int(def.minH, def.maxH);
  const lot = findLot(sim, w, h);
  if (!lot) return null;
  const world = sim.world;
  const district = world.district[idx(world, lot.x, lot.y)] as District;
  const material: Material = district === District.Slums ? 'wood' : sim.rng.pick(['timber', 'wood', 'stone'] as Material[]);
  const roof: Roof = district === District.Slums ? 'thatch' : sim.rng.pick(['tile', 'thatch', 'wood'] as Roof[]);
  const b: Building = {
    id: world.buildings.length, type, x: lot.x, y: lot.y, w, h, doorX: lot.doorX, doorY: lot.doorY, facing: 0, material, roof, stories: 1,
    variant: sim.rng.int(0, 1000), name: '', residents: [], workers: [], owner: -1, condition: 0, storage: {}, district, lit: false, underConstruction: 0, buildStage: 0,
  };
  if (type === BuildingType.Tavern) b.name = sim.rng.pick(['Новый двор', 'У ворот', 'Пять подков', 'Тихий омут']);
  world.buildings.push(b);
  for (let yy = b.y; yy < b.y + b.h; yy++)
    for (let xx = b.x; xx < b.x + b.w; xx++) {
      const i = idx(world, xx, yy);
      world.buildingAt[i] = b.id;
      world.tiles[i] = Tile.Floor;
    }
  const di = idx(world, b.doorX, b.doorY);
  if (!isRoadTile(world.tiles[di] as Tile)) world.tiles[di] = Tile.Dirt;
  // убрать пропы под зданием
  world.props = world.props.filter((p) => !(p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h));
  world.solidProp.fill(-1);
  world.props.forEach((p, i) => {
    if (p.solid) world.solidProp[idx(world, p.x, p.y)] = i;
  });
  sim.pathfinder.invalidate();
  sim.buildingVersion++;
  sim.tileVersion++;
  sim.chronicle.log(sim.tick, EventKind.Info, `Заложен${def.name.endsWith('а') ? 'а' : ''} ${def.name.toLowerCase()} (${reason}). Город растёт.`, b.doorX, b.doorY, [], 0.6);
  return b;
}

// ---------------------------------------------------------------- Рост и упадок

export function updateGrowth(sim: Simulation): void {
  const tick = sim.tick;
  // Дни рождения — раз в день в 0:30
  if (tick % TICKS_PER_DAY === 150) agePeople(sim);
  // Рождения — раз в день 5:00
  if (tick % TICKS_PER_DAY === TICKS_PER_HOUR * 5) births(sim);
  // Приезжие и новые дома — раз в день в 12:00
  if (tick % TICKS_PER_DAY === TICKS_PER_HOUR * 12) migration(sim);
  // Биржа труда — раз в день в 10:00: безработные идут туда, где есть места (сначала приоритетные)
  if (tick % TICKS_PER_DAY === TICKS_PER_HOUR * 10) jobMarket(sim);
}

/** Безработные взрослые занимают свободные места; здания с приоритетом — первыми, ближние — раньше */
export function jobMarket(sim: Simulation, only?: Building): number {
  const free = sim.citizens.filter((c) => c.alive && !isChild(c) && !isElder(c) && c.workplace < 0 && !c.actionData.visitor && (c.profession === Profession.None || c.profession === Profession.Laborer) && c.jailedUntil <= sim.tick);
  if (!free.length) return 0;
  const sites = (only ? [only] : sim.world.buildings).filter((b) => b.w > 0 && b.condition > 0 && b.underConstruction === undefined && BUILDING_DEFS[b.type].workers > 0 && b.type !== BuildingType.Castle && b.workers.length < workerCap(b));
  sites.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  let hired = 0;
  for (const b of sites) {
    while (b.workers.length < workerCap(b) && free.length) {
      free.sort((p, q) => dist2(p.x, p.y, b.doorX, b.doorY) - dist2(q.x, q.y, b.doorX, b.doorY));
      const c = free.shift()!;
      assignJob(sim, c, b, professionFor(b.type, b.workers.length));
      remember(c, sim.tick, `Нанялся${c.sex === 'f' ? 'ась' : ''} в ${BUILDING_DEFS[b.type].name.toLowerCase()}.`, 0.5, -1, 'job');
      hired++;
    }
  }
  return hired;
}

function agePeople(sim: Simulation): void {
  for (const c of sim.citizens) {
    if (!c.alive) continue;
    const age = Math.floor((sim.tick - c.birthTick) / TICKS_PER_YEAR);
    if (age === c.age) continue;
    c.age = age;
    if (age === 14 && c.profession === Profession.Child) {
      c.profession = Profession.None;
      remember(c, sim.tick, 'Вырос и стал взрослым.', 0.7, -1, 'adult');
      // семейное ремесло или первая работа
      const parent = c.parents.map((id) => sim.citizens[id]).find((p) => p && p.alive && p.workplace >= 0);
      const wp = parent ? sim.world.buildings[parent.workplace] : null;
      if (wp && wp.workers.length < workerCap(wp, 2)) assignJob(sim, c, wp, professionFor(wp.type, wp.workers.length));
      else {
        const site = sim.world.buildings.find((b) => BUILDING_DEFS[b.type].workers > 0 && b.workers.length < workerCap(b) && b.type !== BuildingType.Castle && b.condition > 0 && b.underConstruction === undefined);
        if (site) assignJob(sim, c, site, professionFor(site.type, site.workers.length));
        else c.profession = Profession.Laborer;
      }
      sim.chronicle.log(sim.tick, EventKind.Info, `${fullName(c)} вырос${c.sex === 'f' ? 'ла' : ''}: теперь ${sim.professionName(c).toLowerCase()}.`, Math.round(c.x), Math.round(c.y), [c.id], 0.3);
    }
    if (age === 62 && c.workplace >= 0 && c.profession !== Profession.Lord && c.profession !== Profession.Burgomaster && c.profession !== Profession.Priest) {
      const wp = sim.world.buildings[c.workplace];
      wp.workers = wp.workers.filter((id) => id !== c.id);
      if (wp.owner === c.id) {
        const heir = c.children.map((id) => sim.citizens[id]).find((k) => k && k.alive && !isChild(k));
        if (heir) {
          assignJob(sim, heir, wp, professionFor(wp.type, 0));
          wp.owner = heir.id;
          remember(heir, sim.tick, `Отец передал мне ${BUILDING_DEFS[wp.type].name.toLowerCase()}.`, 0.8, c.id, 'inherit');
        } else wp.owner = wp.workers[0] ?? -1;
      }
      c.workplace = -1;
      c.profession = Profession.Elder;
      remember(c, sim.tick, 'Отошёл от дел — годы не те.', 0.6, -1, 'retired');
    }
  }
}

function births(sim: Simulation): void {
  for (const c of sim.citizens) {
    if (!c.alive || c.sex !== 'f' || c.spouse < 0 || c.age < 18 || c.age > 42 || c.home < 0) continue;
    const h = sim.citizens[c.spouse];
    if (!h || !h.alive) continue;
    const home = sim.world.buildings[c.home];
    if (home.residents.length >= BUILDING_DEFS[home.type].capacity) continue;
    if ((c.actionData.lastBirth ?? -1e9) > sim.tick - TICKS_PER_YEAR * 0.6) continue;
    let p = 0.012;
    if (c.needs.hunger < 35) p *= 0.3;
    if (c.children.length >= 4) p *= 0.4;
    if (hasTrait(c, Trait.Pious)) p *= 1.2;
    if (!sim.rng.chance(p)) continue;
    const sex = sim.rng.chance(0.5) ? 'm' : 'f';
    const baby = newCitizen(sim, { firstName: sex === 'm' ? sim.rng.pick(MALE_NAMES) : sim.rng.pick(FEMALE_NAMES), lastName: h.lastName, sex, age: 0, cls: 'common', x: home.doorX, y: home.doorY });
    baby.birthTick = sim.tick;
    baby.profession = Profession.Child;
    baby.parents = [h.id, c.id];
    baby.appearance.hair = sim.rng.chance(0.5) ? c.appearance.hair : h.appearance.hair;
    baby.appearance.skin = c.appearance.skin;
    c.children.push(baby.id);
    h.children.push(baby.id);
    c.actionData.lastBirth = sim.tick;
    moveIn(sim, baby, home);
    baby.relations.set(c.id, 80);
    baby.relations.set(h.id, 80);
    c.relations.set(baby.id, 90);
    h.relations.set(baby.id, 85);
    remember(c, sim.tick, `Родил${'а'}ся ${sex === 'm' ? 'сын' : 'дочь'} ${baby.firstName}.`.replace('Родилася', 'Родился').replace('Родился дочь', 'Родилась дочь'), 1, baby.id, 'birth');
    remember(h, sim.tick, `Родил${sex === 'm' ? 'ся сын' : 'ась дочь'} ${baby.firstName}.`, 1, baby.id, 'birth');
    baby.bio.push({ tick: sim.tick, text: `Родил${sex === 'm' ? 'ся' : 'ась'} в Вальдмарке в семье ${fullName(h)}.` });
    sim.chronicle.log(sim.tick, EventKind.Birth, `У ${h.firstName} и ${c.firstName} ${h.lastName} родил${sex === 'm' ? 'ся сын' : 'ась дочь'} ${baby.firstName}.`, home.doorX, home.doorY, [baby.id, c.id, h.id], 0.8);
    sim.events.emit('citizen:born', { id: baby.id, parents: [h.id, c.id] });
    c.needs.energy = Math.max(10, c.needs.energy - 30);
    c.mood += 20;
    h.mood += 15;
  }
}

function migration(sim: Simulation): void {
  const st = sim.stats;
  const homes = sim.world.buildings.filter((b) => BUILDING_DEFS[b.type].home && b.condition > 0 && b.underConstruction === undefined && b.type !== BuildingType.Barracks && b.type !== BuildingType.Castle && b.type !== BuildingType.Monastery);
  let vacancy = 0;
  for (const b of homes) vacancy += Math.max(0, BUILDING_DEFS[b.type].capacity - b.residents.length);
  const homeless = sim.citizens.filter((c) => c.alive && c.home < 0 && !c.actionData.visitor).length;
  const sites = sim.world.buildings.filter((b) => b.underConstruction !== undefined).length;
  const attractive = st.avgMood > -10 && st.avgHunger > 35 && sim.unrest < 60;
  // Упадок: при плохих делах семьи уезжают
  if (!attractive && sim.rng.chance(0.35)) {
    const cands = sim.citizens.filter((c) => c.alive && !isChild(c) && c.mood < -35 && !c.actionData.visitor && c.profession !== Profession.Lord);
    if (cands.length) {
      const c = sim.rng.pick(cands);
      const family = [c, ...[c.spouse, ...c.children].map((id) => sim.citizens[id]).filter((o) => o && o.alive && o.home === c.home)];
      for (const m of family) {
        m.order = { type: 'leave', target: null, phase: 0, data: {}, givenAt: sim.tick };
        interrupt(sim, m);
        m.action = 'order';
        ACTIONS.order.start(makeCtx(sim, m));
      }
      sim.chronicle.log(sim.tick, EventKind.Info, `Семья ${c.lastName} уезжает из Вальдмарка: здесь стало невмоготу.`, Math.round(c.x), Math.round(c.y), [c.id], 0.7);
      return;
    }
  }
  // Новые дома, если жилья нет
  if ((homeless > 0 || vacancy < 4) && sites < 2 && sim.treasury > 150 && sim.rng.chance(0.6)) {
    const t = sim.rng.chance(0.2) ? BuildingType.Shack : BuildingType.House;
    startNewBuilding(sim, t, homeless > 0 ? 'бездомным нужен кров' : 'город тесен');
  }
  // Новая лавка при росте населения
  if (sim.rng.chance(0.15) && sites < 2 && sim.treasury > 300) {
    const pop = st.population;
    const bakeries = sim.world.buildings.filter((b) => b.type === BuildingType.Bakery && b.condition > 0).length;
    const taverns = sim.world.buildings.filter((b) => b.type === BuildingType.Tavern && b.condition > 0).length;
    if (pop / Math.max(1, bakeries) > 150) startNewBuilding(sim, BuildingType.Bakery, 'пекарни не справляются');
    else if (pop / Math.max(1, taverns) > 120) startNewBuilding(sim, BuildingType.Tavern, 'горожанам негде выпить');
  }
  // Приезжие
  if (attractive && vacancy >= 3 && sim.rng.chance(0.3)) {
    const gate = sim.rng.pick(sim.world.poi.gates);
    const start = nearestWalkable(sim.world, gate.x, gate.y, 4);
    if (!start) return;
    const surname = sim.rng.pick(SURNAMES);
    const n = Math.min(vacancy, sim.rng.int(1, 4));
    const home = homes.filter((b) => BUILDING_DEFS[b.type].capacity - b.residents.length >= n).sort((a, b) => b.residents.length === 0 ? 1 : -1)[0];
    if (!home) return;
    const members: Citizen[] = [];
    const husband = newCitizen(sim, { firstName: sim.rng.pick(MALE_NAMES), lastName: surname, sex: 'm', age: sim.rng.int(20, 45), cls: 'common', traits: randomTraits(sim.rng, 2), x: start.x, y: start.y });
    members.push(husband);
    if (n >= 2) {
      const wife = newCitizen(sim, { firstName: sim.rng.pick(FEMALE_NAMES), lastName: surname, sex: 'f', age: Math.max(18, husband.age - sim.rng.int(0, 6)), cls: 'common', x: start.x, y: start.y });
      husband.spouse = wife.id;
      wife.spouse = husband.id;
      wife.relations.set(husband.id, 70);
      husband.relations.set(wife.id, 70);
      members.push(wife);
      for (let k = 2; k < n; k++) {
        const kid = newCitizen(sim, { firstName: sim.rng.chance(0.5) ? sim.rng.pick(MALE_NAMES) : sim.rng.pick(FEMALE_NAMES), lastName: surname, sex: sim.rng.chance(0.5) ? 'm' : 'f', age: sim.rng.int(1, 12), cls: 'common', x: start.x, y: start.y });
        kid.parents = [husband.id, wife.id];
        husband.children.push(kid.id);
        wife.children.push(kid.id);
        kid.profession = Profession.Child;
        members.push(kid);
      }
    }
    let money = sim.rng.int(20, 60);
    husband.money = money;
    sim.moneyCreated += money;
    for (const m of members) {
      m.home = home.id;
      home.residents.push(m.id);
      m.bio.push({ tick: sim.tick, text: `Приехал${m.sex === 'f' ? 'а' : ''} в Вальдмарк в поисках лучшей доли.` });
      m.thought = 'Новый город, новая жизнь.';
      if (!isChild(m) && m.sex === 'm') {
        const site = sim.world.buildings.find((b) => BUILDING_DEFS[b.type].workers > 0 && b.workers.length < workerCap(b, 1) && b.type !== BuildingType.Castle && b.condition > 0 && b.underConstruction === undefined);
        if (site) assignJob(sim, m, site, professionFor(site.type, site.workers.length));
        else m.profession = Profession.Laborer;
      } else if (!isChild(m)) m.profession = Profession.Housewife;
    }
    sim.chronicle.log(sim.tick, EventKind.Info, `В город приехала семья ${surname} (${n} чел.) и поселилась ${home.residents.length > n ? 'у соседей' : 'в пустующем доме'}.`, gate.x, gate.y, [husband.id], 0.6);
    void isElder;
  }
}

ACTIONS['build'] = build;
export const BUILD_LABELS: Record<string, string> = { build: 'строит' };
