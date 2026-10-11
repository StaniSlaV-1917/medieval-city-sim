// Логистика и хранение (фаза 15): вместимость хранилищ, носильщики с тачками и повозками,
// порча еды (в амбаре медленнее, в погребе с солью ещё медленнее), крысы в амбаре, топливо для домов.
import type { Simulation } from '../sim/game';
import { Building, BuildingType, BUILDING_DEFS } from '../world/buildings';
import { Good, GOODS, GOOD_INFO, isGood } from './goods';
import { RECIPES, addStock } from './production';
import { ACTIONS, ActionDef, actFor, goTo, goToBuilding, enterBuilding, say, think, payShiftWage } from '../ai/actions';
import { isWorkHour } from '../sim/schedule';
import { Citizen, Profession, Trait, hasTrait, isChild } from '../sim/citizen';
import { TICKS_PER_DAY, TICKS_PER_HOUR, Season } from '../core/time';
import { EventKind } from '../events/chronicle';
import { householdMoney } from './money';
import { sellersOf } from './market';
import { dist2 } from '../core/math';

/** Вместимость хранилища (товаров всего); у производителей и домов — своя */
export function storeCapacity(b: Building): number {
  const def = BUILDING_DEFS[b.type];
  if (def.storeCap) return def.storeCap;
  if (b.type === BuildingType.Warehouse) return 600;
  if (def.home) return 80;
  return 200;
}

export function storedTotal(b: Building): number {
  let s = 0;
  for (const [k, v] of Object.entries(b.storage)) if (isGood(k) && v > 0) s += v;
  return s;
}

export function freeSpace(b: Building): number {
  return Math.max(0, storeCapacity(b) - storedTotal(b));
}

/** Принимает ли хранилище товар */
export function storeAccepts(b: Building, g: Good): boolean {
  const def = BUILDING_DEFS[b.type];
  const info = GOOD_INFO[g];
  if (b.type === BuildingType.Warehouse) return info.store === 'warehouse' || info.store === 'woodshed';
  if (b.type === BuildingType.Cellar) return info.store === 'granary' && info.spoil > 0;
  if (def.stores === 'granary') return info.store === 'granary';
  if (def.stores === 'woodshed') return info.store === 'woodshed';
  return false;
}

/** Есть ли в городе конюшня с конюхом — тогда носильщики ходят с повозкой */
function hasCarts(sim: Simulation): boolean {
  return sim.world.buildings.some((b) => b.type === BuildingType.Stable && b.condition > 0 && b.underConstruction === undefined && b.workers.length > 0);
}

/** Производители, у которых лежит готовая продукция для этого хранилища */
function pickPickup(sim: Simulation, store: Building): { from: Building; good: Good; n: number } | null {
  let best: { from: Building; good: Good; n: number; score: number } | null = null;
  for (const b of sim.world.buildings) {
    if (b.w <= 0 || b.id === store.id || b.condition <= 0 || b.underConstruction !== undefined) continue;
    const r = RECIPES[b.type];
    if (!r || BUILDING_DEFS[b.type].stores) continue;
    for (const g of Object.keys(r.outputs) as Good[]) {
      if (!storeAccepts(store, g)) continue;
      // производитель оставляет себе немного на продажу
      const keep = keepFor(b, g);
      const n = Math.floor((b.storage[g] ?? 0) - keep);
      if (n < 4) continue;
      const d = Math.sqrt(dist2(b.doorX, b.doorY, store.doorX, store.doorY));
      const score = n - d * 0.3;
      if (!best || score > best.score) best = { from: b, good: g, n, score };
    }
  }
  return best;
}

/** Сколько товара производитель оставляет у себя (на розницу у прилавка) */
function keepFor(b: Building, g: Good): number {
  const r = RECIPES[b.type];
  if (!r || !r.sells.includes(g)) return 2;
  return GOOD_INFO[g].food ? 30 : 10;
}

/** Носильщик: забирает продукцию с производств на склад/в амбар/в дровяной сарай */
const porter: ActionDef = {
  id: 'porter',
  interruptible: false,
  score(ctx) {
    const { c, sim, hour, sched } = ctx;
    if (c.workplace < 0 || c.profession !== Profession.Porter || !isWorkHour(sched, hour)) return 0;
    const store = sim.world.buildings[c.workplace];
    if (!store || store.condition <= 0 || store.closed) return 0;
    if (freeSpace(store) < 6) return 0;
    if ((c.actionData.porterIdle ?? 0) > sim.tick) return 0;
    if (c.needs.hunger < 25 || c.needs.energy < 15) return 0;
    return 58;
  },
  start(ctx) {
    const { c, sim, rng } = ctx;
    const store = sim.world.buildings[c.workplace];
    const pick = pickPickup(sim, store);
    if (!pick) {
      c.actionData.porterIdle = sim.tick + 120;
      return false;
    }
    c.actionData.haulFrom = pick.from.id;
    c.actionData.haulGoodName = GOODS.indexOf(pick.good);
    c.actionData.cart = hasCarts(sim) ? 1 : 0;
    c.actionData.phase = 0;
    think(c, rng.pick([`Схожу за ${GOOD_INFO[pick.good].plural === 'зерна' ? 'зерном' : GOOD_INFO[pick.good].plural} на ${BUILDING_DEFS[pick.from.type].name.toLowerCase()}.`, 'Носить — так носить.', c.actionData.cart ? 'Запрягу повозку.' : 'Тачку бы…']));
    return goToBuilding(ctx, pick.from);
  },
  arrive(ctx) {
    const { c, sim, rng } = ctx;
    const store = sim.world.buildings[c.workplace];
    if (!store) return actFor(ctx, 5);
    const good = GOODS[c.actionData.haulGoodName];
    if ((c.actionData.phase ?? 0) === 0) {
      const from = sim.world.buildings[c.actionData.haulFrom];
      if (from && good) {
        const carry = (c.actionData.cart ? 24 : 8) * (hasTrait(c, Trait.Hardworking) ? 1.25 : 1);
        const keep = keepFor(from, good);
        let n = Math.max(0, Math.min(Math.floor(carry), Math.floor((from.storage[good] ?? 0) - keep), Math.floor(freeSpace(store))));
        // склад закупает товар у производителя по оптовой цене: платит хозяин склада, у городских хранилищ — казна
        const unit = Math.max(0.5, Math.round(sim.market.prices[good] * 0.9 * 10) / 10);
        const payer = store.owner >= 0 ? sim.citizens[store.owner] : null;
        const budget = payer && payer.alive ? payer.money : sim.treasury;
        n = Math.min(n, Math.floor(budget / unit));
        if (n > 0) {
          const cost = Math.round(n * unit);
          const seller = from.owner >= 0 ? sim.citizens[from.owner] : null;
          if (payer && payer.alive) payer.money -= cost;
          else sim.treasury -= cost;
          if (seller && seller.alive && seller.id !== store.owner) seller.money += cost;
          else sim.treasury += cost;
          from.storage.revenue = (from.storage.revenue ?? 0) + cost;
          from.storage[good] -= n;
          c.inventory[good] = (c.inventory[good] ?? 0) + n;
          c.actionData.hauling = 1;
          sim.market.flow(good, 'носильщики', -n, 'transfer');
          if (rng.chance(0.3)) say(c, rng.pick(['Грузим!', 'Это на склад.', 'Тяжёлый мешок.']), 25, false, sim.tick);
        } else c.actionData.porterIdle = sim.tick + 120;
      }
      c.actionData.phase = 1;
      goTo(ctx, store.doorX, store.doorY);
      return;
    }
    // разгрузка в хранилище
    for (const g of Object.keys(c.inventory) as Good[]) {
      const n = c.inventory[g] ?? 0;
      if (n > 0 && isGood(g)) {
        addStock(store, g, n);
        sim.market.flow(g, 'носильщики', n, 'transfer');
        c.inventory[g] = 0;
      }
    }
    c.actionData.hauling = 0;
    c.actionData.cart = 0;
    if (BUILDING_DEFS[store.type].enterable) enterBuilding(ctx, store);
    actFor(ctx, 4 * 5);
  },
  finish(ctx) {
    ctx.c.actionData.cart = 0;
    const store = ctx.sim.world.buildings[ctx.c.workplace];
    if (store) payShiftWage(ctx, store);
  },
};

/** Покупка топлива для дома: когда холодно и дома мало дров */
const buyFuel: ActionDef = {
  id: 'buy_fuel',
  interruptible: false,
  score(ctx) {
    const { c, sim, hour, sched } = ctx;
    if (isChild(c) || c.home < 0) return 0;
    const home = sim.world.buildings[c.home];
    const fuel = (home.storage.firewood ?? 0) + (home.storage.peat ?? 0) + (c.inventory.firewood ?? 0);
    const cold = sim.weather.temp < 10 || sim.season === Season.Winter || sim.season === Season.Autumn;
    if (!cold || fuel >= 4) return 0;
    if ((c.actionData.fuelFail ?? 0) > sim.tick) return 0;
    const price = Math.max(1, Math.round(sim.market.prices.firewood));
    if (householdMoney(sim, c) < price * 2) return 0;
    if (!sellersOf(sim, 'firewood', c.x, c.y, hour).length && !sellersOf(sim, 'peat', c.x, c.y, hour).length) return 0;
    let s = fuel < 1 ? 48 : 30;
    if (sim.weather.temp < 0) s += 10;
    if (isWorkHour(sched, hour) && fuel >= 1) s -= 20;
    return s;
  },
  start(ctx) {
    const { c, sim, hour, rng } = ctx;
    let sellers = sellersOf(sim, 'firewood', c.x, c.y, hour);
    c.actionData.good = 0;
    if (!sellers.length) {
      sellers = sellersOf(sim, 'peat', c.x, c.y, hour);
      c.actionData.good = 1;
    }
    const b = sellers[0];
    if (!b) return false;
    think(c, rng.pick(['Дров бы на зиму купить.', 'Печь топить нечем.', 'Схожу за дровами.']));
    return goToBuilding(ctx, b);
  },
  arrive(ctx) {
    const { c, sim, rng } = ctx;
    const b = sim.world.buildings[c.actionData.building];
    if (!b) return actFor(ctx, 10);
    const good: Good = c.actionData.good === 1 ? 'peat' : 'firewood';
    const got = sim.market.buyRetail(sim, c, b, good, 6);
    if (got <= 0) {
      c.actionData.fuelFail = sim.tick + 300;
      if (rng.chance(0.5)) say(c, rng.pick(['Дров нет?!', 'Чем топить-то?']), 35, false, sim.tick, 'sad');
    } else {
      c.inventory[good] = (c.inventory[good] ?? 0) + got;
      c.actionData.hauling = 0;
    }
    if (BUILDING_DEFS[b.type].enterable) enterBuilding(ctx, b);
    actFor(ctx, 3 * 5);
  },
};

ACTIONS[porter.id] = porter;
ACTIONS[buyFuel.id] = buyFuel;
export const LOGISTICS_LABELS: Record<string, string> = { porter: 'носит грузы', buy_fuel: 'покупает дрова' };

// ---------------------------------------------------------------- Порча и крысы

function spoilModifier(b: Building, sim: Simulation): number {
  let m = 1;
  if (b.type === BuildingType.Granary) m = 0.5;
  else if (b.type === BuildingType.Cellar) m = (b.storage.salt ?? 0) >= 1 ? 0.1 : 0.2;
  else if (b.type === BuildingType.Warehouse) m = 0.8;
  else if (BUILDING_DEFS[b.type].home) m = 0.5; // дома едят сначала старое
  if (sim.season === Season.Winter) m *= 0.5;
  return m;
}

/** Ежедневная порча еды во всех зданиях */
export function updateSpoilage(sim: Simulation): void {
  for (const b of sim.world.buildings) {
    if (b.w <= 0) continue;
    const mod = spoilModifier(b, sim);
    for (const g of GOODS) {
      const info = GOOD_INFO[g];
      if (!info.spoil) continue;
      const v = b.storage[g] ?? 0;
      if (v < 0.5) continue;
      const loss = Math.min(v, v * info.spoil * mod);
      if (loss <= 0.01) continue;
      b.storage[g] = v - loss;
      sim.market.flow(g, 'испортилось', -loss, 'spoiled');
    }
    if (b.type === BuildingType.Cellar && (b.storage.salt ?? 0) >= 1 && storedTotal(b) > 5) {
      b.storage.salt -= 0.05;
      sim.market.flow('salt', 'засолка', -0.05);
    }
  }
}

/** Крысы в амбаре: много зерна без присмотра — шанс потерять часть */
export function updateRats(sim: Simulation): void {
  for (const b of sim.world.buildings) {
    if (b.w <= 0 || !(b.type === BuildingType.Granary || b.type === BuildingType.Warehouse || b.type === BuildingType.Mill)) continue;
    const grain = (b.storage.grain ?? 0) + (b.storage.flour ?? 0);
    if (grain < 150) continue;
    const cats = sim.animals.filter((a) => a.alive && a.kind === 1 && Math.abs(a.x - b.doorX) + Math.abs(a.y - b.doorY) < 12).length;
    const p = 0.035 / (1 + cats);
    if (!sim.rng.chance(p)) continue;
    const share = sim.rng.float(0.08, 0.2);
    for (const g of ['grain', 'flour'] as const) {
      const v = b.storage[g] ?? 0;
      const loss = v * share;
      if (loss < 0.5) continue;
      b.storage[g] = v - loss;
      sim.market.flow(g, 'съели крысы', -loss, 'spoiled');
    }
    sim.chronicle.log(sim.tick, EventKind.Economy, `В ${b.type === BuildingType.Granary ? 'амбаре' : b.type === BuildingType.Mill ? 'мельнице' : 'складе'} завелись крысы: часть зерна пропала.`, b.doorX, b.doorY, [], 0.6);
  }
}

// ---------------------------------------------------------------- Отопление

/** Сколько топлива нужно дому в день при такой температуре */
export function fuelNeed(temp: number): number {
  if (temp < -5) return 1.5;
  if (temp < 3) return 1.1;
  if (temp < 10) return 0.7;
  if (temp < 14) return 0.3;
  return 0;
}

/** Запас топлива в днях на всю зиму (для полосы ресурсов) */
export function fuelDays(sim: Simulation): number {
  let fuel = 0;
  let homes = 0;
  for (const b of sim.world.buildings) {
    if (b.w <= 0) continue;
    fuel += (b.storage.firewood ?? 0) + (b.storage.peat ?? 0);
    if (BUILDING_DEFS[b.type].home && b.residents.length) homes++;
  }
  for (const c of sim.citizens) if (c.alive) fuel += c.inventory.firewood ?? 0;
  return fuel / Math.max(1, homes * 1.5);
}

/** Вечером дома жгут дрова; без топлива в холод жильцы болеют, бездомные замерзают */
export function updateHeating(sim: Simulation): void {
  const need = fuelNeed(sim.weather.temp);
  let coldHomes = 0;
  for (const b of sim.world.buildings) {
    if (b.w <= 0 || !BUILDING_DEFS[b.type].home || !b.residents.length) continue;
    if (need <= 0) {
      b.storage._cold = 0;
      continue;
    }
    let left = need;
    for (const g of ['firewood', 'peat'] as const) {
      const v = b.storage[g] ?? 0;
      const use = Math.min(v, left);
      if (use > 0) {
        b.storage[g] = v - use;
        sim.market.flow(g, 'сожжено в печах', -use);
        left -= use;
      }
    }
    if (left > need * 0.5) {
      b.storage._cold = (b.storage._cold ?? 0) + 1;
      coldHomes++;
      for (const id of b.residents) {
        const c = sim.citizens[id];
        if (!c || !c.alive) continue;
        const weak = isChild(c) || c.age >= 60;
        c.needs.health = Math.max(0, c.needs.health - (weak ? 9 : 5));
        c.mood -= 6;
        if (sim.rng.chance(0.15)) c.thought = sim.rng.pick(['В доме холод, печь не топлена.', 'Дров нет. Дети мёрзнут.', 'Хоть бы дров купить.']);
      }
    } else b.storage._cold = 0;
  }
  // бездомные на морозе
  if (sim.weather.temp < 2) {
    for (const c of sim.citizens) {
      if (!c.alive || c.home >= 0 || c.inside >= 0 || c.actionData.visitor) continue;
      c.needs.health = Math.max(0, c.needs.health - (sim.weather.temp < -5 ? 12 : 7));
      c.needs.safety = Math.max(0, c.needs.safety - 10);
    }
  }
  sim.city.coldHomes = coldHomes;
  if (coldHomes >= 5 && sim.rng.chance(0.3)) sim.chronicle.log(sim.tick, EventKind.Disaster, `В ${coldHomes} домах нечем топить — люди мёрзнут.`, sim.world.poi.cx, sim.world.poi.cy, [], 0.7);
}

// ---------------------------------------------------------------- Износ и ремонт

/** Здания ветшают; при сильном износе — ремонт за счёт казны материалами со складов */
export function updateWear(sim: Simulation): void {
  let repaired = 0;
  let worn = 0;
  for (const b of sim.world.buildings) {
    if (b.w <= 0 || b.condition <= 0 || b.underConstruction !== undefined) continue;
    if (b.type === BuildingType.Well || b.type === BuildingType.Pillory || b.type === BuildingType.MarketStall) continue;
    const rate = b.material === 'wood' ? 0.004 : b.material === 'timber' ? 0.003 : 0.0015;
    b.condition = Math.max(0.15, b.condition - rate * (b.roof === 'thatch' ? 1.3 : 1));
    if (b.condition < 0.5) {
      worn++;
      if (repaired < 3 && sim.treasury >= 10) {
        const needStone = b.material === 'stone' || b.material === 'brick';
        const ok = takeFromStores(sim, 'planks', needStone ? 1 : 2) && (!needStone || takeFromStores(sim, 'stone', 1));
        if (ok) {
          b.condition = Math.min(1, b.condition + 0.4);
          sim.treasury -= 10;
          sim.moneyDestroyed += 10;
          repaired++;
          sim.buildingVersion++;
        }
      }
    }
  }
  sim.city.wornBuildings = worn;
}

/** Взять материал со складов для ремонта (оплата владельцу из казны) */
function takeFromStores(sim: Simulation, good: Good, n: number): boolean {
  const price = Math.max(1, Math.round(sim.market.prices[good] * n));
  if (sim.treasury < price) return false;
  const src = sim.world.buildings.find((b) => b.w > 0 && (b.storage[good] ?? 0) >= n && b.underConstruction === undefined && (b.type === BuildingType.Warehouse || b.type === BuildingType.Sawmill || b.type === BuildingType.Quarry || b.type === BuildingType.Mason || b.type === BuildingType.Carpenter));
  if (!src) return false;
  src.storage[good] -= n;
  sim.treasury -= price;
  const owner = src.owner >= 0 ? sim.citizens[src.owner] : null;
  if (owner && owner.alive) owner.money += price;
  else sim.treasury += price;
  sim.market.flow(good, 'ремонт', -n);
  return true;
}

/** Дневные обновления логистики и быта (вызывается из Economy) */
export function updateLogisticsDaily(sim: Simulation, hourTick: number): void {
  if (hourTick === TICKS_PER_HOUR * 3) {
    updateSpoilage(sim);
    updateRats(sim);
    updateWear(sim);
  }
  if (hourTick === TICKS_PER_HOUR * 20) updateHeating(sim);
}

export type { Citizen };
export { TICKS_PER_DAY };
