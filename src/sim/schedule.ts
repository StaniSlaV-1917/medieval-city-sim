// Распорядок дня: когда спать, работать, обедать — с учётом профессии и характера.
import { Citizen, Profession, Trait, isChild, isElder, hasTrait } from './citizen';
import { BUILDING_DEFS } from '../world/buildings';
import type { Simulation } from './game';
import { hash2 } from '../core/hash';

export interface DaySchedule {
  wake: number; // час подъёма
  bed: number; // час отбоя (может быть > 24)
  workStart: number;
  workEnd: number;
  lunch: number; // час обеда (0 — нет)
  nightShift: boolean;
}

export function scheduleOf(sim: Simulation, c: Citizen): DaySchedule {
  const j = (k: number) => hash2(c.id, k, sim.world.seed) - 0.5; // -0.5..0.5
  let wake = 6 + j(1) * 1.5;
  let bed = 22 + j(2) * 2;
  let workStart = 0;
  let workEnd = 0;
  let lunch = 12.5 + j(3);
  let nightShift = false;
  if (c.workplace >= 0) {
    const b = sim.world.buildings[c.workplace];
    const def = BUILDING_DEFS[b.type];
    workStart = def.hours[0] + j(4) * 0.8;
    workEnd = def.hours[1] + j(5) * 0.8;
    if (c.profession === Profession.Guard) {
      // смены: половина стражи ночью
      nightShift = c.id % 2 === 1;
      if (nightShift) {
        workStart = 20 + j(4);
        workEnd = 30 + j(5); // до 6 утра
        wake = 18 + j(1);
        bed = 7 + j(2);
      } else {
        workStart = 6 + j(4);
        workEnd = 20 + j(5);
        wake = 5.5 + j(1);
        bed = 22 + j(2);
      }
    } else if (c.profession === Profession.Innkeeper || c.profession === Profession.Bard) {
      workStart = 11 + j(4);
      workEnd = 26 + j(5);
      wake = 9 + j(1);
      bed = 27 + j(2);
    } else if (c.profession === Profession.Baker) {
      wake = 3.5 + j(1);
      bed = 20.5 + j(2);
      workStart = 4 + j(4) * 0.5;
      workEnd = 14 + j(5);
    } else if (c.profession === Profession.Priest) {
      wake = 5 + j(1);
      workStart = 6;
      workEnd = 21;
    } else if (c.profession === Profession.Monk) {
      wake = 5 + j(1);
      bed = 21.5 + j(2);
      workStart = 6;
      workEnd = 21;
    }
    if (hasTrait(c, Trait.Lazy)) {
      workStart += 1;
      workEnd -= 1;
      wake += 1;
    }
    if (hasTrait(c, Trait.Hardworking) || hasTrait(c, Trait.Ambitious)) {
      workStart -= 0.5;
      workEnd += 0.7;
    }
    if (hasTrait(c, Trait.Drunkard)) {
      wake += 1;
      bed += 1.5;
    }
    if (workEnd - workStart > 13 && c.profession !== Profession.Guard) workEnd = workStart + 13;
  } else {
    if (hasTrait(c, Trait.Lazy)) wake += 1.5;
  }
  if (isChild(c)) {
    wake = 7 + j(1);
    bed = 20.5 + j(2);
    workStart = 0;
    workEnd = 0;
    lunch = 12.5 + j(3);
  } else if (isElder(c) && c.workplace < 0) {
    wake = 5.5 + j(1);
    bed = 21 + j(2);
  }
  if (c.profession === Profession.Thief) {
    wake = 10 + j(1);
    bed = 28 + j(2);
  }
  if (c.profession === Profession.Beggar) {
    wake = 7 + j(1);
    bed = 22 + j(2);
  }
  if (c.profession === Profession.Housewife) {
    workStart = 0;
    workEnd = 0;
  }
  return { wake, bed, workStart, workEnd, lunch, nightShift };
}

/** Час в «расширенном» виде относительно расписания (для ночных смен) */
export function isWorkHour(s: DaySchedule, hour: number): boolean {
  if (s.workEnd <= s.workStart) return false;
  if (hour >= s.workStart && hour < s.workEnd) return true;
  if (s.workEnd > 24 && hour + 24 >= s.workStart && hour + 24 < s.workEnd) return true;
  return false;
}

export function isSleepHour(s: DaySchedule, hour: number): boolean {
  // ночь: от bed до wake (с переходом через полночь)
  const bed = s.bed % 24;
  const wake = s.wake % 24;
  if (bed > wake) return hour >= bed || hour < wake;
  return hour >= bed && hour < wake;
}
