import type { Game } from '../main';
import { POWERS, applyPower } from '../sim/god';
import { Profession } from '../sim/citizen';

export class GodPanel {
  el: HTMLElement;
  private game: Game;
  private visible = false;
  private msg = '';
  private last = 0;

  constructor(root: HTMLElement, game: Game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.id = 'god';
    this.el.className = 'panel';
    this.el.style.display = 'none';
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.classList.contains('close')) this.toggle(false);
      const pid = t.getAttribute('data-power');
      if (pid) this.usePower(pid);
    });
    this.el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.id === 'guards') {
        this.game.sim.guardTarget = Number(t.value);
        const l = this.el.querySelector('#guardlabel');
        if (l) l.textContent = t.value;
      }
      if (t.id === 'taxrate2') {
        this.game.sim.taxRate = Number(t.value) / 100;
        const l = this.el.querySelector('#taxlabel2');
        if (l) l.textContent = `${t.value}%`;
      }
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
    this.visible = force ?? !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
    if (this.visible) this.render();
  }

  update(): void {
    if (!this.visible) return;
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
    const sim = this.game.sim;
    const bad = POWERS.filter((p) => p.kind === 'bad').map((p) => `<button class="btn small bad" data-power="${p.id}" title="${p.hint}">${p.label}</button>`).join('');
    const good = POWERS.filter((p) => p.kind === 'good').map((p) => `<button class="btn small good" data-power="${p.id}" title="${p.hint}">${p.label}</button>`).join('');
    const guards = sim.citizens.filter((c) => c.alive && c.profession === Profession.Guard && !c.actionData.visitor).length;
    const gt = sim.guardTarget >= 0 ? sim.guardTarget : guards;
    this.el.innerHTML = `
      <button class="close" title="Закрыть (G)">✕</button>
      <h2>Длань небес</h2>
      <div class="sub">Бедствия и милости — выберите силу, затем точку на карте</div>
      <div class="section"><h3>Бедствия</h3><div class="powers">${bad}</div></div>
      <div class="section"><h3>Милости</h3><div class="powers">${good}</div></div>
      <div class="section"><h3>Управление</h3>
        <div class="slider"><label>Налоги: <span id="taxlabel2">${Math.round(sim.taxRate * 100)}%</span></label><input id="taxrate2" type="range" min="0" max="30" value="${Math.round(sim.taxRate * 100)}"></div>
        <div class="slider"><label>Стража: <span id="guardlabel">${gt}</span></label><input id="guards" type="range" min="2" max="30" value="${gt}"></div>
        <div id="godstats" class="stats"></div>
      </div>
      ${this.msg ? `<div class="reaction">${this.msg}</div>` : ''}`;
    this.renderStats();
  }
}
