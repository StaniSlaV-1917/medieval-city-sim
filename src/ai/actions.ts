// Действия жителей: оценка полезности, старт, прибытие, выполнение.
import type { Simulation } from '../sim/game';
import { Citizen, CitizenState, Profession, Trait, hasTrait, isChild, isElder, Memory } from '../sim/citizen';
import { DaySchedule, isWorkHour, isSleepHour } from '../sim/schedule';
import { setDestination } from '../sim/movement';
import { Building, BuildingType, BUILDING_DEFS, District } from '../world/buildings';
import { Tile } from '../world/tiles';
import { idx, isWalkableAt, isRoadTile, nearestWalkable } from '../world/world';
import { TICKS_PER_HOUR, TICKS_PER_DAY, hourOf } from '../core/time';
import { RNG } from '../core/rng';
import { pay, householdMoney, householdPay } from '../economy/money';
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

export const PRICES = { bread: 1, meal: 2, ale: 1 };

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
  if (b.id === c.home && (c.inventory['bread'] ?? 0) > 0) {
    // принёс хлеб домой — в общий запас семьи
    b.storage['bread'] = (b.storage['bread'] ?? 0) + c.inventory['bread'];
    c.inventory['bread'] = 0;
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
    let s = 50;
    if (hasTrait(c, Trait.Hardworking)) s += 10;
    if (hasTrait(c, Trait.Ambitious)) s += 6;
    if (hasTrait(c, Trait.Lazy)) s -= 12;
    if (c.needs.hunger < 30) s -= 25;
    if (c.needs.hunger < 60 && Math.abs(hour - sched.lunch) < 0.7) s -= 18; // обед
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
    const { c } = ctx;
    c.needs.fun = Math.max(0, c.needs.fun - 0.03);
    // доход: небольшой заработок от работодателя или из казны (фаза 3 — полноценная экономика)
    return false;
  },
  finish(ctx) {
    const { c, sim } = ctx;
    const b = workOf(ctx);
    if (!b) return;
    // Жалованье: раз в завершение смены (если это конец рабочего дня)
    const hour = hourOf(sim.tick);
    if (!isWorkHour(ctx.sched, hour + 0.5)) {
      let wage = wageOf(c);
      if (hasTrait(c, Trait.Lazy)) wage = Math.round(wage * 0.8);
      if (wage > 0) {
        // владелец платит из своих денег (если есть), иначе казна; первичные производства
        // (фермы, каменоломня, лесопилка, мельница, кожевня) продают сырьё за город — внешний доход
        const owner = b.owner >= 0 && b.owner !== c.id ? sim.citizens[b.owner] : null;
        const primary = b.type === BuildingType.Farm || b.type === BuildingType.Quarry || b.type === BuildingType.Sawmill || b.type === BuildingType.Mill || b.type === BuildingType.Tannery || b.type === BuildingType.Smithy || b.type === BuildingType.Carpenter || b.type === BuildingType.Mason;
        if (owner && owner.alive && owner.money >= wage + 20) pay(sim, owner, c, wage);
        else if (primary) {
          c.money += wage;
          sim.moneyCreated += wage;
          sim.exportIncome += wage;
        } else if (sim.treasury >= wage) {
          sim.treasury -= wage;
          c.money += wage;
        } else if (c.profession === Profession.Farmer || c.profession === Profession.Laborer) {
          c.money += wage;
          sim.moneyCreated += wage;
          sim.exportIncome += wage;
        }
        shareWage(sim, c, wage);
      }
      // владелец лавки: выручка дня из казны-рынка — заглушка до фазы 3: небольшой доход от «покупателей» уже реализован через покупки
    }
  },
};

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
    if (!isWorkHour(ctx.sched, hour + 0.5) && sim.treasury >= 6) {
      sim.treasury -= 6;
      c.money += 6;
      shareWage(sim, c, 6);
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
    actFor(ctx, 15 * 5);
  },
};

const buyFood: ActionDef = {
  id: 'buy_food',
  interruptible: false,
  score(ctx) {
    const { c, hour } = ctx;
    if (isChild(c)) return 0;
    const h = c.needs.hunger;
    const purse = householdMoney(ctx.sim, c);
    if (purse < PRICES.bread) return 0;
    const home = homeOf(ctx);
    if (h > 55 && !(home && (home.storage['bread'] ?? 0) < home.residents.length && purse >= PRICES.bread * (home.residents.length + 1))) return 0;
    const homeBread = home ? home.storage['bread'] ?? 0 : 0;
    let s = (62 - h) * 1.1;
    if (home && homeBread < home.residents.length && purse >= PRICES.bread * (home.residents.length + 1)) {
      // семью кормить надо — особенно если дома дети
      const kids = home.residents.filter((id) => isChild(ctx.sim.citizens[id])).length;
      const feed = 30 + kids * 6 + (c.profession === Profession.Housewife || c.profession === Profession.Servant ? 10 : 0);
      s = Math.max(s, feed);
      if (homeBread === 0) s += 8;
    }
    if (homeBread > 0 && home) {
      const d = Math.abs(home.doorX - c.x) + Math.abs(home.doorY - c.y);
      if (d < 25) s -= 25;
    }
    if (hasTrait(c, Trait.Greedy)) s -= 10;
    if (!nearestOpen(ctx.sim, c, BuildingType.Bakery, hour) && !nearestOpen(ctx.sim, c, BuildingType.MarketStall, hour)) return 0;
    return s;
  },
  start(ctx) {
    const { c, sim, hour, rng } = ctx;
    let b = nearestOpen(sim, c, BuildingType.Bakery, hour);
    if (!b || rng.chance(0.3)) {
      const st = nearestOpen(sim, c, BuildingType.MarketStall, hour);
      if (st) b = st;
    }
    if (!b) return false;
    think(c, pickText(rng, ['Схожу за хлебом.', 'Пахнет свежим хлебом…', 'Куплю что-нибудь поесть.', 'Хлеба бы купить.']));
    return goToBuilding(ctx, b);
  },
  arrive(ctx) {
    const { c, sim } = ctx;
    const b = sim.world.buildings[c.actionData.building];
    if (!b) return actFor(ctx, 10);
    const owner = b.owner >= 0 ? sim.citizens[b.owner] : null;
    const home = c.home >= 0 ? sim.world.buildings[c.home] : null;
    const family = home ? home.residents.length : 1;
    const purse = householdMoney(sim, c);
    let n = 1;
    if (purse >= PRICES.bread * 3 && !hasTrait(c, Trait.Greedy)) n = 2;
    if (home && family >= 3 && purse >= PRICES.bread * (family + 1)) n = Math.min(7, family + 1);
    const cost = PRICES.bread * n;
    if (purse < cost) return actFor(ctx, 10);
    householdPay(sim, c, owner && owner.alive ? owner : null, cost);
    c.inventory['bread'] = (c.inventory['bread'] ?? 0) + n;
    // перекусить на месте
    c.inventory['bread']--;
    c.needs.hunger = Math.min(100, c.needs.hunger + 50);
    if (BUILDING_DEFS[b.type].enterable) enterBuilding(ctx, b);
    actFor(ctx, 4 * 5);
  },
};

const tavern: ActionDef = {
  id: 'tavern',
  interruptible: false,
  score(ctx) {
    const { c, hour, sched } = ctx;
    if (isChild(c) || c.money < PRICES.ale) return 0;
    if (isWorkHour(sched, hour) && !(c.needs.hunger < 35 && c.money >= PRICES.meal + PRICES.ale)) return 0;
    if (hour < 11) return 0;
    let s = 6 + (100 - c.needs.fun) * 0.3 + (100 - c.needs.social) * 0.2;
    if (hour >= 17) s += 10;
    if (hasTrait(c, Trait.Drunkard)) s += 22;
    if (hasTrait(c, Trait.Cheerful)) s += 5;
    if (hasTrait(c, Trait.Gloomy)) s -= 6;
    if (hasTrait(c, Trait.Pious)) s -= 8;
    if (hasTrait(c, Trait.Greedy)) s -= 8;
    if (c.needs.hunger < 45 && c.money >= PRICES.meal) s += 15;
    if (c.drunk > 60) s -= 15;
    if (c.profession === Profession.Priest || c.profession === Profession.Monk) s -= 40;
    if (!nearestOpen(ctx.sim, c, BuildingType.Tavern, hour)) return 0;
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
    const owner = b.owner >= 0 ? sim.citizens[b.owner] : null;
    let cost = PRICES.ale;
    if (c.needs.hunger < 45 && c.money >= PRICES.meal + PRICES.ale) {
      cost += PRICES.meal;
      c.needs.hunger = Math.min(100, c.needs.hunger + 40);
    }
    if (hasTrait(c, Trait.Drunkard) && c.money >= cost + PRICES.ale * 2) {
      cost += PRICES.ale * 2;
      c.drunk += 30;
    }
    if (c.money < cost) cost = Math.min(c.money, PRICES.ale);
    if (cost > 0) {
      if (owner && owner.alive && owner.id !== c.id) pay(sim, c, owner, cost);
      else {
        c.money -= cost;
        sim.treasury += cost;
      }
    }
    c.drunk = Math.min(100, c.drunk + 25);
    c.needs.fun = Math.min(100, c.needs.fun + 30);
    c.needs.social = Math.min(100, c.needs.social + 25);
    b.storage['ale_sold'] = (b.storage['ale_sold'] ?? 0) + 1;
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
    let s = 7;
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
    if (hour >= 10 && hour < 20) return 12; // присматривается на площади
    return 0;
  },
  start(ctx) {
    const { c, sim, rng } = ctx;
    const world = sim.world;
    const spot = randomRoadTileNear(sim, rng, world.poi.cx + rng.float(-20, 20), world.poi.cy + rng.float(-20, 20), 10);
    if (!spot) return false;
    think(c, pickText(rng, ['Присмотрюсь к богатым домам.', 'Тихо… никого.', 'У того купца кошель тяжёлый.', 'Стража далеко.']));
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
for (const a of [sleep, work, patrol, eatHome, buyFood, tavern, pray, stroll, wander, homeRest, play, bench, beg, prowl, fetchWater, idle]) ACTIONS[a.id] = a;

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
};

export { District, EventKind };
