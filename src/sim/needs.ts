// Потребности: спад/восстановление, настроение.
import { Citizen, CitizenState, Trait, hasTrait, isChild, isElder, Profession } from './citizen';
import { TICKS_PER_HOUR } from '../core/time';

const H = TICKS_PER_HOUR;

/** Обновление потребностей за `ticks` тиков */
export function decayNeeds(c: Citizen, ticks: number): void {
  const n = c.needs;
  const k = ticks;
  // Голод: от 100 до 0 примерно за 20 часов
  let hungerRate = 100 / (30 * H);
  if (isChild(c)) hungerRate *= 1.1;
  if (hasTrait(c, Trait.Hardworking)) hungerRate *= 1.1;
  n.hunger -= hungerRate * k;
  // Бодрость: 100→0 за ~18 часов бодрствования
  if (c.state !== CitizenState.Sleeping) {
    let er = 100 / (18 * H);
    if (isElder(c)) er *= 1.3;
    if (c.state === CitizenState.Moving) er *= 1.15;
    n.energy -= er * k;
  }
  // Общение
  let sr = 100 / (36 * H);
  if (hasTrait(c, Trait.Talkative)) sr *= 1.6;
  if (hasTrait(c, Trait.Gloomy)) sr *= 0.6;
  if (c.state === CitizenState.Talking) sr = 0;
  n.social -= sr * k;
  // Развлечение
  let fr = 100 / (40 * H);
  if (hasTrait(c, Trait.Cheerful)) fr *= 1.2;
  if (hasTrait(c, Trait.Drunkard)) fr *= 1.3;
  if (c.state === CitizenState.Sleeping) fr *= 0.3;
  n.fun -= fr * k;
  // Вера
  let frr = 100 / (120 * H);
  if (hasTrait(c, Trait.Pious)) frr *= 2.5;
  if (c.profession === Profession.Priest || c.profession === Profession.Monk) frr = 0;
  n.faith -= frr * k;
  // Безопасность медленно восстанавливается
  n.safety += (100 / (48 * H)) * k;
  // Здоровье
  if (n.hunger <= 0) n.health -= (100 / (72 * H)) * k;
  else if (n.hunger > 30 && n.health < 100) n.health += (100 / (240 * H)) * k;
  if (n.energy <= 0) n.health -= (100 / (200 * H)) * k;
  // Опьянение проходит
  if (c.drunk > 0) c.drunk = Math.max(0, c.drunk - (100 / (6 * H)) * k);
  // Границы
  n.hunger = clamp01(n.hunger);
  n.energy = clamp01(n.energy);
  n.social = clamp01(n.social);
  n.fun = clamp01(n.fun);
  n.faith = clamp01(n.faith);
  n.safety = clamp01(n.safety);
  n.health = clamp01(n.health);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

/** Настроение -100..100 */
export function computeMood(c: Citizen): number {
  const n = c.needs;
  let m = (n.hunger - 50) * 0.5 + (n.energy - 50) * 0.3 + (n.social - 50) * 0.3 + (n.fun - 50) * 0.35 + (n.safety - 50) * 0.3 + (n.health - 50) * 0.4;
  if (hasTrait(c, Trait.Pious)) m += (n.faith - 50) * 0.4;
  else m += (n.faith - 50) * 0.1;
  if (hasTrait(c, Trait.Cheerful)) m += 12;
  if (hasTrait(c, Trait.Gloomy)) m -= 12;
  if (hasTrait(c, Trait.Greedy)) m += Math.min(10, c.money / 20) - 8;
  if (c.home < 0) m -= 15;
  if (c.drunk > 30) m += 5;
  return Math.max(-100, Math.min(100, m));
}

export function moodWord(m: number): string {
  if (m > 50) return 'счастлив';
  if (m > 20) return 'доволен';
  if (m > -20) return 'спокоен';
  if (m > -50) return 'недоволен';
  return 'в отчаянии';
}
