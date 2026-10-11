// Верхняя полоса в духе CK3/HOI4: ресурсы с иконками и трендом, вложенные подсказки,
// полоса тревог (клик ведёт к месту), справа — дата, погода и скорость.
import type { Game } from '../main';
import { formatClock, getTime, SEASON_NAMES, TICKS_PER_DAY } from '../core/time';
import { weatherText } from '../sim/weather';
import { iconImg } from './icons';
import { GOOD_INFO, type Good } from '../economy/goods';
import { plural } from '../core/math';
import { Profession } from '../sim/citizen';
import { CITY_FOUNDED_YEAR } from '../core/time';

interface ResDef {
  id: string;
  icon: string;
  label: string;
  good?: Good;
}

const RES: ResDef[] = [
  { id: 'population', icon: 'population', label: 'Население' },
  { id: 'treasury', icon: 'money', label: 'Казна' },
  { id: 'food', icon: 'food', label: 'Еда (в хлебе)' },
  { id: 'bread', icon: 'bread', label: 'Хлеб', good: 'bread' },
  { id: 'grain', icon: 'grain', label: 'Зерно', good: 'grain' },
  { id: 'flour', icon: 'flour', label: 'Мука', good: 'flour' },
  { id: 'meat', icon: 'meat', label: 'Мясо', good: 'meat' },
  { id: 'ale', icon: 'ale', label: 'Эль', good: 'ale' },
  { id: 'wood', icon: 'wood', label: 'Брёвна', good: 'wood' },
  { id: 'planks', icon: 'planks', label: 'Доски', good: 'planks' },
  { id: 'stone', icon: 'stone', label: 'Камень', good: 'stone' },
  { id: 'tools', icon: 'tools', label: 'Инструменты', good: 'tools' },
  { id: 'goods', icon: 'goods', label: 'Изделия', good: 'goods' },
  { id: 'mood', icon: 'mood', label: 'Счастье' },
  { id: 'unrest', icon: 'unrest', label: 'Недовольство' },
];

export interface Alert {
  id: string;
  icon: string;
  text: string;
  tip: string;
  x: number;
  y: number;
  severity: 0 | 1 | 2;
  /** Окно, которое стоит открыть по клику */
  window?: string;
}

export class TopBar {
  el: HTMLElement;
  alertsEl: HTMLElement;
  private game: Game;
  private items = new Map<string, { val: HTMLElement; trend: HTMLElement; root: HTMLElement }>();
  private dateEl: HTMLElement;
  private clockEl: HTMLElement;
  private weatherEl: HTMLElement;
  private speedBtns: HTMLButtonElement[] = [];
  private statusEl: HTMLElement;
  private lastUpdate = 0;
  private lastAlerts = '';
  alerts: Alert[] = [];

  constructor(root: HTMLElement, game: Game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.id = 'topbar';
    this.el.className = 'panel';
    this.el.dataset.fixed = '1';
    const res = document.createElement('div');
    res.className = 'res';
    for (const r of RES) {
      const d = document.createElement('div');
      d.className = 'ri';
      d.dataset.res = r.id;
      d.innerHTML = `${iconImg(r.icon, 16)}<span class="v">0</span><span class="tr"></span>`;
      res.appendChild(d);
      this.items.set(r.id, { root: d, val: d.querySelector('.v')!, trend: d.querySelector('.tr')! });
    }
    this.el.appendChild(res);
    const right = document.createElement('div');
    right.className = 'time';
    right.innerHTML = `<span class="clock">07:00</span><span class="date"></span><span class="weather"></span><span class="speeds"></span><span class="status"></span>`;
    this.statusEl = right.querySelector('.status')!;
    this.el.appendChild(right);
    this.clockEl = right.querySelector('.clock')!;
    this.dateEl = right.querySelector('.date')!;
    this.weatherEl = right.querySelector('.weather')!;
    const speeds = right.querySelector('.speeds')!;
    const defs: [string, number, string][] = [['❚❚', 0, 'Пауза (пробел)'], ['1×', 1, 'Скорость 1× (клавиша 1)'], ['2×', 2, 'Скорость 2× (клавиша 2)'], ['4×', 4, 'Скорость 4× (клавиша 3)'], ['8×', 8, 'Скорость 8× (клавиша 4)']];
    for (const [label, sp, tip] of defs) {
      const b = document.createElement('button');
      b.className = 'btn sp';
      b.textContent = label;
      b.dataset.tip = tip;
      b.addEventListener('click', () => game.setSpeed(sp));
      speeds.appendChild(b);
      this.speedBtns.push(b);
    }
    root.appendChild(this.el);
    // Тревоги
    this.alertsEl = document.createElement('div');
    this.alertsEl.id = 'alerts';
    this.alertsEl.dataset.fixed = '1';
    root.appendChild(this.alertsEl);
    this.alertsEl.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('.alert');
      if (!t) return;
      const a = this.alerts.find((x) => x.id === t.dataset.id);
      if (!a) return;
      if (a.x >= 0) game.panTo(a.x, a.y);
      if (a.window) game.windows.get(a.window)?.show();
    });
    // Клик по ресурсу открывает Хозяйство
    res.addEventListener('click', () => game.openWindow('economy'));
  }

  setStatus(text: string): void {
    if (this.statusEl.textContent !== text) this.statusEl.textContent = text;
  }

  update(): void {
    const sim = this.game.sim;
    const t = sim.tick;
    this.clockEl.textContent = formatClock(t);
    const gt = getTime(t);
    this.dateEl.textContent = `${gt.dayOfSeason}-й день, ${SEASON_NAMES[gt.season].toLowerCase()} ${CITY_FOUNDED_YEAR + gt.year - 1} г.`;
    this.dateEl.dataset.tip = `<b>${gt.dayOfSeason}-й день ${SEASON_NAMES[gt.season].toLowerCase()}, ${CITY_FOUNDED_YEAR + gt.year - 1} год</b><br>День от основания города: ${gt.day + 1}<br>Сид: ${sim.seedText} · ${sim.world.sizeName}`;
    this.weatherEl.textContent = `${weatherText(sim.weather, sim.season)}, ${Math.round(sim.weather.temp)}°`;
    this.weatherEl.dataset.tip = `<b>Погода</b><br>Дождь ${Math.round(sim.weather.rain * 100)}% · ветер ${Math.round(sim.weather.wind * 100)}% · туман ${Math.round(sim.weather.fog * 100)}%${sim.weather.snow > 0.05 ? `<br>Снег ${Math.round(sim.weather.snow * 100)}%` : ''}${sim.weather.storm > 0.1 ? '<br>Гроза — выше риск пожара от молнии' : ''}`;
    const sp = this.game.paused ? 0 : this.game.speed;
    const order = [0, 1, 2, 4, 8];
    this.speedBtns.forEach((b, i) => b.classList.toggle('active', order[i] === sp));
    const now = performance.now();
    if (now - this.lastUpdate < 400) return;
    this.lastUpdate = now;
    this.updateResources();
    this.updateAlerts();
  }

  private set(id: string, value: string, delta: number | null, tip: string, warn = false): void {
    const it = this.items.get(id)!;
    if (it.val.textContent !== value) it.val.textContent = value;
    let tr = '';
    let cls = 'tr';
    if (delta !== null && Math.abs(delta) >= 0.5) {
      tr = delta > 0 ? `▲${Math.round(delta)}` : `▼${Math.round(-delta)}`;
      cls += delta > 0 ? ' up' : ' down';
    }
    if (it.trend.textContent !== tr) it.trend.textContent = tr;
    if (it.trend.className !== cls) it.trend.className = cls;
    it.root.classList.toggle('warn', warn);
    it.root.dataset.tip = tip;
  }

  private flowsTip(good: Good): string {
    const m = this.game.sim.market;
    const fmt = (flows: Record<string, number> | undefined): string => {
      if (!flows) return '<div class="muted">движения не было</div>';
      const plus = Object.entries(flows).filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]);
      const minus = Object.entries(flows).filter(([, v]) => v < -0.5).sort((a, b) => a[1] - b[1]);
      const sum = (a: [string, number][]): number => a.reduce((s, [, v]) => s + v, 0);
      const sub = (a: [string, number][]): string => a.map(([k, v]) => `<div>${k}: <b>${v > 0 ? '+' : ''}${Math.round(v)}</b></div>`).join('');
      let out = '';
      if (plus.length) out += `<div class="line" data-sub="${esc(sub(plus))}"><span class="good">+${Math.round(sum(plus))}</span> приход <span class="muted">▸</span></div>`;
      if (minus.length) out += `<div class="line" data-sub="${esc(sub(minus))}"><span class="bad">${Math.round(sum(minus))}</span> расход <span class="muted">▸</span></div>`;
      return out || '<div class="muted">движения не было</div>';
    };
    const info = GOOD_INFO[good];
    const price = m.prices[good];
    const k = price / info.base;
    const priceWord = k > 1.3 ? 'дорого' : k < 0.85 ? 'дёшево' : 'обычная цена';
    return `<b>${cap(info.name)}</b>: ${Math.round(m.stock[good])} на рынке<br>Цена ${price.toFixed(1)} мон. — ${priceWord}, продано вчера ${Math.round(m.soldYesterday[good])}<div class="hdr">Сегодня</div>${fmt(m.flowsToday[good])}<div class="hdr">Вчера</div>${fmt(m.flowsYesterday[good])}<div class="muted small">Наведите на строку — подробности по источникам</div>`;
  }

  private updateResources(): void {
    const sim = this.game.sim;
    const m = sim.market;
    const st = sim.stats;
    const hist = sim.history;
    const prev = hist.length ? hist[hist.length - 1] : null;
    // Население
    const children = st.children;
    const popTip = `<b>Население: ${st.population}</b><br>${children} ${plural(children, 'ребёнок', 'ребёнка', 'детей')}, ${st.elders} ${plural(st.elders, 'старик', 'старика', 'стариков')}<br>Без работы: ${st.unemployed} · без крова: ${st.homeless}<br>Умерло за всё время: ${sim.deaths}${prev ? `<br>Вчера было: ${prev.population}` : ''}`;
    this.set('population', String(st.population), prev ? st.population - prev.population : null, popTip, st.homeless > st.population * 0.1);
    // Казна
    const trTip = `<b>Казна: ${Math.round(sim.treasury)} монет</b><div class="line" data-sub="${esc(`<div>Ставка налога: ${Math.round(sim.taxRate * 100)}%</div><div>Налоги берутся утром с каждого взрослого жителя</div>`)}"><span class="good">+${sim.lastTax}</span> налоги за день <span class="muted">▸</span></div><div class="line" data-sub="${esc('<div>Милостыня беднякам из казны (утро)</div>')}"><span class="bad">−${sim.lastCharity}</span> раздано бедным <span class="muted">▸</span></div><div>Всего денег в городе: ${Math.round(sim.totalMoney())}</div><div>Вывоз за город: +${Math.round(sim.exportIncome)} · ввоз: −${Math.round(sim.importCost)}</div>`;
    this.set('treasury', String(Math.round(sim.treasury)), prev ? sim.treasury - prev.treasury : null, trTip, sim.treasury < 50);
    // Еда в хлебе
    const food = Math.round(m.stock.bread + m.stock.flour * 3 + m.stock.grain * 3 + m.stock.meat * 0.8);
    const food0 = Math.round(m.dayStartStock.bread + m.dayStartStock.flour * 3 + m.dayStartStock.grain * 3 + m.dayStartStock.meat * 0.8);
    const days = food / Math.max(1, st.population * 1.4);
    const foodTip = `<b>Еда на рынке (в хлебе): ${food}</b><br>Хватит примерно на ${days.toFixed(1)} дн.<br>Средняя сытость горожан: ${Math.round(st.avgHunger)}<br>Урожай года: ${m.yearFactor < 0.8 ? 'скудный' : m.yearFactor > 1.2 ? 'богатый' : 'обычный'}, сезонный множитель ${m.harvest(sim).toFixed(2)}`;
    this.set('food', String(food), food - food0, foodTip, days < 1.5 || st.avgHunger < 45);
    for (const r of RES) {
      if (!r.good) continue;
      const g = r.good;
      this.set(r.id, String(Math.round(m.stock[g])), m.stock[g] - m.dayStartStock[g], this.flowsTip(g), g === 'bread' && m.stock[g] < st.population * 0.3);
    }
    // Счастье и недовольство
    const moodTip = `<b>Среднее счастье: ${Math.round(st.avgMood)}</b><br>Здоровье: ${Math.round(st.avgHealth)} · больных: ${sim.citizens.filter((c) => c.alive && c.flags & 4).length}<br>Пожаров сейчас: ${sim.fires.length}${prev ? `<br>Вчера: ${Math.round(prev.avgMood)}` : ''}`;
    this.set('mood', String(Math.round(st.avgMood)), prev ? st.avgMood - prev.avgMood : null, moodTip, st.avgMood < 35);
    const guards = sim.citizens.filter((c) => c.alive && c.profession === Profession.Guard && !c.actionData.visitor).length;
    const unTip = `<b>Недовольство: ${Math.round(sim.unrest)}/100</b><br>Растёт от голода, налогов, преступлений и бездомности; падает от праздников, стражи и милостыни.<br>Стражников: ${guards}${sim.protest ? `<br><span class="bad">${sim.protest.riot ? 'Идёт бунт!' : 'Идёт протест на площади'}</span>` : ''}${prev ? `<br>Вчера: ${Math.round(prev.unrest)}` : ''}`;
    this.set('unrest', String(Math.round(sim.unrest)), prev ? sim.unrest - prev.unrest : null, unTip, sim.unrest > 60);
  }

  private computeAlerts(): Alert[] {
    const sim = this.game.sim;
    const st = sim.stats;
    const out: Alert[] = [];
    if (sim.fires.length) {
      const b = sim.world.buildings[sim.fires[0].building];
      out.push({ id: 'fire', icon: 'fire', text: `Пожар${sim.fires.length > 1 ? ` ×${sim.fires.length}` : ''}`, tip: `<b>Горит ${sim.fires.length} ${plural(sim.fires.length, 'здание', 'здания', 'зданий')}</b><br>Клик — показать на карте`, x: b ? b.doorX : -1, y: b ? b.doorY : -1, severity: 2 });
    }
    if (sim.raid) out.push({ id: 'raid', icon: 'alert', text: 'Разбойники', tip: '<b>Разбойники у ворот!</b><br>Стража сражается с налётчиками', x: sim.raid.gate.x, y: sim.raid.gate.y, severity: 2 });
    if (sim.protest) out.push({ id: 'protest', icon: 'unrest', text: sim.protest.riot ? 'Бунт!' : 'Протест', tip: sim.protest.riot ? '<b>Бунт на площади</b><br>Толпа громит лавки. Снизьте налоги или пошлите стражу' : '<b>Протест на площади</b><br>Горожане требуют хлеба и справедливости', x: sim.protest.x, y: sim.protest.y, severity: sim.protest.riot ? 2 : 1 });
    if (sim.dragon) out.push({ id: 'dragon', icon: 'alert', text: 'Дракон', tip: '<b>Дракон над городом</b><br>Жгёт крыши — тушите пожары', x: Math.round(sim.dragon.x), y: Math.round(sim.dragon.y), severity: 2 });
    if (sim.flood) {
      const t0 = sim.flood.tiles[0] ?? -1;
      out.push({ id: 'flood', icon: 'alert', text: 'Наводнение', tip: `<b>Наводнение</b><br>Затоплено ${sim.flood.tiles.length} тайлов, спадёт через ${Math.max(0, Math.ceil((sim.flood.until - sim.tick) / 300))} ч.`, x: t0 >= 0 ? t0 % sim.world.w : -1, y: t0 >= 0 ? Math.floor(t0 / sim.world.w) : -1, severity: 1 });
    }
    const sick = sim.citizens.filter((c) => c.alive && c.flags & 4).length;
    if (sick >= Math.max(3, st.population * 0.05)) {
      const c = sim.citizens.find((z) => z.alive && z.flags & 4);
      out.push({ id: 'epidemic', icon: 'heart', text: `Болезнь ×${sick}`, tip: `<b>Эпидемия</b><br>Больных: ${sick}. Монахи лечат, больница принимает`, x: c ? Math.round(c.x) : -1, y: c ? Math.round(c.y) : -1, severity: sick > st.population * 0.12 ? 2 : 1 });
    }
    if (st.avgHunger < 45) out.push({ id: 'hunger', icon: 'bread', text: 'Голод', tip: `<b>Город голодает</b><br>Средняя сытость ${Math.round(st.avgHunger)}. Проверьте запасы зерна и работу пекарен`, x: sim.world.poi.cx, y: sim.world.poi.cy, severity: st.avgHunger < 30 ? 2 : 1, window: 'economy' });
    else if (sim.market.stock.bread < st.population * 0.2 && sim.market.stock.grain < st.population * 0.5) out.push({ id: 'bread', icon: 'bread', text: 'Мало хлеба', tip: '<b>Запасы хлеба и зерна на исходе</b><br>Цены вырастут, бедняки начнут голодать', x: sim.world.poi.cx, y: sim.world.poi.cy, severity: 1, window: 'economy' });
    if (st.homeless > Math.max(2, st.population * 0.08)) out.push({ id: 'homeless', icon: 'population', text: `Бездомных ${st.homeless}`, tip: '<b>Нехватка жилья</b><br>Город сам строит дома, когда есть доски и казна', x: -1, y: -1, severity: 1, window: 'development' });
    if (sim.treasury < 30) out.push({ id: 'treasury', icon: 'money', text: 'Казна пуста', tip: '<b>Казна почти пуста</b><br>Нечем платить страже и раздавать милостыню', x: -1, y: -1, severity: 1, window: 'edicts' });
    if (sim.unrest > 60) out.push({ id: 'unrest', icon: 'unrest', text: `Недовольство ${Math.round(sim.unrest)}`, tip: '<b>Народ ропщет</b><br>При высоком недовольстве собираются протесты и бунты', x: sim.world.poi.cx, y: sim.world.poi.cy, severity: sim.unrest > 80 ? 2 : 1, window: 'edicts' });
    if (sim.caravan) out.push({ id: 'caravan', icon: 'trade', text: 'Караван', tip: '<b>Караван в городе</b><br>Торгует на площади — цены на привозное падают', x: sim.caravan.dest.x, y: sim.caravan.dest.y, severity: 0, window: 'trade' });
    if (sim.festival) out.push({ id: 'festival', icon: 'mood', text: 'Праздник', tip: '<b>Праздник на площади</b><br>Горожане веселятся, недовольство падает', x: sim.world.poi.cx, y: sim.world.poi.cy, severity: 0 });
    const unhandled = sim.alarms.filter((a) => !a.handled && sim.tick - a.tick < TICKS_PER_DAY / 4);
    if (unhandled.length) out.push({ id: 'crime', icon: 'alert', text: `Тревога ×${unhandled.length}`, tip: `<b>Стража не ответила на ${unhandled.length} ${plural(unhandled.length, 'тревогу', 'тревоги', 'тревог')}</b><br>Клик — к месту последней`, x: unhandled[unhandled.length - 1].x, y: unhandled[unhandled.length - 1].y, severity: 1 });
    return out;
  }

  private updateAlerts(): void {
    this.alerts = this.computeAlerts();
    const key = this.alerts.map((a) => a.id + a.text + a.severity).join('|');
    if (key === this.lastAlerts) return;
    this.lastAlerts = key;
    this.alertsEl.innerHTML = this.alerts.map((a) => `<div class="alert s${a.severity}" data-id="${a.id}" data-tip="${esc(a.tip)}">${iconImg(a.icon, 14)}<span>${a.text}</span></div>`).join('');
  }
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
