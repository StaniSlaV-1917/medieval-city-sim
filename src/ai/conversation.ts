// Разговоры: встречи на улице, реплики, отношения, слухи, ссоры, милостыня.
import type { Simulation } from '../sim/game';
import { Citizen, CitizenState, Trait, hasTrait, isChild, relation, changeRelation, fullName, Profession } from '../sim/citizen';
import { ACTIONS, remember, say, setStartTalk } from './actions';
import { makeLine, pickTopic, Line, Topic, ALMS_GIVE, ALMS_THANKS } from './dialogue';
import { dist2 } from '../core/math';
import { EventKind } from '../events/chronicle';
import { pay } from '../economy/money';
import { maybeFightAfterQuarrel } from '../sim/crime';

export interface Talk {
  a: number;
  b: number;
  lines: number; // всего реплик
  index: number; // следующая реплика
  nextLine: number; // тик
  lastLine: Line | null;
  prevTopic: Topic | null;
  quarrel: boolean;
  speaker: number; // кто говорит следующим
  forced: number;
}

setStartTalk((sim, a, b) => startTalk(sim, a, b));
const scratch: number[] = [];

export function updateConversations(sim: Simulation): void {
  const tick = sim.tick;
  const talks = sim.talks;
  // Продолжение текущих разговоров
  for (const [key, t] of talks) {
    const a = sim.citizens[t.a];
    const b = sim.citizens[t.b];
    if (!a.alive || !b.alive || a.state !== CitizenState.Talking || b.state !== CitizenState.Talking) {
      endTalk(sim, t, false);
      talks.delete(key);
      continue;
    }
    if (tick >= t.nextLine) {
      if (t.index >= t.lines) {
        endTalk(sim, t, true);
        talks.delete(key);
        continue;
      }
      const sp = sim.citizens[t.speaker];
      const li = sim.citizens[t.speaker === t.a ? t.b : t.a];
      const ctx = { sim, rng: sim.rng, speaker: sp, listener: li };
      // ссора может вспыхнуть посреди разговора
      if (!t.quarrel && t.index > 0 && t.index < t.lines - 1) {
        let p = 0.004;
        if (hasTrait(sp, Trait.HotTempered)) p += 0.04;
        if (hasTrait(sp, Trait.Envious) && li.money > sp.money * 2) p += 0.05;
        if (sp.drunk > 50) p += 0.08;
        if (relation(sp, li.id) < -20) p += 0.1;
        if (sp.mood < -30) p += 0.05;
        if (hasTrait(sp, Trait.Kind) || hasTrait(sp, Trait.Cowardly)) p *= 0.3;
        if (t.forced === 1 || t.forced === 3) p = 0;
        if (isChild(sp) || isChild(li)) p *= 0.2;
        if (sim.rng.chance(p)) {
          t.quarrel = true;
          t.lines = Math.min(t.lines + 2, t.index + 4);
        }
      }
      let topic = pickTopic(ctx, t.prevTopic, t.index, t.lines, t.quarrel);
      if (t.forced === 3 && t.index > 0 && t.index < t.lines - 1) topic = 'flirt';
      const line = makeLine(ctx, topic, t.lastLine);
      say(sp, line.text, 45, false, tick);
      // слух передан
      if (line.rumor && !isChild(li)) {
        const known = li.memories.some((m) => m.about === line.rumor!.about && m.topic === line.rumor!.topic);
        if (!known) remember(li, tick, line.rumor.text, line.rumor.importance, line.rumor.about, line.rumor.topic);
        // отношение к третьему лицу
        if (line.about >= 0 && line.about !== li.id) {
          const d = line.rumor.topic === 'praise' ? 2 : line.rumor.topic === 'blame' ? -3 : 0;
          if (d) changeRelation(li, line.about, d * (hasTrait(li, Trait.Kind) ? 0.5 : 1));
        }
      }
      t.lastLine = line;
      t.prevTopic = line.topic;
      t.index++;
      t.speaker = t.speaker === t.a ? t.b : t.a;
      t.nextLine = tick + 30 + Math.round(line.text.length * 0.5) + sim.rng.int(0, 15);
    }
  }
  // Новые встречи: раз в 10 тиков часть жителей
  const cs = sim.citizens;
  for (let i = tick % 10; i < cs.length; i += 10) {
    const c = cs[i];
    if (!c.alive || c.inside >= 0 || c.talkCooldown > 0) continue;
    if (c.state === CitizenState.Talking || c.state === CitizenState.Sleeping) continue;
    if (c.lod === 1 && (tick / 10) % 3 !== 0) continue;
    const def = ACTIONS[c.action];
    if (def && !def.interruptible) continue;
    // милостыня: нищим подают добрые и набожные
    if (c.profession === Profession.Beggar && c.state === CitizenState.Acting) {
      tryAlms(sim, c);
      continue;
    }
    // желание поговорить
    let want = (100 - c.needs.social) / 100;
    if (hasTrait(c, Trait.Talkative)) want += 0.3;
    if (hasTrait(c, Trait.Gloomy)) want -= 0.3;
    if (hasTrait(c, Trait.Curious)) want += 0.1;
    if (c.action === 'work' || c.action === 'patrol') want -= 0.35;
    if (c.action === 'stroll' || c.action === 'bench' || c.action === 'wander' || c.action === 'fetch_water' || c.action === 'play') want += 0.25;
    if (want < 0.15) continue;
    sim.spatial.query(c.x, c.y, 1.6, scratch);
    let best: Citizen | null = null;
    let bestScore = 0;
    for (const oid of scratch) {
      if (oid === c.id) continue;
      const o = cs[oid];
      if (!o.alive || o.inside >= 0 || o.talkCooldown > 0 || o.state === CitizenState.Talking || o.state === CitizenState.Sleeping) continue;
      const od = ACTIONS[o.action];
      if (od && !od.interruptible) continue;
      if (o.profession === Profession.Beggar && c.profession !== Profession.Beggar && !hasTrait(c, Trait.Kind)) continue;
      if (dist2(c.x, c.y, o.x, o.y) > 1.6 * 1.6) continue;
      const rel = relation(c, oid);
      let s = 0.3 + rel / 100 + want;
      if (isChild(c) !== isChild(o)) s -= 0.4;
      if (hasTrait(c, Trait.Envious) && o.money > c.money * 3) s -= 0.2;
      if (o.action === 'work' || o.action === 'patrol') s -= 0.3;
      if (rel < -40) s -= 0.3;
      if (s > bestScore) {
        bestScore = s;
        best = o;
      }
    }
    if (best && sim.rng.chance(Math.min(0.9, bestScore * 0.5))) startTalk(sim, c, best);
  }
}

export function startTalk(sim: Simulation, a: Citizen, b: Citizen): boolean {
  if (a.state === CitizenState.Talking || b.state === CitizenState.Talking) return false;
  for (const c of [a, b]) {
    c.path = null;
    c.state = CitizenState.Talking;
    c.talkingTo = c === a ? b.id : a.id;
  }
  // смотреть друг на друга
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    a.dir = dx > 0 ? 2 : 1;
    b.dir = dx > 0 ? 1 : 2;
  } else {
    a.dir = dy > 0 ? 0 : 3;
    b.dir = dy > 0 ? 3 : 0;
  }
  let lines = 3 + sim.rng.int(0, 2);
  if (hasTrait(a, Trait.Talkative) || hasTrait(b, Trait.Talkative)) lines += 2;
  if (relation(a, b.id) > 40) lines += 1;
  if (hasTrait(a, Trait.Gloomy) && hasTrait(b, Trait.Gloomy)) lines = 2;
  let quarrel = false;
  const rel = relation(a, b.id);
  let forced = 0;
  if (sim.forcedTalk && sim.forcedTalk.a === a.id) {
    forced = sim.forcedTalk.mode;
    sim.forcedTalk = null;
    if (forced === 2) quarrel = true;
    if (forced === 1) lines += 2;
  }
  if (rel < -30 && sim.rng.chance(0.4)) quarrel = true;
  if (hasTrait(a, Trait.HotTempered) && a.drunk > 40 && sim.rng.chance(0.3)) quarrel = true;
  sim.talks.set(a.id, { a: a.id, b: b.id, lines, index: 0, nextLine: sim.tick + 3, lastLine: null, prevTopic: null, quarrel, speaker: a.id, forced });
  return true;
}

function endTalk(sim: Simulation, t: Talk, completed: boolean): void {
  const a = sim.citizens[t.a];
  const b = sim.citizens[t.b];
  const tick = sim.tick;
  for (const c of [a, b]) {
    if (c.state === CitizenState.Talking) c.state = CitizenState.Idle;
    c.talkingTo = -1;
    c.nextThink = tick + sim.rng.int(0, 10);
    c.talkCooldown = 200 + sim.rng.int(0, 400);
    c.action = c.action === 'talk' ? '' : c.action;
  }
  if (!completed) return;
  if (t.quarrel) {
    const d = -(8 + sim.rng.int(0, 10));
    changeRelation(a, b.id, d);
    changeRelation(b, a.id, d);
    a.needs.safety = Math.max(0, a.needs.safety - 8);
    b.needs.safety = Math.max(0, b.needs.safety - 8);
    a.mood -= 10;
    b.mood -= 10;
    remember(a, tick, `Поссорился${a.sex === 'f' ? 'ась' : 'ся'} с ${fullName(b)}.`, 0.45, b.id, 'quarrel');
    remember(b, tick, `Поссорился${b.sex === 'f' ? 'ась' : 'ся'} с ${fullName(a)}.`, 0.45, a.id, 'quarrel');
    if (maybeFightAfterQuarrel(sim, a, b) || maybeFightAfterQuarrel(sim, b, a)) return;
    if (sim.rng.chance(0.25)) sim.chronicle.log(tick, EventKind.Social, `${fullName(a)} и ${fullName(b)} поругались на улице.`, Math.round(a.x), Math.round(a.y), [a.id, b.id], 0.3);
    // свидетели запоминают
    sim.spatial.query(a.x, a.y, 5, scratch);
    for (const oid of scratch) {
      if (oid === a.id || oid === b.id) continue;
      const o = sim.citizens[oid];
      if (!o.alive || o.inside >= 0 || isChild(o)) continue;
      if (sim.rng.chance(0.5)) remember(o, tick, `${fullName(a)} и ${fullName(b)} ругались на улице.`, 0.3, a.id, 'quarrel');
    }
    return;
  }
  // Удачный разговор: общение, отношения по совместимости
  let delta = 2 + sim.rng.int(0, 3);
  if (t.forced === 1) delta += 6;
  if (t.forced === 3) delta += 5;
  const compat = compatibility(a, b);
  delta += compat;
  if (hasTrait(a, Trait.Cheerful) || hasTrait(b, Trait.Cheerful)) delta += 1;
  if (a.drunk > 50 || b.drunk > 50) delta -= 2;
  const relBeforeA = relation(a, b.id);
  const relBeforeB = relation(b, a.id);
  changeRelation(a, b.id, delta);
  changeRelation(b, a.id, delta);
  const gain = 18 + t.lines * 3;
  a.needs.social = Math.min(100, a.needs.social + gain);
  b.needs.social = Math.min(100, b.needs.social + gain);
  a.needs.fun = Math.min(100, a.needs.fun + 4);
  b.needs.fun = Math.min(100, b.needs.fun + 4);
  // Пороги: друзья / враги
  const relA = relation(a, b.id);
  if (relBeforeA < 40 && relA >= 40 && !isChild(a)) {
    remember(a, tick, `Подружился${a.sex === 'f' ? 'ась' : 'ся'} с ${fullName(b)}.`, 0.6, b.id, 'friend');
    remember(b, tick, `Подружился${b.sex === 'f' ? 'ась' : 'ся'} с ${fullName(a)}.`, 0.6, a.id, 'friend');
    if (sim.rng.chance(0.3)) sim.chronicle.log(tick, EventKind.Social, `${fullName(a)} и ${fullName(b)} стали друзьями.`, Math.round(a.x), Math.round(a.y), [a.id, b.id], 0.25);
  }
  if (t.lastLine && t.prevTopic === 'flirt' && relA > 20) {
    remember(a, tick, `Строил${a.sex === 'f' ? 'а' : ''} глазки ${fullName(b)}.`, 0.4, b.id, 'flirt');
  }
  if (relBeforeB < 40 && relation(b, a.id) >= 40) void 0;
  if (sim.rng.chance(0.15)) remember(a, tick, `Поболтал${a.sex === 'f' ? 'а' : ''} с ${fullName(b)}.`, 0.1, b.id);
}

/** Совместимость характеров -3..+3 */
export function compatibility(a: Citizen, b: Citizen): number {
  let s = 0;
  const has = (c: Citizen, t: Trait) => hasTrait(c, t);
  if (has(a, Trait.Kind) || has(b, Trait.Kind)) s += 1;
  if (has(a, Trait.Cheerful) && has(b, Trait.Cheerful)) s += 1;
  if (has(a, Trait.Pious) && has(b, Trait.Drunkard)) s -= 2;
  if (has(b, Trait.Pious) && has(a, Trait.Drunkard)) s -= 2;
  if (has(a, Trait.Drunkard) && has(b, Trait.Drunkard)) s += 2;
  if (has(a, Trait.Honest) && has(b, Trait.Greedy)) s -= 1;
  if (has(b, Trait.Honest) && has(a, Trait.Greedy)) s -= 1;
  if (has(a, Trait.Gloomy) && has(b, Trait.Cheerful)) s -= 1;
  if (has(b, Trait.Gloomy) && has(a, Trait.Cheerful)) s -= 1;
  if (has(a, Trait.HotTempered) && has(b, Trait.HotTempered)) s -= 2;
  if (has(a, Trait.Envious) && b.money > a.money * 2) s -= 2;
  if (has(b, Trait.Envious) && a.money > b.money * 2) s -= 2;
  if (has(a, Trait.Pious) && has(b, Trait.Pious)) s += 1;
  if (has(a, Trait.Ambitious) && has(b, Trait.Ambitious)) s += 1;
  if (a.profession === b.profession) s += 1;
  return Math.max(-3, Math.min(3, s));
}

function tryAlms(sim: Simulation, beggar: Citizen): void {
  sim.spatial.query(beggar.x, beggar.y, 2, scratch);
  for (const oid of scratch) {
    if (oid === beggar.id) continue;
    const o = sim.citizens[oid];
    if (!o.alive || o.inside >= 0 || isChild(o) || o.money < 4 || o.profession === Profession.Beggar) continue;
    if (dist2(o.x, o.y, beggar.x, beggar.y) > 4) continue;
    let p = 0.08;
    if (hasTrait(o, Trait.Kind)) p += 0.4;
    if (hasTrait(o, Trait.Pious)) p += 0.25;
    if (hasTrait(o, Trait.Greedy)) p -= 0.08;
    if (o.money > 50) p += 0.1;
    if (relation(o, beggar.id) < -10) p = 0;
    if (!sim.rng.chance(p)) continue;
    const amount = o.money > 100 && hasTrait(o, Trait.Kind) ? 2 : 1;
    pay(sim, o, beggar, amount);
    say(o, ALMS_GIVE[sim.rng.int(0, ALMS_GIVE.length - 1)], 35, false, sim.tick);
    say(beggar, ALMS_THANKS[sim.rng.int(0, ALMS_THANKS.length - 1)], 35, false, sim.tick + 12);
    changeRelation(beggar, o.id, 8);
    o.needs.faith = Math.min(100, o.needs.faith + 3);
    remember(beggar, sim.tick, `${fullName(o)} подал${o.sex === 'f' ? 'а' : ''} мне монету.`, 0.3, o.id, 'alms');
    beggar.talkCooldown = 100;
    return;
  }
}
