// Оверлеи карты: преступность, риск пожара, богатство кварталов.
import type { Renderer } from './renderer';
import type { Simulation } from '../sim/game';
import { TILE } from './camera';
import { BUILDING_DEFS, BuildingType } from '../world/buildings';

export const OVERLAY_NAMES: Record<string, string> = { none: 'Без оверлея', crime: 'Преступность', fire: 'Риск пожара', wealth: 'Богатство', parcels: 'Угодья', fertility: 'Плодородие', resources: 'Ресурсы' };
export type OverlayMode = keyof typeof OVERLAY_NAMES;
export const OVERLAY_ORDER: OverlayMode[] = ['none', 'crime', 'fire', 'wealth', 'parcels', 'fertility', 'resources'];

const PARCEL_COLORS = ['rgba(200,80,80,0.22)', 'rgba(80,140,200,0.22)', 'rgba(200,170,60,0.22)', 'rgba(90,180,90,0.22)', 'rgba(170,90,190,0.22)', 'rgba(60,170,170,0.22)', 'rgba(220,120,60,0.22)', 'rgba(120,120,220,0.22)'];
const RES_COLORS: Record<number, string> = { 1: '#9a9a9a', 2: '#c8603a', 3: '#b06a40', 4: '#f0ece0', 5: '#4a3a2a', 6: '#c03060', 7: '#d8b070', 8: '#60c060', 9: '#4080d0' };

/** Тайловые оверлеи (угодья, плодородие, ресурсы) — рисуются по видимым тайлам */
function drawTileOverlay(g: CanvasRenderingContext2D, mode: OverlayMode, sim: Simulation, view: { x0: number; y0: number; x1: number; y1: number }): void {
  const world = sim.world;
  const tx0 = Math.max(0, Math.floor(view.x0 / TILE));
  const ty0 = Math.max(0, Math.floor(view.y0 / TILE));
  const tx1 = Math.min(world.w - 1, Math.ceil(view.x1 / TILE));
  const ty1 = Math.min(world.h - 1, Math.ceil(view.y1 / TILE));
  for (let y = ty0; y <= ty1; y++)
    for (let x = tx0; x <= tx1; x++) {
      const i = y * world.w + x;
      if (!world.explored[i]) continue;
      if (mode === 'parcels') {
        const p = world.parcel[i];
        g.fillStyle = PARCEL_COLORS[p % PARCEL_COLORS.length];
        g.fillRect(x * TILE, y * TILE, TILE, TILE);
        // граница угодья
        if (x + 1 < world.w && world.parcel[i + 1] !== p) {
          g.fillStyle = 'rgba(40,20,10,0.5)';
          g.fillRect(x * TILE + TILE - 1, y * TILE, 1, TILE);
        }
        if (y + 1 < world.h && world.parcel[i + world.w] !== p) {
          g.fillStyle = 'rgba(40,20,10,0.5)';
          g.fillRect(x * TILE, y * TILE + TILE - 1, TILE, 1);
        }
      } else if (mode === 'fertility') {
        const f = world.fertility[i];
        g.fillStyle = `rgba(${Math.round(200 * (1 - f))},${Math.round(60 + 160 * f)},40,0.4)`;
        g.fillRect(x * TILE, y * TILE, TILE, TILE);
      } else if (mode === 'resources') {
        const r = world.resource[i];
        if (!r || !world.discovered[i] || world.resourceAmount[i] <= 0) continue;
        g.fillStyle = RES_COLORS[r] ?? '#fff';
        g.globalAlpha = 0.75;
        g.fillRect(x * TILE + 4, y * TILE + 4, 8, 8);
        g.globalAlpha = 1;
      }
    }
  if (mode === 'parcels') {
    g.font = 'bold 12px Georgia, serif';
    g.textAlign = 'center';
    for (const p of world.parcels) {
      const px = (p.cx + 0.5) * TILE;
      const py = (p.cy + 0.5) * TILE;
      if (px < view.x0 || px > view.x1 || py < view.y0 || py > view.y1) continue;
      g.fillStyle = 'rgba(250,246,236,0.85)';
      const w = g.measureText(p.name).width + 10;
      g.fillRect(px - w / 2, py - 9, w, 16);
      g.fillStyle = '#2b1d10';
      g.fillText(p.name, px, py + 4);
    }
    g.textAlign = 'left';
  }
}

/** Туман неизведанного: тёмная пелена над неразведанными тайлами */
export function drawFog(g: CanvasRenderingContext2D, sim: Simulation, view: { x0: number; y0: number; x1: number; y1: number }): void {
  const world = sim.world;
  if (!world.fog) return;
  const tx0 = Math.max(0, Math.floor(view.x0 / TILE));
  const ty0 = Math.max(0, Math.floor(view.y0 / TILE));
  const tx1 = Math.min(world.w - 1, Math.ceil(view.x1 / TILE));
  const ty1 = Math.min(world.h - 1, Math.ceil(view.y1 / TILE));
  g.fillStyle = 'rgba(18,22,30,0.93)';
  for (let y = ty0; y <= ty1; y++) {
    let runStart = -1;
    for (let x = tx0; x <= tx1 + 1; x++) {
      const un = x <= tx1 && !world.explored[y * world.w + x];
      if (un && runStart < 0) runStart = x;
      else if (!un && runStart >= 0) {
        g.fillRect(runStart * TILE, y * TILE, (x - runStart) * TILE, TILE);
        runStart = -1;
      }
    }
  }
  // мягкая кромка: полупрозрачная рамка на разведанных тайлах рядом с туманом
  g.fillStyle = 'rgba(18,22,30,0.45)';
  for (let y = ty0; y <= ty1; y++)
    for (let x = tx0; x <= tx1; x++) {
      const i = y * world.w + x;
      if (!world.explored[i]) continue;
      const un = (x > 0 && !world.explored[i - 1]) || (x + 1 < world.w && !world.explored[i + 1]) || (y > 0 && !world.explored[i - world.w]) || (y + 1 < world.h && !world.explored[i + world.w]);
      if (un) g.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
}

export function drawOverlay(g: CanvasRenderingContext2D, r: Renderer, sim: Simulation, view: { x0: number; y0: number; x1: number; y1: number }): void {
  const mode = r.showOverlay;
  if (mode === 'none') return;
  const world = sim.world;
  if (mode === 'parcels' || mode === 'fertility' || mode === 'resources') {
    drawTileOverlay(g, mode, sim, view);
    return;
  }
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
