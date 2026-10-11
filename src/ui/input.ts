import type { Game } from '../main';

export class Input {
  keys = new Set<string>();
  private dragging = false;
  private dragMoved = false;
  private lastX = 0;
  private lastY = 0;
  mouseX = 0;
  mouseY = 0;
  /** Курсор над элементом интерфейса (не над картой) */
  overUi = true;
  private game: Game;

  constructor(game: Game, canvas: HTMLCanvasElement) {
    this.game = game;
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      this.keys.add(e.code);
      this.onKey(e);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0 || e.button === 1 || e.button === 2) {
        this.dragging = true;
        this.dragMoved = false;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
    });
    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      const t = e.target as HTMLElement | null;
      this.overUi = !!t && t !== canvas;
      if (this.dragging) {
        const dx = e.clientX - this.lastX;
        const dy = e.clientY - this.lastY;
        if (Math.abs(dx) + Math.abs(dy) > 3) this.dragMoved = true;
        if (this.dragMoved) {
          const cam = game.renderer.camera;
          cam.moveBy(-dx / cam.zoom, -dy / cam.zoom);
          cam.x = cam.targetX;
          cam.y = cam.targetY;
        }
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (!this.dragMoved && e.button === 0) game.onClick(e.clientX, e.clientY);
      if (!this.dragMoved && e.button === 2) game.onRightClick(e.clientX, e.clientY);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const f = e.deltaY < 0 ? 1.18 : 1 / 1.18;
        game.renderer.camera.zoomAt(f, e.clientX, e.clientY);
      },
      { passive: false },
    );
  }

  private onKey(e: KeyboardEvent): void {
    const g = this.game;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        g.togglePause();
        break;
      case 'Digit1':
        g.setSpeed(1);
        break;
      case 'Digit2':
        g.setSpeed(2);
        break;
      case 'Digit3':
        g.setSpeed(4);
        break;
      case 'Digit4':
        g.setSpeed(8);
        break;
      case 'KeyF':
        g.toggleFollow();
        break;
      case 'Escape':
        g.escape();
        break;
      case 'Tab':
        e.preventDefault();
        g.toggleClean();
        break;
      case 'KeyE':
        g.openWindow('edicts');
        break;
      case 'KeyR':
        g.openWindow('development');
        break;
      case 'KeyY':
        g.openWindow('trade');
        break;
      case 'KeyN':
        g.openWindow('region');
        break;
      case 'KeyL':
        g.openWindow('chronicle');
        break;
      case 'Equal':
      case 'NumpadAdd':
        g.renderer.camera.zoomAt(1.25, window.innerWidth / 2, window.innerHeight / 2);
        break;
      case 'Minus':
      case 'NumpadSubtract':
        g.renderer.camera.zoomAt(0.8, window.innerWidth / 2, window.innerHeight / 2);
        break;
      case 'KeyM':
        g.openWindow('economy');
        break;
      case 'KeyG':
        g.openWindow('god');
        break;
      case 'KeyT':
        g.openWindow('stats');
        break;
      case 'KeyO':
        g.cycleOverlay();
        break;
      case 'KeyH':
        g.renderer.camera.panTo(g.sim.world.poi.cx * 16, g.sim.world.poi.cy * 16);
        break;
    }
  }

  /** Обновление камеры с клавиатуры */
  update(dt: number): void {
    const cam = this.game.renderer.camera;
    let dx = 0;
    let dy = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) dy -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) dy += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) dx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) dx += 1;
    if (dx || dy) {
      const sp = (this.keys.has('ShiftLeft') ? 900 : 450) / cam.zoom;
      cam.moveBy(dx * sp * dt, dy * sp * dt);
    }
  }
}
