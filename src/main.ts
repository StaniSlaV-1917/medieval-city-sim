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

export class Game {
  sim: Simulation;
  renderer: Renderer;
  hud: Hud;
  input: Input;
  side: SidePanel;
  chronicleView: ChronicleView;
  marketPanel: MarketPanel;
  speed = 1;
  paused = false;
  private acc = 0;
  private lastTime = 0;
  private fps = 60;
  private fpsAcc = 0;
  private fpsCount = 0;
  private running = true;

  constructor(seed: string, size: CitySize) {
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    const ui = document.getElementById('ui') as HTMLElement;
    this.sim = new Simulation({ seedText: seed, size });
    this.renderer = new Renderer(canvas, this.sim);
    this.hud = new Hud(ui, this);
    this.side = new SidePanel(ui, this);
    this.chronicleView = new ChronicleView(ui, this);
    this.marketPanel = new MarketPanel(ui, this);
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
    this.renderer.selectedCitizen = -1;
    this.renderer.selectedBuilding = -1;
    this.renderer.camera.follow = null;
    this.side.hide();
  }

  onClick(sx: number, sy: number): void {
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
    this.renderer.render(dt);
    this.hud.update(this.fps);
    this.updateHover();
    this.side.update();
    this.chronicleView.update();
    this.marketPanel.update();
    requestAnimationFrame((t) => this.frame(t));
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
showStartScreen(ui, (seed, size) => {
  (window as unknown as { game: Game }).game = new Game(seed, size);
});
