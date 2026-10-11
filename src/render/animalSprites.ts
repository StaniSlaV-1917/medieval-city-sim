// Спрайты живности.
import { Atlas, SpriteRef } from './atlas';
import { AnimalKind } from '../sim/animals';

const atlas = new Atlas(256);
const cache = new Map<string, SpriteRef>();

export function getAnimalSprite(kind: AnimalKind, dir: number, frame: number): SpriteRef {
  const flip = dir === 1;
  const key = `${kind}:${flip ? 1 : 0}:${frame}`;
  let s = cache.get(key);
  if (s) return s;
  s = build(kind, flip, frame);
  cache.set(key, s);
  return s;
}

function build(kind: AnimalKind, flip: boolean, frame: number): SpriteRef {
  const g = atlas.g;
  const w = kind === AnimalKind.Bird ? 7 : kind === AnimalKind.Chicken ? 6 : kind === AnimalKind.Deer ? 12 : 10;
  const h = kind === AnimalKind.Bird ? 4 : kind === AnimalKind.Chicken ? 6 : kind === AnimalKind.Deer ? 11 : 7;
  const ref = atlas.alloc(w, h, w / 2, h);
  const X = ref.x;
  const Y = ref.y;
  const px = (x: number, y: number, ww: number, hh: number, c: string) => {
    g.fillStyle = c;
    g.fillRect(flip ? X + w - x - ww : X + x, Y + y, ww, hh);
  };
  const step = frame % 2;
  switch (kind) {
    case AnimalKind.Dog: {
      const c = '#8a6a3a';
      px(1, 2, 7, 3, c);
      px(7, 1, 3, 3, c);
      px(9, 1, 1, 1, '#2a1a0e');
      px(0, 1, 2, 2, c); // хвост
      px(2, 5, 1, 2 - step, '#5a3d22');
      px(4, 5, 1, 1 + step, '#5a3d22');
      px(6, 5, 1, 2 - step, '#5a3d22');
      px(8, 4, 1, 1 + step, '#5a3d22');
      break;
    }
    case AnimalKind.Cat: {
      const c = '#4a4a4a';
      px(2, 3, 6, 2, c);
      px(7, 2, 3, 3, c);
      px(7, 1, 1, 1, c);
      px(9, 1, 1, 1, c);
      px(8, 3, 1, 1, '#c0d040');
      px(0, 1, 2, 3, c);
      px(3, 5, 1, 2 - step, '#333');
      px(6, 5, 1, 1 + step, '#333');
      break;
    }
    case AnimalKind.Chicken: {
      px(1, 2, 4, 3, '#f0e6d0');
      px(4, 1, 2, 2, '#f0e6d0');
      px(5, 1, 1, 1, '#d02020');
      px(6, 2, 1, 1, '#e0a020');
      px(0, 2, 1, 2, '#c8b890');
      px(2, 5, 1, 1 + step, '#e0a020');
      px(4, 5, 1, 2 - step, '#e0a020');
      break;
    }
    case AnimalKind.Bird: {
      px(0, 1 + step, 2, 1, '#333');
      px(2, 1, 3, 1, '#333');
      px(5, 1 + step, 2, 1, '#333');
      px(3, 0, 1, 1, '#333');
      break;
    }
    case AnimalKind.Deer: {
      const c = '#a8743c';
      px(2, 5, 7, 3, c);
      px(8, 3, 3, 3, c);
      px(9, 1, 1, 2, '#6a4020');
      px(11, 2, 1, 1, '#6a4020');
      px(10, 0, 1, 2, '#6a4020');
      px(10, 4, 1, 1, '#222');
      px(1, 5, 1, 1, '#f0e8d8');
      px(3, 8, 1, 3 - step, '#7a5028');
      px(5, 8, 1, 2 + step, '#7a5028');
      px(7, 8, 1, 3 - step, '#7a5028');
      px(8, 8, 1, 2 + step, '#7a5028');
      break;
    }
    case AnimalKind.Boar: {
      const c = '#4a3a2a';
      px(1, 2, 7, 4, c);
      px(7, 3, 3, 3, '#3a2a1a');
      px(9, 5, 1, 1, '#e8e0d0');
      px(8, 4, 1, 1, '#c03030');
      px(1, 1, 6, 1, '#2a1a0a');
      px(2, 6, 1, 1 + step, '#2a1a0a');
      px(4, 6, 1, 2 - step, '#2a1a0a');
      px(6, 6, 1, 1 + step, '#2a1a0a');
      break;
    }
    case AnimalKind.Wolf: {
      const c = '#777';
      px(1, 2, 7, 3, c);
      px(7, 1, 3, 3, c);
      px(9, 1, 1, 1, '#e8c020');
      px(0, 2, 2, 1, c);
      px(2, 5, 1, 2 - step, '#555');
      px(4, 5, 1, 1 + step, '#555');
      px(6, 5, 1, 2 - step, '#555');
      px(8, 4, 1, 1 + step, '#555');
      break;
    }
  }
  return ref;
}
