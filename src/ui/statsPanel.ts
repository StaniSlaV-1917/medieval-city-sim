import type { Game } from '../main';
import { plural } from '../core/math';
import type { Win } from './windows';

const SERIES: { key: 'population' | 'treasury' | 'bread' | 'avgHunger' | 'avgMood' | 'crimes' | 'health' | 'unrest'; label: string; color: string; scale?: number }[] = [
  { key: 'population', label: 'Население', color: '#2a4a9a' },
  { key: 'treasury', label: 'Казна', color: '#b8902a' },
  { key: 'avgHunger', label: 'Сытость', color: '#4a6a2a' },
  { key: 'health', label: 'Здоровье', color: '#2a8a6a' },
  { key: 'avgMood', label: 'Счастье', color: '#8a3a7a' },
  { key: 'crimes', label: 'Преступления/день', color: '#8a2a1e' },
  { key: 'bread', label: 'Цена хлеба', color: '#a0702a' },
  { key: 'unrest', label: 'Недовольство', color: '#5a2a2a' },
];

export class StatsPanel {
  el: HTMLElement;
  private game: Game;
  private canvas: HTMLCanvasElement;
  private last = 0;
  win: Win;

  constructor(win: Win, game: Game) {
    this.game = game;
    this.win = win;
    this.el = win.body;
    this.el.classList.add('stats');
    this.el.innerHTML = `<div class="summary"></div><canvas width="420" height="300"></canvas><div class="legend"></div>`;
    this.canvas = this.el.querySelector('canvas')!;
    this.el.querySelector('.legend')!.innerHTML = SERIES.map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('');
  }

  toggle(force?: boolean): void {
    this.win.toggle(force);
    if (this.win.open) this.render();
  }

  update(): void {
    if (!this.win.open) return;
    const now = performance.now();
    if (now - this.last < 2000) return;
    this.last = now;
    this.render();
  }

  private render(): void {
    const sim = this.game.sim;
    const st = sim.computeStats();
    const crimesToday = sim.crimeLog.filter((r) => sim.tick - r.tick < 7200).length;
    const sick = sim.citizens.filter((c) => c.alive && c.flags & 4).length;
    const food = Math.round(sim.market.stock.bread + sim.market.stock.flour * 3 + sim.market.stock.grain * 3);
    this.el.querySelector('.summary')!.innerHTML = `
      <div class="row"><span>Население</span><b>${st.population}</b> <small>(${st.children} ${plural(st.children, 'ребёнок', 'ребёнка', 'детей')}, ${st.elders} ${plural(st.elders, 'старик', 'старика', 'стариков')})</small></div>
      <div class="row"><span>Казна</span><b>${Math.round(sim.treasury)}</b> <small>налог ${Math.round(sim.taxRate * 100)}%</small></div>
      <div class="row"><span>Еда (в хлебе)</span><b>${food}</b> <small>≈ ${(food / Math.max(1, st.population * 1.4)).toFixed(1)} дн.</small></div>
      <div class="row"><span>Преступления за сутки</span><b>${crimesToday}</b></div>
      <div class="row"><span>Счастье</span><b>${Math.round(st.avgMood)}</b> <small>недовольство ${Math.round(sim.unrest)}</small></div>
      <div class="row"><span>Здоровье</span><b>${Math.round(st.avgHealth)}</b> <small>больных ${sick}, умерло ${sim.deaths}</small></div>
      <div class="row"><span>Без работы / без крова</span><b>${st.unemployed} / ${st.homeless}</b></div>`;
    this.drawChart();
  }

  private drawChart(): void {
    const g = this.canvas.getContext('2d')!;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.fillStyle = '#f6efe0';
    g.fillRect(0, 0, W, H);
    const hist = this.game.sim.history;
    if (hist.length < 2) {
      g.fillStyle = '#5a4630';
      g.font = '13px Georgia, serif';
      g.fillText('Графики появятся после первых дней.', 20, H / 2);
      return;
    }
    const left = 36;
    const bottom = H - 18;
    const top = 10;
    g.strokeStyle = '#b9a680';
    g.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      const y = top + ((bottom - top) * k) / 4;
      g.beginPath();
      g.moveTo(left, y);
      g.lineTo(W - 8, y);
      g.stroke();
    }
    g.fillStyle = '#5a4630';
    g.font = '10px Georgia, serif';
    g.fillText(`день ${hist[0].day}`, left, H - 5);
    g.fillText(`день ${hist[hist.length - 1].day}`, W - 60, H - 5);
    g.fillText('100%', 4, top + 10);
    g.fillText('0', 14, bottom);
    // каждая серия нормируется на свой максимум
    for (const s of SERIES) {
      const vals = hist.map((h) => h[s.key] ?? 0);
      const max = Math.max(1, ...vals);
      const min = Math.min(0, ...vals);
      g.strokeStyle = s.color;
      g.lineWidth = 1.5;
      g.beginPath();
      vals.forEach((v, i) => {
        const x = left + ((W - 8 - left) * i) / (vals.length - 1);
        const y = bottom - ((v - min) / (max - min)) * (bottom - top);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.stroke();
      // подпись последнего значения
      const lastV = vals[vals.length - 1];
      const y = bottom - ((lastV - min) / (max - min)) * (bottom - top);
      g.fillStyle = s.color;
      g.fillText(String(Math.round(lastV * 10) / 10), W - 30, Math.max(10, Math.min(bottom, y - 2)));
    }
  }
}
