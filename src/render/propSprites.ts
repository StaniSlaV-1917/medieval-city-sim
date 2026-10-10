// Спрайты пропов: деревья, кусты, камни, скамейки, факелы и т.п.
import { PropType } from '../world/world';
import { Season } from '../core/time';
import { SEASON_PALETTES, rgb, shade, RGB } from './palette';
import { Atlas, SpriteRef, hash2 } from './atlas';

const atlas = new Atlas(1024);
const cache = new Map<string, SpriteRef>();

export function getPropSprite(type: PropType, variant: number, season: Season): SpriteRef {
  const key = `${type}:${variant}:${season}`;
  let s = cache.get(key);
  if (s) return s;
  s = build(type, variant, season);
  cache.set(key, s);
  return s;
}

function build(type: PropType, variant: number, season: Season): SpriteRef {
  const pal = SEASON_PALETTES[season];
  switch (type) {
    case PropType.Tree:
      return tree(variant, pal.canopy[variant % pal.canopy.length], pal.snow, season);
    case PropType.Pine:
      return pine(variant, pal.pine, pal.snow);
    case PropType.DeadTree:
      return deadTree(variant);
    case PropType.Bush:
      return bush(variant, pal.canopy[(variant + 1) % pal.canopy.length], pal.snow);
    case PropType.Rock:
      return rock(variant);
    case PropType.Bench:
      return bench();
    case PropType.Barrel:
      return barrel();
    case PropType.Crate:
      return crate();
    case PropType.Hay:
      return hay(pal.snow);
    case PropType.Torch:
      return torch();
    case PropType.Lamp:
      return lamp();
    case PropType.Cross:
      return cross(variant);
    case PropType.Stump:
      return stump();
    case PropType.Flowers:
      return flowers(variant, pal.flowers);
    case PropType.Fence:
      return fence(variant);
    case PropType.Log:
      return log();
    case PropType.Cart:
      return cart();
    case PropType.Waterwheel:
      return waterwheel();
    case PropType.Sign:
      return signpost();
    case PropType.Reeds:
      return reeds(variant, pal.snow);
  }
}

function tree(variant: number, canopy: RGB, snow: boolean, season: Season): SpriteRef {
  const ref = atlas.alloc(18, 24, 9, 23);
  const g = atlas.g;
  const x = ref.x;
  const y = ref.y;
  // тень
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(x + 4, y + 21, 10, 2);
  // ствол
  g.fillStyle = '#5a3d22';
  g.fillRect(x + 8, y + 12, 3, 11);
  g.fillStyle = '#7a5a3a';
  g.fillRect(x + 9, y + 12, 1, 11);
  if (season === Season.Winter && variant % 2 === 0) {
    // голые ветки
    g.fillStyle = '#5a3d22';
    g.fillRect(x + 5, y + 8, 9, 1);
    g.fillRect(x + 4, y + 5, 1, 4);
    g.fillRect(x + 13, y + 4, 1, 5);
    g.fillRect(x + 9, y + 3, 1, 9);
    g.fillRect(x + 6, y + 6, 1, 3);
    g.fillRect(x + 12, y + 7, 1, 2);
    g.fillStyle = 'rgba(240,245,250,0.9)';
    g.fillRect(x + 5, y + 7, 9, 1);
    g.fillRect(x + 9, y + 2, 1, 1);
    return ref;
  }
  // крона — несколько кругов
  const c1 = rgb(canopy);
  const c2 = rgb(shade(canopy, 0.78));
  const c3 = rgb(shade(canopy, 1.18));
  const blobs = [
    [9, 8, 7],
    [5, 10, 5],
    [13, 10, 5],
    [9, 4, 5],
  ];
  const k = (variant * 7) % 3;
  for (let i = 0; i < blobs.length; i++) {
    const [bx, by, r] = blobs[i];
    const rr = r + ((i + k) % 2 === 0 ? 0 : -1);
    fillCircle(g, x + bx, y + by, rr, c2);
  }
  for (let i = 0; i < blobs.length; i++) {
    const [bx, by, r] = blobs[i];
    const rr = r - 1 + ((i + k) % 2 === 0 ? 0 : -1);
    fillCircle(g, x + bx - 1, y + by - 1, rr, c1);
  }
  // блики
  g.fillStyle = c3;
  g.fillRect(x + 6, y + 5, 2, 1);
  g.fillRect(x + 10, y + 3, 2, 1);
  g.fillRect(x + 4, y + 9, 1, 1);
  if (snow) {
    g.fillStyle = 'rgba(240,245,250,0.85)';
    g.fillRect(x + 6, y + 2, 6, 2);
    g.fillRect(x + 3, y + 7, 4, 1);
    g.fillRect(x + 11, y + 7, 4, 1);
  }
  return ref;
}

function pine(variant: number, col: RGB, snow: boolean): SpriteRef {
  const ref = atlas.alloc(16, 26, 8, 25);
  const g = atlas.g;
  const x = ref.x;
  const y = ref.y;
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(x + 4, y + 23, 8, 2);
  g.fillStyle = '#4a3220';
  g.fillRect(x + 7, y + 16, 2, 9);
  const dark = rgb(shade(col, 0.75));
  const light = rgb(shade(col, 1.15));
  const layers = 4 + (variant % 2);
  for (let l = 0; l < layers; l++) {
    const ly = y + 4 + l * 4;
    const half = 2 + l * 1.4;
    for (let r = 0; r < 4; r++) {
      const ww = Math.round(half * 2 * ((r + 1) / 4));
      g.fillStyle = r < 2 ? rgb(col) : dark;
      g.fillRect(x + 8 - Math.floor(ww / 2), ly + r, ww, 1);
    }
    g.fillStyle = light;
    g.fillRect(x + 8 - Math.floor(half / 2), ly + 1, 1, 1);
    if (snow) {
      g.fillStyle = 'rgba(240,245,250,0.9)';
      g.fillRect(x + 8 - Math.floor(half / 2), ly, Math.floor(half) + 1, 1);
    }
  }
  g.fillStyle = rgb(col);
  g.fillRect(x + 8, y + 2, 1, 3);
  return ref;
}

function deadTree(variant: number): SpriteRef {
  const ref = atlas.alloc(14, 22, 7, 21);
  const g = atlas.g;
  const x = ref.x;
  const y = ref.y;
  g.fillStyle = '#4a3a2a';
  g.fillRect(x + 6, y + 6, 2, 15);
  g.fillRect(x + 3, y + 5, 4, 1);
  g.fillRect(x + 2, y + 2, 1, 4);
  g.fillRect(x + 8, y + 3, 4, 1);
  g.fillRect(x + 11, y + 1, 1, 3);
  void variant;
  return ref;
}

function bush(variant: number, col: RGB, snow: boolean): SpriteRef {
  const ref = atlas.alloc(12, 9, 6, 8);
  const g = atlas.g;
  const x = ref.x;
  const y = ref.y;
  fillCircle(g, x + 4, y + 5, 3, rgb(shade(col, 0.8)));
  fillCircle(g, x + 8, y + 5, 3, rgb(shade(col, 0.8)));
  fillCircle(g, x + 6, y + 3, 3, rgb(col));
  g.fillStyle = rgb(shade(col, 1.2));
  g.fillRect(x + 5, y + 2, 1, 1);
  if (variant % 3 === 0) {
    g.fillStyle = '#c03040';
    g.fillRect(x + 3, y + 4, 1, 1);
    g.fillRect(x + 8, y + 3, 1, 1);
  }
  if (snow) {
    g.fillStyle = 'rgba(240,245,250,0.85)';
    g.fillRect(x + 4, y + 1, 5, 1);
  }
  return ref;
}

function rock(variant: number): SpriteRef {
  const ref = atlas.alloc(12, 8, 6, 7);
  const g = atlas.g;
  const x = ref.x;
  const y = ref.y;
  g.fillStyle = '#6a6560';
  g.fillRect(x + 2, y + 2, 8, 5);
  g.fillStyle = '#8a857e';
  g.fillRect(x + 3, y + 1, 5, 3);
  g.fillStyle = '#4e4945';
  g.fillRect(x + 2, y + 6, 8, 1);
  void variant;
  return ref;
}

function bench(): SpriteRef {
  const ref = atlas.alloc(14, 8, 7, 7);
  const g = atlas.g;
  const x = ref.x;
  const y = ref.y;
  g.fillStyle = '#7a5a3a';
  g.fillRect(x + 1, y + 2, 12, 3);
  g.fillStyle = '#5a3d22';
  g.fillRect(x + 2, y + 5, 2, 2);
  g.fillRect(x + 10, y + 5, 2, 2);
  g.fillStyle = '#9a7a5a';
  g.fillRect(x + 1, y + 2, 12, 1);
  return ref;
}

function barrel(): SpriteRef {
  const ref = atlas.alloc(8, 9, 4, 8);
  const g = atlas.g;
  const x = ref.x;
  const y = ref.y;
  g.fillStyle = '#8a6239';
  g.fillRect(x + 1, y + 1, 6, 7);
  g.fillStyle = '#4a3a2a';
  g.fillRect(x + 1, y + 2, 6, 1);
  g.fillRect(x + 1, y + 6, 6, 1);
  g.fillStyle = '#a07a4a';
  g.fillRect(x + 3, y + 1, 1, 7);
  return ref;
}

function crate(): SpriteRef {
  const ref = atlas.alloc(9, 8, 4, 7);
  const g = atlas.g;
  const x = ref.x;
  const y = ref.y;
  g.fillStyle = '#a07a4a';
  g.fillRect(x + 1, y + 1, 7, 6);
  g.fillStyle = '#6a4a2a';
  g.fillRect(x + 1, y + 1, 7, 1);
  g.fillRect(x + 1, y + 6, 7, 1);
  g.fillRect(x + 1, y + 1, 1, 6);
  g.fillRect(x + 7, y + 1, 1, 6);
  g.fillRect(x + 4, y + 1, 1, 6);
  return ref;
}

function hay(snow: boolean): SpriteRef {
  const ref = atlas.alloc(14, 12, 7, 11);
  const g = atlas.g;
  const x = ref.x;
  const y = ref.y;
  fillCircle(g, x + 7, y + 6, 5, '#b8963a');
  g.fillStyle = '#d9b24a';
  g.fillRect(x + 4, y + 3, 4, 1);
  g.fillStyle = '#8a6a20';
  g.fillRect(x + 3, y + 8, 8, 1);
  if (snow) {
    g.fillStyle = 'rgba(240,245,250,0.85)';
    g.fillRect(x + 4, y + 1, 6, 2);
  }
  return ref;
}

function torch(): SpriteRef {
  const ref = atlas.alloc(6, 16, 3, 15);
  const g = atlas.g;
  const x = ref.x;
  const y = ref.y;
  g.fillStyle = '#5a3d22';
  g.fillRect(x + 2, y + 5, 2, 10);
  g.fillStyle = '#3a2a1a';
  g.fillRect(x + 1, y + 4, 4, 2);
  g.fillStyle = '#ff9a2a';
  g.fillRect(x + 1, y + 1, 4, 3);
  g.fillStyle = '#ffe070';
  g.fillRect(x + 2, y + 2, 2, 2);
  return ref;
}

function lamp(): SpriteRef {
  const ref = atlas.alloc(8, 20, 4, 19);
  const g = atlas.g;
  const x = ref.x;
  const y = ref.y;
  g.fillStyle = '#2e2a26';
  g.fillRect(x + 3, y + 6, 2, 13);
  g.fillRect(x + 2, y + 18, 4, 1);
  g.fillStyle = '#4a4440';
  g.fillRect(x + 1, y + 1, 6, 6);
  g.fillStyle = '#ffd060';
  g.fillRect(x + 2, y + 2, 4, 4);
  g.fillStyle = '#2e2a26';
  g.fillRect(x + 2, y, 4, 1);
  return ref;
}

function cross(variant: number): SpriteRef {
  const ref = atlas.alloc(8, 12, 4, 11);
  const g = atlas.g;
  const x = ref.x;
  const y = ref.y;
  const col = variant === 0 ? '#8a857e' : variant === 1 ? '#6a4a2a' : '#9a958e';
  g.fillStyle = col;
  if (variant === 2) {
    g.fillRect(x + 2, y + 2, 4, 9);
    g.fillStyle = '#6a655e';
    g.fillRect(x + 3, y + 4, 2, 3);
  } else {
    g.fillRect(x + 3, y + 1, 2, 10);
    g.fillRect(x + 1, y + 3, 6, 2);
  }
  return ref;
}

function stump(): SpriteRef {
  const ref = atlas.alloc(8, 7, 4, 6);
  const g = atlas.g;
  const x = ref.x;
  const y = ref.y;
  g.fillStyle = '#5a3d22';
  g.fillRect(x + 1, y + 2, 6, 4);
  g.fillStyle = '#b8966a';
  g.fillRect(x + 1, y + 1, 6, 2);
  g.fillStyle = '#8a6a40';
  g.fillRect(x + 3, y + 1, 2, 1);
  return ref;
}

function flowers(variant: number, cols: RGB[]): SpriteRef {
  const ref = atlas.alloc(10, 6, 5, 5);
  const g = atlas.g;
  const x = ref.x;
  const y = ref.y;
  g.fillStyle = '#3f7a2a';
  g.fillRect(x + 2, y + 3, 1, 2);
  g.fillRect(x + 5, y + 2, 1, 3);
  g.fillRect(x + 8, y + 3, 1, 2);
  if (!cols.length) return ref;
  for (let i = 0; i < 3; i++) {
    g.fillStyle = rgb(cols[(variant + i) % cols.length]);
    g.fillRect(x + 1 + i * 3, y + 1 + (i % 2), 2, 2);
  }
  return ref;
}

function fence(variant: number): SpriteRef {
  const ref = atlas.alloc(16, 10, 8, 9);
  const g = atlas.g;
  const x = ref.x;
  const y = ref.y;
  g.fillStyle = '#7a5a3a';
  if (variant === 0) {
    g.fillRect(x, y + 3, 16, 1);
    g.fillRect(x, y + 6, 16, 1);
    g.fillStyle = '#5a3d22';
    for (let k = 1; k < 16; k += 5) g.fillRect(x + k, y + 1, 2, 8);
  } else {
    g.fillRect(x + 7, y, 2, 10);
    g.fillStyle = '#5a3d22';
    g.fillRect(x + 6, y + 2, 4, 1);
    g.fillRect(x + 6, y + 6, 4, 1);
  }
  return ref;
}

function log(): SpriteRef {
  const ref = atlas.alloc(14, 6, 7, 5);
  const g = atlas.g;
  const x = ref.x;
  const y = ref.y;
  g.fillStyle = '#6a4a2a';
  g.fillRect(x + 1, y + 1, 12, 4);
  g.fillStyle = '#b8966a';
  g.fillRect(x + 1, y + 1, 2, 4);
  g.fillStyle = '#8a6a40';
  g.fillRect(x + 3, y + 2, 10, 1);
  return ref;
}

function cart(): SpriteRef {
  const ref = atlas.alloc(16, 12, 8, 11);
  const g = atlas.g;
  const x = ref.x;
  const y = ref.y;
  g.fillStyle = '#8a6239';
  g.fillRect(x + 2, y + 3, 12, 5);
  g.fillStyle = '#5a3d22';
  g.fillRect(x + 2, y + 3, 12, 1);
  g.fillRect(x + 0, y + 5, 2, 1);
  fillCircle(g, x + 4, y + 9, 2, '#3a2a1a');
  fillCircle(g, x + 12, y + 9, 2, '#3a2a1a');
  g.fillStyle = '#d9b24a';
  g.fillRect(x + 4, y + 1, 7, 2);
  return ref;
}

function waterwheel(): SpriteRef {
  const ref = atlas.alloc(16, 18, 8, 17);
  const g = atlas.g;
  const x = ref.x;
  const y = ref.y;
  g.strokeStyle = '#5a3d22';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(x + 8, y + 9, 7, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#5a3d22';
  g.fillRect(x + 7, y + 2, 2, 14);
  g.fillRect(x + 1, y + 8, 14, 2);
  g.fillStyle = '#7a5a3a';
  g.fillRect(x + 3, y + 4, 10, 1);
  g.fillRect(x + 3, y + 13, 10, 1);
  return ref;
}

function signpost(): SpriteRef {
  const ref = atlas.alloc(10, 14, 5, 13);
  const g = atlas.g;
  const x = ref.x;
  const y = ref.y;
  g.fillStyle = '#5a3d22';
  g.fillRect(x + 4, y + 2, 2, 11);
  g.fillStyle = '#a07a4a';
  g.fillRect(x + 1, y + 2, 8, 4);
  return ref;
}

function reeds(variant: number, snow: boolean): SpriteRef {
  const ref = atlas.alloc(8, 10, 4, 9);
  const g = atlas.g;
  const x = ref.x;
  const y = ref.y;
  g.fillStyle = snow ? '#9a9a7a' : '#5a8a3a';
  g.fillRect(x + 1, y + 2, 1, 7);
  g.fillRect(x + 3, y + 0, 1, 9);
  g.fillRect(x + 5, y + 3, 1, 6);
  g.fillRect(x + 6, y + 1, 1, 8);
  g.fillStyle = '#7a5a2a';
  g.fillRect(x + 3, y + 0, 1, 2);
  g.fillRect(x + 6, y + 1, 1, 2);
  void variant;
  return ref;
}

function fillCircle(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  g.fillStyle = color;
  for (let dy = -r; dy <= r; dy++) {
    const w = Math.floor(Math.sqrt(r * r - dy * dy));
    g.fillRect(cx - w, cy + dy, w * 2 + 1, 1);
  }
}

/** Спрайт стены/башни */
const wallCache = new Map<string, SpriteRef>();
export function getWallSprite(kind: 'wall' | 'tower' | 'gate', variant: number, snow: boolean): SpriteRef {
  const key = `${kind}:${variant}:${snow ? 1 : 0}`;
  let s = wallCache.get(key);
  if (s) return s;
  const g = atlas.g;
  if (kind === 'tower') {
    s = atlas.alloc(20, 36, 10, 35);
    const x = s.x;
    const y = s.y;
    g.fillStyle = '#7f7a72';
    g.fillRect(x + 2, y + 8, 16, 27);
    g.fillStyle = '#9c978f';
    g.fillRect(x + 3, y + 8, 6, 27);
    g.fillStyle = '#6a665f';
    for (let yy = y + 11; yy < y + 35; yy += 4) g.fillRect(x + 2, yy, 16, 1);
    // зубцы
    g.fillStyle = '#9c978f';
    for (let k = 0; k < 5; k++) g.fillRect(x + 1 + k * 4, y + 4, 2, 4);
    g.fillStyle = '#6a665f';
    g.fillRect(x + 1, y + 7, 18, 1);
    // крыша-конус
    for (let k = 0; k < 4; k++) {
      g.fillStyle = k % 2 ? '#4a5460' : '#5f6b78';
      g.fillRect(x + 3 + k * 2, y + 3 - k, 14 - k * 4, 1);
    }
    g.fillStyle = '#2d2a3a';
    g.fillRect(x + 9, y + 20, 2, 4);
    if (snow) {
      g.fillStyle = 'rgba(240,245,250,0.9)';
      g.fillRect(x + 2, y + 8, 16, 1);
    }
  } else if (kind === 'gate') {
    s = atlas.alloc(16, 30, 8, 29);
    const x = s.x;
    const y = s.y;
    g.fillStyle = '#7f7a72';
    g.fillRect(x, y + 2, 16, 27);
    g.fillStyle = '#6a665f';
    for (let yy = y + 5; yy < y + 29; yy += 4) g.fillRect(x, yy, 16, 1);
    g.fillStyle = '#2a1a0e';
    g.fillRect(x + 2, y + 12, 12, 17);
    g.fillStyle = '#5a3d22';
    g.fillRect(x + 3, y + 13, 10, 16);
    g.fillStyle = '#2a1a0e';
    for (let yy = y + 15; yy < y + 29; yy += 3) g.fillRect(x + 3, yy, 10, 1);
    g.fillStyle = '#9c978f';
    for (let k = 0; k < 4; k++) g.fillRect(x + 1 + k * 4, y, 2, 3);
  } else {
    s = atlas.alloc(16, 24, 8, 23);
    const x = s.x;
    const y = s.y;
    const h = 20;
    g.fillStyle = '#7f7a72';
    g.fillRect(x, y + 3, 16, h);
    g.fillStyle = '#6a665f';
    for (let yy = y + 6; yy < y + 3 + h; yy += 4) {
      g.fillRect(x, yy, 16, 1);
      const off = ((yy - y) / 4) % 2 === 0 ? 0 : 4;
      for (let xx = x + off; xx < x + 16; xx += 8) g.fillRect(xx, yy - 3, 1, 3);
    }
    g.fillStyle = '#9c978f';
    g.fillRect(x, y + 3, 16, 1);
    for (let k = 0; k < 4; k++) g.fillRect(x + 1 + k * 4, y, 2, 3);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(x, y + 3 + h - 1, 16, 1);
    // вариативность: пятна
    const hv = hash2(variant, 1);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(x + ((hv * 12) | 0), y + 8 + ((hash2(variant, 2) * 10) | 0), 3, 2);
    if (snow) {
      g.fillStyle = 'rgba(240,245,250,0.9)';
      g.fillRect(x, y + 3, 16, 1);
      for (let k = 0; k < 4; k++) g.fillRect(x + 1 + k * 4, y, 2, 1);
    }
  }
  wallCache.set(key, s);
  return s;
}

/** Мягкий круглый спрайт света (для ночного освещения) */
let lightSprite: HTMLCanvasElement | null = null;
export function getLightSprite(): HTMLCanvasElement {
  if (lightSprite) return lightSprite;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  lightSprite = c;
  return c;
}

let warmSprite: HTMLCanvasElement | null = null;
export function getWarmLightSprite(): HTMLCanvasElement {
  if (warmSprite) return warmSprite;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,200,110,1)');
  grad.addColorStop(0.4, 'rgba(255,170,70,0.5)');
  grad.addColorStop(1, 'rgba(255,140,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  warmSprite = c;
  return c;
}
