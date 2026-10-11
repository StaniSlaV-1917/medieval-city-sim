import type { Game } from '../main';
import { POWERS, applyPower } from '../sim/god';
import { Profession } from '../sim/citizen';
import type { Win } from './windows';

export class GodPanel {
  el: HTMLElement;
  private game: Game;
  private msg = '';
  private last = 0;
  win: Win;

  constructor(win: Win, game: Game) {
    this.game = game;
    this.win = win;
    this.el = win.body;
    this.el.classList.add('god');
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const pid = t.getAttribute('data-power');
      if (pid) this.usePower(pid);
    });
    this.el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      void t;
    });
  }

  private usePower(id: string): void {
    const p = POWERS.find((x) => x.id === id);
    if (!p) return;
    const sim = this.game.sim;
    if (p.needsTarget) {
      this.game.godTargeting = id;
      this.msg = `Выберите точку на карте: ${p.label.toLowerCase()} (Esc — отмена).`;
      this.render();
      return;
    }
    this.msg = applyPower(sim, id, sim.world.poi.cx, sim.world.poi.cy);
    this.render();
  }

  applyAt(tx: number, ty: number): void {
    const id = this.game.godTargeting;
    if (!id) return;
    this.game.godTargeting = null;
    this.msg = applyPower(this.game.sim, id, tx, ty);
    this.render();
  }

  toggle(force?: boolean): void {
    this.win.toggle(force);
    if (this.win.open) this.render();
  }

  update(): void {
    if (!this.win.open) return;
    const now = performance.now();
    if (now - this.last < 1500) return;
    this.last = now;
    this.renderStats();
  }

  private renderStats(): void {
    const sim = this.game.sim;
    const st = this.el.querySelector('#godstats');
    if (!st) return;
    const guards = sim.citizens.filter((c) => c.alive && c.profession === Profession.Guard && !c.actionData.visitor).length;
    st.innerHTML = `Недовольство: <b>${Math.round(sim.unrest)}</b>/100 · стражников: ${guards} · казна: ${Math.round(sim.treasury)} · пожаров: ${sim.fires.length} · больных: ${sim.citizens.filter((c) => c.alive && c.flags & 4).length}`;
  }

  private render(): void {
    const bad = POWERS.filter((p) => p.kind === 'bad').map((p) => `<button class="btn small bad" data-power="${p.id}" title="${p.hint}">${p.label}</button>`).join('');
    const good = POWERS.filter((p) => p.kind === 'good').map((p) => `<button class="btn small good" data-power="${p.id}" title="${p.hint}">${p.label}</button>`).join('');
    this.el.innerHTML = `
      <div class="sub">Бедствия и милости — выберите силу, затем точку на карте</div>
      <div class="section"><h3>Бедствия</h3><div class="powers">${bad}</div></div>
      <div class="section"><h3>Милости</h3><div class="powers">${good}</div></div>
      <div class="section"><h3>Город</h3><div id="godstats" class="stats"></div></div>
      ${this.msg ? `<div class="reaction">${this.msg}</div>` : ''}`;
    this.renderStats();
  }
}
