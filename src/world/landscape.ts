// Ландшафт и природные ресурсы большой карты (фаза 13): притоки, озёра, болота, холмы, плодородие,
// месторождения, дичь-ягоды-грибы-травы, рыба, именованные угодья, туман неизведанного.
import { RNG } from '../core/rng';
import { Noise2D } from '../core/noise';
import { Tile } from './tiles';
import { World, PropType, ResourceKind, idx, inBounds, isWaterTile, isRoadTile } from './world';

export interface LandCtx {
  world: World;
  rng: RNG;
  noise: Noise2D;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Тайлы ручьёв (не главной реки) — дороги через них становятся мостами */
  stream: Uint8Array;
}

function rhoOf(c: LandCtx, x: number, y: number): number {
  const dx = (x + 0.5 - c.cx) / c.rx;
  const dy = (y + 0.5 - c.cy) / c.ry;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Притоки, озёра, болота и холмы — до размещения города */
export function genLandscape(c: LandCtx): void {
  const { world, rng, noise } = c;
  const W = world.w;
  const H = world.h;
  // Холмы: мягкий рельеф по шуму, сильнее к краям карты
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y) / (W * 0.25);
      const v = noise.fbm(x / 48 + 7.1, y / 48 + 3.3, 3);
      const h = Math.max(0, v - 0.55) * 1.6 * (1 - Math.min(1, edge) * 0.5) * Math.min(1, Math.max(0, rhoOf(c, x, y) - 1.3));
      world.height[y * W + x] = Math.min(0.8, h);
    }
  // Притоки: 1–2 ручья с западного края к главной реке
  const streams = W >= 200 ? 2 : 1;
  for (let s = 0; s < streams; s++) {
    let y = rng.int(Math.round(H * 0.15), Math.round(H * 0.85));
    const amp = rng.float(0.4, 0.9);
    const ph = rng.float(0, 10);
    for (let x = 0; x < W; x++) {
      const rc = world.poi.riverCenterX[Math.max(0, Math.min(H - 1, Math.round(y)))];
      if (x >= rc - 1) break;
      y += Math.sin(x / 9 + ph) * amp + (noise.value(x / 5, s * 11.7) - 0.5) * 1.2;
      const yi = Math.round(y);
      for (let dy = 0; dy <= 1; dy++) {
        const yy = yi + dy;
        if (!inBounds(world, x, yy)) continue;
        const i = idx(world, x, yy);
        if (world.tiles[i] === Tile.Water) continue;
        world.tiles[i] = Tile.Water;
        c.stream[i] = 1;
      }
      for (const yy of [yi - 1, yi + 2]) if (inBounds(world, x, yy) && world.tiles[idx(world, x, yy)] === Tile.Grass && rng.chance(0.5)) world.tiles[idx(world, x, yy)] = Tile.Sand;
    }
  }
  // Озёра: 1–3 пятна вдали от города
  const lakes = W >= 300 ? 3 : W >= 200 ? 2 : 1;
  let placed = 0;
  for (let t = 0; t < 300 && placed < lakes; t++) {
    const lx = rng.int(10, W - 11);
    const ly = rng.int(10, H - 11);
    if (rhoOf(c, lx, ly) < 2.3) continue;
    if (isWaterTile(world.tiles[idx(world, lx, ly)] as Tile)) continue;
    const r = rng.float(4, Math.min(9, W / 28));
    let bad = false;
    for (let y = ly - r - 3; y <= ly + r + 3 && !bad; y++) for (let x = lx - r - 3; x <= lx + r + 3; x++) if (inBounds(world, x, y) && isWaterTile(world.tiles[idx(world, x, y)] as Tile)) bad = true;
    if (bad) continue;
    for (let y = Math.floor(ly - r - 2); y <= ly + r + 2; y++)
      for (let x = Math.floor(lx - r - 2); x <= lx + r + 2; x++) {
        if (!inBounds(world, x, y)) continue;
        const d = Math.hypot((x - lx) / r, (y - ly) / (r * 0.8)) + (noise.value(x / 5 + 40, y / 5 + 40) - 0.5) * 0.5;
        const i = idx(world, x, y);
        if (d < 0.9) world.tiles[i] = Tile.Lake;
        else if (d < 1.05) world.tiles[i] = Tile.Shallow;
        else if (d < 1.35 && rng.chance(0.7)) world.tiles[i] = Tile.Swamp;
      }
    placed++;
  }
  // Болота: низины по шуму вдали от города, в основном у воды
  for (let y = 2; y < H - 2; y++)
    for (let x = 2; x < W - 2; x++) {
      const i = idx(world, x, y);
      if (world.tiles[i] !== Tile.Grass && world.tiles[i] !== Tile.Meadow) continue;
      if (rhoOf(c, x, y) < 1.9) continue;
      const v = noise.fbm(x / 17 + 90, y / 17 + 90, 2);
      let nearWater = false;
      for (let dy = -3; dy <= 3 && !nearWater; dy++) for (let dx = -3; dx <= 3; dx++) if (inBounds(world, x + dx, y + dy) && isWaterTile(world.tiles[idx(world, x + dx, y + dy)] as Tile)) nearWater = true;
      if (v > (nearWater ? 0.58 : 0.7) && world.height[i] < 0.1) world.tiles[i] = Tile.Swamp;
    }
}

/** Плодородие: шум + близость воды, минус болота/камень/песок */
export function genFertility(c: LandCtx): void {
  const { world, noise } = c;
  const W = world.w;
  const H = world.h;
  // расстояние до воды (BFS до 6)
  const dist = new Uint8Array(W * H).fill(255);
  const q: number[] = [];
  for (let i = 0; i < W * H; i++) if (isWaterTile(world.tiles[i] as Tile)) {
    dist[i] = 0;
    q.push(i);
  }
  for (let qi = 0; qi < q.length; qi++) {
    const cur = q[qi];
    const d = dist[cur];
    if (d >= 6) continue;
    const x = cur % W;
    const y = (cur / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (dist[ni] > d + 1) {
        dist[ni] = d + 1;
        q.push(ni);
      }
    }
  }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let f = 0.3 + noise.fbm(x / 33 + 200, y / 33 + 200, 3) * 0.65;
      if (dist[i] <= 5) f += (6 - dist[i]) * 0.04;
      const t = world.tiles[i] as Tile;
      if (t === Tile.Meadow) f += 0.1;
      if (t === Tile.Swamp) f -= 0.35;
      if (t === Tile.Rock || t === Tile.Quarry || t === Tile.Sand) f -= 0.5;
      f -= world.height[i] * 0.4;
      world.fertility[i] = Math.max(0.05, Math.min(1, f));
    }
}

function setRes(world: World, i: number, kind: ResourceKind, amount: number, discovered = true): void {
  world.resource[i] = kind;
  world.resourceAmount[i] = Math.min(65535, Math.round(amount));
  world.discovered[i] = discovered ? 1 : 0;
}

/** Месторождения, дары леса и рыба — после застройки окрестностей */
export function genResources(c: LandCtx): void {
  const { world, rng, noise } = c;
  const W = world.w;
  const H = world.h;
  // Камень в скалах и каменоломне
  for (let i = 0; i < W * H; i++) {
    const t = world.tiles[i] as Tile;
    if (t === Tile.Rock) setRes(world, i, ResourceKind.Stone, rng.int(150, 400));
    else if (t === Tile.Quarry) setRes(world, i, ResourceKind.Stone, rng.int(80, 200));
    else if (t === Tile.Swamp) setRes(world, i, ResourceKind.Peat, rng.int(20, 60));
    else if (isWaterTile(t)) setRes(world, i, ResourceKind.Fish, t === Tile.Lake ? rng.int(10, 25) : rng.int(4, 14));
  }
  const freeSpot = (minRho: number, r: number, allowForest: boolean): { x: number; y: number } | null => {
    for (let t = 0; t < 400; t++) {
      const x = rng.int(r + 2, W - r - 3);
      const y = rng.int(r + 2, H - r - 3);
      if (rhoOf(c, x, y) < minRho) continue;
      let ok = true;
      for (let yy = y - r; yy <= y + r && ok; yy++)
        for (let xx = x - r; xx <= x + r; xx++) {
          const i = idx(world, xx, yy);
          const tt = world.tiles[i] as Tile;
          if (world.inside[i] || world.buildingAt[i] >= 0 || isRoadTile(tt) || isWaterTile(tt) || tt === Tile.Field || tt === Tile.Cemetery || tt === Tile.Rock || tt === Tile.Quarry || tt === Tile.Swamp) ok = false;
          else if (!allowForest && tt === Tile.Forest) ok = false;
        }
      if (ok) return { x, y };
    }
    return null;
  };
  const clearProps = (x: number, y: number, r: number): void => {
    world.props = world.props.filter((p) => Math.abs(p.x - x) > r || Math.abs(p.y - y) > r);
  };
  // Железные жилы (скрыты): скалистые пятна вдали
  const veins = W >= 300 ? 2 : 1;
  for (let v = 0; v < veins; v++) {
    const s = freeSpot(2.0, 4, true);
    if (!s) break;
    clearProps(s.x, s.y, 4);
    for (let yy = s.y - 4; yy <= s.y + 4; yy++)
      for (let xx = s.x - 4; xx <= s.x + 4; xx++) {
        const d = Math.hypot(xx - s.x, (yy - s.y) * 1.2) + (noise.value(xx / 3 + 70, yy / 3 + 70) - 0.5) * 1.5;
        const i = idx(world, xx, yy);
        if (d < 2.2) {
          world.tiles[i] = Tile.Rock;
          setRes(world, i, ResourceKind.Iron, rng.int(300, 700), false);
        } else if (d < 3.6) {
          world.tiles[i] = Tile.Rock;
          setRes(world, i, ResourceKind.Stone, rng.int(100, 250));
        }
      }
  }
  // Глина: у реки и озёр
  const clays = W >= 200 ? 3 : 2;
  let placedClay = 0;
  for (let t = 0; t < 400 && placedClay < clays; t++) {
    const x = rng.int(4, W - 5);
    const y = rng.int(4, H - 5);
    const i = idx(world, x, y);
    const tt = world.tiles[i] as Tile;
    if (world.inside[i] || (tt !== Tile.Grass && tt !== Tile.Sand && tt !== Tile.Meadow) || world.buildingAt[i] >= 0) continue;
    let nearWater = false;
    for (let dy = -3; dy <= 3 && !nearWater; dy++) for (let dx = -3; dx <= 3; dx++) if (inBounds(world, x + dx, y + dy) && isWaterTile(world.tiles[idx(world, x + dx, y + dy)] as Tile)) nearWater = true;
    if (!nearWater || rhoOf(c, x, y) < 1.3) continue;
    clearProps(x, y, 2);
    for (let yy = y - 2; yy <= y + 2; yy++)
      for (let xx = x - 2; xx <= x + 2; xx++) {
        const j = idx(world, xx, yy);
        const t2 = world.tiles[j] as Tile;
        if ((t2 === Tile.Grass || t2 === Tile.Sand || t2 === Tile.Meadow || t2 === Tile.Forest) && world.buildingAt[j] < 0 && !isRoadTile(t2) && Math.hypot(xx - x, yy - y) < 2.3) {
          world.tiles[j] = Tile.Clay;
          setRes(world, j, ResourceKind.Clay, rng.int(150, 400));
        }
      }
    placedClay++;
  }
  // Соль (скрыта): один солончак у болота или озера; тайл меняется при открытии
  {
    const s = freeSpot(2.2, 2, false);
    if (s) for (let yy = s.y - 2; yy <= s.y + 2; yy++) for (let xx = s.x - 2; xx <= s.x + 2; xx++) if (Math.hypot(xx - s.x, yy - s.y) < 2.3) setRes(world, idx(world, xx, yy), ResourceKind.Salt, rng.int(150, 350), false);
  }
  // Ягоды на опушках, грибы в чаще, травы на лугах
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = idx(world, x, y);
      if (world.resource[i]) continue;
      const t = world.tiles[i] as Tile;
      if (t === Tile.Forest) {
        let edge = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const t2 = world.tiles[idx(world, x + dx, y + dy)] as Tile;
          if (t2 === Tile.Grass || t2 === Tile.Meadow) edge = true;
        }
        if (edge && rng.chance(0.18)) {
          setRes(world, i, ResourceKind.Berries, rng.int(10, 30));
          const p = world.props.find((pp) => pp.x === x && pp.y === y);
          if (p) {
            p.type = PropType.Bush;
            p.variant = 3;
            p.solid = false;
          }
        } else if (!edge && rng.chance(0.06)) setRes(world, i, ResourceKind.Mushrooms, rng.int(5, 15));
      } else if (t === Tile.Meadow && !world.inside[i] && rng.chance(0.08)) setRes(world, i, ResourceKind.Herbs, rng.int(5, 15));
    }
}

const ADJ = ['Ольховый', 'Каменный', 'Чёрный', 'Светлый', 'Медвежий', 'Волчий', 'Еловый', 'Сухой', 'Мокрый', 'Старый', 'Долгий', 'Тихий', 'Крутой', 'Берёзовый', 'Дубовый', 'Лисий', 'Журавлиный', 'Ржаной', 'Ветреный', 'Глухой', 'Козий', 'Вороний', 'Сосновый', 'Ивовый'];
const NOUN = ['лог', 'яр', 'холм', 'луг', 'бор', 'дол', 'увал', 'ключ', 'мыс', 'откос', 'перелесок', 'выгон', 'ручей', 'курган', 'угол'];

/** Именованные угодья: Вороной по случайным точкам, слегка искажённый шумом */
export function genParcels(c: LandCtx): void {
  const { world, rng, noise } = c;
  const W = world.w;
  const H = world.h;
  const k = Math.max(10, Math.min(40, Math.round((W * H) / 4200)));
  const seeds: { x: number; y: number }[] = [];
  for (let t = 0; t < k * 20 && seeds.length < k; t++) {
    const x = rng.int(4, W - 5);
    const y = rng.int(4, H - 5);
    if (rhoOf(c, x, y) < 1.15) continue;
    if (seeds.some((s) => Math.hypot(s.x - x, s.y - y) < W / Math.sqrt(k) * 0.6)) continue;
    seeds.push({ x, y });
  }
  world.parcels = [{ id: 0, name: 'Городская земля', cx: c.cx, cy: c.cy }];
  const used = new Set<string>();
  seeds.forEach((s, n) => {
    let name = '';
    for (let t = 0; t < 30; t++) {
      name = `${rng.pick(ADJ)} ${rng.pick(NOUN)}`;
      if (!used.has(name)) break;
    }
    used.add(name);
    world.parcels.push({ id: n + 1, name, cx: s.x, cy: s.y });
  });
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (rhoOf(c, x, y) < 1.12) {
        world.parcel[i] = 0;
        continue;
      }
      let best = 0;
      let bd = Infinity;
      const jx = (noise.value(x / 9 + 300, y / 9 + 300) - 0.5) * 8;
      const jy = (noise.value(x / 9 + 500, y / 9 + 500) - 0.5) * 8;
      for (let n = 0; n < seeds.length; n++) {
        const d = Math.hypot(seeds[n].x - x - jx, seeds[n].y - y - jy);
        if (d < bd) {
          bd = d;
          best = n + 1;
        }
      }
      world.parcel[i] = best;
    }
}

/** Туман неизведанного: разведаны город и ближайшие окрестности */
export function initExplored(c: LandCtx, fog: boolean): void {
  const { world } = c;
  world.fog = fog;
  if (!fog) {
    world.explored.fill(1);
    return;
  }
  for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) world.explored[y * world.w + x] = rhoOf(c, x, y) < 1.45 ? 1 : 0;
}

/** Открыть тайлы в радиусе r вокруг точки; возвращает, были ли новые */
export function reveal(world: World, x: number, y: number, r: number): boolean {
  if (!world.fog) return false;
  let any = false;
  const r2 = r * r;
  for (let yy = Math.max(0, y - r); yy <= Math.min(world.h - 1, y + r); yy++)
    for (let xx = Math.max(0, x - r); xx <= Math.min(world.w - 1, x + r); xx++) {
      if ((xx - x) * (xx - x) + (yy - y) * (yy - y) > r2) continue;
      const i = yy * world.w + xx;
      if (!world.explored[i]) {
        world.explored[i] = 1;
        any = true;
      }
    }
  return any;
}

/** Статистика угодья для окна Региона */
export function parcelStats(world: World, id: number): { tiles: number; fertility: number; forest: number; stone: number; iron: number; clay: number; salt: number; peat: number; berries: number; fish: number; hiddenIron: boolean; hiddenSalt: boolean; explored: number } {
  const s = { tiles: 0, fertility: 0, forest: 0, stone: 0, iron: 0, clay: 0, salt: 0, peat: 0, berries: 0, fish: 0, hiddenIron: false, hiddenSalt: false, explored: 0 };
  for (let i = 0; i < world.w * world.h; i++) {
    if (world.parcel[i] !== id) continue;
    s.tiles++;
    s.fertility += world.fertility[i];
    if (world.explored[i]) s.explored++;
    if (world.tiles[i] === Tile.Forest) s.forest++;
    const r = world.resource[i];
    const a = world.resourceAmount[i];
    if (!r) continue;
    const known = world.discovered[i] === 1;
    if (r === ResourceKind.Stone) s.stone += a;
    else if (r === ResourceKind.Iron) {
      if (known) s.iron += a;
      else s.hiddenIron = true;
    } else if (r === ResourceKind.Clay) s.clay += a;
    else if (r === ResourceKind.Salt) {
      if (known) s.salt += a;
      else s.hiddenSalt = true;
    } else if (r === ResourceKind.Peat) s.peat += a;
    else if (r === ResourceKind.Berries || r === ResourceKind.Mushrooms || r === ResourceKind.Herbs) s.berries += a;
    else if (r === ResourceKind.Fish) s.fish += a;
  }
  if (s.tiles) s.fertility /= s.tiles;
  return s;
}

/** Для старых сохранений без природных данных: плодородие, ресурсы, угодья по уже готовой карте */
export function regenerateNature(world: World): void {
  const rng = new RNG(world.seed ^ 0x1234567);
  const noise = new Noise2D(world.seed ^ 0x5bd1e995);
  const city = world.cityTiles || world.w;
  const c: LandCtx = { world, rng, noise, cx: world.poi.cx, cy: world.poi.cy, rx: Math.round(city * 0.215), ry: Math.round(city * 0.235), stream: new Uint8Array(world.w * world.h) };
  world.resource.fill(0);
  world.resourceAmount.fill(0);
  world.discovered.fill(0);
  genFertility(c);
  genResources(c);
  genParcels(c);
  initExplored(c, world.fog);
}
