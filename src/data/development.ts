// Дерево развития города (таблица для фазы 15). Пока только описание узлов: интерфейс показывает
// их как «ещё недоступно», симуляция узлы не читает.
export interface DevNode {
  id: string;
  name: string;
  desc: string;
  /** Узлы, которые нужно открыть раньше */
  requires: string[];
  /** Примерная стоимость в монетах казны */
  cost: number;
  /** Что открывает (здания, указы, бонусы) — пока текстом */
  unlocks: string;
  tier: number;
}

export const DEV_NODES: DevNode[] = [
  { id: 'wells', name: 'Городские колодцы', desc: 'Больше колодцев — меньше ходить за водой.', requires: [], cost: 200, unlocks: 'колодец в каждом квартале', tier: 1 },
  { id: 'stone_roads', name: 'Мощёные улицы', desc: 'Камень вместо грязи: быстрее ходить, меньше болезней.', requires: ['wells'], cost: 500, unlocks: 'мощение улиц', tier: 2 },
  { id: 'fire_watch', name: 'Пожарная служба', desc: 'Вторая каланча и дежурные с вёдрами.', requires: [], cost: 300, unlocks: 'ещё одна каланча, быстрое тушение', tier: 1 },
  { id: 'granary', name: 'Городской амбар', desc: 'Запас зерна на чёрный день: голод отступает.', requires: ['wells'], cost: 400, unlocks: 'амбар, раздача хлеба в голод', tier: 2 },
  { id: 'guild_hall', name: 'Цеховой дом', desc: 'Ремесленники учат подмастерьев — выше выработка.', requires: ['stone_roads'], cost: 800, unlocks: 'цеховой дом, устав цехов', tier: 3 },
  { id: 'hospital', name: 'Госпиталь', desc: 'Больше коек и лекарей при монастыре.', requires: ['fire_watch'], cost: 600, unlocks: 'расширение больницы', tier: 2 },
  { id: 'market_rights', name: 'Рыночное право', desc: 'Право держать ярмарку: караваны чаще, пошлины выше.', requires: ['granary'], cost: 900, unlocks: 'частые караваны, пошлины', tier: 3 },
  { id: 'walls', name: 'Каменные стены', desc: 'Стены и башни отпугивают разбойников.', requires: ['guild_hall'], cost: 1500, unlocks: 'укрепления, меньше налётов', tier: 4 },
];
