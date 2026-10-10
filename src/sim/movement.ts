// Передвижение жителей по путям.
import type { Simulation } from './game';
import { Citizen, CitizenState, isChild, isElder } from './citizen';
import { nearestWalkable, isWalkableAt } from '../world/world';
import { TILE_INFO } from '../world/tiles';

export const BASE_SPEED = 0.32; // тайлов за тик (≈3.2 тайла/с при 1×)

/** Запросить путь к тайлу. Возвращает false, если пути нет. */
export function setDestination(sim: Simulation, c: Citizen, tx: number, ty: number): boolean {
  const world = sim.world;
  tx = Math.round(tx);
  ty = Math.round(ty);
  if (!isWalkableAt(world, tx, ty)) {
    const nw = nearestWalkable(world, tx, ty, 4);
    if (!nw) return false;
    tx = nw.x;
    ty = nw.y;
  }
  const sx = Math.round(c.x);
  const sy = Math.round(c.y);
  if (!isWalkableAt(world, sx, sy)) {
    // выбрались на непроходимое — подвинуть
    const nw = nearestWalkable(world, sx, sy, 4);
    if (nw) {
      c.x = nw.x;
      c.y = nw.y;
      c.px = c.x;
      c.py = c.y;
    }
  }
  if (sx === tx && sy === ty) {
    c.path = null;
    c.targetX = tx;
    c.targetY = ty;
    c.state = CitizenState.Idle;
    return true;
  }
  const path = sim.pathfinder.find(Math.round(c.x), Math.round(c.y), tx, ty);
  if (!path) {
    c.pathFails++;
    return false;
  }
  c.path = path;
  c.pathIdx = 0;
  c.targetX = tx;
  c.targetY = ty;
  c.state = CitizenState.Moving;
  c.stuckTicks = 0;
  if (c.inside >= 0) c.inside = -1;
  return true;
}

export function citizenSpeed(sim: Simulation, c: Citizen): number {
  let s = BASE_SPEED;
  if (isChild(c)) s *= 1.05;
  else if (isElder(c)) s *= 0.65;
  if (c.drunk > 30) s *= 0.75;
  if (c.needs.health < 40) s *= 0.7;
  if (c.needs.energy < 15) s *= 0.8;
  const t = sim.world.tiles[Math.round(c.y) * sim.world.w + Math.round(c.x)];
  const cost = TILE_INFO[t]?.cost ?? 1.5;
  s /= Math.min(2, Math.max(1, cost * 0.75 + 0.25));
  return s;
}

/** Шаг движения. Возвращает true, когда цель достигнута. */
export function stepMovement(sim: Simulation, c: Citizen, speedMul = 1): boolean {
  if (c.state !== CitizenState.Moving) return false;
  const path = c.path;
  if (!path) {
    c.state = CitizenState.Idle;
    return true;
  }
  const W = sim.world.w;
  let budget = citizenSpeed(sim, c) * speedMul;
  let moved = false;
  while (budget > 0 && c.pathIdx < path.length) {
    const ti = path[c.pathIdx];
    const tx = ti % W;
    const ty = (ti / W) | 0;
    const dx = tx - c.x;
    const dy = ty - c.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= budget) {
      c.x = tx;
      c.y = ty;
      budget -= d;
      c.pathIdx++;
      moved = true;
    } else {
      c.x += (dx / d) * budget;
      c.y += (dy / d) * budget;
      budget = 0;
      moved = true;
    }
    if (Math.abs(dx) > Math.abs(dy)) c.dir = dx > 0 ? 2 : 1;
    else if (dy !== 0) c.dir = dy > 0 ? 0 : 3;
  }
  if (moved) c.animPhase += 0.6 * speedMul;
  if (c.pathIdx >= path.length) {
    c.path = null;
    c.x = c.targetX;
    c.y = c.targetY;
    c.state = CitizenState.Idle;
    return true;
  }
  return false;
}

/** Телепорт (аварийный): на дверь дома или площадь */
export function rescue(sim: Simulation, c: Citizen): void {
  const world = sim.world;
  const home = c.home >= 0 ? world.buildings[c.home] : null;
  const tx = home ? home.doorX : world.poi.wellX;
  const ty = home ? home.doorY : world.poi.wellY + 1;
  const nw = nearestWalkable(world, tx, ty, 6);
  c.x = nw ? nw.x : tx;
  c.y = nw ? nw.y : ty;
  c.px = c.x;
  c.py = c.y;
  c.path = null;
  c.state = CitizenState.Idle;
  c.inside = -1;
  c.pathFails = 0;
}
