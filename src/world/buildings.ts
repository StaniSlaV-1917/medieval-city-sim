// Типы зданий и их описания.
export const enum BuildingType {
  House = 0, // обычный дом
  Shack = 1, // лачуга в трущобах
  Manor = 2, // дом знати
  TownHall = 3, // ратуша
  Cathedral = 4, // собор
  Castle = 5, // замок лорда
  Tavern = 6,
  Smithy = 7,
  Bakery = 8,
  Butcher = 9,
  Tannery = 10,
  Sawmill = 11,
  Quarry = 12,
  Mill = 13,
  Prison = 14,
  Monastery = 15, // монастырь с больницей
  FireTower = 16, // пожарная каланча
  Barracks = 17, // казарма стражи
  Farm = 18,
  MarketStall = 19,
  Carpenter = 20,
  Mason = 21,
  Well = 22,
  Pillory = 23, // позорный столб
  Chapel = 24, // кладбищенская часовня
  Warehouse = 25,
  Stable = 26,
  Merchant = 27, // торговый дом
  // Фаза 15: добыча, ремёсла, хранение
  Hunter = 28, // охотничья изба
  Fisher = 29, // рыбацкая хижина
  Gatherer = 30, // шалаш собирателей
  ClayPit = 31, // глиняный карьер
  Brickworks = 32, // кирпичный завод
  LimeKiln = 33, // известковая печь
  IronMine = 34, // рудник
  Bloomery = 35, // сыродутная печь
  Weaver = 36, // ткацкая
  Tailor = 37, // портной
  Cobbler = 38, // сапожник
  Cooper = 39, // бондарь
  Potter = 40, // гончар
  Chandler = 41, // свечник
  Apiary = 42, // пасека
  Sheepfold = 43, // овчарня
  VegGarden = 44, // огород
  Coop = 45, // курятник
  SaltWorks = 46, // солеварня
  PeatCutter = 47, // торфяник
  Scriptorium = 48, // скрипторий
  Armorer = 49, // оружейная
  Woodshed = 50, // дровяной сарай
  Granary = 51, // амбар
  Cellar = 52, // погреб
  Treasury = 53, // сокровищница
  Woodcutter = 54, // изба лесоруба (брёвна и дрова)
}

export type Material = 'wood' | 'stone' | 'timber' | 'brick';
export type Roof = 'thatch' | 'tile' | 'slate' | 'wood';

export interface BuildingDef {
  name: string;
  /** Размеры футпринта (мин/макс) в тайлах */
  minW: number;
  maxW: number;
  minH: number;
  maxH: number;
  material: Material | 'any';
  roof: Roof | 'any';
  /** Является ли жильём */
  home: boolean;
  /** Сколько семей/жильцов вмещает */
  capacity: number;
  /** Есть ли работа и сколько работников */
  workers: number;
  /** Часы работы [открытие, закрытие] */
  hours: [number, number];
  /** Уникальное здание (одно на город) */
  unique: boolean;
  /** Класс для цвета/стиля */
  stories: number;
  /** Можно ли зайти внутрь (есть дверь) */
  enterable: boolean;
  /** Пожароопасность базовая (используется позже) */
  fireRisk: number;
  /** Хранилище: что принимает и сколько вмещает (фаза 15) */
  stores?: 'granary' | 'warehouse' | 'woodshed' | 'treasury';
  storeCap?: number;
}

const def = (p: Partial<BuildingDef> & { name: string }): BuildingDef => ({
  minW: 3,
  maxW: 4,
  minH: 3,
  maxH: 3,
  material: 'any',
  roof: 'any',
  home: false,
  capacity: 0,
  workers: 0,
  hours: [8, 18],
  unique: false,
  stories: 1,
  enterable: true,
  fireRisk: 0.5,
  ...p,
});

export const BUILDING_DEFS: Record<number, BuildingDef> = {
  [BuildingType.House]: def({ name: 'Дом', minW: 3, maxW: 4, minH: 3, maxH: 4, home: true, capacity: 6, stories: 1 }),
  [BuildingType.Shack]: def({ name: 'Лачуга', minW: 2, maxW: 3, minH: 2, maxH: 3, material: 'wood', roof: 'thatch', home: true, capacity: 5, fireRisk: 0.9 }),
  [BuildingType.Manor]: def({ name: 'Особняк', minW: 5, maxW: 6, minH: 4, maxH: 5, material: 'stone', roof: 'slate', home: true, capacity: 7, stories: 2, fireRisk: 0.2 }),
  [BuildingType.TownHall]: def({ name: 'Ратуша', minW: 8, maxW: 8, minH: 5, maxH: 5, material: 'stone', roof: 'slate', workers: 4, hours: [8, 18], unique: true, stories: 2, fireRisk: 0.15 }),
  [BuildingType.Cathedral]: def({ name: 'Собор', minW: 7, maxW: 7, minH: 10, maxH: 10, material: 'stone', roof: 'slate', workers: 2, hours: [6, 21], unique: true, stories: 3, fireRisk: 0.1 }),
  [BuildingType.Castle]: def({ name: 'Замок лорда', minW: 11, maxW: 11, minH: 8, maxH: 8, material: 'stone', roof: 'slate', home: true, capacity: 8, workers: 6, hours: [7, 20], unique: true, stories: 3, fireRisk: 0.1 }),
  [BuildingType.Tavern]: def({ name: 'Таверна', minW: 5, maxW: 6, minH: 4, maxH: 5, material: 'timber', roof: 'tile', workers: 3, hours: [11, 26], stories: 2, fireRisk: 0.6 }),
  [BuildingType.Smithy]: def({ name: 'Кузница', minW: 4, maxW: 5, minH: 3, maxH: 4, material: 'stone', roof: 'tile', workers: 2, hours: [7, 18], fireRisk: 0.8 }),
  [BuildingType.Bakery]: def({ name: 'Пекарня', minW: 4, maxW: 4, minH: 3, maxH: 4, material: 'timber', roof: 'tile', workers: 2, hours: [4, 18], fireRisk: 0.7 }),
  [BuildingType.Butcher]: def({ name: 'Мясная лавка', minW: 3, maxW: 4, minH: 3, maxH: 3, material: 'timber', roof: 'tile', workers: 2, hours: [7, 17] }),
  [BuildingType.Tannery]: def({ name: 'Кожевня', minW: 4, maxW: 5, minH: 3, maxH: 4, material: 'wood', roof: 'wood', workers: 3, hours: [7, 18] }),
  [BuildingType.Sawmill]: def({ name: 'Лесопилка', minW: 5, maxW: 6, minH: 4, maxH: 4, material: 'wood', roof: 'wood', workers: 4, hours: [7, 18], unique: true, fireRisk: 0.8 }),
  [BuildingType.Quarry]: def({ name: 'Каменоломня', minW: 6, maxW: 6, minH: 5, maxH: 5, material: 'stone', roof: 'wood', workers: 5, hours: [7, 18], unique: true, enterable: true, fireRisk: 0.1 }),
  [BuildingType.Mill]: def({ name: 'Мельница', minW: 4, maxW: 4, minH: 4, maxH: 4, material: 'stone', roof: 'wood', workers: 2, hours: [6, 18], unique: true, stories: 2 }),
  [BuildingType.Prison]: def({ name: 'Тюрьма', minW: 5, maxW: 5, minH: 4, maxH: 4, material: 'stone', roof: 'slate', workers: 2, hours: [0, 24], unique: true, fireRisk: 0.1 }),
  [BuildingType.Monastery]: def({ name: 'Монастырь и больница', minW: 8, maxW: 8, minH: 6, maxH: 6, material: 'stone', roof: 'tile', home: true, capacity: 8, workers: 5, hours: [0, 24], unique: true, stories: 2, fireRisk: 0.2 }),
  [BuildingType.FireTower]: def({ name: 'Пожарная каланча', minW: 2, maxW: 2, minH: 2, maxH: 2, material: 'wood', roof: 'wood', workers: 1, hours: [8, 18], unique: true, stories: 3 }),
  [BuildingType.Barracks]: def({ name: 'Казарма стражи', minW: 6, maxW: 6, minH: 4, maxH: 4, material: 'stone', roof: 'tile', home: true, capacity: 12, workers: 12, hours: [0, 24], unique: true, fireRisk: 0.2 }),
  [BuildingType.Farm]: def({ name: 'Ферма', minW: 4, maxW: 5, minH: 3, maxH: 4, material: 'wood', roof: 'thatch', home: true, capacity: 6, workers: 4, hours: [6, 18], fireRisk: 0.8 }),
  [BuildingType.MarketStall]: def({ name: 'Торговый ряд', minW: 2, maxW: 2, minH: 1, maxH: 1, material: 'wood', roof: 'wood', workers: 1, hours: [8, 18], enterable: false }),
  [BuildingType.Carpenter]: def({ name: 'Плотницкая', minW: 4, maxW: 4, minH: 3, maxH: 4, material: 'wood', roof: 'wood', workers: 2, hours: [7, 18], fireRisk: 0.8 }),
  [BuildingType.Mason]: def({ name: 'Двор каменщика', minW: 4, maxW: 5, minH: 3, maxH: 4, material: 'stone', roof: 'wood', workers: 2, hours: [7, 18], fireRisk: 0.2 }),
  [BuildingType.Well]: def({ name: 'Колодец', minW: 1, maxW: 1, minH: 1, maxH: 1, material: 'stone', roof: 'wood', enterable: false, fireRisk: 0 }),
  [BuildingType.Pillory]: def({ name: 'Позорный столб', minW: 1, maxW: 1, minH: 1, maxH: 1, material: 'wood', roof: 'wood', enterable: false, fireRisk: 0 }),
  [BuildingType.Chapel]: def({ name: 'Часовня', minW: 3, maxW: 3, minH: 3, maxH: 3, material: 'stone', roof: 'slate', workers: 0, hours: [0, 24], unique: true, fireRisk: 0.1 }),
  [BuildingType.Warehouse]: def({ name: 'Склад', minW: 5, maxW: 6, minH: 4, maxH: 4, material: 'timber', roof: 'tile', workers: 2, hours: [7, 18], fireRisk: 0.6 }),
  [BuildingType.Stable]: def({ name: 'Конюшня', minW: 4, maxW: 5, minH: 3, maxH: 3, material: 'wood', roof: 'thatch', workers: 1, hours: [6, 20], fireRisk: 0.9 }),
  [BuildingType.Merchant]: def({ name: 'Торговый дом', minW: 4, maxW: 5, minH: 4, maxH: 4, material: 'timber', roof: 'tile', home: true, capacity: 6, workers: 2, hours: [8, 18], stories: 2, fireRisk: 0.5 }),
  // Фаза 15
  [BuildingType.Hunter]: def({ name: 'Охотничья изба', minW: 3, maxW: 3, minH: 3, maxH: 3, material: 'wood', roof: 'thatch', workers: 2, hours: [6, 18], fireRisk: 0.7 }),
  [BuildingType.Fisher]: def({ name: 'Рыбацкая хижина', minW: 3, maxW: 3, minH: 2, maxH: 2, material: 'wood', roof: 'thatch', workers: 2, hours: [5, 17], fireRisk: 0.6 }),
  [BuildingType.Gatherer]: def({ name: 'Шалаш собирателей', minW: 2, maxW: 2, minH: 2, maxH: 2, material: 'wood', roof: 'thatch', workers: 3, hours: [6, 18], fireRisk: 0.6 }),
  [BuildingType.ClayPit]: def({ name: 'Глиняный карьер', minW: 3, maxW: 3, minH: 2, maxH: 2, material: 'wood', roof: 'wood', workers: 2, hours: [7, 18], fireRisk: 0.2 }),
  [BuildingType.Brickworks]: def({ name: 'Кирпичный завод', minW: 5, maxW: 5, minH: 3, maxH: 3, material: 'stone', roof: 'tile', workers: 3, hours: [7, 18], fireRisk: 0.5 }),
  [BuildingType.LimeKiln]: def({ name: 'Известковая печь', minW: 3, maxW: 3, minH: 3, maxH: 3, material: 'stone', roof: 'wood', workers: 2, hours: [7, 18], fireRisk: 0.5 }),
  [BuildingType.IronMine]: def({ name: 'Рудник', minW: 3, maxW: 3, minH: 2, maxH: 2, material: 'wood', roof: 'wood', workers: 4, hours: [7, 18], fireRisk: 0.3 }),
  [BuildingType.Bloomery]: def({ name: 'Сыродутная печь', minW: 4, maxW: 4, minH: 3, maxH: 3, material: 'stone', roof: 'tile', workers: 3, hours: [7, 18], fireRisk: 0.8 }),
  [BuildingType.Weaver]: def({ name: 'Ткацкая', minW: 4, maxW: 4, minH: 3, maxH: 3, material: 'timber', roof: 'tile', workers: 3, hours: [7, 18], fireRisk: 0.5 }),
  [BuildingType.Tailor]: def({ name: 'Портной', minW: 3, maxW: 3, minH: 3, maxH: 3, material: 'timber', roof: 'tile', workers: 2, hours: [8, 18], fireRisk: 0.5 }),
  [BuildingType.Cobbler]: def({ name: 'Сапожник', minW: 3, maxW: 3, minH: 3, maxH: 3, material: 'timber', roof: 'wood', workers: 2, hours: [8, 18], fireRisk: 0.5 }),
  [BuildingType.Cooper]: def({ name: 'Бондарня', minW: 4, maxW: 4, minH: 3, maxH: 3, material: 'wood', roof: 'wood', workers: 2, hours: [7, 18], fireRisk: 0.7 }),
  [BuildingType.Potter]: def({ name: 'Гончарня', minW: 3, maxW: 3, minH: 3, maxH: 3, material: 'timber', roof: 'tile', workers: 2, hours: [7, 18], fireRisk: 0.6 }),
  [BuildingType.Chandler]: def({ name: 'Свечная', minW: 3, maxW: 3, minH: 3, maxH: 3, material: 'timber', roof: 'tile', workers: 2, hours: [8, 18], fireRisk: 0.7 }),
  [BuildingType.Apiary]: def({ name: 'Пасека', minW: 3, maxW: 3, minH: 2, maxH: 2, material: 'wood', roof: 'thatch', workers: 1, hours: [7, 17], fireRisk: 0.4 }),
  [BuildingType.Sheepfold]: def({ name: 'Овчарня', minW: 4, maxW: 4, minH: 3, maxH: 3, material: 'wood', roof: 'thatch', workers: 2, hours: [6, 18], fireRisk: 0.7 }),
  [BuildingType.VegGarden]: def({ name: 'Огород', minW: 3, maxW: 3, minH: 2, maxH: 2, material: 'wood', roof: 'thatch', workers: 2, hours: [6, 18], enterable: false, fireRisk: 0.3 }),
  [BuildingType.Coop]: def({ name: 'Курятник', minW: 2, maxW: 2, minH: 2, maxH: 2, material: 'wood', roof: 'thatch', workers: 1, hours: [6, 18], fireRisk: 0.7 }),
  [BuildingType.SaltWorks]: def({ name: 'Солеварня', minW: 4, maxW: 4, minH: 3, maxH: 3, material: 'wood', roof: 'wood', workers: 3, hours: [7, 18], fireRisk: 0.7 }),
  [BuildingType.PeatCutter]: def({ name: 'Торфяник', minW: 3, maxW: 3, minH: 2, maxH: 2, material: 'wood', roof: 'thatch', workers: 2, hours: [7, 18], fireRisk: 0.4 }),
  [BuildingType.Scriptorium]: def({ name: 'Скрипторий', minW: 4, maxW: 4, minH: 3, maxH: 3, material: 'stone', roof: 'slate', workers: 2, hours: [8, 18], fireRisk: 0.3 }),
  [BuildingType.Armorer]: def({ name: 'Оружейная', minW: 4, maxW: 4, minH: 3, maxH: 3, material: 'stone', roof: 'tile', workers: 2, hours: [7, 18], fireRisk: 0.7 }),
  [BuildingType.Woodshed]: def({ name: 'Дровяной сарай', minW: 3, maxW: 3, minH: 2, maxH: 2, material: 'wood', roof: 'wood', workers: 1, hours: [7, 18], fireRisk: 0.9, stores: 'woodshed', storeCap: 400 }),
  [BuildingType.Granary]: def({ name: 'Амбар', minW: 4, maxW: 4, minH: 3, maxH: 3, material: 'timber', roof: 'tile', workers: 2, hours: [7, 18], fireRisk: 0.6, stores: 'granary', storeCap: 800 }),
  [BuildingType.Cellar]: def({ name: 'Погреб', minW: 3, maxW: 3, minH: 2, maxH: 2, material: 'stone', roof: 'wood', workers: 1, hours: [7, 18], fireRisk: 0.2, stores: 'granary', storeCap: 300 }),
  [BuildingType.Treasury]: def({ name: 'Сокровищница', minW: 3, maxW: 3, minH: 3, maxH: 3, material: 'stone', roof: 'slate', workers: 1, hours: [8, 18], fireRisk: 0.1, stores: 'treasury', storeCap: 0 }),
  [BuildingType.Woodcutter]: def({ name: 'Изба лесоруба', minW: 3, maxW: 3, minH: 3, maxH: 3, material: 'wood', roof: 'thatch', workers: 4, hours: [7, 18], fireRisk: 0.8 }),
};

export interface Building {
  id: number;
  type: BuildingType;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Тайл двери (снаружи футпринта, на улице) */
  doorX: number;
  doorY: number;
  /** Сторона, куда смотрит фасад: 0=юг (вниз), 1=запад, 2=север, 3=восток */
  facing: number;
  material: Material;
  roof: Roof;
  stories: number;
  variant: number;
  /** Собственное имя (для таверн, лавок) */
  name: string;
  /** Жильцы (id жителей) */
  residents: number[];
  /** Работники (id жителей) */
  workers: number[];
  owner: number;
  /** Состояние 0..1 */
  condition: number;
  /** Запасы товаров (ключ — Good) */
  storage: Record<string, number>;
  /** Квартал */
  district: District;
  /** Светится ли ночью (окна) */
  lit: boolean;
  /** Стройка: доля готовности 0..1 (undefined — построено) */
  underConstruction?: number;
  /** Стадия стройки: 0 фундамент, 1 каркас, 2 стены, 3 крыша */
  buildStage?: number;
  /** Управление рабочими (фаза 14): предел рабочих, закрыто, приоритет */
  maxWorkers?: number;
  closed?: boolean;
  priority?: number;
  /** Стройка приостановлена правителем */
  paused?: boolean;
  /** Улучшение: по завершении стройки здание станет таким */
  upgradeTo?: { type: BuildingType; material: Material; roof: Roof; stories: number };
}

/** Сколько работников примет здание с учётом предела правителя и закрытия (фаза 14) */
export function workerCap(b: Building, slack = 0): number {
  if (b.closed) return 0;
  const base = BUILDING_DEFS[b.type].workers;
  return b.maxWorkers !== undefined ? b.maxWorkers : base + slack;
}

export const enum District {
  Center = 0,
  Craftsmen = 1,
  Residential = 2,
  Slums = 3,
  Noble = 4,
  Outskirts = 5,
}

export const DISTRICT_NAMES = ['Центр', 'Ремесленный квартал', 'Жилой квартал', 'Трущобы', 'Верхний город', 'Предместья'];
