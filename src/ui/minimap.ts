import type { Game } from '../main';
import { Tile } from '../world/tiles';
import { TILE } from '../render/camera';
import { OVERLAY_NAMES, OVERLAY_ORDER } from '../render/overlays';

export class Minimap {
  el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private base: HTMLCanvasElement;
  private game: Game;
  private version = -1;
  private scale = 1;
  private ovBtns: HTMLButtonElement[] = [];

  constructor(root: HTMLElement, game: Game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.id = 'minimap';
    this.el.className = 'panel';
    this.el.dataset.fixed = '1';
    const w = game.sim.world.w;
    this.scale = 160 / w;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 160;
    this.canvas.height = 160;
    this.base = document.createElement('canvas');
    this.base.width = w;
    this.base.height = game.sim.world.h;
    const bar = document.createElement('div');
    bar.className = 'ovbar';
    const ovs = OVERLAY_ORDER;
    const labels: Record<string, string> = { none: '—', crime: 'Прест.', fire: 'Пожар', wealth: 'Богат.', parcels: 'Угодья', fertility: 'Почва', resources: 'Ресурсы' };
    for (const o of ovs) {
      const b = document.createElement('button');
      b.className = 'btn ov';
      b.dataset.ov = o;
      b.textContent = labels[o];
      b.dataset.tip = `<b>${OVERLAY_NAMES[o]}</b><br>Оверлей карты (O — переключить по кругу)`;
      b.addEventListener('click', () => {
        game.renderer.showOverlay = o;
      });
      bar.appendChild(b);
      this.ovBtns.push(b);
    }
    this.el.appendChild(bar);
    this.el.appendChild(this.canvas);
    root.appendChild(this.el);
    this.canvas.addEventListener('mousedown', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const tx = ((e.clientX - r.left) / r.width) * w;
      const ty = ((e.clientY - r.top) / r.height) * game.sim.world.h;
      game.renderer.camera.panTo(tx * TILE, ty * TILE);
    });
  }

  private renderBase(): void {
    const sim = this.game.sim;
    const world = sim.world;
    const g = this.base.getContext('2d')!;
    const img = g.createImageData(world.w, world.h);
    const d = img.data;
    const col = (t: number): [number, number, number] => {
      switch (t) {
        case Tile.Water: case Tile.Shallow: case Tile.Lake: return [60, 110, 170];
        case Tile.Swamp: return [70, 95, 80];
        case Tile.Clay: return [170, 110, 70];
        case Tile.IronOre: return [150, 80, 60];
        case Tile.Salt: return [210, 205, 190];
        case Tile.Pasture: return [130, 160, 70];
        case Tile.Road: case Tile.Plaza: case Tile.Gate: return [150, 145, 135];
        case Tile.Dirt: return [150, 120, 80];
        case Tile.Wall: case Tile.Tower: return [70, 70, 70];
        case Tile.Field: return [150, 110, 60];
        case Tile.Forest: return [40, 90, 35];
        case Tile.Rock: case Tile.Quarry: return [130, 125, 120];
        case Tile.Floor: return [160, 70, 50];
        case Tile.Bridge: return [140, 100, 60];
        case Tile.Sand: return [200, 185, 130];
        default: return sim.season === 3 ? [225, 230, 236] : [105, 150, 65];
      }
    };
    for (let i = 0; i < world.w * world.h; i++) {
      const b = world.buildingAt[i];
      const c = !world.explored[i] ? [22, 26, 34] : b >= 0 ? (world.buildings[b].condition <= 0 ? [40, 30, 25] : [160, 70, 50]) : col(world.tiles[i]);
      d[i * 4] = c[0];
      d[i * 4 + 1] = c[1];
      d[i * 4 + 2] = c[2];
      d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }

  update(): void {
    const sim = this.game.sim;
    const cur = this.game.renderer.showOverlay;
    for (const b of this.ovBtns) b.classList.toggle('active', b.dataset.ov === cur);
    const v = sim.tileVersion * 1000 + sim.buildingVersion + sim.season * 7 + sim.region.exploredVersion * 100000;
    if (v !== this.version) {
      this.version = v;
      this.renderBase();
    }
    const g = this.canvas.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, 160, 160);
    g.drawImage(this.base, 0, 0, 160, 160);
    // пожары
    g.fillStyle = '#ff6a1a';
    for (const f of sim.fires) {
      const b = sim.world.buildings[f.building];
      if (b) g.fillRect(b.x * this.scale - 1, b.y * this.scale - 1, 3, 3);
    }
    // избранные и выбранный
    g.fillStyle = '#ffe070';
    for (const id of sim.favorites) {
      const c = sim.citizens[id];
      if (c && c.alive) g.fillRect(c.x * this.scale - 1, c.y * this.scale - 1, 3, 3);
    }
    const selId = this.game.renderer.selectedCitizen;
    const sel = selId >= 0 ? sim.citizens[selId] : null;
    if (sel && sel.alive) {
      g.strokeStyle = '#ffe070';
      g.beginPath();
      g.arc(sel.x * this.scale, sel.y * this.scale, 4, 0, Math.PI * 2);
      g.stroke();
    }
    // камера
    const cam = this.game.renderer.camera;
    const r = cam.viewRect();
    g.strokeStyle = '#fff';
    g.lineWidth = 1;
    g.strokeRect((r.x0 / TILE) * this.scale, (r.y0 / TILE) * this.scale, ((r.x1 - r.x0) / TILE) * this.scale, ((r.y1 - r.y0) / TILE) * this.scale);
  }
}
