// Системы симуляции жителей: потребности, движение, действия, LOD.
import type { Simulation } from './game';
import { Citizen, CitizenState } from './citizen';
import { stepMovement, rescue } from './movement';
import { ACTIONS } from '../ai/actions';
import { think, makeCtx } from '../ai/brain';
import { decayNeeds, computeMood } from './needs';
import { updateConversations } from '../ai/conversation';
import { hourOf, daylight } from '../core/time';
import { updateCrime, updateTavernBrawls, checkRobbed, checkBurgled, guardSpotsWanted } from './crime';
import { Profession } from './citizen';

const LOD_DIST = 70; // тайлов от фокуса камеры

export function stepCitizens(sim: Simulation): void {
  const tick = sim.tick;
  const cs = sim.citizens;
  const fx = sim.focusX;
  const fy = sim.focusY;
  // LOD раз в 30 тиков
  const updateLod = tick % 30 === 0;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (!c.alive) continue;
    c.px = c.x;
    c.py = c.y;
    if (updateLod) {
      const dx = c.x - fx;
      const dy = c.y - fy;
      c.lod = dx * dx + dy * dy > LOD_DIST * LOD_DIST ? 1 : 0;
    }
    // Упрощённая симуляция: далёкие жители обновляются раз в 2 тика с двойным шагом
    if (c.lod === 1 && (tick + i) % 2 === 1) continue;
    const mul = c.lod === 1 ? 2 : 1;
    stepCitizen(sim, c, mul);
  }
  updateConversations(sim);
  updateCrime(sim);
  updateTavernBrawls(sim);
  if (tick % 20 === 0) updateBuildingLights(sim);
}

function stepCitizen(sim: Simulation, c: Citizen, mul: number): void {
  const tick = sim.tick;
  // Потребности — раз в 10 тиков
  if ((tick + c.id) % 10 === 0) {
    decayNeeds(c, 10);
    if (c.hp < 100 && c.state === CitizenState.Sleeping) c.hp = Math.min(100, c.hp + 0.25);
    else if (c.hp < 100 && (tick + c.id) % 50 === 0) c.hp = Math.min(100, c.hp + 0.5);
    if (c.hp >= 60) c.flags &= ~8;
    if ((tick + c.id) % 100 === 0) c.mood = computeMood(c);
  }
  if (c.speech && c.speech.until <= tick) c.speech = null;
  if (c.talkCooldown > 0) c.talkCooldown -= mul;

  switch (c.state) {
    case CitizenState.Moving: {
      const before = c.x + c.y * 1000;
      const arrived = stepMovement(sim, c, mul);
      if (!arrived) {
        if (Math.abs(c.x + c.y * 1000 - before) < 1e-6) {
          c.stuckTicks += mul;
          if (c.stuckTicks > 60) {
            // перепланировать, иначе спасать
            c.pathFails++;
            if (c.pathFails > 3) rescue(sim, c);
            else {
              c.path = null;
              c.state = CitizenState.Idle;
              c.nextThink = tick;
            }
            c.stuckTicks = 0;
          }
        } else c.stuckTicks = 0;
      } else {
        c.pathFails = 0;
        const def = ACTIONS[c.action];
        if (def) def.arrive(makeCtx(sim, c));
        else {
          c.state = CitizenState.Idle;
          c.nextThink = tick;
        }
      }
      break;
    }
    case CitizenState.Acting:
    case CitizenState.Sleeping: {
      const def = ACTIONS[c.action];
      let done = tick >= c.actionUntil;
      if (!done && def && def.tick && (tick + c.id) % 10 === 0) done = def.tick(makeCtx(sim, c));
      if (c.profession === Profession.Guard && (tick + c.id) % 15 === 0) guardSpotsWanted(sim, c);
      if (done) {
        if (def && def.finish) def.finish(makeCtx(sim, c));
        c.state = CitizenState.Idle;
        c.nextThink = tick;
      }
      break;
    }
    case CitizenState.Talking:
      // управляется системой разговоров
      break;
    case CitizenState.Idle:
    default: {
      if (tick >= c.nextThink) {
        if (c.actionData.robbedAt) checkRobbed(sim, c);
        if (c.actionData.burgledAt) checkBurgled(sim, c);
        think(sim, c);
        if (c.state === CitizenState.Idle) c.nextThink = tick + 10 + sim.rng.int(0, 20);
      }
    }
  }
}

/** Освещение окон: в здании кто-то есть и не все спят (или это рабочее здание в часы работы) */
function updateBuildingLights(sim: Simulation): void {
  const light = daylight(sim.tick);
  const buildings = sim.world.buildings;
  if (light > 0.6) {
    for (const b of buildings) b.lit = false;
    return;
  }
  const awake = new Int16Array(buildings.length);
  for (const c of sim.citizens) {
    if (!c.alive || c.inside < 0) continue;
    if (c.state !== CitizenState.Sleeping) awake[c.inside]++;
  }
  const hour = hourOf(sim.tick);
  for (const b of buildings) {
    b.lit = awake[b.id] > 0;
    // таверны и пекарни светятся в часы работы
    if (!b.lit && b.workers.length && b.type !== 2) {
      const [a, z] = [6, 22];
      if (hour >= a && hour < z && awake[b.id] > 0) b.lit = true;
    }
  }
}
