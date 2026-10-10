// Налоги: подушный и на богатство. Деньги уходят в казну, из казны платят жалованье.
import type { Simulation } from '../sim/game';
import { isChild, Profession } from '../sim/citizen';
import { BuildingType } from '../world/buildings';

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
    if (c.money > 60) tax += Math.floor((c.money - 60) * rate * 0.5);
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
  // Крестьяне приносят домой часть урожая (своё хозяйство)
  for (const c of sim.citizens) {
    if (!c.alive || c.profession !== Profession.Farmer || c.home < 0) continue;
    const home = sim.world.buildings[c.home];
    home.storage['bread'] = Math.min(40, (home.storage['bread'] ?? 0) + 2);
  }
  // Богадельня: беднякам без средств — по монете из казны (монастырская раздача)
  let charity = 0;
  for (const c of sim.citizens) {
    if (!c.alive || isChild(c) || c.money >= 2) continue;
    if (sim.treasury < 50) break;
    sim.treasury -= 1;
    c.money += 1;
    charity++;
  }
  sim.lastCharity = charity;
  // Лавки закупают сырьё за городом (до появления полных производственных цепочек):
  // пекарни, мясные и таверны тратят часть выручки — деньги уходят из города
  for (const b of sim.world.buildings) {
    const t = b.type;
    if (t !== BuildingType.Bakery && t !== BuildingType.Butcher && t !== BuildingType.Tavern && t !== BuildingType.Merchant) continue;
    const owner = b.owner >= 0 ? sim.citizens[b.owner] : null;
    if (!owner || !owner.alive) continue;
    const spend = Math.floor(Math.max(0, owner.money - 40) * 0.25);
    if (spend > 0) {
      owner.money -= spend;
      sim.moneyDestroyed += spend;
      sim.importCost += spend;
    }
  }
  return total;
}
