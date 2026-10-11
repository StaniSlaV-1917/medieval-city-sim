// Состояние города: казна, подать, недовольство, стража, избранные, дневная история, голод.
import type { Simulation } from '../game';
import type { Stats } from '../stats';
import { collectStats } from '../stats';
import { EventKind } from '../../events/chronicle';
import { TICKS_PER_DAY } from '../../core/time';

export interface DayRecord {
  day: number;
  population: number;
  treasury: number;
  bread: number;
  avgHunger: number;
  avgMood: number;
  money: number;
  crimes: number;
  health: number;
  unrest: number;
}

export class CityState {
  treasury = 0;
  taxRate = 0.1;
  lastTax = 0;
  lastCharity = 0;
  unrest = 10;
  guardTarget = -1;
  /** Избранные жители (★ в карточке и Обзоре) */
  favorites: number[] = [];
  /** Дневные снимки для графиков */
  history: DayRecord[] = [];
  heraldNews: string[] = [];
  deaths = 0;
  sickCount = 0;
  /** Голод объявлен (событие, а не фон) */
  famine = false;
  /** Домов без топлива вчера вечером и изношенных зданий (фаза 15) */
  coldHomes = 0;
  wornBuildings = 0;
  stats!: Stats;

  /** Конец дня: статистика, история, проверка голода */
  endOfDay(sim: Simulation): void {
    this.stats = collectStats(sim);
    this.checkFamine(sim);
    const dayStart = sim.tick - TICKS_PER_DAY;
    const crimes = sim.justice.crimeLog.filter((r) => r.tick >= dayStart).length;
    this.history.push({ day: Math.floor(sim.tick / TICKS_PER_DAY), population: this.stats.population, treasury: Math.round(this.treasury), bread: sim.economy.market.prices.bread, avgHunger: this.stats.avgHunger, avgMood: this.stats.avgMood, money: Math.round(sim.totalMoney()), crimes, health: this.stats.avgHealth, unrest: this.unrest });
    if (this.history.length > 400) this.history.shift();
  }

  /** Голод объявляется, когда город действительно недоедает, и снимается, когда отступил */
  private checkFamine(sim: Simulation): void {
    const st = this.stats;
    const m = sim.economy.market;
    const food = m.stock.bread + m.stock.flour * 3 + m.stock.grain * 3;
    const days = food / Math.max(1, st.population * 1.4);
    const bad = st.avgHunger < 45 || (days < 0.7 && st.avgHunger < 55);
    const poi = sim.world.poi;
    if (bad && !this.famine) {
      this.famine = true;
      sim.chronicle.log(sim.tick, EventKind.Disaster, 'В городе голод: хлеба на рынке почти нет, люди недоедают.', poi.cx, poi.cy, [], 0.9);
      sim.events.emit('famine', { active: true, avgHunger: st.avgHunger });
    } else if (!bad && this.famine && st.avgHunger >= 55) {
      this.famine = false;
      sim.chronicle.log(sim.tick, EventKind.Info, 'Голод отступил: в лавках снова есть хлеб.', poi.cx, poi.cy, [], 0.6);
      sim.events.emit('famine', { active: false, avgHunger: st.avgHunger });
    }
  }
}
