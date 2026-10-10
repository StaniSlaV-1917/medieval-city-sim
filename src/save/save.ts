// Сохранение и загрузка: сериализация всей симуляции в JSON, IndexedDB-автосейв, экспорт/импорт файла.
import { Simulation } from '../sim/game';
import type { Citizen } from '../sim/citizen';
import type { World } from '../world/world';

const SAVE_VERSION = 1;
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
    market: { prices: sim.market.prices, yearFactor: sim.market.yearFactor, soldToday: sim.market.soldToday, soldYesterday: sim.market.soldYesterday },
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
    pendingWedding: sim.pendingWedding,
    buildingVersion: sim.buildingVersion,
    tileVersion: sim.tileVersion,
  };
  return JSON.stringify(data);
}

export function deserialize(json: string): Simulation {
  const d = JSON.parse(json) as Plain;
  if (d.version !== SAVE_VERSION) throw new Error('Несовместимая версия сохранения');
  const sim = new Simulation({ seedText: d.seedText as string, size: d.size as 'small' | 'medium' | 'large', skipPopulation: true });
  const w = sim.world;
  const sw = d.world as Plain;
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
