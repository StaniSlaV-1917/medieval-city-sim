// Оверлеи карты: преступность, риск пожара, богатство кварталов.
import type { Renderer } from './renderer';
import type { Simulation } from '../sim/game';
import { TILE } from './camera';
import { BUILDING_DEFS, BuildingType } from '../world/buildings';

export const OVERLAY_NAMES: Record<string, string> = { none: 'Без оверлея', crime: 'Преступность', fire: 'Риск пожара', wealth: 'Богатство' };

export function drawOverlay(g: CanvasRenderingContext2D, r: Renderer, sim: Simulation, view: { x0: number; y0: number; x1: number; y1: number }): void {
  const mode = r.showOverlay;
  if (mode === 'none') return;
  const world = sim.world;
  if (mode === 'crime') {
    const now = sim.tick;
    g.globalCompositeOperation = 'source-over';
    for (const rec of sim.crimeLog) {
      const age = (now - rec.tick) / 7200;
      if (age > 20) continue;
      const x = rec.x * TILE;
      const y = rec.y * TILE;
      if (x < view.x0 - 64 || x > view.x1 + 64 || y < view.y0 - 64 || y > view.y1 + 64) continue;
      const a = Math.max(0.08, 0.5 * (1 - age / 20));
      const rad = rec.kind === 'burglary' || rec.kind === 'fire' ? 40 : 28;
      const grad = g.createRadialGradient(x, y, 2, x, y, rad);
      grad.addColorStop(0, `rgba(220,30,30,${a})`);
      grad.addColorStop(1, 'rgba(220,30,30,0)');
      g.fillStyle = grad;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    return;
  }
  for (const b of world.buildings) {
    if (b.w === 0) continue;
    const x = b.x * TILE;
    const y = b.y * TILE;
    if (x + b.w * TILE < view.x0 || x > view.x1 || y + b.h * TILE < view.y0 || y > view.y1) continue;
    let color = '';
    if (mode === 'fire') {
      const def = BUILDING_DEFS[b.type];
      let risk = def.fireRisk * 0.5 + (b.material === 'wood' ? 0.3 : b.material === 'timber' ? 0.2 : 0.05) + (b.roof === 'thatch' ? 0.3 : b.roof === 'wood' ? 0.15 : 0);
      for (const o of world.buildings) {
        if ((o.type === BuildingType.Smithy || o.type === BuildingType.Bakery) && Math.abs(o.x - b.x) + Math.abs(o.y - b.y) < 8) risk += 0.2;
      }
      if (sim.weather.rain > 0.3) risk *= 0.6;
      if (sim.season === 1) risk *= 1.2;
      risk = Math.min(1, risk);
      color = `rgba(${Math.round(255 * risk)},${Math.round(200 * (1 - risk))},40,0.55)`;
    } else if (mode === 'wealth') {
      let money = 0;
      let n = 0;
      for (const id of b.residents) {
        const c = sim.citizens[id];
        if (c && c.alive) {
          money += c.money;
          n++;
        }
      }
      if (b.owner >= 0 && sim.citizens[b.owner]?.alive && !b.residents.includes(b.owner)) {
        money += sim.citizens[b.owner].money;
        n++;
      }
      if (n === 0) continue;
      const k = Math.min(1, Math.log10(1 + money / n) / 2.7);
      color = `rgba(${Math.round(60 + 40 * k)},${Math.round(60 + 150 * k)},${Math.round(200 * (1 - k) + 40)},0.55)`;
    }
    if (!color) continue;
    g.fillStyle = color;
    g.fillRect(x, y - 8, b.w * TILE, b.h * TILE + 8);
  }
}
