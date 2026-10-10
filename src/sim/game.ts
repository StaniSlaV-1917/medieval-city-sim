// Ядро симуляции: мир, жители, время. Не зависит от DOM.
import { RNG } from '../core/rng';
import { World } from '../world/world';
import { generateWorld, CitySize } from '../world/generator';
import { Pathfinder } from '../world/pathfinding';
import { SpatialHash } from '../world/spatial';
import { Citizen } from './citizen';
import { Chronicle, EventKind } from '../events/chronicle';
import { TICKS_PER_HOUR, TICKS_PER_DAY, getTime, seasonOf, Season } from '../core/time';
import { collectTaxes } from '../economy/taxes';
import { createPopulation } from './population';
import { stepCitizens } from './systems';
import { Stats, collectStats } from './stats';
import type { Talk } from '../ai/conversation';

export interface SimOptions {
  seedText: string;
  size: CitySize;
  /** Стартовое время (тик) */
  startHour?: number;
}

export class Simulation {
  world: World;
  citizens: Citizen[] = [];
  tick = 0;
  rng: RNG;
  pathfinder: Pathfinder;
  spatial: SpatialHash;
  chronicle = new Chronicle();
  seedText: string;
  size: CitySize;
  /** Казна */
  treasury = 0;
  taxRate = 0.1;
  lastTax = 0;
  lastCharity = 0;
  stats: Stats;
  /** Текущие разговоры (ключ — id первого собеседника) */
  talks = new Map<number, Talk>();
  /** Камера (центр в тайлах) — для LOD */
  focusX = 0;
  focusY = 0;
  /** Сезон для отслеживания смены */
  private lastSeason: Season;
  /** Погода (расширяется в фазе 6) */
  weather = { rain: 0, fog: 0, snow: 0, wind: 0.3, temp: 15 };
  /** Счётчики для инвариантов */
  moneyCreated = 0; // деньги, созданные системой (внешняя торговля, караваны, бог)
  moneyDestroyed = 0;
  exportIncome = 0; // выручка от продажи сырья за город
  importCost = 0; // расходы лавок на закупку сырья за городом

  constructor(opts: SimOptions) {
    this.seedText = opts.seedText;
    this.size = opts.size;
    this.world = generateWorld(opts.seedText, opts.size);
    this.rng = new RNG(this.world.seed ^ 0x9e3779b9);
    this.pathfinder = new Pathfinder(this.world);
    this.spatial = new SpatialHash(this.world.w, this.world.h, 4);
    this.tick = Math.round((opts.startHour ?? 7) * TICKS_PER_HOUR);
    this.lastSeason = seasonOf(this.tick);
    this.focusX = this.world.poi.cx;
    this.focusY = this.world.poi.cy;
    createPopulation(this);
    this.stats = collectStats(this);
    this.chronicle.log(this.tick, EventKind.Info, `Город Вальдмарк основан. Население — ${this.citizens.length} человек.`, this.world.poi.cx, this.world.poi.cy, [], 1);
  }

  get time() {
    return getTime(this.tick);
  }

  get season(): Season {
    return seasonOf(this.tick);
  }

  /** Один тик симуляции */
  step(): void {
    this.tick++;
    const season = seasonOf(this.tick);
    if (season !== this.lastSeason) {
      this.lastSeason = season;
      this.onSeasonChange(season);
    }
    // Пространственный хеш
    this.spatial.clear();
    for (const c of this.citizens) {
      if (!c.alive || c.inside >= 0) continue;
      this.spatial.insert(c.id, c.x, c.y);
    }
    stepCitizens(this);
    if (this.tick % TICKS_PER_DAY === 6 * TICKS_PER_HOUR) collectTaxes(this);
    if (this.tick % 600 === 0) this.stats = collectStats(this);
  }

  private onSeasonChange(season: Season): void {
    const names = ['Пришла весна. Поля зеленеют.', 'Наступило лето. Дни стали длинными.', 'Пришла осень. Время жатвы.', 'Настала зима. Реку сковывает лёд.'];
    this.chronicle.log(this.tick, EventKind.Info, names[season], this.world.poi.cx, this.world.poi.cy, [], 0.5);
  }

  citizen(id: number): Citizen | null {
    const c = this.citizens[id];
    return c && c.alive ? c : null;
  }

  /** Общая сумма денег в экономике (жители + здания + казна) */
  totalMoney(): number {
    let sum = this.treasury;
    for (const c of this.citizens) if (c.alive) sum += c.money;
    for (const b of this.world.buildings) sum += b.storage['money'] ?? 0;
    return sum;
  }
}
