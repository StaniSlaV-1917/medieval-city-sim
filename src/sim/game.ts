// Ядро симуляции: мир, жители, время. Не зависит от DOM.
import { RNG } from '../core/rng';
import { World } from '../world/world';
import { generateWorld, CitySize } from '../world/generator';
import { Pathfinder } from '../world/pathfinding';
import { SpatialHash } from '../world/spatial';
import { Citizen } from './citizen';
import { Chronicle, EventKind } from '../events/chronicle';
import { TICKS_PER_HOUR, TICKS_PER_DAY, getTime, seasonOf, Season } from '../core/time';
import { createPopulation } from './population';
import { stepCitizens } from './systems';
import { Stats, collectStats } from './stats';
import type { Talk } from '../ai/conversation';
import type { Market } from '../economy/market';
import type { Alarm, CrimeRecord } from './crime';
import type { Weather } from './weather';
import { Fire, igniteBuilding, updateFires } from './fire';
import { updateHealth, updateFunerals } from './health';
import { Building, BUILDING_DEFS } from '../world/buildings';
import { Animal, createAnimals } from './animals';
import { Festival, updateCityEvents } from './cityEvents';
import { CityState, DayRecord } from './sub/cityState';
import { Economy, Caravan } from './sub/economy';
import { ConstructionSystem } from './sub/constructionSystem';
import { Justice, Protest } from './sub/justice';
import { Region, Raid } from './sub/region';
import { scheduleOf, DaySchedule } from './schedule';
import { professionName } from './citizen';
import { updateGod } from './god';
import { EventBus, SimEvents } from '../core/events';

export interface SimOptions {
  seedText: string;
  size: CitySize;
  /** Стартовое время (тик) */
  startHour?: number;
  /** Не создавать население (для загрузки сохранения) */
  skipPopulation?: boolean;
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
  /** Шина событий (интерфейс, статистика, будущие системы) */
  events = new EventBus<SimEvents>();
  // ---- Подсистемы (фаза 12). Старые имена полей ниже — делегирующие аксессоры для совместимости.
  city = new CityState();
  economy = new Economy();
  construction = new ConstructionSystem();
  justice = new Justice();
  region = new Region();
  /** Текущие разговоры (ключ — id первого собеседника) */
  talks = new Map<number, Talk>();
  /** Принудительный исход ближайшего разговора по приказу: 1 — дружба, 2 — ссора, 3 — флирт */
  forcedTalk: { a: number; mode: number } | null = null;
  /** Ожидающая свадьба (для церемонии) */
  pendingWedding: { a: number; b: number; tick: number } | null = null;
  /** Камера (центр в тайлах) — для LOD */
  focusX = 0;
  focusY = 0;
  /** Сезон для отслеживания смены */
  private lastSeason: Season;
  fires: Fire[] = [];
  funerals: { dead: number; tick: number; mourners: number[]; phase: number }[] = [];
  festival: Festival | null = null;
  timers: { at: number; fn: () => void }[] = [];
  igniteBuilding: ((id: number, cause: string, intensity?: number) => boolean) | null = null;
  onBuildingDestroyed: ((b: Building, cause: string) => void) | null = null;

  // ---- Город
  get treasury(): number { return this.city.treasury; }
  set treasury(v: number) { this.city.treasury = v; }
  get taxRate(): number { return this.city.taxRate; }
  set taxRate(v: number) { this.city.taxRate = v; }
  get lastTax(): number { return this.city.lastTax; }
  set lastTax(v: number) { this.city.lastTax = v; }
  get lastCharity(): number { return this.city.lastCharity; }
  set lastCharity(v: number) { this.city.lastCharity = v; }
  get unrest(): number { return this.city.unrest; }
  set unrest(v: number) { this.city.unrest = v; }
  get guardTarget(): number { return this.city.guardTarget; }
  set guardTarget(v: number) { this.city.guardTarget = v; }
  get favorites(): number[] { return this.city.favorites; }
  set favorites(v: number[]) { this.city.favorites = v; }
  get history(): DayRecord[] { return this.city.history; }
  set history(v: DayRecord[]) { this.city.history = v; }
  get heraldNews(): string[] { return this.city.heraldNews; }
  set heraldNews(v: string[]) { this.city.heraldNews = v; }
  get deaths(): number { return this.city.deaths; }
  set deaths(v: number) { this.city.deaths = v; }
  get sickCount(): number { return this.city.sickCount; }
  set sickCount(v: number) { this.city.sickCount = v; }
  get famine(): boolean { return this.city.famine; }
  set famine(v: boolean) { this.city.famine = v; }
  get stats(): Stats { return this.city.stats; }
  set stats(v: Stats) { this.city.stats = v; }
  // ---- Экономика
  get market(): Market { return this.economy.market; }
  get moneyCreated(): number { return this.economy.moneyCreated; }
  set moneyCreated(v: number) { this.economy.moneyCreated = v; }
  get moneyDestroyed(): number { return this.economy.moneyDestroyed; }
  set moneyDestroyed(v: number) { this.economy.moneyDestroyed = v; }
  get exportIncome(): number { return this.economy.exportIncome; }
  set exportIncome(v: number) { this.economy.exportIncome = v; }
  get importCost(): number { return this.economy.importCost; }
  set importCost(v: number) { this.economy.importCost = v; }
  get caravan(): Caravan | null { return this.economy.caravan; }
  set caravan(v: Caravan | null) { this.economy.caravan = v; }
  get nextCaravanDay(): number { return this.economy.nextCaravanDay; }
  set nextCaravanDay(v: number) { this.economy.nextCaravanDay = v; }
  // ---- Строительство
  get buildingVersion(): number { return this.construction.buildingVersion; }
  set buildingVersion(v: number) { this.construction.buildingVersion = v; }
  get tileVersion(): number { return this.construction.tileVersion; }
  set tileVersion(v: number) { this.construction.tileVersion = v; }
  // ---- Правопорядок
  get alarms(): Alarm[] { return this.justice.alarms; }
  set alarms(v: Alarm[]) { this.justice.alarms = v; }
  get crimeLog(): CrimeRecord[] { return this.justice.crimeLog; }
  set crimeLog(v: CrimeRecord[]) { this.justice.crimeLog = v; }
  get fights(): { a: number; b: number; until: number }[] { return this.justice.fights; }
  set fights(v: { a: number; b: number; until: number }[]) { this.justice.fights = v; }
  get protest(): Protest | null { return this.justice.protest; }
  set protest(v: Protest | null) { this.justice.protest = v; }
  // ---- Регион
  get weather(): Weather { return this.region.weather; }
  set weather(v: Weather) { this.region.weather = v; }
  get animals(): Animal[] { return this.region.animals; }
  set animals(v: Animal[]) { this.region.animals = v; }
  get raid(): Raid | null { return this.region.raid; }
  set raid(v: Raid | null) { this.region.raid = v; }
  get nextRaidDay(): number { return this.region.nextRaidDay; }
  set nextRaidDay(v: number) { this.region.nextRaidDay = v; }
  get flood(): { tiles: number[]; until: number } | null { return this.region.flood; }
  set flood(v: { tiles: number[]; until: number } | null) { this.region.flood = v; }
  get dragon(): { x: number; y: number; dir: number; until: number; nextFire: number } | null { return this.region.dragon; }
  set dragon(v: { x: number; y: number; dir: number; until: number; nextFire: number } | null) { this.region.dragon = v; }
  get fireRiskMul(): number { return this.region.fireRiskMul; }
  set fireRiskMul(v: number) { this.region.fireRiskMul = v; }
  get epidemicMul(): number { return this.region.epidemicMul; }
  set epidemicMul(v: number) { this.region.epidemicMul = v; }
  get lightningFlash(): number { return this.region.lightningFlash; }
  set lightningFlash(v: number) { this.region.lightningFlash = v; }
  get shake(): number { return this.region.shake; }
  set shake(v: number) { this.region.shake = v; }

  constructor(opts: SimOptions) {
    this.chronicle.listeners.push((e) => this.events.emit('chronicle', e));
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
    this.igniteBuilding = (id, cause, intensity) => igniteBuilding(this, id, cause, intensity);
    this.onBuildingDestroyed = (b, cause) => this.construction.destroyed(this, b, cause);
    if (!opts.skipPopulation) {
      createPopulation(this);
      createAnimals(this);
      this.stats = collectStats(this);
      this.market.update(this);
      this.chronicle.log(this.tick, EventKind.Info, `Город Вальдмарк основан. Население — ${this.citizens.length} человек.`, this.world.poi.cx, this.world.poi.cy, [], 1);
    } else this.stats = collectStats(this);
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
      this.events.emit('season', { season });
    }
    // Пространственный хеш
    this.spatial.clear();
    for (const c of this.citizens) {
      if (!c.alive || c.inside >= 0) continue;
      this.spatial.insert(c.id, c.x, c.y);
    }
    stepCitizens(this);
    this.region.updateWeather(this);
    updateFires(this);
    updateHealth(this);
    updateFunerals(this);
    updateCityEvents(this);
    this.region.updateAnimals(this);
    this.construction.update(this);
    updateGod(this);
    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= this.tick);
      if (due.length) {
        this.timers = this.timers.filter((t) => t.at > this.tick);
        for (const t of due) t.fn();
      }
    }
    if (this.tick % TICKS_PER_DAY === 0) this.events.emit('day', { day: Math.floor(this.tick / TICKS_PER_DAY) });
    this.economy.update(this);
    if (this.tick % TICKS_PER_DAY === 0) this.city.endOfDay(this);
    if (this.tick % 600 === 0) this.stats = collectStats(this);
  }

  private onSeasonChange(season: Season): void {
    const names = ['Пришла весна. Поля зеленеют.', 'Наступило лето. Дни стали длинными.', 'Пришла осень. Время жатвы.', 'Настала зима. Реку сковывает лёд.'];
    this.chronicle.log(this.tick, EventKind.Info, names[season], this.world.poi.cx, this.world.poi.cy, [], 0.5);
  }

  computeStats(): Stats {
    return collectStats(this);
  }

  buildingDefName(b: Building): string {
    return BUILDING_DEFS[b.type].name;
  }

  scheduleOf(c: Citizen): DaySchedule {
    return scheduleOf(this, c);
  }

  professionName(c: Citizen): string {
    return professionName(c);
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
