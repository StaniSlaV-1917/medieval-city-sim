// Экономика: рынок и цены, внешняя торговля, караваны, учёт созданных/уничтоженных денег.
import type { Simulation } from '../game';
import { Market } from '../../economy/market';
import { collectTaxes } from '../../economy/taxes';
import { dailyTrade } from '../../economy/trade';
import type { Good } from '../../economy/goods';
import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../../core/time';

export interface Caravan {
  members: number[];
  phase: number;
  goods: Partial<Record<Good, number>>;
  until: number;
  dest: { x: number; y: number };
}

export class Economy {
  market = new Market();
  /** Деньги, созданные системой (внешняя торговля, караваны, бог) и уничтоженные */
  moneyCreated = 0;
  moneyDestroyed = 0;
  exportIncome = 0;
  importCost = 0;
  caravan: Caravan | null = null;
  nextCaravanDay = 2;

  /** Почасовые и дневные обновления рынка, сбор податей и внешняя торговля */
  update(sim: Simulation): void {
    const t = sim.tick;
    if (t % TICKS_PER_HOUR === 0) this.market.update(sim);
    if (t % TICKS_PER_DAY === 0) this.market.newDay(sim);
    if (t % TICKS_PER_DAY === 6 * TICKS_PER_HOUR) collectTaxes(sim);
    if (t % TICKS_PER_DAY === 20 * TICKS_PER_HOUR) dailyTrade(sim);
  }
}
