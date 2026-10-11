// Каталог построек для панели строительства (фаза 14): категории, стоимость, требования, радиусы.
// Производство/потребление берётся из RECIPES, число рабочих и жильцов — из BUILDING_DEFS.
import { BuildingType, BUILDING_DEFS } from '../world/buildings';
import { RECIPES } from '../economy/production';
import { GOOD_INFO, Good } from '../economy/goods';
import { PropType } from '../world/world';

export type BuildCategory = 'housing' | 'food' | 'extraction' | 'crafts' | 'storage' | 'trade' | 'faith' | 'order' | 'roads' | 'defense' | 'decor';

export const BUILD_CATEGORIES: { id: BuildCategory; name: string; icon: string }[] = [
  { id: 'housing', name: 'Жильё', icon: 'population' },
  { id: 'food', name: 'Еда', icon: 'bread' },
  { id: 'extraction', name: 'Добыча', icon: 'wood' },
  { id: 'crafts', name: 'Ремёсла', icon: 'tools' },
  { id: 'storage', name: 'Хранение', icon: 'goods' },
  { id: 'trade', name: 'Торговля', icon: 'trade' },
  { id: 'faith', name: 'Вера и досуг', icon: 'god' },
  { id: 'order', name: 'Порядок', icon: 'edicts' },
  { id: 'roads', name: 'Дороги', icon: 'region' },
  { id: 'defense', name: 'Оборона', icon: 'alert' },
  { id: 'decor', name: 'Украшения', icon: 'mood' },
];

export type NearReq = 'water' | 'forest' | 'stone' | 'clay' | 'road' | 'field' | 'iron' | 'swamp' | 'salt';
export const NEAR_NAMES: Record<NearReq, string> = { water: 'у воды', forest: 'рядом с лесом', stone: 'у скал или каменоломни', clay: 'у глины', road: 'у дороги', field: 'рядом с полями', iron: 'у рудной жилы', swamp: 'у болота', salt: 'у солончака' };

export interface BuildItem {
  id: string;
  category: BuildCategory;
  name: string;
  desc: string;
  /** Тип здания (для построек) */
  type?: BuildingType;
  /** Инструмент: дорога, зона, снос, украшение */
  tool?: 'path' | 'road' | 'plot' | 'field' | 'pasture' | 'grove' | 'demolish' | 'upgrade' | 'prop' | 'wall';
  prop?: PropType;
  /** Стоимость материалов (доставляют строители) */
  cost: Partial<Record<Good, number>>;
  /** Деньги из казны (за работу) */
  money: number;
  /** Требование соседства и радиус его проверки */
  near?: NearReq;
  nearR?: number;
  /** Радиус влияния (колодец, церковь, рынок, каланча) */
  influence?: number;
  /** Радиус работы (лесоруб, охотник, каменоломня) */
  workRadius?: number;
  /** Требуемый узел развития (пока только подпись) */
  needsNode?: string;
  /** Минимальное население */
  minPop?: number;
}

const b = (id: string, category: BuildCategory, type: BuildingType, desc: string, cost: Partial<Record<Good, number>>, money: number, extra: Partial<BuildItem> = {}): BuildItem => ({ id, category, type, name: BUILDING_DEFS[type].name, desc, cost, money, ...extra });

export const BUILD_CATALOG: BuildItem[] = [
  // Жильё
  b('shack', 'housing', BuildingType.Shack, 'Дешёвая лачуга: крыша над головой для бедных семей. Горит легко.', { wood: 6 }, 10),
  b('house', 'housing', BuildingType.House, 'Обычный дом на одну-две семьи. Можно улучшить до фахверка и камня.', { planks: 10, stone: 2 }, 25),
  b('manor', 'housing', BuildingType.Manor, 'Каменный особняк для знати и богатых купцов.', { planks: 16, stone: 24 }, 120, { minPop: 150 }),
  { id: 'plot', category: 'housing', name: 'Жилой участок', desc: 'Нарисуйте прямоугольник вдоль дороги — дома встанут сами фасадом к улице.', tool: 'plot', cost: {}, money: 0 },
  { id: 'upgrade', category: 'housing', name: 'Улучшить', desc: 'Лачуга → дом → фахверк → камень. Жильцы остаются, строители достраивают.', tool: 'upgrade', cost: {}, money: 0 },
  // Еда
  b('farm', 'food', BuildingType.Farm, 'Крестьянский двор: зерно с полей, немного мяса и шкур. Поля рисуются отдельно.', { planks: 8, stone: 2 }, 20, { near: 'field', nearR: 14, workRadius: 14 }),
  { id: 'field', category: 'food', name: 'Поле', desc: 'Кисть: пашня на траве и лугу. Урожай зависит от плодородия (см. оверлей «Почва»).', tool: 'field', cost: {}, money: 0 },
  { id: 'pasture', category: 'food', name: 'Выпас', desc: 'Кисть: луг под скот. Овцы и коровы — в следующих фазах.', tool: 'pasture', cost: {}, money: 0 },
  b('mill', 'food', BuildingType.Mill, 'Водяная мельница мелет зерно в муку. Ставится у реки.', { planks: 14, stone: 6 }, 60, { near: 'water', nearR: 4 }),
  b('bakery', 'food', BuildingType.Bakery, 'Пекарня: мука → хлеб. Главный источник еды.', { planks: 8, stone: 8 }, 40),
  b('butcher', 'food', BuildingType.Butcher, 'Мясная лавка продаёт мясо с ферм и от охотников.', { planks: 8, stone: 4 }, 30),
  b('tavern', 'food', BuildingType.Tavern, 'Таверна варит эль и кормит горожан. Растит настроение, но и драки.', { planks: 14, stone: 6 }, 60, { minPop: 60 }),
  // Добыча
  b('sawmill', 'extraction', BuildingType.Sawmill, 'Лесорубы валят деревья в радиусе, пилят доски. Лес отрастает медленно.', { planks: 6, stone: 2 }, 30, { near: 'forest', nearR: 12, workRadius: 14 }),
  b('quarry', 'extraction', BuildingType.Quarry, 'Каменоломня берёт камень из скал; месторождение конечно.', { planks: 8 }, 40, { near: 'stone', nearR: 8, workRadius: 8 }),
  { id: 'grove', category: 'extraction', name: 'Роща', desc: 'Кисть: посадить поросль. Через две-три недели вырастут деревья.', tool: 'grove', cost: {}, money: 0 },
  b('woodcutter', 'extraction', BuildingType.Woodcutter, 'Изба лесоруба: брёвна и дрова на зиму. Деревья в радиусе вырубаются.', { planks: 4 }, 15, { near: 'forest', nearR: 10, workRadius: 12 }),
  b('hunter', 'extraction', BuildingType.Hunter, 'Охотники бьют оленей и кабанов в округе: мясо и шкуры. Дичь восстанавливается.', { planks: 6 }, 20, { near: 'forest', nearR: 10, workRadius: 20 }),
  b('fisher', 'extraction', BuildingType.Fisher, 'Рыбаки ловят рыбу в реке и озёрах в радиусе.', { planks: 6 }, 15, { near: 'water', nearR: 4, workRadius: 10 }),
  b('gatherer', 'extraction', BuildingType.Gatherer, 'Собиратели: ягоды, грибы и травы по сезону с опушек и лугов.', { planks: 3 }, 10, { near: 'forest', nearR: 10, workRadius: 12 }),
  b('claypit', 'extraction', BuildingType.ClayPit, 'Глиняный карьер у залежей глины — для кирпича и гончарки.', { planks: 4 }, 15, { near: 'clay', nearR: 6, workRadius: 6 }),
  b('ironmine', 'extraction', BuildingType.IronMine, 'Рудник на найденной жиле: железная руда для сыродутной печи.', { planks: 10, stone: 4 }, 60, { near: 'iron', nearR: 6, workRadius: 6 }),
  b('peat', 'extraction', BuildingType.PeatCutter, 'Торфяник: торф из болота — топливо для печей.', { planks: 3 }, 10, { near: 'swamp', nearR: 8, workRadius: 8 }),
  b('saltworks', 'extraction', BuildingType.SaltWorks, 'Солеварня на солончаке: соль для засолки припасов (нужны дрова).', { planks: 8, stone: 4 }, 50, { near: 'salt', nearR: 6, workRadius: 6 }),
  b('sheepfold', 'food', BuildingType.Sheepfold, 'Овчарня: овцы на выпасе дают шерсть и сыр. Нарисуйте выпас рядом.', { planks: 8 }, 30, { near: 'field', nearR: 0, workRadius: 10 }),
  b('apiary', 'food', BuildingType.Apiary, 'Пасека: мёд и воск.', { planks: 4 }, 15),
  b('veggarden', 'food', BuildingType.VegGarden, 'Огород: овощи к столу.', { planks: 2 }, 8),
  b('coop', 'food', BuildingType.Coop, 'Курятник: яйца (куры едят зерно).', { planks: 3 }, 8),
  // Ремёсла
  b('smithy', 'crafts', BuildingType.Smithy, 'Кузница делает инструменты (нужны всем промыслам).', { planks: 6, stone: 10 }, 50),
  b('carpenter', 'crafts', BuildingType.Carpenter, 'Плотницкая: доски → изделия; плотники строят дома.', { planks: 10, stone: 2 }, 35),
  b('mason', 'crafts', BuildingType.Mason, 'Двор каменщика: обрабатывает камень; каменщики строят.', { planks: 6, stone: 8 }, 35),
  b('tannery', 'crafts', BuildingType.Tannery, 'Кожевня: шкуры → кожа. Соседи жалуются на запах.', { planks: 8, stone: 2 }, 30, { near: 'water', nearR: 6 }),
  b('brickworks', 'crafts', BuildingType.Brickworks, 'Кирпичный завод: глина и дрова → кирпич и черепица.', { planks: 8, stone: 10 }, 60),
  b('limekiln', 'crafts', BuildingType.LimeKiln, 'Известковая печь: камень и дрова → известь для каменных стен.', { planks: 4, stone: 8 }, 35),
  b('bloomery', 'crafts', BuildingType.Bloomery, 'Сыродутная печь: руда и дрова → железо.', { planks: 6, stone: 12 }, 70),
  b('weaver', 'crafts', BuildingType.Weaver, 'Ткацкая: шерсть и лён → ткань.', { planks: 8, stone: 2 }, 35),
  b('tailor', 'crafts', BuildingType.Tailor, 'Портной: ткань → одежда.', { planks: 6, stone: 2 }, 30),
  b('cobbler', 'crafts', BuildingType.Cobbler, 'Сапожник: кожа → обувь.', { planks: 6 }, 25),
  b('cooper', 'crafts', BuildingType.Cooper, 'Бондарня: доски и железо → бочки.', { planks: 8 }, 30),
  b('potter', 'crafts', BuildingType.Potter, 'Гончарня: глина и дрова → гончарка.', { planks: 6, stone: 4 }, 30),
  b('chandler', 'crafts', BuildingType.Chandler, 'Свечная: воск → свечи.', { planks: 6 }, 25),
  b('scriptorium', 'crafts', BuildingType.Scriptorium, 'Скрипторий: кожа и свечи → книги (роскошь).', { planks: 6, stone: 12 }, 120, { minPop: 200 }),
  b('armorer', 'crafts', BuildingType.Armorer, 'Оружейная: железо и кожа → оружие и доспехи для стражи.', { planks: 6, stone: 14 }, 110, { minPop: 150 }),
  // Хранение
  b('warehouse', 'storage', BuildingType.Warehouse, 'Склад (600): материалы и товары; торгует с заречьем; строители берут материалы отсюда. Носильщик собирает продукцию.', { planks: 16, stone: 6 }, 60),
  b('granary', 'storage', BuildingType.Granary, 'Амбар (800): зерно и еда портятся вдвое медленнее. Носильщики свозят урожай; берегитесь крыс.', { planks: 12, stone: 4 }, 45),
  b('cellar', 'storage', BuildingType.Cellar, 'Погреб (300): мясо, рыба, сыр и овощи хранятся в разы дольше; с солью — ещё дольше.', { planks: 4, stone: 10 }, 40),
  b('woodshed', 'storage', BuildingType.Woodshed, 'Дровяной сарай (400): дрова и торф на зиму; продаёт топливо домам.', { planks: 6 }, 15),
  b('treasury', 'storage', BuildingType.Treasury, 'Сокровищница: казна под охраной. Пока — символ достатка; роль в фазе 16.', { planks: 4, stone: 16 }, 80, { minPop: 120 }),
  // Торговля
  b('stall', 'trade', BuildingType.MarketStall, 'Торговый ряд на площади или у дороги: хлеб, мясо, эль, кожа.', { planks: 4 }, 10, { near: 'road', nearR: 1 }),
  b('merchant', 'trade', BuildingType.Merchant, 'Торговый дом: кожа, инструменты, изделия, доски.', { planks: 12, stone: 8 }, 70, { minPop: 100 }),
  b('stable', 'trade', BuildingType.Stable, 'Конюшня для караванов и повозок.', { planks: 10, stone: 2 }, 30),
  // Вера и досуг
  b('chapel', 'faith', BuildingType.Chapel, 'Часовня: вера, отпевание. Радиус влияния на настроение.', { planks: 4, stone: 8 }, 40, { influence: 14 }),
  b('monastery', 'faith', BuildingType.Monastery, 'Монастырь с больницей: монахи лечат и подбирают упавших.', { planks: 12, stone: 24 }, 150, { influence: 20, minPop: 120 }),
  b('cathedral', 'faith', BuildingType.Cathedral, 'Собор: сердце веры, венчания, праздники.', { planks: 20, stone: 60 }, 400, { influence: 30, minPop: 250 }),
  // Порядок
  b('barracks', 'order', BuildingType.Barracks, 'Казарма стражи: патрули, задержания, отпор налётам.', { planks: 10, stone: 14 }, 80, { influence: 24 }),
  b('prison', 'order', BuildingType.Prison, 'Тюрьма: задержанные ждут суда.', { planks: 4, stone: 16 }, 60),
  b('firetower', 'order', BuildingType.FireTower, 'Пожарная каланча: дозор и вёдра в радиусе.', { planks: 10, stone: 4 }, 40, { influence: 22 }),
  b('pillory', 'order', BuildingType.Pillory, 'Позорный столб для мелких воров.', { planks: 2 }, 5),
  b('townhall', 'order', BuildingType.TownHall, 'Ратуша: бургомистр, глашатай, суд.', { planks: 16, stone: 30 }, 200, { minPop: 150 }),
  // Дороги
  { id: 'path', category: 'roads', name: 'Тропа', desc: 'Утоптанная дорога, бесплатно. Через ручей — мостки.', tool: 'path', cost: {}, money: 0 },
  { id: 'road', category: 'roads', name: 'Мощёная улица', desc: 'Камень за каждый тайл; жители ходят быстрее, грязи меньше.', tool: 'road', cost: { stone: 1 }, money: 0 },
  // Оборона
  { id: 'wall', category: 'defense', name: 'Стена', desc: 'Каменная стена; башни и ворота — в следующих фазах. Нужен камень.', tool: 'wall', cost: { stone: 2 }, money: 0, needsNode: 'walls' },
  // Украшения
  b('well', 'decor', BuildingType.Well, 'Колодец: вода для домов в радиусе, место встреч.', { stone: 6, planks: 2 }, 15, { influence: 12 }),
  { id: 'bench', category: 'decor', name: 'Скамья', desc: 'Скамья: старики и влюблённые любят здесь сидеть.', tool: 'prop', prop: PropType.Bench, cost: { planks: 1 }, money: 0 },
  { id: 'lamp', category: 'decor', name: 'Фонарь', desc: 'Фонарь освещает улицу ночью — меньше краж.', tool: 'prop', prop: PropType.Lamp, cost: { planks: 1 }, money: 2 },
  { id: 'torch', category: 'decor', name: 'Факел', desc: 'Факел у стены.', tool: 'prop', prop: PropType.Torch, cost: {}, money: 1 },
  { id: 'flowers', category: 'decor', name: 'Цветник', desc: 'Клумба радует прохожих.', tool: 'prop', prop: PropType.Flowers, cost: {}, money: 1 },
  { id: 'fence', category: 'decor', name: 'Ограда', desc: 'Плетень: не пройти.', tool: 'prop', prop: PropType.Fence, cost: { planks: 1 }, money: 0 },
  { id: 'demolish', category: 'decor', name: 'Снести', desc: 'Снос здания с возвратом половины материалов на склад.', tool: 'demolish', cost: {}, money: 0 },
];

export function catalogItem(id: string): BuildItem | undefined {
  return BUILD_CATALOG.find((i) => i.id === id);
}

/** Что производит и потребляет здание (по рецепту), для карточки */
export function recipeText(type: BuildingType): { produces: string; consumes: string; sells: string } {
  const r = RECIPES[type];
  if (!r) return { produces: '', consumes: '', sells: '' };
  const f = (o: Partial<Record<Good, number>>): string => Object.entries(o).filter(([, v]) => v && v > 0).map(([g]) => GOOD_INFO[g as Good].name).join(', ');
  return { produces: f(r.outputs), consumes: f(r.inputs), sells: r.sells.map((g) => GOOD_INFO[g].name).join(', ') };
}

export function costText(cost: Partial<Record<Good, number>>, money: number): string {
  const parts = Object.entries(cost).filter(([, v]) => v && v > 0).map(([g, v]) => `${v} ${GOOD_INFO[g as Good].plural}`);
  if (money) parts.push(`${money} монет`);
  return parts.join(', ') || 'бесплатно';
}
