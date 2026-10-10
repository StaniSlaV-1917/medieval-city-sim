// Headless-тест: генерация нескольких городов, прогон симуляции, проверка инвариантов.
import { Simulation } from '../src/sim/game';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../src/core/time';
import { idx, isWalkableAt } from '../src/world/world';
import { CitizenState } from '../src/sim/citizen';
import type { CitySize } from '../src/world/generator';

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
function check(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.error('  ✗ ' + msg);
  }
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
  for (let t = 0; t < totalTicks; t++) {
    sim.step();
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
  const st = sim.stats;
  console.log(`  население ${popEnd}, деньги ${money1.toFixed(0)}, ср. сытость ${st.avgHunger.toFixed(0)}, ср. здоровье ${st.avgHealth.toFixed(0)}, макс. застревание ${maxStuck} тиков`);
  console.log(`  событий в хронике: ${sim.chronicle.events.length}; A*: ${sim.pathfinder.stats.searches} поисков, ${sim.pathfinder.stats.cacheHits} из кэша`);
  for (const e of sim.chronicle.events.slice(-5)) console.log(`    · ${e.text}`);
}

console.log(failures === 0 ? '\nВсе проверки пройдены.' : `\nПровалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
