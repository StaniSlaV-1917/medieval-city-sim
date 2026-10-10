// Погода: дождь, туман, снег, гроза, ветер, температура. Меняется по часам с учётом сезона.
import type { Simulation } from './game';
import { Season, TICKS_PER_HOUR } from '../core/time';
import { EventKind } from '../events/chronicle';

export interface Weather {
  rain: number; // 0..1
  fog: number;
  snow: number; // идёт ли снег 0..1
  storm: number; // гроза 0..1
  wind: number; // сила 0..1
  windDir: number; // радианы
  temp: number; // °C
  /** Цели, к которым плавно стремимся */
  targetRain: number;
  targetFog: number;
  targetWind: number;
  nextChange: number;
  lastLightning: number;
}

export function createWeather(): Weather {
  return { rain: 0, fog: 0, snow: 0, storm: 0, wind: 0.3, windDir: Math.PI / 4, temp: 12, targetRain: 0, targetFog: 0, targetWind: 0.3, nextChange: 0, lastLightning: 0 };
}

export function updateWeather(sim: Simulation): void {
  const w = sim.weather;
  const tick = sim.tick;
  const rng = sim.rng;
  const season = sim.season;
  if (tick >= w.nextChange) {
    w.nextChange = tick + TICKS_PER_HOUR * rng.int(2, 7);
    const rainP = [0.3, 0.2, 0.4, 0.35][season];
    const r = rng.next();
    if (r < rainP) w.targetRain = rng.float(0.3, 1);
    else if (r < rainP + 0.15) w.targetRain = Math.max(0, w.targetRain - 0.5);
    else w.targetRain = 0;
    w.targetFog = rng.chance(season === Season.Autumn ? 0.25 : 0.1) ? rng.float(0.3, 0.9) : 0;
    w.targetWind = rng.float(0.05, season === Season.Autumn ? 0.9 : 0.6);
    w.windDir += rng.float(-0.8, 0.8);
    // гроза летом/осенью при сильном дожде
    w.storm = w.targetRain > 0.6 && rng.chance(season === Season.Summer ? 0.5 : 0.25) ? 1 : 0;
    if (w.storm) sim.chronicle.log(tick, EventKind.Info, 'Над городом собирается гроза.', sim.world.poi.cx, sim.world.poi.cy, [], 0.4);
    const baseTemp = [10, 22, 9, -6][season];
    w.temp = baseTemp + rng.float(-5, 5) - w.targetRain * 3;
  }
  // плавные переходы
  const k = 0.002;
  w.rain += (w.targetRain - w.rain) * k * 10;
  w.fog += (w.targetFog - w.fog) * k * 10;
  w.wind += (w.targetWind - w.wind) * k * 10;
  w.snow = w.temp < 1 ? w.rain : 0;
  if (w.snow > 0) w.rain = w.rain; // снег вместо дождя визуально
  sim.world.wind.dir = w.windDir;
  sim.world.wind.strength = w.wind;
  // молнии
  if (w.storm && w.rain > 0.5 && tick - w.lastLightning > 120 && rng.chance(0.01)) {
    w.lastLightning = tick;
    sim.lightningFlash = 1;
    if (rng.chance(0.18)) {
      // удар в здание
      const b = rng.pick(sim.world.buildings);
      if (b && b.w > 0 && b.condition > 0) {
        sim.chronicle.log(tick, EventKind.Disaster, `Молния ударила в здание (${describeBuilding(sim, b.id)})!`, b.doorX, b.doorY, [], 0.8);
        sim.igniteBuilding?.(b.id, 'молния', 0.6);
      }
    }
  }
  if (w.storm && w.rain < 0.3) w.storm = 0;
}

export function describeBuilding(sim: Simulation, id: number): string {
  const b = sim.world.buildings[id];
  if (!b) return '';
  const def = sim.buildingDefName(b);
  return b.name ? `«${b.name}»` : def;
}

export function weatherText(w: Weather, season: Season): string {
  if (w.storm && w.rain > 0.4) return 'гроза';
  if (w.snow > 0.5) return 'снегопад';
  if (w.snow > 0.1) return 'лёгкий снег';
  if (w.rain > 0.6) return 'ливень';
  if (w.rain > 0.2) return 'дождь';
  if (w.fog > 0.4) return 'туман';
  if (w.wind > 0.7) return 'ветрено';
  if (season === Season.Winter) return 'мороз';
  if (season === Season.Summer && w.temp > 25) return 'жара';
  return 'ясно';
}
