// Преступность: кражи, взломы, драки, стража, тюрьма, суд.
import type { Simulation } from './game';
import { Citizen, CitizenState, Order, Profession, Trait, hasTrait, isChild, isElder, fullName, nameAcc, changeRelation, relation, FLAG_WANTED, FLAG_INJURED } from './citizen';
import { ACTIONS, ActionDef, ActionCtx, actFor, goTo, enterBuilding, say, think, remember, randomRoadTileNear } from '../ai/actions';
import { makeCtx, interrupt } from '../ai/brain';
import { BuildingType, Building, BUILDING_DEFS } from '../world/buildings';
import { EventKind } from '../events/chronicle';
import { TICKS_PER_HOUR, TICKS_PER_DAY, hourOf, isNight } from '../core/time';
import { nearestWalkable } from '../world/world';
import { dist2 } from '../core/math';
import { householdMoney } from '../economy/money';

export interface Alarm {
  x: number;
  y: number;
  tick: number;
  kind: 'theft' | 'fight' | 'burglary' | 'arson' | 'riot';
  suspect: number; // id или -1
  victim: number;
  handled: boolean;
}

export interface CrimeRecord {
  x: number;
  y: number;
  tick: number;
  kind: string;
}

const scratch: number[] = [];

function nameGen(c: Citizen): string {
  const f = c.firstName;
  let fg = f;
  if (f.endsWith('а')) fg = f.slice(0, -1) + 'ы';
  else if (f.endsWith('я')) fg = f.slice(0, -1) + 'и';
  else if (f.endsWith('й')) fg = f.slice(0, -1) + 'я';
  else if (/[бвгджзклмнпрстфхцчшщ]$/.test(f)) fg = f + 'а';
  let lg = c.lastName;
  if (c.sex === 'm' && !lg.startsWith('фон') && /[бвгджзклмнпрстфхцчшщ]$/.test(lg)) lg = lg + 'а';
  else if (c.sex === 'f' && lg.endsWith('а')) lg = lg.slice(0, -1) + 'ы';
  return `${fg} ${lg}`;
}

export function updateCrime(sim: Simulation): void {
  const tick = sim.tick;
  // Устаревшие тревоги
  if (tick % 50 === 0) sim.alarms = sim.alarms.filter((a) => tick - a.tick < 600);
  // Карманники и отчаявшиеся — проверка раз в 20 тиков для части жителей
  for (let i = tick % 20; i < sim.citizens.length; i += 20) {
    const c = sim.citizens[i];
    if (!c.alive || c.inside >= 0 || c.jailedUntil > tick) continue;
    if (c.state === CitizenState.Talking || c.state === CitizenState.Sleeping) continue;
    if (c.action === 'flee' || c.action === 'chase' || c.action === 'fight' || c.action === 'arrested') continue;
    if (c.order) continue;
    // Воры
    if (c.profession === Profession.Thief && c.action === 'prowl' && c.state === CitizenState.Acting) {
      if (sim.rng.chance(0.5)) tryPickpocket(sim, c, null);
      continue;
    }
    // Отчаяние: голод и бедность толкают на кражу
    if (!isChild(c) && c.needs.hunger < 15 && householdMoney(sim, c) < 2 && !hasTrait(c, Trait.Honest) && c.profession !== Profession.Guard && c.profession !== Profession.Priest && c.profession !== Profession.Monk) {
      let p = 0.05;
      if (hasTrait(c, Trait.Greedy)) p += 0.1;
      if (hasTrait(c, Trait.Pious)) p -= 0.03;
      if (c.mood < -30) p += 0.05;
      if (sim.rng.chance(p)) {
        if (sim.rng.chance(0.5)) tryShoplift(sim, c);
        else tryPickpocket(sim, c, null);
      }
    }
  }
  // Ночные взломы: воры по ночам
  if (tick % 30 === 0 && isNight(tick)) {
    for (const c of sim.citizens) {
      if (!c.alive || c.profession !== Profession.Thief || c.inside >= 0 || c.jailedUntil > tick || c.order) continue;
      if (c.action !== 'prowl' || c.state !== CitizenState.Acting) continue;
      if ((c.actionData.burgleDay ?? -1) === Math.floor(tick / TICKS_PER_DAY)) continue;
      if (sim.rng.chance(0.12)) startBurglary(sim, c, null);
    }
  }
  // Стража реагирует на тревоги
  if (tick % 5 === 0 && sim.alarms.length) dispatchGuards(sim);
  // Драки
  updateFights(sim);
  // Суд: по окончании срока
  if (tick % 10 === 0) {
    for (const c of sim.citizens) {
      if (!c.alive || c.jailedUntil <= 0) continue;
      if (c.jailedUntil <= tick) trial(sim, c);
    }
  }
}

// ---------------------------------------------------------------- Тревога

export function raiseAlarm(sim: Simulation, kind: Alarm['kind'], x: number, y: number, suspect: number, victim: number): void {
  sim.alarms.push({ x, y, tick: sim.tick, kind, suspect, victim, handled: false });
  sim.crimeLog.push({ x, y, tick: sim.tick, kind });
  if (sim.crimeLog.length > 2000) sim.crimeLog.splice(0, 500);
  // свидетели: страх, память
  sim.spatial.query(x, y, 6, scratch);
  for (const oid of scratch) {
    const o = sim.citizens[oid];
    if (!o.alive || o.inside >= 0 || oid === suspect) continue;
    o.needs.safety = Math.max(0, o.needs.safety - (kind === 'fight' ? 6 : 10));
    if (isChild(o)) continue;
    if (suspect >= 0 && sim.rng.chance(0.35)) {
      const s = sim.citizens[suspect];
      const what = kind === 'theft' ? 'крал' : kind === 'burglary' ? 'лез в чужой дом' : kind === 'arson' ? 'поджигал' : 'дрался';
      remember(o, sim.tick, `${fullName(s)} ${what} на моих глазах.`, 0.55, suspect, 'crime');
      changeRelation(o, suspect, -12);
      s.notoriety = Math.min(100, s.notoriety + 5);
    }
  }
}

function shout(sim: Simulation, c: Citizen, lines: string[]): void {
  say(c, sim.rng.pick(lines), 45, false, sim.tick);
}

// ---------------------------------------------------------------- Кражи

function pickVictim(sim: Simulation, c: Citizen): Citizen | null {
  sim.spatial.query(c.x, c.y, 2.5, scratch);
  let best: Citizen | null = null;
  let bestV = 0;
  for (const oid of scratch) {
    if (oid === c.id) continue;
    const o = sim.citizens[oid];
    if (!o.alive || o.inside >= 0 || o.profession === Profession.Guard || isChild(o)) continue;
    if (o.money < 4) continue;
    if (dist2(c.x, c.y, o.x, o.y) > 6) continue;
    if (relation(c, oid) > 30) continue;
    let v = o.money;
    if (o.state === CitizenState.Talking || o.drunk > 40) v *= 1.5;
    if (v > bestV) {
      bestV = v;
      best = o;
    }
  }
  return best;
}

export function tryPickpocket(sim: Simulation, c: Citizen, forced: Citizen | null): boolean {
  const v = forced ?? pickVictim(sim, c);
  if (!v) return false;
  // стража рядом — риск
  let guardsNear = 0;
  sim.spatial.query(c.x, c.y, 7, scratch);
  for (const oid of scratch) {
    const o = sim.citizens[oid];
    if (o.alive && o.profession === Profession.Guard && o.inside < 0) guardsNear++;
  }
  if (!forced && guardsNear > 0 && sim.rng.chance(0.5)) return false;
  let skill = c.profession === Profession.Thief ? 0.7 : 0.4;
  if (v.state === CitizenState.Talking) skill += 0.15;
  if (v.drunk > 40) skill += 0.2;
  if (hasTrait(v, Trait.Curious)) skill -= 0.1;
  if (isElder(v)) skill += 0.1;
  const amount = Math.max(1, Math.min(30, Math.round(v.money * (0.2 + sim.rng.next() * 0.3))));
  const success = sim.rng.chance(skill);
  const noticed = !success || sim.rng.chance(0.35);
  if (success) {
    v.money -= amount;
    c.money += amount;
    c.notoriety = Math.min(100, c.notoriety + 2);
    remember(c, sim.tick, `Украл${c.sex === 'f' ? 'а' : ''} ${amount} монет у ${fullName(v)}.`, 0.5, v.id, 'theft');
    think(c, sim.rng.pick(['Лёгкая добыча.', 'Он и не заметил.', 'Кошелёк потяжелел.']));
    c.actionData.lastTheft = sim.tick;
  }
  if (noticed) {
    v.needs.safety = Math.max(0, v.needs.safety - 25);
    changeRelation(v, c.id, -40);
    remember(v, sim.tick, success ? `${fullName(c)} украл${c.sex === 'f' ? 'а' : ''} у меня ${amount} монет!` : `${fullName(c)} пытал${c.sex === 'f' ? 'ась' : 'ся'} обокрасть меня.`, 0.7, c.id, 'theft');
    shout(sim, v, ['Вор! Держи вора!', 'Стража! Меня обокрали!', 'Кошелёк! Мой кошелёк!', 'Ах ты, ворюга!']);
    raiseAlarm(sim, 'theft', c.x, c.y, c.id, v.id);
    sim.chronicle.log(sim.tick, EventKind.Crime, success ? `${fullName(c)} украл${c.sex === 'f' ? 'а' : ''} ${amount} монет у ${nameGen(v)} — поднялся крик.` : `${fullName(c)} попытал${c.sex === 'f' ? 'ась' : 'ся'} обокрасть ${nameAcc(v)}, но был${c.sex === 'f' ? 'а' : ''} замечен${c.sex === 'f' ? 'а' : ''}.`, Math.round(c.x), Math.round(c.y), [c.id, v.id], 0.6);
    startFlee(sim, c, v.x, v.y);
    if (hasTrait(v, Trait.Brave) || hasTrait(v, Trait.HotTempered)) startChase(sim, v, c, false);
  } else if (success) {
    // жертва заметит позже
    v.actionData.robbedAt = sim.tick;
    v.actionData.robbedBy = c.id;
    v.actionData.robbedAmount = amount;
    sim.crimeLog.push({ x: c.x, y: c.y, tick: sim.tick, kind: 'theft' });
    sim.chronicle.log(sim.tick, EventKind.Crime, `${fullName(c)} незаметно вытащил${c.sex === 'f' ? 'а' : ''} ${amount} монет у ${nameGen(v)}.`, Math.round(c.x), Math.round(c.y), [c.id, v.id], 0.35);
  }
  return success;
}

/** Жертва обнаруживает пропажу (вызывается из systems при переоценке) */
export function checkRobbed(sim: Simulation, c: Citizen): void {
  if (!c.actionData.robbedAt) return;
  if (sim.tick - c.actionData.robbedAt < 200) return;
  const thief = sim.citizens[c.actionData.robbedBy];
  const amount = c.actionData.robbedAmount;
  c.actionData.robbedAt = 0;
  c.needs.safety = Math.max(0, c.needs.safety - 15);
  c.mood -= 10;
  remember(c, sim.tick, `У меня пропали ${amount} монет. Обокрали!`, 0.6, -1, 'robbed');
  say(c, sim.rng.pick(['Где мой кошелёк?!', 'Меня обокрали!', 'Деньги пропали…']), 45, false, sim.tick);
  if (thief && sim.rng.chance(0.25)) {
    remember(c, sim.tick, `Подозреваю, что это ${fullName(thief)}.`, 0.4, thief.id, 'blame');
    changeRelation(c, thief.id, -20);
  }
}

function tryShoplift(sim: Simulation, c: Citizen): void {
  // украсть хлеб с прилавка/из пекарни поблизости
  let best: Building | null = null;
  let bestD = 15 * 15;
  for (const b of sim.world.buildings) {
    if (b.type !== BuildingType.MarketStall && b.type !== BuildingType.Bakery && b.type !== BuildingType.Butcher) continue;
    if ((b.storage['bread'] ?? 0) < 1 && (b.storage['meat'] ?? 0) < 1) continue;
    const d = dist2(c.x, c.y, b.doorX, b.doorY);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  if (!best) return;
  interrupt(sim, c);
  c.action = 'shoplift';
  c.actionData.building = best.id;
  think(c, sim.rng.pick(['Дети голодные… Один хлеб никто не заметит.', 'Прости, Господи.', 'Схвачу — и бежать.']));
  const ctx = makeCtx(sim, c);
  goTo(ctx, best.doorX, best.doorY);
}

const shoplift: ActionDef = {
  id: 'shoplift',
  interruptible: false,
  score: () => 0,
  start: () => false,
  arrive(ctx) {
    const { c, sim, rng } = ctx;
    const b = sim.world.buildings[c.actionData.building];
    if (!b) return actFor(ctx, 5);
    const good = (b.storage['bread'] ?? 0) >= 1 ? 'bread' : 'meat';
    if ((b.storage[good] ?? 0) < 1) return actFor(ctx, 5);
    b.storage[good]--;
    c.inventory[good] = (c.inventory[good] ?? 0) + 1;
    const owner = b.owner >= 0 ? sim.citizens[b.owner] : null;
    const seen = rng.chance(owner && owner.inside === b.id ? 0.6 : 0.3);
    remember(c, sim.tick, `Украл${c.sex === 'f' ? 'а' : ''} ${good === 'bread' ? 'хлеб' : 'мясо'} с голоду.`, 0.5, -1, 'theft');
    if (seen) {
      if (owner) {
        shout(sim, owner, ['Держи вора! Хлеб украли!', 'Стража! Воруют!']);
        changeRelation(owner, c.id, -30);
      }
      raiseAlarm(sim, 'theft', c.x, c.y, c.id, owner ? owner.id : -1);
      sim.chronicle.log(sim.tick, EventKind.Crime, `${fullName(c)} стащил${c.sex === 'f' ? 'а' : ''} ${good === 'bread' ? 'хлеб' : 'мясо'} — ${owner ? fullName(owner) : 'торговец'} поднял${owner?.sex === 'f' ? 'а' : ''} крик.`, Math.round(c.x), Math.round(c.y), [c.id], 0.5);
      startFlee(sim, c, b.doorX, b.doorY);
    } else {
      sim.crimeLog.push({ x: c.x, y: c.y, tick: sim.tick, kind: 'theft' });
      actFor(ctx, 10);
    }
  },
};

// ---------------------------------------------------------------- Взломы

export function startBurglary(sim: Simulation, c: Citizen, forcedB: Building | null): boolean {
  let target = forcedB;
  if (!target) {
    const homes = sim.world.buildings.filter((b) => BUILDING_DEFS[b.type].home && b.residents.length > 0 && b.id !== c.home && b.type !== BuildingType.Barracks && b.type !== BuildingType.Castle && b.type !== BuildingType.Monastery);
    let best: Building | null = null;
    let bestV = 0;
    for (let k = 0; k < 12; k++) {
      const b = sim.rng.pick(homes);
      const money = b.residents.reduce((a, id) => a + (sim.citizens[id]?.money ?? 0), 0);
      const d = Math.sqrt(dist2(c.x, c.y, b.doorX, b.doorY));
      const v = money / (1 + d / 20);
      if (v > bestV) {
        bestV = v;
        best = b;
      }
    }
    target = best;
  }
  if (!target) return false;
  interrupt(sim, c);
  c.action = 'burgle';
  c.actionData.building = target.id;
  c.actionData.burgleDay = Math.floor(sim.tick / TICKS_PER_DAY);
  think(c, sim.rng.pick(['Там все спят. Пора.', 'Окно не заперто.', 'Тихо, тихо…']));
  const ctx = makeCtx(sim, c);
  return goTo(ctx, target.doorX, target.doorY);
}

const burgle: ActionDef = {
  id: 'burgle',
  interruptible: false,
  score: () => 0,
  start: () => false,
  arrive(ctx) {
    const { c, sim } = ctx;
    if (c.actionData.phase !== 1) {
      c.actionData.phase = 1;
      actFor(ctx, 40); // взлом
      return;
    }
    c.actionData.phase = 0;
    const b = sim.world.buildings[c.actionData.building];
    if (!b) return actFor(ctx, 5);
    const residents = b.residents.map((id) => sim.citizens[id]).filter((o) => o && o.alive);
    const awake = residents.some((o) => o.inside === b.id && o.state !== CitizenState.Sleeping);
    const wakes = awake || sim.rng.chance(0.3);
    let loot = 0;
    for (const o of residents) {
      const take = Math.min(o.money, Math.round(o.money * 0.5));
      if (take > 0 && loot < 60) {
        o.money -= take;
        loot += take;
      }
    }
    if ((b.storage['bread'] ?? 0) >= 2) {
      b.storage['bread'] -= 2;
      c.inventory['bread'] = (c.inventory['bread'] ?? 0) + 2;
    }
    c.money += loot;
    c.notoriety = Math.min(100, c.notoriety + 6);
    remember(c, sim.tick, `Обчистил${c.sex === 'f' ? 'а' : ''} дом ${residents[0] ? fullName(residents[0]) : ''} на ${loot} монет.`, 0.6, residents[0]?.id ?? -1, 'burglary');
    const victimName = residents[0] ? fullName(residents[0]) : 'горожан';
    if (wakes) {
      const w = residents.find((o) => o.inside === b.id) ?? residents[0];
      if (w) {
        interrupt(sim, w);
        w.inside = -1;
        w.x = b.doorX;
        w.y = b.doorY;
        w.state = CitizenState.Acting;
        w.action = 'idle';
        w.actionUntil = sim.tick + 60;
        shout(sim, w, ['Грабят! Стража!', 'Вор в доме!', 'Караул! Грабят!']);
        remember(w, sim.tick, `${fullName(c)} залез${c.sex === 'f' ? 'ла' : ''} к нам в дом ночью!`, 0.8, c.id, 'burglary');
        changeRelation(w, c.id, -60);
      }
      raiseAlarm(sim, 'burglary', b.doorX, b.doorY, c.id, w ? w.id : -1);
      sim.chronicle.log(sim.tick, EventKind.Crime, `${fullName(c)} ночью залез${c.sex === 'f' ? 'ла' : ''} в дом ${victimName}; хозяева проснулись и подняли крик.`, b.doorX, b.doorY, [c.id], 0.7);
      startFlee(sim, c, b.doorX, b.doorY);
    } else {
      for (const o of residents) {
        o.actionData.burgledAt = sim.tick;
        o.actionData.burgledBy = c.id;
      }
      sim.crimeLog.push({ x: b.doorX, y: b.doorY, tick: sim.tick, kind: 'burglary' });
      sim.chronicle.log(sim.tick, EventKind.Crime, `Ночью кто-то обчистил дом ${victimName} на ${loot} монет.`, b.doorX, b.doorY, [c.id], 0.6);
      think(c, 'Чисто сработано.');
      actFor(ctx, 10);
    }
  },
};

export function checkBurgled(sim: Simulation, c: Citizen): void {
  if (!c.actionData.burgledAt) return;
  if (hourOf(sim.tick) < 5) return;
  c.actionData.burgledAt = 0;
  const thief = sim.citizens[c.actionData.burgledBy];
  c.needs.safety = Math.max(0, c.needs.safety - 30);
  c.mood -= 15;
  remember(c, sim.tick, 'Ночью нас обокрали. Пропали деньги.', 0.7, -1, 'robbed');
  say(c, sim.rng.pick(['Нас обокрали ночью!', 'Деньги! Все деньги унесли!', 'Господи, ограбили…']), 50, false, sim.tick);
  if (thief && sim.rng.chance(0.2)) {
    remember(c, sim.tick, `Говорят, ${fullName(thief)} по ночам не спит…`, 0.4, thief.id, 'blame');
    changeRelation(c, thief.id, -15);
  }
}

// ---------------------------------------------------------------- Бегство и погоня

export function startFlee(sim: Simulation, c: Citizen, fromX: number, fromY: number): void {
  interrupt(sim, c);
  c.action = 'flee';
  c.actionData.fleeX = fromX;
  c.actionData.fleeY = fromY;
  c.actionData.fleeUntil = sim.tick + 300;
  c.flags |= FLAG_WANTED;
  const ctx = makeCtx(sim, c);
  flee.start(ctx);
}

const flee: ActionDef = {
  id: 'flee',
  interruptible: false,
  score: () => 0,
  start(ctx) {
    const { c, sim, rng } = ctx;
    // бежать прочь от точки угрозы
    let dx = c.x - c.actionData.fleeX;
    let dy = c.y - c.actionData.fleeY;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const ang = rng.float(-0.8, 0.8);
    const cs = Math.cos(ang);
    const sn = Math.sin(ang);
    const rx = dx * cs - dy * sn;
    const ry = dx * sn + dy * cs;
    const dist = 10 + rng.int(0, 8);
    const tx = Math.round(c.x + rx * dist);
    const ty = Math.round(c.y + ry * dist);
    const nw = nearestWalkable(sim.world, Math.max(1, Math.min(sim.world.w - 2, tx)), Math.max(1, Math.min(sim.world.h - 2, ty)), 5) ?? randomRoadTileNear(sim, rng, c.x, c.y, 8);
    if (!nw) return false;
    c.speed = 1.3;
    return goTo(ctx, nw.x, nw.y);
  },
  arrive(ctx) {
    const { c, sim } = ctx;
    if (sim.tick < c.actionData.fleeUntil) {
      // проверить преследование
      let chased = false;
      sim.spatial.query(c.x, c.y, 12, scratch);
      for (const oid of scratch) {
        const o = sim.citizens[oid];
        if (o.alive && o.action === 'chase' && o.actionData.suspect === c.id) chased = true;
      }
      if (chased) {
        const ok = flee.start(ctx);
        if (ok) return;
      }
    }
    c.speed = 1;
    // спрятаться дома
    const home = c.home >= 0 ? sim.world.buildings[c.home] : null;
    if (home && c.actionData.phase !== 9) {
      c.actionData.phase = 9;
      think(c, 'Отсижусь дома.');
      c.actionData.building = home.id;
      goTo(ctx, home.doorX, home.doorY);
      return;
    }
    if (home) enterBuilding(ctx, home);
    c.actionData.phase = 0;
    actFor(ctx, 60 * 5);
  },
};

export function startChase(sim: Simulation, g: Citizen, suspect: Citizen, isGuard: boolean): void {
  if (g.action === 'chase' || g.action === 'arrested' || g.jailedUntil > sim.tick) return;
  interrupt(sim, g);
  g.action = 'chase';
  g.actionData.suspect = suspect.id;
  g.actionData.chaseUntil = sim.tick + (isGuard ? 400 : 150);
  g.actionData.isGuard = isGuard ? 1 : 0;
  think(g, isGuard ? sim.rng.pick(['Стой! Именем закона!', 'Не уйдёшь!', 'Держи его!']) : 'Держи вора!');
  if (isGuard) say(g, sim.rng.pick(['Стой! Стража!', 'Держи его!', 'Именем закона — стой!']), 40, false, sim.tick);
  const ctx = makeCtx(sim, g);
  chase.start(ctx);
}

const chase: ActionDef = {
  id: 'chase',
  interruptible: false,
  score: () => 0,
  start(ctx) {
    const { c, sim } = ctx;
    const s = sim.citizens[c.actionData.suspect];
    if (!s || !s.alive || s.inside >= 0 || sim.tick > c.actionData.chaseUntil) {
      c.speed = 1;
      if (s && s.inside >= 0 && c.actionData.isGuard) {
        // упустил — подозреваемый в розыске
        s.flags |= FLAG_WANTED;
        s.notoriety = Math.min(100, s.notoriety + 4);
        think(c, 'Ушёл, собака. Запомню рожу.');
      }
      return false;
    }
    c.speed = 1.25;
    return goTo(ctx, Math.round(s.x), Math.round(s.y));
  },
  arrive(ctx) {
    const { c, sim } = ctx;
    const s = sim.citizens[c.actionData.suspect];
    if (!s || !s.alive || s.inside >= 0 || sim.tick > c.actionData.chaseUntil) {
      c.speed = 1;
      if (s && c.actionData.isGuard && s.alive) {
        s.flags |= FLAG_WANTED;
        s.notoriety = Math.min(100, s.notoriety + 4);
      }
      return actFor(ctx, 10);
    }
    if (dist2(c.x, c.y, s.x, s.y) <= 2.2) {
      c.speed = 1;
      if (c.actionData.isGuard) arrest(sim, c, s);
      else {
        // горожанин догнал: потасовка
        startFight(sim, c, s, 'вор пойман с поличным');
      }
      return;
    }
    if (!chase.start(ctx)) actFor(ctx, 10);
  },
};

// ---------------------------------------------------------------- Стража

function dispatchGuards(sim: Simulation): void {
  for (const a of sim.alarms) {
    if (a.handled) continue;
    // ближайший свободный стражник в радиусе 30
    let best: Citizen | null = null;
    let bestD = 30 * 30;
    for (const g of sim.citizens) {
      if (!g.alive || g.profession !== Profession.Guard || g.inside >= 0 && g.state === CitizenState.Sleeping) continue;
      if (g.action === 'chase' || g.action === 'arrested' || g.action === 'escort' || g.state === CitizenState.Sleeping) continue;
      const d = dist2(g.x, g.y, a.x, a.y);
      if (d < bestD) {
        bestD = d;
        best = g;
      }
    }
    a.handled = true;
    if (!best) continue;
    const s = a.suspect >= 0 ? sim.citizens[a.suspect] : null;
    if (s && s.alive && s.inside < 0) startChase(sim, best, s, true);
    else {
      // прийти на место
      interrupt(sim, best);
      best.action = 'respond';
      best.actionData.ax = a.x;
      best.actionData.ay = a.y;
      think(best, 'Шум — надо проверить.');
      const ctx = makeCtx(sim, best);
      goTo(ctx, a.x, a.y);
    }
  }
}

const respond: ActionDef = {
  id: 'respond',
  interruptible: false,
  score: () => 0,
  start: () => false,
  arrive(ctx) {
    const { c, sim, rng } = ctx;
    say(c, rng.pick(['Что тут случилось?', 'Разойдись!', 'Кто кричал?']), 40, false, sim.tick);
    // поблизости есть разыскиваемый? — задержать
    sim.spatial.query(c.x, c.y, 6, scratch);
    for (const oid of scratch) {
      const o = sim.citizens[oid];
      if (o.alive && o.inside < 0 && (o.flags & FLAG_WANTED) && o.id !== c.id) {
        startChase(sim, c, o, true);
        return;
      }
    }
    actFor(ctx, 20 * 5);
  },
};

/** Стражник замечает разыскиваемого на улице (вызывается из патруля) */
export function guardSpotsWanted(sim: Simulation, g: Citizen): void {
  if (g.action !== 'patrol' || g.state !== CitizenState.Acting) return;
  sim.spatial.query(g.x, g.y, 5, scratch);
  for (const oid of scratch) {
    const o = sim.citizens[oid];
    if (!o.alive || o.inside >= 0 || !(o.flags & FLAG_WANTED) || o.jailedUntil > sim.tick) continue;
    if (dist2(g.x, g.y, o.x, o.y) > 25) continue;
    if (!sim.rng.chance(0.5 + o.notoriety / 100)) continue;
    say(g, `Эй, ${o.firstName}! Стоять!`, 40, false, sim.tick);
    startChase(sim, g, o, true);
    startFlee(sim, o, g.x, g.y);
    return;
  }
}

function arrest(sim: Simulation, g: Citizen, s: Citizen): void {
  const prison = sim.world.buildings.find((b) => b.type === BuildingType.Prison);
  say(g, sim.rng.pick(['Попался!', 'Ты арестован.', 'Пойдёшь со мной.']), 45, false, sim.tick);
  say(s, sim.rng.pick(['Я ни в чём не виноват!', 'Отпустите!', 'Это ошибка!', 'Проклятье…']), 45, false, sim.tick + 10);
  s.flags &= ~FLAG_WANTED;
  s.speed = 1;
  g.speed = 1;
  interrupt(sim, s);
  interrupt(sim, g);
  sim.chronicle.log(sim.tick, EventKind.Crime, `Стражник ${fullName(g)} задержал ${nameAcc(s)}.`, Math.round(s.x), Math.round(s.y), [g.id, s.id], 0.6);
  remember(s, sim.tick, `Арестован${s.sex === 'f' ? 'а' : ''} стражником ${fullName(g)}.`, 0.8, g.id, 'arrest');
  remember(g, sim.tick, `Задержал ${nameAcc(s)}.`, 0.4, s.id, 'arrest');
  changeRelation(s, g.id, -25);
  if (!prison) {
    // без тюрьмы — штраф на месте
    const fine = Math.min(s.money, 10);
    s.money -= fine;
    sim.treasury += fine;
    return;
  }
  // конвой
  s.action = 'arrested';
  s.actionData.building = prison.id;
  s.actionData.guard = g.id;
  g.action = 'escort';
  g.actionData.building = prison.id;
  g.actionData.suspect = s.id;
  const sc = makeCtx(sim, s);
  const gc = makeCtx(sim, g);
  goTo(sc, prison.doorX, prison.doorY);
  goTo(gc, prison.doorX, prison.doorY);
}

const arrested: ActionDef = {
  id: 'arrested',
  interruptible: false,
  score: () => 0,
  start(ctx) {
    const { c, sim } = ctx;
    const prison = sim.world.buildings[c.actionData.building];
    if (!prison) return false;
    return goTo(ctx, prison.doorX, prison.doorY);
  },
  arrive(ctx) {
    const { c, sim } = ctx;
    const prison = sim.world.buildings[c.actionData.building];
    if (!prison) return actFor(ctx, 5);
    enterBuilding(ctx, prison);
    // срок: от известности
    const days = 1 + Math.min(3, Math.floor(c.notoriety / 25));
    c.jailedUntil = sim.tick + days * TICKS_PER_DAY * 0.5 + TICKS_PER_HOUR * 6;
    c.action = 'jailed';
    c.state = CitizenState.Acting;
    c.actionUntil = c.jailedUntil;
    think(c, sim.rng.pick(['Сырые стены, крысы… Доколе?', 'Выйду — всё по-другому будет.', 'Дождусь суда.']));
    sim.chronicle.log(sim.tick, EventKind.Crime, `${fullName(c)} брошен${c.sex === 'f' ? 'а' : ''} в тюрьму до суда.`, prison.doorX, prison.doorY, [c.id], 0.5);
  },
};

const escort: ActionDef = {
  id: 'escort',
  interruptible: false,
  score: () => 0,
  start(ctx) {
    const { c, sim } = ctx;
    const prison = sim.world.buildings[c.actionData.building];
    if (!prison) return false;
    return goTo(ctx, prison.doorX, prison.doorY);
  },
  arrive(ctx) {
    actFor(ctx, 15 * 5);
    ctx.c.needs.fun = Math.min(100, ctx.c.needs.fun + 5);
  },
};

const jailed: ActionDef = {
  id: 'jailed',
  interruptible: false,
  score(ctx) {
    return ctx.c.jailedUntil > ctx.sim.tick ? 900 : 0;
  },
  start(ctx) {
    const { c, sim } = ctx;
    const prison = sim.world.buildings.find((b) => b.type === BuildingType.Prison);
    if (prison && c.inside !== prison.id) {
      c.actionData.building = prison.id;
      return goTo(ctx, prison.doorX, prison.doorY);
    }
    c.state = CitizenState.Acting;
    c.actionUntil = Math.min(c.jailedUntil, sim.tick + 600);
    return true;
  },
  arrive(ctx) {
    const prison = ctx.sim.world.buildings[ctx.c.actionData.building];
    if (prison) enterBuilding(ctx, prison);
    ctx.c.state = CitizenState.Acting;
    ctx.c.actionUntil = Math.min(ctx.c.jailedUntil, ctx.sim.tick + 600);
  },
  tick(ctx) {
    const c = ctx.c;
    // тюремная похлёбка: голод падает медленнее
    c.needs.hunger = Math.min(100, c.needs.hunger + 0.12);
    c.needs.fun = Math.max(0, c.needs.fun - 0.05);
    return false;
  },
};

function trial(sim: Simulation, c: Citizen): void {
  c.jailedUntil = 0;
  const prison = sim.world.buildings.find((b) => b.type === BuildingType.Prison);
  const hall = sim.world.buildings.find((b) => b.type === BuildingType.TownHall);
  const x = hall ? hall.doorX : prison ? prison.doorX : Math.round(c.x);
  const y = hall ? hall.doorY : prison ? prison.doorY : Math.round(c.y);
  const r = sim.rng.next();
  const severity = c.notoriety;
  let verdict: 'fine' | 'pillory' | 'exile' | 'free';
  if (severity > 45 && r < 0.3) verdict = 'exile';
  else if (r < 0.45) verdict = 'fine';
  else if (r < 0.8) verdict = 'pillory';
  else verdict = 'free';
  if (verdict === 'fine' && c.money < 3) verdict = 'pillory';
  c.inside = -1;
  if (prison) {
    c.x = prison.doorX;
    c.y = prison.doorY;
    c.px = c.x;
    c.py = c.y;
  }
  c.state = CitizenState.Idle;
  c.action = '';
  c.nextThink = sim.tick;
  const burg = sim.citizens.find((z) => z.alive && z.profession === Profession.Burgomaster);
  const judge = burg ? `Бургомистр ${burg.lastName}` : 'Суд ратуши';
  switch (verdict) {
    case 'fine': {
      const fine = Math.min(c.money, Math.max(5, Math.round(c.money * 0.4)));
      c.money -= fine;
      sim.treasury += fine;
      sim.chronicle.log(sim.tick, EventKind.Crime, `${judge} приговорил ${nameAcc(c)} к штрафу в ${fine} монет.`, x, y, [c.id], 0.6);
      remember(c, sim.tick, `Суд: штраф ${fine} монет.`, 0.6, -1, 'verdict');
      say(c, 'Грабёж, а не суд!', 45, false, sim.tick);
      break;
    }
    case 'pillory': {
      sim.chronicle.log(sim.tick, EventKind.Crime, `${judge} приговорил ${nameAcc(c)} к позорному столбу.`, x, y, [c.id], 0.7);
      remember(c, sim.tick, 'Суд: позорный столб.', 0.7, -1, 'verdict');
      c.action = 'pillory';
      c.actionData.pilloryUntil = sim.tick + 2 * TICKS_PER_HOUR;
      const ctx = makeCtx(sim, c);
      if (!pillory.start(ctx)) c.action = '';
      break;
    }
    case 'exile': {
      sim.chronicle.log(sim.tick, EventKind.Crime, `${judge} изгнал ${nameAcc(c)} из города за злодеяния.`, x, y, [c.id], 0.9);
      remember(c, sim.tick, 'Изгнан из Вальдмарка.', 0.9, -1, 'verdict');
      c.order = { type: 'leave', target: null, phase: 0, data: {}, givenAt: sim.tick };
      c.notoriety = 0;
      const ctx = makeCtx(sim, c);
      c.action = 'order';
      ACTIONS.order.start(ctx);
      break;
    }
    default:
      sim.chronicle.log(sim.tick, EventKind.Crime, `${judge} отпустил ${nameAcc(c)} за недостатком улик.`, x, y, [c.id], 0.4);
      remember(c, sim.tick, 'Суд оправдал меня.', 0.5, -1, 'verdict');
      say(c, 'Я же говорил — невиновен!', 45, false, sim.tick);
  }
  c.notoriety = Math.max(0, c.notoriety - 15);
}

const pillory: ActionDef = {
  id: 'pillory',
  interruptible: false,
  score(ctx) {
    return (ctx.c.actionData.pilloryUntil ?? 0) > ctx.sim.tick ? 800 : 0;
  },
  start(ctx) {
    const { c, sim } = ctx;
    const p = sim.world.buildings.find((b) => b.type === BuildingType.Pillory);
    if (!p) return false;
    think(c, 'Весь город будет смеяться…');
    return goTo(ctx, p.doorX, p.doorY);
  },
  arrive(ctx) {
    const { c, sim } = ctx;
    c.dir = 0;
    c.state = CitizenState.Acting;
    c.actionUntil = c.actionData.pilloryUntil;
    c.mood -= 10;
    c.needs.safety = Math.max(0, c.needs.safety - 20);
    void sim;
  },
  tick(ctx) {
    const { c, sim, rng } = ctx;
    if (rng.chance(0.04)) say(c, rng.pick(['Отпустите…', 'Я больше не буду!', 'Хватит пялиться!']), 30, false, sim.tick);
    // прохожие глумятся
    if (rng.chance(0.1)) {
      sim.spatial.query(c.x, c.y, 4, scratch);
      for (const oid of scratch) {
        const o = sim.citizens[oid];
        if (oid === c.id || !o.alive || o.inside >= 0 || o.state === CitizenState.Talking) continue;
        if (rng.chance(0.3)) {
          say(o, rng.pick(['Позор!', 'Поделом вору!', 'Так тебе и надо!', 'Ха-ха, попался!', isChild(o) ? 'Дядя, а что ты сделал?' : 'Вот и допрыгался.']), 35, false, sim.tick);
          changeRelation(o, c.id, -3);
          break;
        }
      }
    }
    return false;
  },
  finish(ctx) {
    remember(ctx.c, ctx.sim.tick, 'Отстоял у позорного столба.', 0.5, -1, 'pillory');
  },
};

// ---------------------------------------------------------------- Драки

export function startFight(sim: Simulation, a: Citizen, b: Citizen, reason: string): void {
  if (a.action === 'fight' || b.action === 'fight') return;
  if (a.jailedUntil > sim.tick || b.jailedUntil > sim.tick) return;
  // выйти из здания наружу
  for (const c of [a, b]) {
    interrupt(sim, c);
    if (c.inside >= 0) {
      const bb = sim.world.buildings[c.inside];
      c.inside = -1;
      c.x = bb.doorX;
      c.y = bb.doorY;
      c.px = c.x;
      c.py = c.y;
    }
    c.action = 'fight';
    c.state = CitizenState.Acting;
    c.actionUntil = sim.tick + 40 + sim.rng.int(0, 60);
    c.actionData.opponent = c === a ? b.id : a.id;
    c.actionData.fightStart = sim.tick;
  }
  const dx = b.x - a.x;
  a.dir = Math.abs(dx) > 0.1 ? (dx > 0 ? 2 : 1) : 0;
  b.dir = a.dir === 2 ? 1 : a.dir === 1 ? 2 : 3;
  say(a, sim.rng.pick(['Получай!', 'Ах ты!', 'Я тебе покажу!', 'Иди сюда!']), 40, false, sim.tick);
  say(b, sim.rng.pick(['Ты что, спятил?!', 'Ну держись!', 'Помогите!', 'Сам напросился!']), 40, false, sim.tick + 8);
  sim.chronicle.log(sim.tick, EventKind.Crime, `${fullName(a)} и ${fullName(b)} подрались (${reason}).`, Math.round(a.x), Math.round(a.y), [a.id, b.id], 0.6);
  raiseAlarm(sim, 'fight', a.x, a.y, a.id, b.id);
  remember(a, sim.tick, `Подрался${a.sex === 'f' ? 'ась' : ''} с ${fullName(b)}.`, 0.6, b.id, 'fight');
  remember(b, sim.tick, `${fullName(a)} набросил${a.sex === 'f' ? 'ась' : 'ся'} на меня с кулаками.`, 0.6, a.id, 'fight');
  changeRelation(a, b.id, -25);
  changeRelation(b, a.id, -30);
  sim.fights.push({ a: a.id, b: b.id, until: Math.max(a.actionUntil, b.actionUntil) });
}

function updateFights(sim: Simulation): void {
  if (!sim.fights.length) return;
  const tick = sim.tick;
  for (let i = sim.fights.length - 1; i >= 0; i--) {
    const f = sim.fights[i];
    const a = sim.citizens[f.a];
    const b = sim.citizens[f.b];
    const over = tick > f.until || !a.alive || !b.alive || a.action !== 'fight' || b.action !== 'fight' || a.hp < 25 || b.hp < 25;
    if (!over) {
      if (tick % 10 === 0) {
        const hit = (x: Citizen, y: Citizen) => {
          let dmg = 2 + sim.rng.int(0, 4);
          if (hasTrait(x, Trait.Brave) || x.profession === Profession.Guard || x.profession === Profession.Smith) dmg += 2;
          if (x.drunk > 50) dmg -= 1;
          if (isElder(x)) dmg -= 2;
          y.hp = Math.max(0, y.hp - Math.max(1, dmg));
        };
        hit(a, b);
        hit(b, a);
        a.animPhase += 1;
        b.animPhase += 1;
        if (sim.rng.chance(0.08)) say(sim.rng.chance(0.5) ? a : b, sim.rng.pick(['На!', 'Ой!', 'Получай!', 'Держите его!', 'Хрясь!']), 25, false, tick);
      }
      continue;
    }
    sim.fights.splice(i, 1);
    const loser = a.hp < b.hp ? a : b;
    const winner = loser === a ? b : a;
    for (const c of [a, b]) {
      if (c.action === 'fight') {
        c.action = '';
        c.state = CitizenState.Idle;
        c.nextThink = tick + 10;
      }
      c.needs.safety = Math.max(0, c.needs.safety - 15);
      if (c.hp < 40) {
        c.flags |= FLAG_INJURED;
        c.needs.health = Math.min(c.needs.health, 45);
      }
    }
    if (a.alive && b.alive) {
      say(loser, sim.rng.pick(['Хватит, хватит!', 'Сдаюсь…', 'Ох… моя голова.']), 40, false, tick);
      say(winner, sim.rng.pick(['Будешь знать!', 'И не попадайся!', 'Вот так-то.']), 40, false, tick + 6);
      remember(loser, tick, `${fullName(winner)} побил${winner.sex === 'f' ? 'а' : ''} меня.`, 0.6, winner.id, 'fight');
      if (loser.hp < 30) sim.chronicle.log(tick, EventKind.Crime, `${fullName(loser)} сильно избит${loser.sex === 'f' ? 'а' : ''} в драке с ${fullName(winner)}.`, Math.round(loser.x), Math.round(loser.y), [loser.id, winner.id], 0.5);
    }
  }
}

const fight: ActionDef = {
  id: 'fight',
  interruptible: false,
  score: () => 0,
  start: () => false,
  arrive(ctx) {
    actFor(ctx, 5);
  },
};

/** Проверка эскалации ссоры в драку (вызывается из бесед) */
export function maybeFightAfterQuarrel(sim: Simulation, a: Citizen, b: Citizen): boolean {
  if (isChild(a) || isChild(b)) return false;
  let p = 0.1;
  if (hasTrait(a, Trait.HotTempered)) p += 0.3;
  if (hasTrait(b, Trait.HotTempered)) p += 0.15;
  if (a.drunk > 40) p += 0.2;
  if (b.drunk > 40) p += 0.1;
  if (hasTrait(a, Trait.Cowardly) || hasTrait(a, Trait.Kind)) p -= 0.2;
  if (relation(a, b.id) < -40) p += 0.15;
  if (a.sex === 'f') p *= 0.4;
  if (sim.rng.chance(Math.max(0, p))) {
    startFight(sim, a, b, 'ссора на улице');
    return true;
  }
  return false;
}

/** Пьяные драки в тавернах */
export function updateTavernBrawls(sim: Simulation): void {
  if (sim.tick % 100 !== 0) return;
  for (const b of sim.world.buildings) {
    if (b.type !== BuildingType.Tavern) continue;
    const inside: Citizen[] = [];
    for (const c of sim.citizens) if (c.alive && c.inside === b.id && c.action === 'tavern' && c.drunk > 35) inside.push(c);
    if (inside.length < 2) continue;
    const a = sim.rng.pick(inside);
    const z = sim.rng.pick(inside);
    if (a === z) continue;
    let p = 0.03 + a.drunk / 400;
    if (hasTrait(a, Trait.HotTempered)) p += 0.08;
    if (relation(a, z.id) < -20) p += 0.1;
    if (hasTrait(a, Trait.Kind) || hasTrait(a, Trait.Cowardly)) p *= 0.3;
    if (a.sex === 'f') p *= 0.35;
    if (sim.rng.chance(p)) startFight(sim, a, z, `пьяная драка в таверне «${b.name}»`);
  }
}

// ---------------------------------------------------------------- Приказы

export function crimeOrderStart(ctx: ActionCtx, o: Order): boolean {
  const { c, sim, rng } = ctx;
  switch (o.type) {
    case 'steal': {
      const t = o.target && o.target.kind === 'citizen' ? sim.citizens[o.target.id] : null;
      if (!t || !t.alive) return false;
      think(c, rng.pick([`Присмотрюсь к кошельку ${t.firstName}.`, 'Главное — не попасться.', 'Тихо подойду сзади…']));
      if (t.inside >= 0) {
        const b = sim.world.buildings[t.inside];
        return goTo(ctx, b.doorX, b.doorY);
      }
      return goTo(ctx, Math.round(t.x), Math.round(t.y));
    }
    case 'burgle': {
      const b = o.target && o.target.kind === 'building' ? sim.world.buildings[o.target.id] : null;
      if (!b) return false;
      if (!isNight(sim.tick)) {
        think(c, 'Днём туда не сунешься. Дождусь ночи.');
        o.data.waitNight = 1;
        actFor(ctx, 200);
        return true;
      }
      c.actionData.building = b.id;
      c.actionData.phase = 0;
      think(c, 'Там все спят. Пора.');
      return goTo(ctx, b.doorX, b.doorY);
    }
    case 'fight': {
      const t = o.target && o.target.kind === 'citizen' ? sim.citizens[o.target.id] : null;
      if (!t || !t.alive) return false;
      think(c, rng.pick([`Ну, ${t.firstName}, сейчас получишь.`, 'Давно руки чешутся.']));
      if (t.inside >= 0) {
        const b = sim.world.buildings[t.inside];
        return goTo(ctx, b.doorX, b.doorY);
      }
      return goTo(ctx, Math.round(t.x), Math.round(t.y));
    }
    case 'escape': {
      // побег из тюрьмы
      const prison = sim.world.buildings.find((b) => b.type === BuildingType.Prison);
      const guards = sim.citizens.filter((g) => g.alive && g.profession === Profession.Guard && prison && dist2(g.x, g.y, prison.doorX, prison.doorY) < 100).length;
      let p = 0.6 - guards * 0.15;
      if (hasTrait(c, Trait.Brave)) p += 0.15;
      if (c.profession === Profession.Thief) p += 0.15;
      if (isNight(sim.tick)) p += 0.15;
      if (rng.chance(Math.max(0.05, p))) {
        c.jailedUntil = 0;
        c.inside = -1;
        c.order = null;
        if (prison) {
          c.x = prison.doorX;
          c.y = prison.doorY;
          c.px = c.x;
          c.py = c.y;
        }
        sim.chronicle.log(sim.tick, EventKind.Crime, `${fullName(c)} сбежал${c.sex === 'f' ? 'а' : ''} из тюрьмы!`, c.x, c.y, [c.id], 0.9);
        remember(c, sim.tick, 'Сбежал из тюрьмы.', 0.9, -1, 'escape');
        c.notoriety = Math.min(100, c.notoriety + 25);
        say(c, 'Свобода!', 40, false, sim.tick);
        if (prison) raiseAlarm(sim, 'theft', prison.doorX, prison.doorY, c.id, -1);
        startFlee(sim, c, prison ? prison.doorX : c.x, prison ? prison.doorY : c.y);
        return true;
      }
      c.jailedUntil += TICKS_PER_DAY;
      c.order = null;
      sim.chronicle.log(sim.tick, EventKind.Crime, `${fullName(c)} пытал${c.sex === 'f' ? 'ась' : 'ся'} бежать из тюрьмы, но был${c.sex === 'f' ? 'а' : ''} пойман${c.sex === 'f' ? 'а' : ''}; срок продлён.`, c.x, c.y, [c.id], 0.6);
      remember(c, sim.tick, 'Неудачный побег — срок продлили.', 0.7, -1, 'escape');
      c.action = 'jailed';
      c.state = CitizenState.Acting;
      c.actionUntil = Math.min(c.jailedUntil, sim.tick + 600);
      return true;
    }
    case 'arson': {
      const b = o.target && o.target.kind === 'building' ? sim.world.buildings[o.target.id] : null;
      if (!b || b.condition <= 0) return false;
      think(c, rng.pick(['Пусть горит.', 'Никто не увидит.', 'Факел, солома… и бежать.']));
      c.actionData.building = b.id;
      return goTo(ctx, b.doorX, b.doorY);
    }
  }
  return false;
}

export function crimeOrderArrive(ctx: ActionCtx, o: Order): void {
  const { c, sim, rng } = ctx;
  switch (o.type) {
    case 'steal': {
      const t = o.target && o.target.kind === 'citizen' ? sim.citizens[o.target.id] : null;
      if (!t || !t.alive) {
        c.order = null;
        return actFor(ctx, 5);
      }
      if (t.inside >= 0 || dist2(c.x, c.y, t.x, t.y) > 6) {
        o.data.tries = (o.data.tries ?? 0) + 1;
        if (o.data.tries > 8) {
          say(c, 'Не подобраться.', 40, false, sim.tick);
          c.order = null;
        }
        return actFor(ctx, 30);
      }
      c.order = null;
      const ok = tryPickpocket(sim, c, t);
      if (!ok && c.action !== 'flee') actFor(ctx, 10);
      return;
    }
    case 'burgle': {
      if (o.data.waitNight) {
        o.data.waitNight = 0;
        return actFor(ctx, 5);
      }
      const b = o.target && o.target.kind === 'building' ? sim.world.buildings[o.target.id] : null;
      c.order = null;
      if (!b) return actFor(ctx, 5);
      c.action = 'burgle';
      c.actionData.building = b.id;
      c.actionData.phase = 0;
      c.actionData.burgleDay = Math.floor(sim.tick / TICKS_PER_DAY);
      burgle.arrive(ctx);
      return;
    }
    case 'fight': {
      const t = o.target && o.target.kind === 'citizen' ? sim.citizens[o.target.id] : null;
      if (!t || !t.alive) {
        c.order = null;
        return actFor(ctx, 5);
      }
      if (t.inside >= 0 || dist2(c.x, c.y, t.x, t.y) > 6) {
        o.data.tries = (o.data.tries ?? 0) + 1;
        if (o.data.tries > 8) c.order = null;
        if (t.inside >= 0 && t.state !== CitizenState.Sleeping && o.data.tries > 1) {
          // выманить
          const b = sim.world.buildings[t.inside];
          say(c, `${t.firstName}, выходи, поговорим!`, 40, false, sim.tick);
          interrupt(sim, t);
          t.inside = -1;
          t.x = b.doorX;
          t.y = b.doorY;
          t.state = CitizenState.Acting;
          t.action = 'idle';
          t.actionUntil = sim.tick + 20;
        }
        return actFor(ctx, 30);
      }
      c.order = null;
      startFight(sim, c, t, 'затеял драку');
      return;
    }
    case 'arson': {
      const b = o.target && o.target.kind === 'building' ? sim.world.buildings[o.target.id] : null;
      c.order = null;
      if (!b) return actFor(ctx, 5);
      const seen = sim.rng.chance(0.4);
      if (sim.igniteBuilding) sim.igniteBuilding(b.id, 'поджог', 0.35);
      c.notoriety = Math.min(100, c.notoriety + 15);
      remember(c, sim.tick, `Поджёг${c.sex === 'f' ? 'ла' : ''} ${BUILDING_DEFS[b.type].name.toLowerCase()}.`, 0.8, -1, 'arson');
      if (seen) {
        raiseAlarm(sim, 'arson', b.doorX, b.doorY, c.id, -1);
        sim.chronicle.log(sim.tick, EventKind.Crime, `${fullName(c)} видели с факелом у горящего здания!`, b.doorX, b.doorY, [c.id], 0.9);
      }
      startFlee(sim, c, b.doorX, b.doorY);
      return;
    }
    default:
      c.order = null;
      actFor(ctx, 5);
  }
  void rng;
}

for (const a of [shoplift, burgle, flee, chase, respond, arrested, escort, jailed, pillory, fight]) ACTIONS[a.id] = a;

export const CRIME_LABELS: Record<string, string> = {
  shoplift: 'крадёт еду',
  burgle: 'лезет в дом',
  flee: 'убегает',
  chase: 'преследует',
  respond: 'бежит на крик',
  arrested: 'арестован',
  escort: 'конвоирует',
  jailed: 'в тюрьме',
  pillory: 'у позорного столба',
  fight: 'дерётся',
};
