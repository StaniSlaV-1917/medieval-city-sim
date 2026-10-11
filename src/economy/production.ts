// Производственные цепочки: что потребляет и производит каждое здание (на работника-час).
import { BuildingType, Building } from '../world/buildings';
import { Good } from './goods';
import { Season } from '../core/time';

export interface Recipe {
  /** Входы: товар → единиц в час на работника */
  inputs: Partial<Record<Good, number>>;
  /** Выходы: товар → единиц в час на работника */
  outputs: Partial<Record<Good, number>>;
  /** Товары, которые это здание продаёт горожанам */
  sells: Good[];
  /** Сколько часов запаса входов держать (порог для доставки) */
  stockHours: number;
  /** Наценка при продаже горожанам */
  markup: number;
}

export const RECIPES: Partial<Record<BuildingType, Recipe>> = {
  [BuildingType.Farm]: { inputs: { tools: 0.015 }, outputs: { grain: 2.0, meat: 0.14, hide: 0.05 }, sells: [], stockHours: 0, markup: 1 },
  [BuildingType.Mill]: { inputs: { grain: 13 }, outputs: { flour: 13 }, sells: ['flour'], stockHours: 6, markup: 1.1 },
  [BuildingType.Bakery]: { inputs: { flour: 4.8 }, outputs: { bread: 15 }, sells: ['bread'], stockHours: 6, markup: 1 },
  [BuildingType.Butcher]: { inputs: { meat: 0 }, outputs: {}, sells: ['meat'], stockHours: 8, markup: 1.15 },
  [BuildingType.Tannery]: { inputs: { hide: 1 }, outputs: { leather: 1 }, sells: ['leather'], stockHours: 8, markup: 1.1 },
  [BuildingType.Sawmill]: { inputs: { wood: 2, tools: 0.02 }, outputs: { planks: 2, firewood: 1.2 }, sells: ['planks', 'wood', 'firewood'], stockHours: 6, markup: 1.1 },
  [BuildingType.Quarry]: { inputs: { tools: 0.02 }, outputs: { stone: 0.8 }, sells: ['stone'], stockHours: 0, markup: 1.1 },
  [BuildingType.Carpenter]: { inputs: { planks: 0.8, tools: 0.01 }, outputs: { goods: 0.5 }, sells: ['goods'], stockHours: 8, markup: 1.2 },
  [BuildingType.Mason]: { inputs: { stone: 0.6, tools: 0.01 }, outputs: { goods: 0.3 }, sells: [], stockHours: 8, markup: 1.2 },
  [BuildingType.Smithy]: { inputs: { wood: 0.3 }, outputs: { tools: 0.45 }, sells: ['tools'], stockHours: 8, markup: 1.2 },
  [BuildingType.Tavern]: { inputs: { grain: 0.3 }, outputs: { ale: 1.2 }, sells: ['ale', 'bread', 'meat'], stockHours: 8, markup: 1.4 },
  [BuildingType.MarketStall]: { inputs: {}, outputs: {}, sells: ['bread', 'meat', 'ale', 'leather', 'tools', 'goods'], stockHours: 8, markup: 1.25 },
  [BuildingType.Merchant]: { inputs: {}, outputs: {}, sells: ['leather', 'tools', 'goods', 'planks'], stockHours: 8, markup: 1.3 },
  [BuildingType.Warehouse]: { inputs: {}, outputs: {}, sells: ['grain', 'flour', 'planks', 'stone', 'leather', 'goods', 'tools', 'firewood', 'iron', 'brick', 'cloth', 'clothes', 'shoes', 'pottery', 'candles', 'barrels'], stockHours: 8, markup: 1.1 },
  // Фаза 15: добыча из природы (норма — предел при наличии ресурса рядом, см. OUTDOOR_WORK)
  [BuildingType.Hunter]: { inputs: { tools: 0.01 }, outputs: { meat: 0.5, hide: 0.2 }, sells: ['meat', 'hide'], stockHours: 0, markup: 1.1 },
  [BuildingType.Fisher]: { inputs: {}, outputs: { fish: 0.9 }, sells: ['fish'], stockHours: 0, markup: 1.1 },
  [BuildingType.Gatherer]: { inputs: {}, outputs: { berries: 0.7 }, sells: ['berries'], stockHours: 0, markup: 1.1 },
  [BuildingType.ClayPit]: { inputs: { tools: 0.01 }, outputs: { clay: 0.9 }, sells: ['clay'], stockHours: 0, markup: 1.1 },
  [BuildingType.IronMine]: { inputs: { tools: 0.03 }, outputs: { iron_ore: 0.5 }, sells: ['iron_ore'], stockHours: 0, markup: 1.1 },
  [BuildingType.PeatCutter]: { inputs: {}, outputs: { peat: 1.0 }, sells: ['peat'], stockHours: 0, markup: 1.1 },
  [BuildingType.SaltWorks]: { inputs: { firewood: 0.3 }, outputs: { salt: 0.5 }, sells: ['salt'], stockHours: 8, markup: 1.2 },
  [BuildingType.Woodcutter]: { inputs: {}, outputs: { wood: 0.6, firewood: 2.2 }, sells: ['firewood', 'wood'], stockHours: 0, markup: 1.1 },
  [BuildingType.Sheepfold]: { inputs: {}, outputs: { wool: 0.3, cheese: 0.15 }, sells: ['wool', 'cheese'], stockHours: 0, markup: 1.1 },
  // производство в здании
  [BuildingType.Brickworks]: { inputs: { clay: 1.5, firewood: 0.4 }, outputs: { brick: 1.0, tile: 0.4 }, sells: ['brick', 'tile'], stockHours: 8, markup: 1.1 },
  [BuildingType.LimeKiln]: { inputs: { stone: 0.8, firewood: 0.5 }, outputs: { lime: 0.8 }, sells: ['lime'], stockHours: 8, markup: 1.1 },
  [BuildingType.Bloomery]: { inputs: { iron_ore: 1.2, firewood: 0.8 }, outputs: { iron: 0.5 }, sells: ['iron'], stockHours: 8, markup: 1.15 },
  [BuildingType.Weaver]: { inputs: { wool: 0.5, flax: 0.2 }, outputs: { cloth: 0.5 }, sells: ['cloth'], stockHours: 8, markup: 1.15 },
  [BuildingType.Tailor]: { inputs: { cloth: 0.5 }, outputs: { clothes: 0.3 }, sells: ['clothes'], stockHours: 8, markup: 1.2 },
  [BuildingType.Cobbler]: { inputs: { leather: 0.4 }, outputs: { shoes: 0.3 }, sells: ['shoes'], stockHours: 8, markup: 1.2 },
  [BuildingType.Cooper]: { inputs: { planks: 0.5, iron: 0.05 }, outputs: { barrels: 0.3 }, sells: ['barrels'], stockHours: 8, markup: 1.2 },
  [BuildingType.Potter]: { inputs: { clay: 0.8, firewood: 0.3 }, outputs: { pottery: 0.6 }, sells: ['pottery'], stockHours: 8, markup: 1.2 },
  [BuildingType.Chandler]: { inputs: { wax: 0.3 }, outputs: { candles: 0.8 }, sells: ['candles'], stockHours: 8, markup: 1.2 },
  [BuildingType.Apiary]: { inputs: {}, outputs: { honey: 0.25, wax: 0.12 }, sells: ['honey', 'wax'], stockHours: 0, markup: 1.2 },
  [BuildingType.VegGarden]: { inputs: {}, outputs: { vegetables: 0.9 }, sells: ['vegetables'], stockHours: 0, markup: 1.1 },
  [BuildingType.Coop]: { inputs: { grain: 0.2 }, outputs: { eggs: 0.6 }, sells: ['eggs'], stockHours: 8, markup: 1.1 },
  [BuildingType.Scriptorium]: { inputs: { leather: 0.1, candles: 0.1 }, outputs: { books: 0.05 }, sells: ['books'], stockHours: 8, markup: 1.3 },
  [BuildingType.Armorer]: { inputs: { iron: 0.5, leather: 0.1, firewood: 0.3 }, outputs: { weapons: 0.12, armor: 0.05 }, sells: ['weapons', 'armor'], stockHours: 8, markup: 1.3 },
  [BuildingType.Granary]: { inputs: {}, outputs: {}, sells: ['grain', 'flour', 'bread', 'meat', 'fish', 'vegetables', 'eggs', 'cheese', 'berries', 'salt', 'honey'], stockHours: 8, markup: 1.05 },
  [BuildingType.Cellar]: { inputs: {}, outputs: {}, sells: ['meat', 'fish', 'cheese', 'vegetables', 'wine', 'salt'], stockHours: 8, markup: 1.05 },
  [BuildingType.Woodshed]: { inputs: {}, outputs: {}, sells: ['firewood', 'peat'], stockHours: 8, markup: 1.05 },
};

/** Работа «в поле»: какой ресурс берётся с карты и в каком радиусе от здания (фаза 15) */
export const OUTDOOR_WORK: Partial<Record<BuildingType, { resource?: number; tile?: number; r: number; outputs: Partial<Record<Good, number>>; /** сколько единиц ресурса уходит на единицу продукции */ take: number }>> = {
  [BuildingType.Fisher]: { resource: 9, r: 10, outputs: { fish: 0.9 }, take: 1 },
  [BuildingType.Gatherer]: { resource: 6, r: 12, outputs: { berries: 0.7 }, take: 1 },
  [BuildingType.ClayPit]: { resource: 3, r: 6, outputs: { clay: 0.9 }, take: 1 },
  [BuildingType.IronMine]: { resource: 2, r: 6, outputs: { iron_ore: 0.5 }, take: 1 },
  [BuildingType.PeatCutter]: { resource: 5, r: 8, outputs: { peat: 1.0 }, take: 1 },
  [BuildingType.SaltWorks]: { resource: 4, r: 6, outputs: { salt: 0.5 }, take: 1 },
  [BuildingType.Sheepfold]: { tile: 24, r: 10, outputs: { wool: 0.3, cheese: 0.15 }, take: 0 },
  [BuildingType.VegGarden]: { tile: 0, r: 2, outputs: { vegetables: 0.9 }, take: 0 },
  [BuildingType.Woodcutter]: { tile: 9, r: 22, outputs: { wood: 0.6, firewood: 2.2 }, take: 0 },
};

/** Какие здания производят товар (для поиска поставщика) */
export function producersOf(good: Good): BuildingType[] {
  const out: BuildingType[] = [];
  for (const [k, r] of Object.entries(RECIPES)) {
    if (r && (r.outputs as Record<string, number>)[good]) out.push(Number(k) as BuildingType);
  }
  if (good === 'wood' && !out.includes(BuildingType.Sawmill)) out.push(BuildingType.Sawmill);
  return out;
}

/** Сезонный множитель урожая */
export function harvestFactor(season: Season, yearFactor: number): number {
  const s = [0.8, 1.0, 1.6, 0.35][season];
  return s * yearFactor;
}

/** Сколько товара здание хочет закупить (целевой запас минус текущий) */
export function wantedStock(b: Building, good: Good, workers: number): number {
  const r = RECIPES[b.type];
  if (!r) return 0;
  const perHour = (r.inputs as Record<string, number>)[good] ?? 0;
  if (perHour > 0) return Math.max(4, Math.ceil(perHour * Math.max(1, workers) * r.stockHours));
  if (r.sells.includes(good)) {
    // перепродажа: держать запас на день торговли
    return b.type === BuildingType.Warehouse ? 40 : b.type === BuildingType.Tavern ? (good === 'bread' ? 14 : 8) : 12;
  }
  return 0;
}

export function stockOf(b: Building, good: Good): number {
  return b.storage[good] ?? 0;
}

export function addStock(b: Building, good: Good, n: number): void {
  b.storage[good] = (b.storage[good] ?? 0) + n;
}
