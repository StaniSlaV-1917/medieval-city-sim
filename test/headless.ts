// Headless-тест: генерация нескольких городов, прогон симуляции, проверка инвариантов.
import { Simulation } from '../src/sim/game';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../src/core/time';
import { idx, isWalkableAt } from '../src/world/world';
import { CitizenState } from '../src/sim/citizen';
import type { CitySize } from '../src/world/generator';
import { collectStats as collectStatsNow } from '../src/sim/stats';
import { serialize, deserialize } from '../src/save/save';
import { readFileSync } from 'node:fs';
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
/** Мягкая проверка: пока только предупреждение (станет ошибкой после балансировки в фазе 12) */
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
  const limit = Math.max(1, Math.round(pop * 0.005));
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
      hungerFaintsCheck(sim, dayEventStart, ds.population, ds.avgHunger, Math.floor(sim.tick / TICKS_PER_DAY), true);
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
  console.log(`  население ${popEnd}, деньги ${money1.toFixed(0)}, ср. сытость ${st.avgHunger.toFixed(0)}, ср. здоровье ${st.avgHealth.toFixed(0)}, макс. застревание ${maxStuck} тиков`);
  console.log(`  событий в хронике: ${sim.chronicle.events.length}; A*: ${sim.pathfinder.stats.searches} поисков, ${sim.pathfinder.stats.cacheHits} из кэша`);
  for (const e of sim.chronicle.events.slice(-5)) console.log(`    · ${e.text}`);
}

// ---------------------------------------------------------------- Сохранения
{
  console.log('\n=== Сохранение: обратная совместимость и цикл сериализации ===');
  const dir = dirname(fileURLToPath(import.meta.url));
  const json = readFileSync(join(dir, 'fixtures', 'save-v1.json'), 'utf8');
  const t0 = Date.now();
  const sim = deserialize(json);
  console.log(`  старый сейв (версия 1, без полей фаз 10+): загружен за ${Date.now() - t0} мс, жителей ${sim.citizens.length}, тик ${sim.tick}`);
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

if (warnings) console.log(`\nПредупреждений: ${warnings} (мягкие инварианты, станут строгими в фазе 12)`);
console.log(failures === 0 ? '\nВсе проверки пройдены.' : `\nПровалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
