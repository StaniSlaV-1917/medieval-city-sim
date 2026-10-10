import type { Game } from '../main';
import { formatClock, formatDate } from '../core/time';
import { plural } from '../core/math';
import { weatherText } from '../sim/weather';
import { OVERLAY_NAMES } from '../render/overlays';

export class Hud {
  root: HTMLElement;
  private clockEl: HTMLElement;
  private dateEl: HTMLElement;
  private popEl: HTMLElement;
  private speedBtns: HTMLButtonElement[] = [];
  private topleft: HTMLElement;
  tooltip: HTMLElement;
  private game: Game;

  constructor(root: HTMLElement, game: Game) {
    this.root = root;
    this.game = game;
    const hud = document.createElement('div');
    hud.id = 'hud';
    hud.className = 'panel';
    hud.innerHTML = `
      <div class="clock">07:00</div>
      <div class="date">1-й день весны, 1-й год</div>
      <div class="speeds"></div>
      <div class="pop"></div>`;
    root.appendChild(hud);
    this.clockEl = hud.querySelector('.clock')!;
    this.dateEl = hud.querySelector('.date')!;
    this.popEl = hud.querySelector('.pop')!;
    const speeds = hud.querySelector('.speeds')!;
    const defs: [string, number][] = [['❚❚', 0], ['1×', 1], ['2×', 2], ['4×', 4], ['8×', 8]];
    for (const [label, sp] of defs) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = label;
      b.title = sp === 0 ? 'Пауза (пробел)' : `Скорость ${sp}× (клавиша ${defs.findIndex((d) => d[1] === sp)})`;
      b.addEventListener('click', () => game.setSpeed(sp));
      speeds.appendChild(b);
      this.speedBtns.push(b);
    }
    const mb = document.createElement('button');
    mb.className = 'btn market';
    mb.textContent = 'Рынок';
    mb.title = 'Цены, запасы и казна (M)';
    mb.addEventListener('click', () => game.showPanel('market'));
    hud.appendChild(mb);
    const gb = document.createElement('button');
    gb.className = 'btn god';
    gb.textContent = 'Силы';
    gb.title = 'Божественные силы (G)';
    gb.addEventListener('click', () => game.showPanel('god'));
    hud.appendChild(gb);
    const sb = document.createElement('button');
    sb.className = 'btn sm';
    sb.textContent = 'Статистика';
    sb.title = 'Статистика и графики (T)';
    sb.addEventListener('click', () => game.showPanel('stats'));
    hud.appendChild(sb);
    const ob = document.createElement('button');
    ob.className = 'btn sm';
    ob.textContent = 'Оверлей';
    ob.title = 'Переключить оверлей карты (O)';
    ob.addEventListener('click', () => game.cycleOverlay());
    hud.appendChild(ob);
    const svb = document.createElement('button');
    svb.className = 'btn sm';
    svb.textContent = '💾';
    svb.title = 'Сохранить в браузере (F5 не сотрёт)';
    svb.addEventListener('click', () => game.saveGame('autosave'));
    hud.appendChild(svb);
    const exb = document.createElement('button');
    exb.className = 'btn sm';
    exb.textContent = '⤓';
    exb.title = 'Экспорт сохранения в файл JSON';
    exb.addEventListener('click', () => game.exportSave());
    hud.appendChild(exb);
    const imb = document.createElement('button');
    imb.className = 'btn sm';
    imb.textContent = '⤒';
    imb.title = 'Импорт сохранения из файла JSON';
    imb.addEventListener('click', () => game.importSave());
    hud.appendChild(imb);
    const tl = document.createElement('div');
    tl.id = 'topleft';
    tl.className = 'panel';
    root.appendChild(tl);
    this.topleft = tl;
    const tt = document.createElement('div');
    tt.id = 'tooltip';
    root.appendChild(tt);
    this.tooltip = tt;
    const help = document.createElement('div');
    help.id = 'help';
    help.className = 'panel';
    help.innerHTML = `<kbd>WASD</kbd> камера · <kbd>колесо</kbd> зум · <kbd>пробел</kbd> пауза · <kbd>1</kbd>–<kbd>4</kbd> скорость · <kbd>F</kbd> следовать · <kbd>M</kbd> рынок · <kbd>G</kbd> силы · <kbd>T</kbd> статистика · <kbd>O</kbd> оверлей · <kbd>Esc</kbd> снять`;
    root.appendChild(help);
  }

  update(fps: number): void {
    const sim = this.game.sim;
    const t = sim.tick;
    this.clockEl.textContent = formatClock(t);
    this.dateEl.textContent = `${formatDate(t)} · ${weatherText(sim.weather, sim.season)}, ${Math.round(sim.weather.temp)}°`;
    const n = sim.stats.population;
    this.popEl.textContent = `${n} ${plural(n, 'житель', 'жителя', 'жителей')}`;
    const sp = this.game.paused ? 0 : this.game.speed;
    const order = [0, 1, 2, 4, 8];
    this.speedBtns.forEach((b, i) => b.classList.toggle('active', order[i] === sp));
    const seedLine = `<b>${sim.seedText}</b> · ${sim.world.sizeName}`;
    const ov = this.game.renderer.showOverlay;
    const paused = this.game.paused ? ' · <b>ПАУЗА</b>' : '';
    this.topleft.innerHTML = `${seedLine}${paused}<br><span class="fps">${fps.toFixed(0)} FPS · объектов: ${this.game.renderer.debug.drawn}</span>${ov !== 'none' ? `<br><span class="overlay">Оверлей: ${OVERLAY_NAMES[ov]}</span>` : ''}${this.game.autosaveStatus ? `<br><span class="fps">${this.game.autosaveStatus}</span>` : ''}`;
  }

  showTooltip(x: number, y: number, html: string): void {
    this.tooltip.style.display = 'block';
    this.tooltip.innerHTML = html;
    const w = this.tooltip.offsetWidth;
    const h = this.tooltip.offsetHeight;
    let tx = x + 14;
    let ty = y + 14;
    if (tx + w > window.innerWidth - 8) tx = x - w - 8;
    if (ty + h > window.innerHeight - 8) ty = y - h - 8;
    this.tooltip.style.left = `${tx}px`;
    this.tooltip.style.top = `${ty}px`;
  }

  hideTooltip(): void {
    this.tooltip.style.display = 'none';
  }
}
