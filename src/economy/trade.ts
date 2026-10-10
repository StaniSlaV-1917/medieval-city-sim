// Внешняя торговля через склад: вывоз излишков и ввоз зерна при нехватке (до караванов фазы 7).
import type { Simulation } from '../sim/game';
import { BuildingType } from '../world/buildings';
import { Good, GOOD_INFO } from './goods';
import { EventKind } from '../events/chronicle';

const EXPORTABLE: Good[] = ['goods', 'leather', 'planks', 'stone', 'tools', 'flour', 'grain'];
const RESERVE: Partial<Record<Good, number>> = { goods: 5, leather: 6, planks: 25, stone: 25, tools: 6, flour: 40, grain: 60 };

export function dailyTrade(sim: Simulation): void {
  const wh = sim.world.buildings.find((b) => b.type === BuildingType.Warehouse);
  if (!wh) return;
  const owner = wh.owner >= 0 ? sim.citizens[wh.owner] : null;
  let income = 0;
  for (const g of EXPORTABLE) {
    const have = Math.floor(wh.storage[g] ?? 0);
    const surplus = have - (RESERVE[g] ?? 0);
    if (surplus <= 0) continue;
    const price = sim.market.prices[g] * 0.8;
    const sum = Math.round(surplus * price);
    wh.storage[g] = have - surplus;
    income += sum;
  }
  if (income > 0) {
    if (owner && owner.alive) owner.money += income;
    else sim.treasury += income;
    sim.moneyCreated += income;
    sim.exportIncome += income;
    // пошлина
    const duty = Math.round(income * 0.15);
    if (owner && owner.alive && owner.money >= duty) {
      owner.money -= duty;
      sim.treasury += duty;
    }
  }
  // Ввоз зерна при нехватке хлеба
  const m = sim.market;
  let grainChain = 0;
  for (const b of sim.world.buildings) if (b.type === BuildingType.Farm || b.type === BuildingType.Mill || b.type === BuildingType.Warehouse) grainChain += b.storage['grain'] ?? 0;
  const foodDays = (m.stock.bread + m.stock.flour * 3 + grainChain * 3) / Math.max(1, m.demand.bread);
  if (foodDays < 1.2 && owner && owner.alive) {
    const q = Math.ceil(m.demand.grain * 1.5);
    const cost = Math.round(q * m.prices.grain * 1.3);
    if (owner.money >= cost) {
      owner.money -= cost;
      sim.moneyDestroyed += cost;
      sim.importCost += cost;
      wh.storage['grain'] = (wh.storage['grain'] ?? 0) + q;
      sim.chronicle.log(sim.tick, EventKind.Economy, `Купец ${owner.firstName} ${owner.lastName} завёз ${q} мер зерна из-за реки: в городе не хватает хлеба.`, wh.doorX, wh.doorY, [owner.id], 0.5);
    }
  }
  void GOOD_INFO;
}
