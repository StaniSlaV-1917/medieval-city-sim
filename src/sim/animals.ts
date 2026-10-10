// Живность: собаки, кошки, куры, птицы, зимой — волки.
import type { Simulation } from './game';
import { isWalkableAt, idx } from '../world/world';
import { Tile } from '../world/tiles';
import { BuildingType } from '../world/buildings';
import { isNight } from '../core/time';
import { EventKind } from '../events/chronicle';
import { dist2 } from '../core/math';

export const enum AnimalKind {
  Dog = 0,
  Cat = 1,
  Chicken = 2,
  Bird = 3,
  Wolf = 4,
}

export interface Animal {
  kind: AnimalKind;
  x: number;
  y: number;
  px: number;
  py: number;
  tx: number;
  ty: number;
  dir: number;
  wait: number;
  anim: number;
  homeX: number;
  homeY: number;
  alive: boolean;
}

export function createAnimals(sim: Simulation): void {
  const rng = sim.rng.fork('animals');
  const world = sim.world;
  const spots = world.poi.strollSpots;
  const n = Math.round(world.buildings.length / 14);
  for (let k = 0; k < n; k++) {
    const s = rng.pick(spots);
    sim.animals.push(mk(rng.chance(0.55) ? AnimalKind.Dog : AnimalKind.Cat, s.x + rng.int(-4, 4), s.y + rng.int(-4, 4)));
  }
  for (const b of world.buildings) {
    if (b.type === BuildingType.Farm) for (let k = 0; k < rng.int(3, 6); k++) sim.animals.push(mk(AnimalKind.Chicken, b.x + b.w + 1 + rng.int(0, 2), b.y + rng.int(0, b.h)));
    if (b.type === BuildingType.Shack && rng.chance(0.15)) sim.animals.push(mk(AnimalKind.Chicken, b.x - 1, b.y + b.h));
  }
  for (let k = 0; k < 10; k++) sim.animals.push(mk(AnimalKind.Bird, rng.int(0, world.w), rng.int(0, world.h)));
}

function mk(kind: AnimalKind, x: number, y: number): Animal {
  return { kind, x, y, px: x, py: y, tx: x, ty: y, dir: 0, wait: 0, anim: 0, homeX: x, homeY: y, alive: true };
}

export function updateAnimals(sim: Simulation): void {
  const rng = sim.rng;
  const world = sim.world;
  const tick = sim.tick;
  // Волки зимой ночью
  if (tick % 300 === 0 && sim.season === 3 && isNight(tick)) {
    const wolves = sim.animals.filter((a) => a.kind === AnimalKind.Wolf && a.alive).length;
    if (wolves < 4 && rng.chance(0.3)) {
      const edge = rng.int(0, 3);
      const x = edge === 0 ? 2 : edge === 1 ? world.w - 3 : rng.int(2, world.w - 3);
      const y = edge >= 2 ? (edge === 2 ? 2 : world.h - 3) : rng.int(2, world.h - 3);
      const w = mk(AnimalKind.Wolf, x, y);
      sim.animals.push(w);
      if (wolves === 0) sim.chronicle.log(tick, EventKind.Disaster, 'У стен воют волки — зимой они подходят к самому городу.', x, y, [], 0.5);
    }
  }
  for (let i = sim.animals.length - 1; i >= 0; i--) {
    const a = sim.animals[i];
    if (!a.alive) {
      sim.animals.splice(i, 1);
      continue;
    }
    a.px = a.x;
    a.py = a.y;
    if (a.kind === AnimalKind.Bird) {
      a.x += Math.cos(a.dir) * 0.25;
      a.y += Math.sin(a.dir) * 0.25;
      a.anim += 0.5;
      if (rng.chance(0.01)) a.dir += rng.float(-0.6, 0.6);
      if (a.x < -5 || a.y < -5 || a.x > world.w + 5 || a.y > world.h + 5) {
        a.x = rng.int(0, world.w);
        a.y = rng.chance(0.5) ? -4 : world.h + 4;
        a.dir = a.y < 0 ? Math.PI / 2 + rng.float(-0.5, 0.5) : -Math.PI / 2 + rng.float(-0.5, 0.5);
      }
      continue;
    }
    if (a.wait > 0) {
      a.wait--;
      continue;
    }
    const dx = a.tx - a.x;
    const dy = a.ty - a.y;
    const d = Math.hypot(dx, dy);
    const speed = a.kind === AnimalKind.Wolf ? 0.3 : a.kind === AnimalKind.Chicken ? 0.08 : 0.18;
    if (d < speed) {
      a.x = a.tx;
      a.y = a.ty;
      a.wait = rng.int(10, a.kind === AnimalKind.Cat ? 200 : 80);
      // новая цель
      const r = a.kind === AnimalKind.Wolf ? 14 : a.kind === AnimalKind.Chicken ? 2 : 6;
      for (let k = 0; k < 6; k++) {
        const nx = Math.round(a.homeX + rng.float(-r, r));
        const ny = Math.round(a.homeY + rng.float(-r, r));
        if (!isWalkableAt(world, nx, ny)) continue;
        if (a.kind === AnimalKind.Wolf && world.inside[idx(world, nx, ny)]) continue;
        if (a.kind === AnimalKind.Dog && world.tiles[idx(world, nx, ny)] === Tile.Field) continue;
        a.tx = nx;
        a.ty = ny;
        break;
      }
      if (a.kind === AnimalKind.Wolf) {
        a.homeX = a.tx;
        a.homeY = a.ty;
        if (!isNight(tick) || sim.season !== 3) {
          a.alive = false; // уходят с рассветом
          continue;
        }
        // пугают прохожих за стенами
        for (const c of sim.citizens) {
          if (!c.alive || c.inside >= 0 || world.inside[idx(world, Math.round(c.x), Math.round(c.y))]) continue;
          if (dist2(c.x, c.y, a.x, a.y) < 36) {
            c.needs.safety = Math.max(0, c.needs.safety - 15);
            if (rng.chance(0.3)) c.speech = { text: rng.pick(['Волки!', 'Серый! Бежим!', 'Господи, волк!']), until: tick + 40, thought: false };
          }
        }
        // режут кур
        for (const o of sim.animals) {
          if (o.kind === AnimalKind.Chicken && o.alive && dist2(o.x, o.y, a.x, a.y) < 4 && rng.chance(0.5)) {
            o.alive = false;
            if (rng.chance(0.5)) sim.chronicle.log(tick, EventKind.Disaster, 'Ночью волки задрали кур у фермы.', Math.round(o.x), Math.round(o.y), [], 0.4);
          }
        }
      }
      // собаки бегут к людям на площади
      if (a.kind === AnimalKind.Dog && rng.chance(0.3)) {
        const s = rng.pick(world.poi.strollSpots);
        a.homeX = s.x;
        a.homeY = s.y;
      }
    } else {
      a.x += (dx / d) * speed;
      a.y += (dy / d) * speed;
      a.anim += 0.5;
      a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 2 : 1) : dy > 0 ? 0 : 3;
    }
  }
}
