// Всплывающие уведомления с кнопкой «показать».
import type { Game } from '../main';

export class Toasts {
  el: HTMLElement;
  private game: Game;

  constructor(root: HTMLElement, game: Game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.id = 'toasts';
    root.appendChild(this.el);
  }

  show(text: string, kind: number, x?: number, y?: number, actor?: number): void {
    const t = document.createElement('div');
    t.className = `toast k${kind}`;
    t.innerHTML = `<span class="tx">${text}</span>${x !== undefined ? '<button class="btn small">показать</button>' : ''}<button class="x" title="закрыть">✕</button>`;
    t.querySelector('.btn')?.addEventListener('click', () => {
      this.game.panTo(x!, y!);
      if (actor !== undefined && actor >= 0) this.game.selectCitizen(actor, false);
      t.remove();
    });
    t.querySelector('.x')!.addEventListener('click', () => t.remove());
    this.el.prepend(t);
    while (this.el.children.length > 5) this.el.lastElementChild!.remove();
    setTimeout(() => {
      t.classList.add('fade');
      setTimeout(() => t.remove(), 600);
    }, 9000);
  }
}
