import type { Game } from '../main';
import { ChronicleEvent } from '../events/chronicle';
import { formatClock, getTime, SEASON_NAMES_GEN } from '../core/time';

export class ChronicleView {
  el: HTMLElement;
  private list: HTMLElement;
  private game: Game;
  private shown = 0;
  private filter = 'all';

  constructor(root: HTMLElement, game: Game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.id = 'chron';
    this.el.className = 'panel';
    this.el.innerHTML = `<h3>Хроника города</h3><div class="filters"><button class="btn active" data-f="all">Все</button><button class="btn" data-f="2">Преступления</button><button class="btn" data-f="1">Люди</button><button class="btn" data-f="3">Бедствия</button><button class="btn" data-f="4">Торговля</button></div><div class="list"></div>`;
    root.appendChild(this.el);
    this.list = this.el.querySelector('.list')!;
    this.el.addEventListener('click', (e) => {
      const fb = (e.target as HTMLElement).closest('[data-f]') as HTMLElement | null;
      if (fb) {
        this.filter = fb.getAttribute('data-f')!;
        this.el.querySelectorAll('[data-f]').forEach((b) => b.classList.toggle('active', b === fb));
        this.list.innerHTML = '';
        this.shown = 0;
        this.update();
        return;
      }
      const t = (e.target as HTMLElement).closest('.ev') as HTMLElement | null;
      if (!t) return;
      const x = Number(t.getAttribute('data-x'));
      const y = Number(t.getAttribute('data-y'));
      this.game.panTo(x, y);
      const a = t.getAttribute('data-actor');
      if (a) this.game.selectCitizen(Number(a), false);
    });
  }

  update(): void {
    const events = this.game.sim.chronicle.events;
    if (events.length === this.shown) return;
    // добавить новые
    const start = Math.max(0, this.shown, events.length - 80);
    for (let i = start; i < events.length; i++) {
      const e = events[i];
      if (this.filter === 'all' || String(e.kind) === this.filter || (this.filter === '1' && (e.kind === 5 || e.kind === 6 || e.kind === 7))) this.add(e);
    }
    this.shown = events.length;
    while (this.list.children.length > 60) this.list.removeChild(this.list.firstChild!);
    this.list.scrollTop = this.list.scrollHeight;
    this.el.scrollTop = this.el.scrollHeight;
  }

  private add(e: ChronicleEvent): void {
    const d = document.createElement('div');
    d.className = `ev k${e.kind}`;
    const t = getTime(e.tick);
    d.innerHTML = `<span class="t">${t.dayOfSeason} ${SEASON_NAMES_GEN[t.season].slice(0, 3)}. ${formatClock(e.tick)}</span>${e.text}`;
    d.setAttribute('data-x', String(e.x));
    d.setAttribute('data-y', String(e.y));
    if (e.actors.length) d.setAttribute('data-actor', String(e.actors[0]));
    this.list.appendChild(d);
  }
}
