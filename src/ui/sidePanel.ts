import type { Game } from '../main';
import { Citizen, fullName, professionName, NEED_NAMES, NeedKey, traitName, TRAIT_NAMES } from '../sim/citizen';
import { Building, BUILDING_DEFS, DISTRICT_NAMES } from '../world/buildings';
import { formatDate } from '../core/time';
import { getCitizenSprite } from '../render/citizenSprites';
import { ACTION_LABELS } from '../ai/actions';
import { CRIME_LABELS } from '../sim/crime';
import { HEALTH_LABELS } from '../sim/health';
import { FIRE_LABELS } from '../sim/fire';
import { EVENT_LABELS } from '../sim/cityEvents';
import { BUILD_LABELS } from '../sim/construction';
import { PROSPECT_LABELS } from '../sim/prospect';
import { LOGISTICS_LABELS, storeCapacity, storedTotal } from '../economy/logistics';
import { hireWorker, fireWorker, setMaxWorkers, setClosed, demolishBuilding, upgradeBuilding, upgradePlan, setPaused, setUrgent, materialsLeft } from '../sim/build';
import { STAGE_NAMES } from '../sim/construction';
import { costText } from '../data/buildCatalog';
import { esc } from './topbar';
import { moodWord } from '../sim/needs';
import { ORDER_DEFS, ORDER_CATEGORIES, giveOrder, OrderDef } from '../ai/orders';
import { GOODS, GOOD_INFO } from '../economy/goods';
import { OrderTarget, Profession, isChild } from '../sim/citizen';
import { BuildingType } from '../world/buildings';
import { isRoadTile, idx as tileIdx, inBounds, parcelAt, ResourceKind, RESOURCE_NAMES } from '../world/world';
import { Tile, TILE_INFO } from '../world/tiles';
import type { Win } from './windows';
import { iconImg } from './icons';

type CardTab = 'overview' | 'family' | 'relations' | 'memory' | 'orders';
const TABS: [CardTab, string][] = [['overview', 'Обзор'], ['family', 'Семья'], ['relations', 'Отношения'], ['memory', 'Память'], ['orders', 'Приказы']];

export class SidePanel {
  el: HTMLElement;
  win: Win;
  private game: Game;
  private mode: 'none' | 'citizen' | 'building' = 'none';
  private id = -1;
  private lastRender = 0;
  private orderCat: OrderDef['category'] | null = null;
  private pendingOrder: OrderDef | null = null;
  private reaction = '';
  tab: CardTab = 'overview';

  constructor(win: Win, game: Game) {
    this.game = game;
    this.win = win;
    this.el = win.body;
    this.el.classList.add('card');
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const tabBtn = t.closest<HTMLElement>('[data-tab]');
      if (tabBtn) {
        this.tab = tabBtn.dataset.tab as CardTab;
        this.renderCitizen();
        return;
      }
      if (t.closest('.fav')) {
        this.game.toggleFavorite(this.id);
        this.renderCitizen();
        return;
      }
      const cid = t.getAttribute('data-citizen') ?? t.closest<HTMLElement>('[data-citizen]')?.dataset.citizen ?? null;
      if (cid) this.game.selectCitizen(Number(cid), true);
      const bid = t.getAttribute('data-building');
      if (bid) {
        const b = this.game.sim.world.buildings[Number(bid)];
        this.game.panTo(b.doorX, b.doorY);
        this.game.selectBuilding(Number(bid));
      }
      if (t.id === 'follow') this.game.toggleFollow();
      const bact = t.getAttribute('data-bact');
      if (bact && this.mode === 'building') {
        this.buildingAction(bact);
        return;
      }
      const cat = t.getAttribute('data-cat') as OrderDef['category'] | null;
      if (cat) {
        this.orderCat = this.orderCat === cat ? null : cat;
        this.pendingOrder = null;
        this.renderCitizen();
      }
      const oid = t.getAttribute('data-order');
      if (oid) this.onOrderClick(oid);
      if (t.id === 'pick-target') this.startTargeting();
      if (t.id === 'random-target') this.randomTarget();
      if (t.id === 'cancel-order') {
        this.pendingOrder = null;
        this.game.targeting = null;
        this.renderCitizen();
      }
    });
  }

  showCitizen(id: number): void {
    if (this.id !== id) {
      this.reaction = '';
      this.pendingOrder = null;
    }
    this.mode = 'citizen';
    this.id = id;
    this.win.show();
    this.renderCitizen();
  }

  showBuilding(id: number): void {
    this.mode = 'building';
    this.id = id;
    this.win.show();
    this.renderBuilding();
  }

  hide(): void {
    this.mode = 'none';
    this.win.close();
    this.pendingOrder = null;
    this.reaction = '';
    this.game.targeting = null;
  }

  get visible(): boolean {
    return this.mode !== 'none' && this.win.open;
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
    const act = c.state === 3 ? 'беседует' : (ACTION_LABELS[c.action] ?? CRIME_LABELS[c.action] ?? HEALTH_LABELS[c.action] ?? FIRE_LABELS[c.action] ?? EVENT_LABELS[c.action] ?? BUILD_LABELS[c.action] ?? PROSPECT_LABELS[c.action] ?? LOGISTICS_LABELS[c.action] ?? '');
    return `<b>${fullName(c)}</b>, ${c.age} · ${professionName(c)}<br>${act} · ${moodWord(c.mood)}<br><i>${c.thought || ''}</i>`;
  }

  /** Подсказка по тайлу земли: угодье, вид тайла, ресурс, плодородие (фаза 13) */
  tileTooltip(x: number, y: number): string {
    const world = this.game.sim.world;
    if (!inBounds(world, x, y)) return '';
    const i = tileIdx(world, x, y);
    if (!world.explored[i]) return '<i>Неизведанные земли</i>';
    const t = world.tiles[i] as Tile;
    const p = parcelAt(world, x, y);
    const parts: string[] = [];
    if (p) parts.push(`<b>${p.name}</b>`);
    parts.push(TILE_INFO[t].name);
    const r = world.resource[i] as ResourceKind;
    if (r && world.discovered[i] && world.resourceAmount[i] > 0) parts.push(`${RESOURCE_NAMES[r]}: ${world.resourceAmount[i]}`);
    if (t === Tile.Grass || t === Tile.Meadow || t === Tile.Field || t === Tile.Pasture) parts.push(`плодородие ${Math.round(world.fertility[i] * 100)}%`);
    return parts.join(' · ');
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
    const isFav = sim.favorites.includes(c.id);
    const status = `${professionName(c)}, ${c.age} ${ageWord(c.age)} · ${c.state === 3 ? 'беседует' : (ACTION_LABELS[c.action] ?? CRIME_LABELS[c.action] ?? HEALTH_LABELS[c.action] ?? FIRE_LABELS[c.action] ?? EVENT_LABELS[c.action] ?? BUILD_LABELS[c.action] ?? PROSPECT_LABELS[c.action] ?? LOGISTICS_LABELS[c.action] ?? '')} · ${moodWord(c.mood)}${c.jailedUntil > this.game.sim.tick ? ' · в тюрьме' : ''}${c.flags & 2 ? ' · в розыске' : ''}${c.flags & 8 ? ' · ранен' : ''}${c.flags & 4 ? ' · болен' : ''}`;
    this.win.setTitle(fullName(c));
    const tabs = TABS.map(([k, l]) => `<button class="tab ${this.tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('');
    let body = '';
    switch (this.tab) {
      case 'overview':
        body = `
      <div class="thought">«${c.thought || '…'}»</div>
      <div class="traits">${traits}</div>
      <div class="section"><h3>Потребности</h3>${needs}</div>
      <div class="section"><h3>Хозяйство</h3>
        <div>Деньги: <b>${Math.round(c.money)}</b> монет</div>
        <div>Дом: ${home}</div>
        <div>Работа: ${work}</div>
        <div>Инвентарь: ${inv || 'пусто'}</div>
      </div>
      <div class="section"><h3>Семья</h3>${fam.length ? fam.join('<br>') : 'одинок(а)'}</div>`;
        break;
      case 'family':
        body = this.familyHtml(c);
        break;
      case 'relations':
        body = `<div class="section"><h3>Отношения</h3>${rels || 'пока ни с кем не знаком(а)'}</div>`;
        break;
      case 'memory':
        body = `<div class="section"><h3>Память</h3><div class="bio tall">${mems || 'ничего примечательного'}</div></div>
      <div class="section"><h3>Биография</h3><div class="bio tall">${bio || '—'}</div></div>`;
        break;
      case 'orders':
        body = this.ordersHtml(c);
        break;
    }
    const scroll = this.el.scrollTop;
    this.el.innerHTML = `
      <div class="head">
        ${portrait}
        <div class="sub">${status}</div>
        <div class="hbtns"><button class="btn small fav ${isFav ? 'on' : ''}" data-tip="${isFav ? 'Убрать из избранного' : 'В избранное (появится в Обзоре справа)'}">${iconImg('star', 12)} ${isFav ? 'В избранном' : 'В избранное'}</button><button class="btn small" id="follow">${following}</button></div>
      </div>
      <div class="tabs">${tabs}</div>
      ${body}`;
    this.el.scrollTop = scroll;
  }

  /** Родословное дерево: деды — родители и их братья/сёстры — сам житель с супругом и братьями — дети — внуки */
  private familyHtml(c: Citizen): string {
    const sim = this.game.sim;
    const get = (id: number): Citizen | undefined => sim.citizens[id];
    const box = (id: number, role: string, self = false): string => {
      const p = get(id);
      if (!p) return '';
      const dead = !p.alive;
      return `<div class="fbox ${self ? 'self' : ''} ${dead ? 'dead' : ''}" data-citizen="${id}" data-tip="${fullName(p)}, ${p.age} ${ageWord(p.age)} — ${professionName(p)}${dead ? ' (умер' + (p.sex === 'f' ? 'ла' : '') + ')' : ''}"><div class="fn">${p.firstName}${dead ? ' †' : ''}</div><div class="fr">${role}</div></div>`;
    };
    const row = (title: string, boxes: string): string => (boxes ? `<div class="frow"><div class="ft">${title}</div><div class="fb">${boxes}</div></div>` : '');
    const parents = c.parents.filter((id) => get(id));
    const grand: number[] = [];
    for (const pid of parents) for (const g of get(pid)!.parents) if (get(g) && !grand.includes(g)) grand.push(g);
    const siblings: number[] = [];
    for (const pid of parents) for (const k of get(pid)!.children) if (k !== c.id && get(k) && !siblings.includes(k)) siblings.push(k);
    const kids = c.children.filter((id) => get(id));
    const grandkids: number[] = [];
    for (const k of kids) for (const g of get(k)!.children) if (get(g) && !grandkids.includes(g)) grandkids.push(g);
    const roleP = (p: Citizen): string => (p.sex === 'm' ? 'отец' : 'мать');
    const roleG = (p: Citizen): string => (p.sex === 'm' ? 'дед' : 'бабка');
    const roleS = (p: Citizen): string => (p.sex === 'm' ? 'брат' : 'сестра');
    const roleK = (p: Citizen): string => (p.sex === 'm' ? 'сын' : 'дочь');
    const roleGK = (p: Citizen): string => (p.sex === 'm' ? 'внук' : 'внучка');
    let selfRow = box(c.id, c.sex === 'm' ? (c.spouse >= 0 ? 'муж' : 'он сам') : c.spouse >= 0 ? 'жена' : 'она сама', true);
    if (c.spouse >= 0 && get(c.spouse)) selfRow += box(c.spouse, c.sex === 'm' ? 'жена' : 'муж');
    for (const sId of siblings) selfRow += box(sId, roleS(get(sId)!));
    let kidsRow = '';
    for (const k of kids) {
      kidsRow += box(k, roleK(get(k)!));
      const sp = get(k)!.spouse;
      if (sp >= 0 && get(sp)) kidsRow += box(sp, get(sp)!.sex === 'm' ? 'зять' : 'невестка');
    }
    const tree =
      row('Деды', grand.map((id) => box(id, roleG(get(id)!))).join('')) +
      row('Родители', parents.map((id) => box(id, roleP(get(id)!))).join('')) +
      row('Семья', selfRow) +
      row('Дети', kidsRow) +
      row('Внуки', grandkids.map((id) => box(id, roleGK(get(id)!))).join(''));
    const alone = !grand.length && !parents.length && !siblings.length && !kids.length && c.spouse < 0;
    return `<div class="section"><h3>Родословная</h3><div class="tree">${tree}</div>${alone ? '<div class="muted">Родни в городе нет — приехал(а) один(одна).</div>' : '<div class="muted small">Клик по карточке — перейти к родственнику. † — умер.</div>'}</div>`;
  }

  private onOrderClick(id: string): void {
    const def = ORDER_DEFS.find((d) => d.id === id);
    if (!def) return;
    const c = this.game.sim.citizens[this.id];
    if (!c) return;
    if (def.target === 'none') {
      this.reaction = giveOrder(this.game.sim, c, def.id, null);
      this.pendingOrder = null;
      this.renderCitizen();
      return;
    }
    if (def.target === 'good') {
      const sel = this.el.querySelector<HTMLSelectElement>('#order-good');
      if (this.pendingOrder?.id === id && sel) {
        this.reaction = giveOrder(this.game.sim, c, def.id, null, sel.value);
        this.pendingOrder = null;
      } else this.pendingOrder = def;
      this.renderCitizen();
      return;
    }
    this.pendingOrder = def;
    this.renderCitizen();
  }

  private startTargeting(): void {
    if (!this.pendingOrder) return;
    this.game.targeting = { order: this.pendingOrder, citizen: this.id };
    this.reaction = 'Кликните по цели на карте (Esc — отмена).';
    this.renderCitizen();
  }

  /** Вызывается игрой после клика по цели */
  applyTarget(target: OrderTarget): void {
    const def = this.pendingOrder;
    const c = this.game.sim.citizens[this.id];
    if (!def || !c) return;
    if (def.target !== target.kind && !(def.target === 'tile')) {
      this.reaction = def.target === 'citizen' ? 'Нужно выбрать жителя.' : 'Нужно выбрать здание.';
      this.renderCitizen();
      return;
    }
    if (target.kind === 'citizen' && target.id === c.id) {
      this.reaction = 'Нельзя выбрать самого себя.';
      this.renderCitizen();
      return;
    }
    this.reaction = giveOrder(this.game.sim, c, def.id, target);
    this.pendingOrder = null;
    this.game.targeting = null;
    this.renderCitizen();
  }

  private randomTarget(): void {
    const def = this.pendingOrder;
    const sim = this.game.sim;
    const c = sim.citizens[this.id];
    if (!def || !c) return;
    const rng = sim.rng;
    let target: OrderTarget | null = null;
    if (def.target === 'citizen') {
      let cands = sim.citizens.filter((o) => o.alive && o.id !== c.id && o.inside < 0 || (o.alive && o.id !== c.id && rng.chance(0.3)));
      if (def.id === 'propose' || def.id === 'court') cands = cands.filter((o) => o.sex !== c.sex && o.spouse < 0 && !isChild(o) && Math.abs(o.age - c.age) < 15);
      if (def.id === 'steal') cands = cands.filter((o) => o.money > 5 && o.profession !== Profession.Guard);
      if (def.id === 'fight') cands = cands.filter((o) => !isChild(o));
      if (!cands.length) {
        this.reaction = 'Подходящей цели нет.';
        return this.renderCitizen();
      }
      const o = rng.pick(cands);
      target = { kind: 'citizen', id: o.id, x: Math.round(o.x), y: Math.round(o.y) };
    } else if (def.target === 'building') {
      let cands = sim.world.buildings.filter((b) => b.w > 0 && b.type !== BuildingType.Well && b.type !== BuildingType.Pillory && b.type !== BuildingType.MarketStall);
      if (def.id === 'burgle') cands = cands.filter((b) => b.residents.length > 0 && b.id !== c.home);
      if (def.id === 'profession') cands = cands.filter((b) => BUILDING_DEFS[b.type].workers > 0 && b.id !== c.workplace && b.type !== BuildingType.Castle);
      if (def.id === 'arson') cands = cands.filter((b) => b.id !== c.home);
      if (!cands.length) {
        this.reaction = 'Подходящего здания нет.';
        return this.renderCitizen();
      }
      const b = rng.pick(cands);
      target = { kind: 'building', id: b.id, x: b.doorX, y: b.doorY };
    } else {
      const w = sim.world;
      for (let k = 0; k < 200 && !target; k++) {
        const x = rng.int(2, w.w - 3);
        const y = rng.int(2, w.h - 3);
        if (isRoadTile(w.tiles[tileIdx(w, x, y)] as Tile)) target = { kind: 'tile', id: -1, x, y };
      }
    }
    if (!target) return;
    this.reaction = giveOrder(sim, c, def.id, target);
    this.pendingOrder = null;
    this.game.targeting = null;
    this.renderCitizen();
  }

  private ordersHtml(c: Citizen): string {
    const cats = (Object.keys(ORDER_CATEGORIES) as OrderDef['category'][]).map((k) => `<button class="btn small ${this.orderCat === k ? 'active' : ''}" data-cat="${k}">${ORDER_CATEGORIES[k]}</button>`).join('');
    let list = '';
    if (this.orderCat) {
      list = ORDER_DEFS.filter((d) => d.category === this.orderCat)
        .map((d) => `<button class="btn small order ${this.pendingOrder?.id === d.id ? 'active' : ''}" data-order="${d.id}" title="${d.hint}">${d.label}</button>`)
        .join('');
    }
    let targetUi = '';
    const po = this.pendingOrder;
    if (po && po.target === 'good') {
      const opts = GOODS.filter((g) => g !== 'hide').map((g) => `<option value="${g}">${GOOD_INFO[g].name} (${Math.max(1, Math.round(this.game.sim.market.prices[g]))} мон.)</option>`).join('');
      targetUi = `<div class="target"><select id="order-good">${opts}</select> <button class="btn small primary" data-order="${po.id}">Купить</button></div>`;
    } else if (po && po.target !== 'none') {
      const what = po.target === 'citizen' ? 'жителя' : po.target === 'building' ? 'здание' : 'точку';
      targetUi = `<div class="target">Цель — ${what}: <button class="btn small primary" id="pick-target">Выбрать на карте</button> <button class="btn small" id="random-target">Случайная цель</button> <button class="btn small" id="cancel-order">Отмена</button></div>`;
    }
    const cur = c.order ? `<div class="cur">Выполняет: ${ORDER_DEFS.find((d) => d.id === c.order!.type)?.label ?? c.order.type}</div>` : '';
    const react = this.reaction ? `<div class="reaction">${this.reaction}</div>` : '';
    return `<div class="section orders"><h3>Приказы</h3><div class="cats">${cats}</div><div class="list">${list}</div>${targetUi}${cur}${react}</div>`;
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

  /** Кнопки управления зданием (фаза 14) */
  private buildingAction(act: string): void {
    const sim = this.game.sim;
    const b = sim.world.buildings[this.id];
    if (!b) return;
    switch (act) {
      case 'hire': this.reaction = hireWorker(sim, b); break;
      case 'fire': this.reaction = fireWorker(sim, b); break;
      case 'max+': setMaxWorkers(sim, b, (b.maxWorkers ?? BUILDING_DEFS[b.type].workers) + 1); this.reaction = `Предел рабочих: ${b.maxWorkers}.`; break;
      case 'max-': setMaxWorkers(sim, b, (b.maxWorkers ?? BUILDING_DEFS[b.type].workers) - 1); this.reaction = `Предел рабочих: ${b.maxWorkers}.`; break;
      case 'close': setClosed(sim, b, !b.closed); this.reaction = b.closed ? 'Здание закрыто.' : 'Здание открыто.'; break;
      case 'prio': b.priority = b.priority === 1 ? 0 : 1; this.reaction = b.priority ? 'Высокий приоритет снабжения.' : 'Обычный приоритет.'; break;
      case 'demolish': {
        const msg = demolishBuilding(sim, b.id);
        this.reaction = msg;
        this.game.deselect();
        this.game.toasts.show(msg, 0);
        return;
      }
      case 'upgrade': this.reaction = upgradeBuilding(sim, b.id); break;
      case 'pause': setPaused(sim, b.id, !b.paused); this.reaction = b.paused ? 'Стройка приостановлена.' : 'Стройка продолжается.'; break;
      case 'urgent': setUrgent(sim, b.id); this.reaction = b.priority === 2 ? 'Срочная стройка — первая в очереди.' : 'Обычная очередь.'; break;
    }
    this.renderBuilding();
  }

  private renderBuilding(): void {
    const sim = this.game.sim;
    const b = sim.world.buildings[this.id];
    if (!b || b.w <= 0) return this.hide();
    const def = BUILDING_DEFS[b.type];
    const residents = b.residents.filter((id) => sim.citizens[id]?.alive).map((id) => this.link(id)).join(', ');
    const workers = b.workers.filter((id) => sim.citizens[id]?.alive).map((id) => this.link(id)).join(', ');
    const storage = Object.entries(b.storage)
      .filter(([k, n]) => n >= 0.5 && !k.startsWith('_') && k !== 'revenue' && k !== 'money')
      .map(([k, n]) => `${GOOD_NAMES[k] ?? k}: ${Math.round(n)}`)
      .join(', ');
    const revenue = b.storage['revenue'] ? `<div>Выручка за всё время: ${Math.round(b.storage['revenue'])} монет</div>` : '';
    const owner = b.owner >= 0 && sim.citizens[b.owner]?.alive ? this.link(b.owner) : '—';
    this.win.setTitle(b.name ? `«${b.name}»` : def.name);
    this.el.innerHTML = `
      <div class="sub">${b.name ? def.name + ' · ' : ''}${DISTRICT_NAMES[b.district]} · ${MATERIAL_NAMES[b.material]}, крыша — ${ROOF_NAMES[b.roof]}</div>
      <div class="section"><h3>Состояние</h3>
        <div class="bar"><span class="name">Целостность</span><div class="track"><div class="fill" style="width:${Math.round(b.condition * 100)}%"></div></div><span class="val">${Math.round(b.condition * 100)}</span></div>
        <div>Владелец: ${owner}</div>
        ${def.hours ? `<div>Часы работы: ${def.workers ? `${def.hours[0]}:00–${def.hours[1] % 24}:00` : '—'}</div>` : ''}
      </div>
      ${b.underConstruction !== undefined ? this.siteHtml(b) : ''}
      ${def.home ? `<div class="section"><h3>Жильцы (${b.residents.length}/${def.capacity})</h3>${residents || 'никто не живёт'}</div>` : ''}
      ${def.workers && b.underConstruction === undefined ? `<div class="section"><h3>Работники (${b.workers.length}/${b.maxWorkers ?? def.workers})</h3>${workers || 'никого'}
        <div class="actions"><button class="btn small" data-bact="hire" data-tip="Нанять безработного">+ рабочий</button><button class="btn small" data-bact="fire" data-tip="Уволить последнего">− рабочий</button><button class="btn small" data-bact="max-" data-tip="Меньше мест">предел −</button><button class="btn small" data-bact="max+" data-tip="Больше мест">предел +</button><button class="btn small ${b.closed ? 'active' : ''}" data-bact="close">${b.closed ? 'Открыть' : 'Закрыть'}</button><button class="btn small ${b.priority === 1 ? 'active' : ''}" data-bact="prio" data-tip="Приоритет снабжения">Приоритет</button></div></div>` : ''}
      <div class="section"><h3>Запасы${BUILDING_DEFS[b.type].stores || b.type === BuildingType.Warehouse ? ` (${Math.round(storedTotal(b))}/${storeCapacity(b)})` : ''}</h3>${storage || 'пусто'}${revenue}${b.storage._cold ? `<div class="bad">Печь не топлена ${b.storage._cold} дн.</div>` : ''}</div>
      <div class="section"><h3>Правитель</h3><div class="actions">${upgradePlan(b) && b.underConstruction === undefined ? `<button class="btn small" data-bact="upgrade" data-tip="${esc(`${upgradePlan(b)!.label}: ${costText(upgradePlan(b)!.cost, upgradePlan(b)!.money)}`)}">Улучшить (${upgradePlan(b)!.label})</button>` : ''}${b.type !== BuildingType.Castle ? '<button class="btn small bad" data-bact="demolish" data-tip="Снести с возвратом половины материалов">Снести</button>' : ''}</div></div>
      ${this.reaction ? `<div class="reaction">${this.reaction}</div>` : ''}`;
  }

  private siteHtml(b: Building): string {
    const left = materialsLeft(b);
    const need = (g: string): string => `${Math.round(b.storage[`_got_${g}`] ?? 0)}/${Math.round(b.storage[`_need_${g}`] ?? 0)}`;
    const mats = ['planks', 'stone', 'wood'].filter((g) => (b.storage[`_need_${g}`] ?? 0) > 0).map((g) => `${g === 'planks' ? 'доски' : g === 'stone' ? 'камень' : 'брёвна'} ${need(g)}`).join(' · ');
    const q = this.game.sim.construction.queue.indexOf(b.id);
    const builders = this.game.sim.citizens.filter((c) => c.alive && c.action === 'build' && c.actionData.site === b.id).length;
    return `<div class="section"><h3>Стройка${b.upgradeTo ? ' (улучшение)' : ''}</h3>
      <div class="bar"><span class="name">${STAGE_NAMES[b.buildStage ?? 0]}</span><div class="track"><div class="fill" style="width:${Math.round((b.underConstruction ?? 0) * 100)}%"></div></div><span class="val">${Math.round((b.underConstruction ?? 0) * 100)}</span></div>
      <div>Материалы на площадке: ${mats || 'не нужны'}${Object.keys(left).length ? '' : ' <span class="good">(всё доставлено)</span>'}</div>
      <div>Строителей сейчас: ${builders} · место в очереди: ${q >= 0 ? q + 1 : '—'}${b.paused ? ' · <b class="bad">пауза</b>' : ''}${b.priority === 2 ? ' · <b>срочно</b>' : ''}</div>
      <div class="actions"><button class="btn small ${b.priority === 2 ? 'active' : ''}" data-bact="urgent">Срочно</button><button class="btn small ${b.paused ? 'active' : ''}" data-bact="pause">${b.paused ? 'Продолжить' : 'Пауза'}</button></div></div>`;
  }
}

const MATERIAL_NAMES: Record<string, string> = { wood: 'дерево', timber: 'фахверк', stone: 'камень', brick: 'кирпич' };
const ROOF_NAMES: Record<string, string> = { thatch: 'солома', tile: 'черепица', slate: 'сланец', wood: 'дранка' };
export const GOOD_NAMES: Record<string, string> = Object.assign(Object.fromEntries(Object.entries(GOOD_INFO).map(([k, v]) => [k, v.name])), { money: 'деньги', food: 'еда' });

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
