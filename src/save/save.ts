// Сохранение и загрузка: сериализация всей симуляции в JSON, IndexedDB-автосейв, экспорт/импорт файла.
import { Simulation } from '../sim/game';
import type { Citizen } from '../sim/citizen';
import type { World } from '../world/world';
import { regenerateNature } from '../world/landscape';

export const SAVE_VERSION = 3;

/**
 * Цепочка миграций: migrate_N_to_N+1 приводит сохранение версии N к версии N+1.
 * Каждая миграция меняет только то, что добавилось в её версии; deserialize применяет их по порядку.
 */
export const MIGRATIONS: Record<number, (d: Plain) => void> = {
  // 1 → 2 (фаза 10–12): избранные, дневной снимок рынка и потоки, история реплик в разговорах, голод
  1: (d) => {
    if (!Array.isArray(d.favorites)) d.favorites = [];
    const m = (d.market ?? {}) as Plain;
    if (!m.dayStartStock) m.dayStartStock = null;
    if (!m.flowsToday) m.flowsToday = {};
    if (!m.flowsYesterday) m.flowsYesterday = {};
    d.market = m;
    if (Array.isArray(d.talks)) for (const [, t] of d.talks as [number, Plain][]) if (!Array.isArray(t.history)) t.history = [];
    if (typeof d.famine !== 'boolean') d.famine = false;
    d.version = 2;
  },
  // 2 → 3 (фаза 13): размеры карты и города хранятся явно; природные ресурсы, угодья и туман
  // для старых карт генерируются заново при загрузке (deserialize), здесь — только поля
  2: (d) => {
    const w = (d.world ?? {}) as Plain;
    if (typeof w.cityTiles !== 'number') w.cityTiles = w.w;
    if (typeof w.fog !== 'boolean') w.fog = false;
    const r = (d.region ?? {}) as Plain;
    if (typeof r.prospector !== 'number') r.prospector = -1;
    d.region = r;
    d.version = 3;
  },
};

/** Применить миграции до текущей версии; бросает ошибку, если версия новее или неизвестна */
export function migrateSave(d: Plain): Plain {
  let v = typeof d.version === 'number' ? (d.version as number) : 0;
  if (v > SAVE_VERSION) throw new Error(`Сохранение из более новой версии игры (${v} > ${SAVE_VERSION})`);
  while (v < SAVE_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new Error(`Нет миграции для версии сохранения ${v}`);
    m(d);
    v = d.version as number;
  }
  return d;
}
const DB_NAME = 'waldmark';
const STORE = 'saves';

type Plain = Record<string, unknown>;

function typedToArray(a: ArrayLike<number>): number[] {
  return Array.from(a);
}

export function serialize(sim: Simulation): string {
  const w = sim.world;
  const world = {
    w: w.w,
    h: w.h,
    seed: w.seed,
    seedText: w.seedText,
    sizeName: w.sizeName,
    tiles: typedToArray(w.tiles),
    height: typedToArray(w.height).map((v) => Math.round(v * 1000) / 1000),
    district: typedToArray(w.district),
    inside: typedToArray(w.inside),
    buildingAt: typedToArray(w.buildingAt),
    buildings: w.buildings,
    props: w.props,
    poi: w.poi,
    wind: w.wind,
    cityTiles: w.cityTiles,
    fog: w.fog,
    fertility: typedToArray(w.fertility).map((v) => Math.round(v * 100) / 100),
    resource: typedToArray(w.resource),
    resourceAmount: typedToArray(w.resourceAmount),
    discovered: typedToArray(w.discovered),
    parcel: typedToArray(w.parcel),
    parcels: w.parcels,
    explored: typedToArray(w.explored),
  };
  const citizens = sim.citizens.map((c) => ({ ...c, relations: [...c.relations.entries()], path: null, pathIdx: 0 }));
  const data = {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    seedText: sim.seedText,
    size: sim.size,
    tick: sim.tick,
    rng: sim.rng.getState(),
    world,
    citizens,
    treasury: sim.treasury,
    taxRate: sim.taxRate,
    lastTax: sim.lastTax,
    lastCharity: sim.lastCharity,
    moneyCreated: sim.moneyCreated,
    moneyDestroyed: sim.moneyDestroyed,
    exportIncome: sim.exportIncome,
    importCost: sim.importCost,
    chronicle: sim.chronicle.events,
    history: sim.history,
    market: { prices: sim.market.prices, yearFactor: sim.market.yearFactor, soldToday: sim.market.soldToday, soldYesterday: sim.market.soldYesterday, dayStartStock: sim.market.dayStartStock, flowsToday: sim.market.flowsToday, flowsYesterday: sim.market.flowsYesterday },
    weather: sim.weather,
    fires: sim.fires,
    funerals: sim.funerals,
    deaths: sim.deaths,
    sickCount: sim.sickCount,
    fireRiskMul: sim.fireRiskMul,
    epidemicMul: sim.epidemicMul,
    animals: sim.animals,
    festival: sim.festival,
    unrest: sim.unrest,
    protest: sim.protest,
    caravan: sim.caravan,
    raid: sim.raid,
    nextCaravanDay: sim.nextCaravanDay,
    nextRaidDay: sim.nextRaidDay,
    heraldNews: sim.heraldNews,
    alarms: sim.alarms,
    crimeLog: sim.crimeLog,
    fights: sim.fights,
    talks: [...sim.talks.entries()],
    flood: sim.flood,
    dragon: sim.dragon,
    guardTarget: sim.guardTarget,
    region: { prospector: sim.region.prospector, prospectUntil: sim.region.prospectUntil },
    buildQueue: sim.construction.queue,
    favorites: sim.favorites,
    famine: sim.famine,
    pendingWedding: sim.pendingWedding,
    buildingVersion: sim.buildingVersion,
    tileVersion: sim.tileVersion,
  };
  return JSON.stringify(data);
}

export function deserialize(json: string): Simulation {
  const d = migrateSave(JSON.parse(json) as Plain);
  const sw = d.world as Plain;
  const sim = new Simulation({ seedText: d.seedText as string, size: d.size as 'small' | 'medium' | 'large', skipPopulation: true, mapTiles: sw.w as number, cityTiles: sw.cityTiles as number, fog: sw.fog as boolean });
  const w = sim.world;
  w.tiles.set(sw.tiles as number[]);
  w.height.set(sw.height as number[]);
  w.district.set(sw.district as number[]);
  w.inside.set(sw.inside as number[]);
  w.buildingAt.set(sw.buildingAt as number[]);
  w.buildings = sw.buildings as World['buildings'];
  w.props = sw.props as World['props'];
  w.poi = sw.poi as World['poi'];
  w.wind = sw.wind as World['wind'];
  w.solidProp.fill(-1);
  w.props.forEach((p, i) => {
    if (p.solid) w.solidProp[p.y * w.w + p.x] = i;
  });
  w.cityTiles = (sw.cityTiles as number) ?? w.w;
  w.fog = sw.fog === true;
  if (Array.isArray(sw.fertility) && Array.isArray(sw.resource)) {
    w.fertility.set(sw.fertility as number[]);
    w.resource.set(sw.resource as number[]);
    w.resourceAmount.set(sw.resourceAmount as number[]);
    w.discovered.set(sw.discovered as number[]);
    w.parcel.set(sw.parcel as number[]);
    w.parcels = sw.parcels as World['parcels'];
    w.explored.set(sw.explored as number[]);
  } else {
    // старая карта без природы: достроить ландшафтные данные по загруженному миру
    regenerateNature(w);
  }
  sim.citizens = (d.citizens as Plain[]).map((c) => {
    const z = { ...c } as unknown as Citizen;
    z.relations = new Map(c.relations as [number, number][]);
    z.path = null;
    z.pathIdx = 0;
    return z;
  });
  sim.tick = d.tick as number;
  sim.rng.setState(d.rng as [number, number, number, number]);
  sim.treasury = d.treasury as number;
  sim.taxRate = d.taxRate as number;
  sim.lastTax = d.lastTax as number;
  sim.lastCharity = d.lastCharity as number;
  sim.moneyCreated = d.moneyCreated as number;
  sim.moneyDestroyed = d.moneyDestroyed as number;
  sim.exportIncome = d.exportIncome as number;
  sim.importCost = d.importCost as number;
  sim.chronicle.events = d.chronicle as typeof sim.chronicle.events;
  sim.history = d.history as typeof sim.history;
  const m = d.market as Plain;
  Object.assign(sim.market.prices, m.prices as Plain);
  sim.market.yearFactor = m.yearFactor as number;
  Object.assign(sim.market.soldToday, m.soldToday as Plain);
  Object.assign(sim.market.soldYesterday, m.soldYesterday as Plain);
  if (m.dayStartStock) sim.market.restoreDayStart(m.dayStartStock as Record<string, number> as typeof sim.market.dayStartStock);
  if (m.flowsToday) sim.market.flowsToday = m.flowsToday as typeof sim.market.flowsToday;
  if (m.flowsYesterday) sim.market.flowsYesterday = m.flowsYesterday as typeof sim.market.flowsYesterday;
  Object.assign(sim.weather, d.weather as Plain);
  sim.fires = d.fires as typeof sim.fires;
  sim.funerals = d.funerals as typeof sim.funerals;
  sim.deaths = d.deaths as number;
  sim.sickCount = d.sickCount as number;
  sim.fireRiskMul = d.fireRiskMul as number;
  sim.epidemicMul = d.epidemicMul as number;
  sim.animals = d.animals as typeof sim.animals;
  sim.festival = d.festival as typeof sim.festival;
  sim.unrest = d.unrest as number;
  sim.protest = d.protest as typeof sim.protest;
  sim.caravan = d.caravan as typeof sim.caravan;
  sim.raid = d.raid as typeof sim.raid;
  sim.nextCaravanDay = d.nextCaravanDay as number;
  sim.nextRaidDay = d.nextRaidDay as number;
  sim.heraldNews = d.heraldNews as string[];
  sim.alarms = d.alarms as typeof sim.alarms;
  sim.crimeLog = d.crimeLog as typeof sim.crimeLog;
  sim.fights = d.fights as typeof sim.fights;
  sim.talks = new Map(d.talks as [number, (typeof sim.talks extends Map<number, infer T> ? T : never)][]);
  sim.flood = d.flood as typeof sim.flood;
  sim.dragon = d.dragon as typeof sim.dragon;
  sim.guardTarget = d.guardTarget as number;
  sim.favorites = Array.isArray(d.favorites) ? (d.favorites as number[]) : [];
  const reg = (d.region ?? {}) as Plain;
  sim.region.prospector = typeof reg.prospector === 'number' ? reg.prospector : -1;
  sim.region.prospectUntil = typeof reg.prospectUntil === 'number' ? reg.prospectUntil : 0;
  sim.construction.queue = Array.isArray(d.buildQueue) ? (d.buildQueue as number[]) : sim.world.buildings.filter((b) => b.w > 0 && b.underConstruction !== undefined).map((b) => b.id);
  sim.famine = d.famine === true;
  sim.pendingWedding = d.pendingWedding as typeof sim.pendingWedding;
  sim.buildingVersion = (d.buildingVersion as number) + 1;
  sim.tileVersion = (d.tileVersion as number) + 1;
  sim.pathfinder.invalidate();
  sim.stats = sim.computeStats();
  sim.market.update(sim);
  // Жители в пути без маршрута — пусть подумают заново
  for (const c of sim.citizens) {
    if (c.state === 1) {
      c.state = 0;
      c.nextThink = sim.tick;
    }
  }
  return sim;
}

// ---------------------------------------------------------------- IndexedDB

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveToDb(key: string, json: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ json, savedAt: Date.now() }, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadFromDb(key: string): Promise<{ json: string; savedAt: number } | null> {
  try {
    const db = await openDb();
    const res = await new Promise<{ json: string; savedAt: number } | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as { json: string; savedAt: number }) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return res;
  } catch {
    return null;
  }
}

export function downloadJson(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickJsonFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => resolve(null);
      r.readAsText(f);
    };
    input.click();
  });
}
