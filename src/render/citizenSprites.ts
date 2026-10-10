// Спрайты жителей: процедурные человечки 4 направления × 4 кадра.
import { Atlas, SpriteRef } from './atlas';
import { Citizen, Profession, isChild } from '../sim/citizen';

const atlas = new Atlas(2048);
const cache = new Map<string, SpriteRef>();

export const SKIN_TONES = ['#f1c9a5', '#e8b58c', '#d9a177', '#c58b5f', '#a9714a', '#f4d7bb'];
export const HAIR_COLORS = ['#2b1b10', '#4a2e1a', '#7a4a22', '#b07a3a', '#d9b24a', '#a53c2a', '#8a8a8a', '#e8e0d0'];
export const CLOTH_COLORS = [
  '#7a5a3a', '#5a4a3a', '#8a7a5a', '#6a6a5a', '#9a8a6a', // крестьянские
  '#3a5a8a', '#2a6a4a', '#8a3a3a', '#6a3a7a', '#a0702a', // горожане
  '#b02020', '#2a4a9a', '#5a2a7a', '#d9b24a', '#1a1a1a', // знать / стража / священник
  '#e8e0d0', '#8a6a3a', '#4a4a4a', '#c8c8c8', '#3a2a1a',
];

export function getCitizenSprite(c: Citizen, dir: number, frame: number): SpriteRef {
  const a = c.appearance;
  const child = isChild(c) ? 1 : 0;
  const prof = c.profession;
  const key = `${a.skin}:${a.hair}:${a.hairStyle}:${a.cloth}:${a.cloth2}:${a.hat}:${a.beard}:${c.sex}:${child}:${prof}:${dir}:${frame}`;
  let s = cache.get(key);
  if (s) return s;
  s = build(c, dir, frame, child === 1);
  cache.set(key, s);
  return s;
}

function build(c: Citizen, dir: number, frame: number, child: boolean): SpriteRef {
  const a = c.appearance;
  const h = child ? 11 : 15;
  const ref = atlas.alloc(12, h + 2, 6, h + 1);
  const g = atlas.g;
  const X = ref.x;
  const Y = ref.y + 1;
  const skin = SKIN_TONES[a.skin % SKIN_TONES.length];
  const hair = HAIR_COLORS[a.hair % HAIR_COLORS.length];
  let cloth = CLOTH_COLORS[a.cloth % CLOTH_COLORS.length];
  let cloth2 = CLOTH_COLORS[a.cloth2 % CLOTH_COLORS.length];
  let hat = a.hat;
  let apron: string | null = null;
  // Профессиональная одежда
  switch (c.profession) {
    case Profession.Guard:
      cloth = '#b02020';
      cloth2 = '#4a4a4a';
      hat = 3;
      break;
    case Profession.Priest:
      cloth = '#1a1a1a';
      cloth2 = '#1a1a1a';
      break;
    case Profession.Monk:
      cloth = '#6a4a2a';
      cloth2 = '#6a4a2a';
      hat = 0;
      break;
    case Profession.Baker:
      apron = '#f0ece0';
      break;
    case Profession.Butcher:
      apron = '#d8d0c0';
      break;
    case Profession.Smith:
      apron = '#3a2a1a';
      break;
    case Profession.Tanner:
      apron = '#7a5a3a';
      break;
    case Profession.Noble:
    case Profession.Lord:
      cloth = ['#5a2a7a', '#2a4a9a', '#8a1a2a', '#1a5a4a'][a.cloth % 4];
      cloth2 = '#1a1a2a';
      hat = c.sex === 'm' ? 2 : 0;
      break;
    case Profession.Burgomaster:
      cloth = '#2a2a5a';
      cloth2 = '#1a1a1a';
      hat = 2;
      break;
    case Profession.Beggar:
      cloth = '#5a5248';
      cloth2 = '#4a4238';
      hat = 0;
      break;
    case Profession.Merchant:
      cloth = ['#2a6a4a', '#3a5a8a', '#a0702a'][a.cloth % 3];
      hat = c.sex === 'm' ? 1 : 0;
      break;
    case Profession.Herald:
      cloth = '#d9b24a';
      cloth2 = '#2a4a9a';
      hat = 1;
      break;
    case Profession.Bard:
      cloth = '#8a3a7a';
      cloth2 = '#3a8a3a';
      hat = 1;
      break;
    case Profession.Thief:
      cloth = '#3a3a3a';
      cloth2 = '#2a2a2a';
      hat = 4;
      break;
    default:
      break;
  }
  const side = dir === 1 || dir === 2;
  const flip = dir === 1;
  const up = dir === 3;
  // Ноги (анимация)
  const legY = Y + h - (child ? 3 : 4);
  const legH = child ? 3 : 4;
  const step = frame === 1 ? 1 : frame === 3 ? -1 : 0;
  const draw = (x: number, y: number, w: number, hh: number, col: string) => {
    g.fillStyle = col;
    const fx = flip ? X + 12 - x - w : X + x;
    g.fillRect(fx, y, w, hh);
  };
  // Ноги
  if (side) {
    draw(4 + (step > 0 ? 1 : 0), legY, 2, legH, cloth2);
    draw(6 - (step < 0 ? 1 : 0), legY, 2, legH, cloth2);
  } else {
    draw(4, legY + (step > 0 ? 0 : step < 0 ? 1 : 0), 2, legH - (step < 0 ? 1 : 0), cloth2);
    draw(6, legY + (step < 0 ? 0 : step > 0 ? 1 : 0), 2, legH - (step > 0 ? 1 : 0), cloth2);
  }
  // Обувь
  draw(4, legY + legH - 1, 2, 1, '#2a1a0e');
  draw(6, legY + legH - 1, 2, 1, '#2a1a0e');
  // Тело
  const bodyH = child ? 4 : 6;
  const bodyY = legY - bodyH;
  if (c.sex === 'f' && !child && c.profession !== Profession.Guard) {
    // юбка — шире
    draw(3, bodyY + 2, 6, bodyH - 2 + 2, cloth2 === cloth ? cloth : cloth2);
    draw(4, bodyY, 4, 3, cloth);
    draw(3, bodyY + 1, 6, 1, cloth);
  } else {
    draw(4, bodyY, 4, bodyH, cloth);
  }
  if (apron) draw(5, bodyY + 2, 2, bodyH - 1 + (c.sex === 'f' ? 2 : 0), apron);
  // Руки
  const armY = bodyY + 1;
  if (side) {
    draw(5 + (step > 0 ? 1 : step < 0 ? -1 : 0), armY, 2, 3, cloth);
    draw(5 + (step > 0 ? 1 : step < 0 ? -1 : 0), armY + 3, 2, 1, skin);
  } else {
    draw(3, armY + (step > 0 ? 1 : 0), 1, 3, cloth);
    draw(8, armY + (step < 0 ? 1 : 0), 1, 3, cloth);
    draw(3, armY + 3 + (step > 0 ? 1 : 0), 1, 1, skin);
    draw(8, armY + 3 + (step < 0 ? 1 : 0), 1, 1, skin);
  }
  // Голова
  const headH = child ? 4 : 5;
  const headY = bodyY - headH;
  draw(4, headY, 4, headH, skin);
  // Лицо
  if (!up) {
    if (side) {
      draw(flip ? 7 : 4, headY + 2, 1, 1, '#2a1a0e');
    } else {
      draw(5, headY + 2, 1, 1, '#2a1a0e');
      draw(7, headY + 2, 1, 1, '#2a1a0e');
    }
    if (a.beard && c.sex === 'm' && !child) {
      draw(4, headY + 4, 4, 1, hair);
      if (a.beard > 1) draw(5, headY + 5, 2, 1, hair);
    }
  }
  // Волосы
  const hs = a.hairStyle;
  draw(4, headY - 1, 4, 2, hair);
  if (hs === 1 || c.sex === 'f') {
    // длинные
    draw(3, headY, 1, 3, hair);
    draw(8, headY, 1, 3, hair);
    if (up) draw(4, headY, 4, 3, hair);
  }
  if (hs === 2) draw(3, headY, 1, 1, hair);
  if (up && hs !== 1) draw(4, headY, 4, 2, hair);
  if (c.age >= 62) {
    // седина
    draw(4, headY - 1, 4, 2, '#c8c8c8');
  }
  // Шляпы
  if (hat === 1) {
    // шапка/колпак
    draw(3, headY - 2, 6, 2, cloth2);
  } else if (hat === 2) {
    // берет знати
    draw(3, headY - 2, 6, 2, '#1a1a2a');
    draw(2, headY - 1, 1, 1, '#d9b24a');
  } else if (hat === 3) {
    // шлем стражи
    draw(3, headY - 2, 6, 3, '#9a9a9a');
    draw(4, headY - 3, 4, 1, '#b0b0b0');
  } else if (hat === 4) {
    // капюшон
    draw(3, headY - 2, 6, 3, cloth);
    draw(4, headY + 1, 4, 1, cloth);
  } else if (hat === 5) {
    // соломенная шляпа
    draw(2, headY - 1, 8, 1, '#d9b24a');
    draw(4, headY - 3, 4, 2, '#c9a240');
  }
  // контур (чуть темнее) снизу тела — объём
  draw(4, bodyY + bodyH - 1, 4, 1, 'rgba(0,0,0,0.18)');
  return ref;
}
