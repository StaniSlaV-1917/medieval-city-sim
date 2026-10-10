// Пожары: возгорание, распространение по ветру и материалам, пожарные с вёдрами, руины.
import type { Simulation } from './game';
import { Citizen, CitizenState, Profession, Trait, hasTrait, isChild, isElder, fullName, FLAG_FIREMAN, FLAG_INJURED } from './citizen';
import { ACTIONS, ActionDef, ActionCtx, actFor, goTo, say, think, remember } from '../ai/actions';
import { makeCtx, interrupt } from '../ai/brain';
import { Building, BuildingType, BUILDING_DEFS } from '../world/buildings';
import { EventKind } from '../events/chronicle';
import { hourOf, TICKS_PER_HOUR } from '../core/time';
import { nearestWalkable, idx } from '../world/world';
import { Tile } from '../world/tiles';
import { dist2 } from '../core/math';

export interface Fire {
  building: number;
  intensity: number; // 0..1
  started: number;
  cause: string;
  fighters: number;
}


function materialFlammability(b: Building): number {
  const m = b.material === 'wood' ? 1.0 : b.material === 'timber' ? 0.7 : b.material === 'brick' ? 0.3 : 0.2;
  const r = b.roof === 'thatch' ? 1.0 : b.roof === 'wood' ? 0.7 : b.roof === 'tile' ? 0.3 : 0.25;
  return (m + r) / 2;
}

export function igniteBuilding(sim: Simulation, id: number, cause: string, intensity = 0.25): boolean {
  const b = sim.world.buildings[id];
  if (!b || b.w === 0 || b.condition <= 0) return false;
  if (sim.fires.some((f) => f.building === id)) return false;
  if (b.type === BuildingType.Well || b.type === BuildingType.Pillory) return false;
  sim.fires.push({ building: id, intensity, started: sim.tick, cause, fighters: 0 });
  sim.crimeLog.push({ x: b.doorX, y: b.doorY, tick: sim.tick, kind: 'fire' });
  const name = sim.buildingDefName(b);
  sim.chronicle.log(sim.tick, EventKind.Disaster, `Пожар! Горит ${b.name ? `«${b.name}»` : name.toLowerCase()} (${cause}).`, b.doorX, b.doorY, [], 0.9);
  // жильцы выбегают
  for (const c of sim.citizens) {
    if (!c.alive || c.inside !== id) continue;
    interrupt(sim, c);
    c.inside = -1;
    c.x = b.doorX;
    c.y = b.doorY;
    c.px = c.x;
    c.py = c.y;
    c.needs.safety = Math.max(0, c.needs.safety - 40);
    say(c, sim.rng.pick(['Пожар!', 'Горим!', 'Спасайтесь!', 'Воды! Воды!']), 50, false, sim.tick);
    if (sim.rng.chance(intensity * 0.3)) {
      c.hp = Math.max(5, c.hp - 30);
      c.flags |= FLAG_INJURED;
      remember(c, sim.tick, 'Обгорел на пожаре.', 0.7, -1, 'fire');
    }
    remember(c, sim.tick, `Пожар в ${b.id === c.home ? 'нашем доме' : name.toLowerCase()}!`, 0.8, -1, 'fire');
    // отбежать
    const away = nearestWalkable(sim.world, b.doorX + sim.rng.int(-3, 3), b.doorY + sim.rng.int(2, 4), 4);
    if (away) {
      c.action = 'idle';
      goTo(makeCtx(sim, c), away.x, away.y);
    }
  }
  raiseFireAlarm(sim, b);
  return true;
}

function raiseFireAlarm(sim: Simulation, b: Building): void {
  // колокол на каланче
  const tower = sim.world.buildings.find((x) => x.type === BuildingType.FireTower);
  if (tower) {
    const watch = sim.citizens.find((c) => c.alive && c.inside === tower.id);
    if (watch) say(watch, 'Пожар! Бом-бом-бом!', 60, false, sim.tick);
  }
  sim.alarms.push({ x: b.doorX, y: b.doorY, tick: sim.tick, kind: 'arson', suspect: -1, victim: -1, handled: true });
  // свидетели и добровольцы
  const cx = b.doorX;
  const cy = b.doorY;
  let volunteers = 0;
  const cands: { c: Citizen; d: number }[] = [];
  for (const c of sim.citizens) {
    if (!c.alive || isChild(c) || isElder(c) || c.jailedUntil > sim.tick) continue;
    if (c.state === CitizenState.Sleeping && !(c.flags & FLAG_FIREMAN)) continue;
    if (c.action === 'firefight' || c.action === 'fight' || c.action === 'chase' || c.action === 'arrested') continue;
    const d = Math.sqrt(dist2(c.x, c.y, cx, cy));
    const isFireman = (c.flags & FLAG_FIREMAN) !== 0;
    const maxD = isFireman ? 80 : 18;
    if (d > maxD) continue;
    if (!isFireman) {
      let p = 0.35;
      if (hasTrait(c, Trait.Brave) || hasTrait(c, Trait.Kind)) p += 0.3;
      if (hasTrait(c, Trait.Cowardly)) p -= 0.3;
      if (c.home === b.id) p = 1;
      if (!sim.rng.chance(p)) {
        c.needs.safety = Math.max(0, c.needs.safety - 10);
        continue;
      }
    }
    cands.push({ c, d: d - (isFireman ? 40 : 0) });
  }
  cands.sort((a, z) => a.d - z.d);
  for (const { c } of cands.slice(0, 10)) {
    startFirefight(sim, c, b.id);
    volunteers++;
  }
  if (volunteers === 0) sim.chronicle.log(sim.tick, EventKind.Disaster, 'Тушить пожар некому!', cx, cy, [], 0.6);
}

function startFirefight(sim: Simulation, c: Citizen, buildingId: number): void {
  interrupt(sim, c);
  c.action = 'firefight';
  c.actionData.fire = buildingId;
  c.actionData.phase = 0; // 0 — за водой, 1 — к огню
  c.speed = 1.2;
  think(c, sim.rng.pick(['Воды! Скорее к колодцу!', 'Тушить, пока не перекинулось!', 'Вёдра, цепочка!']));
  if (sim.rng.chance(0.4)) say(c, sim.rng.pick(['Пожар! Все к колодцу!', 'Вёдра! Становись в цепь!', 'Горим!']), 40, false, sim.tick);
  const ctx = makeCtx(sim, c);
  if (!firefight.start(ctx)) {
    c.action = '';
    c.speed = 1;
  }
}

function nearestWater(sim: Simulation, x: number, y: number): { x: number; y: number } | null {
  const world = sim.world;
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const b of world.buildings) {
    if (b.type !== BuildingType.Well) continue;
    const d = dist2(x, y, b.doorX, b.doorY);
    if (d < bestD) {
      bestD = d;
      best = { x: b.doorX, y: b.doorY };
    }
  }
  // река: ближайший проходимый тайл у воды в радиусе 25
  for (let r = 2; r < 25; r += 2) {
    for (let k = 0; k < 10; k++) {
      const tx = Math.round(x + sim.rng.float(-r, r));
      const ty = Math.round(y + sim.rng.float(-r, r));
      if (tx < 1 || ty < 1 || tx >= world.w - 1 || ty >= world.h - 1) continue;
      if (world.tiles[idx(world, tx, ty)] !== Tile.Water) continue;
      const nw = nearestWalkable(world, tx, ty, 2);
      if (!nw) continue;
      const d = dist2(x, y, nw.x, nw.y);
      if (d < bestD) {
        bestD = d;
        best = nw;
      }
    }
    if (best && bestD < r * r) break;
  }
  return best;
}

const firefight: ActionDef = {
  id: 'firefight',
  interruptible: false,
  score: () => 0,
  start(ctx) {
    const { c, sim } = ctx;
    const fire = sim.fires.find((f) => f.building === c.actionData.fire);
    if (!fire) return false;
    const b = sim.world.buildings[fire.building];
    if (c.actionData.phase === 0) {
      const w = nearestWater(sim, b.doorX, b.doorY);
      if (!w) return false;
      c.actionData.wx = w.x;
      c.actionData.wy = w.y;
      return goTo(ctx, w.x, w.y);
    }
    const spot = nearestWalkable(sim.world, b.doorX + sim.rng.int(-2, 2), b.doorY + sim.rng.int(0, 2), 3);
    if (!spot) return false;
    return goTo(ctx, spot.x, spot.y);
  },
  arrive(ctx) {
    const { c, sim, rng } = ctx;
    const fire = sim.fires.find((f) => f.building === c.actionData.fire);
    if (!fire) {
      c.speed = 1;
      say(c, rng.pick(['Потушили!', 'Уф, отбились.', 'Слава Богу, погасло.']), 40, false, sim.tick);
      c.action = '';
      return actFor(ctx, 20);
    }
    if (c.actionData.phase === 0) {
      c.actionData.phase = 1;
      c.inventory['water'] = 1;
      actFor(ctx, 8); // набрать воду
      c.nextThink = sim.tick + 8;
      return;
    }
    // выплеснуть
    const b = sim.world.buildings[fire.building];
    fire.intensity = Math.max(0, fire.intensity - 0.02 - (c.flags & FLAG_FIREMAN ? 0.012 : 0));
    fire.fighters++;
    c.inventory['water'] = 0;
    c.dir = 3;
    if (rng.chance(0.15)) say(c, rng.pick(['Ещё воды!', 'Лей!', 'Давай, давай!', 'Не подходи близко!']), 30, false, sim.tick);
    // ожог
    if (rng.chance(0.02 * fire.intensity)) {
      c.hp = Math.max(10, c.hp - 15);
      if (c.hp < 40) c.flags |= FLAG_INJURED;
      say(c, 'Ай! Обжёгся!', 30, false, sim.tick);
    }
    // разобрать соседний деревянный дом, чтобы не перекинулось
    if (fire.intensity > 0.75 && rng.chance(0.03)) {
      const nb = neighbors(sim, b).find((n) => n.condition > 0 && (n.material === 'wood' || n.roof === 'thatch') && !sim.fires.some((f) => f.building === n.id) && n.type !== BuildingType.Cathedral && n.type !== BuildingType.Castle);
      if (nb) {
        damageBuilding(sim, nb, 1, 'разобран пожарными');
        sim.chronicle.log(sim.tick, EventKind.Disaster, `Пожарные разобрали ${sim.buildingDefName(nb).toLowerCase()}, чтобы огонь не перекинулся дальше.`, nb.doorX, nb.doorY, [c.id], 0.6);
      }
    }
    c.actionData.phase = 0;
    actFor(ctx, 5);
  },
  finish(ctx) {
    const { c, sim } = ctx;
    if (sim.fires.some((f) => f.building === c.actionData.fire) && c.action === 'firefight') {
      // продолжить цикл
      c.nextThink = sim.tick;
    }
  },
};

/** Продолжение цикла тушения (вызывается из think для действия firefight) */
export function continueFirefight(sim: Simulation, c: Citizen): boolean {
  if (c.action !== 'firefight') return false;
  const fire = sim.fires.find((f) => f.building === c.actionData.fire);
  if (!fire) {
    c.action = '';
    c.speed = 1;
    return false;
  }
  const ctx = makeCtx(sim, c);
  if (!firefight.start(ctx)) {
    c.action = '';
    c.speed = 1;
    return false;
  }
  return true;
}

function neighbors(sim: Simulation, b: Building): Building[] {
  const out: Building[] = [];
  for (const o of sim.world.buildings) {
    if (o.id === b.id || o.w === 0) continue;
    const gapX = Math.max(0, Math.max(b.x, o.x) - Math.min(b.x + b.w, o.x + o.w));
    const gapY = Math.max(0, Math.max(b.y, o.y) - Math.min(b.y + b.h, o.y + o.h));
    if (gapX <= 2 && gapY <= 2) out.push(o);
  }
  return out;
}

export function damageBuilding(sim: Simulation, b: Building, amount: number, cause: string): void {
  if (b.condition <= 0) return;
  b.condition = Math.max(0, b.condition - amount);
  if (b.condition <= 0) {
    b.lit = false;
    sim.onBuildingDestroyed?.(b, cause);
  }
}

export function updateFires(sim: Simulation): void {
  const tick = sim.tick;
  // случайные возгорания
  if (tick % 100 === 0) {
    const hour = hourOf(tick);
    const w = sim.weather;
    const dry = (1 - w.rain) * (sim.season === 1 ? 1.4 : sim.season === 3 ? 0.9 : 1);
    for (const b of sim.world.buildings) {
      if (b.w === 0 || b.condition <= 0) continue;
      const def = BUILDING_DEFS[b.type];
      let p = 0;
      if ((b.type === BuildingType.Smithy && hour > 7 && hour < 18) || (b.type === BuildingType.Bakery && hour > 3 && hour < 14)) p = 0.00018;
      else if (def.home && b.residents.length && (hour >= 20 || hour < 6)) p = 0.000025 * (b.roof === 'thatch' ? 1.5 : 1);
      else if (b.type === BuildingType.Tavern && hour >= 18) p = 0.00006;
      p *= dry * sim.fireRiskMul;
      if (sim.season === 3 && def.home) p *= 1.6; // зимой топят печи
      if (p > 0 && sim.rng.chance(p)) {
        const cause = b.type === BuildingType.Smithy ? 'искры из горна' : b.type === BuildingType.Bakery ? 'перегрелась печь' : b.type === BuildingType.Tavern ? 'опрокинутая свеча' : sim.season === 3 ? 'от печи' : 'от свечи';
        igniteBuilding(sim, b.id, cause, 0.2);
      }
    }
  }
  if (!sim.fires.length) return;
  if (tick % 10 !== 0) return;
  const w = sim.weather;
  for (let i = sim.fires.length - 1; i >= 0; i--) {
    const f = sim.fires[i];
    const b = sim.world.buildings[f.building];
    if (!b || b.w === 0) {
      sim.fires.splice(i, 1);
      continue;
    }
    const flam = materialFlammability(b);
    // рост
    f.intensity += (0.006 + flam * 0.006) * (1 - w.rain * 0.6);
    f.intensity = Math.min(1, f.intensity);
    // урон зданию
    damageBuilding(sim, b, f.intensity * (0.004 + flam * 0.006), f.cause);
    // распространение
    if (f.intensity > 0.35) {
      for (const n of neighbors(sim, b)) {
        if (n.condition <= 0 || sim.fires.some((x) => x.building === n.id)) continue;
        // ветер: по направлению ветра — сильнее
        const dx = n.x + n.w / 2 - (b.x + b.w / 2);
        const dy = n.y + n.h / 2 - (b.y + b.h / 2);
        const len = Math.hypot(dx, dy) || 1;
        const windK = 1 + w.wind * 1.5 * ((dx / len) * Math.cos(w.windDir) + (dy / len) * Math.sin(w.windDir));
        const p = 0.0035 * f.intensity * materialFlammability(n) * Math.max(0.2, windK) * (1 - w.rain * 0.7);
        if (sim.rng.chance(p)) igniteBuilding(sim, n.id, 'огонь перекинулся', 0.25);
      }
    }
    // затухание: дождь, выгорело
    if (w.rain > 0.5) f.intensity -= 0.01 * w.rain;
    if (b.condition <= 0) {
      f.intensity -= 0.04;
    }
    if (f.intensity <= 0) {
      sim.fires.splice(i, 1);
      const name = sim.buildingDefName(b);
      if (b.condition <= 0) sim.chronicle.log(tick, EventKind.Disaster, `${name} сгорел${name.endsWith('а') ? 'а' : name.endsWith('я') ? 'а' : ''} дотла.`, b.doorX, b.doorY, [], 0.9);
      else sim.chronicle.log(tick, EventKind.Disaster, `Пожар потушен: ${b.name ? `«${b.name}»` : name.toLowerCase()}, повреждения ${Math.round((1 - b.condition) * 100)}%.`, b.doorX, b.doorY, [], 0.7);
      for (const c of sim.citizens) if (c.alive && c.action === 'firefight' && c.actionData.fire === f.building) {
        c.needs.fun = Math.min(100, c.needs.fun + 10);
        remember(c, tick, `Тушил${c.sex === 'f' ? 'а' : ''} пожар (${name.toLowerCase()}).`, 0.5, -1, 'fire');
      }
    }
  }
}

ACTIONS['firefight'] = firefight;

export const FIRE_LABELS: Record<string, string> = { firefight: 'тушит пожар' };
export { fullName, Profession, TICKS_PER_HOUR };
export type { ActionCtx };
