import type { Simulation } from './game';
import { isChild, isElder } from './citizen';

export interface Stats {
  tick: number;
  population: number;
  children: number;
  elders: number;
  treasury: number;
  avgMoney: number;
  avgMood: number;
  avgHealth: number;
  avgHunger: number;
  homeless: number;
  unemployed: number;
}

export function collectStats(sim: Simulation): Stats {
  let pop = 0;
  let children = 0;
  let elders = 0;
  let money = 0;
  let mood = 0;
  let health = 0;
  let hunger = 0;
  let homeless = 0;
  let unemployed = 0;
  for (const c of sim.citizens) {
    if (!c.alive) continue;
    pop++;
    if (isChild(c)) children++;
    else if (isElder(c)) elders++;
    else if (c.workplace < 0) unemployed++;
    money += c.money;
    mood += c.mood;
    health += c.needs.health;
    hunger += c.needs.hunger;
    if (c.home < 0) homeless++;
  }
  const n = Math.max(1, pop);
  return {
    tick: sim.tick,
    population: pop,
    children,
    elders,
    treasury: sim.treasury,
    avgMoney: money / n,
    avgMood: mood / n,
    avgHealth: health / n,
    avgHunger: hunger / n,
    homeless,
    unemployed,
  };
}
