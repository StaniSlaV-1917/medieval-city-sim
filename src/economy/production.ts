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
  [BuildingType.Farm]: { inputs: { tools: 0.015 }, outputs: { grain: 1.8, meat: 0.14, hide: 0.05 }, sells: [], stockHours: 0, markup: 1 },
  [BuildingType.Mill]: { inputs: { grain: 12 }, outputs: { flour: 12 }, sells: ['flour'], stockHours: 6, markup: 1.1 },
  [BuildingType.Bakery]: { inputs: { flour: 3.6 }, outputs: { bread: 11 }, sells: ['bread'], stockHours: 6, markup: 1 },
  [BuildingType.Butcher]: { inputs: { meat: 0 }, outputs: {}, sells: ['meat'], stockHours: 8, markup: 1.15 },
  [BuildingType.Tannery]: { inputs: { hide: 1 }, outputs: { leather: 1 }, sells: ['leather'], stockHours: 8, markup: 1.1 },
  [BuildingType.Sawmill]: { inputs: { wood: 2, tools: 0.02 }, outputs: { planks: 2 }, sells: ['planks', 'wood'], stockHours: 6, markup: 1.1 },
  [BuildingType.Quarry]: { inputs: { tools: 0.02 }, outputs: { stone: 0.8 }, sells: ['stone'], stockHours: 0, markup: 1.1 },
  [BuildingType.Carpenter]: { inputs: { planks: 0.8, tools: 0.01 }, outputs: { goods: 0.5 }, sells: ['goods'], stockHours: 8, markup: 1.2 },
  [BuildingType.Mason]: { inputs: { stone: 0.6, tools: 0.01 }, outputs: { goods: 0.3 }, sells: [], stockHours: 8, markup: 1.2 },
  [BuildingType.Smithy]: { inputs: { wood: 0.3 }, outputs: { tools: 0.45 }, sells: ['tools'], stockHours: 8, markup: 1.2 },
  [BuildingType.Tavern]: { inputs: { grain: 0.3 }, outputs: { ale: 1.2 }, sells: ['ale', 'bread', 'meat'], stockHours: 8, markup: 1.4 },
  [BuildingType.MarketStall]: { inputs: {}, outputs: {}, sells: ['bread', 'meat', 'ale', 'leather', 'tools', 'goods'], stockHours: 8, markup: 1.25 },
  [BuildingType.Merchant]: { inputs: {}, outputs: {}, sells: ['leather', 'tools', 'goods', 'planks'], stockHours: 8, markup: 1.3 },
  [BuildingType.Warehouse]: { inputs: {}, outputs: {}, sells: ['grain', 'flour', 'planks', 'stone', 'leather', 'goods', 'tools'], stockHours: 8, markup: 1.1 },
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
