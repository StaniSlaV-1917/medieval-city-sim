// Единая система окон: перетаскивание, сворачивание, закрепление, авто-раскладка без перекрытий,
// сохранение положения в localStorage, Esc закрывает верхнее окно.
export interface WinOptions {
  id: string;
  title: string;
  width: number;
  /** Начальный якорь при первом открытии */
  anchor?: 'left' | 'right' | 'center';
  /** Нельзя закрыть крестиком (например, карточка выбранного) */
  closable?: boolean;
  onClose?: () => void;
  /** Ширина/высота ограничены экраном */
  maxHeight?: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Постоянный элемент интерфейса (полосы, миникарта) — перекрывать нежелательнее */
  fixed?: boolean;
}

const LS_KEY = 'waldmark.ui.windows';

export class Win {
  el: HTMLElement;
  body: HTMLElement;
  titleEl: HTMLElement;
  id: string;
  open = false;
  collapsed = false;
  pinned = false;
  /** Позиция задана пользователем (перетаскиванием) */
  userPlaced = false;
  x = 0;
  y = 0;
  width: number;
  private opts: WinOptions;
  private mgr: WindowManager;

  constructor(mgr: WindowManager, opts: WinOptions) {
    this.mgr = mgr;
    this.opts = opts;
    this.id = opts.id;
    this.width = opts.width;
    this.el = document.createElement('div');
    this.el.className = 'win panel';
    this.el.dataset.win = opts.id;
    this.el.style.width = `${opts.width}px`;
    this.el.style.display = 'none';
    this.el.innerHTML = `<div class="win-head"><span class="win-title"></span><span class="win-btns"><button class="wb collapse" title="Свернуть">▾</button><button class="wb pin" title="Закрепить (не двигать автоматически)">📌</button>${opts.closable === false ? '' : '<button class="wb close" title="Закрыть (Esc)">✕</button>'}</span></div><div class="win-body"></div>`;
    this.body = this.el.querySelector('.win-body')!;
    this.titleEl = this.el.querySelector('.win-title')!;
    this.titleEl.textContent = opts.title;
    if (opts.maxHeight) this.body.style.maxHeight = `${opts.maxHeight}px`;
    const head = this.el.querySelector('.win-head') as HTMLElement;
    head.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('.wb')) return;
      mgr.startDrag(this, e);
    });
    head.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('.wb')) return;
      this.setCollapsed(!this.collapsed);
    });
    this.el.querySelector('.collapse')!.addEventListener('click', () => this.setCollapsed(!this.collapsed));
    this.el.querySelector('.pin')!.addEventListener('click', () => this.setPinned(!this.pinned));
    this.el.querySelector('.close')?.addEventListener('click', () => this.close());
    this.el.addEventListener('mousedown', () => mgr.bringToFront(this));
    mgr.root.appendChild(this.el);
    mgr.register(this);
  }

  /** Ограничить высоту тела окна доступным местом на экране */
  fitHeight(avail: number): void {
    const mh = Math.max(120, Math.min(this.opts.maxHeight ?? 1e9, avail));
    this.body.style.maxHeight = `${mh}px`;
  }

  setTitle(t: string): void {
    this.titleEl.textContent = t;
  }

  show(): void {
    if (!this.open) {
      this.open = true;
      this.el.style.display = 'block';
      this.mgr.place(this);
    }
    this.mgr.bringToFront(this);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.el.style.display = 'none';
    this.opts.onClose?.();
  }

  toggle(force?: boolean): void {
    const want = force ?? !this.open;
    if (want) this.show();
    else this.close();
  }

  setCollapsed(v: boolean): void {
    this.collapsed = v;
    this.el.classList.toggle('collapsed', v);
    (this.el.querySelector('.collapse') as HTMLElement).textContent = v ? '▸' : '▾';
    this.mgr.save();
    this.mgr.resolveOverlaps(this);
  }

  setPinned(v: boolean): void {
    this.pinned = v;
    this.el.classList.toggle('pinned', v);
    this.mgr.save();
  }

  setPos(x: number, y: number): void {
    const vw = this.mgr.viewW();
    const vh = this.mgr.viewH();
    const r = this.rect();
    this.x = Math.max(0, Math.min(vw - Math.min(r.w, vw), x));
    this.y = Math.max(this.mgr.topInset, Math.min(vh - 40, y));
    this.el.style.left = `${this.x}px`;
    this.el.style.top = `${this.y}px`;
  }

  rect(): Rect {
    return { x: this.x, y: this.y, w: this.el.offsetWidth || this.width, h: this.el.offsetHeight || 100 };
  }

  get anchor(): WinOptions['anchor'] {
    return this.opts.anchor ?? 'left';
  }
}

export class WindowManager {
  root: HTMLElement;
  wins: Win[] = [];
  /** Отступы от краёв, занятые постоянными элементами (полоса ресурсов, боковые панели) */
  topInset = 64;
  leftInset = 52;
  rightInset = 8;
  bottomInset = 48;
  scale = 1;
  private zTop = 100;
  private drag: { win: Win; dx: number; dy: number } | null = null;
  private saved: Record<string, { x: number; y: number; collapsed: boolean; pinned: boolean; placed: boolean }> = {};
  /** Порядок открытия (для Esc) */
  private order: Win[] = [];

  constructor(root: HTMLElement) {
    this.root = root;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) this.saved = JSON.parse(raw);
    } catch {
      this.saved = {};
    }
    window.addEventListener('mousemove', (e) => this.onMove(e));
    window.addEventListener('mouseup', () => this.endDrag());
    window.addEventListener('resize', () => {
      for (const w of this.wins) if (w.open) w.setPos(w.x, w.y);
    });
  }

  viewW(): number {
    return window.innerWidth / this.scale;
  }

  viewH(): number {
    return window.innerHeight / this.scale;
  }

  register(w: Win): void {
    this.wins.push(w);
    const s = this.saved[w.id];
    if (s) {
      w.x = s.x;
      w.y = s.y;
      w.userPlaced = s.placed;
      if (s.collapsed) w.setCollapsed(true);
      if (s.pinned) w.setPinned(true);
    }
  }

  bringToFront(w: Win): void {
    w.el.style.zIndex = String(++this.zTop);
    const i = this.order.indexOf(w);
    if (i >= 0) this.order.splice(i, 1);
    this.order.push(w);
  }

  /** Верхнее открытое окно (для Esc) */
  topWindow(): Win | null {
    for (let i = this.order.length - 1; i >= 0; i--) if (this.order[i].open) return this.order[i];
    return null;
  }

  get(id: string): Win | undefined {
    return this.wins.find((w) => w.id === id);
  }

  openWindows(): Win[] {
    return this.wins.filter((w) => w.open);
  }

  /** Разместить окно: сохранённая позиция или свободное место без перекрытий */
  place(w: Win): void {
    requestAnimationFrame(() => {
      w.fitHeight(this.viewH() - this.topInset - this.bottomInset - 48);
      if (w.userPlaced && this.saved[w.id]) {
        w.setPos(w.x, w.y);
        this.resolveOverlaps(w);
        return;
      }
      const r = w.rect();
      const pos = this.findFreeSpot(w, r.w, r.h);
      w.setPos(pos.x, pos.y);
    });
  }

  private occupied(except: Win | null): Rect[] {
    const out: Rect[] = [];
    for (const o of this.wins) if (o.open && o !== except) out.push(o.rect());
    for (const el of Array.from(this.root.querySelectorAll<HTMLElement>('[data-fixed]'))) {
      if (el.offsetParent === null) continue;
      const b = el.getBoundingClientRect();
      out.push({ x: b.left / this.scale, y: b.top / this.scale, w: b.width / this.scale, h: b.height / this.scale, fixed: true });
    }
    return out;
  }

  private intersects(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  private findFreeSpot(w: Win, ww: number, wh: number): { x: number; y: number } {
    const occ = this.occupied(w);
    const vw = this.viewW();
    const vh = this.viewH();
    const gap = 6;
    const anchor = w.anchor;
    const minX = this.leftInset + gap;
    const maxX = vw - ww - this.rightInset;
    // Кандидаты по X: край экрана по якорю плюс края уже занятых прямоугольников
    const xsSet = new Set<number>();
    const add = (x: number): void => {
      if (x >= minX - 0.5 && x <= maxX + 0.5) xsSet.add(Math.round(x));
    };
    if (anchor === 'center') add((vw - ww) / 2);
    add(minX);
    add(maxX);
    for (const o of occ) {
      add(o.x + o.w + gap);
      add(o.x - ww - gap);
    }
    const xs = [...xsSet];
    if (anchor === 'right') xs.sort((a, b) => b - a);
    else if (anchor === 'center') xs.sort((a, b) => Math.abs(a - (vw - ww) / 2) - Math.abs(b - (vw - ww) / 2));
    else xs.sort((a, b) => a - b);
    const minH = Math.min(wh, 120);
    // Сначала верхний ряд во всех колонках, затем ниже; если места нет — минимальное перекрытие
    let best: { x: number; y: number; cost: number } | null = null;
    for (let y = this.topInset + gap; y + minH <= vh - this.bottomInset; y += 24) {
      for (const x of xs) {
        const r = { x, y, w: ww, h: Math.min(wh, vh - y) };
        let cost = 0;
        for (const o of occ) {
          if (!this.intersects(r, o)) continue;
          const ox = Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x);
          const oy = Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y);
          cost += ox * oy * (o.fixed ? 4 : 1);
        }
        if (cost === 0) return { x, y };
        if (!best || cost < best.cost) best = { x, y, cost };
      }
    }
    return best ? { x: best.x, y: best.y } : { x: minX, y: this.topInset + gap };
  }

  /** Сдвинуть другие незакреплённые окна, если они перекрывают это */
  resolveOverlaps(w: Win): void {
    if (!w.open) return;
    const r = w.rect();
    for (const o of this.wins) {
      if (o === w || !o.open || o.pinned) continue;
      if (this.intersects(r, o.rect())) {
        const pos = this.findFreeSpot(o, o.rect().w, o.rect().h);
        o.setPos(pos.x, pos.y);
      }
    }
  }

  startDrag(w: Win, e: MouseEvent): void {
    this.bringToFront(w);
    this.drag = { win: w, dx: e.clientX / this.scale - w.x, dy: e.clientY / this.scale - w.y };
    w.el.classList.add('dragging');
    e.preventDefault();
  }

  private onMove(e: MouseEvent): void {
    if (!this.drag) return;
    const d = this.drag;
    d.win.setPos(e.clientX / this.scale - d.dx, e.clientY / this.scale - d.dy);
  }

  private endDrag(): void {
    if (!this.drag) return;
    const w = this.drag.win;
    w.el.classList.remove('dragging');
    w.userPlaced = true;
    this.drag = null;
    this.resolveOverlaps(w);
    this.save();
  }

  save(): void {
    for (const w of this.wins) this.saved[w.id] = { x: w.x, y: w.y, collapsed: w.collapsed, pinned: w.pinned, placed: w.userPlaced };
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.saved));
    } catch {
      /* приватный режим и т.п. */
    }
  }

  /** Закрыть верхнее незакреплённое окно; true — что-то закрыли */
  closeTop(): boolean {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const w = this.order[i];
      if (w.open && !w.pinned) {
        w.close();
        return true;
      }
    }
    return false;
  }

  setScale(s: number): void {
    this.scale = s;
    (this.root.style as unknown as { zoom: string }).zoom = String(s);
    for (const w of this.wins) if (w.open) w.setPos(w.x, w.y);
  }
}
