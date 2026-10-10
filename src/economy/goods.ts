// Товары экономики.
export type Good = 'grain' | 'flour' | 'bread' | 'meat' | 'hide' | 'leather' | 'wood' | 'planks' | 'stone' | 'ale' | 'tools' | 'goods';

export const GOODS: Good[] = ['grain', 'flour', 'bread', 'meat', 'hide', 'leather', 'wood', 'planks', 'stone', 'ale', 'tools', 'goods'];

export const GOOD_INFO: Record<Good, { name: string; plural: string; base: number; food: number }> = {
  grain: { name: 'зерно', plural: 'зерна', base: 0.6, food: 0 },
  flour: { name: 'мука', plural: 'муки', base: 0.9, food: 0 },
  bread: { name: 'хлеб', plural: 'хлеба', base: 1, food: 55 },
  meat: { name: 'мясо', plural: 'мяса', base: 2.5, food: 45 },
  hide: { name: 'шкуры', plural: 'шкур', base: 2, food: 0 },
  leather: { name: 'кожа', plural: 'кожи', base: 4, food: 0 },
  wood: { name: 'брёвна', plural: 'брёвен', base: 1.2, food: 0 },
  planks: { name: 'доски', plural: 'досок', base: 2, food: 0 },
  stone: { name: 'камень', plural: 'камня', base: 1.5, food: 0 },
  ale: { name: 'эль', plural: 'эля', base: 1, food: 10 },
  tools: { name: 'инструменты', plural: 'инструментов', base: 6, food: 0 },
  goods: { name: 'изделия', plural: 'изделий', base: 5, food: 0 },
};
