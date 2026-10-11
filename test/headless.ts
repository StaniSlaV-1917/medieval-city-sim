// Headless-тест: генерация нескольких городов, прогон симуляции, проверка инвариантов.
import { Simulation } from '../src/sim/game';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../src/core/time';
import { idx, isWalkableAt } from '../src/world/world';
import { CitizenState } from '../src/sim/citizen';
import type { CitySize } from '../src/world/generator';
import { collectStats as collectStatsNow } from '../src/sim/stats';
import { serialize, deserialize } from '../src/save/save';
import { readFileSync } from 'node:fs';
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

if (warnings) console.log(`\nПредупреждений: ${warnings} (мягкие инварианты, станут строгими в фазе 12)`);
console.log(failures === 0 ? '\nВсе проверки пройдены.' : `\nПровалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
