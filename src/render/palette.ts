// Палитры и утилиты работы с цветом.
import { Season } from '../core/time';

export type RGB = [number, number, number];

export function rgb(c: RGB, a = 1): string {
  return a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

export function shade(c: RGB, k: number): RGB {
  return [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function hex(h: string): RGB {
  const v = parseInt(h.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export interface SeasonPalette {
  grass: RGB;
  grass2: RGB;
  meadow: RGB;
  flowers: RGB[];
  dirt: RGB;
  road: RGB;
  plaza: RGB;
  water: RGB;
  waterDeep: RGB;
  sand: RGB;
  field: RGB;
  fieldRow: RGB;
  forestFloor: RGB;
  rock: RGB;
  garden: RGB;
  cemetery: RGB;
  mud: RGB;
  quarry: RGB;
  canopy: RGB[];
  pine: RGB;
  snow: boolean;
}

const base: SeasonPalette = {
  grass: hex('#6f9a3f'),
  grass2: hex('#7aa648'),
  meadow: hex('#86ad4b'),
  flowers: [hex('#e8e05a'), hex('#e46a8a'), hex('#f2f2f2'), hex('#8e7cd8')],
  dirt: hex('#9b7a4e'),
  road: hex('#8f8a80'),
  plaza: hex('#a39c8e'),
  water: hex('#3f7fb8'),
  waterDeep: hex('#2f629a'),
  sand: hex('#c9b784'),
  field: hex('#8f6a3f'),
  fieldRow: hex('#6f9a3f'),
  forestFloor: hex('#557a33'),
  rock: hex('#8a8580'),
  garden: hex('#6c9340'),
  cemetery: hex('#6c8a44'),
  mud: hex('#7c6243'),
  quarry: hex('#a09a90'),
  canopy: [hex('#3f7a2a'), hex('#4b8a30'), hex('#5a9a3a'), hex('#2f6a22')],
  pine: hex('#2e5f2c'),
  snow: false,
};

export const SEASON_PALETTES: Record<number, SeasonPalette> = {
  [Season.Spring]: { ...base },
  [Season.Summer]: {
    ...base,
    grass: hex('#6a9436'),
    grass2: hex('#76a040'),
    meadow: hex('#82aa42'),
    field: hex('#9a8a3c'),
    fieldRow: hex('#b8a846'),
    canopy: [hex('#3a7426'), hex('#44822c'), hex('#519235'), hex('#2d6420')],
  },
  [Season.Autumn]: {
    ...base,
    grass: hex('#8d9243'),
    grass2: hex('#999a48'),
    meadow: hex('#a39c4c'),
    flowers: [hex('#d9a24a'), hex('#c26a3a')],
    field: hex('#8a6b3e'),
    fieldRow: hex('#c9a84e'),
    forestFloor: hex('#7a6a33'),
    garden: hex('#8c8a40'),
    cemetery: hex('#86863f'),
    canopy: [hex('#c7772e'), hex('#d9a033'), hex('#a74b2a'), hex('#b8862e')],
    pine: hex('#2e5f2c'),
  },
  [Season.Winter]: {
    ...base,
    grass: hex('#e6ecf2'),
    grass2: hex('#dce3ea'),
    meadow: hex('#e9eef3'),
    flowers: [],
    dirt: hex('#b6a98f'),
    road: hex('#a9a6a0'),
    plaza: hex('#b7b2a7'),
    water: hex('#4d7fae'),
    waterDeep: hex('#3a6690'),
    sand: hex('#d9d4c3'),
    field: hex('#e2e6ea'),
    fieldRow: hex('#cfd5db'),
    forestFloor: hex('#d9e0e6'),
    rock: hex('#9a9a9c'),
    garden: hex('#e2e8ee'),
    cemetery: hex('#e2e8ee'),
    mud: hex('#a89b84'),
    quarry: hex('#b0b0b2'),
    canopy: [hex('#8b7355'), hex('#7a6448'), hex('#9a825f'), hex('#6e5a40')],
    pine: hex('#2e5f2c'),
    snow: true,
  },
};

export const MATERIAL_COLORS = {
  wood: { wall: hex('#8a6239'), wallDark: hex('#6a4a2a'), beam: hex('#5a3d22') },
  timber: { wall: hex('#e3d4b4'), wallDark: hex('#cbbb9a'), beam: hex('#5c3f26') },
  stone: { wall: hex('#9c978f'), wallDark: hex('#7f7a72'), beam: hex('#6a665f') },
  brick: { wall: hex('#a8563d'), wallDark: hex('#8a4631'), beam: hex('#6f3a28') },
};

export const ROOF_COLORS = {
  thatch: { light: hex('#c9a95a'), dark: hex('#a68a44'), line: hex('#8f7538') },
  tile: { light: hex('#b4553a'), dark: hex('#8f4330'), line: hex('#7a3a2a') },
  slate: { light: hex('#5f6b78'), dark: hex('#4a5460'), line: hex('#3c444e') },
  wood: { light: hex('#8c6a42'), dark: hex('#6e5233'), line: hex('#5a4229') },
};
