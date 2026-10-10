// Типы тайлов карты и их свойства.
export const enum Tile {
  Grass = 0,
  Dirt = 1, // утоптанная земля / просёлочная дорога
  Road = 2, // мощёная улица
  Plaza = 3, // площадь
  Water = 4,
  Bridge = 5,
  Wall = 6,
  Gate = 7,
  Field = 8, // вспаханное поле
  Forest = 9, // лес (деревья — отдельные объекты, тайл непроходим)
  Rock = 10, // скалы
  Sand = 11, // берег
  Floor = 12, // внутренность здания
  Garden = 13, // сад/двор
  Cemetery = 14, // кладбище
  Shallow = 15, // мелководье у берега
  Tower = 16, // башня стены
  Quarry = 17, // каменоломня (проходима)
  Mud = 18, // грязь (трущобы)
  Meadow = 19, // луг с цветами
}

export const TILE_COUNT = 20;

export interface TileInfo {
  name: string;
  /** Стоимость прохода; Infinity — непроходимо */
  cost: number;
  buildable: boolean;
}

export const TILE_INFO: Record<number, TileInfo> = {
  [Tile.Grass]: { name: 'Трава', cost: 1.6, buildable: true },
  [Tile.Dirt]: { name: 'Просёлок', cost: 1.15, buildable: false },
  [Tile.Road]: { name: 'Улица', cost: 1.0, buildable: false },
  [Tile.Plaza]: { name: 'Площадь', cost: 1.0, buildable: false },
  [Tile.Water]: { name: 'Река', cost: Infinity, buildable: false },
  [Tile.Bridge]: { name: 'Мост', cost: 1.0, buildable: false },
  [Tile.Wall]: { name: 'Стена', cost: Infinity, buildable: false },
  [Tile.Gate]: { name: 'Ворота', cost: 1.0, buildable: false },
  [Tile.Field]: { name: 'Поле', cost: 2.2, buildable: false },
  [Tile.Forest]: { name: 'Лес', cost: Infinity, buildable: false },
  [Tile.Rock]: { name: 'Скалы', cost: Infinity, buildable: false },
  [Tile.Sand]: { name: 'Берег', cost: 1.5, buildable: false },
  [Tile.Floor]: { name: 'Здание', cost: Infinity, buildable: false },
  [Tile.Garden]: { name: 'Двор', cost: 1.8, buildable: false },
  [Tile.Cemetery]: { name: 'Кладбище', cost: 1.7, buildable: false },
  [Tile.Shallow]: { name: 'Мелководье', cost: Infinity, buildable: false },
  [Tile.Tower]: { name: 'Башня', cost: Infinity, buildable: false },
  [Tile.Quarry]: { name: 'Каменоломня', cost: 2.5, buildable: false },
  [Tile.Mud]: { name: 'Грязь', cost: 1.4, buildable: true },
  [Tile.Meadow]: { name: 'Луг', cost: 1.7, buildable: true },
};

export function isWalkable(t: Tile): boolean {
  return TILE_INFO[t].cost !== Infinity;
}
