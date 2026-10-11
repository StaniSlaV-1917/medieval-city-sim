// Правый «Outliner» в духе CK3: избранные жители, стройки, караваны, текущие события.
import type { Game } from '../main';
import type { Win } from './windows';
import { fullName, professionName } from '../sim/citizen';
import { moodWord } from '../sim/needs';
import { BUILDING_DEFS } from '../world/buildings';
import { STAGE_NAMES } from '../sim/construction';
import { iconImg } from './icons';
import { formatClock } from '../core/time';

export class Outliner {
  el: HTMLElement;
  win: Win;
  private game: Game;
  private last = 0;
  private open: Record<string, boolean> = { fav: true, build: true, caravan: true, events: true };

  constructor(win: Win, game: Game) {
    this.win = win;
    this.game = game;
    this.el = win.body;
    this.el.classList.add('outliner');
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const h = t.closest<HTMLElement>('.oh');
      if (h) {
        const k = h.dataset.sec!;
        this.open[k] = !this.open[k];
        this.render();
        return;
      }
      const unfav = t.closest<HTMLElement>('.unfav');
      if (unfav) {
        this.game.toggleFavorite(Number(unfav.dataset.id));
        this.render();
        return;
      }
      const c = t.closest<HTMLElement>('[data-citizen]');
      if (c) {
        this.game.selectCitizen(Number(c.dataset.citizen), true);
        return;
      }
      const b = t.closest<HTMLElement>('[data-building]');
      if (b) {
        const id = Number(b.dataset.building);
        const bb = this.game.sim.world.buildings[id];
        if (bb) {
          this.game.panTo(bb.doorX, bb.doorY);
          this.game.selectBuilding(id);
        }
        return;
      }
      const g = t.closest<HTMLElement>('[data-goto]');
      if (g) {
        const [x, y] = g.dataset.goto!.split(',').map(Number);
        this.game.panTo(x, y);
      }
    });
  }

  toggle(force?: boolean): void {
    this.win.toggle(force);
    if (this.win.open) this.render();
  }

  update(): void {
    if (!this.win.open) return;
    const now = performance.now();
    if (now - this.last < 700) return;
    this.last = now;
    this.render();
  }

  private sec(key: string, title: string, count: number, body: string): string {
    const o = this.open[key];
    return `<div class="osec"><div class="oh" data-sec="${key}"><span class="arr">${o ? '▾' : '▸'}</span>${title}<span class="cnt">${count}</span></div>${o ? `<div class="ob">${body || '<div class="muted">—</div>'}</div>` : ''}</div>`;
  }

  render(): void {
    const sim = this.game.sim;
    sim.favorites = sim.favorites.filter((id) => sim.citizens[id]?.alive);
    const favs = sim.favorites
      .map((id) => {
        const c = sim.citizens[id];
        const sel = this.game.renderer.selectedCitizen === id ? ' sel' : '';
        const st = c.jailedUntil > sim.tick ? 'в тюрьме' : c.flags & 4 ? 'болен' : c.flags & 8 ? 'ранен' : moodWord(c.mood);
        return `<div class="orow${sel}" data-citizen="${id}">${iconImg('star', 12)}<span class="nm">${fullName(c)}</span><span class="muted">${professionName(c)}, ${st}</span><button class="unfav" data-id="${id}" data-tip="Убрать из избранного">✕</button></div>`;
      })
      .join('');
    const sites = sim.world.buildings.filter((b) => b.w > 0 && b.underConstruction !== undefined);
    const build = sites.map((b) => `<div class="orow" data-building="${b.id}">${iconImg('build', 12)}<span class="nm">${BUILDING_DEFS[b.type].name}</span><span class="muted">${STAGE_NAMES[b.buildStage ?? 0]} ${Math.round((b.underConstruction ?? 0) * 100)}%</span></div>`).join('');
    const car = sim.caravan;
    const caravan = car ? `<div class="orow" data-goto="${car.dest.x},${car.dest.y}">${iconImg('trade', 12)}<span class="nm">Караван купцов</span><span class="muted">${['подходит', 'торгует', 'уходит'][Math.min(2, car.phase)] ?? 'в пути'}, ${car.members.length} чел.</span></div>` : '';
    const ev: string[] = [];
    const poi = sim.world.poi;
    for (const f of sim.fires) {
      const b = sim.world.buildings[f.building];
      if (b) ev.push(`<div class="orow bad" data-building="${b.id}">${iconImg('fire', 12)}<span class="nm">Пожар: ${b.name ? `«${b.name}»` : BUILDING_DEFS[b.type].name.toLowerCase()}</span></div>`);
    }
    if (sim.raid) ev.push(`<div class="orow bad" data-goto="${sim.raid.gate.x},${sim.raid.gate.y}">${iconImg('alert', 12)}<span class="nm">Налёт разбойников</span><span class="muted">${sim.raid.members.length} чел.</span></div>`);
    if (sim.protest) ev.push(`<div class="orow bad" data-goto="${sim.protest.x},${sim.protest.y}">${iconImg('unrest', 12)}<span class="nm">${sim.protest.riot ? 'Бунт' : 'Протест'}</span><span class="muted">${sim.protest.members.length} чел.</span></div>`);
    if (sim.festival) ev.push(`<div class="orow" data-goto="${poi.cx},${poi.cy}">${iconImg('mood', 12)}<span class="nm">Праздник на площади</span></div>`);
    if (sim.pendingWedding) {
      const a = sim.citizens[sim.pendingWedding.a];
      const b = sim.citizens[sim.pendingWedding.b];
      if (a && b) ev.push(`<div class="orow" data-citizen="${a.id}">${iconImg('heart', 12)}<span class="nm">Свадьба: ${a.firstName} и ${b.firstName}</span><span class="muted">в ${formatClock(sim.pendingWedding.tick)}</span></div>`);
    }
    for (const f of sim.funerals) {
      const d = sim.citizens[f.dead];
      if (d) ev.push(`<div class="orow" data-goto="${Math.round(d.x)},${Math.round(d.y)}">${iconImg('chronicle', 12)}<span class="nm">Похороны: ${fullName(d)}</span></div>`);
    }
    if (sim.dragon) ev.push(`<div class="orow bad" data-goto="${Math.round(sim.dragon.x)},${Math.round(sim.dragon.y)}">${iconImg('alert', 12)}<span class="nm">Дракон</span></div>`);
    if (sim.flood) ev.push(`<div class="orow bad" data-goto="${poi.cx},${poi.cy}">${iconImg('alert', 12)}<span class="nm">Наводнение</span></div>`);
    const talks = sim.talks.size;
    this.el.innerHTML =
      this.sec('fav', 'Избранные', sim.favorites.length, favs || '<div class="muted">Нажмите ★ в карточке жителя</div>') +
      this.sec('build', 'Стройки', sites.length, build) +
      this.sec('caravan', 'Караваны', car ? 1 : 0, caravan) +
      this.sec('events', 'События', ev.length, ev.join('')) +
      `<div class="muted small ofoot">Разговоров сейчас: ${talks}</div>`;
  }
}
