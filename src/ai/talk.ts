// Запуск разговора двух жителей. Вынесено отдельно, чтобы actions.ts и conversation.ts
// могли импортировать его без циклических ссылок.
import type { Simulation } from '../sim/game';
import { Citizen, CitizenState, Trait, hasTrait, relation } from '../sim/citizen';

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
  // 3–6 реплик: приветствие, тема, ответ, … , прощание
  let lines = 4 + sim.rng.int(0, 1);
  if (hasTrait(a, Trait.Talkative) || hasTrait(b, Trait.Talkative)) lines += 1;
  if (relation(a, b.id) > 40) lines += 1;
  if (hasTrait(a, Trait.Gloomy) && hasTrait(b, Trait.Gloomy)) lines = 3;
  if (a.action === 'work' || b.action === 'work') lines = Math.min(lines, 4);
  lines = Math.min(6, lines);
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
  sim.talks.set(a.id, { a: a.id, b: b.id, lines, index: 0, nextLine: sim.tick + 3, lastLine: null, prevTopic: null, quarrel, speaker: a.id, forced, history: [] });
  sim.events.emit('talk:start', { a: a.id, b: b.id });
  return true;
}
