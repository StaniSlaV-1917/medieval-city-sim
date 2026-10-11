import { Tile, TILE_INFO } from './tiles';
import { Building, BuildingType, District } from './buildings';

export const enum PropType {
  Tree = 0,
  Pine = 1,
  Bush = 2,
  Rock = 3,
  Bench = 4,
  Barrel = 5,
  Crate = 6,
  Hay = 7,
  Torch = 8,
  Cross = 9,
  Stump = 10,
  Flowers = 11,
  Fence = 12,
  Log = 13,
  Cart = 14,
  Waterwheel = 15,
  Sign = 16,
  Lamp = 17,
  Reeds = 18,
  DeadTree = 19,
}

export interface Prop {
  type: PropType;
  x: number; // тайл
  y: number;
  /** Субтайловое смещение 0..1 */
  ox: number;
  oy: number;
  variant: number;
  /** Блокирует ли проход */
  solid: boolean;
  /** Тик появления (рост деревьев: пень → поросль → дерево) */
  born?: number;
}

/** Природные ресурсы на тайле (фаза 13) */
export const enum ResourceKind {
  None = 0,
  Stone = 1,
  Iron = 2,
  Clay = 3,
  Salt = 4,
  Peat = 5,
  Berries = 6,
  Mushrooms = 7,
  Herbs = 8,
  Fish = 9,
}

export const RESOURCE_NAMES: Record<number, string> = {
  [ResourceKind.None]: '—',
  [ResourceKind.Stone]: 'камень',
  [ResourceKind.Iron]: 'железная руда',
  [ResourceKind.Clay]: 'глина',
  [ResourceKind.Salt]: 'соль',
  [ResourceKind.Peat]: 'торф',
  [ResourceKind.Berries]: 'ягоды',
  [ResourceKind.Mushrooms]: 'грибы',
  [ResourceKind.Herbs]: 'травы',
  [ResourceKind.Fish]: 'рыба',
};

/** Скрытые ресурсы — нужно найти рудознатцем */
export const HIDDEN_RESOURCES = new Set<number>([ResourceKind.Iron, ResourceKind.Salt]);

/** Именованное угодье (участок земли, как в Manor Lords) */
export interface Parcel {
  id: number;
  name: string;
  cx: number;
  cy: number;
}

export interface Gate {
  x: number; // центр ворот (тайл)
  y: number;
  dir: 0 | 1 | 2 | 3; // 0=восток 1=юг 2=запад 3=север
  name: string;
}

export interface POI {
  cx: number; // центр города (центр площади)
  cy: number;
  square: { x: number; y: number; w: number; h: number };
  wellX: number;
  wellY: number;
  gates: Gate[];
  bridge: { x: number; y: number };
  benches: { x: number; y: number }[];
  /** Точки, где жители «гуляют» (площадь, набережная, у ворот) */
  strollSpots: { x: number; y: number; name: string }[];
  castleHill: { x: number; y: number; r: number };
  riverCenterX: number[]; // центр реки по строкам
}

export interface World {
  w: number;
  h: number;
  seed: number;
  seedText: string;
  sizeName: string;
  tiles: Uint8Array;
  /** Высота 0..1 (холм) */
  height: Float32Array;
  /** Квартал по тайлу */
  district: Uint8Array;
  /** Внутри стен */
  inside: Uint8Array;
  /** id здания на тайле или -1 */
  buildingAt: Int16Array;
  /** Индекс пропа, блокирующего тайл, или -1 */
  solidProp: Int16Array;
  buildings: Building[];
  props: Prop[];
  poi: POI;
  /** Направление и сила ветра (радианы, 0..1) */
  wind: { dir: number; strength: number };
  /** Плодородие почвы 0..1 (фаза 13) */
  fertility: Float32Array;
  /** Вид ресурса на тайле и его остаток */
  resource: Uint8Array;
  resourceAmount: Uint16Array;
  /** Ресурс обнаружен (железо и соль скрыты, пока их не найдёт рудознатец) */
  discovered: Uint8Array;
  /** Индекс угодья по тайлу */
  parcel: Uint8Array;
  parcels: Parcel[];
  /** Туман неизведанного: 1 — тайл разведан */
  explored: Uint8Array;
  /** Включён ли туман (опция новой игры) */
  fog: boolean;
  /** Размер города (генератор) и карты */
  cityTiles: number;
}

export function idx(world: World, x: number, y: number): number {
  return y * world.w + x;
}

export function inBounds(world: World, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < world.w && y < world.h;
}

export function tileAt(world: World, x: number, y: number): Tile {
  if (!inBounds(world, x, y)) return Tile.Water;
  return world.tiles[y * world.w + x] as Tile;
}

export function setTile(world: World, x: number, y: number, t: Tile): void {
  if (inBounds(world, x, y)) world.tiles[y * world.w + x] = t;
}

/** Стоимость прохода по тайлу с учётом зданий и пропов */
export function moveCost(world: World, x: number, y: number): number {
  if (!inBounds(world, x, y)) return Infinity;
  const i = y * world.w + x;
  if (world.buildingAt[i] >= 0) return Infinity;
  if (world.solidProp[i] >= 0) return Infinity;
  return TILE_INFO[world.tiles[i]].cost;
}

export function isWalkableAt(world: World, x: number, y: number): boolean {
  return moveCost(world, x, y) !== Infinity;
}

/** Вода: река, озеро, мелководье */
export function isWaterTile(t: Tile): boolean {
  return t === Tile.Water || t === Tile.Shallow || t === Tile.Lake;
}

export function parcelAt(world: World, x: number, y: number): Parcel | null {
  if (!inBounds(world, x, y) || !world.parcels.length) return null;
  return world.parcels[world.parcel[y * world.w + x]] ?? null;
}

export function isRoadTile(t: Tile): boolean {
  return t === Tile.Road || t === Tile.Dirt || t === Tile.Plaza || t === Tile.Bridge || t === Tile.Gate;
}

export function buildingAt(world: World, x: number, y: number): Building | null {
  if (!inBounds(world, x, y)) return null;
  const id = world.buildingAt[y * world.w + x];
  return id >= 0 ? world.buildings[id] : null;
}

export function buildingsOfType(world: World, type: BuildingType): Building[] {
  const out: Building[] = [];
  for (const b of world.buildings) if (b.type === type) out.push(b);
  return out;
}

export function findNearestBuilding(world: World, type: BuildingType, x: number, y: number): Building | null {
  let best: Building | null = null;
  let bestD = Infinity;
  for (const b of world.buildings) {
    if (b.type !== type) continue;
    const dx = b.doorX - x;
    const dy = b.doorY - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

export function districtAt(world: World, x: number, y: number): District {
  if (!inBounds(world, x, y)) return District.Outskirts;
  return world.district[y * world.w + x] as District;
}

/** Ближайший проходимый тайл к (x,y) в радиусе r (спираль) */
export function nearestWalkable(world: World, x: number, y: number, r = 6): { x: number; y: number } | null {
  x = Math.round(x);
  y = Math.round(y);
  if (isWalkableAt(world, x, y)) return { x, y };
  for (let d = 1; d <= r; d++) {
    for (let dx = -d; dx <= d; dx++) {
      for (let dy = -d; dy <= d; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
        if (isWalkableAt(world, x + dx, y + dy)) return { x: x + dx, y: y + dy };
      }
    }
  }
  return null;
}
