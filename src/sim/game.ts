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
import { Market } from '../economy/market';
import type { Alarm, CrimeRecord } from './crime';
import type { ActionCtx } from '../ai/actions';
import type { Order } from './citizen';
import { dailyTrade } from '../economy/trade';
import { Weather, createWeather, updateWeather } from './weather';
import { Fire, igniteBuilding, updateFires } from './fire';
import { updateHealth, updateFunerals } from './health';
import { Building, BUILDING_DEFS } from '../world/buildings';
import { Animal, createAnimals, updateAnimals } from './animals';
import { Festival, updateCityEvents } from './cityEvents';
import type { Good } from '../economy/goods';

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
  market = new Market();
  alarms: Alarm[] = [];
  crimeLog: CrimeRecord[] = [];
  fights: { a: number; b: number; until: number }[] = [];
  /** Поджог по приказу (устанавливается в фазе 6) */
  arsonOrderStart: ((ctx: ActionCtx, o: Order) => boolean) | null = null;
  /** Принудительный исход ближайшего разговора по приказу: 1 — дружба, 2 — ссора, 3 — флирт */
  forcedTalk: { a: number; mode: number } | null = null;
  /** Ожидающая свадьба (для церемонии) */
  pendingWedding: { a: number; b: number; tick: number } | null = null;
  /** Дневные снимки для графиков */
  history: { day: number; population: number; treasury: number; bread: number; avgHunger: number; avgMood: number; money: number }[] = [];
  /** Камера (центр в тайлах) — для LOD */
  focusX = 0;
  focusY = 0;
  /** Сезон для отслеживания смены */
  private lastSeason: Season;
  weather: Weather = createWeather();
  fires: Fire[] = [];
  funerals: { dead: number; tick: number; mourners: number[]; phase: number }[] = [];
  deaths = 0;
  sickCount = 0;
  /** Множители бедствий (божественные силы) */
  fireRiskMul = 1;
  epidemicMul = 1;
  lightningFlash = 0;
  animals: Animal[] = [];
  festival: Festival | null = null;
  unrest = 10;
  protest: { until: number; riot: boolean; members: number[]; x: number; y: number; responded?: boolean } | null = null;
  caravan: { members: number[]; phase: number; goods: Partial<Record<Good, number>>; until: number; dest: { x: number; y: number } } | null = null;
  raid: { members: number[]; phase: number; gate: { x: number; y: number }; until: number; loot: number } | null = null;
  nextCaravanDay = 2;
  nextRaidDay = 6;
  heraldNews: string[] = [];
  timers: { at: number; fn: () => void }[] = [];
  igniteBuilding: ((id: number, cause: string, intensity?: number) => boolean) | null = null;
  onBuildingDestroyed: ((b: Building, cause: string) => void) | null = null;
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
    this.market.update(this);
    this.igniteBuilding = (id, cause, intensity) => igniteBuilding(this, id, cause, intensity);
    createAnimals(this);
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
    updateWeather(this);
    updateFires(this);
    updateHealth(this);
    updateFunerals(this);
    updateCityEvents(this);
    updateAnimals(this);
    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= this.tick);
      if (due.length) {
        this.timers = this.timers.filter((t) => t.at > this.tick);
        for (const t of due) t.fn();
      }
    }
    if (this.tick % TICKS_PER_HOUR === 0) this.market.update(this);
    if (this.tick % TICKS_PER_DAY === 0) {
      this.market.newDay(this);
      this.stats = collectStats(this);
      this.history.push({ day: Math.floor(this.tick / TICKS_PER_DAY), population: this.stats.population, treasury: Math.round(this.treasury), bread: this.market.prices.bread, avgHunger: this.stats.avgHunger, avgMood: this.stats.avgMood, money: Math.round(this.totalMoney()) });
      if (this.history.length > 400) this.history.shift();
    }
    if (this.tick % TICKS_PER_DAY === 6 * TICKS_PER_HOUR) collectTaxes(this);
    if (this.tick % TICKS_PER_DAY === 20 * TICKS_PER_HOUR) dailyTrade(this);
    if (this.tick % 600 === 0) this.stats = collectStats(this);
  }

  private onSeasonChange(season: Season): void {
    const names = ['Пришла весна. Поля зеленеют.', 'Наступило лето. Дни стали длинными.', 'Пришла осень. Время жатвы.', 'Настала зима. Реку сковывает лёд.'];
    this.chronicle.log(this.tick, EventKind.Info, names[season], this.world.poi.cx, this.world.poi.cy, [], 0.5);
  }

  buildingDefName(b: Building): string {
    return BUILDING_DEFS[b.type].name;
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
