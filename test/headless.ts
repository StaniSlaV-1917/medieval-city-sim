// Headless-тест: генерация нескольких городов, прогон симуляции, проверка инвариантов.
import { Simulation } from '../src/sim/game';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../src/core/time';
import { idx, isWalkableAt } from '../src/world/world';
import { CitizenState } from '../src/sim/citizen';
import type { CitySize } from '../src/world/generator';
import { collectStats as collectStatsNow } from '../src/sim/stats';
import { serialize, deserialize, migrateSave, SAVE_VERSION } from '../src/save/save';
import { readFileSync, readdirSync } from 'node:fs';
import { WORKPLACE_PROFESSIONS } from '../src/data/professions';
import { EDICT_DEFS } from '../src/data/edicts';
import { BUILDING_DEFS } from '../src/world/buildings';
import { Profession } from '../src/sim/citizen';
import { isWalkableAt as walkable } from '../src/world/world';
import { Pathfinder } from '../src/world/pathfinding';
import { hireProspector } from '../src/sim/prospect';
import { PropType } from '../src/world/world';
import { Tile } from '../src/world/tiles';
import { catalogItem } from '../src/data/buildCatalog';
import { checkPlace, placeBuilding, buildRoad, snappedLine, paintZone, placePlot, demolishBuilding, upgradeBuilding, hireWorker, fireWorker, setMaxWorkers, setClosed, farmFertility, doorFor, materialAvailable } from '../src/sim/build';
import { BuildingType } from '../src/world/buildings';
import { idx as tileIndex, isRoadTile } from '../src/world/world';
import { dialogueLineCount } from '../src/ai/dialogue';
import { layoutBubbles, BubbleItem } from '../src/render/bubbleLayout';
import { RNG } from '../src/core/rng';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

interface Case {
  seed: string;
  size: CitySize;
  days: number;
}

const DAYS = Number(process.env.DAYS || 10);
const cases: Case[] = [
  { seed: 'Вальдмарк', size: 'medium', days: DAYS },
  { seed: 'test-7', size: 'small', days: DAYS },
  { seed: 'Хольцбург-42', size: 'medium', days: Math.max(3, Math.floor(DAYS / 2)) },
];
if (process.env.LARGE) cases.push({ seed: 'большой', size: 'large', days: 3 });

let failures = 0;
let warnings = 0;
function check(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.error('  ✗ ' + msg);
  }
}
/** Мягкая проверка (предупреждение) */
function warn(cond: boolean, msg: string): void {
  if (!cond) {
    warnings++;
    console.warn('  ⚠ ' + msg);
  }
}

/** Голодные обмороки за день при сытом городе — инвариант из ROADMAP (фаза 12) */
function hungerFaintsCheck(sim: Simulation, fromEvent: number, pop: number, avgHunger: number, day: number, soft: boolean): void {
  let n = 0;
  for (const e of sim.chronicle.events.slice(fromEvent)) if (e.text.includes('обморок') && e.text.includes('голода')) n++;
  const limit = Math.max(1, Math.round(pop * 0.008));
  const ok = avgHunger < 55 || n <= limit;
  const msg = `день ${day}: голодных обмороков ${n} при средней сытости ${avgHunger.toFixed(0)} (допустимо ${limit})`;
  if (soft) warn(ok, msg);
  else check(ok, msg);
}

for (const c of cases) {
  console.log(`\n=== Сид «${c.seed}», размер ${c.size}, ${c.days} дн. ===`);
  const t0 = Date.now();
  const sim = new Simulation({ seedText: c.seed, size: c.size });
  const world = sim.world;
  console.log(`  генерация: ${Date.now() - t0} мс, зданий ${world.buildings.length}, жителей ${sim.citizens.length}`);

  // Инвариант: все двери достижимы от колодца
  const reach = sim.pathfinder.reachableMask(world.poi.wellX, world.poi.wellY + 1);
  let unreachable = 0;
  for (const b of world.buildings) {
    if (!reach[idx(world, b.doorX, b.doorY)]) unreachable++;
    check(isWalkableAt(world, b.doorX, b.doorY), `дверь здания ${b.id} непроходима`);
  }
  check(unreachable === 0, `недостижимых дверей: ${unreachable}`);
  // Все жители имеют дом или помечены бездомными; позиции валидны
  for (const cz of sim.citizens) {
    check(Number.isFinite(cz.x) && Number.isFinite(cz.y), `NaN в стартовой позиции жителя ${cz.id}`);
  }
  const money0 = sim.totalMoney();
  let forest0 = 0;
  for (let i = 0; i < world.w * world.h; i++) if (world.tiles[i] === Tile.Forest) forest0++;
  const pop0 = sim.citizens.filter((z) => z.alive).length;
  if (sim.citizens.length === 0) console.log('  (население появится в фазе 1)');
  else check(pop0 > 50, `слишком маленькое население: ${pop0}`);

  // Прогон
  const stuck = new Map<number, number>();
  const totalTicks = c.days * TICKS_PER_DAY;
  const t1 = Date.now();
  let maxStuck = 0;
  let maxStuckId = -1;
  const lastPos = new Map<number, [number, number]>();
  let dayEventStart = sim.chronicle.events.length;
  for (let t = 0; t < totalTicks; t++) {
    sim.step();
    if (sim.tick % TICKS_PER_DAY === 0) {
      const ds = collectStatsNow(sim);
      hungerFaintsCheck(sim, dayEventStart, ds.population, ds.avgHunger, Math.floor(sim.tick / TICKS_PER_DAY), false);
      dayEventStart = sim.chronicle.events.length;
    }
    if (t % 50 === 0) {
      for (const cz of sim.citizens) {
        if (!cz.alive) continue;
        if (!Number.isFinite(cz.x) || !Number.isFinite(cz.y)) {
          check(false, `NaN позиция у жителя ${cz.id} на тике ${sim.tick}`);
          cz.x = world.poi.cx;
          cz.y = world.poi.cy;
        }
        const lp = lastPos.get(cz.id);
        if (cz.state === CitizenState.Moving && lp && Math.abs(lp[0] - cz.x) < 0.01 && Math.abs(lp[1] - cz.y) < 0.01) {
          const s = (stuck.get(cz.id) ?? 0) + 50;
          stuck.set(cz.id, s);
          if (s > maxStuck) {
            maxStuck = s;
            maxStuckId = cz.id;
          }
        } else stuck.set(cz.id, 0);
        lastPos.set(cz.id, [cz.x, cz.y]);
      }
    }
  }
  const ms = Date.now() - t1;
  console.log(`  симуляция: ${ms} мс (${((totalTicks / ms) * 1000).toFixed(0)} тиков/с), ${(ms / (c.days * 24)).toFixed(1)} мс/игровой час`);
  const popEnd = sim.citizens.filter((z) => z.alive).length;
  const money1 = sim.totalMoney();
  const expected = money0 + sim.moneyCreated - sim.moneyDestroyed;
  check(Math.abs(money1 - expected) < 0.5, `деньги не сходятся: было ${money0.toFixed(1)}, стало ${money1.toFixed(1)}, ожидалось ${expected.toFixed(1)}`);
  check(maxStuck < TICKS_PER_HOUR * 3, `житель ${maxStuckId} застрял на ${maxStuck} тиков`);
  if (pop0 > 0) check(popEnd >= pop0 * 0.9, `население упало с ${pop0} до ${popEnd}`);
  const st = collectStatsNow(sim);
  check(st.avgHunger >= 40, `город голодает: средняя сытость ${st.avgHunger.toFixed(0)}`);
  check(st.avgHealth >= 70, `город болеет: среднее здоровье ${st.avgHealth.toFixed(0)}`);
  for (const b of world.buildings) for (const [k, v] of Object.entries(b.storage)) check(Number.isFinite(v) && v >= -0.01, `запас ${k} в здании ${b.id} = ${v}`);
  // Природа (фаза 13): ресурсы не уходят в минус, лес не исчезает, пни от вырубки появляются
  let negRes = 0;
  let forestNow = 0;
  for (let i = 0; i < world.w * world.h; i++) {
    if (world.resourceAmount[i] < 0 || !Number.isFinite(world.fertility[i])) negRes++;
    if (world.tiles[i] === Tile.Forest) forestNow++;
  }
  check(negRes === 0, `тайлов с отрицательным ресурсом/NaN плодородием: ${negRes}`);
  check(forestNow >= forest0 * 0.9, `лес исчезает: было ${forest0} тайлов, стало ${forestNow}`);
  const stumps = world.props.filter((p) => p.type === PropType.Stump && p.born !== undefined).length;
  if (c.days >= 3) check(stumps > 0, 'лесорубы работали, а пней от вырубки нет');
  check(world.parcels.length >= 8 && new Set(world.parcels.map((p) => p.name)).size === world.parcels.length, 'угодья: мало или имена повторяются');
  const game = sim.animals.filter((a) => a.alive && (a.kind === 5 || a.kind === 6)).length;
  check(game > 0, 'в лесах нет дичи');
  console.log(`  природа: лес ${forest0}→${forestNow}, пней ${stumps}, дичи ${game}, угодий ${world.parcels.length}`);
  console.log(`  население ${popEnd}, деньги ${money1.toFixed(0)}, ср. сытость ${st.avgHunger.toFixed(0)}, ср. здоровье ${st.avgHealth.toFixed(0)}, макс. застревание ${maxStuck} тиков`);
  console.log(`  событий в хронике: ${sim.chronicle.events.length}; A*: ${sim.pathfinder.stats.searches} поисков, ${sim.pathfinder.stats.cacheHits} из кэша`);
  for (const e of sim.chronicle.events.slice(-5)) console.log(`    · ${e.text}`);
}

// ---------------------------------------------------------------- Большая карта (фаза 13)
{
  console.log('\n=== Большая карта: HPA*, туман, рудознатец ===');
  const sim = new Simulation({ seedText: 'большая-карта', size: 'large', fog: true });
  const world = sim.world;
  check(world.w === 320, `большая карта должна быть 320 тайлов, а не ${world.w}`);
  // HPA*: дальние пути валидны и находятся там, где находит обычный A*
  const plain = new Pathfinder(world);
  plain.hpa = null;
  const rng = new RNG(11);
  const reach = sim.pathfinder.reachableMask(world.poi.wellX, world.poi.wellY + 1);
  const pts: number[] = [];
  for (let i = 0; i < reach.length; i++) if (reach[i]) pts.push(i);
  let tested = 0;
  let invalid = 0;
  let missing = 0;
  let ratio = 0;
  const t0 = Date.now();
  while (tested < 60) {
    const a = pts[rng.int(0, pts.length - 1)];
    const b = pts[rng.int(0, pts.length - 1)];
    const ax = a % world.w;
    const ay = (a / world.w) | 0;
    const bx = b % world.w;
    const by = (b / world.w) | 0;
    if (Math.max(Math.abs(ax - bx), Math.abs(ay - by)) < 70) continue;
    tested++;
    const p = sim.pathfinder.find(ax, ay, bx, by);
    const q = plain.find(ax, ay, bx, by);
    if (!p) {
      if (q) missing++;
      continue;
    }
    let px = ax;
    let py = ay;
    let ok = p[p.length - 1] === b;
    for (const i of p) {
      const x = i % world.w;
      const y = (i / world.w) | 0;
      if (Math.abs(x - px) > 1 || Math.abs(y - py) > 1 || !walkable(world, x, y)) ok = false;
      px = x;
      py = y;
    }
    if (!ok) invalid++;
    if (q) ratio += p.length / q.length;
  }
  check(invalid === 0, `HPA*: невалидных путей ${invalid} из ${tested}`);
  check(missing === 0, `HPA*: не нашёл ${missing} путей, которые находит A*`);
  check(ratio / tested < 1.15, `HPA*: пути слишком длинные (×${(ratio / tested).toFixed(2)} от A*)`);
  console.log(`  HPA*: ${tested} дальних путей за ${Date.now() - t0} мс, длина ×${(ratio / tested).toFixed(3)} от A*`);
  // Туман: разведанная доля растёт, рудознатец находит скрытые ресурсы
  const explored = (): number => {
    let n = 0;
    for (let i = 0; i < world.explored.length; i++) n += world.explored[i];
    return n / world.explored.length;
  };
  const e0 = explored();
  check(e0 > 0.05 && e0 < 0.9, `туман: стартовая разведка ${(e0 * 100).toFixed(0)}% — ожидается город и окрестности`);
  sim.treasury += 100;
  const msg = hireProspector(sim);
  check(sim.region.prospector >= 0, `рудознатец не нанят: ${msg}`);
  let hidden0 = 0;
  for (let i = 0; i < world.resource.length; i++) if ((world.resource[i] === 2 || world.resource[i] === 4) && !world.discovered[i]) hidden0++;
  for (let t = 0; t < TICKS_PER_DAY * 2; t++) sim.step();
  let hidden1 = 0;
  for (let i = 0; i < world.resource.length; i++) if ((world.resource[i] === 2 || world.resource[i] === 4) && !world.discovered[i]) hidden1++;
  const e1 = explored();
  check(e1 > e0, `туман не рассеивается: ${(e0 * 100).toFixed(1)}% → ${(e1 * 100).toFixed(1)}%`);
  check(hidden0 > 0, 'на большой карте нет скрытых месторождений');
  console.log(`  туман: ${(e0 * 100).toFixed(0)}% → ${(e1 * 100).toFixed(0)}%, скрытых ресурсов ${hidden0} → ${hidden1}${hidden1 < hidden0 ? ' (рудознатец нашёл жилу)' : ''}`);
  warn(hidden1 < hidden0, 'рудознатец за два дня ничего не нашёл (случайность, но стоит проверить)');
  // Цикл сериализации сохраняет природу
  const again = deserialize(serialize(sim));
  let same = true;
  for (let i = 0; i < world.resource.length; i += 97) if (again.world.resource[i] !== world.resource[i] || again.world.resourceAmount[i] !== world.resourceAmount[i] || again.world.explored[i] !== world.explored[i]) same = false;
  check(same && again.world.parcels.length === world.parcels.length && again.world.fog, 'природные данные и туман не сохраняются');
}

// ---------------------------------------------------------------- Панель строительства (фаза 14)
{
  console.log('\n=== Строительство: размещение, дороги, зоны, участки, снос, улучшение, рабочие, бот-строитель ===');
  const sim = new Simulation({ seedText: 'стройка', size: 'medium' });
  const world = sim.world;
  sim.treasury += 3000;
  const wh = world.buildings.find((b) => b.type === BuildingType.Warehouse)!;
  check(!!wh, 'в городе нет склада');
  wh.storage.planks = (wh.storage.planks ?? 0) + 120;
  wh.storage.stone = (wh.storage.stone ?? 0) + 120;
  // Лесопилка: нужна рядом с лесом; ищем место у опушки
  const saw = catalogItem('sawmill')!;
  let site: { x: number; y: number } | null = null;
  for (let y = 4; y < world.h - 8 && !site; y++)
    for (let x = 4; x < world.w - 8 && !site; x++) {
      let forest = false;
      for (let dy = -6; dy <= 6 && !forest; dy++) for (let dx = -6; dx <= 6; dx++) if (world.tiles[tileIndex(world, x + dx, y + dy)] === Tile.Forest) forest = true;
      if (!forest) continue;
      const chk = checkPlace(sim, saw, x, y, 0);
      if (chk.ok && Math.hypot(x - world.poi.cx, y - world.poi.cy) < 60) site = { x, y };
    }
  check(!!site, 'не нашлось места под лесопилку у леса');
  const sawB = site ? placeBuilding(sim, saw, site.x, site.y, 0) : null;
  check(!!sawB && sawB.underConstruction === 0 && sim.construction.queue.includes(sawB.id), 'лесопилка не заложена или не в очереди');
  // Ориентации: дверь по сторонам света
  const d1 = doorFor(10, 10, 3, 3, 1);
  const d3 = doorFor(10, 10, 3, 3, 3);
  check(d1.x === 9 && d3.x === 13, `дверь при ориентации запад/восток: ${d1.x}, ${d3.x}`);
  // Дорога: тропа от площади на восток, мощёная — рядом
  const px0 = world.poi.square.x + world.poi.square.w + 2;
  const py0 = world.poi.square.y + 2;
  const line = snappedLine(px0, py0, px0 + 12, py0 + 3);
  check(line.every((p, i) => i === 0 || Math.abs(p.x - line[i - 1].x) + Math.abs(p.y - line[i - 1].y) <= 1), 'линия дороги не 4-связная');
  const nPath = buildRoad(sim, snappedLine(world.poi.gates[0].x + 2, world.poi.gates[0].y + 2, world.poi.gates[0].x + 14, world.poi.gates[0].y + 2), false);
  const stone0 = materialAvailable(sim, 'stone');
  const nRoad = buildRoad(sim, snappedLine(world.poi.gates[0].x + 2, world.poi.gates[0].y + 4, world.poi.gates[0].x + 10, world.poi.gates[0].y + 4), true);
  check(nPath >= 5 || nRoad >= 5, `дороги не прокладываются: тропа ${nPath}, мощёная ${nRoad}`);
  check(nRoad === 0 || materialAvailable(sim, 'stone') < stone0, 'мощёная дорога не берёт камень со складов');
  // Зона поля у фермы и плодородие
  const farm = world.buildings.find((b) => b.type === BuildingType.Farm)!;
  const f0 = farmFertility(world, farm);
  const painted = paintZone(sim, 'field', farm.x - 6, farm.y - 6, 3);
  const f1 = farmFertility(world, farm);
  check(painted > 0 && f1 > 0.3, `поле не рисуется или не влияет на ферму (${painted} тайлов, ${f0.toFixed(2)} → ${f1.toFixed(2)})`);
  // Жилой участок вдоль новой тропы
  const gx = world.poi.gates[0].x;
  const gy = world.poi.gates[0].y;
  const plot = placePlot(sim, gx + 3, gy + 5, gx + 13, gy + 9);
  check(plot.length >= 1, `жилой участок не дал домов (${plot.length})`);
  // Снос лачуги с переселением
  const shack = world.buildings.find((b) => b.type === BuildingType.Shack && b.residents.length > 0)!;
  const res0 = shack.residents.slice();
  const shackId = shack.id;
  demolishBuilding(sim, shackId);
  check(shack.w === 0 && res0.every((id) => sim.citizens[id].home !== shackId), 'после сноса жильцы остались привязаны к лачуге');
  check(world.buildingAt[tileIndex(world, shack.x, shack.y)] === -1, 'тайлы снесённого здания не освобождены');
  // Улучшение другой лачуги
  const shack2 = world.buildings.find((b) => b.type === BuildingType.Shack && b.w > 0)!;
  const upMsg = upgradeBuilding(sim, shack2.id);
  check(shack2.upgradeTo !== undefined && shack2.underConstruction === 0, `улучшение не началось: ${upMsg}`);
  // Рабочие
  const bakery = world.buildings.find((b) => b.type === BuildingType.Bakery)!;
  const w0 = bakery.workers.length;
  setMaxWorkers(sim, bakery, w0 + 2);
  const hireMsg = hireWorker(sim, bakery);
  check(bakery.workers.length === w0 + 1, `найм не работает: ${hireMsg}`);
  fireWorker(sim, bakery);
  check(bakery.workers.length === w0, 'увольнение не работает');
  setMaxWorkers(sim, bakery, Math.max(0, w0 - 1));
  check(bakery.workers.length === Math.max(0, w0 - 1), 'предел рабочих не сокращает штат');
  setClosed(sim, bakery, true);
  check(bakery.closed === true, 'закрытие не работает');
  setClosed(sim, bakery, false);
  // Бот-строитель: 8 дней — лесопилка и дома должны достроиться подвозом материалов
  const sawId = sawB ? sawB.id : -1;
  const plotIds = plot.map((b) => b.id);
  for (let t = 0; t < TICKS_PER_DAY * 8; t++) sim.step();
  const done = [sawId, ...plotIds, shack2.id].filter((id) => id >= 0 && world.buildings[id].underConstruction === undefined && world.buildings[id].condition > 0).length;
  check(done >= 2, `за 8 дней достроено только ${done} из ${1 + plotIds.length + 1} строек правителя`);
  check(sawId < 0 || world.buildings[sawId].underConstruction === undefined, `лесопилка не достроена: ${Math.round((world.buildings[sawId].underConstruction ?? 0) * 100)}%, материалы ${JSON.stringify(Object.fromEntries(Object.entries(world.buildings[sawId].storage).filter(([k]) => k.startsWith('_'))))}`);
  check(shack2.type === BuildingType.House || shack2.underConstruction !== undefined, 'улучшение лачуги не применилось');
  check(sawId < 0 || world.buildings[sawId].workers.length > 0, 'в новую лесопилку никто не нанялся');
  const money1 = sim.totalMoney();
  const expected = sim.citizens.length ? money1 : money1;
  void expected;
  console.log(`  дороги: тропа ${nPath}, мощёная ${nRoad}; поле +${painted}; участок: ${plot.length} домов; достроено ${done}; лесопилка: работников ${sawId >= 0 ? world.buildings[sawId].workers.length : 0}; лачуга → ${shack2.type === BuildingType.House ? 'дом' : 'ещё строится'}`);
  check(sim.citizens.every((c) => !c.alive || (Number.isFinite(c.x) && Number.isFinite(c.y))), 'NaN после стройки');
  check(isRoadTile(world.tiles[tileIndex(world, gx + 5, gy + 2)] as Tile) || nPath === 0, 'тропа не стала дорогой');

}

// ---------------------------------------------------------------- Сохранения
{
  console.log('\n=== Сохранение: обратная совместимость и цикл сериализации ===');
  const dir = dirname(fileURLToPath(import.meta.url));
  const fixtures = readdirSync(join(dir, 'fixtures')).filter((f) => f.endsWith('.json')).sort();
  check(fixtures.length >= 1, 'нет фикстур сохранений в test/fixtures');
  let json = '';
  for (const f of fixtures) {
    const raw = readFileSync(join(dir, 'fixtures', f), 'utf8');
    const ver = (JSON.parse(raw) as { version: number }).version;
    const t0 = Date.now();
    const s = deserialize(raw);
    check(s.citizens.length > 0 && Number.isFinite(s.tick), `фикстура ${f} не загрузилась`);
    console.log(`  фикстура ${f} (версия ${ver} → ${SAVE_VERSION}): загружена за ${Date.now() - t0} мс, жителей ${s.citizens.length}, тик ${s.tick}`);
    if (f === 'save-v1.json') json = raw;
  }
  // Цепочка миграций: версия 1 доводится до текущей, будущая версия отвергается
  const migrated = migrateSave(JSON.parse(json) as Record<string, unknown>);
  check(migrated.version === SAVE_VERSION, `миграция не довела версию до ${SAVE_VERSION}: ${migrated.version}`);
  let rejected = false;
  try {
    migrateSave({ version: SAVE_VERSION + 50 });
  } catch {
    rejected = true;
  }
  check(rejected, 'сохранение из будущей версии должно отвергаться');
  const sim = deserialize(json);
  check(sim.chronicle.events.length > 0 && !/-\d+ год/.test(sim.citizens[0].bio[0]?.text ?? ''), 'биография содержит отрицательный год');
  check(Array.isArray(sim.favorites), 'favorites не инициализирован при загрузке старого сейва');
  check(Object.values(sim.market.dayStartStock).every((v) => Number.isFinite(v)), 'dayStartStock содержит NaN после загрузки');
  const pop0 = sim.citizens.filter((z) => z.alive).length;
  const money0 = sim.totalMoney();
  const created0 = sim.moneyCreated;
  const destroyed0 = sim.moneyDestroyed;
  const ev0 = sim.chronicle.events.length;
  for (let t = 0; t < TICKS_PER_DAY; t++) sim.step();
  const pop1 = sim.citizens.filter((z) => z.alive).length;
  for (const cz of sim.citizens) check(Number.isFinite(cz.x) && Number.isFinite(cz.y), `NaN у жителя ${cz.id} после загрузки старого сейва`);
  check(pop1 >= pop0 * 0.9, `после загрузки старого сейва население упало с ${pop0} до ${pop1}`);
  const expected = money0 + (sim.moneyCreated - created0) - (sim.moneyDestroyed - destroyed0);
  check(Math.abs(sim.totalMoney() - expected) < 0.5, `деньги после загрузки не сходятся: ${sim.totalMoney().toFixed(1)} vs ${expected.toFixed(1)}`);
  check(sim.chronicle.events.length > ev0, 'после загрузки старого сейва не появилось ни одного события');
  check((sim.events.counts['chronicle'] ?? 0) === sim.chronicle.events.length - ev0, 'шина событий пропускает записи хроники');
  check((sim.events.counts['day'] ?? 0) >= 1, 'шина событий: не было события «day» за игровой день');
  check((sim.events.counts['talk:start'] ?? 0) > 0 && (sim.events.counts['talk:end'] ?? 0) > 0, 'шина событий: разговоры не сообщают о начале/конце');
  // Таблицы данных: у каждого здания с работниками есть профессия, у действующих указов — get/set
  for (const [t, def] of Object.entries(BUILDING_DEFS)) if (def.workers > 0) check((WORKPLACE_PROFESSIONS[Number(t) as keyof typeof WORKPLACE_PROFESSIONS] ?? []).length > 0, `нет профессии для здания ${def.name}`);
  for (const e of EDICT_DEFS) if (!e.planned) check(!!e.get && !!e.set && !!e.slider, `указ ${e.id} без get/set`);
  check(Profession.Bard === WORKPLACE_PROFESSIONS[6]![2], 'в таверне третий работник должен быть бардом');
  const sub = sim;
  check(sub.city.treasury === sub.treasury && sub.economy.market === sub.market && sub.justice.alarms === sub.alarms && sub.region.weather === sub.weather, 'аксессоры подсистем расходятся с полями');
  // Цикл: сохранить → загрузить → сравнить ключевые поля
  sim.favorites = [sim.citizens.find((z) => z.alive)!.id];
  const again = deserialize(serialize(sim));
  check(again.tick === sim.tick, 'тик не совпадает после цикла сериализации');
  check(again.favorites.length === 1 && again.favorites[0] === sim.favorites[0], 'избранные не сохраняются');
  check(Math.abs(again.totalMoney() - sim.totalMoney()) < 0.01, 'деньги не совпадают после цикла сериализации');
  check(again.citizens.length === sim.citizens.length, 'число жителей не совпадает после цикла сериализации');
  for (let t = 0; t < 300; t++) again.step();
  check(again.citizens.every((z) => Number.isFinite(z.x)), 'NaN после шага загруженной копии');
  console.log(`  цикл сериализации: ${(serialize(sim).length / 1024).toFixed(0)} КБ, население ${pop1}`);
}

// ---------------------------------------------------------------- Диалоги и облачка (фаза 11)
{
  console.log('\n=== Диалоги: банк реплик, структура разговоров, облачка ===');
  const n = dialogueLineCount();
  check(n >= 1000, `в банке реплик ${n} строк, нужно не меньше 1000`);
  console.log(`  шаблонов реплик: ${n}`);
  const sim = new Simulation({ seedText: 'разговоры', size: 'small' });
  const seen = new Map<number, { who: number; text: string; topic?: string; reply?: boolean }[]>();
  const done: { who: number; text: string; topic?: string; reply?: boolean }[][] = [];
  const lens = new Map<number, number>();
  for (let t = 0; t < TICKS_PER_DAY; t++) {
    sim.step();
    for (const [k, tk] of sim.talks) {
      seen.set(k, [...(tk.history ?? [])]);
      lens.set(k, tk.lines);
    }
    for (const [k, h] of seen) {
      if (sim.talks.has(k)) continue;
      if (h.length === lens.get(k)) done.push(h);
      seen.delete(k);
      lens.delete(k);
    }
  }
  check(done.length >= 30, `слишком мало завершённых разговоров за день: ${done.length}`);
  let bad = 0;
  let replies = 0;
  let total = 0;
  let unresolved = 0;
  const topics = new Set<string>();
  for (const h of done) {
    if (h.length < 3 || h.length > 6) bad++;
    if (h[0].topic !== 'greet') bad++;
    const last = h[h.length - 1].topic;
    if (last !== 'bye' && last !== 'quarrel' && last !== 'makeup') bad++;
    for (const l of h) {
      total++;
      if (l.reply) replies++;
      if (l.text.includes('{') || l.text.includes('}')) unresolved++;
      if (l.topic) topics.add(l.topic);
    }
  }
  check(bad === 0, `разговоров с нарушенной структурой (3–6 реплик, приветствие → … → прощание): ${bad} из ${done.length}`);
  check(replies / Math.max(1, total) >= 0.15, `слишком мало осмысленных ответов: ${replies} из ${total} реплик`);
  check(unresolved === 0, `реплик с неподставленными шаблонами: ${unresolved}`);
  check(topics.size >= 8, `слишком мало разных тем за день: ${[...topics].join(', ')}`);
  console.log(`  разговоров: ${done.length}, реплик ${total}, ответов ${replies}, тем ${topics.size}: ${[...topics].join(', ')}`);
  for (const h of done.slice(0, 2)) for (const l of h) console.log(`    ${l.who}: ${l.text}`);
  // Раскладка облачков: без перекрытий, закреплённые всегда видны, препятствия не перекрываются
  const rng = new RNG(7);
  let overlapFails = 0;
  let pinFails = 0;
  let obstFails = 0;
  for (let iter = 0; iter < 200; iter++) {
    const items: BubbleItem[] = [];
    const cnt = 5 + rng.int(0, 40);
    for (let i = 0; i < cnt; i++) items.push({ id: i, ax: rng.int(0, 1280), ay: rng.int(0, 720), w: 60 + rng.int(0, 160), h: 18 + rng.int(0, 3) * 15, priority: rng.int(0, 100), pinned: i < 3 });
    const obstacles = [{ x: 900, y: 60, w: 360, h: 300 }, { x: 0, y: 0, w: 1280, h: 44 }];
    const placed = layoutBubbles(items, { viewW: 1280, viewH: 720, top: 44, bottom: 48, left: 52, right: 8, limit: 6 + rng.int(0, 8), obstacles });
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];
        if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y && !(a.pinned && b.pinned)) overlapFails++;
      }
    for (const p of placed) {
      if (p.pinned) continue;
      for (const o of obstacles) if (p.x < o.x + o.w && p.x + p.w > o.x && p.y < o.y + o.h && p.y + p.h > o.y) obstFails++;
    }
    for (let i = 0; i < 3; i++) if (!placed.some((p) => p.id === i)) pinFails++;
  }
  check(overlapFails === 0, `перекрывающихся облачков: ${overlapFails}`);
  check(obstFails === 0, `облачков поверх окон: ${obstFails}`);
  check(pinFails === 0, `закреплённые облачка пропали: ${pinFails}`);
  console.log('  раскладка облачков: 200 случайных сцен без перекрытий');
}

if (warnings) console.log(`\nПредупреждений: ${warnings}`);
console.log(failures === 0 ? '\nВсе проверки пройдены.' : `\nПровалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
