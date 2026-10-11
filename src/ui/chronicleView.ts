import type { Game } from '../main';
import { ChronicleEvent } from '../events/chronicle';
import { formatClock, getTime, SEASON_NAMES_GEN } from '../core/time';

export class ChronicleView {
  el: HTMLElement;
  private list: HTMLElement;
  private game: Game;
  private shown = 0;
  private filter = 'all';
  private ticker: HTMLElement;
  collapsed = false;

  constructor(root: HTMLElement, game: Game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.id = 'chron';
    this.el.className = 'panel';
    this.el.dataset.fixed = '1';
    this.el.innerHTML = `<div class="ch-head"><h3>Хроника города</h3><button class="wb collapse" data-tip="Свернуть в одну строку">▾</button></div><div class="ticker"></div><div class="filters"><button class="btn active" data-f="all">Все</button><button class="btn" data-f="2">Преступления</button><button class="btn" data-f="1">Люди</button><button class="btn" data-f="3">Бедствия</button><button class="btn" data-f="4">Торговля</button></div><div class="list"></div>`;
    root.appendChild(this.el);
    this.list = this.el.querySelector('.list')!;
    this.ticker = this.el.querySelector('.ticker')!;
    try {
      this.setCollapsed(localStorage.getItem('waldmark.ui.chron') === '1');
    } catch {
      /* ignore */
    }
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.collapse')) {
        this.setCollapsed(!this.collapsed);
        return;
      }
      if ((e.target as HTMLElement).closest('.ticker')) {
        this.setCollapsed(false);
        return;
      }
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

  setCollapsed(v: boolean): void {
    this.collapsed = v;
    this.el.classList.toggle('collapsed', v);
    (this.el.querySelector('.collapse') as HTMLElement).textContent = v ? '▴' : '▾';
    try {
      localStorage.setItem('waldmark.ui.chron', v ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (!v) this.list.scrollTop = this.list.scrollHeight;
  }

  toggle(): void {
    this.setCollapsed(!this.collapsed);
  }

  update(): void {
    const events = this.game.sim.chronicle.events;
    if (events.length === this.shown) return;
    const last = events[events.length - 1];
    if (last) this.ticker.innerHTML = `<span class="t">${formatClock(last.tick)}</span><span class="k${last.kind}">${last.text}</span>`;
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
