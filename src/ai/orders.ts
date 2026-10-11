// Приказы игрока жителям: категории, проверка характера, выполнение.
import type { Simulation } from '../sim/game';
import { Citizen, CitizenState, Order, OrderTarget, Trait, hasTrait, isChild, fullName, relation, changeRelation, Profession, isElder, professionName } from '../sim/citizen';
import { ACTIONS, ActionDef, ActionCtx, actFor, goTo, goToBuilding, enterBuilding, say, think, remember } from './actions';
import { startTalk } from './talk';
import { interrupt, makeCtx } from './brain';
import { BuildingType, BUILDING_DEFS, Building } from '../world/buildings';
import { EventKind } from '../events/chronicle';
import { Good, GOOD_INFO } from '../economy/goods';
import { sellersOf } from '../economy/market';
import { assignJob, professionFor } from '../sim/population';
import { TICKS_PER_DAY } from '../core/time';
import { nearestWalkable } from '../world/world';
import { crimeOrderStart, crimeOrderArrive } from '../sim/crime';

export interface OrderDef {
  id: string;
  label: string;
  category: 'move' | 'economy' | 'social' | 'crime' | 'other';
  /** Какая цель нужна */
  target: 'none' | 'citizen' | 'building' | 'tile' | 'good';
  /** Описание для подсказки */
  hint: string;
}

export const ORDER_DEFS: OrderDef[] = [
  { id: 'move', label: 'Пойти в место', category: 'move', target: 'tile', hint: 'Житель отправится в указанную точку' },
  { id: 'buy', label: 'Купить товар', category: 'economy', target: 'good', hint: 'Купит товар в ближайшей лавке на семейные деньги' },
  { id: 'sell', label: 'Продать', category: 'economy', target: 'none', hint: 'Продаст, что есть в инвентаре, на складе или в рядах' },
  { id: 'work', label: 'Работать', category: 'economy', target: 'none', hint: 'Немедленно идёт на работу' },
  { id: 'dayoff', label: 'Взять выходной', category: 'economy', target: 'none', hint: 'Сегодня не работает' },
  { id: 'talk', label: 'Поговорить с…', category: 'social', target: 'citizen', hint: 'Найдёт и заговорит' },
  { id: 'befriend', label: 'Подружиться с…', category: 'social', target: 'citizen', hint: 'Постарается расположить к себе' },
  { id: 'quarrel', label: 'Поссориться с…', category: 'social', target: 'citizen', hint: 'Затеет ссору' },
  { id: 'court', label: 'Ухаживать за…', category: 'social', target: 'citizen', hint: 'Начнёт ухаживания' },
  { id: 'propose', label: 'Сделать предложение…', category: 'social', target: 'citizen', hint: 'Предложит руку и сердце; при согласии — свадьба в соборе' },
  { id: 'rumor', label: 'Распустить слух о…', category: 'social', target: 'citizen', hint: 'Начнёт рассказывать о человеке дурное' },
  { id: 'steal', label: 'Украсть у…', category: 'crime', target: 'citizen', hint: 'Карманная кража' },
  { id: 'burgle', label: 'Ограбить дом…', category: 'crime', target: 'building', hint: 'Ночной взлом' },
  { id: 'arson', label: 'Поджечь здание…', category: 'crime', target: 'building', hint: 'Поджог' },
  { id: 'fight', label: 'Затеять драку с…', category: 'crime', target: 'citizen', hint: 'Подерётся' },
  { id: 'escape', label: 'Сбежать из тюрьмы', category: 'crime', target: 'none', hint: 'Только для заключённых' },
  { id: 'pray', label: 'Помолиться', category: 'other', target: 'none', hint: 'Пойдёт в собор' },
  { id: 'drink', label: 'Напиться в таверне', category: 'other', target: 'none', hint: 'Пойдёт в таверну и выпьет как следует' },
  { id: 'profession', label: 'Сменить профессию', category: 'other', target: 'building', hint: 'Наймётся в указанное рабочее здание (или в случайное)' },
  { id: 'guard', label: 'Вступить в стражу', category: 'other', target: 'none', hint: 'Пойдёт в казарму и станет стражником' },
  { id: 'leave', label: 'Покинуть город', category: 'other', target: 'none', hint: 'Уйдёт через ворота навсегда' },
];

export const ORDER_CATEGORIES: Record<OrderDef['category'], string> = { move: 'Перемещение', economy: 'Экономика', social: 'Социальное', crime: 'Преступления', other: 'Прочее' };

const REFUSE_LINES = {
  crime: ['Не буду я этого делать!', 'Я честный человек!', 'Это против совести.', 'Нет. Ни за что.', 'Бог всё видит, не стану.'],
  coward: ['Я… я боюсь.', 'Нет-нет, не пойду.', 'Меня же побьют!'],
  pious: ['Грех это.', 'Не пристало.'],
  general: ['Не хочу.', 'Зачем мне это?', 'Отстаньте.'],
};
const HESITATE = ['Ну… ладно.', 'Эх, была не была.', 'Не по душе мне это, но…', 'Если надо — сделаю.', 'Ох, не к добру…'];
const ACCEPT = ['Будет сделано.', 'Иду.', 'Хорошо.', 'Как скажете.', 'Понял.'];

/** Выдать приказ. Возвращает текст реакции. */
export function giveOrder(sim: Simulation, c: Citizen, type: string, target: OrderTarget | null, good?: string): string {
  const def = ORDER_DEFS.find((d) => d.id === type);
  if (!def) return 'Неизвестный приказ.';
  if (!c.alive) return 'Этот житель мёртв.';
  if (c.jailedUntil > sim.tick && type !== 'escape') {
    say(c, 'Я в тюрьме, какие тут приказы…', 40, false, sim.tick);
    return `${c.firstName} сидит в тюрьме.`;
  }
  if (type === 'escape' && c.jailedUntil <= sim.tick) return `${c.firstName} не в тюрьме.`;
  // Проверка характера
  const rng = sim.rng;
  let refuse = 0;
  let hesitate = 0;
  const isCrime = def.category === 'crime';
  if (isCrime) {
    if (hasTrait(c, Trait.Honest)) refuse += 0.75;
    if (hasTrait(c, Trait.Pious)) refuse += 0.35;
    if (hasTrait(c, Trait.Kind) && (type === 'fight' || type === 'arson')) refuse += 0.4;
    if (hasTrait(c, Trait.Cowardly) && (type === 'fight' || type === 'burgle' || type === 'escape')) refuse += 0.5;
    if (hasTrait(c, Trait.Greedy) && (type === 'steal' || type === 'burgle')) refuse -= 0.3;
    if (hasTrait(c, Trait.HotTempered) && type === 'fight') refuse -= 0.4;
    if (hasTrait(c, Trait.Brave) && type === 'fight') refuse -= 0.2;
    if (c.profession === Profession.Thief) refuse -= 0.6;
    if (c.profession === Profession.Priest || c.profession === Profession.Monk) refuse += 0.6;
    if (c.profession === Profession.Guard && type !== 'fight') refuse += 0.5;
    if (isChild(c)) refuse += 0.4;
    hesitate = 0.5;
  }
  if (type === 'quarrel' && hasTrait(c, Trait.Kind)) refuse += 0.5;
  if (type === 'rumor' && hasTrait(c, Trait.Honest)) refuse += 0.6;
  if (type === 'drink' && hasTrait(c, Trait.Pious)) refuse += 0.4;
  if (type === 'drink' && isChild(c)) refuse = 1;
  if (type === 'leave' && (c.spouse >= 0 || c.children.length)) refuse += 0.3;
  if (type === 'guard' && (c.sex === 'f' || isChild(c) || isElder(c))) refuse = 1;
  if ((type === 'court' || type === 'propose') && (isChild(c) || c.spouse >= 0)) refuse = 1;
  if (type === 'work' && c.workplace < 0) return `${c.firstName}: «У меня нет работы».`;
  if (type === 'dayoff' && c.workplace < 0) return `${c.firstName} и так не работает.`;
  if (hasTrait(c, Trait.Lazy) && type === 'work') hesitate += 0.5;
  refuse = Math.max(0, Math.min(0.95, refuse));
  if (rng.chance(refuse)) {
    const lines = isCrime ? (hasTrait(c, Trait.Cowardly) ? REFUSE_LINES.coward : REFUSE_LINES.crime) : hasTrait(c, Trait.Pious) ? REFUSE_LINES.pious : REFUSE_LINES.general;
    const t = rng.pick(lines);
    say(c, t, 50, false, sim.tick);
    think(c, t);
    remember(c, sim.tick, `Отказался${c.sex === 'f' ? 'ась' : ''} выполнять дурной приказ.`, 0.2);
    sim.events.emit('order:given', { citizen: c.id, type, refused: true });
    return `${fullName(c)} отказывается: «${t}»`;
  }
  const order: Order = { type, target, good, phase: 0, data: {}, givenAt: sim.tick };
  if (rng.chance(hesitate)) {
    order.data.hesitate = 1;
    say(c, rng.pick(HESITATE), 50, false, sim.tick);
  } else say(c, rng.pick(ACCEPT), 40, false, sim.tick);
  c.order = order;
  sim.events.emit('order:given', { citizen: c.id, type, refused: false });
  interrupt(sim, c);
  // немедленно начать
  const ctx = makeCtx(sim, c);
  c.action = 'order';
  const ok = orderAction.start(ctx);
  if (!ok) {
    c.order = null;
    return `${fullName(c)} не может выполнить приказ.`;
  }
  return `${fullName(c)}: «${c.speech?.text ?? 'Хорошо.'}»`;
}

function targetCitizen(sim: Simulation, o: Order): Citizen | null {
  if (!o.target || o.target.kind !== 'citizen') return null;
  const t = sim.citizens[o.target.id];
  return t && t.alive ? t : null;
}

function targetBuilding(sim: Simulation, o: Order): Building | null {
  if (!o.target || o.target.kind !== 'building') return null;
  return sim.world.buildings[o.target.id] ?? null;
}

function finishOrder(ctx: ActionCtx, text?: string): void {
  const { c, sim } = ctx;
  if (text) remember(c, sim.tick, text, 0.5);
  c.order = null;
  actFor(ctx, 5);
}

/** Действие выполнения приказа (наивысший приоритет) */
export const orderAction: ActionDef = {
  id: 'order',
  interruptible: false,
  score(ctx) {
    return ctx.c.order ? 1000 : 0;
  },
  start(ctx) {
    const { c, sim, rng } = ctx;
    const o = c.order;
    if (!o) return false;
    if (o.data.hesitate) {
      o.data.hesitate = 0;
      think(c, 'Не по душе мне это…');
      actFor(ctx, 25);
      return true;
    }
    switch (o.type) {
      case 'move': {
        if (!o.target) return false;
        think(c, 'Велено идти туда.');
        const nw = nearestWalkable(sim.world, o.target.x, o.target.y, 6);
        if (!nw) return false;
        return goTo(ctx, nw.x, nw.y);
      }
      case 'buy': {
        const g = (o.good ?? 'bread') as Good;
        const sellers = sellersOf(sim, g, c.x, c.y, ctx.hour, false);
        if (!sellers.length) {
          say(c, `${GOOD_INFO[g].name} нигде не продают.`, 40, false, sim.tick);
          c.order = null;
          return false;
        }
        think(c, `Куплю ${GOOD_INFO[g].plural} — велено.`);
        return goToBuilding(ctx, sellers[0]);
      }
      case 'sell': {
        const g = (['bread', 'meat', 'goods', 'leather', 'tools', 'grain', 'planks'] as Good[]).find((x) => (c.inventory[x] ?? 0) >= 1);
        if (!g) {
          say(c, 'Да нечего мне продавать.', 40, false, sim.tick);
          c.order = null;
          return false;
        }
        o.good = g;
        const wh = sim.world.buildings.find((b) => b.type === BuildingType.Warehouse) ?? sim.world.buildings.find((b) => b.type === BuildingType.MarketStall);
        if (!wh) return false;
        think(c, `Продам ${GOOD_INFO[g].plural}.`);
        return goToBuilding(ctx, wh);
      }
      case 'work': {
        const b = sim.world.buildings[c.workplace];
        if (!b) return false;
        think(c, 'Велено работать — работаю.');
        c.actionData.outdoor = 0;
        return goToBuilding(ctx, b);
      }
      case 'dayoff': {
        c.actionData.dayOff = Math.floor(sim.tick / TICKS_PER_DAY);
        think(c, rng.pick(['Выходной! Наконец-то.', 'Сегодня отдыхаю.']));
        finishOrder(ctx);
        return true;
      }
      case 'talk':
      case 'befriend':
      case 'quarrel':
      case 'court':
      case 'propose':
      case 'rumor': {
        const t = targetCitizen(sim, o);
        if (!t) return false;
        if (o.type === 'rumor') {
          const slander = rng.pick([`${fullName(t)} ворует у соседей`, `${fullName(t)} по ночам шляется неизвестно где`, `${fullName(t)} пьёт без просыху`, `${fullName(t)} обманывает покупателей`, `${fullName(t)} водится с разбойниками`]);
          remember(c, sim.tick, slander, 0.65, t.id, 'blame');
          think(c, `Расскажу всем про ${t.firstName}…`);
          changeRelation(c, t.id, -5);
          // идёт на площадь болтать
          const spot = rng.pick(sim.world.poi.strollSpots);
          o.data.spreading = 1;
          return goTo(ctx, spot.x, spot.y);
        }
        if (t.inside >= 0) {
          // подождать у дома/здания
          const b = sim.world.buildings[t.inside];
          think(c, `Подожду ${t.firstName} у ${BUILDING_DEFS[b.type].name.toLowerCase().replace('дом', 'дома')}.`);
          return goTo(ctx, b.doorX, b.doorY);
        }
        think(c, o.type === 'quarrel' ? `Ну, ${t.firstName}, держись.` : o.type === 'court' ? `${t.firstName}… как она хороша.` : `Надо найти ${t.firstName}.`);
        return goTo(ctx, Math.round(t.x), Math.round(t.y));
      }
      case 'pray': {
        const cat = sim.world.buildings.find((b) => b.type === BuildingType.Cathedral);
        if (!cat) return false;
        think(c, 'Пойду помолюсь.');
        return goToBuilding(ctx, cat);
      }
      case 'drink': {
        const tav = sim.world.buildings.filter((b) => b.type === BuildingType.Tavern);
        if (!tav.length) return false;
        think(c, 'Напьюсь сегодня!');
        return goToBuilding(ctx, rng.pick(tav));
      }
      case 'profession': {
        let b = targetBuilding(sim, o);
        if (!b || !BUILDING_DEFS[b.type].workers) {
          const cands = sim.world.buildings.filter((x) => BUILDING_DEFS[x.type].workers > 0 && x.workers.length < BUILDING_DEFS[x.type].workers + 1 && x.id !== c.workplace && x.type !== BuildingType.Castle);
          if (!cands.length) return false;
          b = rng.pick(cands);
          o.target = { kind: 'building', id: b.id, x: b.doorX, y: b.doorY };
        }
        think(c, `Попробую наняться: ${BUILDING_DEFS[b.type].name}.`);
        return goToBuilding(ctx, b);
      }
      case 'guard': {
        const br = sim.world.buildings.find((b) => b.type === BuildingType.Barracks);
        if (!br) return false;
        think(c, 'Пойду в стражу — хоть жалованье верное.');
        return goToBuilding(ctx, br);
      }
      case 'leave': {
        const g = rng.pick(sim.world.poi.gates);
        const ox = g.dir === 0 ? 3 : g.dir === 2 ? -3 : 0;
        const oy = g.dir === 1 ? 3 : g.dir === 3 ? -3 : 0;
        const nw = nearestWalkable(sim.world, g.x + ox, g.y + oy, 4);
        if (!nw) return false;
        think(c, 'Прощай, Вальдмарк.');
        return goTo(ctx, nw.x, nw.y);
      }
      case 'steal':
      case 'burgle':
      case 'arson':
      case 'fight':
      case 'escape':
        return crimeOrderStart(ctx, o);
    }
    return false;
  },
  arrive(ctx) {
    const { c, sim, rng } = ctx;
    const o = c.order;
    if (!o) return actFor(ctx, 5);
    switch (o.type) {
      case 'move':
        say(c, rng.pick(['Пришёл.', 'Я на месте.', 'И что дальше?']), 40, false, sim.tick);
        return finishOrder(ctx);
      case 'buy': {
        const b = sim.world.buildings[c.actionData.building];
        const g = (o.good ?? 'bread') as Good;
        if (!b) return finishOrder(ctx);
        const got = sim.market.buyRetail(sim, c, b, g, 2);
        if (got > 0) {
          c.inventory[g] = (c.inventory[g] ?? 0) + got;
          say(c, `Купил ${GOOD_INFO[g].name === 'хлеб' ? 'хлеба' : GOOD_INFO[g].plural}.`, 40, false, sim.tick);
        } else say(c, rng.pick(['Денег не хватило.', 'Не продали…']), 40, false, sim.tick);
        return finishOrder(ctx);
      }
      case 'sell': {
        const b = sim.world.buildings[c.actionData.building];
        const g = o.good as Good;
        if (!b || !g) return finishOrder(ctx);
        const n = Math.floor(c.inventory[g] ?? 0);
        const price = Math.max(1, Math.round(sim.market.prices[g] * 0.7));
        const owner = b.owner >= 0 ? sim.citizens[b.owner] : null;
        const q = owner && owner.alive ? Math.min(n, Math.floor(owner.money / price)) : 0;
        if (q > 0 && owner) {
          owner.money -= q * price;
          c.money += q * price;
          c.inventory[g] = n - q;
          b.storage[g] = (b.storage[g] ?? 0) + q;
          say(c, `Продал за ${q * price}.`, 40, false, sim.tick);
        } else say(c, 'Никто не берёт.', 40, false, sim.tick);
        return finishOrder(ctx);
      }
      case 'work': {
        const b = sim.world.buildings[c.workplace];
        if (b && BUILDING_DEFS[b.type].enterable) enterBuilding(ctx, b);
        c.order = null;
        c.action = 'work';
        c.actionData.building = c.workplace;
        actFor(ctx, 60 * 5);
        return;
      }
      case 'talk':
      case 'befriend':
      case 'quarrel':
      case 'court':
      case 'propose': {
        const t = targetCitizen(sim, o);
        if (!t) return finishOrder(ctx);
        let near = Math.abs(t.x - c.x) + Math.abs(t.y - c.y) < 3 && t.inside < 0;
        if (!near && t.inside >= 0 && Math.abs(t.x - c.x) + Math.abs(t.y - c.y) < 3 && t.state !== CitizenState.Sleeping && t.state !== CitizenState.Talking) {
          // постучать — вызвать на улицу
          const b = sim.world.buildings[t.inside];
          if (b && (b.id === t.home || b.type !== BuildingType.Prison)) {
            say(c, rng.pick([`${t.firstName}, выйди на минутку!`, 'Эй, есть кто дома?', `${t.firstName}! Дело есть.`]), 40, false, sim.tick);
            interrupt(sim, t);
            t.inside = -1;
            t.x = b.doorX;
            t.y = b.doorY;
            t.px = t.x;
            t.py = t.y;
            t.nextThink = sim.tick + 40;
            t.state = CitizenState.Acting;
            t.action = 'idle';
            t.actionUntil = sim.tick + 40;
            near = true;
          }
        }
        if (!near) {
          // ещё раз попробовать догнать (до 5 раз)
          o.data.tries = (o.data.tries ?? 0) + 1;
          if (o.data.tries > 10) {
            say(c, `Не найти мне ${t.firstName}.`, 40, false, sim.tick);
            return finishOrder(ctx);
          }
          actFor(ctx, 30);
          c.nextThink = sim.tick + 30;
          return;
        }
        if (t.state === CitizenState.Sleeping) {
          actFor(ctx, 50);
          return;
        }
        // Разговор
        if (o.type === 'propose') return doPropose(ctx, t);
        t.talkCooldown = 0;
        c.talkCooldown = 0;
        o.data.forced = o.type === 'quarrel' ? 2 : o.type === 'befriend' ? 1 : o.type === 'court' ? 3 : 0;
        sim.forcedTalk = { a: c.id, mode: o.data.forced };
        if (t.state === CitizenState.Talking) {
          actFor(ctx, 40);
          return;
        }
        if (startTalk(sim, c, t)) {
          c.order = null; // разговор продолжит система бесед
          if (o.type === 'befriend') changeRelation(c, t.id, 6);
          if (o.type === 'court') {
            remember(c, sim.tick, `Ухаживал${c.sex === 'f' ? 'а' : ''} за ${fullName(t)}.`, 0.5, t.id, 'flirt');
            changeRelation(t, c.id, 8);
          }
          return;
        }
        return finishOrder(ctx);
      }
      case 'rumor': {
        // стоит на площади и ждёт собеседников; слух разойдётся через систему бесед
        c.order = null;
        c.action = 'stroll';
        actFor(ctx, 60 * 5);
        return;
      }
      case 'pray': {
        const cat = sim.world.buildings[c.actionData.building];
        if (cat) enterBuilding(ctx, cat);
        c.needs.faith = Math.min(100, c.needs.faith + 50);
        c.order = null;
        c.action = 'pray';
        actFor(ctx, 40 * 5);
        return;
      }
      case 'drink': {
        const b = sim.world.buildings[c.actionData.building];
        if (b) {
          enterBuilding(ctx, b);
          const cups = sim.market.buyRetail(sim, c, b, 'ale', 4, false);
          c.drunk = Math.min(100, c.drunk + 25 * Math.max(1, cups));
          c.needs.fun = Math.min(100, c.needs.fun + 30);
          if (cups === 0) say(c, 'Хоть в долг налей!', 40, false, sim.tick);
        }
        c.order = null;
        c.action = 'tavern';
        actFor(ctx, 90 * 5);
        return;
      }
      case 'profession': {
        const b = targetBuilding(sim, o);
        if (!b) return finishOrder(ctx);
        const def = BUILDING_DEFS[b.type];
        if (b.workers.length >= def.workers + 1) {
          say(c, 'Мест нет, сказали.', 40, false, sim.tick);
          return finishOrder(ctx, `Пытался${c.sex === 'f' ? 'ась' : ''} наняться (${def.name.toLowerCase()}), но мест не было.`);
        }
        const prof = professionFor(b.type, b.workers.length);
        const old = professionName(c);
        assignJob(sim, c, b, prof);
        say(c, rng.pick(['Взяли!', 'Теперь я здесь работаю.', 'Новая жизнь.']), 40, false, sim.tick);
        sim.chronicle.log(sim.tick, EventKind.Economy, `${fullName(c)} (${old.toLowerCase()}) нанялся${c.sex === 'f' ? 'ась' : ''}: ${def.name.toLowerCase()}.`, b.doorX, b.doorY, [c.id], 0.3);
        return finishOrder(ctx, `Сменил${c.sex === 'f' ? 'а' : ''} ремесло: ${professionName(c).toLowerCase()}.`);
      }
      case 'guard': {
        const br = sim.world.buildings[c.actionData.building];
        if (!br) return finishOrder(ctx);
        if (br.workers.length >= BUILDING_DEFS[br.type].workers + 4) {
          say(c, 'В страже нет мест.', 40, false, sim.tick);
          return finishOrder(ctx);
        }
        assignJob(sim, c, br, Profession.Guard);
        c.flags &= ~2;
        say(c, 'Теперь я стражник!', 40, false, sim.tick);
        sim.chronicle.log(sim.tick, EventKind.Info, `${fullName(c)} вступил в городскую стражу.`, br.doorX, br.doorY, [c.id], 0.4);
        return finishOrder(ctx, 'Вступил в городскую стражу.');
      }
      case 'leave': {
        leaveCity(sim, c, 'по собственной воле');
        return;
      }
      case 'steal':
      case 'burgle':
      case 'arson':
      case 'fight':
      case 'escape':
        return crimeOrderArrive(ctx, o);
    }
    finishOrder(ctx);
  },
};

function doPropose(ctx: ActionCtx, t: Citizen): void {
  const { c, sim, rng } = ctx;
  say(c, rng.pick([`${t.firstName}, выходи за меня!`, 'Будь моей женой!', `${t.firstName}, я без тебя не могу.`]), 50, false, sim.tick);
  const rel = relation(t, c.id);
  const ok = t.spouse < 0 && !isChild(t) && t.sex !== c.sex && (rel > 35 || (rel > 10 && rng.chance(0.3)));
  if (ok) {
    say(t, rng.pick(['Да!', 'Согласна!', 'Я думала, ты никогда не спросишь!']), 50, false, sim.tick + 12);
    marryCitizens(sim, c, t);
  } else {
    say(t, rng.pick(['Нет.', 'Мы едва знакомы!', 'Прости, но нет.', 'Я подумаю… нет.']), 50, false, sim.tick + 12);
    changeRelation(c, t.id, -5);
    remember(c, sim.tick, `${fullName(t)} отказал${t.sex === 'f' ? 'а' : ''} мне.`, 0.6, t.id, 'refused');
    sim.chronicle.log(sim.tick, EventKind.Social, `${fullName(t)} отказал${t.sex === 'f' ? 'а' : ''} ${fullName(c)}.`, Math.round(c.x), Math.round(c.y), [c.id, t.id], 0.4);
  }
  c.order = null;
  actFor(ctx, 40);
}

export function marryCitizens(sim: Simulation, a: Citizen, b: Citizen): void {
  a.spouse = b.id;
  b.spouse = a.id;
  changeRelation(a, b.id, 30);
  changeRelation(b, a.id, 30);
  const wife = a.sex === 'f' ? a : b;
  const husband = wife === a ? b : a;
  // жена переезжает к мужу (если есть место), иначе муж к жене
  const hb = husband.home >= 0 ? sim.world.buildings[husband.home] : null;
  const wb = wife.home >= 0 ? sim.world.buildings[wife.home] : null;
  const moveTo = (c: Citizen, dst: Building) => {
    if (c.home === dst.id) return;
    if (c.home >= 0) {
      const old = sim.world.buildings[c.home];
      old.residents = old.residents.filter((id) => id !== c.id);
    }
    c.home = dst.id;
    dst.residents.push(c.id);
  };
  if (hb && hb.residents.length < BUILDING_DEFS[hb.type].capacity) moveTo(wife, hb);
  else if (wb && wb.residents.length < BUILDING_DEFS[wb.type].capacity) moveTo(husband, wb);
  else if (hb) moveTo(wife, hb);
  wife.lastName = husband.lastName;
  const text = `${fullName(husband)} и ${wife.firstName} сыграли свадьбу в соборе.`;
  sim.chronicle.log(sim.tick, EventKind.Social, text, sim.world.poi.cx, sim.world.poi.cy, [husband.id, wife.id], 0.8);
  remember(a, sim.tick, `Женился${a.sex === 'f' ? ' — вышла замуж' : ''}: ${fullName(b)}.`.replace('Женился — вышла замуж', 'Вышла замуж'), 0.9, b.id, 'wedding');
  remember(b, sim.tick, `${b.sex === 'f' ? 'Вышла замуж за' : 'Женился на'} ${fullName(a)}.`, 0.9, a.id, 'wedding');
  sim.pendingWedding = { a: a.id, b: b.id, tick: sim.tick };
}

export function leaveCity(sim: Simulation, c: Citizen, reason: string): void {
  c.alive = false;
  c.inside = -1;
  c.order = null;
  if (c.home >= 0) {
    const h = sim.world.buildings[c.home];
    h.residents = h.residents.filter((id) => id !== c.id);
  }
  if (c.workplace >= 0) {
    const w = sim.world.buildings[c.workplace];
    w.workers = w.workers.filter((id) => id !== c.id);
    if (w.owner === c.id) w.owner = w.workers[0] ?? -1;
  }
  if (c.spouse >= 0) {
    const sp = sim.citizens[c.spouse];
    if (sp) {
      sp.spouse = -1;
      remember(sp, sim.tick, `${fullName(c)} покинул${c.sex === 'f' ? 'а' : ''} город.`, 0.7, c.id, 'left');
    }
  }
  sim.chronicle.log(sim.tick, EventKind.Info, `${fullName(c)} покинул${c.sex === 'f' ? 'а' : ''} Вальдмарк ${reason}.`, Math.round(c.x), Math.round(c.y), [c.id], 0.5);
  sim.moneyDestroyed += c.money;
  c.money = 0;
}

ACTIONS['order'] = orderAction;
