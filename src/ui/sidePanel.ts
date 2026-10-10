import type { Game } from '../main';
import { Citizen, fullName, professionName, NEED_NAMES, NeedKey, traitName, TRAIT_NAMES } from '../sim/citizen';
import { Building, BUILDING_DEFS, DISTRICT_NAMES } from '../world/buildings';
import { formatDate } from '../core/time';
import { getCitizenSprite } from '../render/citizenSprites';
import { ACTION_LABELS } from '../ai/actions';
import { moodWord } from '../sim/needs';

export class SidePanel {
  el: HTMLElement;
  private game: Game;
  private mode: 'none' | 'citizen' | 'building' = 'none';
  private id = -1;
  private lastRender = 0;

  constructor(root: HTMLElement, game: Game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.id = 'side';
    this.el.className = 'panel';
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.classList.contains('close')) this.game.deselect();
      const cid = t.getAttribute('data-citizen');
      if (cid) this.game.selectCitizen(Number(cid), true);
      const bid = t.getAttribute('data-building');
      if (bid) {
        const b = this.game.sim.world.buildings[Number(bid)];
        this.game.panTo(b.doorX, b.doorY);
        this.game.selectBuilding(Number(bid));
      }
      if (t.id === 'follow') this.game.toggleFollow();
    });
  }

  showCitizen(id: number): void {
    this.mode = 'citizen';
    this.id = id;
    this.el.style.display = 'block';
    this.renderCitizen();
  }

  showBuilding(id: number): void {
    this.mode = 'building';
    this.id = id;
    this.el.style.display = 'block';
    this.renderBuilding();
  }

  hide(): void {
    this.mode = 'none';
    this.el.style.display = 'none';
  }

  update(): void {
    if (this.mode === 'none') return;
    const now = performance.now();
    if (now - this.lastRender < 500) return;
    this.lastRender = now;
    if (this.mode === 'citizen') this.renderCitizen();
    else this.renderBuilding();
  }

  citizenTooltip(c: Citizen): string {
    const act = c.state === 3 ? 'беседует' : (ACTION_LABELS[c.action] ?? '');
    return `<b>${fullName(c)}</b>, ${c.age} · ${professionName(c)}<br>${act} · ${moodWord(c.mood)}<br><i>${c.thought || ''}</i>`;
  }

  buildingTooltip(b: Building): string {
    const def = BUILDING_DEFS[b.type];
    const name = b.name ? `«${b.name}» (${def.name.toLowerCase()})` : def.name;
    const res = b.residents.length ? `<br>Жильцов: ${b.residents.length}` : '';
    const wk = b.workers.length ? `<br>Работников: ${b.workers.length}` : '';
    return `<b>${name}</b>${res}${wk}`;
  }

  private renderCitizen(): void {
    const sim = this.game.sim;
    const c = sim.citizens[this.id];
    if (!c) return this.hide();
    const needs = (Object.keys(NEED_NAMES) as NeedKey[])
      .map((k) => {
        const v = Math.round(c.needs[k]);
        return `<div class="bar"><span class="name">${NEED_NAMES[k]}</span><div class="track"><div class="fill" style="width:${v}%"></div></div><span class="val">${v}</span></div>`;
      })
      .join('');
    const traits = c.traits.map((t) => `<span title="${TRAIT_NAMES[t].desc}">${traitName(t, c.sex)}</span>`).join('');
    const home = c.home >= 0 ? `<span class="link" data-building="${c.home}">${BUILDING_DEFS[sim.world.buildings[c.home].type].name.toLowerCase()}</span>` : 'нет (бездомный)';
    const work = c.workplace >= 0 ? `<span class="link" data-building="${c.workplace}">${sim.world.buildings[c.workplace].name || BUILDING_DEFS[sim.world.buildings[c.workplace].type].name.toLowerCase()}</span>` : '—';
    const fam: string[] = [];
    if (c.spouse >= 0 && sim.citizens[c.spouse]?.alive) fam.push(`${c.sex === 'm' ? 'Жена' : 'Муж'}: ${this.link(c.spouse)}`);
    const kids = c.children.filter((k) => sim.citizens[k]?.alive);
    if (kids.length) fam.push(`Дети: ${kids.map((k) => this.link(k)).join(', ')}`);
    const par = c.parents.filter((k) => sim.citizens[k]?.alive);
    if (par.length) fam.push(`Родители: ${par.map((k) => this.link(k)).join(', ')}`);
    const rels = [...c.relations.entries()]
      .filter(([id]) => sim.citizens[id]?.alive)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 8)
      .map(([id, v]) => `<div class="rel"><span class="${v > 20 ? 'good' : v < -20 ? 'bad' : ''}">${v > 0 ? '+' : ''}${Math.round(v)}</span> ${this.link(id)} — ${relWord(v)}</div>`)
      .join('');
    const mems = [...c.memories]
      .slice(-8)
      .reverse()
      .map((m) => `<div><span class="t">${formatDate(m.tick)}:</span> ${m.text}</div>`)
      .join('');
    const bio = [...c.bio]
      .slice(-12)
      .reverse()
      .map((b) => `<div><span class="t">${formatDate(b.tick)}:</span> ${b.text}</div>`)
      .join('');
    const inv = Object.entries(c.inventory)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${GOOD_NAMES[k] ?? k}: ${n}`)
      .join(', ');
    const portrait = this.portrait(c);
    const following = this.game.renderer.camera.follow ? 'Не следовать' : 'Следовать (F)';
    this.el.innerHTML = `
      <button class="close" title="Закрыть (Esc)">✕</button>
      ${portrait}
      <h2>${fullName(c)}</h2>
      <div class="sub">${professionName(c)}, ${c.age} ${ageWord(c.age)} · ${c.state === 3 ? 'беседует' : (ACTION_LABELS[c.action] ?? '')} · ${moodWord(c.mood)}</div>
      <div class="thought">«${c.thought || '…'}»</div>
      <div class="traits">${traits}</div>
      <div class="section"><h3>Потребности</h3>${needs}</div>
      <div class="section"><h3>Хозяйство</h3>
        <div>Деньги: <b>${Math.round(c.money)}</b> монет</div>
        <div>Дом: ${home}</div>
        <div>Работа: ${work}</div>
        <div>Инвентарь: ${inv || 'пусто'}</div>
      </div>
      <div class="section"><h3>Семья</h3>${fam.length ? fam.join('<br>') : 'одинок(а)'}</div>
      <div class="section"><h3>Отношения</h3>${rels || 'пока ни с кем не знаком(а)'}</div>
      <div class="section"><h3>Память</h3><div class="bio">${mems || 'ничего примечательного'}</div></div>
      <div class="section"><h3>Биография</h3><div class="bio">${bio || '—'}</div></div>
      <div class="actions"><button class="btn small" id="follow">${following}</button></div>`;
  }

  private portrait(c: Citizen): string {
    const s = getCitizenSprite(c, 0, 0);
    const cv = document.createElement('canvas');
    cv.width = s.w;
    cv.height = s.h;
    cv.getContext('2d')!.drawImage(s.canvas, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
    return `<img class="portrait" src="${cv.toDataURL()}" alt="">`;
  }

  private link(id: number): string {
    const c = this.game.sim.citizens[id];
    if (!c) return '?';
    return `<span class="link" data-citizen="${id}">${fullName(c)}</span>`;
  }

  private renderBuilding(): void {
    const sim = this.game.sim;
    const b = sim.world.buildings[this.id];
    if (!b) return this.hide();
    const def = BUILDING_DEFS[b.type];
    const residents = b.residents.filter((id) => sim.citizens[id]?.alive).map((id) => this.link(id)).join(', ');
    const workers = b.workers.filter((id) => sim.citizens[id]?.alive).map((id) => this.link(id)).join(', ');
    const storage = Object.entries(b.storage)
      .filter(([k, n]) => n >= 0.5 && !k.startsWith('_') && k !== 'revenue' && k !== 'money')
      .map(([k, n]) => `${GOOD_NAMES[k] ?? k}: ${Math.round(n)}`)
      .join(', ');
    const revenue = b.storage['revenue'] ? `<div>Выручка за всё время: ${Math.round(b.storage['revenue'])} монет</div>` : '';
    const owner = b.owner >= 0 && sim.citizens[b.owner]?.alive ? this.link(b.owner) : '—';
    this.el.innerHTML = `
      <button class="close" title="Закрыть (Esc)">✕</button>
      <h2>${b.name ? `«${b.name}»` : def.name}</h2>
      <div class="sub">${b.name ? def.name + ' · ' : ''}${DISTRICT_NAMES[b.district]} · ${MATERIAL_NAMES[b.material]}, крыша — ${ROOF_NAMES[b.roof]}</div>
      <div class="section"><h3>Состояние</h3>
        <div class="bar"><span class="name">Целостность</span><div class="track"><div class="fill" style="width:${Math.round(b.condition * 100)}%"></div></div><span class="val">${Math.round(b.condition * 100)}</span></div>
        <div>Владелец: ${owner}</div>
        ${def.hours ? `<div>Часы работы: ${def.workers ? `${def.hours[0]}:00–${def.hours[1] % 24}:00` : '—'}</div>` : ''}
      </div>
      ${def.home ? `<div class="section"><h3>Жильцы (${b.residents.length}/${def.capacity})</h3>${residents || 'никто не живёт'}</div>` : ''}
      ${def.workers ? `<div class="section"><h3>Работники (${b.workers.length}/${def.workers})</h3>${workers || 'никого'}</div>` : ''}
      <div class="section"><h3>Запасы</h3>${storage || 'пусто'}${revenue}</div>`;
  }
}

const MATERIAL_NAMES: Record<string, string> = { wood: 'дерево', timber: 'фахверк', stone: 'камень', brick: 'кирпич' };
const ROOF_NAMES: Record<string, string> = { thatch: 'солома', tile: 'черепица', slate: 'сланец', wood: 'дранка' };
export const GOOD_NAMES: Record<string, string> = {
  bread: 'хлеб', grain: 'зерно', flour: 'мука', meat: 'мясо', hide: 'шкуры', leather: 'кожа', wood: 'брёвна', planks: 'доски', stone: 'камень', ale: 'эль', tools: 'инструменты', goods: 'изделия', cloth: 'ткань', money: 'деньги', food: 'еда',
};

function ageWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'год';
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'года';
  return 'лет';
}

function relWord(v: number): string {
  if (v >= 70) return 'близкий друг';
  if (v >= 40) return 'друг';
  if (v >= 15) return 'приятель';
  if (v > -15) return 'знакомый';
  if (v > -40) return 'недолюбливает';
  if (v > -70) return 'враждует';
  return 'заклятый враг';
}
