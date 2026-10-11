// Стартовая сцена: сторожевая башня с реющим флагом, солнце, река с мостом и опушка леса.
// Всё рисуется процедурно на канвасе и живёт: флаг развевается, вода бежит, облака плывут, дым идёт.
import { hash2 } from '../render/atlas';

export class StartScene {
  canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private t0 = performance.now();
  private raf = 0;
  private running = true;
  private trees: { x: number; y: number; s: number; pine: boolean; shade: number }[] = [];
  private clouds: { x: number; y: number; w: number; v: number }[] = [];
  private birds: { x: number; y: number; v: number; ph: number }[] = [];

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'scene';
    this.canvas.width = 640;
    this.canvas.height = 480;
    parent.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;
    // лес на дальнем берегу: ряды деревьев с перспективой
    for (let row = 0; row < 4; row++)
      for (let k = 0; k < 26; k++) {
        const x = -20 + k * 27 + hash2(k, row, 1) * 18;
        const y = 198 + row * 9 + hash2(k, row, 2) * 6;
        const s = 0.55 + row * 0.12 + hash2(k, row, 3) * 0.2;
        this.trees.push({ x, y, s, pine: hash2(k, row, 4) > 0.55, shade: 0.75 + row * 0.08 });
      }
    this.trees.sort((a, b) => a.y - b.y);
    for (let k = 0; k < 5; k++) this.clouds.push({ x: k * 150 + hash2(k, 9, 1) * 80, y: 40 + hash2(k, 9, 2) * 60, w: 70 + hash2(k, 9, 3) * 60, v: 4 + hash2(k, 9, 4) * 5 });
    for (let k = 0; k < 4; k++) this.birds.push({ x: 100 + k * 120, y: 70 + k * 15, v: 14 + k * 3, ph: k * 1.7 });
    this.frame();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame = (): void => {
    if (!this.running) return;
    const t = (performance.now() - this.t0) / 1000;
    this.draw(t);
    this.raf = requestAnimationFrame(this.frame);
  };

  private draw(t: number): void {
    const g = this.g;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.imageSmoothingEnabled = false;
    // Небо
    const sky = g.createLinearGradient(0, 0, 0, 230);
    sky.addColorStop(0, '#7fb2e0');
    sky.addColorStop(1, '#d8e8f2');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, 240);
    // Солнце с лучами
    const sx = 500;
    const sy = 78;
    g.save();
    g.translate(sx, sy);
    g.rotate(t * 0.05);
    for (let k = 0; k < 12; k++) {
      g.rotate(Math.PI / 6);
      g.fillStyle = 'rgba(255,236,160,0.35)';
      g.beginPath();
      g.moveTo(0, -30);
      g.lineTo(5, -62 - Math.sin(t * 2 + k) * 4);
      g.lineTo(-5, -62 - Math.sin(t * 2 + k) * 4);
      g.closePath();
      g.fill();
    }
    g.restore();
    const glow = g.createRadialGradient(sx, sy, 10, sx, sy, 70);
    glow.addColorStop(0, 'rgba(255,240,190,0.9)');
    glow.addColorStop(1, 'rgba(255,240,190,0)');
    g.fillStyle = glow;
    g.fillRect(sx - 70, sy - 70, 140, 140);
    g.fillStyle = '#fff2a8';
    g.beginPath();
    g.arc(sx, sy, 24, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fffbe0';
    g.beginPath();
    g.arc(sx - 6, sy - 6, 10, 0, Math.PI * 2);
    g.fill();
    // Облака
    for (const c of this.clouds) {
      const x = ((c.x + t * c.v) % (W + 200)) - 100;
      g.fillStyle = 'rgba(255,255,255,0.9)';
      for (let k = 0; k < 4; k++) {
        g.beginPath();
        g.arc(x + k * (c.w / 4), c.y + (k % 2) * 6, 14 + (k % 3) * 5, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = 'rgba(200,215,230,0.8)';
      g.fillRect(x - 8, c.y + 12, c.w + 10, 6);
    }
    // Птицы
    g.strokeStyle = '#3a4a5a';
    g.lineWidth = 1.5;
    for (const b of this.birds) {
      const x = ((b.x + t * b.v) % (W + 60)) - 30;
      const y = b.y + Math.sin(t * 1.3 + b.ph) * 6;
      const f = Math.sin(t * 6 + b.ph) * 3;
      g.beginPath();
      g.moveTo(x - 5, y - f);
      g.lineTo(x, y);
      g.lineTo(x + 5, y - f);
      g.stroke();
    }
    // Дальние холмы
    g.fillStyle = '#8fb08a';
    g.beginPath();
    g.moveTo(0, 215);
    for (let x = 0; x <= W; x += 16) g.lineTo(x, 200 + Math.sin(x / 70) * 8 + Math.sin(x / 23) * 3);
    g.lineTo(W, 240);
    g.lineTo(0, 240);
    g.fill();
    // Лес на дальнем берегу
    for (const tr of this.trees) this.tree(tr.x, tr.y, tr.s, tr.pine, tr.shade, t);
    // Луг до реки
    g.fillStyle = '#6ea052';
    g.fillRect(0, 232, W, 70);
    g.fillStyle = '#7ab05c';
    for (let k = 0; k < 90; k++) {
      const x = hash2(k, 5, 1) * W;
      const y = 236 + hash2(k, 5, 2) * 60;
      g.fillRect(x, y, 2, 3);
    }
    // Река с бегущей водой
    const ry0 = 300;
    const ry1 = 372;
    const water = g.createLinearGradient(0, ry0, 0, ry1);
    water.addColorStop(0, '#5a94c8');
    water.addColorStop(1, '#3c6ea8');
    g.fillStyle = water;
    g.beginPath();
    g.moveTo(0, ry0 + 6);
    for (let x = 0; x <= W; x += 16) g.lineTo(x, ry0 + Math.sin(x / 90 + 1) * 6);
    g.lineTo(W, ry1 + 4);
    for (let x = W; x >= 0; x -= 16) g.lineTo(x, ry1 + Math.sin(x / 110) * 5);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(220,240,255,0.55)';
    for (let k = 0; k < 40; k++) {
      const x = ((hash2(k, 7, 1) * W + t * (25 + hash2(k, 7, 2) * 30)) % (W + 40)) - 20;
      const y = ry0 + 8 + hash2(k, 7, 3) * (ry1 - ry0 - 16);
      g.fillRect(x, y, 10 + hash2(k, 7, 4) * 12, 1.5);
    }
    // Берега
    g.fillStyle = '#c9b27a';
    g.fillRect(0, ry0 - 3, W, 5);
    g.fillRect(0, ry1 - 1, W, 6);
    g.fillStyle = '#5c8a42';
    for (let k = 0; k < 30; k++) g.fillRect(hash2(k, 8, 1) * W, ry1 + 2 + hash2(k, 8, 2) * 4, 2, 4);
    // Мост через реку
    const bx = 330;
    g.fillStyle = '#6b4a2a';
    g.fillRect(bx, ry0 - 12, 70, 6);
    g.fillStyle = '#8a6238';
    g.fillRect(bx - 4, ry0 - 8, 78, 10);
    g.fillStyle = '#5a3a1a';
    for (let k = 0; k < 8; k++) g.fillRect(bx + 2 + k * 9, ry0 - 8, 2, 10);
    // опоры с арками
    g.fillStyle = '#7a7268';
    g.fillRect(bx + 8, ry0 + 2, 10, ry1 - ry0 - 2);
    g.fillRect(bx + 52, ry0 + 2, 10, ry1 - ry0 - 2);
    g.fillStyle = '#3c6ea8';
    g.beginPath();
    g.arc(bx + 35, ry0 + 14, 14, Math.PI, 0);
    g.fill();
    g.fillStyle = '#8a8278';
    g.fillRect(bx + 8, ry0 + 2, 10, 2);
    g.fillRect(bx + 52, ry0 + 2, 10, 2);
    // дорога к мосту
    g.fillStyle = '#b9a07a';
    g.beginPath();
    g.moveTo(bx + 20, ry1 + 4);
    g.lineTo(bx + 50, ry1 + 4);
    g.lineTo(bx + 120, H);
    g.lineTo(bx - 60, H);
    g.closePath();
    g.fill();
    g.fillStyle = '#a08a68';
    for (let k = 0; k < 30; k++) g.fillRect(bx - 40 + hash2(k, 11, 1) * 150, ry1 + 10 + hash2(k, 11, 2) * 90, 3, 1);
    // Ближний берег: трава
    g.fillStyle = '#5f9448';
    g.fillRect(0, ry1 + 5, W, H - ry1 - 5);
    g.fillStyle = '#6ea052';
    for (let k = 0; k < 120; k++) {
      const x = hash2(k, 12, 1) * W;
      const y = ry1 + 8 + hash2(k, 12, 2) * (H - ry1 - 12);
      g.fillRect(x, y, 2, 3);
    }
    // Ближний лес справа (начало леса)
    for (let k = 0; k < 9; k++) this.tree(470 + k * 22 + hash2(k, 13, 1) * 10, 392 + hash2(k, 13, 2) * 40, 1.1 + hash2(k, 13, 3) * 0.5, hash2(k, 13, 4) > 0.5, 1, t);
    // Башня с флагом
    this.tower(120, 395, t);
    // Виньетка
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.9);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(20,12,4,0.35)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
  }

  private tree(x: number, y: number, s: number, pine: boolean, shade: number, t: number): void {
    const g = this.g;
    const sway = Math.sin(t * 1.2 + x * 0.05) * 1.5 * s;
    g.fillStyle = `rgb(${Math.round(90 * shade)},${Math.round(60 * shade)},${Math.round(30 * shade)})`;
    g.fillRect(x - 2 * s, y - 14 * s, 4 * s, 14 * s);
    if (pine) {
      const c = `rgb(${Math.round(40 * shade)},${Math.round(100 * shade)},${Math.round(60 * shade)})`;
      g.fillStyle = c;
      for (let k = 0; k < 3; k++) {
        const w = (18 - k * 4) * s;
        const yy = y - 10 * s - k * 10 * s;
        g.beginPath();
        g.moveTo(x - w / 2 + sway * 0.3, yy);
        g.lineTo(x + sway, yy - 14 * s);
        g.lineTo(x + w / 2 + sway * 0.3, yy);
        g.closePath();
        g.fill();
      }
    } else {
      const c = `rgb(${Math.round(70 * shade)},${Math.round(140 * shade)},${Math.round(70 * shade)})`;
      const c2 = `rgb(${Math.round(95 * shade)},${Math.round(165 * shade)},${Math.round(85 * shade)})`;
      g.fillStyle = c;
      g.beginPath();
      g.arc(x - 6 * s + sway, y - 18 * s, 9 * s, 0, Math.PI * 2);
      g.arc(x + 6 * s + sway, y - 18 * s, 9 * s, 0, Math.PI * 2);
      g.arc(x + sway, y - 26 * s, 10 * s, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = c2;
      g.beginPath();
      g.arc(x - 3 * s + sway, y - 28 * s, 5 * s, 0, Math.PI * 2);
      g.fill();
    }
  }

  private tower(x: number, baseY: number, t: number): void {
    const g = this.g;
    const w = 64;
    const h = 170;
    // холм под башней
    g.fillStyle = '#56883f';
    g.beginPath();
    g.ellipse(x + w / 2, baseY + 6, 110, 26, 0, 0, Math.PI * 2);
    g.fill();
    // каменная кладка
    g.fillStyle = '#9a9288';
    g.fillRect(x, baseY - h, w, h);
    g.fillStyle = '#7e766c';
    g.fillRect(x + w - 14, baseY - h, 14, h);
    for (let r = 0; r < h / 8; r++) {
      const off = r % 2 ? 6 : 0;
      for (let c = 0; c < w / 12 + 1; c++) {
        const bx = x + off + c * 12;
        if (bx + 11 > x + w) continue;
        g.fillStyle = hash2(r, c, 3) > 0.5 ? '#8f877d' : '#a39b91';
        if (bx + 11 > x + w - 14) g.fillStyle = hash2(r, c, 3) > 0.5 ? '#75706a' : '#847d75';
        g.fillRect(bx, baseY - h + r * 8, 11, 7);
      }
    }
    // зубцы
    g.fillStyle = '#a8a096';
    for (let k = 0; k < 5; k++) g.fillRect(x - 4 + k * 16, baseY - h - 14, 10, 14);
    g.fillStyle = '#8a8278';
    g.fillRect(x - 4, baseY - h - 2, w + 8, 4);
    // ворота и окна
    g.fillStyle = '#3a2a1a';
    g.beginPath();
    g.arc(x + 26, baseY - 14, 11, Math.PI, 0);
    g.fill();
    g.fillRect(x + 15, baseY - 14, 22, 14);
    g.fillStyle = '#2a1a0a';
    for (let k = 0; k < 3; k++) {
      g.fillRect(x + 28, baseY - 60 - k * 42, 5, 12);
      g.beginPath();
      g.arc(x + 30.5, baseY - 60 - k * 42, 2.5, Math.PI, 0);
      g.fill();
    }
    // свет в окне (тёплый)
    g.fillStyle = `rgba(255,200,90,${0.6 + Math.sin(t * 3) * 0.1})`;
    g.fillRect(x + 29, baseY - 101, 3, 8);
    // дым из трубы
    g.fillStyle = '#5a5048';
    g.fillRect(x + 48, baseY - h - 24, 7, 12);
    for (let k = 0; k < 6; k++) {
      const ph = (t * 0.5 + k * 0.17) % 1;
      const sx = x + 51 + Math.sin((t + k) * 1.5) * 4 + ph * 10;
      const sy = baseY - h - 28 - ph * 50;
      g.fillStyle = `rgba(230,230,230,${(1 - ph) * 0.5})`;
      g.beginPath();
      g.arc(sx, sy, 3 + ph * 7, 0, Math.PI * 2);
      g.fill();
    }
    // флагшток и реющий флаг
    const px = x + 12;
    const py = baseY - h - 14;
    g.fillStyle = '#4a3220';
    g.fillRect(px, py - 56, 3, 56);
    g.fillStyle = '#d9b24a';
    g.fillRect(px - 1, py - 59, 5, 4);
    const fl = 44;
    const fh = 22;
    for (let i = 0; i < fl; i++) {
      const ph = i / fl;
      const wave = Math.sin(t * 7 - ph * 7) * (3 + ph * 7);
      const top = py - 54 + wave;
      const hh = fh - ph * 6;
      g.fillStyle = i % 8 < 4 ? '#b8302a' : '#d9b24a';
      g.fillRect(px + 3 + i, top, 1.2, hh);
    }
    // герб — башня на флаге
    const wave0 = Math.sin(t * 7 - 0.5 * 7) * 6.5;
    g.fillStyle = '#f6efe0';
    g.fillRect(px + 20, py - 50 + wave0, 7, 11);
    g.fillStyle = '#5a4630';
    g.fillRect(px + 20, py - 51 + wave0, 2, 2);
    g.fillRect(px + 25, py - 51 + wave0, 2, 2);
  }
}
