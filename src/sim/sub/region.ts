// Регион и окрестности: погода, живность, разбойники, наводнение, дракон, множители бедствий.
import type { Simulation } from '../game';
import { Weather, createWeather, updateWeather } from '../weather';
import { Animal, updateAnimals } from '../animals';
import { updateNature } from '../nature';
import '../prospect';

export interface Raid {
  members: number[];
  phase: number;
  gate: { x: number; y: number };
  until: number;
  loot: number;
}

export class Region {
  weather: Weather = createWeather();
  animals: Animal[] = [];
  raid: Raid | null = null;
  nextRaidDay = 6;
  flood: { tiles: number[]; until: number } | null = null;
  dragon: { x: number; y: number; dir: number; until: number; nextFire: number } | null = null;
  /** Множители бедствий (божественные силы) */
  fireRiskMul = 1;
  epidemicMul = 1;
  lightningFlash = 0;
  shake = 0;
  /** Нанятый рудознатец (id жителя) и срок его работы */
  prospector = -1;
  prospectUntil = 0;
  /** Версия разведанной области (для перерисовки тумана) */
  exploredVersion = 0;

  updateWeather(sim: Simulation): void {
    updateWeather(sim);
  }

  updateAnimals(sim: Simulation): void {
    updateAnimals(sim);
    updateNature(sim);
  }
}
