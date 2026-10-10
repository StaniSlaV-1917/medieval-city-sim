// Облачка реплик и мыслей над жителями (экранные координаты).
import type { Renderer } from './renderer';
import type { Simulation } from '../sim/game';
import { TILE } from './camera';

export function drawBubbles(g: CanvasRenderingContext2D, r: Renderer, sim: Simulation): void {
  const cam = r.camera;
  const z = cam.zoom;
  if (z < 1.2) return;
  const a = r.alpha;
  g.font = `${Math.max(10, Math.round(11))}px Georgia, "Times New Roman", serif`;
  g.textBaseline = 'bottom';
  const view = cam.viewRect();
  const items: { x: number; y: number; text: string; thought: boolean; frac: number }[] = [];
  for (const c of sim.citizens) {
    if (!c.alive || c.inside >= 0 || !c.speech) continue;
    const cx = c.px + (c.x - c.px) * a;
    const cy = c.py + (c.y - c.py) * a;
    const wx = (cx + 0.5) * TILE;
    const wy = (cy + 0.5) * TILE;
    if (wx < view.x0 || wx > view.x1 || wy < view.y0 || wy > view.y1) continue;
    const left = c.speech.until - sim.tick;
    const frac = Math.min(1, left / 8);
    const s = cam.worldToScreen(wx, wy - 14);
    items.push({ x: s.x, y: s.y, text: c.speech.text, thought: c.speech.thought, frac });
  }
  if (items.length > 60) items.length = 60;
  for (const it of items) {
    const w = g.measureText(it.text).width + 12;
    const h = 18;
    const x = Math.round(it.x - w / 2);
    const y = Math.round(it.y - h);
    g.globalAlpha = 0.92 * Math.max(0.2, it.frac);
    g.fillStyle = it.thought ? 'rgba(236,230,214,0.95)' : 'rgba(250,246,236,0.97)';
    g.strokeStyle = it.thought ? 'rgba(90,70,40,0.6)' : 'rgba(60,40,20,0.85)';
    g.lineWidth = 1;
    roundRect(g, x, y, w, h, 5);
    g.fill();
    g.stroke();
    if (it.thought) {
      g.beginPath();
      g.arc(it.x, y + h + 3, 1.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    } else {
      g.beginPath();
      g.moveTo(it.x - 3, y + h);
      g.lineTo(it.x, y + h + 4);
      g.lineTo(it.x + 3, y + h);
      g.closePath();
      g.fill();
      g.stroke();
    }
    g.fillStyle = '#2a1a0e';
    g.fillText(it.text, x + 6, y + h - 4);
  }
  g.globalAlpha = 1;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}
