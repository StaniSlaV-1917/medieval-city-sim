import type { Game } from '../main';
import { GOODS, GOOD_INFO } from '../economy/goods';
import type { Win } from './windows';

export class MarketPanel {
  el: HTMLElement;
  private game: Game;
  private last = 0;
  win: Win;

  constructor(win: Win, game: Game) {
    this.game = game;
    this.win = win;
    this.el = win.body;
    this.el.classList.add('market');
    this.el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.id === 'taxrate') {
        this.game.sim.taxRate = Number(t.value) / 100;
        const lbl = this.el.querySelector('#taxlabel');
        if (lbl) lbl.textContent = `${t.value}%`;
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
    if (now - this.last < 1000) return;
    this.last = now;
    this.render();
  }

  private render(): void {
    const sim = this.game.sim;
    const m = sim.market;
    const rows = GOODS.map((g) => {
      const p = m.prices[g];
      const base = GOOD_INFO[g].base;
      const k = p / base;
      const cls = k > 1.3 ? 'up' : k < 0.85 ? 'down' : '';
      const arrow = k > 1.3 ? '▲' : k < 0.85 ? '▼' : '·';
      const d = m.stock[g] - m.dayStartStock[g];
      const dTxt = Math.abs(d) >= 0.5 ? `<span class="${d > 0 ? 'good' : 'bad'}">${d > 0 ? '+' : ''}${Math.round(d)}</span>` : '·';
      return `<tr><td>${GOOD_INFO[g].name}</td><td class="${cls}">${p.toFixed(1)} ${arrow}</td><td>${Math.round(m.stock[g])} ${dTxt}</td><td>${Math.round(m.soldYesterday[g])}</td></tr>`;
    }).join('');
    const taxPct = Math.round(sim.taxRate * 100);
    this.el.innerHTML = `
      <div class="sub">Урожай года: ${m.yearFactor < 0.8 ? 'скудный' : m.yearFactor > 1.2 ? 'богатый' : 'обычный'} · сезонный множитель ${m.harvest(sim).toFixed(2)}</div>
      <table class="prices"><tr><th>Товар</th><th>Цена</th><th>Запас (за день)</th><th>Продано вчера</th></tr>${rows}</table>
      <div class="section"><h3>Казна</h3>
        <div>В казне: <b>${Math.round(sim.treasury)}</b> монет · собрано налогов за день: ${sim.lastTax} · раздано бедным: ${sim.lastCharity}</div>
        <div>Вывоз за город: ${Math.round(sim.exportIncome)} · ввоз: ${Math.round(sim.importCost)} · всего денег в городе: ${Math.round(sim.totalMoney())}</div>
        <div class="slider"><label for="taxrate">Налоги: <span id="taxlabel">${taxPct}%</span></label><input id="taxrate" type="range" min="0" max="30" value="${taxPct}"></div>
      </div>`;
  }
}
