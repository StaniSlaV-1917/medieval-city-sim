// Окна левой панели: Указы, Развитие, Торговля, Регион, Настройки.
// Указы/Развитие/Регион пока показывают то, что уже есть в симуляции; полная механика — в фазах 13–17.
import type { Game } from '../main';
import type { Win } from './windows';
import { BUILDING_DEFS, BuildingType } from '../world/buildings';
import { STAGE_NAMES } from '../sim/construction';
import { Tile } from '../world/tiles';
import { PAUSE_EVENTS, saveSettings } from './settings';
import { plural } from '../core/math';
import { GOOD_INFO, GOODS } from '../economy/goods';
import { TICKS_PER_DAY } from '../core/time';
import { EDICT_DEFS } from '../data/edicts';
import { DEV_NODES } from '../data/development';
import { esc } from './topbar';

abstract class WinPanel {
  el: HTMLElement;
  win: Win;
  protected game: Game;
  private last = 0;
  protected interval = 1000;

  constructor(win: Win, game: Game) {
    this.win = win;
    this.game = game;
    this.el = win.body;
  }

  toggle(force?: boolean): void {
    this.win.toggle(force);
    if (this.win.open) this.render();
  }

  update(): void {
    if (!this.win.open) return;
    const now = performance.now();
    if (now - this.last < this.interval) return;
    this.last = now;
    this.render();
  }

  protected abstract render(): void;
}

/** Указы: таблица EDICT_DEFS — действующие ползунки и заготовки будущих указов */
export class EdictsPanel extends WinPanel {
  constructor(win: Win, game: Game) {
    super(win, game);
    this.el.classList.add('edicts');
    this.el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      const def = EDICT_DEFS.find((d) => d.id === t.dataset.edict);
      if (!def || !def.set || !def.slider) return;
      def.set(this.game.sim, Number(t.value));
      const lbl = this.el.querySelector(`[data-edict-label="${def.id}"]`);
      if (lbl) lbl.textContent = def.slider.format(Number(t.value));
    });
  }

  protected render(): void {
    const sim = this.game.sim;
    if (this.el.querySelector('[data-edict]')) {
      // не перерисовывать, пока двигают ползунки — обновить только статусы
      for (const def of EDICT_DEFS) {
        const st = this.el.querySelector(`[data-edict-status="${def.id}"]`);
        if (st && def.status) st.textContent = def.status(sim);
      }
      this.el.querySelector('#ed-stats')!.innerHTML = this.statsHtml();
      return;
    }
    const active = EDICT_DEFS.filter((d) => !d.planned)
      .map((d) => {
        const v = d.get ? d.get(sim) : 0;
        const sl = d.slider!;
        return `<div class="section"><h3>${d.name}</h3>
        <div class="slider"><label>${d.name}: <span data-edict-label="${d.id}">${sl.format(v)}</span></label><input type="range" data-edict="${d.id}" min="${sl.min}" max="${sl.max}" step="${sl.step}" value="${v}"></div>
        <div class="muted small">${d.desc}</div>
        <div class="small" data-edict-status="${d.id}">${d.status ? d.status(sim) : ''}</div></div>`;
      })
      .join('');
    const planned = EDICT_DEFS.filter((d) => d.planned).map((d) => `<div class="row2 planned" data-tip="${esc(d.desc)}"><span>${d.name}</span><span class="muted">скоро</span></div>`).join('');
    this.el.innerHTML = `
      <div class="sub">Воля правителя. Действуют подать и стража; остальные указы появятся в следующих фазах.</div>
      ${active}
      <div class="section"><h3>Положение дел</h3><div id="ed-stats">${this.statsHtml()}</div></div>
      <div class="section"><h3>Будущие указы</h3>${planned}</div>`;
  }

  private statsHtml(): string {
    const sim = this.game.sim;
    const jailed = sim.citizens.filter((c) => c.alive && c.jailedUntil > sim.tick).length;
    const wanted = sim.citizens.filter((c) => c.alive && c.flags & 2).length;
    const crimesToday = sim.justice.crimesSince(sim.tick - TICKS_PER_DAY);
    return `<div>Казна: <b>${Math.round(sim.treasury)}</b> монет · недовольство: <b>${Math.round(sim.unrest)}</b>/100</div>
      <div>Преступлений за сутки: ${crimesToday} · в тюрьме ${jailed} · в розыске ${wanted}</div>`;
  }
}

/** Развитие: рост города — дома, стройки, что строится само */
export class DevelopmentPanel extends WinPanel {
  constructor(win: Win, game: Game) {
    super(win, game);
    this.el.classList.add('development');
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-building]');
      if (!t) return;
      const id = Number(t.dataset.building);
      const b = this.game.sim.world.buildings[id];
      if (!b) return;
      this.game.panTo(b.doorX, b.doorY);
      this.game.selectBuilding(id);
    });
  }

  protected render(): void {
    const sim = this.game.sim;
    const bs = sim.world.buildings.filter((b) => b.w > 0);
    const homes = bs.filter((b) => BUILDING_DEFS[b.type].home && b.condition > 0 && b.underConstruction === undefined);
    const cap = homes.reduce((s, b) => s + BUILDING_DEFS[b.type].capacity, 0);
    const sites = bs.filter((b) => b.underConstruction !== undefined);
    const ruins = bs.filter((b) => b.condition <= 0);
    const counts = new Map<number, number>();
    for (const b of bs) if (b.underConstruction === undefined && b.condition > 0) counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
    const list = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `<span class="chip">${BUILDING_DEFS[t].name} <b>${n}</b></span>`)
      .join('');
    const sitesHtml = sites.length
      ? sites.map((b) => `<div class="row2 link" data-building="${b.id}"><span>${BUILDING_DEFS[b.type].name}</span><span class="muted">${STAGE_NAMES[b.buildStage ?? 0]}, ${Math.round((b.underConstruction ?? 0) * 100)}%</span></div>`).join('')
      : '<div class="muted">сейчас ничего не строится</div>';
    const st = sim.stats;
    this.el.innerHTML = `
      <div class="sub">Город растёт сам: приезжие селятся, когда есть жильё и работа; новые дома ставят, когда хватает досок и казны. Дерево развития появится позже.</div>
      <div class="section"><h3>Жильё</h3>
        <div>Жителей: <b>${st.population}</b> · мест в домах: <b>${cap}</b> · без крова: ${st.homeless}</div>
        <div>Без работы: ${st.unemployed} · руин: ${ruins.length}</div>
      </div>
      <div class="section"><h3>Стройки (${sites.length})</h3>${sitesHtml}</div>
      <div class="section"><h3>Здания (${bs.length - ruins.length})</h3><div class="chips">${list}</div></div>
      <div class="section"><h3>Дерево развития</h3><div class="muted small">Узлы описаны, механика откроется в будущих фазах.</div><div class="chips">${DEV_NODES.map((n) => `<span class="chip planned" data-tip="${esc(`<b>${n.name}</b><br>${n.desc}<br><span class='muted'>Ступень ${n.tier} · ${n.cost} монет · открывает: ${n.unlocks}${n.requires.length ? ` · требует: ${n.requires.map((r) => DEV_NODES.find((x) => x.id === r)?.name ?? r).join(', ')}` : ''}</span>`)}">${n.name}</span>`).join('')}</div></div>`;
  }
}

/** Торговля: вывоз/ввоз, караваны, склад */
export class TradePanel extends WinPanel {
  constructor(win: Win, game: Game) {
    super(win, game);
    this.el.classList.add('trade');
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-goto]');
      if (!t) return;
      const [x, y] = t.dataset.goto!.split(',').map(Number);
      this.game.panTo(x, y);
    });
  }

  protected render(): void {
    const sim = this.game.sim;
    const m = sim.market;
    const day = Math.floor(sim.tick / TICKS_PER_DAY);
    const rows = GOODS.filter((g) => g !== 'hide')
      .map((g) => {
        const fy = m.flowsYesterday[g] ?? {};
        const ft = m.flowsToday[g] ?? {};
        const exp = (fy['вывоз за город'] ?? 0) + (ft['вывоз за город'] ?? 0) + (fy['караван скупил'] ?? 0) + (ft['караван скупил'] ?? 0);
        const imp = (fy['ввоз из-за реки'] ?? 0) + (ft['ввоз из-за реки'] ?? 0) + (fy['караван привёз'] ?? 0) + (ft['караван привёз'] ?? 0);
        if (!exp && !imp) return '';
        return `<tr><td>${GOOD_INFO[g].name}</td><td class="bad">${exp ? Math.round(exp) : '·'}</td><td class="good">${imp ? '+' + Math.round(imp) : '·'}</td><td>${m.prices[g].toFixed(1)}</td></tr>`;
      })
      .join('');
    const car = sim.caravan;
    const carHtml = car
      ? `<div>Караван <b>в городе</b> (${['подходит', 'торгует на площади', 'уходит'][Math.min(2, car.phase)] ?? 'в пути'}), купцов ${car.members.length}. <span class="link" data-goto="${car.dest.x},${car.dest.y}">показать</span></div><div class="muted small">Привёз: ${Object.entries(car.goods).filter(([, n]) => (n ?? 0) > 0).map(([g, n]) => `${GOOD_INFO[g as keyof typeof GOOD_INFO].name} ${Math.round(n ?? 0)}`).join(', ') || '—'}</div>`
      : `<div>Следующий караван ожидается через <b>${Math.max(0, sim.nextCaravanDay - day)}</b> ${plural(Math.max(0, sim.nextCaravanDay - day), 'день', 'дня', 'дней')}.</div>`;
    const wh = sim.world.buildings.find((b) => b.type === BuildingType.Warehouse && b.condition > 0);
    const whHtml = wh ? `<div>Склад «${wh.name || 'городской'}»: ${Object.entries(wh.storage).filter(([k, n]) => n >= 1 && !k.startsWith('_') && k !== 'revenue' && k !== 'money').map(([k, n]) => `${GOOD_INFO[k as keyof typeof GOOD_INFO]?.name ?? k} ${Math.round(n)}`).join(', ') || 'пусто'}</div>` : '<div class="muted">склада нет</div>';
    this.el.innerHTML = `
      <div class="sub">Излишки уходят за реку, недостающее везут купцы и караваны. Торговые договоры и пути — в будущих фазах.</div>
      <div class="section"><h3>Итоги</h3>
        <div>Выручка от вывоза за всё время: <b>+${Math.round(sim.exportIncome)}</b> · расходы на ввоз: <b>−${Math.round(sim.importCost)}</b></div>
        ${whHtml}
      </div>
      <div class="section"><h3>Караваны</h3>${carHtml}</div>
      <div class="section"><h3>Движение товаров за два дня</h3>
        ${rows ? `<table class="prices"><tr><th>Товар</th><th>Вывоз</th><th>Ввоз</th><th>Цена</th></tr>${rows}</table>` : '<div class="muted">за последние два дня внешней торговли не было</div>'}
      </div>`;
  }
}

/** Регион: окрестности города */
export class RegionPanel extends WinPanel {
  constructor(win: Win, game: Game) {
    super(win, game);
    this.el.classList.add('region');
    this.interval = 3000;
  }

  protected render(): void {
    const sim = this.game.sim;
    const w = sim.world;
    let forest = 0;
    let field = 0;
    let water = 0;
    let rock = 0;
    for (let i = 0; i < w.tiles.length; i++) {
      const t = w.tiles[i];
      if (t === Tile.Forest) forest++;
      else if (t === Tile.Field) field++;
      else if (t === Tile.Water || t === Tile.Shallow) water++;
      else if (t === Tile.Rock || t === Tile.Quarry) rock++;
    }
    const farms = w.buildings.filter((b) => b.type === BuildingType.Farm && b.condition > 0).length;
    const animals = sim.animals.length;
    const day = Math.floor(sim.tick / TICKS_PER_DAY);
    this.el.innerHTML = `
      <div class="sub">Земли вокруг стен. Карта региона, соседние деревни и дороги появятся в будущих фазах.</div>
      <div class="section"><h3>Угодья</h3>
        <div>Леса: <b>${forest}</b> ${plural(forest, 'делянка', 'делянки', 'делянок')} · поля: <b>${field}</b> (${farms} ${plural(farms, 'ферма', 'фермы', 'ферм')})</div>
        <div>Воды: ${water} тайлов · камня: ${rock}</div>
        <div>Живности в округе: ${animals}</div>
      </div>
      <div class="section"><h3>Угрозы</h3>
        <div>Разбойники: ${sim.raid ? '<b class="bad">у ворот!</b>' : `замечены не ближе чем через ${Math.max(0, sim.nextRaidDay - day)} ${plural(Math.max(0, sim.nextRaidDay - day), 'день', 'дня', 'дней')}`}</div>
        <div>Дракон: ${sim.dragon ? '<b class="bad">над городом</b>' : 'не видно'} · наводнение: ${sim.flood ? '<b class="bad">идёт</b>' : 'нет'}</div>
      </div>`;
  }
}

/** Настройки интерфейса */
export class SettingsPanel extends WinPanel {
  constructor(win: Win, game: Game) {
    super(win, game);
    this.el.classList.add('settings');
    this.interval = 1e9;
    this.el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      const s = this.game.settings;
      if (t.id === 'st-scale') {
        s.scale = Number(t.value) / 100;
        this.el.querySelector('#st-scalelabel')!.textContent = `${t.value}%`;
        this.game.applyScale();
      }
      if (t.id === 'st-density') {
        s.bubbleDensity = Number(t.value) / 100;
        this.el.querySelector('#st-densitylabel')!.textContent = `${t.value}%`;
      }
      if (t.id === 'st-subtitles') s.subtitles = t.checked;
      if (t.id === 'st-toasts') s.toasts = t.checked;
      if (t.dataset.pause) s.pauseOn[t.dataset.pause] = t.checked;
      saveSettings(s);
    });
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.id === 'st-reset') {
        try {
          localStorage.removeItem('waldmark.ui.windows');
        } catch {
          /* ignore */
        }
        location.reload();
      }
      if (t.id === 'st-save') void this.game.saveGame('autosave');
      if (t.id === 'st-export') this.game.exportSave();
      if (t.id === 'st-import') void this.game.importSave();
    });
  }

  protected render(): void {
    const s = this.game.settings;
    const pct = Math.round(s.scale * 100);
    const checks = PAUSE_EVENTS.map((p) => `<label class="chk"><input type="checkbox" data-pause="${p.id}" ${s.pauseOn[p.id] ? 'checked' : ''}> ${p.label}</label>`).join('');
    this.el.innerHTML = `
      <div class="section"><h3>Интерфейс</h3>
        <div class="slider"><label for="st-scale">Масштаб интерфейса: <span id="st-scalelabel">${pct}%</span></label><input id="st-scale" type="range" min="80" max="150" step="5" value="${pct}"></div>
        <div class="slider"><label for="st-density">Плотность облачков: <span id="st-densitylabel">${Math.round(s.bubbleDensity * 100)}%</span></label><input id="st-density" type="range" min="50" max="200" step="10" value="${Math.round(s.bubbleDensity * 100)}"></div>
        <label class="chk"><input type="checkbox" id="st-subtitles" ${s.subtitles ? 'checked' : ''}> Субтитры разговоров при слежении за жителем</label>
        <label class="chk"><input type="checkbox" id="st-toasts" ${s.toasts ? 'checked' : ''}> Всплывающие уведомления о событиях</label>
      </div>
      <div class="section"><h3>Пауза при событиях</h3><div class="checks">${checks}</div></div>
      <div class="section"><h3>Сохранения</h3>
        <div class="btns"><button class="btn small" id="st-save">💾 Сохранить в браузере</button><button class="btn small" id="st-export">⤓ Экспорт в файл</button><button class="btn small" id="st-import">⤒ Импорт из файла</button></div>
        <div class="muted small">Автосохранение — каждый игровой день и раз в две минуты. ${this.game.autosaveStatus}</div>
      </div>
      <div class="section"><h3>Окна</h3><button class="btn small" id="st-reset">Сбросить расположение окон</button></div>
      <div class="section"><h3>Клавиши</h3><div class="keys small">
        <kbd>WASD</kbd> камера · <kbd>колесо</kbd> зум · <kbd>пробел</kbd> пауза · <kbd>1</kbd>–<kbd>4</kbd> скорость · <kbd>F</kbd> следовать · <kbd>H</kbd> к площади<br>
        <kbd>M</kbd> хозяйство · <kbd>E</kbd> указы · <kbd>R</kbd> развитие · <kbd>Y</kbd> торговля · <kbd>N</kbd> регион · <kbd>L</kbd> летопись · <kbd>T</kbd> статистика · <kbd>G</kbd> длань небес · <kbd>O</kbd> оверлей<br>
        <kbd>Esc</kbd> закрыть верхнее окно / снять выбор · <kbd>Tab</kbd> чистый экран</div></div>`;
  }
}
