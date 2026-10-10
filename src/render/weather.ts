// Погодные эффекты: дождь, снег, туман, молния.
import type { Renderer } from './renderer';
import type { Simulation } from '../sim/game';

interface Drop {
  x: number;
  y: number;
  v: number;
  len: number;
  drift: number;
}
let drops: Drop[] = [];
let flakes: Drop[] = [];
let flash = 0;

export function drawWeather(g: CanvasRenderingContext2D, r: Renderer, sim: Simulation, dt: number): void {
  const w = sim.weather;
  const W = r.canvas.width;
  const H = r.canvas.height;
  // Туман
  if (w.fog > 0.05) {
    g.fillStyle = `rgba(210,215,222,${0.45 * w.fog})`;
    g.fillRect(0, 0, W, H);
  }
  // Дождь
  const rainK = w.snow > 0 ? 0 : w.rain;
  const wantDrops = Math.floor(rainK * 350 * (W * H) / (1400 * 900));
  while (drops.length < wantDrops) drops.push({ x: Math.random() * W, y: Math.random() * H, v: 700 + Math.random() * 400, len: 8 + Math.random() * 10, drift: 0 });
  if (drops.length > wantDrops) drops.length = wantDrops;
  if (drops.length) {
    g.strokeStyle = 'rgba(190,210,240,0.45)';
    g.lineWidth = 1;
    g.beginPath();
    const dx = Math.cos(w.windDir) * w.wind * 200;
    for (const d of drops) {
      d.y += d.v * dt;
      d.x += dx * dt;
      if (d.y > H) {
        d.y = -20;
        d.x = Math.random() * W;
      }
      if (d.x > W) d.x -= W;
      if (d.x < 0) d.x += W;
      g.moveTo(d.x, d.y);
      g.lineTo(d.x + dx * 0.02, d.y + d.len);
    }
    g.stroke();
    // пелена
    g.fillStyle = `rgba(80,100,130,${0.12 * rainK})`;
    g.fillRect(0, 0, W, H);
  }
  // Снег
  const wantFlakes = Math.floor(w.snow * 260 * (W * H) / (1400 * 900));
  while (flakes.length < wantFlakes) flakes.push({ x: Math.random() * W, y: Math.random() * H, v: 40 + Math.random() * 50, len: 1 + Math.random() * 2, drift: Math.random() * 6.28 });
  if (flakes.length > wantFlakes) flakes.length = wantFlakes;
  if (flakes.length) {
    g.fillStyle = 'rgba(255,255,255,0.85)';
    const dx = Math.cos(w.windDir) * w.wind * 60;
    for (const f of flakes) {
      f.drift += dt;
      f.y += f.v * dt;
      f.x += (dx + Math.sin(f.drift * 2) * 15) * dt;
      if (f.y > H) {
        f.y = -5;
        f.x = Math.random() * W;
      }
      if (f.x > W) f.x -= W;
      if (f.x < 0) f.x += W;
      g.fillRect(f.x, f.y, f.len, f.len);
    }
  }
  // Молния
  if (sim.lightningFlash > 0) {
    flash = 1;
    sim.lightningFlash = 0;
  }
  if (flash > 0) {
    g.fillStyle = `rgba(255,255,255,${flash * 0.7})`;
    g.fillRect(0, 0, W, H);
    flash -= dt * 4;
  }
}
