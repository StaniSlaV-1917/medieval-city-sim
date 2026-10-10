// Выбор действия на основе полезности.
import type { Simulation } from '../sim/game';
import { Citizen, CitizenState, Trait, hasTrait } from '../sim/citizen';
import { ACTIONS, ActionCtx, ActionDef } from './actions';
import { scheduleOf } from '../sim/schedule';
import { hourOf } from '../core/time';

const ORDER: ActionDef[] = Object.values(ACTIONS);

export function makeCtx(sim: Simulation, c: Citizen): ActionCtx {
  return { sim, c, hour: hourOf(sim.tick), sched: scheduleOf(sim, c), rng: sim.rng };
}

/** Выбрать и начать лучшее действие */
export function think(sim: Simulation, c: Citizen): void {
  const ctx = makeCtx(sim, c);
  let best: ActionDef | null = null;
  let bestScore = -Infinity;
  const noise = hasTrait(c, Trait.Curious) ? 6 : 3;
  for (const a of ORDER) {
    let s = a.score(ctx);
    if (s <= 0) continue;
    s += sim.rng.float(0, noise);
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }
  if (!best) best = ACTIONS.idle;
  startAction(ctx, best);
}

export function startAction(ctx: ActionCtx, def: ActionDef): boolean {
  const { c, sim } = ctx;
  const prev = c.action;
  if (prev !== def.id && (prev === 'work' || prev === 'patrol')) {
    const pd = ACTIONS[prev];
    if (pd.finish) pd.finish(ctx); // жалованье в конце смены
  }
  c.action = def.id;
  if (prev !== def.id) c.actionData = { ...c.actionData, building: -1, outdoor: 0 };
  const ok = def.start(ctx);
  if (!ok) {
    c.action = 'idle';
    c.state = CitizenState.Acting;
    c.actionUntil = sim.tick + 10 + sim.rng.int(0, 10);
    return false;
  }
  return true;
}

/** Принудительно завершить текущее действие и подумать снова */
export function interrupt(sim: Simulation, c: Citizen): void {
  const def = ACTIONS[c.action];
  if (def && def.finish) def.finish(makeCtx(sim, c));
  c.action = '';
  c.path = null;
  c.state = CitizenState.Idle;
  c.nextThink = sim.tick;
}
