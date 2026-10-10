// Рынок: динамические цены по спросу и предложению, учёт запасов по городу.
import type { Simulation } from '../sim/game';
import { Good, GOODS, GOOD_INFO } from './goods';
import { RECIPES, harvestFactor } from './production';
import { Building, BuildingType } from '../world/buildings';
import { Citizen } from '../sim/citizen';
import { clamp } from '../core/math';
import { EventKind } from '../events/chronicle';
import { pay, householdPay } from './money';

const NORMAL_DAYS: Record<Good, number> = { grain: 8, flour: 3, bread: 1.5, meat: 2, hide: 4, leather: 5, wood: 4, planks: 5, stone: 6, ale: 2, tools: 6, goods: 6 };

export class Market {
  prices: Record<Good, number>;
  /** Запасы по городу (обновляются раз в час) */
  stock: Record<Good, number>;
  /** Дневная потребность (оценка) */
  demand: Record<Good, number>;
  /** Продажи за последний день (для спроса) */
  soldToday: Record<Good, number>;
  soldYesterday: Record<Good, number>;
  /** Фактор урожая года (неурожай < 0.7) */
  yearFactor = 1;
  private lastBreadWarn = -1;

  constructor() {
    const z = () => Object.fromEntries(GOODS.map((g) => [g, 0])) as Record<Good, number>;
    this.prices = Object.fromEntries(GOODS.map((g) => [g, GOOD_INFO[g].base])) as Record<Good, number>;
    this.stock = z();
    this.demand = z();
    this.soldToday = z();
    this.soldYesterday = z();
  }

  price(good: Good): number {
    return this.prices[good];
  }

  /** Цена продажи горожанину в конкретном здании */
  retailPrice(b: Building, good: Good): number {
    const r = RECIPES[b.type];
    return Math.max(1, Math.round(this.prices[good] * (r ? r.markup : 1)));
  }

  /** Пересчёт запасов и цен — раз в час */
  update(sim: Simulation): void {
    const stock = this.stock;
    for (const g of GOODS) stock[g] = 0;
    for (const b of sim.world.buildings) {
      for (const g of GOODS) {
        const v = b.storage[g];
        if (v) stock[g] += v;
      }
    }
    // Оценка дневной потребности
    const pop = sim.stats.population || sim.citizens.length;
    this.demand.bread = pop * 1.4;
    this.demand.meat = pop * 0.12;
    this.demand.flour = this.demand.bread / 3;
    this.demand.grain = this.demand.flour + 20;
    this.demand.ale = pop * 0.3;
    this.demand.hide = 8;
    this.demand.leather = 8;
    this.demand.wood = 25;
    this.demand.planks = 20;
    this.demand.stone = 20;
    this.demand.tools = 6;
    this.demand.goods = 10;
    for (const g of GOODS) {
      const base = GOOD_INFO[g].base;
      const need = Math.max(1, this.demand[g]);
      const have = Math.max(0.5, stock[g]);
      // отношение «запас к нормальному запасу» (зерно хранят неделями, хлеб — день)
      const ratio = have / (need * NORMAL_DAYS[g]);
      let factor = clamp(Math.pow(1 / Math.max(0.05, ratio), 0.45), 0.7, 3.5);
      // зима: еда дороже
      if (sim.season === 3 && (g === 'bread' || g === 'flour' || g === 'grain' || g === 'meat')) factor *= 1.15;
      const target = base * factor;
      this.prices[g] = this.prices[g] + (target - this.prices[g]) * 0.15;
    }
    // Предупреждение о дорогом хлебе
    const day = Math.floor(sim.tick / 7200);
    if (this.prices.bread > GOOD_INFO.bread.base * 2 && this.lastBreadWarn !== day) {
      this.lastBreadWarn = day;
      sim.chronicle.log(sim.tick, EventKind.Economy, `Хлеб подорожал до ${this.prices.bread.toFixed(1)} монет — на рынке ропот.`, sim.world.poi.cx, sim.world.poi.cy, [], 0.6);
    }
  }

  newDay(sim: Simulation): void {
    this.soldYesterday = { ...this.soldToday };
    for (const g of GOODS) this.soldToday[g] = 0;
    // фактор урожая на год определяется в начале весны
    const t = sim.time;
    if (t.season === 0 && t.dayOfSeason === 1) {
      this.yearFactor = 0.7 + sim.rng.next() * 0.6;
      if (this.yearFactor < 0.8) sim.chronicle.log(sim.tick, EventKind.Economy, 'Крестьяне жалуются: всходы слабые, год будет неурожайным.', sim.world.poi.cx, sim.world.poi.cy, [], 0.7);
      else if (this.yearFactor > 1.2) sim.chronicle.log(sim.tick, EventKind.Economy, 'Поля зеленеют дружно — быть богатому урожаю.', sim.world.poi.cx, sim.world.poi.cy, [], 0.5);
    }
  }

  harvest(sim: Simulation): number {
    return harvestFactor(sim.season, this.yearFactor);
  }

  /**
   * Покупка горожанином n единиц товара в здании. Деньги — владельцу здания (или в казну).
   * Возвращает фактически купленное количество.
   */
  buyRetail(sim: Simulation, buyer: Citizen, b: Building, good: Good, n: number, useHousehold = true): number {
    const have = Math.floor(b.storage[good] ?? 0);
    if (have <= 0) return 0;
    const price = this.retailPrice(b, good);
    const canAfford = Math.floor((useHousehold ? householdMoneyOf(sim, buyer) : buyer.money) / price);
    const q = Math.min(n, have, canAfford);
    if (q <= 0) return 0;
    const cost = q * price;
    const owner = b.owner >= 0 ? sim.citizens[b.owner] : null;
    const to = owner && owner.alive && owner.id !== buyer.id ? owner : null;
    if (useHousehold) householdPay(sim, buyer, to, cost);
    else if (to) pay(sim, buyer, to, cost);
    else {
      buyer.money -= cost;
      sim.treasury += cost;
    }
    b.storage[good] = (b.storage[good] ?? 0) - q;
    this.soldToday[good] += q;
    b.storage['revenue'] = (b.storage['revenue'] ?? 0) + cost;
    return q;
  }

  /** Оптовая сделка между зданиями: покупатель (владелец здания buyerB) платит владельцу sellerB */
  buyWholesale(sim: Simulation, buyerB: Building, sellerB: Building, good: Good, n: number): number {
    const have = Math.floor(sellerB.storage[good] ?? 0);
    const buyer = buyerB.owner >= 0 ? sim.citizens[buyerB.owner] : null;
    const seller = sellerB.owner >= 0 ? sim.citizens[sellerB.owner] : null;
    if (have <= 0 || !buyer || !buyer.alive) return 0;
    const price = Math.max(1, Math.round(this.prices[good] * 10) / 10);
    const q = Math.min(n, have, Math.floor(buyer.money / price));
    if (q <= 0) return 0;
    const cost = Math.round(q * price);
    buyer.money -= cost;
    if (seller && seller.alive && seller.id !== buyer.id) seller.money += cost;
    else if (seller && seller.id === buyer.id) buyer.money += cost;
    else sim.treasury += cost;
    sellerB.storage[good] = (sellerB.storage[good] ?? 0) - q;
    sellerB.storage['revenue'] = (sellerB.storage['revenue'] ?? 0) + cost;
    return q;
  }
}

function householdMoneyOf(sim: Simulation, c: Citizen): number {
  let sum = c.money;
  if (c.home < 0) return sum;
  const home = sim.world.buildings[c.home];
  for (const id of home.residents) {
    if (id === c.id) continue;
    const o = sim.citizens[id];
    if (!o || !o.alive) continue;
    if (c.spouse === o.id || c.children.includes(o.id) || c.parents.includes(o.id) || o.children.includes(c.id) || o.parents.includes(c.id)) sum += o.money;
  }
  return sum;
}

/** Здания, продающие товар горожанам (с запасом), отсортированные по близости */
export function sellersOf(sim: Simulation, good: Good, x: number, y: number, hour: number, openOnly = true): Building[] {
  const out: { b: Building; d: number }[] = [];
  for (const b of sim.world.buildings) {
    const r = RECIPES[b.type];
    if (!r || !r.sells.includes(good)) continue;
    if ((b.storage[good] ?? 0) <= 0) continue;
    if (openOnly && !isOpenAt(b, hour)) continue;
    const dx = b.doorX - x;
    const dy = b.doorY - y;
    out.push({ b, d: dx * dx + dy * dy });
  }
  out.sort((a, b) => a.d - b.d);
  return out.map((o) => o.b);
}

import { BUILDING_DEFS } from '../world/buildings';
export function isOpenAt(b: Building, hour: number): boolean {
  const [a, z] = BUILDING_DEFS[b.type].hours;
  if (b.type === BuildingType.Warehouse) return hour >= 6 && hour < 20;
  if (hour >= a && hour < z) return true;
  if (z > 24 && hour + 24 < z) return true;
  return false;
}
