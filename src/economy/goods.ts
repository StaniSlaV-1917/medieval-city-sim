// Товары экономики (фаза 15): сырьё, еда, материалы, товары, роскошь. Порча — доля в день.
export type Good =
  | 'grain' | 'flour' | 'bread' | 'meat' | 'hide' | 'leather' | 'wood' | 'planks' | 'stone' | 'ale' | 'tools' | 'goods'
  | 'firewood' | 'clay' | 'iron_ore' | 'iron' | 'peat' | 'salt' | 'wool' | 'flax' | 'honey' | 'wax'
  | 'fish' | 'berries' | 'vegetables' | 'eggs' | 'cheese' | 'wine'
  | 'brick' | 'tile' | 'lime' | 'cloth'
  | 'clothes' | 'shoes' | 'barrels' | 'pottery' | 'candles' | 'weapons' | 'armor' | 'books' | 'spices';

export type GoodCategory = 'raw' | 'food' | 'material' | 'goods' | 'luxury';

export interface GoodInfo {
  name: string;
  plural: string;
  base: number;
  /** Сытость от единицы (0 — не еда) */
  food: number;
  category: GoodCategory;
  /** Порча: доля запаса, пропадающая за день в обычном доме/лавке (0 — не портится) */
  spoil: number;
  /** Где хранится: амбар (еда), склад (материалы и товары), дровяной сарай (топливо) */
  store: 'granary' | 'warehouse' | 'woodshed' | 'treasury';
}

const g = (name: string, plural: string, base: number, category: GoodCategory, store: GoodInfo['store'], food = 0, spoil = 0): GoodInfo => ({ name, plural, base, food, category, spoil, store });

export const GOOD_INFO: Record<Good, GoodInfo> = {
  grain: g('зерно', 'зерна', 0.6, 'food', 'granary', 0, 0.01),
  flour: g('мука', 'муки', 0.9, 'food', 'granary', 0, 0.015),
  bread: g('хлеб', 'хлеба', 1, 'food', 'granary', 55, 0.04),
  meat: g('мясо', 'мяса', 2.5, 'food', 'granary', 45, 0.12),
  hide: g('шкуры', 'шкур', 2, 'raw', 'warehouse'),
  leather: g('кожа', 'кожи', 4, 'material', 'warehouse'),
  wood: g('брёвна', 'брёвен', 1.2, 'raw', 'warehouse'),
  planks: g('доски', 'досок', 2, 'material', 'warehouse'),
  stone: g('камень', 'камня', 1.5, 'raw', 'warehouse'),
  ale: g('эль', 'эля', 1, 'food', 'granary', 10, 0.03),
  tools: g('инструменты', 'инструментов', 6, 'material', 'warehouse'),
  goods: g('изделия', 'изделий', 5, 'goods', 'warehouse'),
  firewood: g('дрова', 'дров', 0.8, 'raw', 'woodshed'),
  clay: g('глина', 'глины', 0.7, 'raw', 'warehouse'),
  iron_ore: g('железная руда', 'железной руды', 2.5, 'raw', 'warehouse'),
  iron: g('железо', 'железа', 7, 'material', 'warehouse'),
  peat: g('торф', 'торфа', 0.6, 'raw', 'woodshed'),
  salt: g('соль', 'соли', 3, 'raw', 'granary'),
  wool: g('шерсть', 'шерсти', 2.2, 'raw', 'warehouse'),
  flax: g('лён', 'льна', 1.8, 'raw', 'warehouse'),
  honey: g('мёд', 'мёда', 4, 'food', 'granary', 15, 0),
  wax: g('воск', 'воска', 3.5, 'raw', 'warehouse'),
  fish: g('рыба', 'рыбы', 1.6, 'food', 'granary', 40, 0.15),
  berries: g('ягоды', 'ягод', 1.2, 'food', 'granary', 20, 0.12),
  vegetables: g('овощи', 'овощей', 1, 'food', 'granary', 25, 0.05),
  eggs: g('яйца', 'яиц', 1.4, 'food', 'granary', 25, 0.06),
  cheese: g('сыр', 'сыра', 3.5, 'food', 'granary', 40, 0.03),
  wine: g('вино', 'вина', 8, 'luxury', 'granary', 10, 0),
  brick: g('кирпич', 'кирпича', 2.2, 'material', 'warehouse'),
  tile: g('черепица', 'черепицы', 2.5, 'material', 'warehouse'),
  lime: g('известь', 'извести', 1.8, 'material', 'warehouse'),
  cloth: g('ткань', 'ткани', 5, 'material', 'warehouse'),
  clothes: g('одежда', 'одежды', 9, 'goods', 'warehouse'),
  shoes: g('обувь', 'обуви', 7, 'goods', 'warehouse'),
  barrels: g('бочки', 'бочек', 6, 'goods', 'warehouse'),
  pottery: g('гончарка', 'гончарки', 3, 'goods', 'warehouse'),
  candles: g('свечи', 'свечей', 2.5, 'goods', 'warehouse'),
  weapons: g('оружие', 'оружия', 18, 'goods', 'warehouse'),
  armor: g('доспехи', 'доспехов', 30, 'goods', 'warehouse'),
  books: g('книги', 'книг', 25, 'luxury', 'warehouse'),
  spices: g('специи', 'специй', 15, 'luxury', 'granary'),
};

export const GOODS: Good[] = Object.keys(GOOD_INFO) as Good[];

/** Товары, которые город производил с самого начала (для таблиц рынка и ранних сохранений) */
export const CORE_GOODS: Good[] = ['grain', 'flour', 'bread', 'meat', 'hide', 'leather', 'wood', 'planks', 'stone', 'ale', 'tools', 'goods'];

export const CATEGORY_NAMES: Record<GoodCategory, string> = { raw: 'Сырьё', food: 'Еда', material: 'Материалы', goods: 'Товары', luxury: 'Роскошь' };

export function isGood(k: string): k is Good {
  return k in GOOD_INFO;
}
