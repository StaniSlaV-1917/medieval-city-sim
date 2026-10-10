// Действия жителей: оценка полезности, старт, прибытие, выполнение.
import type { Simulation } from '../sim/game';
import { Citizen, CitizenState, Profession, Trait, hasTrait, isChild, isElder, Memory, changeRelation, fullName } from '../sim/citizen';
import { DaySchedule, isWorkHour, isSleepHour } from '../sim/schedule';
import { setDestination } from '../sim/movement';
import { Building, BuildingType, BUILDING_DEFS, District } from '../world/buildings';
import { Tile } from '../world/tiles';
import { idx, isWalkableAt, isRoadTile, nearestWalkable } from '../world/world';
import { TICKS_PER_HOUR, TICKS_PER_DAY, hourOf } from '../core/time';
import { RNG } from '../core/rng';
import { pay, householdMoney } from '../economy/money';
import { RECIPES, wantedStock, addStock, producersOf } from '../economy/production';
import { sellersOf, isOpenAt } from '../economy/market';
import { Good, GOOD_INFO } from '../economy/goods';
import { EventKind } from '../events/chronicle';

export interface ActionCtx {
  sim: Simulation;
  c: Citizen;
  hour: number;
  sched: DaySchedule;
  rng: RNG;
}

export interface ActionDef {
  id: string;
  score(ctx: ActionCtx): number;
  /** Начать: задать цель. false — невозможно. */
  start(ctx: ActionCtx): boolean;
  /** Прибытие к цели. */
  arrive(ctx: ActionCtx): void;
  /** Периодическое обновление (раз в 10 тиков). true — завершить досрочно. */
  tick?(ctx: ActionCtx): boolean;
  finish?(ctx: ActionCtx): void;
  interruptible: boolean;
}

/** Текущие розничные ориентиры (для реплик) */
export function priceOf(sim: Simulation, g: Good): number {
  return Math.max(1, Math.round(sim.market.prices[g]));
}

// ---------------------------------------------------------------- Утилиты

export function say(c: Citizen, text: string, ticks = 40, thought = false, tick = 0): void {
  c.speech = { text, until: tick + ticks, thought };
}

export function think(c: Citizen, text: string): void {
  c.thought = text;
}

function pickText(rng: RNG, arr: string[]): string {
  return arr[Math.floor(rng.next() * arr.length)];
}

/** Перейти к тайлу; если уже там — сразу arrive */
export function goTo(ctx: ActionCtx, x: number, y: number): boolean {
  const { c, sim } = ctx;
  const ok = setDestination(sim, c, x, y);
  if (!ok) return false;
  if (c.state === CitizenState.Idle) {
    // уже на месте
    const def = ACTIONS[c.action];
    if (def) def.arrive(ctx);
  }
  return true;
}

export function goToBuilding(ctx: ActionCtx, b: Building): boolean {
  ctx.c.actionData.building = b.id;
  return goTo(ctx, b.doorX, b.doorY);
}

export function enterBuilding(ctx: ActionCtx, b: Building): void {
  const c = ctx.c;
  if (b.id === c.home) {
    // принёс еду домой — в общий запас семьи
    for (const g of ['bread', 'meat'] as const) {
      const n = c.inventory[g] ?? 0;
      if (n > 0) {
        b.storage[g] = (b.storage[g] ?? 0) + n;
        c.inventory[g] = 0;
      }
    }
  }
  c.inside = b.id;
  c.x = b.doorX;
  c.y = b.doorY;
  c.px = c.x;
  c.py = c.y;
  c.path = null;
}

export function actFor(ctx: ActionCtx, ticks: number, sleeping = false): void {
  const c = ctx.c;
  c.state = sleeping ? CitizenState.Sleeping : CitizenState.Acting;
  c.actionUntil = ctx.sim.tick + Math.max(1, Math.round(ticks));
}

export function remember(c: Citizen, tick: number, text: string, importance: number, about = -1, topic?: string): void {
  const m: Memory = { tick, text, importance, about };
  if (topic) m.topic = topic;
  c.memories.push(m);
  if (c.memories.length > 40) c.memories.splice(0, c.memories.length - 40);
  if (importance >= 0.5) {
    c.bio.push({ tick, text });
    if (c.bio.length > 60) c.bio.splice(0, c.bio.length - 60);
  }
}

function homeOf(ctx: ActionCtx): Building | null {
  const c = ctx.c;
  return c.home >= 0 ? ctx.sim.world.buildings[c.home] : null;
}

function workOf(ctx: ActionCtx): Building | null {
  const c = ctx.c;
  return c.workplace >= 0 ? ctx.sim.world.buildings[c.workplace] : null;
}

function isOpen(b: Building, hour: number): boolean {
  const def = BUILDING_DEFS[b.type];
  const [a, z] = def.hours;
  if (hour >= a && hour < z) return true;
  if (z > 24 && hour + 24 < z) return true;
  return false;
}

/** Случайный проходимый тайл-дорога в радиусе */
export function randomRoadTileNear(sim: Simulation, rng: RNG, x: number, y: number, r: number, tries = 12): { x: number; y: number } | null {
  const world = sim.world;
  for (let k = 0; k < tries; k++) {
    const tx = Math.round(x + rng.float(-r, r));
    const ty = Math.round(y + rng.float(-r, r));
    if (tx < 1 || ty < 1 || tx >= world.w - 1 || ty >= world.h - 1) continue;
    const t = world.tiles[idx(world, tx, ty)] as Tile;
    if (isRoadTile(t) && isWalkableAt(world, tx, ty)) return { x: tx, y: ty };
  }
  const nw = nearestWalkable(world, Math.round(x + rng.float(-r, r)), Math.round(y + rng.float(-r, r)), 5);
  return nw;
}

/** Ближайшее открытое здание типа */
function nearestOpen(sim: Simulation, c: Citizen, type: BuildingType, hour: number): Building | null {
  let best: Building | null = null;
  let bestD = Infinity;
  for (const b of sim.world.buildings) {
    if (b.type !== type || !isOpen(b, hour)) continue;
    const dx = b.doorX - c.x;
    const dy = b.doorY - c.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

/** Время до часа h (в тиках), с учётом перехода через полночь */
function ticksUntilHour(sim: Simulation, h: number): number {
  const cur = hourOf(sim.tick);
  let dh = (h % 24) - cur;
  if (dh <= 0) dh += 24;
  return dh * TICKS_PER_HOUR;
}

// ---------------------------------------------------------------- Действия

const sleep: ActionDef = {
  id: 'sleep',
  interruptible: false,
  score(ctx) {
    const { c, hour, sched } = ctx;
    const e = c.needs.energy;
    let s = 0;
    if (isSleepHour(sched, hour)) s = 55 + (100 - e) * 0.5;
    if (e < 12) s = Math.max(s, 75);
    if (e > 92) s *= 0.3;
    if (c.state === CitizenState.Sleeping) s += 10;
    return s;
  },
  start(ctx) {
    const { c, rng } = ctx;
    const home = homeOf(ctx);
    think(c, pickText(rng, ['Пора спать.', 'Глаза слипаются…', 'Ну и денёк. Домой — и в постель.', 'Завтра рано вставать.']));
    if (home) return goToBuilding(ctx, home);
    // бездомный: спит у стены/у ворот
    const spot = rng.pick(ctx.sim.world.poi.strollSpots);
    c.actionData.building = -1;
    think(c, 'Переночую где придётся…');
    return goTo(ctx, spot.x, spot.y);
  },
  arrive(ctx) {
    const { c, sim, sched } = ctx;
    const b = c.actionData.building >= 0 ? sim.world.buildings[c.actionData.building] : null;
    if (b) {
      enterBuilding(ctx, b);
      if (c.needs.hunger < 60 && (b.storage['bread'] ?? 0) > 0) {
        b.storage['bread']--;
        c.needs.hunger = Math.min(100, c.needs.hunger + 45);
      }
    }
    // спать до подъёма, но не дольше 10 часов
    const until = Math.min(ticksUntilHour(sim, sched.wake), 10 * TICKS_PER_HOUR);
    actFor(ctx, until, true);
  },
  tick(ctx) {
    const c = ctx.c;
    c.needs.energy = Math.min(100, c.needs.energy + 100 / (8 * TICKS_PER_HOUR) * 10 * (c.inside >= 0 ? 1 : 0.6));
    if (c.needs.energy >= 100 && hourOf(ctx.sim.tick) >= ctx.sched.wake % 24 && hourOf(ctx.sim.tick) < ctx.sched.wake % 24 + 2) return true;
    return false;
  },
};

const WORK_THOUGHTS: Partial<Record<Profession, string[]>> = {
  [Profession.Farmer]: ['Поле само себя не вспашет.', 'Пора в поле.', 'Земля ждёт.'],
  [Profession.Baker]: ['Тесто подошло, пора печь.', 'Город хочет хлеба.', 'Печь уже горячая.'],
  [Profession.Smith]: ['Куй железо, пока горячо.', 'Заказов на неделю вперёд.', 'Пора раздувать горн.'],
  [Profession.Guard]: ['Пора на обход.', 'Порядок сам себя не наведёт.', 'На пост.'],
  [Profession.Merchant]: ['Товар сам себя не продаст.', 'Пора открывать лавку.', 'Покупатели ждут.'],
  [Profession.Innkeeper]: ['Пора открывать таверну.', 'Бочки полны, посетители будут.'],
  [Profession.Priest]: ['Паства ждёт.', 'Пора готовиться к службе.'],
  [Profession.Monk]: ['Больные ждут помощи.', 'Нужно собрать травы.'],
  [Profession.Carpenter]: ['Доски ждут.', 'Заказ на новую дверь.'],
  [Profession.Mason]: ['Камень сам не ляжет.', 'Пора за кладку.'],
  [Profession.Tanner]: ['Шкуры мокнут, пора.', 'Кожевня ждёт.'],
  [Profession.Woodcutter]: ['Лес рубить — не языком молоть.', 'Пора в лес с топором.'],
  [Profession.Quarryman]: ['Камень ждёт.', 'Пора в каменоломню.'],
  [Profession.Miller]: ['Жернова ждут зерна.', 'Колесо крутится — мука будет.'],
  [Profession.Butcher]: ['Пора разделывать тушу.', 'Мясо само себя не продаст.'],
  [Profession.Burgomaster]: ['Дела города не ждут.', 'Бумаги, бумаги…'],
  [Profession.Herald]: ['Пора оглашать новости.', 'Горожане должны знать.'],
  [Profession.Servant]: ['Господа ждут.', 'Работа в замке не кончается.'],
  [Profession.Stablehand]: ['Лошадей надо накормить.', 'Пора чистить конюшню.'],
  [Profession.Bard]: ['Публика ждёт песен.', 'Сегодня спою новую балладу.'],
  [Profession.Lord]: ['Дела владения не ждут.', 'Нужно принять просителей.'],
  [Profession.Fireman]: ['Проверю вёдра на каланче.'],
  [Profession.Laborer]: ['Хоть какая, а работа.', 'Спина болит, но надо.', 'Таскать мешки — не песни петь.'],
};

/** Выбрать точку работы «на улице» (поле, лес, каменоломня, прилавок) */
function outdoorWorkSpot(ctx: ActionCtx, b: Building): { x: number; y: number } | null {
  const { sim, rng } = ctx;
  const world = sim.world;
  const want = b.type === BuildingType.Farm ? Tile.Field : b.type === BuildingType.Quarry ? Tile.Quarry : b.type === BuildingType.Sawmill ? Tile.Forest : -1;
  if (want < 0) return null;
  if (b.type === BuildingType.Sawmill && rng.chance(0.45)) return null; // часть работников пилит доски внутри
  const r = b.type === BuildingType.Sawmill ? 14 : 12;
  for (let k = 0; k < 24; k++) {
    const tx = Math.round(b.x + b.w / 2 + rng.float(-r, r));
    const ty = Math.round(b.y + b.h / 2 + rng.float(-r, r));
    if (tx < 1 || ty < 1 || tx >= world.w - 1 || ty >= world.h - 1) continue;
    const t = world.tiles[idx(world, tx, ty)] as Tile;
    if (want === Tile.Forest) {
      // рядом с деревом, на проходимом тайле
      if (t === Tile.Forest) {
        const nw = nearestWalkable(world, tx, ty, 2);
        if (nw) return nw;
      }
      continue;
    }
    if (t === want && isWalkableAt(world, tx, ty)) return { x: tx, y: ty };
  }
  return null;
}

const work: ActionDef = {
  id: 'work',
  interruptible: true,
  score(ctx) {
    const { c, hour, sched } = ctx;
    if (c.workplace < 0 || !isWorkHour(sched, hour)) return 0;
    if (c.profession === Profession.Guard) return 0; // у стражи — патруль
    if (ctx.sim.world.buildings[c.workplace].condition <= 0) return 0; // рабочее место в руинах
    if (c.actionData.dayOff === Math.floor(ctx.sim.tick / TICKS_PER_DAY)) return 0;
    let s = 50;
    if (hasTrait(c, Trait.Hardworking)) s += 10;
    if (hasTrait(c, Trait.Ambitious)) s += 6;
    if (hasTrait(c, Trait.Lazy)) s -= 12;
    const wp = ctx.sim.world.buildings[c.workplace];
    const foodAtWork = wp && ((wp.storage['bread'] ?? 0) >= 1 || (wp.storage['meat'] ?? 0) >= 1 || ((wp.type === BuildingType.Farm || wp.type === BuildingType.Mill) && (wp.storage['grain'] ?? 0) >= 1));
    if (c.needs.hunger < 30 && !foodAtWork) s -= 25;
    if (c.needs.hunger < 60 && Math.abs(hour - sched.lunch) < 0.7 && !foodAtWork) s -= 18; // обед
    if (c.needs.energy < 10) s -= 30;
    if (c.needs.health < 30) s -= 30;
    if (c.drunk > 50) s -= 20;
    if (c.action === 'work') s += 8; // продолжать
    return s;
  },
  start(ctx) {
    const { c, rng } = ctx;
    const b = workOf(ctx);
    if (!b) return false;
    if (c.action !== 'work' || !c.thought) think(c, pickText(rng, WORK_THOUGHTS[c.profession] ?? ['За работу.', 'Дела не ждут.']));
    const spot = outdoorWorkSpot(ctx, b);
    if (spot) {
      c.actionData.building = b.id;
      c.actionData.outdoor = 1;
      return goTo(ctx, spot.x, spot.y);
    }
    c.actionData.outdoor = 0;
    if (b.type === BuildingType.MarketStall) {
      // стоять за прилавком (тайл над дверью занят лавкой — стоим у двери)
      c.actionData.building = b.id;
      return goTo(ctx, b.doorX, b.doorY);
    }
    return goToBuilding(ctx, b);
  },
  arrive(ctx) {
    const { c, sim, rng } = ctx;
    const b = sim.world.buildings[c.actionData.building];
    if (!b) return actFor(ctx, 10);
    const def = BUILDING_DEFS[b.type];
    if (!c.actionData.outdoor && def.enterable && b.type !== BuildingType.MarketStall) enterBuilding(ctx, b);
    else c.dir = 0;
    // работать 40–80 минут, затем переоценка (обед, усталость)
    actFor(ctx, rng.int(40, 80) * 5);
  },
  tick(ctx) {
    const { c, sim } = ctx;
    c.needs.fun = Math.max(0, c.needs.fun - 0.03);
    const b = sim.world.buildings[c.actionData.building];
    if (b) {
      produce(sim, b, c, 10);
      // перекусить на рабочем месте из запасов (пекарь ест свой хлеб, крестьянин — кашу из зерна)
      if (c.needs.hunger < 45) {
        for (const [g, val] of [['bread', 55], ['meat', 45], ['grain', 35]] as [Good, number][]) {
          if ((b.storage[g] ?? 0) >= 1 && (g !== 'grain' || b.type === BuildingType.Farm || b.type === BuildingType.Mill)) {
            b.storage[g] = (b.storage[g] ?? 0) - 1;
            c.needs.hunger = Math.min(100, c.needs.hunger + val);
            break;
          }
        }
      }
    }
    return false;
  },
  finish(ctx) {
    const { c, sim } = ctx;
    const b = workOf(ctx);
    if (!b) return;
    // Жалованье: раз в день по окончании смены
    const hour = hourOf(sim.tick);
    const day = Math.floor(sim.tick / TICKS_PER_DAY);
    if (!isWorkHour(ctx.sched, hour + 0.5) && c.actionData.paidDay !== day) {
      c.actionData.paidDay = day;
      let wage = wageOf(c);
      if (hasTrait(c, Trait.Lazy)) wage = Math.round(wage * 0.8);
      {
        // богатый хозяин платит щедрее (деньги возвращаются в оборот)
        const ow = b.owner >= 0 && b.owner !== c.id ? sim.citizens[b.owner] : null;
        if (ow && ow.alive && ow.money > 200) wage = Math.round(wage * Math.min(2, 1 + (ow.money - 200) / 300));
      }
      if (wage > 0) {
        // владелец платит из своих денег (если есть), иначе казна; первичные производства
        // (фермы, каменоломня, лесопилка, мельница, кожевня) продают сырьё за город — внешний доход
        const owner = b.owner >= 0 && b.owner !== c.id ? sim.citizens[b.owner] : null;
        const isPublic = PUBLIC_JOBS.has(b.type);
        let paid = false;
        if (owner && owner.alive && owner.money >= wage) {
          pay(sim, owner, c, wage);
          paid = true;
        } else if (owner && owner.alive && owner.money >= Math.ceil(wage / 2)) {
          // частичная выплата — хозяин на мели
          pay(sim, owner, c, Math.floor(owner.money));
          paid = true;
          c.mood -= 4;
          if (sim.rng.chance(0.2)) think(c, 'Хозяин заплатил только половину. Дела у него плохи.');
        } else if ((isPublic || !owner) && sim.treasury >= wage) {
          sim.treasury -= wage;
          c.money += wage;
          paid = true;
        }
        if (paid) shareWage(sim, c, wage);
        else {
          c.mood -= 10;
          if (owner) {
            changeRelation(c, owner.id, -6);
            if (sim.rng.chance(0.3)) remember(c, sim.tick, `${fullName(owner)} не заплатил${owner.sex === 'f' ? 'а' : ''} мне за работу.`, 0.4, owner.id, 'unpaid');
            think(c, 'Опять без жалованья… Чем семью кормить?');
          }
        }
      }
      // владелец лавки: выручка дня из казны-рынка — заглушка до фазы 3: небольшой доход от «покупателей» уже реализован через покупки
    }
  },
};

const PUBLIC_JOBS = new Set<BuildingType>([BuildingType.TownHall, BuildingType.Barracks, BuildingType.Prison, BuildingType.Cathedral, BuildingType.Monastery, BuildingType.FireTower, BuildingType.Chapel]);

/** Производство за `ticks` тиков работы одного работника */
export function produce(sim: Simulation, b: Building, c: Citizen, ticks: number): void {
  const r = RECIPES[b.type];
  if (!r || b.condition <= 0) return;
  const hours = ticks / TICKS_PER_HOUR;
  // лесорубы в лесу валят брёвна, а не пилят доски
  if (b.type === BuildingType.Sawmill && c.actionData.outdoor) {
    addStock(b, 'wood', 1.2 * hours * (hasTrait(c, Trait.Hardworking) ? 1.2 : 1));
    return;
  }
  // пропускная способность здания ограничена: лишние руки дают мало
  // лесопилка держит запас брёвен для кузницы
  if (b.type === BuildingType.Sawmill && (b.storage['wood'] ?? 0) < 8) return;
  let eff = Math.min(1, (BUILDING_DEFS[b.type].workers || 1) / Math.max(1, b.workers.length));
  if (hasTrait(c, Trait.Hardworking)) eff *= 1.2;
  if (hasTrait(c, Trait.Lazy)) eff *= 0.8;
  if (c.needs.energy < 25) eff *= 0.8;
  if (c.needs.hunger < 25) eff *= 0.8;
  // входы: доля доступного; мелкие расходники (инструменты) не останавливают работу, а замедляют
  let ratio = 1;
  for (const [g, rate] of Object.entries(r.inputs) as [Good, number][]) {
    if (!rate) continue;
    const need = rate * hours * eff;
    const have = b.storage[g] ?? 0;
    if (have < need) {
      if (rate < 0.1) eff *= 0.6;
      else ratio = Math.min(ratio, have / need);
    }
  }
  if (ratio <= 0.01) {
    if (sim.rng.chance(0.02)) think(c, pickText(sim.rng, ['Сырья нет — сидим без дела.', 'Хоть бы подвезли, а то стоим.', 'Без припасов работа стоит.']));
    return;
  }
  for (const [g, rate] of Object.entries(r.inputs) as [Good, number][]) {
    if (!rate) continue;
    b.storage[g] = Math.max(0, (b.storage[g] ?? 0) - rate * hours * eff * ratio);
  }

  const season = b.type === BuildingType.Farm ? sim.market.harvest(sim) : 1;
  for (const [g, rate] of Object.entries(r.outputs) as [Good, number][]) {
    if (!rate) continue;
    const mul = b.type === BuildingType.Farm && g === 'grain' ? season : 1;
    addStock(b, g, rate * hours * eff * ratio * mul);
  }
}

function wageOf(c: Citizen): number {
  switch (c.profession) {
    case Profession.Farmer:
    case Profession.Servant:
    case Profession.Stablehand:
      return 6;
    case Profession.Guard:
      return 7;
    case Profession.Burgomaster:
      return 14;
    case Profession.Herald:
    case Profession.Priest:
    case Profession.Monk:
      return 6;
    case Profession.Lord:
    case Profession.Noble:
      return 0;
    case Profession.Merchant:
    case Profession.Innkeeper:
    case Profession.Baker:
    case Profession.Butcher:
      return 0; // владельцы живут с выручки
    case Profession.Smith:
    case Profession.Carpenter:
    case Profession.Mason:
    case Profession.Tanner:
      return 8; // ремесленники: заказы (внешний доход до фазы 3)
    case Profession.Laborer:
      return 8;
    default:
      return 7;
  }
}

/** Часть заработка — супруге/супругу, ведущему хозяйство */
export function shareWage(sim: Simulation, c: Citizen, wage: number): void {
  if (c.spouse < 0) return;
  const sp = sim.citizens[c.spouse];
  if (!sp || !sp.alive) return;
  if (sp.profession !== Profession.Housewife && sp.workplace >= 0) return;
  const share = Math.floor(wage / 2);
  if (share > 0 && c.money >= share) pay(sim, c, sp, share);
}

const patrol: ActionDef = {
  id: 'patrol',
  interruptible: true,
  score(ctx) {
    const { c, hour, sched } = ctx;
    if (c.profession !== Profession.Guard || !isWorkHour(sched, hour)) return 0;
    if (c.actionData.dayOff === Math.floor(ctx.sim.tick / TICKS_PER_DAY)) return 0;
    let s = 55;
    if (c.needs.hunger < 20) s -= 20;
    if (c.needs.energy < 10) s -= 25;
    return s;
  },
  start(ctx) {
    const { c, sim, rng } = ctx;
    const world = sim.world;
    think(c, pickText(rng, ['Всё спокойно.', 'Обход.', 'Проверю ворота.', 'Смотреть в оба.', 'Что-то подозрительно тихо.']));
    const r = rng.next();
    let spot: { x: number; y: number } | null = null;
    if (r < 0.3) {
      const g = rng.pick(world.poi.gates);
      const inward = g.dir === 0 ? -2 : g.dir === 2 ? 2 : 0;
      const inwardY = g.dir === 1 ? -2 : g.dir === 3 ? 2 : 0;
      spot = nearestWalkable(world, g.x + inward, g.y + inwardY, 3);
    } else if (r < 0.55) {
      const sq = world.poi.square;
      spot = nearestWalkable(world, sq.x + rng.int(0, sq.w - 1), sq.y + rng.int(0, sq.h - 1), 3);
    } else {
      spot = randomRoadTileNear(sim, rng, world.poi.cx, world.poi.cy, Math.min(world.w, world.h) * 0.22, 20);
    }
    if (!spot) return false;
    return goTo(ctx, spot.x, spot.y);
  },
  arrive(ctx) {
    actFor(ctx, ctx.rng.int(15, 40) * 5);
  },
  finish(ctx) {
    const { c, sim } = ctx;
    const hour = hourOf(sim.tick);
    const day = Math.floor(sim.tick / TICKS_PER_DAY);
    if (!isWorkHour(ctx.sched, hour + 0.5) && c.actionData.paidDay !== day && sim.treasury >= 7) {
      c.actionData.paidDay = day;
      sim.treasury -= 7;
      c.money += 7;
      shareWage(sim, c, 7);
    }
  },
};

const eatHome: ActionDef = {
  id: 'eat_home',
  interruptible: false,
  score(ctx) {
    const { c, hour, sched } = ctx;
    const home = homeOf(ctx);
    if (!home) return 0;
    const bread = (home.storage['bread'] ?? 0) + (c.inventory['bread'] ?? 0);
    if (bread <= 0) return 0;
    const h = c.needs.hunger;
    if (h > 60) return 0;
    let s = (70 - h) * 1.4 + (h < 35 ? 15 : 0);
    if (Math.abs(hour - sched.lunch) < 0.6) s += 15;
    if (hour > 18 && hour < 21) s += 10;
    // далеко от дома — меньше охоты идти
    const d = Math.abs(home.doorX - c.x) + Math.abs(home.doorY - c.y);
    s -= d * 0.15;
    return s;
  },
  start(ctx) {
    const { c, rng } = ctx;
    const home = homeOf(ctx);
    if (!home) return false;
    think(c, pickText(rng, ['Проголодался, пойду домой поесть.', 'Дома ждёт хлеб.', 'В животе урчит.', 'Самое время перекусить.']));
    return goToBuilding(ctx, home);
  },
  arrive(ctx) {
    const { c, sim } = ctx;
    const home = sim.world.buildings[c.actionData.building];
    if (!home) return actFor(ctx, 10);
    enterBuilding(ctx, home);
    if ((c.inventory['bread'] ?? 0) > 0) c.inventory['bread']--;
    else if ((home.storage['bread'] ?? 0) > 0) home.storage['bread']--;
    else return actFor(ctx, 10);
    c.needs.hunger = Math.min(100, c.needs.hunger + (isChild(c) ? 70 : 55));
    if (c.needs.hunger < 90 && (home.storage['meat'] ?? 0) >= 1 && ctx.rng.chance(0.5)) {
      home.storage['meat']--;
      c.needs.hunger = Math.min(100, c.needs.hunger + 35);
      c.needs.health = Math.min(100, c.needs.health + 1);
    }
    actFor(ctx, 15 * 5);
  },
};

const buyFood: ActionDef = {
  id: 'buy_food',
  interruptible: false,
  score(ctx) {
    const { c, hour, sim } = ctx;
    if (isChild(c)) return 0;
    const h = c.needs.hunger;
    const purse = householdMoney(sim, c);
    const price = priceOf(sim, 'bread');
    if (purse < price) return 0;
    const home = homeOf(ctx);
    const homeBread = home ? home.storage['bread'] ?? 0 : 0;
    const familyNeed = home ? home.residents.length : 1;
    const canFeedFamily = home && homeBread < familyNeed && purse >= price * (familyNeed + 1);
    if (h > 55 && !canFeedFamily) return 0;
    if ((c.actionData.buyFail ?? 0) > sim.tick) return 0;
    let s = (62 - h) * 1.1;
    if (canFeedFamily) {
      const kids = home!.residents.filter((id) => isChild(sim.citizens[id])).length;
      const feed = 30 + kids * 6 + (c.profession === Profession.Housewife || c.profession === Profession.Servant ? 10 : 0);
      s = Math.max(s, feed);
      if (homeBread === 0) s += 8;
    }
    if (homeBread > 0 && home) {
      const d = Math.abs(home.doorX - c.x) + Math.abs(home.doorY - c.y);
      if (d < 25) s -= 25;
    }
    if (hasTrait(c, Trait.Greedy)) s -= 10;
    // дорогой хлеб отпугивает бедных
    if (price >= 2 && purse < price * 6) s -= (price - 1) * 6;
    if (!sellersOf(sim, 'bread', c.x, c.y, hour).length && !sellersOf(sim, 'meat', c.x, c.y, hour).length) return 0;
    return s;
  },
  start(ctx) {
    const { c, sim, hour, rng } = ctx;
    const sellers = sellersOf(sim, 'bread', c.x, c.y, hour);
    let b: Building | null = sellers[0] ?? null;
    if (sellers.length > 1 && rng.chance(0.3)) b = sellers[1];
    if (!b) {
      const ms = sellersOf(sim, 'meat', c.x, c.y, hour);
      b = ms[0] ?? null;
      if (b) c.actionData.good = 1;
    } else c.actionData.good = 0;
    if (!b) return false;
    think(c, pickText(rng, ['Схожу за хлебом.', 'Пахнет свежим хлебом…', 'Куплю что-нибудь поесть.', 'Хлеба бы купить.', `Говорят, у ${b.type === BuildingType.Bakery ? 'пекаря' : 'торговцев'} ещё есть хлеб.`]));
    return goToBuilding(ctx, b);
  },
  arrive(ctx) {
    const { c, sim, rng } = ctx;
    const b = sim.world.buildings[c.actionData.building];
    if (!b) return actFor(ctx, 10);
    const home = c.home >= 0 ? sim.world.buildings[c.home] : null;
    const family = home ? home.residents.length : 1;
    const purse = householdMoney(sim, c);
    const good: Good = c.actionData.good === 1 ? 'meat' : 'bread';
    const price = sim.market.retailPrice(b, good);
    let n = 1;
    if (purse >= price * 3 && !hasTrait(c, Trait.Greedy)) n = 2;
    if (home && family >= 3 && purse >= price * (family + 1)) n = Math.min(7, family + 1);
    if (hasTrait(c, Trait.Greedy) && price > 1) n = Math.min(n, 2);
    const got = sim.market.buyRetail(sim, c, b, good, n);
    if (got <= 0) {
      think(c, pickText(rng, ['Всё раскупили!', 'Полки пустые…', 'Опять без хлеба.']));
      say(c, pickText(rng, ['Как это — нет хлеба?!', 'Пусто… Куда всё делось?']), 35, false, sim.tick);
      c.mood -= 5;
      c.actionData.buyFail = sim.tick + 90;
      remember(c, sim.tick, 'В лавках не было хлеба.', 0.35, -1, 'nobread');
      return actFor(ctx, 10);
    }
    c.inventory[good] = (c.inventory[good] ?? 0) + got;
    // перекусить на месте
    if (c.needs.hunger < 60) {
      c.inventory[good]--;
      c.needs.hunger = Math.min(100, c.needs.hunger + GOOD_INFO[good].food);
    }
    // богатые берут и мяса
    if (good === 'bread' && purse > 40 && (b.storage['meat'] ?? 0) >= 1 && rng.chance(0.4)) {
      const m = sim.market.buyRetail(sim, c, b, 'meat', 1);
      if (m > 0) c.inventory['meat'] = (c.inventory['meat'] ?? 0) + m;
    }
    if (BUILDING_DEFS[b.type].enterable) enterBuilding(ctx, b);
    actFor(ctx, 4 * 5);
  },
};

const tavern: ActionDef = {
  id: 'tavern',
  interruptible: false,
  score(ctx) {
    const { c, hour, sched, sim } = ctx;
    const ale = priceOf(sim, 'ale');
    if (isChild(c) || c.money < ale) return 0;
    if (isWorkHour(sched, hour) && !(c.needs.hunger < 35 && c.money >= priceOf(sim, 'bread') * 2 + ale)) return 0;
    if (hour < 11) return 0;
    let s = 6 + (100 - c.needs.fun) * 0.3 + (100 - c.needs.social) * 0.2;
    if (hour >= 17) s += 10;
    if (hasTrait(c, Trait.Drunkard)) s += 22;
    if (hasTrait(c, Trait.Cheerful)) s += 5;
    if (hasTrait(c, Trait.Gloomy)) s -= 6;
    if (hasTrait(c, Trait.Pious)) s -= 8;
    if (hasTrait(c, Trait.Greedy)) s -= 8;
    if (c.needs.hunger < 45 && c.money >= priceOf(sim, 'bread') * 2) s += 15;
    if (c.drunk > 60) s -= 15;
    if (c.money < 10) s -= 8;
    if (c.profession === Profession.Priest || c.profession === Profession.Monk) s -= 40;
    if (!nearestOpen(sim, c, BuildingType.Tavern, hour)) return 0;
    return s;
  },
  start(ctx) {
    const { c, sim, hour, rng } = ctx;
    const b = nearestOpen(sim, c, BuildingType.Tavern, hour);
    if (!b) return false;
    think(c, pickText(rng, [`Пропущу кружечку в «${b.name}».`, 'Надо выпить.', `В «${b.name}» сегодня весело.`, 'Эль зовёт.', 'Заглянуть бы в таверну.']));
    return goToBuilding(ctx, b);
  },
  arrive(ctx) {
    const { c, sim, rng } = ctx;
    const b = sim.world.buildings[c.actionData.building];
    if (!b) return actFor(ctx, 10);
    enterBuilding(ctx, b);
    const m = sim.market;
    let drank = 0;
    // еда: хлеб и, если есть деньги, мясо
    if (c.needs.hunger < 50) {
      const got = m.buyRetail(sim, c, b, 'bread', 1, false);
      if (got) c.needs.hunger = Math.min(100, c.needs.hunger + 45);
      if (c.money > 15 && (b.storage['meat'] ?? 0) >= 1) {
        const mt = m.buyRetail(sim, c, b, 'meat', 1, false);
        if (mt) c.needs.hunger = Math.min(100, c.needs.hunger + 40);
      }
    }
    const cups = hasTrait(c, Trait.Drunkard) ? 3 : rng.chance(0.3) ? 2 : 1;
    if ((b.storage['freeAle'] ?? 0) > 0 && (b.storage['ale'] ?? 0) >= 1) {
      // праздничный эль за счёт казны
      b.storage['freeAle']--;
      b.storage['ale']--;
      drank = 1;
      if (rng.chance(0.5)) say(c, 'За здоровье бургомистра!', 35, false, sim.tick);
    } else drank = m.buyRetail(sim, c, b, 'ale', cups, false);
    if (drank === 0 && (b.storage['ale'] ?? 0) <= 0) {
      say(c, pickText(rng, ['Что значит — эль кончился?!', 'Пустые бочки? Позор!']), 35, false, sim.tick);
      think(c, 'В таверне нет эля. Ну и город.');
      c.mood -= 4;
      return actFor(ctx, rng.int(10, 20) * 5);
    }
    c.drunk = Math.min(100, c.drunk + 22 * drank);
    c.needs.fun = Math.min(100, c.needs.fun + 20 + 8 * drank);
    c.needs.social = Math.min(100, c.needs.social + 25);
    actFor(ctx, rng.int(40, 110) * 5);
  },
  finish(ctx) {
    const { c, rng, sim } = ctx;
    if (c.drunk > 50) {
      think(c, pickText(rng, ['Ик… где мой дом?', 'Хорошо посидели!', 'Ещё бы кружечку…']));
      say(c, pickText(rng, ['Ик!', 'Х-хорош-шо…', 'Эх, споём!', 'А я ещё могу!']), 40, false, sim.tick);
    }
  },
};

/** Доставка сырья/товара на рабочее место */
const haul: ActionDef = {
  id: 'haul',
  interruptible: false,
  score(ctx) {
    const { c, hour, sched, sim } = ctx;
    if (c.workplace < 0 || !isWorkHour(sched, hour)) return 0;
    if (c.profession === Profession.Guard || c.profession === Profession.Bard) return 0;
    if (c.actionData.dayOff === Math.floor(sim.tick / TICKS_PER_DAY)) return 0;
    const b = workOf(ctx);
    if (!b) return 0;
    const r = RECIPES[b.type];
    if (!r) return 0;
    if ((b.storage['_haulUntil'] ?? 0) > sim.tick) return 0;
    const owner = b.owner >= 0 ? sim.citizens[b.owner] : null;
    if (!owner || !owner.alive || owner.money < 3) return 0;
    const pick = pickHaulGood(ctx, b);
    if (!pick) return 0;
    c.actionData.haulGood = GOODS_INDEX[pick.good];
    c.actionData.haulFrom = pick.from.id;
    c.actionData.haulN = pick.n;
    let s = 56 + Math.min(10, pick.deficit);
    if (c.needs.hunger < 25) s -= 20;
    return s;
  },
  start(ctx) {
    const { c, sim, rng } = ctx;
    const b = workOf(ctx);
    const from = sim.world.buildings[c.actionData.haulFrom];
    if (!b || !from) return false;
    const good = GOODS_LIST[c.actionData.haulGood];
    b.storage['_haulUntil'] = sim.tick + 60;
    c.actionData.phase = 0;
    c.actionData.work = b.id;
    think(c, pickText(rng, [`Схожу за ${GOOD_INFO[good].name === 'мука' ? 'мукой' : GOOD_INFO[good].plural === 'зерна' ? 'зерном' : GOOD_INFO[good].plural} к ${BUILDING_DEFS[from.type].name.toLowerCase().replace(/^(.*)$/, (m) => m)}.`.replace('к дом', 'в дом'), `${BUILDING_DEFS[b.type].name}: кончается ${GOOD_INFO[good].name}. Надо привезти.`, 'Хозяин велел привезти припасы.']));
    return goToBuilding(ctx, from);
  },
  arrive(ctx) {
    const { c, sim, rng } = ctx;
    const b = sim.world.buildings[c.actionData.work];
    if (!b) return actFor(ctx, 10);
    const good = GOODS_LIST[c.actionData.haulGood];
    if (c.actionData.phase === 0) {
      const from = sim.world.buildings[c.actionData.haulFrom];
      if (!from) return actFor(ctx, 10);
      const got = sim.market.buyWholesale(sim, b, from, good, c.actionData.haulN);
      c.actionData.phase = 1;
      if (got > 0) {
        c.inventory[good] = (c.inventory[good] ?? 0) + got;
        c.actionData.got = got;
        if (rng.chance(0.3)) say(c, pickText(rng, ['Вот, хозяин просил.', 'Грузи, да не всё сразу.', 'Почём нынче?']), 30, false, sim.tick);
      } else {
        think(c, pickText(rng, ['Пусто. Зря ходил.', 'Не продали — денег не хватило.']));
      }
      // обратно
      c.actionData.building = b.id;
      goTo(ctx, b.doorX, b.doorY);
      return;
    }
    // разгрузка
    const n = c.inventory[good] ?? 0;
    if (n > 0) {
      addStock(b, good, n);
      c.inventory[good] = 0;
    }
    if (BUILDING_DEFS[b.type].enterable && b.type !== BuildingType.MarketStall) enterBuilding(ctx, b);
    actFor(ctx, 5);
  },
};

const GOODS_LIST: Good[] = ['grain', 'flour', 'bread', 'meat', 'hide', 'leather', 'wood', 'planks', 'stone', 'ale', 'tools', 'goods'];
const GOODS_INDEX: Record<Good, number> = Object.fromEntries(GOODS_LIST.map((g, i) => [g, i])) as Record<Good, number>;

function pickHaulGood(ctx: ActionCtx, b: Building): { good: Good; from: Building; n: number; deficit: number } | null {
  const { sim, hour } = ctx;
  const r = RECIPES[b.type];
  if (!r) return null;
  const owner = sim.citizens[b.owner];
  const candidates: Good[] = [...(Object.keys(r.inputs) as Good[]), ...r.sells];
  let best: { good: Good; from: Building; n: number; deficit: number } | null = null;
  for (const g of candidates) {
    // здание не закупает то, что само производит
    if ((r.outputs as Record<string, number>)[g]) continue;
    const want = wantedStock(b, g, Math.max(1, b.workers.length));
    const have = b.storage[g] ?? 0;
    const deficit = want - have;
    if (deficit < want * 0.5 || deficit < 1) continue;
    // поставщик: производитель или склад/другой продавец с запасом
    const types = producersOf(g);
    const options: { o: Building; d: number; st: number }[] = [];
    for (const o of sim.world.buildings) {
      if (o.id === b.id) continue;
      const isProducer = types.includes(o.type);
      const isReseller = o.type === BuildingType.Warehouse || (b.type === BuildingType.MarketStall && RECIPES[o.type]?.sells.includes(g) && o.type !== BuildingType.MarketStall && o.type !== BuildingType.Tavern);
      if (!isProducer && !isReseller) continue;
      const st = Math.floor(o.storage[g] ?? 0);
      // у производителя — оставить ему немного; у фермы берём всё
      const reserve = isProducer && o.type !== BuildingType.Farm && RECIPES[o.type]?.sells.includes(g) ? 3 : 0;
      if (st - reserve < 1) continue;
      if (!isProducer && !isOpenAt(o, hour)) continue;
      const dx = o.doorX - b.doorX;
      const dy = o.doorY - b.doorY;
      options.push({ o, d: dx * dx + dy * dy, st: st - reserve });
    }
    if (!options.length) continue;
    options.sort((a, z) => a.d - z.d);
    const top = options.slice(0, 3);
    const from = sim.rng.weighted(top.map((t) => t.o), top.map((t) => Math.sqrt(t.st)));
    const price = Math.max(0.5, sim.market.prices[g]);
    const afford = Math.floor(owner.money / price);
    const bulk = g === 'grain' || g === 'flour' || g === 'wood' || g === 'stone' || g === 'planks' ? 40 : 20;
    const n = Math.min(Math.ceil(deficit), bulk, afford, Math.floor(from.storage[g] ?? 0));
    if (n < 1) continue;
    const score = deficit / Math.max(1, want);
    if (!best || score > best.deficit / Math.max(1, wantedStock(b, best.good, 1))) best = { good: g, from, n, deficit };
  }
  return best;
}

const pray: ActionDef = {
  id: 'pray',
  interruptible: false,
  score(ctx) {
    const { c, hour, sched, sim } = ctx;
    if (isWorkHour(sched, hour) && !hasTrait(c, Trait.Pious)) return 0;
    if (isChild(c) && c.age < 6) return 0;
    const cathedral = sim.world.buildings.find((b) => b.type === BuildingType.Cathedral);
    if (!cathedral || !isOpen(cathedral, hour)) return 0;
    let s = (100 - c.needs.faith) * 0.4;
    if (hasTrait(c, Trait.Pious)) s += 18;
    if (Math.abs(hour - 7.5) < 0.6 || Math.abs(hour - 18.5) < 0.6) s += 20; // службы
    const day = Math.floor(sim.tick / TICKS_PER_DAY);
    if (day % 8 === 7) s += 20; // день отдыха
    if (c.needs.faith > 80) s -= 20;
    if (c.profession === Profession.Priest || c.profession === Profession.Monk) s = 0;
    if (hasTrait(c, Trait.Drunkard) && c.drunk > 40) s -= 20;
    return s;
  },
  start(ctx) {
    const { c, sim, rng } = ctx;
    const cathedral = sim.world.buildings.find((b) => b.type === BuildingType.Cathedral);
    if (!cathedral) return false;
    think(c, pickText(rng, ['Пойду помолюсь.', 'Пора в собор.', 'Господь не оставит.', 'Надо поставить свечу.', 'На душе неспокойно — схожу в собор.']));
    return goToBuilding(ctx, cathedral);
  },
  arrive(ctx) {
    const { c, sim, rng } = ctx;
    const b = sim.world.buildings[c.actionData.building];
    if (b) enterBuilding(ctx, b);
    c.needs.faith = Math.min(100, c.needs.faith + 50);
    c.needs.safety = Math.min(100, c.needs.safety + 10);
    // пожертвование
    if (c.money >= 1 && (hasTrait(c, Trait.Pious) || rng.chance(0.3)) && !hasTrait(c, Trait.Greedy)) {
      c.money -= 1;
      if (b) b.storage['money'] = (b.storage['money'] ?? 0) + 1;
    }
    actFor(ctx, rng.int(25, 50) * 5);
  },
};

const stroll: ActionDef = {
  id: 'stroll',
  interruptible: true,
  score(ctx) {
    const { c, hour, sched } = ctx;
    if (isSleepHour(sched, hour) || isWorkHour(sched, hour)) return 0;
    if (c.needs.energy < 20) return 0;
    let s = 6 + (100 - c.needs.fun) * 0.22 + (100 - c.needs.social) * 0.15;
    if (hour >= 16 && hour < 21) s += 10;
    s -= ctx.sim.weather.rain * 18 + (ctx.sim.season === 3 ? 8 : 0);
    if (c.flags & 4) s -= 15;
    if (hasTrait(c, Trait.Curious)) s += 8;
    if (hasTrait(c, Trait.Gloomy)) s -= 6;
    if (hasTrait(c, Trait.Talkative)) s += 5;
    if (isElder(c)) s -= 5;
    return s;
  },
  start(ctx) {
    const { c, sim, rng } = ctx;
    const spots = sim.world.poi.strollSpots;
    const spot = rng.pick(spots);
    const near = randomRoadTileNear(sim, rng, spot.x, spot.y, 4) ?? spot;
    think(c, pickText(rng, [`Пройдусь до ${spot.name === 'площадь' ? 'площади' : spot.name === 'колодец' ? 'колодца' : spot.name === 'берег реки' ? 'реки' : 'ворот'}.`, 'Надо проветриться.', 'Посмотрю, что нового в городе.', 'Хорошая погода для прогулки.', 'Прогуляюсь.']));
    return goTo(ctx, near.x, near.y);
  },
  arrive(ctx) {
    const { c, rng } = ctx;
    c.needs.fun = Math.min(100, c.needs.fun + 8);
    actFor(ctx, rng.int(8, 25) * 5);
  },
};

const wander: ActionDef = {
  id: 'wander',
  interruptible: true,
  score(ctx) {
    const { c, hour, sched } = ctx;
    if (isSleepHour(sched, hour)) return 1;
    let s = 4;
    if (hasTrait(c, Trait.Curious)) s += 3;
    if (c.needs.energy < 20) s -= 3;
    return s;
  },
  start(ctx) {
    const { c, sim, rng } = ctx;
    const spot = randomRoadTileNear(sim, rng, c.x, c.y, 7);
    if (!spot) return false;
    if (rng.chance(0.3)) think(c, pickText(rng, ['Куда бы пойти…', 'Загляну за угол.', 'Что там за шум?', 'Пройдусь немного.']));
    return goTo(ctx, spot.x, spot.y);
  },
  arrive(ctx) {
    actFor(ctx, ctx.rng.int(2, 8) * 5);
  },
};

const homeRest: ActionDef = {
  id: 'home_rest',
  interruptible: false,
  score(ctx) {
    const { c, hour, sched } = ctx;
    const home = homeOf(ctx);
    if (!home) return 0;
    if (isSleepHour(sched, hour)) return 0;
    let s = 7 + ctx.sim.weather.rain * 14 + (ctx.sim.season === 3 ? 6 : 0);
    if (c.flags & 4) s += 20; // болен — лежит дома
    if (c.profession === Profession.Housewife && hour >= 8 && hour < 18) s += 22;
    if (hour >= 20) s += 18;
    if (hour >= 12 && hour < 14) s += 6;
    if (hasTrait(c, Trait.Gloomy)) s += 8;
    if (hasTrait(c, Trait.Lazy)) s += 6;
    if (hasTrait(c, Trait.Curious) || hasTrait(c, Trait.Talkative)) s -= 5;
    if (c.needs.energy < 35) s += 15;
    if (isElder(c)) s += 6;
    const d = Math.abs(home.doorX - c.x) + Math.abs(home.doorY - c.y);
    s -= d * 0.15;
    return s;
  },
  start(ctx) {
    const { c, rng } = ctx;
    const home = homeOf(ctx);
    if (!home) return false;
    const texts = c.profession === Profession.Housewife ? ['Дома дел невпроворот.', 'Надо прибраться.', 'Пора готовить обед.', 'Дети опять всё разбросали.'] : ['Посижу дома.', 'Домой, к очагу.', 'Отдохну немного.', 'Дома и стены помогают.'];
    think(c, pickText(rng, texts));
    return goToBuilding(ctx, home);
  },
  arrive(ctx) {
    const { c, sim, rng } = ctx;
    const home = sim.world.buildings[c.actionData.building];
    if (home) enterBuilding(ctx, home);
    actFor(ctx, rng.int(25, 70) * 5);
  },
  tick(ctx) {
    const { c, sim } = ctx;
    c.needs.energy = Math.min(100, c.needs.energy + 0.12);
    c.needs.safety = Math.min(100, c.needs.safety + 0.1);
    // поужинать, если дома есть хлеб
    if (c.needs.hunger < 55 && c.inside >= 0) {
      const home = sim.world.buildings[c.inside];
      if (home && (home.storage['bread'] ?? 0) > 0) {
        home.storage['bread']--;
        c.needs.hunger = Math.min(100, c.needs.hunger + 50);
      }
    }
    return false;
  },
};

const play: ActionDef = {
  id: 'play',
  interruptible: true,
  score(ctx) {
    const { c, hour, sched } = ctx;
    if (!isChild(c) || c.age < 3) return 0;
    if (isSleepHour(sched, hour)) return 0;
    let s = 25 + (100 - c.needs.fun) * 0.3;
    if (hour < 8 || hour > 19) s -= 20;
    if (c.needs.energy < 25) s -= 15;
    return s;
  },
  start(ctx) {
    const { c, sim, rng } = ctx;
    const home = homeOf(ctx);
    const base = home && rng.chance(0.6) ? { x: home.doorX, y: home.doorY } : { x: sim.world.poi.cx, y: sim.world.poi.cy };
    const spot = randomRoadTileNear(sim, rng, base.x, base.y, 6);
    if (!spot) return false;
    think(c, pickText(rng, ['Побегу играть!', 'Догоняй!', 'Кто последний — тот гусь!', 'Пойду искать друзей.', 'Ура, можно гулять!']));
    return goTo(ctx, spot.x, spot.y);
  },
  arrive(ctx) {
    const { c, rng } = ctx;
    c.needs.fun = Math.min(100, c.needs.fun + 12);
    c.needs.social = Math.min(100, c.needs.social + 6);
    c.needs.energy = Math.max(0, c.needs.energy - 2);
    actFor(ctx, rng.int(2, 6) * 5);
  },
};

const bench: ActionDef = {
  id: 'bench',
  interruptible: true,
  score(ctx) {
    const { c, hour, sched, sim } = ctx;
    if (isSleepHour(sched, hour) || isWorkHour(sched, hour)) return 0;
    if (!sim.world.poi.benches.length) return 0;
    let s = 0;
    if (isElder(c)) s = 22;
    else s = 3 + (100 - c.needs.energy) * 0.1;
    if ((hour >= 10 && hour < 12) || (hour >= 15 && hour < 18)) s += 8;
    if (sim.season === 3) s -= 12;
    if (hour < 7 || hour > 20) s -= 10;
    return s;
  },
  start(ctx) {
    const { c, sim, rng } = ctx;
    const b = rng.pick(sim.world.poi.benches);
    const nw = nearestWalkable(sim.world, b.x, b.y + 1, 2);
    if (!nw) return false;
    think(c, pickText(rng, ['Посижу на лавочке.', 'Погреюсь на солнышке.', 'Посмотрю на людей.', 'В мои годы спешить некуда.', 'Кости болят — присяду.']));
    return goTo(ctx, nw.x, nw.y);
  },
  arrive(ctx) {
    const { c, rng } = ctx;
    c.dir = 0;
    c.needs.energy = Math.min(100, c.needs.energy + 5);
    c.needs.fun = Math.min(100, c.needs.fun + 5);
    actFor(ctx, rng.int(20, 50) * 5);
  },
};

const beg: ActionDef = {
  id: 'beg',
  interruptible: true,
  score(ctx) {
    const { c, hour, sched } = ctx;
    if (c.profession !== Profession.Beggar) return 0;
    if (isSleepHour(sched, hour)) return 0;
    let s = 30;
    if (hour < 8 || hour > 20) s -= 15;
    return s;
  },
  start(ctx) {
    const { c, sim, rng } = ctx;
    const spot = rng.pick(sim.world.poi.strollSpots);
    const near = randomRoadTileNear(sim, rng, spot.x, spot.y, 3) ?? spot;
    think(c, pickText(rng, ['Подайте на хлеб…', 'Может, сегодня повезёт.', 'Люди добрые, подайте.']));
    return goTo(ctx, near.x, near.y);
  },
  arrive(ctx) {
    actFor(ctx, ctx.rng.int(20, 50) * 5);
  },
  tick(ctx) {
    const { c, rng, sim } = ctx;
    if (rng.chance(0.03)) say(c, pickText(rng, ['Подайте, люди добрые!', 'На хлеб бы…', 'Хоть монетку!']), 30, false, sim.tick);
    return false;
  },
};

const prowl: ActionDef = {
  id: 'prowl',
  interruptible: true,
  score(ctx) {
    const { c, hour } = ctx;
    if (c.profession !== Profession.Thief) return 0;
    if (hour >= 22 || hour < 4) return 40;
    if (hour >= 10 && hour < 20) return 34; // присматривается на площади
    return 0;
  },
  start(ctx) {
    const { c, sim, rng } = ctx;
    const world = sim.world;
    const night = hourOf(sim.tick) >= 22 || hourOf(sim.tick) < 4;
    const sq = world.poi.square;
    const spot = night
      ? randomRoadTileNear(sim, rng, world.poi.cx + rng.float(-20, 20), world.poi.cy + rng.float(-20, 20), 10)
      : nearestWalkable(world, sq.x + rng.int(1, sq.w - 2), sq.y + rng.int(1, sq.h - 2), 3);
    if (!spot) return false;
    think(c, pickText(rng, night ? ['Присмотрюсь к богатым домам.', 'Тихо… никого.', 'Стража далеко.'] : ['У того купца кошель тяжёлый.', 'В толпе легче всего.', 'Главное — не попадаться на глаза страже.']));
    return goTo(ctx, spot.x, spot.y);
  },
  arrive(ctx) {
    actFor(ctx, ctx.rng.int(3, 10) * 5);
  },
};

const fetchWater: ActionDef = {
  id: 'fetch_water',
  interruptible: true,
  score(ctx) {
    const { c, hour, sched } = ctx;
    if (isChild(c) || isSleepHour(sched, hour)) return 0;
    if (isWorkHour(sched, hour) && c.profession !== Profession.Servant) return 0;
    let s = 0;
    if (c.profession === Profession.Housewife || c.profession === Profession.Servant) s = 14;
    else if (c.home >= 0) s = 4;
    if (hour >= 7 && hour < 11) s += 6;
    if (hour >= 17 && hour < 19) s += 4;
    if (c.actionData.water_day === Math.floor(ctx.sim.tick / TICKS_PER_DAY)) s -= 12;
    return s;
  },
  start(ctx) {
    const { c, sim, rng } = ctx;
    const well = sim.world.buildings.find((b) => b.type === BuildingType.Well);
    if (!well) return false;
    think(c, pickText(rng, ['Схожу за водой к колодцу.', 'Вёдра пусты.', 'У колодца всегда узнаешь новости.']));
    return goTo(ctx, well.doorX, well.doorY);
  },
  arrive(ctx) {
    const { c, sim, rng } = ctx;
    c.actionData.water_day = Math.floor(sim.tick / TICKS_PER_DAY);
    c.dir = 3;
    actFor(ctx, rng.int(3, 6) * 5);
  },
};

const visitFriend: ActionDef = {
  id: 'visit_friend',
  interruptible: true,
  score(ctx) {
    const { c, hour, sched, sim } = ctx;
    if (isSleepHour(sched, hour) || isWorkHour(sched, hour)) return 0;
    if (c.needs.social > 60) return 0;
    if (c.talkCooldown > 0) return 0;
    let best = 0;
    for (const [id, v] of c.relations) {
      if (v < 25) continue;
      const o = sim.citizens[id];
      if (!o || !o.alive || o.inside >= 0 || o.state === CitizenState.Sleeping || o.state === CitizenState.Talking) continue;
      if (isChild(c) !== isChild(o)) continue;
      const d = Math.abs(o.x - c.x) + Math.abs(o.y - c.y);
      if (d > 45) continue;
      const sc = (60 - c.needs.social) * 0.5 + v * 0.2 - d * 0.3 + (hasTrait(c, Trait.Talkative) ? 10 : 0) + (hasTrait(c, Trait.Gloomy) ? -10 : 0);
      if (sc > best) {
        best = sc;
        c.actionData.friend = id;
      }
    }
    return best;
  },
  start(ctx) {
    const { c, sim, rng } = ctx;
    const o = sim.citizens[c.actionData.friend];
    if (!o || !o.alive || o.inside >= 0) return false;
    think(c, pickText(rng, [`Пойду проведаю ${o.firstName}.`, `Давно не видел${c.sex === 'f' ? 'а' : ''} ${o.firstName}.`, `Надо перекинуться словечком с ${o.firstName}.`]));
    return goTo(ctx, Math.round(o.x), Math.round(o.y));
  },
  arrive(ctx) {
    const { c, sim } = ctx;
    const o = sim.citizens[c.actionData.friend];
    if (o && o.alive && o.inside < 0 && Math.abs(o.x - c.x) + Math.abs(o.y - c.y) < 3 && o.state !== CitizenState.Sleeping && o.state !== CitizenState.Talking) {
      c.talkCooldown = 0;
      o.talkCooldown = 0;
      if (startTalkRef && startTalkRef(sim, c, o)) return;
    }
    actFor(ctx, 10);
  },
};

/** Ссылка на запуск разговора (устанавливается из conversation.ts, чтобы избежать циклического импорта) */
export let startTalkRef: ((sim: Simulation, a: Citizen, b: Citizen) => boolean) | null = null;
export function setStartTalk(fn: (sim: Simulation, a: Citizen, b: Citizen) => boolean): void {
  startTalkRef = fn;
}

/** Покупка изделий, кожи, инструментов — состоятельные горожане тратят деньги */
const shopLuxury: ActionDef = {
  id: 'shop',
  interruptible: true,
  score(ctx) {
    const { c, hour, sched, sim } = ctx;
    if (isChild(c) || isSleepHour(sched, hour) || isWorkHour(sched, hour)) return 0;
    if (c.money < 40) return 0;
    if ((c.actionData.shopDay ?? -1) === Math.floor(sim.tick / TICKS_PER_DAY)) return 0;
    let s = 4 + Math.min(20, (c.money - 40) / 10);
    if (hasTrait(c, Trait.Greedy)) s -= 12;
    if (hasTrait(c, Trait.Ambitious) || hasTrait(c, Trait.Envious)) s += 5;
    if (c.profession === Profession.Noble || c.profession === Profession.Lord) s += 8;
    if (!sellersOf(sim, 'goods', c.x, c.y, hour).length && !sellersOf(sim, 'leather', c.x, c.y, hour).length && !sellersOf(sim, 'tools', c.x, c.y, hour).length) return 0;
    return s;
  },
  start(ctx) {
    const { c, sim, hour, rng } = ctx;
    const good: Good = rng.pick(['goods', 'leather', 'tools'] as Good[]);
    const sellers = sellersOf(sim, good, c.x, c.y, hour);
    if (!sellers.length) return false;
    c.actionData.good = GOODS_INDEX[good];
    think(c, pickText(rng, ['Куплю что-нибудь для дома.', 'Давно хотел новые сапоги.', 'Надо бы новый нож.', 'Присмотрю подарок жене.', 'Деньги есть — пора приодеться.']));
    return goToBuilding(ctx, sellers[0]);
  },
  arrive(ctx) {
    const { c, sim, rng } = ctx;
    const b = sim.world.buildings[c.actionData.building];
    c.actionData.shopDay = Math.floor(sim.tick / TICKS_PER_DAY);
    if (!b) return actFor(ctx, 10);
    const good = GOODS_LIST[c.actionData.good];
    const got = sim.market.buyRetail(sim, c, b, good, 1, false);
    if (got > 0) {
      c.needs.fun = Math.min(100, c.needs.fun + 15);
      c.mood += 3;
      if (rng.chance(0.4)) say(c, pickText(rng, ['Добротная вещь.', 'Дороговато, но хорошо.', 'Заверните.']), 30, false, sim.tick);
      // вещь «потребляется» — изнашивается
    }
    if (BUILDING_DEFS[b.type].enterable) enterBuilding(ctx, b);
    actFor(ctx, rng.int(5, 12) * 5);
  },
};

const idle: ActionDef = {
  id: 'idle',
  interruptible: true,
  score() {
    return 1;
  },
  start(ctx) {
    actFor(ctx, ctx.rng.int(2, 6) * 5);
    return true;
  },
  arrive(ctx) {
    actFor(ctx, 10);
  },
};

export const ACTIONS: Record<string, ActionDef> = {};
for (const a of [sleep, work, haul, patrol, eatHome, buyFood, tavern, shopLuxury, pray, stroll, wander, homeRest, play, bench, beg, prowl, fetchWater, visitFriend, idle]) ACTIONS[a.id] = a;

export const ACTION_LABELS: Record<string, string> = {
  sleep: 'спит',
  work: 'работает',
  patrol: 'патрулирует',
  eat_home: 'ест дома',
  buy_food: 'покупает еду',
  tavern: 'в таверне',
  pray: 'молится',
  stroll: 'гуляет',
  wander: 'бродит',
  home_rest: 'дома',
  play: 'играет',
  bench: 'сидит на лавке',
  beg: 'просит милостыню',
  prowl: 'присматривается',
  fetch_water: 'идёт за водой',
  idle: 'стоит',
  talk: 'беседует',
  visit_friend: 'идёт к другу',
  haul: 'везёт припасы',
  shop: 'ходит по лавкам',
  order: 'выполняет приказ',
};

export { District, EventKind };
