import { Simulation } from './sim/game';
import { Renderer } from './render/renderer';
import { Hud } from './ui/hud';
import { Input } from './ui/input';
import { showStartScreen } from './ui/startScreen';
import { TICKS_PER_SECOND } from './core/time';
import { CitySize } from './world/generator';
import { TILE } from './render/camera';
import { SidePanel } from './ui/sidePanel';
import { ChronicleView } from './ui/chronicleView';
import { MarketPanel } from './ui/marketPanel';
import { GodPanel } from './ui/godPanel';
import { StatsPanel } from './ui/statsPanel';
import { Minimap } from './ui/minimap';
import { serialize, deserialize, saveToDb, loadFromDb, downloadJson, pickJsonFile } from './save/save';
import { OVERLAY_NAMES } from './render/overlays';
import type { OrderDef } from './ai/orders';

export class Game {
  sim: Simulation;
  renderer: Renderer;
  hud: Hud;
  input: Input;
  side: SidePanel;
  chronicleView: ChronicleView;
  marketPanel: MarketPanel;
  godPanel: GodPanel;
  statsPanel: StatsPanel;
  minimap: Minimap;
  private lastAutosave = 0;
  private lastAutosaveDay = -1;
  autosaveStatus = '';
  godTargeting: string | null = null;
  speed = 1;
  paused = false;
  /** Режим выбора цели для приказа */
  targeting: { order: OrderDef; citizen: number } | null = null;
  private acc = 0;
  private lastTime = 0;
  private fps = 60;
  private fpsAcc = 0;
  private fpsCount = 0;
  private running = true;

  constructor(seed: string, size: CitySize, loaded?: Simulation) {
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    const ui = document.getElementById('ui') as HTMLElement;
    this.sim = loaded ?? new Simulation({ seedText: seed, size });
    this.renderer = new Renderer(canvas, this.sim);
    this.hud = new Hud(ui, this);
    this.side = new SidePanel(ui, this);
    this.chronicleView = new ChronicleView(ui, this);
    this.marketPanel = new MarketPanel(ui, this);
    this.godPanel = new GodPanel(ui, this);
    this.statsPanel = new StatsPanel(ui, this);
    this.minimap = new Minimap(ui, this);
    this.input = new Input(this, canvas);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    const cam = this.renderer.camera;
    cam.setImmediate(this.sim.world.poi.cx * TILE, this.sim.world.poi.cy * TILE, 2);
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  resize(): void {
    this.renderer.resize(window.innerWidth, window.innerHeight);
  }

  setSpeed(sp: number): void {
    if (sp === 0) this.paused = true;
    else {
      this.paused = false;
      this.speed = sp;
    }
  }

  togglePause(): void {
    this.paused = !this.paused;
  }

  toggleFollow(): void {
    const cam = this.renderer.camera;
    if (cam.follow) {
      cam.follow = null;
      return;
    }
    const id = this.renderer.selectedCitizen;
    if (id >= 0) this.followCitizen(id);
  }

  followCitizen(id: number): void {
    const cam = this.renderer.camera;
    cam.follow = () => {
      const c = this.sim.citizens[id];
      if (!c || !c.alive) return null;
      const a = this.renderer.alpha;
      return { x: (c.px + (c.x - c.px) * a + 0.5) * TILE, y: (c.py + (c.y - c.py) * a + 0.5) * TILE };
    };
  }

  selectCitizen(id: number, zoomIn = true): void {
    this.renderer.selectedCitizen = id;
    this.renderer.selectedBuilding = -1;
    const c = this.sim.citizens[id];
    if (!c) return;
    if (zoomIn) {
      const cam = this.renderer.camera;
      cam.panTo((c.x + 0.5) * TILE, (c.y + 0.5) * TILE, Math.max(cam.targetZoom, 3));
      this.paused = true;
    }
    this.side.showCitizen(id);
  }

  selectBuilding(id: number): void {
    this.renderer.selectedBuilding = id;
    this.renderer.selectedCitizen = -1;
    this.side.showBuilding(id);
  }

  deselect(): void {
    if (this.godTargeting) {
      this.godTargeting = null;
      return;
    }
    if (this.targeting) {
      this.targeting = null;
      this.renderer.canvas.style.cursor = 'default';
      return;
    }
    this.renderer.selectedCitizen = -1;
    this.renderer.selectedBuilding = -1;
    this.renderer.camera.follow = null;
    this.side.hide();
  }

  onClick(sx: number, sy: number): void {
    if (this.godTargeting) {
      const w = this.renderer.camera.screenToWorld(sx, sy);
      this.godPanel.applyAt(Math.floor(w.x / TILE), Math.floor(w.y / TILE));
      return;
    }
    if (this.targeting) {
      const t = this.targeting;
      const cid0 = this.renderer.pickCitizen(sx, sy);
      const bid0 = this.renderer.pickBuilding(sx, sy);
      const w = this.renderer.camera.screenToWorld(sx, sy);
      const tx = Math.floor(w.x / TILE);
      const ty = Math.floor(w.y / TILE);
      if (t.order.target === 'citizen' && cid0 >= 0) this.side.applyTarget({ kind: 'citizen', id: cid0, x: tx, y: ty });
      else if (t.order.target === 'building' && bid0 >= 0) {
        const b = this.sim.world.buildings[bid0];
        this.side.applyTarget({ kind: 'building', id: bid0, x: b.doorX, y: b.doorY });
      } else if (t.order.target === 'tile') this.side.applyTarget({ kind: 'tile', id: -1, x: tx, y: ty });
      else if (cid0 >= 0) this.side.applyTarget({ kind: 'citizen', id: cid0, x: tx, y: ty });
      else if (bid0 >= 0) this.side.applyTarget({ kind: 'building', id: bid0, x: tx, y: ty });
      else this.side.applyTarget({ kind: 'tile', id: -1, x: tx, y: ty });
      this.renderer.canvas.style.cursor = 'default';
      return;
    }
    const cid = this.renderer.pickCitizen(sx, sy);
    if (cid >= 0) {
      this.selectCitizen(cid, true);
      return;
    }
    const bid = this.renderer.pickBuilding(sx, sy);
    if (bid >= 0) {
      this.selectBuilding(bid);
      return;
    }
    this.deselect();
  }

  onRightClick(sx: number, sy: number): void {
    void sx;
    void sy;
  }

  panTo(tx: number, ty: number): void {
    this.renderer.camera.panTo((tx + 0.5) * TILE, (ty + 0.5) * TILE, Math.max(this.renderer.camera.targetZoom, 2.5));
  }

  private frame(now: number): void {
    if (!this.running) return;
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.25) dt = 0.25;
    this.fpsAcc += dt;
    this.fpsCount++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsCount / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsCount = 0;
    }
    // Симуляция: фиксированный тик
    const tickDt = 1 / TICKS_PER_SECOND;
    if (!this.paused) {
      this.acc += dt * this.speed;
      let steps = 0;
      const maxSteps = this.speed * 3 + 2;
      while (this.acc >= tickDt && steps < maxSteps) {
        this.sim.step();
        this.acc -= tickDt;
        steps++;
      }
      if (steps >= maxSteps) this.acc = 0;
      this.renderer.alpha = Math.min(1, this.acc / tickDt);
    } else {
      this.renderer.alpha = 1;
    }
    const cam = this.renderer.camera;
    this.sim.focusX = cam.x / TILE;
    this.sim.focusY = cam.y / TILE;
    this.input.update(dt);
    cam.update(dt);
    this.renderer.canvas.style.cursor = this.targeting || this.godTargeting ? 'crosshair' : 'default';
    this.renderer.render(dt);
    this.hud.update(this.fps);
    this.updateHover();
    this.side.update();
    this.chronicleView.update();
    this.marketPanel.update();
    this.godPanel.update();
    this.statsPanel.update();
    this.minimap.update();
    this.autosave(now);
    requestAnimationFrame((t) => this.frame(t));
  }

  private autosave(now: number): void {
    const day = Math.floor(this.sim.tick / 7200);
    const dueByDay = day !== this.lastAutosaveDay && this.sim.tick % 7200 < 50;
    const dueByTime = now - this.lastAutosave > 120000;
    if (!dueByDay && !dueByTime) return;
    if (this.lastAutosave === 0 && !dueByDay) {
      this.lastAutosave = now;
      return;
    }
    this.lastAutosave = now;
    this.lastAutosaveDay = day;
    this.saveGame('autosave').catch(() => void 0);
  }

  async saveGame(key = 'autosave'): Promise<void> {
    try {
      const json = serialize(this.sim);
      await saveToDb(key, json);
      this.autosaveStatus = `сохранено ${new Date().toLocaleTimeString('ru-RU')}`;
    } catch (e) {
      this.autosaveStatus = 'не удалось сохранить';
      console.error(e);
    }
  }

  exportSave(): void {
    const json = serialize(this.sim);
    downloadJson(json, `waldmark-${this.sim.seedText}-день${Math.floor(this.sim.tick / 7200)}.json`);
  }

  async importSave(): Promise<void> {
    const json = await pickJsonFile();
    if (!json) return;
    try {
      const sim = deserialize(json);
      this.replaceSim(sim);
    } catch (e) {
      alert('Не удалось загрузить сохранение: ' + (e as Error).message);
    }
  }

  replaceSim(sim: Simulation): void {
    this.running = false;
    const ui = document.getElementById('ui') as HTMLElement;
    ui.innerHTML = '';
    (window as unknown as { game: Game }).game = new Game(sim.seedText, sim.size, sim);
  }

  /** Открыть одну из левых панелей, закрыв остальные */
  showPanel(which: 'market' | 'god' | 'stats'): void {
    const panels = { market: this.marketPanel, god: this.godPanel, stats: this.statsPanel };
    for (const [k, p] of Object.entries(panels)) {
      if (k === which) p.toggle();
      else p.toggle(false);
    }
  }

  cycleOverlay(): void {
    const order: ('none' | 'crime' | 'fire' | 'wealth')[] = ['none', 'crime', 'fire', 'wealth'];
    const i = order.indexOf(this.renderer.showOverlay);
    this.renderer.showOverlay = order[(i + 1) % order.length];
  }

  private updateHover(): void {
    const sx = this.input.mouseX;
    const sy = this.input.mouseY;
    const cid = this.renderer.pickCitizen(sx, sy);
    this.renderer.hoverCitizen = cid;
    if (cid >= 0) {
      const c = this.sim.citizens[cid];
      this.hud.showTooltip(sx, sy, this.side.citizenTooltip(c));
      return;
    }
    const bid = this.renderer.pickBuilding(sx, sy);
    if (bid >= 0) {
      this.hud.showTooltip(sx, sy, this.side.buildingTooltip(this.sim.world.buildings[bid]));
      return;
    }
    this.hud.hideTooltip();
  }
}

const ui = document.getElementById('ui') as HTMLElement;
loadFromDb('autosave').then((saved) => {
  showStartScreen(
    ui,
    (seed, size) => {
      (window as unknown as { game: Game }).game = new Game(seed, size);
    },
    saved
      ? {
          savedAt: saved.savedAt,
          load: () => {
            try {
              const sim = deserialize(saved.json);
              (window as unknown as { game: Game }).game = new Game(sim.seedText, sim.size, sim);
            } catch (e) {
              alert('Сохранение повреждено: ' + (e as Error).message);
            }
          },
        }
      : null,
    async () => {
      const json = await pickJsonFile();
      if (!json) return false;
      try {
        const sim = deserialize(json);
        (window as unknown as { game: Game }).game = new Game(sim.seedText, sim.size, sim);
        return true;
      } catch (e) {
        alert('Не удалось загрузить файл: ' + (e as Error).message);
        return false;
      }
    },
  );
});
export { OVERLAY_NAMES };
