// Процедурные пиксельные иконки для интерфейса (ресурсы, окна, тревоги).
const cache = new Map<string, string>();

type Painter = (g: CanvasRenderingContext2D) => void;

function px(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string): void {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
}

const PAINTERS: Record<string, Painter> = {
  population: (g) => {
    px(g, 5, 2, 4, 4, '#f1c9a5');
    px(g, 4, 6, 6, 6, '#7a5a3a');
    px(g, 1, 4, 3, 3, '#f1c9a5');
    px(g, 0, 7, 4, 5, '#3a5a8a');
    px(g, 10, 4, 3, 3, '#f1c9a5');
    px(g, 10, 7, 4, 5, '#8a3a3a');
  },
  money: (g) => {
    px(g, 3, 3, 8, 8, '#d9b24a');
    px(g, 4, 4, 6, 6, '#f0d060');
    px(g, 6, 5, 2, 4, '#a07a1a');
  },
  bread: (g) => {
    px(g, 2, 5, 10, 6, '#c9903a');
    px(g, 3, 4, 8, 2, '#e0b060');
    px(g, 4, 6, 2, 1, '#a06a20');
    px(g, 8, 6, 2, 1, '#a06a20');
  },
  grain: (g) => {
    px(g, 6, 2, 2, 11, '#8a6a20');
    px(g, 4, 3, 2, 2, '#d9b24a');
    px(g, 8, 3, 2, 2, '#d9b24a');
    px(g, 3, 6, 3, 2, '#d9b24a');
    px(g, 8, 6, 3, 2, '#d9b24a');
  },
  flour: (g) => {
    px(g, 3, 4, 8, 9, '#e8dcc0');
    px(g, 4, 3, 6, 2, '#c8b890');
    px(g, 5, 7, 4, 3, '#f8f4e8');
  },
  meat: (g) => {
    px(g, 3, 4, 7, 7, '#c04040');
    px(g, 5, 5, 3, 3, '#e07070');
    px(g, 9, 8, 3, 3, '#f0e8d0');
  },
  ale: (g) => {
    px(g, 3, 3, 7, 10, '#c08a30');
    px(g, 3, 3, 7, 2, '#f8f0d0');
    px(g, 10, 5, 2, 5, '#8a6a20');
  },
  wood: (g) => {
    px(g, 1, 5, 12, 5, '#8a6a3a');
    px(g, 1, 5, 2, 5, '#c8a070');
    px(g, 4, 6, 8, 1, '#6a4a2a');
  },
  planks: (g) => {
    px(g, 1, 3, 12, 3, '#c9a060');
    px(g, 1, 8, 12, 3, '#b8905a');
    px(g, 3, 4, 1, 1, '#6a4a2a');
    px(g, 9, 9, 1, 1, '#6a4a2a');
  },
  stone: (g) => {
    px(g, 2, 6, 10, 6, '#8a8580');
    px(g, 4, 3, 6, 4, '#a8a39e');
    px(g, 5, 8, 3, 2, '#6a655f');
  },
  tools: (g) => {
    px(g, 6, 2, 2, 11, '#8a6a3a');
    px(g, 3, 2, 8, 3, '#9a9a9a');
    px(g, 3, 2, 8, 1, '#c8c8c8');
  },
  goods: (g) => {
    px(g, 3, 4, 8, 8, '#a07a4a');
    px(g, 3, 4, 8, 1, '#6a4a2a');
    px(g, 6, 4, 2, 8, '#6a4a2a');
    px(g, 3, 8, 8, 1, '#6a4a2a');
  },
  leather: (g) => {
    px(g, 2, 3, 10, 9, '#9a6a3a');
    px(g, 3, 4, 8, 7, '#b8804a');
    px(g, 2, 3, 2, 2, '#c8905a');
  },
  mood: (g) => {
    px(g, 3, 2, 8, 10, '#f0d060');
    px(g, 5, 5, 2, 2, '#2a1a0e');
    px(g, 8, 5, 2, 2, '#2a1a0e');
    px(g, 5, 9, 5, 1, '#2a1a0e');
  },
  unrest: (g) => {
    px(g, 6, 2, 2, 7, '#8a2a1e');
    px(g, 6, 10, 2, 2, '#8a2a1e');
    px(g, 4, 1, 6, 1, '#8a2a1e');
  },
  food: (g) => {
    px(g, 3, 6, 9, 6, '#c9903a');
    px(g, 2, 5, 11, 2, '#e0b060');
  },
  // окна
  market: (g) => {
    px(g, 1, 4, 12, 2, '#c03030');
    px(g, 1, 6, 12, 2, '#f0f0f0');
    px(g, 2, 8, 10, 5, '#7a5a3a');
  },
  edicts: (g) => {
    px(g, 3, 1, 8, 12, '#f3ead6');
    px(g, 4, 3, 6, 1, '#5a4630');
    px(g, 4, 5, 6, 1, '#5a4630');
    px(g, 4, 7, 4, 1, '#5a4630');
    px(g, 7, 9, 4, 3, '#8a2a1e');
  },
  development: (g) => {
    px(g, 6, 7, 2, 6, '#5a3d22');
    px(g, 2, 3, 10, 5, '#4a8a3a');
    px(g, 4, 1, 6, 3, '#5a9a4a');
  },
  trade: (g) => {
    px(g, 2, 7, 10, 4, '#8a6a3a');
    px(g, 3, 4, 8, 3, '#d9b24a');
    px(g, 2, 11, 3, 2, '#2a1a0e');
    px(g, 9, 11, 3, 2, '#2a1a0e');
  },
  region: (g) => {
    px(g, 1, 2, 12, 10, '#e8dcc0');
    px(g, 3, 4, 3, 2, '#4a8a3a');
    px(g, 7, 6, 4, 3, '#4a7aaa');
    px(g, 4, 8, 2, 2, '#8a6a3a');
  },
  chronicle: (g) => {
    px(g, 2, 2, 10, 11, '#8a5a2a');
    px(g, 3, 3, 8, 9, '#f3ead6');
    px(g, 4, 5, 6, 1, '#5a4630');
    px(g, 4, 7, 6, 1, '#5a4630');
  },
  stats: (g) => {
    px(g, 2, 9, 2, 4, '#2a4a9a');
    px(g, 5, 6, 2, 7, '#4a6a2a');
    px(g, 8, 3, 2, 10, '#b8902a');
    px(g, 11, 7, 2, 6, '#8a2a1e');
  },
  god: (g) => {
    px(g, 4, 2, 6, 3, '#f0d060');
    px(g, 3, 5, 8, 4, '#f3ead6');
    px(g, 6, 9, 2, 4, '#f3ead6');
  },
  settings: (g) => {
    px(g, 4, 4, 6, 6, '#6a665f');
    px(g, 6, 1, 2, 3, '#6a665f');
    px(g, 6, 10, 2, 3, '#6a665f');
    px(g, 1, 6, 3, 2, '#6a665f');
    px(g, 10, 6, 3, 2, '#6a665f');
    px(g, 6, 6, 2, 2, '#f3ead6');
  },
  build: (g) => {
    px(g, 2, 8, 10, 5, '#8a6a3a');
    px(g, 3, 4, 8, 4, '#e3d4b4');
    px(g, 1, 3, 12, 2, '#b4553a');
  },
  // тревоги
  alert: (g) => {
    px(g, 6, 1, 2, 7, '#8a2a1e');
    px(g, 6, 10, 2, 2, '#8a2a1e');
    px(g, 1, 12, 12, 1, '#8a2a1e');
  },
  fire: (g) => {
    px(g, 5, 7, 4, 6, '#e0401a');
    px(g, 6, 3, 2, 5, '#ffb030');
    px(g, 4, 9, 6, 2, '#fff2a0');
  },
  star: (g) => {
    px(g, 6, 1, 2, 12, '#d9b24a');
    px(g, 1, 6, 12, 2, '#d9b24a');
    px(g, 3, 3, 8, 8, '#d9b24a');
    px(g, 5, 5, 4, 4, '#f0d060');
  },
  heart: (g) => {
    px(g, 2, 3, 4, 4, '#c03040');
    px(g, 8, 3, 4, 4, '#c03040');
    px(g, 3, 6, 8, 3, '#c03040');
    px(g, 5, 9, 4, 2, '#c03040');
    px(g, 6, 11, 2, 1, '#c03040');
  },
};

/** data-URL иконки 14×14, масштабируется CSS */
export function icon(name: string): string {
  let url = cache.get(name);
  if (url) return url;
  const c = document.createElement('canvas');
  c.width = 14;
  c.height = 14;
  const g = c.getContext('2d')!;
  const p = PAINTERS[name];
  if (p) p(g);
  else px(g, 3, 3, 8, 8, '#888');
  url = c.toDataURL();
  cache.set(name, url);
  return url;
}

export function iconImg(name: string, size = 16, title = ''): string {
  return `<img class="ico" src="${icon(name)}" width="${size}" height="${size}" alt="" ${title ? `title="${title}"` : ''}>`;
}
