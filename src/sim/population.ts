// Создание начального населения: семьи, дома, профессии.
import type { Simulation } from './game';
import { Citizen, CitizenState, Profession, Trait, Sex, Appearance, isChild, isElder } from './citizen';
import { MALE_NAMES, FEMALE_NAMES, SURNAMES } from './names';
import { professionForWorkplace } from '../data/professions';
import { BuildingType, BUILDING_DEFS, Building, District } from '../world/buildings';
import { RNG } from '../core/rng';
import { TICKS_PER_YEAR } from '../core/time';

const ALL_TRAITS: Trait[] = [
  Trait.Greedy, Trait.Honest, Trait.HotTempered, Trait.Cowardly, Trait.Pious, Trait.Talkative, Trait.Lazy, Trait.Ambitious,
  Trait.Kind, Trait.Drunkard, Trait.Cheerful, Trait.Gloomy, Trait.Hardworking, Trait.Curious, Trait.Envious, Trait.Brave,
];
const CONFLICTS: [Trait, Trait][] = [
  [Trait.Greedy, Trait.Kind], [Trait.Honest, Trait.Greedy], [Trait.Cowardly, Trait.Brave], [Trait.Lazy, Trait.Hardworking],
  [Trait.Lazy, Trait.Ambitious], [Trait.Cheerful, Trait.Gloomy], [Trait.HotTempered, Trait.Cowardly], [Trait.Kind, Trait.Envious],
];

export function randomTraits(rng: RNG, n: number, bias: Trait[] = []): Trait[] {
  const out: Trait[] = [];
  for (const b of bias) if (rng.chance(0.5) && out.length < n) out.push(b);
  let guard = 0;
  while (out.length < n && guard++ < 50) {
    const t = rng.pick(ALL_TRAITS);
    if (out.includes(t)) continue;
    if (CONFLICTS.some(([a, b]) => (a === t && out.includes(b)) || (b === t && out.includes(a)))) continue;
    out.push(t);
  }
  return out;
}

export function randomAppearance(rng: RNG, sex: Sex, cls: 'poor' | 'common' | 'rich'): Appearance {
  const cloth = cls === 'poor' ? rng.int(0, 4) : cls === 'common' ? rng.int(0, 9) : rng.int(5, 13);
  return {
    skin: rng.weighted([0, 1, 2, 3, 4, 5], [4, 4, 3, 2, 1, 2]),
    hair: rng.weighted([0, 1, 2, 3, 4, 5, 6, 7], [4, 5, 4, 3, 3, 2, 0.5, 0.2]),
    hairStyle: rng.int(0, 3),
    cloth,
    cloth2: cls === 'poor' ? rng.int(0, 4) : rng.int(0, 9),
    hat: sex === 'm' ? (rng.chance(0.25) ? 1 : rng.chance(0.1) ? 5 : 0) : rng.chance(0.3) ? 1 : 0,
    beard: sex === 'm' ? (rng.chance(0.45) ? rng.int(1, 2) : 0) : 0,
  };
}

export function newCitizen(sim: Simulation, p: { firstName: string; lastName: string; sex: Sex; age: number; cls?: 'poor' | 'common' | 'rich'; traits?: Trait[]; x: number; y: number }): Citizen {
  const rng = sim.rng;
  const id = sim.citizens.length;
  const c: Citizen = {
    id,
    alive: true,
    firstName: p.firstName,
    lastName: p.lastName,
    sex: p.sex,
    age: p.age,
    birthTick: sim.tick - p.age * TICKS_PER_YEAR - rng.int(0, TICKS_PER_YEAR - 1),
    appearance: randomAppearance(rng, p.sex, p.cls ?? 'common'),
    traits: p.traits ?? randomTraits(rng, rng.chance(0.4) ? 3 : 2),
    profession: Profession.None,
    home: -1,
    workplace: -1,
    x: p.x,
    y: p.y,
    px: p.x,
    py: p.y,
    dir: 0,
    speed: 1,
    path: null,
    pathIdx: 0,
    targetX: p.x,
    targetY: p.y,
    inside: -1,
    state: CitizenState.Idle,
    needs: {
      hunger: rng.float(55, 95),
      energy: rng.float(60, 100),
      social: rng.float(40, 90),
      safety: rng.float(70, 100),
      faith: rng.float(40, 90),
      fun: rng.float(40, 90),
      health: rng.float(75, 100),
    },
    money: 0,
    inventory: {},
    spouse: -1,
    children: [],
    parents: [],
    relations: new Map(),
    memories: [],
    bio: [],
    thought: '',
    speech: null,
    action: '',
    actionData: {},
    actionUntil: 0,
    nextThink: sim.tick + rng.int(0, 30),
    talkingTo: -1,
    talkCooldown: 0,
    stuckTicks: 0,
    pathFails: 0,
    lod: 0,
    drunk: 0,
    mood: 0,
    animPhase: 0,
    flags: 0,
    order: null,
    hp: 100,
    jailedUntil: 0,
    notoriety: 0,
  };
  sim.citizens.push(c);
  return c;
}

export function moveIn(sim: Simulation, c: Citizen, b: Building): void {
  c.home = b.id;
  b.residents.push(c.id);
  c.x = b.doorX;
  c.y = b.doorY;
  c.px = c.x;
  c.py = c.y;
  c.inside = b.id;
}

/** Класс по району дома */
function classOf(b: Building): 'poor' | 'common' | 'rich' {
  if (b.type === BuildingType.Shack || b.type === BuildingType.Farm) return 'poor';
  if (b.type === BuildingType.Manor || b.type === BuildingType.Castle) return 'rich';
  if (b.district === District.Noble || b.district === District.Center) return 'common';
  return 'common';
}

interface Household {
  home: Building;
  members: Citizen[];
}

export function createPopulation(sim: Simulation): void {
  const rng = sim.rng.fork('population');
  const world = sim.world;
  const homes = world.buildings.filter((b) => BUILDING_DEFS[b.type].home && b.type !== BuildingType.Barracks && b.type !== BuildingType.Monastery && b.type !== BuildingType.Castle);
  const households: Household[] = [];

  // 1. Семьи по домам
  for (const home of homes) {
    const cls = classOf(home);
    const surname = rng.pick(SURNAMES);
    const members: Citizen[] = [];
    const def = BUILDING_DEFS[home.type];
    const r = rng.next();
    const spawn = (sex: Sex, age: number, ln = surname) =>
      newCitizen(sim, { firstName: sex === 'm' ? rng.pick(MALE_NAMES) : rng.pick(FEMALE_NAMES), lastName: ln, sex, age, cls, x: home.doorX, y: home.doorY });
    if (r < 0.62) {
      // супружеская пара с детьми
      const hAge = rng.int(24, 52);
      const h = spawn('m', hAge);
      const w = spawn('f', Math.max(18, hAge + rng.int(-8, 4)));
      marry(h, w);
      members.push(h, w);
      const nKids = rng.weighted([0, 1, 2, 3, 4, 5], [1, 3, 4, 3, 2, 1]);
      for (let k = 0; k < nKids; k++) {
        const maxAge = Math.min(17, Math.min(hAge, w.age) - 18);
        if (maxAge < 1) break;
        const kid = spawn(rng.chance(0.5) ? 'm' : 'f', rng.int(1, maxAge));
        kid.parents = [h.id, w.id];
        h.children.push(kid.id);
        w.children.push(kid.id);
        members.push(kid);
      }
      if (rng.chance(0.3)) {
        // подмастерье/жилец
        members.push(spawn(rng.chance(0.75) ? 'm' : 'f', rng.int(15, 28), rng.pick(SURNAMES)));
      }
      if (rng.chance(0.4)) {
        // старик/старуха — родитель
        const e = spawn(rng.chance(0.5) ? 'm' : 'f', rng.int(63, 78));
        const child = rng.chance(0.5) ? h : w;
        if (child === w) e.lastName = rng.pick(SURNAMES);
        e.children.push(child.id);
        child.parents.push(e.id);
        members.push(e);
      }
    } else if (r < 0.72) {
      // одиночка (часто с подмастерьем/жильцом)
      const sex: Sex = rng.chance(0.6) ? 'm' : 'f';
      members.push(spawn(sex, rng.int(18, 45)));
      if (rng.chance(0.5)) members.push(spawn(rng.chance(0.7) ? 'm' : 'f', rng.int(16, 30), rng.pick(SURNAMES)));
    } else if (r < 0.9) {
      // вдова/вдовец с детьми или пожилая пара
      if (rng.chance(0.5)) {
        const p = spawn(rng.chance(0.4) ? 'm' : 'f', rng.int(30, 55));
        members.push(p);
        const n = rng.int(1, 4);
        for (let k = 0; k < n; k++) {
          const kid = spawn(rng.chance(0.5) ? 'm' : 'f', rng.int(2, Math.min(17, p.age - 18)));
          kid.parents = [p.id];
          p.children.push(kid.id);
          members.push(kid);
        }
      } else {
        const h = spawn('m', rng.int(60, 75));
        const w = spawn('f', rng.int(58, 72));
        marry(h, w);
        members.push(h, w);
      }
    } else {
      // двое неженатых братьев/сестёр или друзей
      const a = spawn(rng.chance(0.5) ? 'm' : 'f', rng.int(19, 35));
      const b = spawn(rng.chance(0.5) ? 'm' : 'f', rng.int(19, 35), rng.chance(0.5) ? surname : rng.pick(SURNAMES));
      a.relations.set(b.id, 50);
      b.relations.set(a.id, 50);
      members.push(a, b);
    }
    // В двухэтажных домах и особняках — вторая семья/жильцы
    if (home.stories >= 2 && members.length + 2 <= def.capacity && rng.chance(0.7)) {
      const ln2 = rng.pick(SURNAMES);
      const a = spawn('m', rng.int(22, 50), ln2);
      const w2 = spawn('f', Math.max(18, a.age + rng.int(-6, 3)), ln2);
      marry(a, w2);
      members.push(a, w2);
      if (members.length < def.capacity && rng.chance(0.6)) {
        const kid = spawn(rng.chance(0.5) ? 'm' : 'f', rng.int(1, Math.min(15, w2.age - 18)), ln2);
        kid.parents = [a.id, w2.id];
        a.children.push(kid.id);
        w2.children.push(kid.id);
        members.push(kid);
      }
    }
    // вместимость
    while (members.length > def.capacity) {
      const m = members.pop()!;
      m.alive = false;
      sim.citizens.pop();
    }
    for (const m of members) moveIn(sim, m, home);
    households.push({ home, members });
    // Семейные отношения
    for (const a of members)
      for (const b of members) {
        if (a === b) continue;
        if (!a.relations.has(b.id)) a.relations.set(b.id, rng.int(40, 80));
      }
  }

  // 2. Казарма: стража
  const barracks = world.buildings.find((b) => b.type === BuildingType.Barracks);
  if (barracks) {
    const n = Math.min(BUILDING_DEFS[BuildingType.Barracks].capacity, Math.max(6, Math.round(homes.length / 9)));
    for (let k = 0; k < n; k++) {
      const c = newCitizen(sim, { firstName: rng.pick(MALE_NAMES), lastName: rng.pick(SURNAMES), sex: 'm', age: rng.int(20, 45), cls: 'common', traits: randomTraits(rng, 2, [Trait.Brave, Trait.Honest]), x: barracks.doorX, y: barracks.doorY });
      moveIn(sim, c, barracks);
      assignJob(sim, c, barracks, Profession.Guard);
    }
  }
  // 3. Монастырь: монахи
  const monastery = world.buildings.find((b) => b.type === BuildingType.Monastery);
  if (monastery) {
    for (let k = 0; k < 5; k++) {
      const sex: Sex = k < 3 ? 'm' : 'f';
      const c = newCitizen(sim, { firstName: sex === 'm' ? rng.pick(MALE_NAMES) : rng.pick(FEMALE_NAMES), lastName: rng.pick(SURNAMES), sex, age: rng.int(25, 60), cls: 'poor', traits: randomTraits(rng, 2, [Trait.Pious, Trait.Kind]), x: monastery.doorX, y: monastery.doorY });
      moveIn(sim, c, monastery);
      assignJob(sim, c, monastery, Profession.Monk);
    }
  }
  // 4. Замок: лорд с семьёй и слуги
  const castle = world.buildings.find((b) => b.type === BuildingType.Castle);
  if (castle) {
    const surname = 'фон ' + rng.pick(['Вальдмарк', 'Хоэнштайн', 'Адлерберг', 'Лёвенбах', 'Розенкранц']);
    const lord = newCitizen(sim, { firstName: rng.pick(MALE_NAMES), lastName: surname, sex: 'm', age: rng.int(35, 60), cls: 'rich', traits: randomTraits(rng, 3, [Trait.Ambitious, Trait.Greedy]), x: castle.doorX, y: castle.doorY });
    const lady = newCitizen(sim, { firstName: rng.pick(FEMALE_NAMES), lastName: surname, sex: 'f', age: rng.int(30, 55), cls: 'rich', x: castle.doorX, y: castle.doorY });
    marry(lord, lady);
    moveIn(sim, lord, castle);
    moveIn(sim, lady, castle);
    lord.profession = Profession.Lord;
    lady.profession = Profession.Noble;
    lord.workplace = castle.id;
    castle.workers.push(lord.id);
    castle.owner = lord.id;
    for (let k = 0; k < rng.int(1, 3); k++) {
      const kid = newCitizen(sim, { firstName: rng.chance(0.5) ? rng.pick(MALE_NAMES) : rng.pick(FEMALE_NAMES), lastName: surname, sex: rng.chance(0.5) ? 'm' : 'f', age: rng.int(3, 17), cls: 'rich', x: castle.doorX, y: castle.doorY });
      kid.parents = [lord.id, lady.id];
      lord.children.push(kid.id);
      lady.children.push(kid.id);
      moveIn(sim, kid, castle);
    }
    for (let k = 0; k < 3; k++) {
      const sex: Sex = rng.chance(0.5) ? 'm' : 'f';
      const s = newCitizen(sim, { firstName: sex === 'm' ? rng.pick(MALE_NAMES) : rng.pick(FEMALE_NAMES), lastName: rng.pick(SURNAMES), sex, age: rng.int(18, 50), cls: 'poor', x: castle.doorX, y: castle.doorY });
      moveIn(sim, s, castle);
      assignJob(sim, s, castle, Profession.Servant);
    }
  }

  // 5. Профессии: работники для каждого рабочего здания
  assignProfessions(sim, rng);

  // 6. Деньги по классу
  for (const c of sim.citizens) {
    if (!c.alive) continue;
    if (isChild(c)) c.money = rng.int(0, 2);
    else {
      switch (c.profession) {
        case Profession.Lord:
          c.money = rng.int(800, 1500);
          break;
        case Profession.Noble:
        case Profession.Burgomaster:
          c.money = rng.int(200, 500);
          break;
        case Profession.Merchant:
        case Profession.Innkeeper:
          c.money = rng.int(80, 200);
          break;
        case Profession.Beggar:
          c.money = rng.int(0, 3);
          break;
        case Profession.Servant:
        case Profession.Farmer:
          c.money = rng.int(5, 25);
          break;
        default:
          c.money = rng.int(15, 60);
      }
      if (c.traits.includes(Trait.Greedy)) c.money = Math.round(c.money * 1.4);
      if (c.traits.includes(Trait.Drunkard)) c.money = Math.round(c.money * 0.7);
    }
    c.inventory['bread'] = isChild(c) ? 0 : rng.int(0, 2);
  }
  // Еда в домах
  for (const h of households) h.home.storage['bread'] = rng.int(2, 6) + h.members.length;
  // Стартовые запасы и капитал предприятий
  const INIT: Partial<Record<BuildingType, Record<string, number>>> = {
    [BuildingType.Farm]: { grain: 45, meat: 6, hide: 3, tools: 1 },
    [BuildingType.Mill]: { grain: 25, flour: 30 },
    [BuildingType.Bakery]: { flour: 25, bread: 30 },
    [BuildingType.Butcher]: { meat: 12 },
    [BuildingType.Tavern]: { ale: 30, bread: 10, meat: 3, grain: 10 },
    [BuildingType.Sawmill]: { wood: 20, planks: 15, tools: 1 },
    [BuildingType.Quarry]: { stone: 15, tools: 1 },
    [BuildingType.Smithy]: { wood: 8, tools: 6 },
    [BuildingType.Carpenter]: { planks: 10, tools: 1, goods: 2 },
    [BuildingType.Mason]: { stone: 10, tools: 1 },
    [BuildingType.Tannery]: { hide: 6, leather: 4 },
    [BuildingType.MarketStall]: { bread: 10, meat: 3, ale: 5 },
    [BuildingType.Warehouse]: { grain: 40, flour: 20, planks: 10, stone: 10 },
    [BuildingType.Merchant]: { goods: 4, tools: 2, leather: 3 },
  };
  for (const b of world.buildings) {
    const init = INIT[b.type];
    if (!init) continue;
    for (const [g, n] of Object.entries(init)) b.storage[g] = (b.storage[g] ?? 0) + n;
    if (b.owner >= 0) {
      const o = sim.citizens[b.owner];
      if (o && o.alive) o.money += b.type === BuildingType.Farm ? 50 : b.type === BuildingType.Warehouse ? 250 : 110;
    }
  }
  // Казна
  sim.treasury = 500 + homes.length * 4;
  // Биография: рождение
  for (const c of sim.citizens) {
    if (!c.alive) continue;
    c.bio.push({ tick: c.birthTick, text: `Родился${c.sex === 'f' ? 'ась' : 'ся'} в Вальдмарке.` });
    c.thought = 'Новый день в Вальдмарке.';
  }
  // Отношения с соседями: знакомы
  const byHome = new Map<number, Citizen[]>();
  for (const c of sim.citizens) {
    if (!c.alive || c.home < 0) continue;
    const arr = byHome.get(c.home) ?? [];
    arr.push(c);
    byHome.set(c.home, arr);
  }
  for (const h of households) {
    // соседи — дома в радиусе 6 тайлов
    for (const other of households) {
      if (other === h) continue;
      const d = Math.abs(other.home.x - h.home.x) + Math.abs(other.home.y - h.home.y);
      if (d > 8) continue;
      for (const a of h.members)
        for (const b of other.members) {
          if (isChild(a) !== isChild(b)) continue;
          if (rng.chance(0.5) && !a.relations.has(b.id)) a.relations.set(b.id, rng.int(-10, 30));
        }
    }
  }
  // Коллеги знакомы
  for (const b of world.buildings) {
    for (const a of b.workers)
      for (const z of b.workers) {
        if (a === z) continue;
        const ca = sim.citizens[a];
        if (!ca.relations.has(z)) ca.relations.set(z, rng.int(0, 35));
      }
  }
}

function marry(a: Citizen, b: Citizen): void {
  a.spouse = b.id;
  b.spouse = a.id;
  a.relations.set(b.id, 70);
  b.relations.set(a.id, 70);
}

export function assignJob(sim: Simulation, c: Citizen, b: Building, prof: Profession): void {
  if (c.workplace >= 0) {
    const old = sim.world.buildings[c.workplace];
    old.workers = old.workers.filter((id) => id !== c.id);
  }
  c.workplace = b.id;
  c.profession = prof;
  if (!b.workers.includes(c.id)) b.workers.push(c.id);
  if (b.owner < 0 && b.type !== BuildingType.Castle && b.type !== BuildingType.TownHall && b.type !== BuildingType.Barracks && b.type !== BuildingType.Cathedral && b.type !== BuildingType.Monastery && b.type !== BuildingType.Prison) b.owner = c.id;
}

export function professionFor(type: BuildingType, index: number): Profession {
  return professionForWorkplace(type, index);
}

function assignProfessions(sim: Simulation, rng: RNG): void {
  const world = sim.world;
  // Кандидаты: взрослые без работы
  const adults = sim.citizens.filter((c) => c.alive && !isChild(c) && !isElder(c) && c.workplace < 0 && c.profession === Profession.None);
  rng.shuffle(adults);
  // Приоритет: жители рядом с рабочим местом
  const jobs: { b: Building; prof: Profession; idx: number }[] = [];
  for (const b of world.buildings) {
    const def = BUILDING_DEFS[b.type];
    if (!def.workers) continue;
    if (b.type === BuildingType.Barracks || b.type === BuildingType.Monastery || b.type === BuildingType.Castle) continue;
    const need = def.workers - b.workers.length;
    for (let k = 0; k < need; k++) jobs.push({ b, prof: professionFor(b.type, b.workers.length + k), idx: k });
  }
  // Сначала ключевые уникальные здания
  jobs.sort((a, b) => Number(BUILDING_DEFS[b.b.type].unique) - Number(BUILDING_DEFS[a.b.type].unique));
  for (const job of jobs) {
    // Фермы — жильцы фермы
    if (job.b.type === BuildingType.Farm) {
      const res = job.b.residents.map((id) => sim.citizens[id]).find((c) => c.alive && !isChild(c) && !isElder(c) && c.workplace < 0);
      if (res) {
        assignJob(sim, res, job.b, Profession.Farmer);
        continue;
      }
    }
    // Лавки/таверны: владельцы живут рядом или в самом здании (торговый дом)
    let best: Citizen | null = null;
    let bestD = Infinity;
    for (const c of adults) {
      if (c.workplace >= 0) continue;
      // Ограничения по полу для стражи/священников (историчность)
      if ((job.prof === Profession.Priest || job.prof === Profession.Guard || job.prof === Profession.Smith) && c.sex === 'f') continue;
      const home = c.home >= 0 ? world.buildings[c.home] : null;
      let d = home ? Math.abs(home.doorX - job.b.doorX) + Math.abs(home.doorY - job.b.doorY) : 50;
      if (job.b.type === BuildingType.Merchant && c.home === job.b.id) d = -100;
      // Торговцы предпочитают жителей центра, ремесленники — ремесленного квартала
      if (home && home.district === District.Noble && (job.prof === Profession.Farmer || job.prof === Profession.Tanner || job.prof === Profession.Quarryman)) d += 60;
      if (home && home.district === District.Slums && (job.prof === Profession.Merchant || job.prof === Profession.Burgomaster || job.prof === Profession.Priest)) d += 60;
      d += rng.float(0, 8);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best) assignJob(sim, best, job.b, job.prof);
  }
  // Оставшиеся взрослые: домохозяйки, подёнщики, крестьяне (пока есть места), нищие, воры, безработные
  const farms = world.buildings.filter((b) => b.type === BuildingType.Farm);
  const laborSites = world.buildings.filter((b) => b.type === BuildingType.Warehouse || b.type === BuildingType.Quarry || b.type === BuildingType.Sawmill || b.type === BuildingType.Mason || b.type === BuildingType.Stable || b.type === BuildingType.Tannery || b.type === BuildingType.Carpenter || b.type === BuildingType.Mill);
  const extra = new Map<number, number>();
  for (const c of adults) {
    if (c.workplace >= 0) continue;
    const r = rng.next();
    if (c.sex === 'f' && (c.spouse >= 0 || (r < 0.3 && c.children.length === 0))) {
      c.profession = Profession.Housewife;
      continue;
    }
    if (c.sex === 'f' && r < 0.75) {
      // служанка в особняке, замке или таверне
      const place = world.buildings.find((b) => (b.type === BuildingType.Manor || b.type === BuildingType.Tavern || b.type === BuildingType.Castle) && (extra.get(b.id) ?? 0) < 2 && b.id !== c.home);
      if (place) {
        extra.set(place.id, (extra.get(place.id) ?? 0) + 1);
        assignJob(sim, c, place, Profession.Servant);
        continue;
      }
    }
    if (r < 0.08 && (c.traits.includes(Trait.Greedy) || c.traits.includes(Trait.Lazy))) {
      c.profession = Profession.Thief;
      continue;
    }
    if (r < 0.16 && c.home >= 0 && world.buildings[c.home].type === BuildingType.Shack) {
      c.profession = Profession.Beggar;
      continue;
    }
    const farm = farms.find((f) => f.workers.length < BUILDING_DEFS[f.type].workers + 2);
    if (farm && r < 0.6) {
      assignJob(sim, c, farm, Profession.Farmer);
      continue;
    }
    const site = laborSites.find((b) => (extra.get(b.id) ?? 0) < 4);
    if (site && r < 0.93) {
      extra.set(site.id, (extra.get(site.id) ?? 0) + 1);
      assignJob(sim, c, site, Profession.Laborer);
      continue;
    }
    c.profession = Profession.None; // без занятия — потенциальные смутьяны
  }
  // Нищие и дети, старики
  for (const c of sim.citizens) {
    if (!c.alive) continue;
    if (isChild(c)) c.profession = Profession.Child;
    else if (isElder(c) && c.workplace < 0) c.profession = Profession.Elder;
    if (c.home < 0) c.profession = Profession.Beggar;
  }
  // Пожарные-добровольцы: плотники, кузнецы, каменщики и несколько крепких горожан
  for (const c of sim.citizens) {
    if (!c.alive || isChild(c) || isElder(c)) continue;
    if (c.profession === Profession.Carpenter || c.profession === Profession.Mason || c.profession === Profession.Smith || c.profession === Profession.Fireman || (c.traits.includes(Trait.Brave) && c.sex === 'm' && rng.chance(0.5))) c.flags |= 1;
  }
  // Несколько нищих у ворот/площади без дома
  const nBeggars = Math.max(2, Math.round(sim.citizens.length / 120));
  for (let k = 0; k < nBeggars; k++) {
    const sex: Sex = rng.chance(0.7) ? 'm' : 'f';
    const spot = rng.pick(world.poi.strollSpots);
    const c = newCitizen(sim, { firstName: sex === 'm' ? rng.pick(MALE_NAMES) : rng.pick(FEMALE_NAMES), lastName: rng.pick(SURNAMES), sex, age: rng.int(25, 70), cls: 'poor', traits: randomTraits(rng, 2, [Trait.Drunkard, Trait.Gloomy]), x: spot.x, y: spot.y });
    c.profession = Profession.Beggar;
    c.money = rng.int(0, 2);
  }
}
