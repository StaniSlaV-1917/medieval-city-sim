// Игровое время. Симуляция идёт фиксированными тиками.
export const TICKS_PER_SECOND = 10; // тиков симуляции в реальную секунду при скорости 1×
export const TICKS_PER_HOUR = 300; // 1 игровой час = 30 реальных секунд при 1×
export const HOURS_PER_DAY = 24;
export const TICKS_PER_DAY = TICKS_PER_HOUR * HOURS_PER_DAY; // 7200
export const DAYS_PER_SEASON = 8;
export const SEASONS_PER_YEAR = 4;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS_PER_YEAR;
export const TICKS_PER_YEAR = TICKS_PER_DAY * DAYS_PER_YEAR;
/** Год основания города (летоисчисление в интерфейсе и биографиях) */
export const CITY_FOUNDED_YEAR = 1247;

export const enum Season {
  Spring = 0,
  Summer = 1,
  Autumn = 2,
  Winter = 3,
}

export const SEASON_NAMES = ['Весна', 'Лето', 'Осень', 'Зима'] as const;
export const SEASON_NAMES_GEN = ['весны', 'лета', 'осени', 'зимы'] as const;

export interface GameTime {
  tick: number;
  /** Часы с дробной частью, 0..24 */
  hour: number;
  hourInt: number;
  minute: number;
  /** День в сезоне, 1..DAYS_PER_SEASON */
  dayOfSeason: number;
  /** День от начала игры (0-based) */
  day: number;
  season: Season;
  year: number;
  /** Доля суток 0..1 */
  dayFraction: number;
}

export function getTime(tick: number): GameTime {
  const day = Math.floor(tick / TICKS_PER_DAY);
  const tickOfDay = tick - day * TICKS_PER_DAY;
  const hour = tickOfDay / TICKS_PER_HOUR;
  const hourInt = Math.floor(hour);
  const minute = Math.floor((hour - hourInt) * 60);
  const year = Math.floor(day / DAYS_PER_YEAR);
  const dayOfYear = day - year * DAYS_PER_YEAR;
  const season = Math.floor(dayOfYear / DAYS_PER_SEASON) as Season;
  const dayOfSeason = dayOfYear - season * DAYS_PER_SEASON + 1;
  return {
    tick,
    hour,
    hourInt,
    minute,
    dayOfSeason,
    day,
    season,
    year: year + 1,
    dayFraction: tickOfDay / TICKS_PER_DAY,
  };
}

export function hourOf(tick: number): number {
  return (tick % TICKS_PER_DAY) / TICKS_PER_HOUR;
}

export function seasonOf(tick: number): Season {
  const day = Math.floor(tick / TICKS_PER_DAY);
  return (Math.floor((day % DAYS_PER_YEAR) / DAYS_PER_SEASON)) as Season;
}

export function dayOf(tick: number): number {
  return Math.floor(tick / TICKS_PER_DAY);
}

export function formatClock(tick: number): string {
  const t = getTime(tick);
  return `${String(t.hourInt).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
}

export function formatDate(tick: number): string {
  const t = getTime(tick);
  return `${t.dayOfSeason}-й день ${SEASON_NAMES_GEN[t.season]}, ${t.year}-й год`;
}

/** Освещённость 0 (ночь) .. 1 (день) с учётом сезона */
export function daylight(tick: number): number {
  const h = hourOf(tick);
  const season = seasonOf(tick);
  // Восход/закат по сезонам
  const sunrise = [6, 5, 6.5, 7.5][season];
  const sunset = [19.5, 21, 18.5, 17][season];
  const dawnLen = 1.5;
  if (h < sunrise - dawnLen || h > sunset + dawnLen) return 0;
  if (h < sunrise) return smooth((h - (sunrise - dawnLen)) / dawnLen);
  if (h > sunset) return 1 - smooth((h - sunset) / dawnLen);
  return 1;
}

function smooth(t: number): number {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

/** Есть ли сейчас ночь (для поведения) */
export function isNight(tick: number): boolean {
  return daylight(tick) < 0.35;
}
