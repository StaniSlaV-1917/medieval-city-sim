// Денежные операции: деньги только переходят из рук в руки.
import type { Simulation } from '../sim/game';
import { Citizen } from '../sim/citizen';

export function pay(sim: Simulation, from: Citizen, to: Citizen, amount: number): boolean {
  if (amount <= 0) return true;
  if (from.money < amount) return false;
  from.money -= amount;
  to.money += amount;
  void sim;
  return true;
}

export function payTreasury(sim: Simulation, from: Citizen, amount: number): boolean {
  if (from.money < amount) return false;
  from.money -= amount;
  sim.treasury += amount;
  return true;
}

/** Деньги домохозяйства (свои + членов семьи, живущих в том же доме) */
export function householdMoney(sim: Simulation, c: Citizen): number {
  let sum = c.money;
  if (c.home < 0) return sum;
  const home = sim.world.buildings[c.home];
  for (const id of home.residents) {
    if (id === c.id) continue;
    const o = sim.citizens[id];
    if (!o || !o.alive) continue;
    if (isFamily(c, o)) sum += o.money;
  }
  return sum;
}

export function isFamily(a: Citizen, b: Citizen): boolean {
  return a.spouse === b.id || a.children.includes(b.id) || a.parents.includes(b.id) || b.children.includes(a.id) || b.parents.includes(a.id);
}

/** Заплатить из семейного кошелька: сначала свои деньги, затем семьи */
export function householdPay(sim: Simulation, c: Citizen, to: Citizen | null, amount: number): boolean {
  if (householdMoney(sim, c) < amount) return false;
  let left = amount;
  const take = Math.min(c.money, left);
  c.money -= take;
  left -= take;
  if (left > 0 && c.home >= 0) {
    const home = sim.world.buildings[c.home];
    for (const id of home.residents) {
      if (left <= 0) break;
      if (id === c.id) continue;
      const o = sim.citizens[id];
      if (!o || !o.alive || !isFamily(c, o)) continue;
      const t = Math.min(o.money, left);
      o.money -= t;
      left -= t;
    }
  }
  const paid = amount - left;
  if (to) to.money += paid;
  else sim.treasury += paid;
  return true;
}
