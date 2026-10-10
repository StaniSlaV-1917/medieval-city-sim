// Налоги: подушный и на богатство. Деньги уходят в казну, из казны платят жалованье.
import type { Simulation } from '../sim/game';
import { isChild, Profession } from '../sim/citizen';

export function collectTaxes(sim: Simulation): number {
  let total = 0;
  const rate = sim.taxRate; // 0..0.3, по умолчанию 0.1
  for (const c of sim.citizens) {
    if (!c.alive || isChild(c)) continue;
    if (c.profession === Profession.Beggar) continue;
    let tax = 0;
    // подушный: 1 монета при 10% ставке, пропорционально ставке
    if (c.money >= 15) tax += Math.max(1, Math.round(rate * 10));
    // на богатство: доля от денег сверх 60
    if (c.money > 150) tax += Math.floor((c.money - 150) * rate);
    if (c.profession === Profession.Lord) tax = Math.floor(Math.max(0, c.money - 500) * 0.05);
    tax = Math.min(tax, c.money);
    if (tax > 0) {
      c.money -= tax;
      total += tax;
      c.actionData.taxPaid = tax;
    }
  }
  // пожертвования собора — тоже в казну города (содержание клира)
  for (const b of sim.world.buildings) {
    const m = b.storage['money'] ?? 0;
    if (m > 0) {
      total += m;
      b.storage['money'] = 0;
    }
  }
  sim.treasury += total;
  sim.lastTax = total;
  // Богадельня: беднякам без средств — по монете из казны (монастырская раздача)
  let charity = 0;
  for (const c of sim.citizens) {
    if (!c.alive || isChild(c) || c.money >= 3) continue;
    if (sim.treasury < 50) break;
    const give = sim.treasury > 800 ? 2 : 1;
    sim.treasury -= give;
    c.money += give;
    charity++;
  }
  sim.lastCharity = charity;
  // Доля лорда от сборов
  const lord = sim.citizens.find((c) => c.alive && c.profession === Profession.Lord);
  if (lord) {
    const share = Math.round(total * 0.1);
    if (sim.treasury >= share) {
      sim.treasury -= share;
      lord.money += share;
    }
  }
  return total;
}
