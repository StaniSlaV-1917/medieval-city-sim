// Левая вертикальная панель иконок: открывает окна (Хозяйство, Указы, Развитие, Торговля, Регион,
// Летопись, Статистика, Длань небес, Настройки).
import type { Game } from '../main';
import { iconImg } from './icons';

export interface LeftItem {
  id: string;
  icon: string;
  label: string;
  key: string;
}

export const LEFT_ITEMS: LeftItem[] = [
  { id: 'economy', icon: 'market', label: 'Хозяйство', key: 'M' },
  { id: 'edicts', icon: 'edicts', label: 'Указы', key: 'E' },
  { id: 'development', icon: 'development', label: 'Развитие', key: 'R' },
  { id: 'trade', icon: 'trade', label: 'Торговля', key: 'Y' },
  { id: 'region', icon: 'region', label: 'Регион', key: 'N' },
  { id: 'chronicle', icon: 'chronicle', label: 'Летопись', key: 'L' },
  { id: 'stats', icon: 'stats', label: 'Статистика', key: 'T' },
  { id: 'god', icon: 'god', label: 'Длань небес', key: 'G' },
  { id: 'settings', icon: 'settings', label: 'Настройки', key: '' },
];

export class LeftBar {
  el: HTMLElement;
  private btns = new Map<string, HTMLElement>();

  constructor(root: HTMLElement, game: Game) {
    this.el = document.createElement('div');
    this.el.id = 'leftbar';
    this.el.className = 'panel';
    this.el.dataset.fixed = '1';
    for (const it of LEFT_ITEMS) {
      const b = document.createElement('button');
      b.className = 'lb';
      b.dataset.id = it.id;
      b.dataset.tip = `<b>${it.label}</b>${it.key ? ` <span class="muted">(${it.key})</span>` : ''}`;
      b.innerHTML = iconImg(it.icon, 22);
      b.addEventListener('click', () => game.openWindow(it.id));
      this.el.appendChild(b);
      this.btns.set(it.id, b);
    }
    root.appendChild(this.el);
  }

  update(game: Game): void {
    for (const [id, b] of this.btns) b.classList.toggle('active', game.windows.get(id)?.open ?? false);
  }
}
