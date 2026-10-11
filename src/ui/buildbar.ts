// Нижняя панель строительства (фаза 14): вкладки-категории, кнопки построек с карточкой при наведении,
// строка подсказки активного инструмента.
import type { Game } from '../main';
import { iconImg } from './icons';
import { BUILD_CATEGORIES, BUILD_CATALOG, BuildCategory, BuildItem, recipeText, costText, NEAR_NAMES } from '../data/buildCatalog';
import { BUILDING_DEFS } from '../world/buildings';
import { esc } from './topbar';
import { materialAvailable } from '../sim/build';
import { Good } from '../economy/goods';

export class BuildBar {
  el: HTMLElement;
  private game: Game;
  private cat: BuildCategory | null = null;
  private tabsEl: HTMLElement;
  private itemsEl: HTMLElement;
  private hintEl: HTMLElement;
  private last = 0;

  constructor(root: HTMLElement, game: Game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.id = 'buildbar';
    this.el.className = 'panel';
    this.el.dataset.fixed = '1';
    this.el.innerHTML = `<div class="hint"></div><div class="items"></div><div class="tabs"><span class="bt">${iconImg('build', 14)} Строительство</span></div>`;
    this.tabsEl = this.el.querySelector('.tabs')!;
    this.itemsEl = this.el.querySelector('.items')!;
    this.hintEl = this.el.querySelector('.hint')!;
    for (const c of BUILD_CATEGORIES) {
      const b = document.createElement('button');
      b.className = 'btn bc';
      b.dataset.cat = c.id;
      b.innerHTML = `${iconImg(c.icon, 14)}<span>${c.name}</span>`;
      b.addEventListener('click', () => this.setCat(this.cat === c.id ? null : c.id));
      this.tabsEl.appendChild(b);
    }
    root.appendChild(this.el);
    this.itemsEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-item]');
      if (!b) return;
      this.game.build.select(b.dataset.item!);
      this.update();
    });
    this.hintEl.style.display = 'none';
  }

  toggle(): void {
    this.setCat(this.cat ? null : 'housing');
  }

  setCat(c: BuildCategory | null): void {
    this.cat = c;
    this.renderItems();
    this.update();
  }

  private card(it: BuildItem): string {
    const sim = this.game.sim;
    const lines: string[] = [`<b>${it.name}</b>`, it.desc];
    const cost = Object.entries(it.cost).filter(([, n]) => n).map(([g, n]) => {
      const have = materialAvailable(sim, g as Good);
      return `<span class="${have >= (n ?? 0) ? 'good' : 'bad'}">${n} ${g === 'planks' ? 'досок' : g === 'stone' ? 'камня' : g === 'wood' ? 'брёвен' : g}</span> <span class="muted">(есть ${have})</span>`;
    });
    if (it.money) cost.push(`<span class="${sim.treasury >= it.money ? 'good' : 'bad'}">${it.money} монет</span>`);
    lines.push(`Стоимость: ${cost.join(', ') || 'бесплатно'}`);
    if (it.type !== undefined) {
      const def = BUILDING_DEFS[it.type];
      const r = recipeText(it.type);
      lines.push(`Размер ${def.minW}×${def.minH}${def.workers ? ` · рабочих: ${def.workers}` : ''}${def.home ? ` · жильцов: ${def.capacity}` : ''}`);
      if (r.produces) lines.push(`Производит: ${r.produces}`);
      if (r.consumes) lines.push(`Потребляет: ${r.consumes}`);
      if (r.sells) lines.push(`Продаёт: ${r.sells}`);
      const req: string[] = [];
      if (it.near) req.push(NEAR_NAMES[it.near]);
      if (it.minPop) req.push(`население от ${it.minPop}`);
      if (it.needsNode) req.push(`узел развития «${it.needsNode}»`);
      if (def.unique) req.push('одно на город');
      if (req.length) lines.push(`Требования: ${req.join(', ')}`);
      if (it.influence) lines.push(`Радиус влияния: ${it.influence}`);
      if (it.workRadius) lines.push(`Радиус работы: ${it.workRadius}`);
    }
    void costText;
    return lines.join('<br>');
  }

  private renderItems(): void {
    if (!this.cat) {
      this.itemsEl.innerHTML = '';
      this.itemsEl.style.display = 'none';
      return;
    }
    this.itemsEl.style.display = 'flex';
    const items = BUILD_CATALOG.filter((i) => i.category === this.cat);
    this.itemsEl.innerHTML = items.map((it) => `<button class="btn bi" data-item="${it.id}" data-tip="${esc(this.card(it))}">${it.name}</button>`).join('');
  }

  update(): void {
    const now = performance.now();
    const active = this.game.build.item;
    for (const b of Array.from(this.itemsEl.querySelectorAll<HTMLElement>('[data-item]'))) b.classList.toggle('active', !!active && b.dataset.item === active.id);
    for (const b of Array.from(this.tabsEl.querySelectorAll<HTMLElement>('[data-cat]'))) b.classList.toggle('active', b.dataset.cat === this.cat);
    const pv = this.game.build.preview;
    const msg = this.game.build.message;
    const text = active ? `${pv?.text ?? ''}${msg ? ` — <b>${msg}</b>` : ''}` : msg;
    this.hintEl.style.display = text ? 'block' : 'none';
    if (this.hintEl.innerHTML !== text) this.hintEl.innerHTML = text;
    if (now - this.last < 2000) return;
    this.last = now;
    // счётчики на вкладках
    const bs = this.game.sim.world.buildings;
    for (const c of BUILD_CATEGORIES) {
      const btn = this.tabsEl.querySelector<HTMLElement>(`[data-cat="${c.id}"]`)!;
      const types = BUILD_CATALOG.filter((i) => i.category === c.id && i.type !== undefined).map((i) => i.type!);
      let building = 0;
      for (const b of bs) if (b.w > 0 && types.includes(b.type) && b.underConstruction !== undefined) building++;
      btn.classList.toggle('busy', building > 0);
    }
    if (this.cat) for (const b of Array.from(this.itemsEl.querySelectorAll<HTMLElement>('[data-item]'))) {
      const it = BUILD_CATALOG.find((i) => i.id === b.dataset.item);
      if (it) b.dataset.tip = esc(this.card(it));
    }
  }
}
