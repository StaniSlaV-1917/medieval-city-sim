// Здоровье: болезни и эпидемии, обмороки, монахи-лекари, больница, смерть и похороны.
import type { Simulation } from './game';
import { isGood } from '../economy/goods';
import { Citizen, CitizenState, Profession, Trait, hasTrait, isChild, isElder, fullName, nameAcc, FLAG_SICK, FLAG_INJURED, changeRelation } from './citizen';
import { ACTIONS, ActionDef, actFor, goTo, enterBuilding, say, think, remember } from '../ai/actions';
import { makeCtx, interrupt } from '../ai/brain';
import { BuildingType, BUILDING_DEFS, District } from '../world/buildings';
import { EventKind } from '../events/chronicle';
import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../core/time';
import { dist2 } from '../core/math';
import { nearestWalkable } from '../world/world';

const scratch: number[] = [];

export function updateHealth(sim: Simulation): void {
  const tick = sim.tick;
  // Заболевания — проверка раз в 100 тиков для части жителей
  for (let i = tick % 100; i < sim.citizens.length; i += 100) {
    const c = sim.citizens[i];
    if (!c.alive) continue;
    if (c.flags & FLAG_SICK) {
      progressSickness(sim, c);
      continue;
    }
    let p = 0.00005;
    if (c.needs.hunger < 20) p += 0.0001;
    if (c.needs.health < 50) p += 0.0001;
    if (sim.season === 3) p *= 1.6;
    if (sim.weather.rain > 0.5 && c.inside < 0) p *= 1.5;
    if (c.home >= 0 && sim.world.buildings[c.home].district === District.Slums) p *= 1.5;
    if (isElder(c) || c.age < 5) p *= 1.5;
    if (c.home < 0) p *= 2;
    p *= sim.epidemicMul;
    // заражение от больных рядом
    if (c.inside < 0) {
      sim.spatial.query(c.x, c.y, 2, scratch);
      for (const oid of scratch) {
        const o = sim.citizens[oid];
        if (oid !== c.id && o.alive && o.flags & FLAG_SICK && dist2(c.x, c.y, o.x, o.y) < 4) p += 0.003;
      }
    } else {
      for (const id of sim.world.buildings[c.inside].residents) {
        const o = sim.citizens[id];
        if (o && o.alive && o.id !== c.id && o.flags & FLAG_SICK) p += 0.0015;
      }
    }
    if (sim.rng.chance(p)) fallSick(sim, c, 'заболел');
  }
  // Обмороки от голода/усталости
  if (tick % 50 === 0) {
    for (const c of sim.citizens) {
      if (!c.alive || c.inside >= 0 || c.action === 'fainted' || c.action === 'carried') continue;
      if ((c.actionData.lastFaint ?? -1e9) > tick - TICKS_PER_DAY) continue;
      // Голодный обморок — не фон, а событие: только после нескольких часов на нуле
      if (c.needs.hunger <= 0) {
        if (!(c.actionData.starveSince > 0)) c.actionData.starveSince = tick;
      } else if (c.actionData.starveSince > 0) c.actionData.starveSince = 0;
      const starving = c.actionData.starveSince > 0 && tick - c.actionData.starveSince > TICKS_PER_HOUR * 3;
      if ((starving || c.needs.energy <= 0 || c.needs.health < 15) && sim.rng.chance(0.015)) faint(sim, c);
    }
  }
  // Монахи ищут нуждающихся
  if (tick % 30 === 0) dispatchMonks(sim);
  // Смерть от старости (редко) и от болезни — в progressSickness
  if (tick % TICKS_PER_DAY === TICKS_PER_HOUR * 3) {
    for (const c of sim.citizens) {
      if (!c.alive || c.age < 68) continue;
      const p = 0.0008 * (c.age - 66);
      if (sim.rng.chance(p)) die(sim, c, 'от старости');
    }
  }
}

export function fallSick(sim: Simulation, c: Citizen, cause: string): void {
  if (!c.alive || c.flags & FLAG_SICK) return;
  c.flags |= FLAG_SICK;
  c.actionData.sickSince = sim.tick;
  c.actionData.sickSeverity = 0.3 + sim.rng.next() * 0.5;
  think(c, sim.rng.pick(['Что-то знобит…', 'Голова раскалывается.', 'Кашель замучил.']));
  remember(c, sim.tick, cause === 'заболел' ? 'Заболел.' : `Заболел${c.sex === 'f' ? 'а' : ''} (${cause}).`, 0.5, -1, 'sick');
  sim.sickCount++;
}

function progressSickness(sim: Simulation, c: Citizen): void {
  const sev = c.actionData.sickSeverity ?? 0.4;
  const inHospital = c.inside >= 0 && sim.world.buildings[c.inside].type === BuildingType.Monastery;
  const dmg = inHospital ? -0.8 : 0.25 * sev * (c.needs.hunger < 30 ? 1.8 : 1) * (sim.season === 3 ? 1.3 : 1);
  c.needs.health = Math.max(0, Math.min(100, c.needs.health - dmg));
  if (c.inside < 0 && sim.rng.chance(0.15)) say(c, sim.rng.pick(['Кхе-кхе…', 'Апчхи!', 'Ох, лихорадит…']), 25, false, sim.tick);
  // выздоровление
  const days = (sim.tick - c.actionData.sickSince) / TICKS_PER_DAY;
  const recoverP = inHospital ? 0.12 : days > 2 ? 0.05 : 0.015;
  if (c.needs.health > 40 && sim.rng.chance(recoverP)) {
    c.flags &= ~FLAG_SICK;
    think(c, 'Полегчало!');
    remember(c, sim.tick, inHospital ? 'Монахи выходили меня.' : 'Выздоровел.', 0.4, -1, 'recovered');
    if (inHospital) {
      const monk = sim.citizens.find((m) => m.alive && m.profession === Profession.Monk);
      if (monk) changeRelation(c, monk.id, 15);
      c.needs.faith = Math.min(100, c.needs.faith + 20);
    }
    return;
  }
  if (c.needs.health <= 0) die(sim, c, 'от болезни');
}

export function faint(sim: Simulation, c: Citizen): void {
  if (c.action === 'fainted' || c.action === 'carried' || c.jailedUntil > sim.tick) return;
  c.actionData.lastFaint = sim.tick;
  interrupt(sim, c);
  c.action = 'fainted';
  c.state = CitizenState.Acting;
  c.actionUntil = sim.tick + TICKS_PER_HOUR;
  c.path = null;
  c.dir = 0;
  say(c, sim.rng.pick(['Ох…', 'В глазах темнеет…', '…']), 30, false, sim.tick);
  remember(c, sim.tick, c.needs.hunger <= 0 ? 'Упал в обморок от голода.' : 'Упал в обморок на улице.', 0.6, -1, 'faint');
  sim.chronicle.log(sim.tick, EventKind.Info, `${fullName(c)} упал${c.sex === 'f' ? 'а' : ''} в обморок на улице${c.needs.hunger <= 0 ? ' от голода' : ''}.`, Math.round(c.x), Math.round(c.y), [c.id], 0.5);
  // прохожие
  sim.spatial.query(c.x, c.y, 4, scratch);
  for (const oid of scratch) {
    const o = sim.citizens[oid];
    if (oid === c.id || !o.alive || o.inside >= 0) continue;
    if (sim.rng.chance(0.4)) {
      say(o, sim.rng.pick(['Человеку плохо!', 'Лекаря! Позовите монахов!', 'Эй, ты живой?']), 35, false, sim.tick + 10);
      break;
    }
  }
}

const fainted: ActionDef = {
  id: 'fainted',
  interruptible: false,
  score: () => 0,
  start: () => false,
  arrive(ctx) {
    actFor(ctx, 10);
  },
  tick(ctx) {
    const c = ctx.c;
    c.needs.energy = Math.min(100, c.needs.energy + 0.3);
    return false;
  },
  finish(ctx) {
    const { c } = ctx;
    if (c.action === 'fainted') think(c, 'Очнулся… Надо домой.');
  },
};

/** Монахи-лекари подбирают больных, раненых и упавших */
function dispatchMonks(sim: Simulation): void {
  const hospital = sim.world.buildings.find((b) => b.type === BuildingType.Monastery);
  if (!hospital) return;
  const monks = sim.citizens.filter((m) => m.alive && m.profession === Profession.Monk && m.action !== 'heal' && m.action !== 'carry' && m.state !== CitizenState.Sleeping);
  if (!monks.length) return;
  for (const c of sim.citizens) {
    if (!c.alive || c.inside >= 0 || c.action === 'carried' || c.action === 'heal') continue;
    const needs = c.action === 'fainted' || (c.flags & FLAG_INJURED && c.hp < 35) || (c.flags & FLAG_SICK && c.needs.health < 35);
    if (!needs) continue;
    if (c.actionData.pickupPending && sim.tick - c.actionData.pickupPending < 900) continue;
    // ближайший свободный монах
    let best: Citizen | null = null;
    let bestD = Infinity;
    for (const m of monks) {
      const d = dist2(m.x, m.y, c.x, c.y);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    if (!best) return;
    monks.splice(monks.indexOf(best), 1);
    c.actionData.pickupPending = sim.tick;
    interrupt(sim, best);
    best.action = 'heal';
    best.actionData.patient = c.id;
    best.actionData.phase = 0;
    think(best, sim.rng.pick([`Надо помочь — ${c.firstName} плохо.`, 'Господь велит помогать страждущим.', 'Скорее, пока не поздно.']));
    const ctx = makeCtx(sim, best);
    if (!goTo(ctx, Math.round(c.x), Math.round(c.y))) best.action = '';
    if (!monks.length) return;
  }
}

const heal: ActionDef = {
  id: 'heal',
  interruptible: false,
  score: () => 0,
  start(ctx) {
    const { c, sim } = ctx;
    const p = sim.citizens[c.actionData.patient];
    if (!p || !p.alive) return false;
    if (c.actionData.phase === 0) return goTo(ctx, Math.round(p.x), Math.round(p.y));
    const h = sim.world.buildings.find((b) => b.type === BuildingType.Monastery);
    if (!h) return false;
    return goTo(ctx, h.doorX, h.doorY);
  },
  arrive(ctx) {
    const { c, sim, rng } = ctx;
    const p = sim.citizens[c.actionData.patient];
    const h = sim.world.buildings.find((b) => b.type === BuildingType.Monastery);
    if (!p || !p.alive || !h) {
      c.action = '';
      return actFor(ctx, 5);
    }
    if (c.actionData.phase === 0) {
      if (p.inside >= 0 || dist2(c.x, c.y, p.x, p.y) > 9) {
        c.actionData.tries = (c.actionData.tries ?? 0) + 1;
        if (c.actionData.tries > 5 || p.inside >= 0) {
          c.action = '';
          c.actionData.tries = 0;
          return actFor(ctx, 5);
        }
        if (!goTo(ctx, Math.round(p.x), Math.round(p.y))) return actFor(ctx, 10);
        return;
      }
      // подобрать
      say(c, rng.pick(['Держись, брат.', 'Сейчас отнесём в больницу.', 'Тихо, тихо, всё будет хорошо.']), 35, false, sim.tick);
      interrupt(sim, p);
      p.action = 'carried';
      p.state = CitizenState.Acting;
      p.actionUntil = sim.tick + 2000;
      p.actionData.carrier = c.id;
      p.path = null;
      c.actionData.phase = 1;
      c.actionData.tries = 0;
      c.speed = 0.8;
      if (!goTo(ctx, h.doorX, h.doorY)) {
        c.action = '';
        p.action = '';
        p.state = CitizenState.Idle;
        return actFor(ctx, 5);
      }
      return;
    }
    // в больнице
    c.speed = 1;
    enterBuilding(ctx, h);
    p.x = h.doorX;
    p.y = h.doorY;
    p.px = p.x;
    p.py = p.y;
    p.inside = h.id;
    p.action = 'hospital';
    p.state = CitizenState.Acting;
    p.actionUntil = sim.tick + TICKS_PER_HOUR * (p.flags & FLAG_SICK ? 20 : 8);
    p.actionData.carrier = -1;
    remember(p, sim.tick, `Монах ${fullName(c)} отнёс меня в больницу.`, 0.6, c.id, 'hospital');
    changeRelation(p, c.id, 20);
    remember(c, sim.tick, `Отнёс${c.sex === 'f' ? 'ла' : ''} ${nameAcc(p)} в больницу.`, 0.4, p.id, 'hospital');
    sim.chronicle.log(sim.tick, EventKind.Info, `Монахи отнесли ${nameAcc(p)} в монастырскую больницу.`, h.doorX, h.doorY, [p.id, c.id], 0.4);
    c.action = '';
    actFor(ctx, 10 * 5);
  },
};

const carried: ActionDef = {
  id: 'carried',
  interruptible: false,
  score: () => 0,
  start: () => false,
  arrive(ctx) {
    actFor(ctx, 10);
  },
  tick(ctx) {
    const { c, sim } = ctx;
    const m = sim.citizens[c.actionData.carrier];
    if (!m || !m.alive || m.action !== 'heal') {
      c.action = '';
      return true;
    }
    // следовать за носильщиком
    c.px = c.x;
    c.py = c.y;
    c.x = m.x + (m.dir === 1 ? 0.4 : m.dir === 2 ? -0.4 : 0);
    c.y = m.y + 0.3;
    c.dir = m.dir;
    return false;
  },
};

const hospital: ActionDef = {
  id: 'hospital',
  interruptible: false,
  score(ctx) {
    const { c, sim } = ctx;
    return c.inside >= 0 && sim.world.buildings[c.inside]?.type === BuildingType.Monastery && (c.flags & (FLAG_SICK | FLAG_INJURED)) && c.profession !== Profession.Monk ? 700 : 0;
  },
  start(ctx) {
    actFor(ctx, TICKS_PER_HOUR * 4);
    return true;
  },
  arrive(ctx) {
    actFor(ctx, TICKS_PER_HOUR * 4);
  },
  tick(ctx) {
    const c = ctx.c;
    c.hp = Math.min(100, c.hp + 0.6);
    c.needs.health = Math.min(100, c.needs.health + 0.35);
    c.needs.hunger = Math.min(100, c.needs.hunger + 0.5);
    c.needs.energy = Math.min(100, c.needs.energy + 0.2);
    if (c.hp >= 70) c.flags &= ~FLAG_INJURED;
    if (!(c.flags & (FLAG_SICK | FLAG_INJURED))) {
      think(c, 'Выписали. Спасибо братьям.');
      return true;
    }
    return false;
  },
};

/** Смерть и похороны */
export function die(sim: Simulation, c: Citizen, cause: string): void {
  if (!c.alive) return;
  c.alive = false;
  c.inside = -1;
  c.order = null;
  const tick = sim.tick;
  sim.deaths++;
  for (const [k, v] of Object.entries(c.inventory)) if (v > 0 && isGood(k)) sim.market.flow(k, 'пропало с умершим', -v, 'spoiled');
  c.inventory = {};
  sim.events.emit('citizen:died', { id: c.id, cause });
  sim.chronicle.log(tick, EventKind.Death, `${fullName(c)} умер${c.sex === 'f' ? 'ла' : ''} ${cause} в возрасте ${c.age} лет.`, Math.round(c.x), Math.round(c.y), [c.id], 0.9);
  // семья
  const mourners: Citizen[] = [];
  for (const id of [c.spouse, ...c.children, ...c.parents]) {
    const o = sim.citizens[id];
    if (!o || !o.alive) continue;
    const rel = id === c.spouse ? (o.sex === 'f' ? 'муж' : 'жена') : c.children.includes(id) ? (c.sex === 'f' ? 'мать' : 'отец') : c.sex === 'f' ? 'дочь' : 'сын';
    remember(o, tick, `Умер${c.sex === 'f' ? 'ла' : ''} ${rel === 'муж' || rel === 'жена' ? `мо${rel === 'муж' ? 'й муж' : 'я жена'}` : rel === 'мать' ? 'моя мать' : rel === 'отец' ? 'мой отец' : `мо${rel === 'дочь' ? 'я дочь' : 'й сын'}`} — ${fullName(c)}.`, 1, c.id, 'death');
    o.mood -= 40;
    o.needs.fun = Math.max(0, o.needs.fun - 30);
    o.needs.faith = Math.max(0, o.needs.faith - 20);
    if (id === c.spouse) o.spouse = -1;
    mourners.push(o);
  }
  for (const [id, v] of c.relations) {
    const o = sim.citizens[id];
    if (o && o.alive && v > 40) {
      remember(o, tick, `Умер${c.sex === 'f' ? 'ла' : ''} ${c.sex === 'f' ? 'моя подруга' : 'мой друг'} ${fullName(c)}.`, 0.7, c.id, 'death');
      o.mood -= 15;
      mourners.push(o);
    }
  }
  // дом, работа
  if (c.home >= 0) {
    const h = sim.world.buildings[c.home];
    h.residents = h.residents.filter((id) => id !== c.id);
  }
  if (c.workplace >= 0) {
    const w = sim.world.buildings[c.workplace];
    w.workers = w.workers.filter((id) => id !== c.id);
    if (w.owner === c.id) {
      // наследник: супруг или старший ребёнок, иначе работник
      const heir = [c.spouse, ...c.children].map((id) => sim.citizens[id]).find((o) => o && o.alive && !isChild(o)) ?? sim.citizens[w.workers[0]] ?? null;
      w.owner = heir ? heir.id : -1;
    }
  }
  // наследство
  if (c.money > 0) {
    const heir = [c.spouse, ...c.children, ...c.parents].map((id) => sim.citizens[id]).find((o) => o && o.alive);
    if (heir) heir.money += c.money;
    else sim.treasury += c.money;
    c.money = 0;
  }
  // похороны: процессия на кладбище
  sim.funerals.push({ dead: c.id, tick, mourners: mourners.map((m) => m.id).slice(0, 8), phase: 0 });
}

export function updateFunerals(sim: Simulation): void {
  if (!sim.funerals.length) return;
  const chapel = sim.world.buildings.find((b) => b.type === BuildingType.Chapel);
  for (let i = sim.funerals.length - 1; i >= 0; i--) {
    const f = sim.funerals[i];
    if (f.phase === 0 && sim.tick - f.tick > TICKS_PER_HOUR * 3) {
      f.phase = 1;
      const dead = sim.citizens[f.dead];
      const spot = chapel ? nearestWalkable(sim.world, chapel.doorX, chapel.doorY + 2, 4) : null;
      const priest = sim.citizens.find((p) => p.alive && p.profession === Profession.Priest);
      const ids = [...f.mourners];
      if (priest) ids.push(priest.id);
      for (const id of ids) {
        const m = sim.citizens[id];
        if (!m || !m.alive || m.jailedUntil > sim.tick || m.action === 'fainted') continue;
        interrupt(sim, m);
        m.action = 'funeral';
        m.actionData.funeralUntil = sim.tick + TICKS_PER_HOUR * 2;
        think(m, `Проводить ${nameAcc(dead)} в последний путь.`);
        const ctx = makeCtx(sim, m);
        if (spot) goTo(ctx, spot.x + sim.rng.int(-2, 2), spot.y + sim.rng.int(0, 2));
        else m.action = '';
      }
      if (chapel) sim.chronicle.log(sim.tick, EventKind.Death, `${nameAcc(dead)} похоронили на кладбище у часовни.`, chapel.doorX, chapel.doorY, [], 0.5);
    }
    if (f.phase === 1 && sim.tick - f.tick > TICKS_PER_HOUR * 6) sim.funerals.splice(i, 1);
  }
}

const funeral: ActionDef = {
  id: 'funeral',
  interruptible: false,
  score(ctx) {
    return (ctx.c.actionData.funeralUntil ?? 0) > ctx.sim.tick ? 600 : 0;
  },
  start(ctx) {
    actFor(ctx, Math.max(10, ctx.c.actionData.funeralUntil - ctx.sim.tick));
    return true;
  },
  arrive(ctx) {
    const { c, sim, rng } = ctx;
    c.dir = 3;
    actFor(ctx, Math.max(10, c.actionData.funeralUntil - sim.tick));
    if (rng.chance(0.5)) say(c, rng.pick(['Покойся с миром.', 'Земля пухом…', 'Господи, прими душу…', '*плачет*']), 40, false, sim.tick + rng.int(0, 200));
    c.needs.faith = Math.min(100, c.needs.faith + 10);
  },
};

export const HEALTH_LABELS: Record<string, string> = { fainted: 'без сознания', heal: 'спешит к больному', carried: 'несут в больницу', hospital: 'в больнице', funeral: 'на похоронах' };

for (const a of [fainted, heal, carried, hospital, funeral]) ACTIONS[a.id] = a;
export { Trait, hasTrait, BUILDING_DEFS };
