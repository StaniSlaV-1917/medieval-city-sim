import { Simulation } from './sim/game';
import { Renderer } from './render/renderer';
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
import { WindowManager, Win } from './ui/windows';
import { TooltipSystem } from './ui/tooltip';
import { TopBar } from './ui/topbar';
import { LeftBar } from './ui/leftbar';
import { Outliner } from './ui/outliner';
import { BuildBar } from './ui/buildbar';
import { Toasts } from './ui/toasts';
import { loadSettings, saveSettings, UiSettings } from './ui/settings';
import { EdictsPanel, DevelopmentPanel, TradePanel, RegionPanel, SettingsPanel } from './ui/panels';
import { ChronicleEvent, EventKind } from './events/chronicle';

/** Панель, живущая внутри окна */
interface Panelled {
  toggle(force?: boolean): void;
  update(): void;
}

export class Game {
  sim: Simulation;
  renderer: Renderer;
  input: Input;
  side: SidePanel;
  chronicleView: ChronicleView;
  marketPanel: MarketPanel;
  godPanel: GodPanel;
  statsPanel: StatsPanel;
  minimap: Minimap;
  windows: WindowManager;
  tooltip: TooltipSystem;
  topbar: TopBar;
  leftbar: LeftBar;
  outliner: Outliner;
  buildbar: BuildBar;
  toasts: Toasts;
  settings: UiSettings;
  private panels = new Map<string, Panelled>();
  private lastAutosave = 0;
  private lastAutosaveDay = -1;
  autosaveStatus = '';
  godTargeting: string | null = null;
  speed = 1;
  paused = false;
  clean = false;
  /** Режим выбора цели для приказа */
  targeting: { order: OrderDef; citizen: number } | null = null;
  private acc = 0;
  private lastTime = 0;
  private fps = 60;
  private fpsAcc = 0;
  private fpsCount = 0;
  private running = true;
  private ui: HTMLElement;

  constructor(seed: string, size: CitySize, loaded?: Simulation) {
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    const ui = document.getElementById('ui') as HTMLElement;
    this.ui = ui;
    this.sim = loaded ?? new Simulation({ seedText: seed, size });
    this.settings = loadSettings();
    this.renderer = new Renderer(canvas, this.sim);
    this.windows = new WindowManager(ui);
    // Постоянные элементы
    this.topbar = new TopBar(ui, this);
    this.leftbar = new LeftBar(ui, this);
    this.chronicleView = new ChronicleView(ui, this);
    this.minimap = new Minimap(ui, this);
    this.buildbar = new BuildBar(ui, this);
    this.toasts = new Toasts(ui, this);
    // Окна
    const mk = (id: string, title: string, width: number, anchor: 'left' | 'right' | 'center', extra: Partial<ConstructorParameters<typeof Win>[1]> = {}): Win => new Win(this.windows, { id, title, width, anchor, maxHeight: 520, ...extra });
    this.marketPanel = new MarketPanel(mk('economy', 'Хозяйство', 380, 'left'), this);
    this.panels.set('economy', this.marketPanel);
    this.panels.set('edicts', new EdictsPanel(mk('edicts', 'Указы', 360, 'left'), this));
    this.panels.set('development', new DevelopmentPanel(mk('development', 'Развитие', 380, 'left'), this));
    this.panels.set('trade', new TradePanel(mk('trade', 'Торговля', 380, 'left'), this));
    this.panels.set('region', new RegionPanel(mk('region', 'Регион', 340, 'left'), this));
    this.statsPanel = new StatsPanel(mk('stats', 'Летопись чисел', 450, 'left'), this);
    this.panels.set('stats', this.statsPanel);
    this.godPanel = new GodPanel(mk('god', 'Длань небес', 360, 'left'), this);
    this.panels.set('god', this.godPanel);
    this.panels.set('settings', new SettingsPanel(mk('settings', 'Настройки', 400, 'center'), this));
    this.outliner = new Outliner(mk('outliner', 'Обзор', 260, 'right', { maxHeight: 360 }), this);
    this.panels.set('outliner', this.outliner);
    this.side = new SidePanel(mk('card', 'Житель', 360, 'right', { maxHeight: 560, onClose: () => this.onCardClosed() }), this);
    // Подсказки — поверх всего
    this.tooltip = new TooltipSystem(ui);
    this.input = new Input(this, canvas);
    this.applyScale();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    const cam = this.renderer.camera;
    cam.setImmediate(this.sim.world.poi.cx * TILE, this.sim.world.poi.cy * TILE, 2);
    this.sim.chronicle.listeners.push((e) => this.onEvent(e));
    this.outliner.win.show();
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  resize(): void {
    this.renderer.resize(window.innerWidth, window.innerHeight);
  }

  applyScale(): void {
    const s = this.settings.scale;
    this.windows.setScale(s);
    this.tooltip.scale = s;
  }

  /** Классификация события хроники для паузы и уведомлений */
  private eventClass(e: ChronicleEvent): string | null {
    const t = e.text.toLowerCase();
    if (e.kind === EventKind.Disaster) {
      if (/пожар|загорел|горит|огонь|молния/.test(t)) return 'fire';
      if (/бунт|протест|толпа/.test(t)) return 'riot';
      return 'disaster';
    }
    if (e.kind === EventKind.Death) return 'death';
    if (e.kind === EventKind.Birth) return 'birth';
    if (e.kind === EventKind.Crime) return /взлом|ограбил|драк|подж|убил|разбойник/.test(t) ? 'crime' : null;
    if (e.kind === EventKind.Social || e.kind === EventKind.Faith) return /свадьб|венча|женил|вышла замуж/.test(t) ? 'wedding' : null;
    if (e.kind === EventKind.Economy) return /караван/.test(t) ? 'caravan' : null;
    return null;
  }

  private onEvent(e: ChronicleEvent): void {
    const cls = this.eventClass(e);
    const actor = e.actors[0];
    if (cls && this.settings.pauseOn[cls] && !this.paused) {
      this.paused = true;
      this.toasts.show(`<b>Пауза:</b> ${e.text}`, e.kind, e.x, e.y, actor);
      return;
    }
    if (this.settings.toasts && (e.importance >= 0.6 || (cls && cls !== 'death' && cls !== 'birth'))) this.toasts.show(e.text, e.kind, e.x, e.y, actor);
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

  toggleFavorite(id: number): void {
    const f = this.sim.favorites;
    const i = f.indexOf(id);
    if (i >= 0) f.splice(i, 1);
    else f.push(id);
    this.outliner.render();
  }

  /** Карточку закрыли крестиком или Esc */
  private onCardClosed(): void {
    this.renderer.selectedCitizen = -1;
    this.renderer.selectedBuilding = -1;
    this.renderer.camera.follow = null;
    this.targeting = null;
    this.side.hide();
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

  /** Esc: сначала отмена прицеливания, потом верхнее окно, потом снятие выбора */
  escape(): void {
    if (this.godTargeting || this.targeting) {
      this.deselect();
      return;
    }
    if (this.windows.closeTop()) return;
    this.deselect();
  }

  toggleClean(): void {
    this.clean = !this.clean;
    this.ui.classList.toggle('clean', this.clean);
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
    this.topbar.setStatus(`${this.fps.toFixed(0)} FPS · объектов ${this.renderer.debug.drawn}${this.renderer.showOverlay !== 'none' ? ` · ${OVERLAY_NAMES[this.renderer.showOverlay]}` : ''}${this.paused ? ' · ПАУЗА' : ''}`);
    this.topbar.update();
    this.leftbar.update(this);
    this.updateHover();
    this.side.update();
    this.chronicleView.update();
    for (const p of this.panels.values()) p.update();
    this.minimap.update();
    this.buildbar.update();
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
    saveSettings(this.settings);
    const ui = document.getElementById('ui') as HTMLElement;
    ui.innerHTML = '';
    ui.classList.remove('clean');
    (window as unknown as { game: Game }).game = new Game(sim.seedText, sim.size, sim);
  }

  /** Открыть/закрыть окно по id (левая панель, клавиши) */
  openWindow(id: string): void {
    if (id === 'chronicle') {
      this.chronicleView.toggle();
      return;
    }
    const p = this.panels.get(id);
    if (p) p.toggle();
  }

  /** Совместимость со старыми вызовами */
  showPanel(which: 'market' | 'god' | 'stats'): void {
    this.openWindow(which === 'market' ? 'economy' : which);
  }

  cycleOverlay(): void {
    const order: ('none' | 'crime' | 'fire' | 'wealth')[] = ['none', 'crime', 'fire', 'wealth'];
    const i = order.indexOf(this.renderer.showOverlay);
    this.renderer.showOverlay = order[(i + 1) % order.length];
  }

  private updateHover(): void {
    const sx = this.input.mouseX;
    const sy = this.input.mouseY;
    if (this.input.overUi || this.tooltip.uiActive) {
      this.renderer.hoverCitizen = -1;
      this.tooltip.hideMap();
      return;
    }
    const cid = this.renderer.pickCitizen(sx, sy);
    this.renderer.hoverCitizen = cid;
    if (cid >= 0) {
      const c = this.sim.citizens[cid];
      this.tooltip.showAt(sx, sy, this.side.citizenTooltip(c));
      return;
    }
    const bid = this.renderer.pickBuilding(sx, sy);
    if (bid >= 0) {
      this.tooltip.showAt(sx, sy, this.side.buildingTooltip(this.sim.world.buildings[bid]));
      return;
    }
    this.tooltip.hideMap();
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
