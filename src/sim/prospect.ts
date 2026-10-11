// Рудознатец (фаза 13): нанятый житель два дня ищет скрытые месторождения и разведывает туман.
import type { Simulation } from './game';
import { World, RESOURCE_NAMES, HIDDEN_RESOURCES, idx, inBounds, parcelAt } from '../world/world';
import { Tile } from '../world/tiles';
import { reveal } from '../world/landscape';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../core/time';
import { EventKind } from '../events/chronicle';
import { ACTIONS, ActionDef, actFor, goTo, say, think } from '../ai/actions';
import { CitizenState, fullName, Profession, isChild } from './citizen';
import { discoverNear } from './nature';

/** Нанять рудознатца: свободный взрослый житель на два дня уходит искать руду и разведывать карту */
export function hireProspector(sim: Simulation): string {
  const cost = 40;
  if (sim.region.prospector >= 0 && sim.citizens[sim.region.prospector]?.alive) return 'Рудознатец уже в пути.';
  if (sim.treasury < cost) return `В казне нет ${cost} монет на рудознатца.`;
  const banned = new Set<Profession>([Profession.Guard, Profession.Lord, Profession.Burgomaster, Profession.Priest, Profession.Monk, Profession.Noble, Profession.Child, Profession.Elder]);
  const all = sim.citizens.filter((c) => c.alive && !isChild(c) && c.jailedUntil <= sim.tick && !c.order && !banned.has(c.profession) && !c.actionData.visitor);
  const preferred = all.filter((c) => c.profession === Profession.Laborer || c.profession === Profession.None || c.profession === Profession.Quarryman || c.profession === Profession.Woodcutter);
  const cands = preferred.length ? preferred : all;
  if (!cands.length) return 'Нет свободных людей для разведки.';
  const c = sim.rng.pick(cands);
  if (c.inside >= 0) c.inside = -1;
  sim.treasury -= cost;
  c.money += cost;
  sim.region.prospector = c.id;
  sim.region.prospectUntil = sim.tick + TICKS_PER_DAY * 2;
  c.actionData.prospectNext = 0;
  c.nextThink = sim.tick;
  c.state = CitizenState.Idle;
  sim.chronicle.log(sim.tick, EventKind.Info, `${fullName(c)} нанят${c.sex === 'f' ? 'а' : ''} рудознатцем и ушёл${c.sex === 'f' ? 'ла' : ''} искать руду.`, Math.round(c.x), Math.round(c.y), [c.id], 0.5);
  return `${fullName(c)} отправляется на разведку (2 дня, ${cost} монет).`;
}

const prospect: ActionDef = {
  id: 'prospect',
  interruptible: false,
  score(ctx) {
    const { c, sim } = ctx;
    if (sim.region.prospector !== c.id) return 0;
    if (sim.tick > sim.region.prospectUntil) {
      sim.region.prospector = -1;
      return 0;
    }
    if (c.needs.hunger < 15 || c.needs.energy < 10) return 0;
    return 95;
  },
  start(ctx) {
    const { c, sim, rng } = ctx;
    const world = sim.world;
    // цель: тайл рядом со скрытым ресурсом (рудознатец «чует» руду) или неразведанный участок
    let target: { x: number; y: number } | null = null;
    const hidden: number[] = [];
    for (let i = 0; i < world.w * world.h; i += 3) if (HIDDEN_RESOURCES.has(world.resource[i]) && !world.discovered[i]) hidden.push(i);
    if (hidden.length && rng.chance(0.6)) {
      const i = rng.pick(hidden);
      const nx = i % world.w + rng.int(-4, 4);
      const ny = ((i / world.w) | 0) + rng.int(-4, 4);
      target = nearestWalk(world, nx, ny, 6);
    }
    if (!target) {
      for (let t = 0; t < 40 && !target; t++) {
        const x = rng.int(3, world.w - 4);
        const y = rng.int(3, world.h - 4);
        if (world.fog && world.explored[idx(world, x, y)]) continue;
        target = nearestWalk(world, x, y, 5);
      }
    }
    if (!target) return false;
    think(c, rng.pick(['Говорят, в тех холмах руда.', 'Поищу, где земля ржавая.', 'Разведаю дальние угодья.']));
    return goTo(ctx, target.x, target.y);
  },
  arrive(ctx) {
    const { c, sim, rng } = ctx;
    const world = sim.world;
    const x = Math.round(c.x);
    const y = Math.round(c.y);
    if (reveal(world, x, y, 12)) sim.region.exploredVersion++;
    const found = discoverNear(sim, x, y, 6);
    if (found) {
      const p = parcelAt(world, x, y);
      const name = RESOURCE_NAMES[found];
      say(c, rng.pick([`Нашёл! Тут ${name}!`, `Вот она, ${name}!`, 'Есть! Копать здесь!']), 50, false, sim.tick, 'happy');
      sim.chronicle.log(sim.tick, EventKind.Economy, `Рудознатец ${fullName(c)} нашёл ${name === 'железная руда' ? 'железную руду' : name}${p ? ` в угодье «${p.name}»` : ''}.`, x, y, [c.id], 0.9);
      sim.events.emit('resource:found', { kind: found, x, y });
    } else if (rng.chance(0.3)) say(c, rng.pick(['Пусто. Идём дальше.', 'Камень, а руды нет.', 'Здесь ничего.']), 40, false, sim.tick);
    actFor(ctx, TICKS_PER_HOUR);
  },
};
ACTIONS[prospect.id] = prospect;

function nearestWalk(world: World, x: number, y: number, r: number): { x: number; y: number } | null {
  for (let d = 0; d <= r; d++)
    for (let dy = -d; dy <= d; dy++)
      for (let dx = -d; dx <= d; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
        const xx = x + dx;
        const yy = y + dy;
        if (!inBounds(world, xx, yy)) continue;
        const i = idx(world, xx, yy);
        if (world.buildingAt[i] >= 0 || world.solidProp[i] >= 0) continue;
        const t = world.tiles[i] as Tile;
        if (t === Tile.Water || t === Tile.Lake || t === Tile.Shallow || t === Tile.Forest || t === Tile.Rock || t === Tile.IronOre || t === Tile.Wall || t === Tile.Tower || t === Tile.Floor) continue;
        return { x: xx, y: yy };
      }
  return null;
}


export const PROSPECT_LABELS: Record<string, string> = { prospect: 'ищет руду' };
