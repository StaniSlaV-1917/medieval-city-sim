// Божественные силы игрока.
import type { Simulation } from './game';
import { Profession, isChild, fullName, FLAG_SICK, FLAG_INJURED } from './citizen';
import { igniteBuilding, damageBuilding } from './fire';
import { fallSick, die } from './health';
import { spawnRaid, startFestival } from './cityEvents';
import { assignJob } from './population';
import { interrupt } from '../ai/brain';
import { say, remember } from '../ai/actions';
import { BuildingType, BUILDING_DEFS } from '../world/buildings';
import { EventKind } from '../events/chronicle';
import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../core/time';
import { idx, inBounds, PropType } from '../world/world';
import { Tile } from '../world/tiles';
import { dist2 } from '../core/math';

export interface PowerDef {
  id: string;
  label: string;
  kind: 'bad' | 'good';
  needsTarget: boolean;
  hint: string;
}

export const POWERS: PowerDef[] = [
  { id: 'flood', label: 'Наводнение', kind: 'bad', needsTarget: false, hint: 'Река выходит из берегов и затапливает низины' },
  { id: 'quake', label: 'Землетрясение', kind: 'bad', needsTarget: true, hint: 'Рушит дома вокруг точки удара' },
  { id: 'lightning', label: 'Удар молнии', kind: 'bad', needsTarget: true, hint: 'Молния бьёт в ближайшее здание' },
  { id: 'fire', label: 'Пожар', kind: 'bad', needsTarget: true, hint: 'Поджигает ближайшее здание' },
  { id: 'meteor', label: 'Метеорит', kind: 'bad', needsTarget: true, hint: 'Небесный камень разрушает всё в точке падения' },
  { id: 'plague', label: 'Эпидемия', kind: 'bad', needsTarget: true, hint: 'Болезнь охватывает квартал' },
  { id: 'drought', label: 'Засуха и неурожай', kind: 'bad', needsTarget: false, hint: 'Поля сохнут, цены растут' },
  { id: 'raid', label: 'Налёт разбойников', kind: 'bad', needsTarget: false, hint: 'Шайка идёт к воротам' },
  { id: 'rats', label: 'Нашествие крыс', kind: 'bad', needsTarget: true, hint: 'Крысы пожирают припасы и разносят болезни' },
  { id: 'dragon', label: 'Драконий налёт', kind: 'bad', needsTarget: false, hint: 'Дракон кружит над городом и поджигает крыши' },
  { id: 'gold', label: 'Золотой дождь', kind: 'good', needsTarget: true, hint: 'Монеты сыплются с неба на горожан' },
  { id: 'harvest', label: 'Богатый урожай', kind: 'good', needsTarget: false, hint: 'Амбары полны, год будет сытым' },
  { id: 'heal', label: 'Исцеление', kind: 'good', needsTarget: true, hint: 'Больные и раненые в округе выздоравливают' },
  { id: 'fair', label: 'Ярмарка', kind: 'good', needsTarget: false, hint: 'Объявить ярмарочный день с турниром' },
  { id: 'holiday', label: 'Праздник', kind: 'good', needsTarget: false, hint: 'Праздник с бесплатным элем за счёт казны' },
];

export function applyPower(sim: Simulation, id: string, tx: number, ty: number): string {
  sim.events.emit('god:power', { id, x: tx, y: ty });
  const rng = sim.rng;
  const world = sim.world;
  const nearestB = () => {
    let best = null as null | (typeof world.buildings)[number];
    let bd = Infinity;
    for (const b of world.buildings) {
      if (b.w === 0 || b.condition <= 0) continue;
      const d = dist2(b.x + b.w / 2, b.y + b.h / 2, tx, ty);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  };
  switch (id) {
    case 'flood': {
      const tiles: number[] = [];
      for (let y = 0; y < world.h; y++) {
        const rc = world.poi.riverCenterX[y];
        for (let x = Math.max(0, Math.round(rc - 16)); x < Math.min(world.w, Math.round(rc + 16)); x++) {
          const i = idx(world, x, y);
          const t = world.tiles[i];
          if (t === Tile.Water || t === Tile.Wall || t === Tile.Tower) continue;
          const d = Math.abs(x - rc);
          if (d < 9 + rng.float(0, 6) && world.height[i] < 0.2) tiles.push(i);
        }
      }
      sim.flood = { tiles, until: sim.tick + TICKS_PER_HOUR * 3 };
      const flooded = new Set(tiles);
      let hit = 0;
      for (const b of world.buildings) {
        if (b.w === 0 || b.condition <= 0) continue;
        let inWater = false;
        for (let yy = b.y; yy < b.y + b.h && !inWater; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) if (flooded.has(idx(world, xx, yy))) inWater = true;
        if (!inWater) continue;
        hit++;
        damageBuilding(sim, b, b.material === 'stone' ? rng.float(0.15, 0.4) : rng.float(0.4, 0.9), 'наводнение');
        b.storage = {};
        for (const c of sim.citizens) {
          if (!c.alive || c.inside !== b.id) continue;
          c.inside = -1;
          c.x = b.doorX;
          c.y = b.doorY;
          interrupt(sim, c);
          c.needs.safety = Math.max(0, c.needs.safety - 50);
          say(c, rng.pick(['Вода! Спасайтесь!', 'Река поднимается!', 'Господи, потоп!']), 50, false, sim.tick);
          if (rng.chance(0.1)) c.hp = Math.max(5, c.hp - 40);
        }
      }
      for (const c of sim.citizens) {
        if (!c.alive || c.inside >= 0) continue;
        if (flooded.has(idx(world, Math.round(c.x), Math.round(c.y)))) {
          c.needs.safety = Math.max(0, c.needs.safety - 40);
          c.needs.health = Math.max(0, c.needs.health - 10);
          if (rng.chance(0.03) && !isChild(c) === false) die(sim, c, 'утонув в наводнении');
          else if (rng.chance(0.02)) die(sim, c, 'утонув в наводнении');
        }
      }
      sim.chronicle.log(sim.tick, EventKind.Disaster, `Река вышла из берегов! Затоплены низины, пострадало ${hit} построек.`, world.poi.bridge.x, world.poi.bridge.y, [], 1);
      sim.unrest = Math.min(100, sim.unrest + 10);
      return 'Река поднимается.';
    }
    case 'quake': {
      sim.shake = 2.5;
      let ruined = 0;
      let dmg = 0;
      for (const b of world.buildings) {
        if (b.w === 0 || b.condition <= 0) continue;
        const d = Math.sqrt(dist2(b.x + b.w / 2, b.y + b.h / 2, tx, ty));
        if (d > 30) continue;
        const k = (1 - d / 30) * (b.material === 'stone' || b.material === 'brick' ? 1.1 : 0.7);
        const amount = rng.float(0.1, 0.9) * k;
        if (amount < 0.05) continue;
        dmg++;
        for (const c of sim.citizens) {
          if (!c.alive || c.inside !== b.id) continue;
          if (amount > 0.5 && rng.chance(0.3)) {
            c.hp = Math.max(0, c.hp - 50);
            c.flags |= FLAG_INJURED;
            if (c.hp <= 0) {
              die(sim, c, 'под обломками во время землетрясения');
              continue;
            }
          }
          c.inside = -1;
          c.x = b.doorX;
          c.y = b.doorY;
          interrupt(sim, c);
          say(c, rng.pick(['Земля трясётся!', 'Стены рушатся!', 'На улицу, скорее!']), 50, false, sim.tick);
        }
        damageBuilding(sim, b, amount, 'землетрясение');
        if (b.condition <= 0) ruined++;
      }
      for (const c of sim.citizens) if (c.alive && dist2(c.x, c.y, tx, ty) < 2500) c.needs.safety = Math.max(0, c.needs.safety - 35);
      sim.chronicle.log(sim.tick, EventKind.Disaster, `Землетрясение! Повреждено ${dmg} зданий, ${ruined} обрушились.`, tx, ty, [], 1);
      sim.unrest = Math.min(100, sim.unrest + 10);
      sim.pathfinder.invalidate();
      return 'Земля дрожит.';
    }
    case 'lightning': {
      const b = nearestB();
      sim.lightningFlash = 1;
      if (b) {
        sim.chronicle.log(sim.tick, EventKind.Disaster, `С ясного неба ударила молния: ${BUILDING_DEFS[b.type].name.toLowerCase()}.`, b.doorX, b.doorY, [], 0.8);
        igniteBuilding(sim, b.id, 'молния', 0.6);
      }
      return 'Молния!';
    }
    case 'fire': {
      const b = nearestB();
      if (b) igniteBuilding(sim, b.id, 'неведомая искра', 0.4);
      return b ? 'Огонь занялся.' : 'Нечего поджигать.';
    }
    case 'meteor': {
      sim.shake = 1.5;
      sim.lightningFlash = 0.8;
      let killed = 0;
      for (const b of world.buildings) {
        if (b.w === 0 || b.condition <= 0) continue;
        const d = Math.sqrt(dist2(b.x + b.w / 2, b.y + b.h / 2, tx, ty));
        if (d < 4) {
          for (const c of sim.citizens) {
            if (c.alive && c.inside === b.id) {
              die(sim, c, 'под небесным камнем');
              killed++;
            }
          }
          damageBuilding(sim, b, 1, 'метеорит');
        } else if (d < 9) {
          damageBuilding(sim, b, rng.float(0.2, 0.6), 'метеорит');
          if (rng.chance(0.5)) igniteBuilding(sim, b.id, 'небесный камень', 0.4);
        }
      }
      for (const c of sim.citizens) {
        if (!c.alive || c.inside >= 0) continue;
        const d = dist2(c.x, c.y, tx, ty);
        if (d < 6) {
          die(sim, c, 'под небесным камнем');
          killed++;
        } else if (d < 300) {
          c.needs.safety = Math.max(0, c.needs.safety - 50);
          say(c, rng.pick(['Небо падает!', 'Что это было?!', 'Конец света!']), 50, false, sim.tick);
        }
      }
      // кратер из камней
      for (let k = 0; k < 7; k++) {
        const px = Math.round(tx + rng.float(-3, 3));
        const py = Math.round(ty + rng.float(-3, 3));
        if (inBounds(world, px, py) && world.buildingAt[idx(world, px, py)] < 0) world.props.push({ type: PropType.Rock, x: px, y: py, ox: 0.5, oy: 0.5, variant: 0, solid: false });
      }
      sim.chronicle.log(sim.tick, EventKind.Disaster, `Небесный камень обрушился на город! Погибло ${killed} человек.`, tx, ty, [], 1);
      sim.unrest = Math.min(100, sim.unrest + 15);
      sim.pathfinder.invalidate();
      return 'Небо разверзлось.';
    }
    case 'plague': {
      let n = 0;
      for (const c of sim.citizens) {
        if (!c.alive || dist2(c.x, c.y, tx, ty) > 400) continue;
        if (rng.chance(0.35)) {
          fallSick(sim, c, 'мор');
          n++;
        }
      }
      sim.epidemicMul = 4;
      sim.timers.push({ at: sim.tick + TICKS_PER_DAY * 3, fn: () => (sim.epidemicMul = 1) });
      sim.chronicle.log(sim.tick, EventKind.Disaster, `В городе мор! Слегло ${n} человек, болезнь расползается.`, tx, ty, [], 1);
      return 'Мор пришёл в город.';
    }
    case 'drought': {
      sim.market.yearFactor = 0.35;
      for (const b of world.buildings) if (b.type === BuildingType.Farm) b.storage['grain'] = Math.floor((b.storage['grain'] ?? 0) * 0.5);
      sim.chronicle.log(sim.tick, EventKind.Disaster, 'Засуха! Поля сохнут, урожая не будет. Крестьяне в отчаянии.', world.poi.cx, world.poi.cy, [], 0.9);
      sim.weather.targetRain = 0;
      sim.weather.rain = 0;
      sim.weather.temp += 10;
      return 'Солнце выжигает поля.';
    }
    case 'raid':
      spawnRaid(sim, rng.int(6, 9));
      return 'Разбойники идут.';
    case 'rats': {
      let lost = 0;
      for (const b of world.buildings) {
        if (dist2(b.doorX, b.doorY, tx, ty) > 625) continue;
        for (const g of ['grain', 'flour', 'bread']) {
          const v = b.storage[g] ?? 0;
          if (v > 0) {
            lost += Math.floor(v * 0.5);
            b.storage[g] = v * 0.5;
          }
        }
      }
      sim.epidemicMul = Math.max(sim.epidemicMul, 2);
      sim.timers.push({ at: sim.tick + TICKS_PER_DAY, fn: () => (sim.epidemicMul = 1) });
      for (const c of sim.citizens) if (c.alive && dist2(c.x, c.y, tx, ty) < 400 && rng.chance(0.3)) say(c, rng.pick(['Крысы! Везде крысы!', 'Они сожрали всё зерно!', 'Фу, какая мерзость!']), 45, false, sim.tick);
      sim.chronicle.log(sim.tick, EventKind.Disaster, `Нашествие крыс: сожрано ${lost} мер припасов в квартале.`, tx, ty, [], 0.8);
      return 'Крысы повсюду.';
    }
    case 'dragon': {
      sim.dragon = { x: -10, y: world.poi.cy - 20, dir: 0, until: sim.tick + TICKS_PER_HOUR * 1.5, nextFire: sim.tick + 60 };
      sim.chronicle.log(sim.tick, EventKind.Disaster, 'ДРАКОН! Крылатая тень кружит над Вальдмарком!', world.poi.cx, world.poi.cy, [], 1);
      for (const c of sim.citizens) {
        if (!c.alive || c.inside >= 0) continue;
        c.needs.safety = Math.max(0, c.needs.safety - 60);
        if (rng.chance(0.5)) say(c, rng.pick(['Дракон!!!', 'Прячьтесь!', 'Господи, помилуй!', 'В подвал, живо!']), 60, false, sim.tick);
        remember(c, sim.tick, 'Видел дракона над городом!', 0.9, -1, 'dragon');
      }
      return 'Дракон летит.';
    }
    case 'gold': {
      let total = 0;
      let n = 0;
      for (const c of sim.citizens) {
        if (!c.alive || c.inside >= 0 || dist2(c.x, c.y, tx, ty) > 225) continue;
        const amt = rng.int(5, 25);
        c.money += amt;
        total += amt;
        n++;
        say(c, rng.pick(['Золото! С неба!', 'Чудо!', 'Хватай, пока не растащили!', 'Слава небесам!']), 50, false, sim.tick);
        c.mood += 20;
        c.needs.fun = Math.min(100, c.needs.fun + 30);
        remember(c, sim.tick, `С неба посыпались монеты — поднял${c.sex === 'f' ? 'а' : ''} ${amt}!`, 0.8, -1, 'gold');
      }
      sim.moneyCreated += total;
      sim.chronicle.log(sim.tick, EventKind.Info, `Чудо на улицах: с неба просыпалось золото! ${n} горожан собрали ${total} монет.`, tx, ty, [], 0.9);
      return 'Золото сыплется с неба.';
    }
    case 'harvest': {
      sim.market.yearFactor = 1.6;
      for (const b of world.buildings) if (b.type === BuildingType.Farm) b.storage['grain'] = (b.storage['grain'] ?? 0) + 120;
      sim.chronicle.log(sim.tick, EventKind.Economy, 'Невиданный урожай! Амбары ломятся от зерна.', world.poi.cx, world.poi.cy, [], 0.8);
      sim.unrest = Math.max(0, sim.unrest - 15);
      return 'Поля золотятся.';
    }
    case 'heal': {
      let n = 0;
      for (const c of sim.citizens) {
        if (!c.alive || dist2(c.x, c.y, tx, ty) > 900) continue;
        if (c.flags & (FLAG_SICK | FLAG_INJURED) || c.hp < 60 || c.needs.health < 60 || c.action === 'fainted') {
          c.flags &= ~(FLAG_SICK | FLAG_INJURED);
          c.hp = 100;
          c.needs.health = 100;
          if (c.action === 'fainted') {
            c.action = '';
            c.state = 0;
            c.nextThink = sim.tick;
          }
          n++;
          say(c, rng.pick(['Чудо! Я здоров!', 'Боль ушла!', 'Благодарю, Господи!']), 50, false, sim.tick);
          remember(c, sim.tick, 'Чудесно исцелился.', 0.8, -1, 'miracle');
          c.needs.faith = 100;
        }
      }
      sim.chronicle.log(sim.tick, EventKind.Faith, `Чудесное исцеление: ${n} больных и раненых встали на ноги.`, tx, ty, [], 0.8);
      return 'Исцеление снизошло.';
    }
    case 'fair':
      if (sim.festival) return 'Праздник уже идёт.';
      startFestival(sim, 'fair', TICKS_PER_HOUR * 8, 'Ярмарка по воле небес');
      return 'Ярмарка объявлена.';
    case 'holiday':
      if (sim.festival) return 'Праздник уже идёт.';
      startFestival(sim, 'holiday', TICKS_PER_HOUR * 6, 'Городской праздник');
      sim.treasury = Math.max(0, sim.treasury - 60);
      return 'Праздник объявлен.';
  }
  return 'Неизвестная сила.';
}

/** Дракон и наводнение — обновление */
export function updateGod(sim: Simulation): void {
  const tick = sim.tick;
  if (sim.flood && tick >= sim.flood.until) {
    sim.flood = null;
    sim.chronicle.log(tick, EventKind.Info, 'Вода отступила. Горожане возвращаются в отсыревшие дома.', sim.world.poi.bridge.x, sim.world.poi.bridge.y, [], 0.5);
  }
  if (sim.shake > 0) sim.shake = Math.max(0, sim.shake - 0.02);
  const d = sim.dragon;
  if (d) {
    const world = sim.world;
    // летит кругами над городом
    const cx = world.poi.cx;
    const cy = world.poi.cy;
    const ang = (tick - (d.until - TICKS_PER_HOUR * 1.5)) * 0.012;
    d.x = cx + Math.cos(ang) * 26;
    d.y = cy + Math.sin(ang * 1.3) * 18;
    d.dir = Math.cos(ang) > 0 ? 3 : 1;
    if (tick >= d.nextFire) {
      d.nextFire = tick + 80 + sim.rng.int(0, 60);
      // поджечь ближайшее здание под драконом
      let best = null as null | (typeof world.buildings)[number];
      let bd = 80;
      for (const b of world.buildings) {
        if (b.w === 0 || b.condition <= 0 || b.material === 'stone') continue;
        const dd = dist2(b.x + b.w / 2, b.y + b.h / 2, d.x, d.y);
        if (dd < bd) {
          bd = dd;
          best = b;
        }
      }
      if (best) igniteBuilding(sim, best.id, 'драконье пламя', 0.5);
    }
    if (tick % 40 === 0) {
      for (const c of sim.citizens) {
        if (!c.alive || c.inside >= 0) continue;
        if (dist2(c.x, c.y, d.x, d.y) < 100) {
          c.needs.safety = Math.max(0, c.needs.safety - 10);
          if (sim.rng.chance(0.2)) say(c, sim.rng.pick(['А-а-а!', 'Он прямо над нами!', 'Бежим!']), 30, false, tick);
          if (c.profession === Profession.Guard && sim.rng.chance(0.3)) say(c, sim.rng.pick(['Стреляй!', 'Лучники, к стенам!', 'Не достать…']), 30, false, tick);
        }
      }
    }
    if (tick >= d.until) {
      sim.dragon = null;
      sim.chronicle.log(tick, EventKind.Disaster, 'Дракон, наевшись огня и страха, улетел за горы.', world.poi.cx, world.poi.cy, [], 0.8);
    }
  }
  // Ползунок стражи: раз в час подгоняем численность
  if (sim.guardTarget >= 0 && tick % TICKS_PER_HOUR === 0) {
    const barracks = sim.world.buildings.find((b) => b.type === BuildingType.Barracks);
    if (barracks) {
      const guards = sim.citizens.filter((c) => c.alive && c.profession === Profession.Guard && !c.actionData.visitor);
      if (guards.length < sim.guardTarget) {
        const cand = sim.citizens.find((c) => c.alive && !isChild(c) && c.age < 55 && c.sex === 'm' && (c.profession === Profession.Laborer || c.profession === Profession.None || c.profession === Profession.Farmer) && !c.actionData.visitor && c.jailedUntil <= tick);
        if (cand && sim.treasury >= 20) {
          assignJob(sim, cand, barracks, Profession.Guard);
          sim.treasury -= 20;
          sim.chronicle.log(tick, EventKind.Info, `${fullName(cand)} принят в городскую стражу.`, barracks.doorX, barracks.doorY, [cand.id], 0.3);
        }
      } else if (guards.length > sim.guardTarget) {
        const g = guards[guards.length - 1];
        barracks.workers = barracks.workers.filter((id) => id !== g.id);
        g.workplace = -1;
        g.profession = Profession.Laborer;
        g.mood -= 15;
        remember(g, tick, 'Уволен из стражи.', 0.6, -1, 'fired');
        sim.chronicle.log(tick, EventKind.Info, `${fullName(g)} отправлен в отставку из стражи.`, barracks.doorX, barracks.doorY, [g.id], 0.3);
      }
    }
  }
}
