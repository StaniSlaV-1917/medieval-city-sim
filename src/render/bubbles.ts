// Облачки реплик и мыслей: приоритеты по зуму, раскладка без перекрытий, хвостик к говорящему,
// чёткий текст на DPR-холсте, перенос строк, пергаментная рамка, плавное появление, значки эмоций.
import type { Renderer } from './renderer';
import type { Simulation } from '../sim/game';
import { TILE } from './camera';
import { layoutBubbles, BubbleItem, PlacedBubble } from './bubbleLayout';
import { CitizenState } from '../sim/citizen';

interface Draw extends PlacedBubble {
  lines: string[];
  thought: boolean;
  alpha: number;
  emo: string;
  icon: boolean;
  lineH: number;
  font: string;
}

const wrapCache = new Map<string, string[]>();
const EVENT_ACTIONS = new Set(['fight', 'flee', 'fainted', 'arrest', 'chase', 'steal', 'burgle', 'extinguish', 'riot', 'protest', 'raid', 'arson', 'panic', 'carried', 'guard_fight', 'defend']);

export function wrapText(g: CanvasRenderingContext2D, text: string, font: string, maxW: number, maxLines = 3): string[] {
  const key = `${font}|${maxW}|${text}`;
  const c = wrapCache.get(key);
  if (c) return c;
  if (wrapCache.size > 600) wrapCache.clear();
  g.font = font;
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (g.measureText(t).width <= maxW || !cur) cur = t;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last.length > 1 && g.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  wrapCache.set(key, lines);
  return lines;
}

/** Эмоция по тексту, если симуляция её не задала */
function inferEmo(text: string): string {
  if (/ха-ха|хе-хе|умора/i.test(text)) return 'laugh';
  if (/пожар|горит|спасайся|беги|разбойник|дракон|помогите|караул/i.test(text)) return 'fear';
  if (/!$/.test(text) && /держи|вор|стой|прочь|отстань|убью|ненавиж/i.test(text)) return 'angry';
  if (/\?$/.test(text)) return 'question';
  return 'none';
}

export function drawBubbles(g: CanvasRenderingContext2D, r: Renderer, sim: Simulation, opts: { density: number; favorites: number[]; viewW: number; viewH: number; topInset: number; bottomInset: number; obstacles: { x: number; y: number; w: number; h: number }[] }): void {
  const cam = r.camera;
  const z = cam.zoom;
  if (z < 0.6) return;
  const a = r.alpha;
  const textMode = z >= 1.2;
  const fontPx = z < 2 ? 11 : z < 3.5 ? 12 : z < 5 ? 13 : 14;
  const font = `${fontPx}px Georgia, "Times New Roman", serif`;
  const fontI = `italic ${fontPx}px Georgia, "Times New Roman", serif`;
  const lineH = fontPx + 3;
  const maxW = Math.round(Math.max(150, Math.min(230, 130 + z * 18)));
  const limit = Math.round((z < 2.5 ? 6 : 14) * opts.density);
  const selected = r.selectedCitizen;
  const favs = new Set(opts.favorites);
  const view = cam.viewRect();
  const cx = opts.viewW / 2;
  const cy = opts.viewH / 2;
  const maxDist = Math.hypot(cx, cy) || 1;
  const items: BubbleItem[] = [];
  const meta = new Map<number, { lines: string[]; thought: boolean; alpha: number; emo: string; icon: boolean }>();
  const now = sim.tick + a;
  const selTalk = selected >= 0 ? sim.citizens[selected]?.talkingTo ?? -1 : -1;
  for (const c of sim.citizens) {
    if (!c.alive || c.inside >= 0 || !c.speech) continue;
    const sp = c.speech;
    const pinned = c.id === selected || favs.has(c.id);
    if (!textMode && !pinned) continue;
    const px = c.px + (c.x - c.px) * a;
    const py = c.py + (c.y - c.py) * a;
    const wx = (px + 0.5) * TILE;
    const wy = (py + 0.5) * TILE;
    if (wx < view.x0 - 32 || wx > view.x1 + 32 || wy < view.y0 - 32 || wy > view.y1 + 32) continue;
    const s = cam.worldToScreen(wx, wy - 13);
    // плавное появление и исчезание
    const left = sp.until - now;
    const age = now - (sp.from ?? sp.until - 40);
    const alpha = Math.max(0, Math.min(1, age / 3, left / 6));
    if (alpha <= 0) continue;
    let priority: number;
    const dist = Math.hypot(s.x - cx, s.y - cy) / maxDist;
    if (c.id === selected) priority = 100;
    else if (favs.has(c.id)) priority = 90;
    else if (c.id === selTalk) priority = 80;
    else if (EVENT_ACTIONS.has(c.action) || sp.emo === 'fear' || sp.emo === 'angry') priority = 60 - dist * 10;
    else if (c.state === CitizenState.Talking) priority = 40 - dist * 20;
    else priority = 10 - dist * 10;
    const icon = !textMode;
    let lines: string[] = [];
    let w = 14;
    let h = 12;
    if (!icon) {
      lines = wrapText(g, sp.text, sp.thought ? fontI : font, maxW);
      g.font = sp.thought ? fontI : font;
      let tw = 0;
      for (const l of lines) tw = Math.max(tw, g.measureText(l).width);
      const emo = sp.emo ?? inferEmo(sp.text);
      const iconW = emo !== 'none' && !sp.thought ? 14 : 0;
      w = Math.ceil(tw) + 14 + iconW;
      h = lines.length * lineH + 8;
      meta.set(c.id, { lines, thought: sp.thought, alpha, emo, icon });
    } else meta.set(c.id, { lines, thought: sp.thought, alpha, emo: sp.emo ?? 'none', icon });
    items.push({ id: c.id, ax: Math.round(s.x), ay: Math.round(s.y), w, h, priority, pinned });
  }
  if (!items.length) return;
  const placed = layoutBubbles(items, { viewW: opts.viewW, viewH: opts.viewH, top: opts.topInset, bottom: opts.bottomInset, left: 52, right: 8, limit, obstacles: opts.obstacles });
  g.textBaseline = 'alphabetic';
  for (const p of placed) {
    const m = meta.get(p.id)!;
    const d: Draw = { ...p, ...m, lineH, font: m.thought ? fontI : font };
    if (d.icon) drawIcon(g, d);
    else drawBubble(g, d);
  }
  g.globalAlpha = 1;
  g.setLineDash([]);
}

function drawIcon(g: CanvasRenderingContext2D, d: Draw): void {
  g.globalAlpha = 0.9 * d.alpha;
  const x = d.x;
  const y = d.y;
  g.fillStyle = 'rgba(250,246,236,0.97)';
  g.strokeStyle = 'rgba(60,40,20,0.85)';
  g.lineWidth = 1;
  roundRect(g, x + 0.5, y + 0.5, d.w - 1, d.h - 1, 3);
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(d.ax - 2, y + d.h);
  g.lineTo(d.ax, d.ay);
  g.lineTo(d.ax + 2, y + d.h);
  g.closePath();
  g.fill();
  g.fillStyle = emoColor(d.emo);
  g.fillRect(x + 4, y + 4, 3, 3);
  g.fillRect(x + 8, y + 4, 3, 3);
  g.fillRect(x + 6, y + 8, 3, 2);
}

function emoColor(e: string): string {
  switch (e) {
    case 'angry': return '#b0301e';
    case 'fear': return '#6a3a9a';
    case 'love': return '#d04a7a';
    case 'sad': return '#3a5a9a';
    case 'happy': case 'laugh': return '#c89a20';
    default: return '#5a4630';
  }
}

function drawBubble(g: CanvasRenderingContext2D, d: Draw): void {
  const { x, y, w, h } = d;
  g.globalAlpha = 0.95 * d.alpha;
  g.lineWidth = 1;
  if (d.thought) {
    g.fillStyle = 'rgba(238,233,220,0.93)';
    g.strokeStyle = 'rgba(90,70,40,0.7)';
    g.setLineDash([3, 2]);
    roundRect(g, x + 0.5, y + 0.5, w - 1, h - 1, 8);
    g.fill();
    g.stroke();
    g.setLineDash([]);
    // пузырьки к голове
    const tx = Math.max(x + 8, Math.min(x + w - 8, d.ax));
    const steps = 2;
    for (let i = 1; i <= steps; i++) {
      const t = i / (steps + 1);
      const bx = tx + (d.ax - tx) * t;
      const by = y + h + (d.ay - y - h) * t;
      g.beginPath();
      g.arc(bx, by, 2.2 - i * 0.6, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  } else {
    // пергаментная рамка: тень, заливка, тёмная кромка и тонкая золотая линия внутри
    g.fillStyle = 'rgba(0,0,0,0.18)';
    roundRect(g, x + 1.5, y + 2.5, w, h, 5);
    g.fill();
    g.fillStyle = 'rgba(250,246,236,0.97)';
    g.strokeStyle = 'rgba(60,40,20,0.9)';
    roundRect(g, x + 0.5, y + 0.5, w - 1, h - 1, 5);
    g.fill();
    // хвостик к говорящему
    const tx = Math.max(x + 8, Math.min(x + w - 8, d.ax));
    g.beginPath();
    g.moveTo(tx - 4, y + h - 0.5);
    g.lineTo(d.ax, d.ay);
    g.lineTo(tx + 4, y + h - 0.5);
    g.closePath();
    g.fill();
    g.stroke();
    roundRect(g, x + 0.5, y + 0.5, w - 1, h - 1, 5);
    g.stroke();
    // закрыть шов хвостика
    g.fillStyle = 'rgba(250,246,236,0.97)';
    g.fillRect(tx - 3.5, y + h - 1.5, 7, 1.5);
    g.strokeStyle = 'rgba(201,162,64,0.55)';
    roundRect(g, x + 2.5, y + 2.5, w - 5, h - 5, 3);
    g.stroke();
  }
  let tx0 = x + 7;
  if (d.emo !== 'none' && !d.thought) {
    drawEmo(g, d.emo, x + 9, y + 3 + d.lineH / 2 + 1);
    tx0 += 14;
  }
  g.font = d.font;
  g.fillStyle = d.thought ? '#4a3a2a' : '#2a1a0e';
  for (let i = 0; i < d.lines.length; i++) g.fillText(d.lines[i], tx0, y + 4 + d.lineH * (i + 1) - 4);
}

/** Значок эмоции 10px: лицо/сердце/знак */
function drawEmo(g: CanvasRenderingContext2D, e: string, cx: number, cy: number): void {
  const r = 5;
  g.lineWidth = 1;
  if (e === 'love') {
    g.fillStyle = '#d04a7a';
    g.beginPath();
    g.moveTo(cx, cy + 4);
    g.bezierCurveTo(cx - 7, cy - 1, cx - 4, cy - 6, cx, cy - 2);
    g.bezierCurveTo(cx + 4, cy - 6, cx + 7, cy - 1, cx, cy + 4);
    g.fill();
    return;
  }
  const face = e === 'angry' ? '#e07060' : e === 'sad' ? '#9ab0d8' : e === 'fear' ? '#b090d8' : e === 'question' ? '#d6c4a0' : '#f0c850';
  g.fillStyle = face;
  g.strokeStyle = '#3a2a1a';
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#2a1a0e';
  if (e === 'question' || e === 'fear') {
    g.font = 'bold 8px Georgia, serif';
    g.fillText(e === 'fear' ? '!' : '?', cx - 2, cy + 3);
    return;
  }
  g.fillRect(cx - 3, cy - 2, 1.5, 1.5);
  g.fillRect(cx + 1.5, cy - 2, 1.5, 1.5);
  g.beginPath();
  if (e === 'happy') g.arc(cx, cy + 0.5, 2.5, 0.2, Math.PI - 0.2);
  else if (e === 'laugh') {
    g.arc(cx, cy + 0.5, 2.8, 0, Math.PI);
    g.fill();
    return;
  } else if (e === 'sad') g.arc(cx, cy + 4, 2.5, Math.PI + 0.3, Math.PI * 2 - 0.3);
  else if (e === 'angry') {
    g.moveTo(cx - 2.5, cy + 2.5);
    g.lineTo(cx + 2.5, cy + 2.5);
    g.moveTo(cx - 3.5, cy - 3.5);
    g.lineTo(cx - 1, cy - 2.2);
    g.moveTo(cx + 3.5, cy - 3.5);
    g.lineTo(cx + 1, cy - 2.2);
  }
  g.stroke();
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
