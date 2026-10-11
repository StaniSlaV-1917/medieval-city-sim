// Субтитры: при слежении за жителем — весь его разговор внизу экрана с именами говорящих.
import type { Game } from '../main';
import { fullName } from '../sim/citizen';

export class Subtitles {
  el: HTMLElement;
  private game: Game;
  private lastKey = '';

  constructor(root: HTMLElement, game: Game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.id = 'subtitles';
    this.el.className = 'panel';
    this.el.style.display = 'none';
    root.appendChild(this.el);
  }

  update(): void {
    const g = this.game;
    const id = g.followId;
    if (!g.settings.subtitles || id < 0 || !g.renderer.camera.follow) return this.hide();
    const sim = g.sim;
    const c = sim.citizens[id];
    if (!c || !c.alive) return this.hide();
    let talk = null;
    for (const t of sim.talks.values()) if (t.a === id || t.b === id) talk = t;
    const rows: { who: number; text: string }[] = [];
    if (talk && talk.history && talk.history.length) rows.push(...talk.history.slice(-4));
    else if (c.speech && !c.speech.thought && c.speech.until > sim.tick) rows.push({ who: id, text: c.speech.text });
    else if (c.speech && c.speech.thought && c.speech.until > sim.tick) rows.push({ who: id, text: `(думает) ${c.speech.text}` });
    if (!rows.length) return this.hide();
    const key = rows.map((r) => r.who + r.text).join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.el.style.display = 'block';
    this.el.innerHTML = rows
      .map((r, i) => {
        const sp = sim.citizens[r.who];
        const name = sp ? fullName(sp) : '?';
        return `<div class="sl ${i === rows.length - 1 ? 'cur' : ''} ${r.who === id ? 'me' : ''}"><span class="nm">${name}:</span> ${r.text}</div>`;
      })
      .join('');
  }

  hide(): void {
    if (this.el.style.display !== 'none') {
      this.el.style.display = 'none';
      this.lastKey = '';
    }
  }
}
