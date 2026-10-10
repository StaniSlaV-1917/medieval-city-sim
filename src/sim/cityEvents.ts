// События города: глашатай, проповеди, праздники, свадьбы, недовольство и бунты, караваны, разбойники.
import type { Simulation } from './game';
import { Citizen, CitizenState, Profession, Trait, hasTrait, isChild, isElder, fullName, nameAcc, changeRelation, relation } from './citizen';
import { ACTIONS, ActionDef, actFor, goTo, say, think, remember, randomRoadTileNear } from '../ai/actions';
import { makeCtx, interrupt } from '../ai/brain';
import { BuildingType, BUILDING_DEFS } from '../world/buildings';
import { EventKind } from '../events/chronicle';
import { TICKS_PER_HOUR, TICKS_PER_DAY, hourOf } from '../core/time';
import { nearestWalkable } from '../world/world';
import { newCitizen, randomTraits } from './population';
import { MALE_NAMES, SURNAMES } from './names';
import { startFight } from './crime';
import { leaveCity } from '../ai/orders';
import { dist2 } from '../core/math';
import { GOOD_INFO, Good } from '../economy/goods';
import { isWorkHour, isSleepHour } from './schedule';

export interface Festival {
  type: 'fair' | 'feast' | 'wedding' | 'tournament' | 'holiday';
  until: number;
  title: string;
  /** Для свадьбы */
  a?: number;
  b?: number;
}

const HERALD_LINES = ['Слушайте, слушайте, добрые люди!', 'Бургомистр объявляет: {news}', 'Внимание! {news}', 'Горожане! {news}'];

export function updateCityEvents(sim: Simulation): void {
  const tick = sim.tick;
  const hour = hourOf(tick);
  const day = Math.floor(tick / TICKS_PER_DAY);
  // Глашатай: 9:00 и 17:00
  if (tick % TICKS_PER_HOUR === 0 && (hour === 9 || hour === 17)) heraldAnnounce(sim);
  // Проповедь на ступенях собора в день отдыха (11:00)
  if (tick % TICKS_PER_HOUR === 0 && hour === 11 && day % 8 === 7) sermon(sim);
  // Ярмарка каждый 8-й день (день 3 недели), с турниром
  if (tick % TICKS_PER_DAY === TICKS_PER_HOUR * 8 && day % 8 === 3 && !sim.festival) startFestival(sim, 'fair', TICKS_PER_HOUR * 10, 'Ярмарочный день');
  // Религиозный праздник в первый день сезона
  if (tick % TICKS_PER_DAY === TICKS_PER_HOUR * 9 && sim.time.dayOfSeason === 1 && day > 0 && !sim.festival) startFestival(sim, 'feast', TICKS_PER_HOUR * 8, ['Праздник весны', 'Праздник урожая', 'Праздник жатвы', 'Зимний праздник'][sim.season]);
  // Турнир в полдень ярмарки
  if (sim.festival && sim.festival.type === 'fair' && tick % TICKS_PER_HOUR === 0 && hour === 13) tournament(sim);
  // Свадебная церемония
  if (sim.pendingWedding && tick - sim.pendingWedding.tick > 50) {
    const w = sim.pendingWedding;
    sim.pendingWedding = null;
    weddingCelebration(sim, w.a, w.b);
  }
  if (sim.festival && tick >= sim.festival.until) {
    sim.chronicle.log(tick, EventKind.Social, `${sim.festival.title} закончился. Горожане расходятся по домам.`, sim.world.poi.cx, sim.world.poi.cy, [], 0.3);
    sim.festival = null;
  }
  // Недовольство — раз в день в 7:00
  if (tick % TICKS_PER_DAY === TICKS_PER_HOUR * 7) updateUnrest(sim);
  if (sim.protest && tick >= sim.protest.until) endProtest(sim);
  if (sim.protest && tick % 20 === 0) protestTick(sim);
  // Караваны: каждые 3–6 дней в 10:00
  if (tick % TICKS_PER_DAY === TICKS_PER_HOUR * 10 && day >= 1 && day >= sim.nextCaravanDay) {
    sim.nextCaravanDay = day + sim.rng.int(3, 6);
    spawnCaravan(sim);
  }
  if (sim.caravan) updateCaravan(sim);
  // Разбойники: редко, с 2-го дня
  if (tick % TICKS_PER_HOUR === 0 && day >= sim.nextRaidDay && (hour === 6 || hour === 20) && !sim.raid) {
    sim.nextRaidDay = day + sim.rng.int(8, 16);
    spawnRaid(sim, sim.rng.int(4, 6));
  }
  if (sim.raid) updateRaid(sim);
}

// ---------------------------------------------------------------- Глашатай

function heraldAnnounce(sim: Simulation): void {
  const herald = sim.citizens.find((c) => c.alive && c.profession === Profession.Herald && c.jailedUntil <= sim.tick);
  if (!herald) return;
  // собрать новости
  const news: string[] = [];
  const m = sim.market;
  if (m.prices.bread > 1.8) news.push(`хлеб нынче по ${Math.round(m.prices.bread)} монет — пекарям велено не наглеть`);
  else news.push(`на рынке хлеб по ${Math.max(1, Math.round(m.prices.bread))}, мясо по ${Math.round(m.prices.meat)}`);
  const recent = sim.chronicle.events.slice(-30);
  const crime = recent.filter((e) => e.kind === EventKind.Crime).length;
  if (crime >= 3) news.push('воры и буяны будут биты и закованы в колодки');
  if (sim.taxRate >= 0.2) news.push(`налог повышен до ${Math.round(sim.taxRate * 100)} частей со ста — казне нужны деньги`);
  else if (sim.taxRate <= 0.05) news.push('бургомистр милостиво снизил подати');
  if (sim.festival) news.push(`сегодня ${sim.festival.title.toLowerCase()} — все на площадь!`);
  if (sim.unrest > 50) news.push('бургомистр просит горожан сохранять спокойствие');
  const dis = recent.find((e) => e.kind === EventKind.Disaster);
  if (dis) news.push(dis.text.toLowerCase().replace(/\.$/, ''));
  if (sim.caravan) news.push('к городу идёт торговый караван');
  const wed = recent.find((e) => /свадьбу/.test(e.text));
  if (wed) news.push(wed.text.replace(/\.$/, '').toLowerCase());
  herald.actionData.news = 0;
  herald.actionData.newsList = news.length;
  sim.heraldNews = news;
  interrupt(sim, herald);
  herald.action = 'announce';
  herald.actionData.until = sim.tick + TICKS_PER_HOUR * 0.6;
  const ctx = makeCtx(sim, herald);
  const sq = sim.world.poi.square;
  const spot = nearestWalkable(sim.world, sq.x + Math.floor(sq.w / 2), sq.y + 2, 3);
  if (!spot || !goTo(ctx, spot.x, spot.y)) herald.action = '';
}

const announce: ActionDef = {
  id: 'announce',
  interruptible: false,
  score(ctx) {
    return (ctx.c.actionData.until ?? 0) > ctx.sim.tick && ctx.c.action === 'announce' ? 500 : 0;
  },
  start(ctx) {
    actFor(ctx, Math.max(10, ctx.c.actionData.until - ctx.sim.tick));
    return true;
  },
  arrive(ctx) {
    const { c, sim } = ctx;
    c.dir = 0;
    say(c, 'Слушайте, слушайте, добрые люди!', 45, false, sim.tick);
    actFor(ctx, Math.max(10, c.actionData.until - sim.tick));
    gatherListeners(sim, c, 16, 10);
  },
  tick(ctx) {
    const { c, sim, rng } = ctx;
    if (rng.chance(0.25)) {
      const news = sim.heraldNews;
      if (news.length) {
        const i = c.actionData.news % news.length;
        c.actionData.news++;
        const t = rng.pick(HERALD_LINES).replace('{news}', news[i]);
        say(c, t.charAt(0).toUpperCase() + t.slice(1), 50, false, sim.tick);
        // слушатели запоминают
        sim.spatial.query(c.x, c.y, 6, [] as number[]).forEach((oid) => {
          const o = sim.citizens[oid];
          if (o.alive && oid !== c.id && rng.chance(0.3)) remember(o, sim.tick, `Глашатай объявил: ${news[i]}.`, 0.35, -1, 'news');
        });
      }
    }
    return false;
  },
};

/** Созвать слушателей/зрителей к точке */
function gatherListeners(sim: Simulation, host: Citizen, radius: number, max: number): void {
  let n = 0;
  for (const c of sim.citizens) {
    if (n >= max) break;
    if (!c.alive || c.inside >= 0 || c.id === host.id || c.jailedUntil > sim.tick) continue;
    if (c.state === CitizenState.Sleeping || c.state === CitizenState.Talking || c.order) continue;
    const a = ACTIONS[c.action];
    if (a && !a.interruptible) continue;
    if (c.action === 'work' || c.action === 'haul' || c.action === 'patrol') continue;
    if (dist2(c.x, c.y, host.x, host.y) > radius * radius) continue;
    if (!sim.rng.chance(hasTrait(c, Trait.Curious) ? 0.9 : 0.5)) continue;
    interrupt(sim, c);
    c.action = 'listen';
    c.actionData.host = host.id;
    c.actionData.until = sim.tick + TICKS_PER_HOUR * 0.5;
    const spot = nearestWalkable(sim.world, Math.round(host.x + sim.rng.int(-3, 3)), Math.round(host.y + sim.rng.int(1, 4)), 3);
    const ctx = makeCtx(sim, c);
    if (!spot || !goTo(ctx, spot.x, spot.y)) c.action = '';
    else n++;
  }
}

const listen: ActionDef = {
  id: 'listen',
  interruptible: true,
  score(ctx) {
    return (ctx.c.actionData.until ?? 0) > ctx.sim.tick && ctx.c.action === 'listen' ? 400 : 0;
  },
  start(ctx) {
    actFor(ctx, Math.max(10, ctx.c.actionData.until - ctx.sim.tick));
    return true;
  },
  arrive(ctx) {
    const { c, sim } = ctx;
    const h = sim.citizens[c.actionData.host];
    if (h) c.dir = h.y < c.y ? 3 : 0;
    c.needs.social = Math.min(100, c.needs.social + 5);
    c.needs.fun = Math.min(100, c.needs.fun + 5);
    actFor(ctx, Math.max(10, c.actionData.until - sim.tick));
  },
};

// ---------------------------------------------------------------- Проповедь

function sermon(sim: Simulation): void {
  const priest = sim.citizens.find((c) => c.alive && c.profession === Profession.Priest);
  const cat = sim.world.buildings.find((b) => b.type === BuildingType.Cathedral);
  if (!priest || !cat) return;
  interrupt(sim, priest);
  priest.action = 'announce';
  priest.actionData.until = sim.tick + TICKS_PER_HOUR;
  priest.actionData.news = 0;
  sim.heraldNews = ['Возлюбите ближнего своего!', 'Не укради, не завидуй, не гневайся.', 'Терпение — добродетель, а гордыня — грех.', 'Помните о бедных и подайте нуждающимся.', 'Господь испытывает нас, но не оставляет.', sim.unrest > 50 ? 'Смирите сердца, не поднимайте руку на власть.' : 'Радуйтесь, ибо город наш стоит под защитой Божьей.'];
  const ctx = makeCtx(sim, priest);
  if (!goTo(ctx, cat.doorX, cat.doorY)) priest.action = '';
  else {
    sim.chronicle.log(sim.tick, EventKind.Faith, `Отец ${priest.lastName} читает проповедь на ступенях собора.`, cat.doorX, cat.doorY, [priest.id], 0.4);
    setTimeoutTick(sim, 60, () => gatherListeners(sim, priest, 30, 25));
  }
}

function setTimeoutTick(sim: Simulation, delay: number, fn: () => void): void {
  sim.timers.push({ at: sim.tick + delay, fn });
}

// ---------------------------------------------------------------- Праздники

export function startFestival(sim: Simulation, type: Festival['type'], duration: number, title: string, a?: number, b?: number): void {
  sim.festival = { type, until: sim.tick + duration, title, a, b };
  sim.chronicle.log(sim.tick, EventKind.Social, `${title}! Горожане собираются на площади.`, sim.world.poi.cx, sim.world.poi.cy, a !== undefined ? [a, b!] : [], 0.8);
  sim.unrest = Math.max(0, sim.unrest - 15);
  // бард — на площадь
  const bard = sim.citizens.find((c) => c.alive && c.profession === Profession.Bard);
  if (bard) {
    interrupt(sim, bard);
    bard.action = 'perform';
    bard.actionData.until = sim.festival.until;
    const sq = sim.world.poi.square;
    const spot = nearestWalkable(sim.world, sq.x + Math.floor(sq.w / 2) + 2, sq.y + Math.floor(sq.h / 2), 3);
    const ctx = makeCtx(sim, bard);
    if (!spot || !goTo(ctx, spot.x, spot.y)) bard.action = '';
  }
  if (type === 'holiday') {
    // бесплатный эль из казны
    for (const t of sim.world.buildings) if (t.type === BuildingType.Tavern) t.storage['freeAle'] = 30;
  }
}

const perform: ActionDef = {
  id: 'perform',
  interruptible: false,
  score(ctx) {
    return (ctx.c.actionData.until ?? 0) > ctx.sim.tick && ctx.c.action === 'perform' ? 450 : 0;
  },
  start(ctx) {
    actFor(ctx, Math.max(10, ctx.c.actionData.until - ctx.sim.tick));
    return true;
  },
  arrive(ctx) {
    actFor(ctx, Math.max(10, ctx.c.actionData.until - ctx.sim.tick));
  },
  tick(ctx) {
    const { c, sim, rng } = ctx;
    if (rng.chance(0.2)) say(c, rng.pick(['♪ Ой, да во Вальдмарке на реке… ♪', '♪ Пей, гуляй, пока молодой! ♪', '♪ Жил-был кузнец, ковал подковы… ♪', '♪ Ла-ла-ла, тру-ля-ля! ♪', 'А теперь — баллада о драконе!', '♪ Эх, дорога дальняя… ♪']), 45, false, sim.tick);
    sim.spatial.query(c.x, c.y, 5, [] as number[]).forEach((oid) => {
      const o = sim.citizens[oid];
      if (o.alive && oid !== c.id) o.needs.fun = Math.min(100, o.needs.fun + 0.5);
    });
    return false;
  },
};

/** Празднование: идти на площадь, веселиться */
const celebrate: ActionDef = {
  id: 'celebrate',
  interruptible: true,
  score(ctx) {
    const { c, sim, hour, sched } = ctx;
    if (!sim.festival || isSleepHour(sched, hour)) return 0;
    if (c.jailedUntil > sim.tick) return 0;
    let s = 30 + (100 - c.needs.fun) * 0.3;
    if (sim.festival.type === 'wedding') {
      const rel = Math.max(relation(c, sim.festival.a!), relation(c, sim.festival.b!));
      if (c.id !== sim.festival.a && c.id !== sim.festival.b && rel < 25) return 0;
      s += 40;
    }
    if (isWorkHour(sched, hour) && c.profession !== Profession.Housewife && !hasTrait(c, Trait.Lazy)) s -= 25;
    if (hasTrait(c, Trait.Cheerful) || hasTrait(c, Trait.Drunkard)) s += 10;
    if (hasTrait(c, Trait.Gloomy)) s -= 15;
    if (hasTrait(c, Trait.Pious) && sim.festival.type === 'feast') s += 15;
    if (c.action === 'celebrate') s += 5;
    return s;
  },
  start(ctx) {
    const { c, sim, rng } = ctx;
    const sq = sim.world.poi.square;
    const spot = randomRoadTileNear(sim, rng, sq.x + sq.w / 2, sq.y + sq.h / 2, 7);
    if (!spot) return false;
    if (c.action !== 'celebrate') think(c, rng.pick(['На площади праздник!', 'Сегодня гуляем!', 'Говорят, на площади бард и эль рекой.', 'Пойду посмотрю на праздник.']));
    return goTo(ctx, spot.x, spot.y);
  },
  arrive(ctx) {
    const { c, sim, rng } = ctx;
    c.needs.fun = Math.min(100, c.needs.fun + 10);
    c.needs.social = Math.min(100, c.needs.social + 6);
    c.mood = Math.min(100, c.mood + 2);
    if (rng.chance(0.25)) {
      const f = sim.festival;
      const lines = f && f.type === 'wedding' ? ['Горько!', 'Совет да любовь!', 'За молодых!', 'Ура молодым!'] : f && f.type === 'feast' ? ['С праздником!', 'Слава Богу за урожай!', 'Хвала небесам!'] : f && f.type === 'tournament' ? ['Бей его!', 'Давай, стража!', 'Ух, как врезал!'] : ['Ура!', 'Гуляем!', 'Эх, хорошо!', 'Ещё эля!', 'Смотри, какие товары!'];
      say(c, rng.pick(lines), 40, false, sim.tick);
    }
    if (rng.chance(0.08) && c.money >= 1) {
      // сувенир/угощение с лотка
      c.money -= 1;
      sim.treasury += 1;
      c.needs.hunger = Math.min(100, c.needs.hunger + 10);
    }
    actFor(ctx, rng.int(3, 10) * 5);
  },
};

function tournament(sim: Simulation): void {
  const guards = sim.citizens.filter((c) => c.alive && c.profession === Profession.Guard && c.inside < 0 && c.action !== 'chase').slice(0, 2);
  if (guards.length < 2) return;
  const sq = sim.world.poi.square;
  const [a, b] = guards;
  for (const g of guards) {
    interrupt(sim, g);
    g.action = 'duel';
    g.actionData.opponent = g === a ? b.id : a.id;
    g.actionData.until = sim.tick + TICKS_PER_HOUR * 0.7;
    const spot = nearestWalkable(sim.world, sq.x + Math.floor(sq.w / 2) + (g === a ? -1 : 1), sq.y + Math.floor(sq.h / 2) + 1, 2);
    const ctx = makeCtx(sim, g);
    if (!spot || !goTo(ctx, spot.x, spot.y)) g.action = '';
  }
  sim.chronicle.log(sim.tick, EventKind.Social, `Турнир на площади: ${fullName(a)} против ${nameAcc(b)}!`, sq.x + 7, sq.y + 5, [a.id, b.id], 0.6);
  if (sim.festival) sim.festival.type = 'tournament';
  setTimeoutTick(sim, 100, () => gatherListeners(sim, a, 28, 30));
  setTimeoutTick(sim, TICKS_PER_HOUR * 0.7, () => {
    if (sim.festival) sim.festival.type = 'fair';
    const winner = sim.rng.chance(0.5) ? a : b;
    const loser = winner === a ? b : a;
    sim.chronicle.log(sim.tick, EventKind.Social, `В турнире победил ${fullName(winner)}; толпа ликует.`, sq.x + 7, sq.y + 5, [winner.id], 0.5);
    remember(winner, sim.tick, 'Победил на турнире!', 0.8, -1, 'tournament');
    remember(loser, sim.tick, `Проиграл на турнире ${nameAcc(winner)}.`, 0.6, winner.id, 'tournament');
    winner.money += 10;
    sim.treasury = Math.max(0, sim.treasury - 10);
    say(winner, 'Слава Вальдмарку!', 50, false, sim.tick);
  });
}

const duel: ActionDef = {
  id: 'duel',
  interruptible: false,
  score(ctx) {
    return (ctx.c.actionData.until ?? 0) > ctx.sim.tick && ctx.c.action === 'duel' ? 500 : 0;
  },
  start(ctx) {
    actFor(ctx, Math.max(10, ctx.c.actionData.until - ctx.sim.tick));
    return true;
  },
  arrive(ctx) {
    const { c, sim } = ctx;
    const o = sim.citizens[c.actionData.opponent];
    if (o) c.dir = o.x > c.x ? 2 : 1;
    actFor(ctx, Math.max(10, c.actionData.until - sim.tick));
  },
  tick(ctx) {
    const { c, sim, rng } = ctx;
    c.animPhase += 1;
    if (rng.chance(0.1)) say(c, rng.pick(['Хэй!', 'Получай!', 'Дзынь!', 'Ещё раз!']), 20, false, sim.tick);
    return false;
  },
};

function weddingCelebration(sim: Simulation, a: number, b: number): void {
  const ca = sim.citizens[a];
  const cb = sim.citizens[b];
  if (!ca?.alive || !cb?.alive) return;
  startFestival(sim, 'wedding', TICKS_PER_HOUR * 5, `Свадьба: ${fullName(ca)} и ${cb.firstName}`, a, b);
  const cat = sim.world.buildings.find((x) => x.type === BuildingType.Cathedral);
  for (const c of [ca, cb]) {
    interrupt(sim, c);
    c.action = 'celebrate';
    if (cat) {
      c.actionData.building = cat.id;
      const ctx = makeCtx(sim, c);
      goTo(ctx, cat.doorX, cat.doorY);
    }
  }
}

// ---------------------------------------------------------------- Недовольство и бунт

function updateUnrest(sim: Simulation): void {
  const st = sim.stats;
  let u = sim.unrest;
  let delta = -4;
  if (st.avgHunger < 45) delta += (45 - st.avgHunger) * 0.4;
  if (sim.market.prices.bread > 1.8) delta += (sim.market.prices.bread - 1.8) * 8;
  if (sim.taxRate > 0.12) delta += (sim.taxRate - 0.12) * 120;
  const recent = sim.chronicle.events.filter((e) => sim.tick - e.tick < TICKS_PER_DAY * 2);
  delta += recent.filter((e) => e.kind === EventKind.Crime).length * 0.6;
  delta += recent.filter((e) => e.kind === EventKind.Death).length * 1.5;
  delta += recent.filter((e) => e.kind === EventKind.Disaster).length * 2;
  if (st.avgMood < -10) delta += 4;
  if (sim.lastCharity > 10) delta -= 3;
  if (sim.festival) delta -= 6;
  u = Math.max(0, Math.min(100, u + delta));
  sim.unrest = u;
  if (u >= 55 && !sim.protest && sim.rng.chance(0.6)) startProtest(sim, u >= 80);
}

function startProtest(sim: Simulation, riot: boolean): void {
  const hall = sim.world.buildings.find((b) => b.type === BuildingType.TownHall);
  if (!hall) return;
  const angry = sim.citizens.filter((c) => c.alive && !isChild(c) && c.inside >= 0 === false || (c.alive && !isChild(c))).filter((c) => c.alive && !isChild(c) && (c.mood < 0 || c.needs.hunger < 35) && c.profession !== Profession.Guard && c.profession !== Profession.Lord && c.profession !== Profession.Burgomaster && c.jailedUntil <= sim.tick);
  const crowd = angry.sort((a, b) => a.mood - b.mood).slice(0, riot ? 40 : 25);
  if (crowd.length < 6) return;
  sim.protest = { until: sim.tick + TICKS_PER_HOUR * 3, riot, members: crowd.map((c) => c.id), x: hall.doorX, y: hall.doorY + 2 };
  const reasons: string[] = [];
  if (sim.stats.avgHunger < 45) reasons.push('голода');
  if (sim.taxRate > 0.12) reasons.push('высоких налогов');
  if (sim.market.prices.bread > 1.8) reasons.push('дорогого хлеба');
  const why = reasons.length ? ` из-за ${reasons.join(' и ')}` : '';
  sim.chronicle.log(sim.tick, EventKind.Social, riot ? `БУНТ! Толпа с кольями идёт к ратуше${why}!` : `Горожане собрались у ратуши с протестом${why}.`, hall.doorX, hall.doorY, crowd.slice(0, 3).map((c) => c.id), 1);
  for (const c of crowd) {
    interrupt(sim, c);
    c.action = 'protest';
    c.actionData.until = sim.protest.until;
    const spot = nearestWalkable(sim.world, hall.doorX + sim.rng.int(-4, 4), hall.doorY + 1 + sim.rng.int(0, 4), 4);
    const ctx = makeCtx(sim, c);
    if (!spot || !goTo(ctx, spot.x, spot.y)) c.action = '';
  }
}

const protest: ActionDef = {
  id: 'protest',
  interruptible: false,
  score(ctx) {
    return (ctx.c.actionData.until ?? 0) > ctx.sim.tick && ctx.c.action === 'protest' ? 480 : 0;
  },
  start(ctx) {
    actFor(ctx, Math.max(10, ctx.c.actionData.until - ctx.sim.tick));
    return true;
  },
  arrive(ctx) {
    const { c, sim } = ctx;
    c.dir = 3;
    actFor(ctx, Math.max(10, c.actionData.until - sim.tick));
  },
  tick(ctx) {
    const { c, sim, rng } = ctx;
    const riot = sim.protest?.riot;
    if (rng.chance(0.12)) say(c, rng.pick(riot ? ['Долой бургомистра!', 'Жги!', 'Хлеба или крови!', 'Бей стражу!', 'Отворяй амбары!'] : ['Хлеба!', 'Долой налоги!', 'Дети голодают!', 'Где справедливость?', 'Бургомистр, выходи!', 'Мы хотим есть!']), 40, false, sim.tick);
    c.animPhase += 0.5;
    return false;
  },
};

function protestTick(sim: Simulation): void {
  const p = sim.protest!;
  if (!p.riot) {
    // власти реагируют: если казна позволяет — раздача хлеба / снижение налога
    if (!p.responded && sim.tick - (p.until - TICKS_PER_HOUR * 3) > TICKS_PER_HOUR && sim.rng.chance(0.05)) {
      p.responded = true;
      const burg = sim.citizens.find((c) => c.alive && c.profession === Profession.Burgomaster);
      const wh = sim.world.buildings.find((b) => b.type === BuildingType.Warehouse);
      if (sim.treasury > 300 && burg) {
        // раздача хлеба из казны: покупает у пекарей
        let given = 0;
        for (const id of p.members) {
          const c = sim.citizens[id];
          if (!c.alive || sim.treasury < 5) continue;
          sim.treasury -= 3;
          c.money += 3;
          given++;
        }
        if (wh && (wh.storage['grain'] ?? 0) > 20) wh.storage['grain'] -= 20;
        sim.unrest = Math.max(0, sim.unrest - 30);
        sim.chronicle.log(sim.tick, EventKind.Social, `Бургомистр ${burg.lastName} вышел к толпе и велел раздать деньги на хлеб (${given} чел.). Народ успокаивается.`, p.x, p.y, [burg.id], 0.8);
        say(burg, 'Тише, добрые люди! Казна поможет!', 50, false, sim.tick);
        endProtest(sim);
      } else if (sim.taxRate > 0.1 && sim.rng.chance(0.5)) {
        sim.taxRate = Math.max(0.05, sim.taxRate - 0.05);
        sim.unrest = Math.max(0, sim.unrest - 20);
        sim.chronicle.log(sim.tick, EventKind.Social, `Под давлением толпы бургомистр снизил налог до ${Math.round(sim.taxRate * 100)}%.`, p.x, p.y, [], 0.8);
        endProtest(sim);
      } else {
        sim.chronicle.log(sim.tick, EventKind.Social, 'Ратуша молчит. Толпа расходится, но злоба копится.', p.x, p.y, [], 0.6);
        sim.unrest = Math.min(100, sim.unrest + 10);
      }
    }
    return;
  }
  // бунт: ломают прилавки, дерутся со стражей, могут поджечь
  if (sim.rng.chance(0.06)) {
    const stalls = sim.world.buildings.filter((b) => b.type === BuildingType.MarketStall);
    const s = stalls.length ? sim.rng.pick(stalls) : null;
    if (s) {
      for (const g of Object.keys(s.storage)) if (!g.startsWith('_') && g !== 'revenue') s.storage[g] = Math.max(0, (s.storage[g] ?? 0) * 0.5);
      sim.chronicle.log(sim.tick, EventKind.Crime, 'Бунтовщики разграбили торговые ряды на площади.', s.doorX, s.doorY, [], 0.7);
      s.condition = Math.max(0.3, s.condition - 0.2);
    }
  }
  if (sim.rng.chance(0.04)) {
    const rioter = sim.citizens[sim.rng.pick(sim.protest!.members)];
    const guard = sim.citizens.find((g) => g.alive && g.profession === Profession.Guard && g.inside < 0 && dist2(g.x, g.y, p.x, p.y) < 400);
    if (rioter && rioter.alive && guard && rioter.action === 'protest') startFight(sim, rioter, guard, 'бунт');
  }
  if (sim.rng.chance(0.006) && sim.igniteBuilding) {
    const hall = sim.world.buildings.find((b) => b.type === BuildingType.TownHall);
    const cands = sim.world.buildings.filter((b) => b.type === BuildingType.Merchant || b.type === BuildingType.Manor || b.type === BuildingType.Warehouse);
    const target = sim.rng.chance(0.3) && hall ? hall : cands.length ? sim.rng.pick(cands) : null;
    if (target) {
      sim.igniteBuilding(target.id, 'поджог бунтовщиков', 0.4);
      sim.chronicle.log(sim.tick, EventKind.Disaster, 'Бунтовщики подожгли здание!', target.doorX, target.doorY, [], 0.9);
    }
  }
}

function endProtest(sim: Simulation): void {
  const p = sim.protest;
  if (!p) return;
  sim.protest = null;
  for (const id of p.members) {
    const c = sim.citizens[id];
    if (c && c.alive && c.action === 'protest') {
      c.action = '';
      c.state = CitizenState.Idle;
      c.nextThink = sim.tick + sim.rng.int(0, 30);
      remember(c, sim.tick, p.riot ? 'Бунтовал у ратуши.' : 'Протестовал у ратуши.', 0.5, -1, 'protest');
    }
  }
  if (p.riot) {
    sim.unrest = 35;
    sim.chronicle.log(sim.tick, EventKind.Social, 'Бунт выдохся: стража разогнала толпу, зачинщики разбежались.', p.x, p.y, [], 0.8);
  }
}

// ---------------------------------------------------------------- Караваны

function spawnCaravan(sim: Simulation): void {
  const g = sim.world.poi.gates.find((q) => q.dir === 0) ?? sim.world.poi.gates[0];
  const world = sim.world;
  const startX = g.dir === 0 ? world.w - 2 : g.dir === 2 ? 1 : g.x;
  const startY = g.dir === 1 ? world.h - 2 : g.dir === 3 ? 1 : g.y;
  const start = nearestWalkable(world, startX, startY, 6);
  if (!start) return;
  const rng = sim.rng;
  const leader = newCitizen(sim, { firstName: rng.pick(MALE_NAMES), lastName: rng.pick(['из Остмарка', 'из Хольцбурга', 'из Зильберталя', 'с Юга', 'из-за реки']), sex: 'm', age: rng.int(30, 55), cls: 'rich', traits: randomTraits(rng, 2, [Trait.Greedy, Trait.Talkative]), x: start.x, y: start.y });
  leader.profession = Profession.Merchant;
  leader.money = rng.int(300, 600);
  sim.moneyCreated += leader.money;
  leader.actionData.cart = 1;
  leader.actionData.visitor = 1;
  const members = [leader.id];
  for (let k = 0; k < 2; k++) {
    const gd = newCitizen(sim, { firstName: rng.pick(MALE_NAMES), lastName: rng.pick(SURNAMES), sex: 'm', age: rng.int(22, 45), cls: 'common', traits: randomTraits(rng, 2, [Trait.Brave]), x: start.x, y: start.y });
    gd.profession = Profession.Guard;
    gd.actionData.visitor = 1;
    gd.money = 10;
    sim.moneyCreated += 10;
    members.push(gd.id);
  }
  // товары
  const goods: Partial<Record<Good, number>> = { tools: rng.int(6, 12), goods: rng.int(6, 12), leather: rng.int(5, 10), grain: rng.int(30, 80), planks: rng.int(10, 20) };
  const wh = sim.world.buildings.find((b) => b.type === BuildingType.Warehouse);
  const dest = wh ? { x: wh.doorX, y: wh.doorY } : { x: sim.world.poi.cx, y: sim.world.poi.cy + 3 };
  sim.caravan = { members, phase: 0, goods, until: 0, dest };
  for (const id of members) {
    const c = sim.citizens[id];
    c.action = 'caravan';
    c.actionData.until = sim.tick + TICKS_PER_DAY;
    const ctx = makeCtx(sim, c);
    goTo(ctx, dest.x + rng.int(-1, 1), dest.y + rng.int(0, 2));
  }
  sim.chronicle.log(sim.tick, EventKind.Economy, `К ${g.name.toLowerCase().replace('ые ворота', 'ым воротам')} подходит торговый караван ${leader.firstName} ${leader.lastName}.`, g.x, g.y, [leader.id], 0.7);
}

const caravanAct: ActionDef = {
  id: 'caravan',
  interruptible: true,
  score(ctx) {
    return ctx.c.actionData.visitor && ctx.c.action === 'caravan' ? 470 : 0;
  },
  start(ctx) {
    const { sim } = ctx;
    const cv = sim.caravan;
    if (!cv) return false;
    if (cv.phase === 0) return goTo(ctx, cv.dest.x + ctx.rng.int(-1, 1), cv.dest.y + ctx.rng.int(0, 2));
    actFor(ctx, 100);
    return true;
  },
  arrive(ctx) {
    const { c, sim, rng } = ctx;
    c.dir = 0;
    if (c.actionData.cart && sim.caravan && sim.caravan.phase === 0) {
      sim.caravan.phase = 1;
      sim.caravan.until = sim.tick + TICKS_PER_HOUR * 4;
      caravanTrade(sim, c);
    }
    if (rng.chance(0.2)) say(c, rng.pick(['Товары из дальних краёв!', 'Инструменты, кожа, зерно — подходи!', 'Дорога была тяжёлой.', 'Ваш эль хорош, но наш лучше.']), 40, false, sim.tick);
    actFor(ctx, rng.int(10, 30) * 5);
  },
};

function caravanTrade(sim: Simulation, leader: Citizen): void {
  const cv = sim.caravan!;
  const wh = sim.world.buildings.find((b) => b.type === BuildingType.Warehouse);
  const owner = wh && wh.owner >= 0 ? sim.citizens[wh.owner] : null;
  let sold = 0;
  let bought = 0;
  if (wh && owner && owner.alive) {
    // продать товары складу по цене чуть ниже рынка; если у купца нет денег — покупает казна
    for (const [g, n] of Object.entries(cv.goods) as [Good, number][]) {
      const price = Math.max(0.5, sim.market.prices[g] * 0.85);
      let q = Math.min(n, Math.floor(owner.money / price));
      let payer: 'owner' | 'treasury' = 'owner';
      if (q < n / 2 && sim.treasury > 200) {
        q = Math.min(n, Math.floor((sim.treasury - 100) / price));
        payer = 'treasury';
      }
      if (q <= 0) continue;
      const cost = Math.round(q * price);
      if (payer === 'owner') owner.money -= cost;
      else sim.treasury -= cost;
      leader.money += cost;
      wh.storage[g] = (wh.storage[g] ?? 0) + q;
      sold += cost;
    }
    // купить излишки склада
    for (const g of ['goods', 'leather', 'planks', 'stone', 'flour', 'tools'] as Good[]) {
      const have = Math.floor(wh.storage[g] ?? 0);
      const surplus = have - 10;
      if (surplus <= 0) continue;
      const price = sim.market.prices[g] * 0.9;
      const q = Math.min(surplus, Math.floor(leader.money / price));
      if (q <= 0) continue;
      const cost = Math.round(q * price);
      leader.money -= cost;
      owner.money += cost;
      wh.storage[g] = have - q;
      bought += cost;
    }
  }
  sim.chronicle.log(sim.tick, EventKind.Economy, `Караван торгует у склада: привёз товаров на ${sold} монет, скупил излишков на ${bought}.`, cv.dest.x, cv.dest.y, [leader.id], 0.6);
  // пошлина
  const duty = Math.round(sold * 0.1);
  if (leader.money >= duty) {
    leader.money -= duty;
    sim.treasury += duty;
  }
  // гости в таверне вечером — приносят новости (слух)
  remember(leader, sim.tick, sim.rng.pick(['В соседнем Хольцбурге мор.', 'За рекой видели дракона!', 'Король поднял подати.', 'На дорогах разбойники.', 'Говорят, в горах нашли серебро.']), 0.6, -1, 'news');
}

function updateCaravan(sim: Simulation): void {
  const cv = sim.caravan!;
  if (cv.phase === 1 && sim.tick >= cv.until) {
    cv.phase = 2;
    // уходят
    const g = sim.world.poi.gates.find((q) => q.dir === 0) ?? sim.world.poi.gates[0];
    const world = sim.world;
    const exitX = g.dir === 0 ? world.w - 2 : g.dir === 2 ? 1 : g.x;
    const exitY = g.dir === 1 ? world.h - 2 : g.dir === 3 ? 1 : g.y;
    const ex = nearestWalkable(world, exitX, exitY, 6);
    for (const id of cv.members) {
      const c = sim.citizens[id];
      if (!c.alive) continue;
      interrupt(sim, c);
      c.action = 'caravan_leave';
      const ctx = makeCtx(sim, c);
      if (!ex || !goTo(ctx, ex.x, ex.y)) leaveCity(sim, c, 'с караваном');
    }
    sim.chronicle.log(sim.tick, EventKind.Economy, 'Караван собирается и уходит из города.', cv.dest.x, cv.dest.y, [], 0.4);
  }
  if (cv.phase === 2) {
    const anyLeft = cv.members.some((id) => sim.citizens[id].alive);
    if (!anyLeft) sim.caravan = null;
    if (sim.tick - cv.until > TICKS_PER_DAY) {
      for (const id of cv.members) if (sim.citizens[id].alive) leaveCity(sim, sim.citizens[id], 'с караваном');
      sim.caravan = null;
    }
  }
}

const caravanLeave: ActionDef = {
  id: 'caravan_leave',
  interruptible: false,
  score(ctx) {
    return ctx.c.action === 'caravan_leave' ? 470 : 0;
  },
  start(ctx) {
    actFor(ctx, 50);
    return true;
  },
  arrive(ctx) {
    const { c, sim } = ctx;
    c.alive = true;
    leaveCity(sim, c, 'с караваном');
    // не логировать как уход
    sim.chronicle.events.pop();
  },
};

// ---------------------------------------------------------------- Разбойники

export function spawnRaid(sim: Simulation, n: number): void {
  const rng = sim.rng;
  const world = sim.world;
  const g = rng.pick(world.poi.gates);
  const sx = g.dir === 0 ? world.w - 2 : g.dir === 2 ? 1 : g.x + rng.int(-10, 10);
  const sy = g.dir === 1 ? world.h - 2 : g.dir === 3 ? 1 : g.y + rng.int(-10, 10);
  const start = nearestWalkable(world, Math.max(1, Math.min(world.w - 2, sx)), Math.max(1, Math.min(world.h - 2, sy)), 8);
  if (!start) return;
  const members: number[] = [];
  for (let k = 0; k < n; k++) {
    const b = newCitizen(sim, { firstName: rng.pick(MALE_NAMES), lastName: rng.pick(['Косой', 'Рваное Ухо', 'Лесной', 'Чёрный', 'Волк', 'Хромой', 'Беззубый']), sex: 'm', age: rng.int(20, 45), cls: 'poor', traits: [Trait.Greedy, Trait.HotTempered], x: start.x + rng.int(-1, 1), y: start.y + rng.int(-1, 1) });
    b.profession = Profession.Thief;
    b.actionData.visitor = 1;
    b.actionData.bandit = 1;
    b.appearance.hat = 4;
    b.hp = 110;
    b.money = 5;
    sim.moneyCreated += 5;
    members.push(b.id);
  }
  const targetGate = g;
  const inward = { x: targetGate.x + (g.dir === 0 ? -3 : g.dir === 2 ? 3 : 0), y: targetGate.y + (g.dir === 1 ? -3 : g.dir === 3 ? 3 : 0) };
  sim.raid = { members, phase: 0, gate: { x: targetGate.x, y: targetGate.y }, until: sim.tick + TICKS_PER_HOUR * 2.5, loot: 0 };
  for (const id of members) {
    const c = sim.citizens[id];
    c.action = 'raid';
    const ctx = makeCtx(sim, c);
    const spot = nearestWalkable(world, inward.x + rng.int(-2, 2), inward.y + rng.int(-2, 2), 4) ?? inward;
    goTo(ctx, spot.x, spot.y);
  }
  sim.chronicle.log(sim.tick, EventKind.Disaster, `Разбойники (${n} чел.) идут к ${g.name.toLowerCase().replace('ые ворота', 'ым воротам')}! Стража, к оружию!`, g.x, g.y, [], 1);
  // стража и храбрецы — к воротам
  const defenders = sim.citizens.filter((c) => c.alive && !c.actionData.visitor && (c.profession === Profession.Guard || (hasTrait(c, Trait.Brave) && !isChild(c) && !isElder(c) && c.sex === 'm')) && c.jailedUntil <= sim.tick && c.state !== CitizenState.Sleeping).sort((a, b) => dist2(a.x, a.y, g.x, g.y) - dist2(b.x, b.y, g.x, g.y)).slice(0, n + 3);
  for (const d of defenders) {
    interrupt(sim, d);
    d.action = 'defend';
    d.actionData.until = sim.raid.until;
    say(d, rng.pick(['К воротам!', 'Разбойники! За мной!', 'Бей их!']), 40, false, sim.tick);
    const spot = nearestWalkable(world, inward.x + rng.int(-2, 2), inward.y + rng.int(-2, 2), 4) ?? inward;
    const ctx = makeCtx(sim, d);
    goTo(ctx, spot.x, spot.y);
  }
  // горожане у ворот — прячутся
  for (const c of sim.citizens) {
    if (!c.alive || c.inside >= 0 || c.actionData.visitor || c.action === 'defend') continue;
    if (dist2(c.x, c.y, g.x, g.y) < 400) {
      c.needs.safety = Math.max(0, c.needs.safety - 30);
      if (rng.chance(0.5)) say(c, rng.pick(['Разбойники!', 'Спасайтесь!', 'Запирайте двери!']), 40, false, sim.tick);
    }
  }
}

const raidAct: ActionDef = {
  id: 'raid',
  interruptible: false,
  score(ctx) {
    return ctx.c.actionData.bandit && ctx.c.action === 'raid' ? 480 : 0;
  },
  start(ctx) {
    actFor(ctx, 40);
    return true;
  },
  arrive(ctx) {
    const { c, sim, rng } = ctx;
    if (rng.chance(0.3)) say(c, rng.pick(['Кошельки на бочку!', 'Город наш!', 'Гы-гы, слабаки!', 'Жги!']), 40, false, sim.tick);
    actFor(ctx, rng.int(5, 15) * 5);
  },
};

const defend: ActionDef = {
  id: 'defend',
  interruptible: false,
  score(ctx) {
    return (ctx.c.actionData.until ?? 0) > ctx.sim.tick && ctx.c.action === 'defend' ? 480 : 0;
  },
  start(ctx) {
    actFor(ctx, 40);
    return true;
  },
  arrive(ctx) {
    const { c, sim, rng } = ctx;
    // найти разбойника рядом и напасть
    const r = sim.raid;
    if (r) {
      for (const id of r.members) {
        const b = sim.citizens[id];
        if (b.alive && b.action !== 'fight' && dist2(b.x, b.y, c.x, c.y) < 9) {
          startFight(sim, c, b, 'схватка с разбойниками');
          return;
        }
      }
      const b = r.members.map((id) => sim.citizens[id]).find((x) => x.alive && x.action !== 'fight');
      if (b) {
        goTo(ctx, Math.round(b.x), Math.round(b.y));
        return;
      }
    }
    actFor(ctx, rng.int(5, 10) * 5);
  },
};

function updateRaid(sim: Simulation): void {
  const r = sim.raid!;
  const alive = r.members.map((id) => sim.citizens[id]).filter((b) => b.alive);
  // побитые разбойники бегут
  for (const b of alive) {
    if (b.hp < 40 && b.action !== 'flee_raid') {
      b.action = 'flee_raid';
      say(b, sim.rng.pick(['Отступаем!', 'Бежим!', 'Проклятый город!']), 40, false, sim.tick);
      const world = sim.world;
      const ex = nearestWalkable(world, b.x < world.w / 2 ? 1 : world.w - 2, Math.round(b.y), 6);
      const ctx = makeCtx(sim, b);
      if (!ex || !goTo(ctx, ex.x, ex.y)) leaveCity(sim, b, 'с позором');
    }
  }
  // грабёж ферм, если никто не мешает
  if (sim.tick % 100 === 0 && r.phase === 0) {
    const defenders = sim.citizens.filter((c) => c.alive && c.action === 'defend').length;
    if (defenders === 0 && sim.rng.chance(0.5)) {
      const farms = sim.world.buildings.filter((b) => b.type === BuildingType.Farm);
      const f = farms.length ? sim.rng.pick(farms) : null;
      if (f) {
        const g = Math.floor((f.storage['grain'] ?? 0) * 0.5);
        f.storage['grain'] = (f.storage['grain'] ?? 0) - g;
        r.loot += g;
        sim.chronicle.log(sim.tick, EventKind.Disaster, `Разбойники разграбили ферму: унесли ${g} мер зерна.`, f.doorX, f.doorY, [], 0.8);
        for (const id of f.residents) {
          const c = sim.citizens[id];
          if (c?.alive) {
            const taken = Math.floor(c.money * 0.5);
            c.money -= taken;
            sim.moneyDestroyed += taken;
            remember(c, sim.tick, 'Разбойники ограбили нашу ферму.', 0.8, -1, 'raid');
          }
        }
        sim.unrest = Math.min(100, sim.unrest + 10);
      }
    }
  }
  const stillFighting = alive.filter((b) => b.action !== 'flee_raid');
  if (sim.tick >= r.until || stillFighting.length === 0) {
    for (const b of alive) {
      if (b.action !== 'flee_raid') {
        b.action = 'flee_raid';
        const world = sim.world;
        const ex = nearestWalkable(world, b.x < world.w / 2 ? 1 : world.w - 2, Math.round(b.y), 6);
        const ctx = makeCtx(sim, b);
        if (!ex || !goTo(ctx, ex.x, ex.y)) leaveCity(sim, b, 'с позором');
      }
    }
    for (const c of sim.citizens) if (c.alive && c.action === 'defend') {
      c.action = '';
      c.state = CitizenState.Idle;
      c.nextThink = sim.tick;
      remember(c, sim.tick, 'Отбивал разбойников у ворот.', 0.7, -1, 'raid');
      c.needs.fun = Math.min(100, c.needs.fun + 10);
      changeRelation(c, c.id, 0);
    }
    sim.chronicle.log(sim.tick, EventKind.Disaster, stillFighting.length === 0 ? 'Разбойники разбиты и бегут от стен Вальдмарка!' : `Разбойники отступают${r.loot ? `, унося добычу` : ''}.`, r.gate.x, r.gate.y, [], 0.9);
    r.phase = 2;
    if (stillFighting.length === 0) sim.unrest = Math.max(0, sim.unrest - 10);
    sim.raid = null;
    // через день убрать всех ушедших
    setTimeoutTick(sim, TICKS_PER_HOUR * 2, () => {
      for (const id of r.members) {
        const b = sim.citizens[id];
        if (b.alive) {
          b.alive = false;
          sim.moneyDestroyed += b.money;
          b.money = 0;
        }
      }
    });
  }
}

const fleeRaid: ActionDef = {
  id: 'flee_raid',
  interruptible: false,
  score(ctx) {
    return ctx.c.action === 'flee_raid' ? 480 : 0;
  },
  start(ctx) {
    actFor(ctx, 50);
    return true;
  },
  arrive(ctx) {
    const { c, sim } = ctx;
    c.alive = true;
    leaveCity(sim, c, 'восвояси');
    sim.chronicle.events.pop();
  },
};

for (const a of [announce, listen, perform, celebrate, duel, protest, caravanAct, caravanLeave, raidAct, defend, fleeRaid]) ACTIONS[a.id] = a;

export const EVENT_LABELS: Record<string, string> = {
  announce: 'оглашает', listen: 'слушает', perform: 'поёт', celebrate: 'празднует', duel: 'бьётся на турнире', protest: 'протестует',
  caravan: 'торгует с караваном', caravan_leave: 'уходит с караваном', raid: 'грабит', defend: 'защищает город', flee_raid: 'бежит',
};
export { GOOD_INFO, BUILDING_DEFS, isWorkHour };
