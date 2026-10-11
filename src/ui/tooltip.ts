// Подсказки, в том числе вложенные (как в CK3): строки с data-sub раскрывают второй уровень.
export class TooltipSystem {
  private main: HTMLElement;
  private sub: HTMLElement;
  private root: HTMLElement;
  private subTimer = 0;
  scale = 1;

  constructor(root: HTMLElement) {
    this.root = root;
    this.main = document.createElement('div');
    this.main.id = 'tooltip';
    this.main.className = 'tip';
    this.sub = document.createElement('div');
    this.sub.id = 'tooltip-sub';
    this.sub.className = 'tip';
    root.appendChild(this.main);
    root.appendChild(this.sub);
    // Делегирование: любой элемент с data-tip показывает подсказку
    root.addEventListener('mouseover', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      if (t && t.dataset.tip) this.show(e.clientX, e.clientY, t.dataset.tip, t);
    });
    root.addEventListener('mousemove', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      if (t && t.dataset.tip) this.show(e.clientX, e.clientY, t.dataset.tip, t);
      const line = (e.target as HTMLElement).closest<HTMLElement>('[data-sub]');
      if (line && line.dataset.sub && this.main.contains(line)) this.showSub(line);
      else if (!this.sub.contains(e.target as Node)) this.hideSub();
    });
    root.addEventListener('mouseout', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      const to = e.relatedTarget as HTMLElement | null;
      if (t && !(to && (t.contains(to) || this.main.contains(to) || this.sub.contains(to)))) this.hide();
    });
    this.main.addEventListener('mouseleave', (e) => {
      const to = e.relatedTarget as HTMLElement | null;
      if (!(to && (to.closest('[data-tip]') || this.sub.contains(to)))) this.hide();
    });
  }

  private fromMap = false;

  show(x: number, y: number, html: string, _anchor?: HTMLElement): void {
    this.fromMap = false;
    this.main.classList.remove('map');
    this.main.style.display = 'block';
    if (this.main.innerHTML !== html) this.main.innerHTML = html;
    const s = this.scale;
    const w = this.main.offsetWidth;
    const h = this.main.offsetHeight;
    let tx = x / s + 14;
    let ty = y / s + 14;
    if (tx + w > window.innerWidth / s - 8) tx = x / s - w - 8;
    if (ty + h > window.innerHeight / s - 8) ty = Math.max(4, y / s - h - 8);
    this.main.style.left = `${tx}px`;
    this.main.style.top = `${ty}px`;
  }

  hide(): void {
    this.main.style.display = 'none';
    this.hideSub();
  }

  private showSub(line: HTMLElement): void {
    const html = line.dataset.sub!;
    if (this.sub.style.display === 'block' && this.sub.dataset.for === html) return;
    clearTimeout(this.subTimer);
    this.sub.innerHTML = html;
    this.sub.dataset.for = html;
    this.sub.style.display = 'block';
    const s = this.scale;
    const r = line.getBoundingClientRect();
    const w = this.sub.offsetWidth;
    let x = r.right / s + 6;
    if (x + w > window.innerWidth / s - 8) x = r.left / s - w - 6;
    let y = r.top / s;
    if (y + this.sub.offsetHeight > window.innerHeight / s - 8) y = window.innerHeight / s - this.sub.offsetHeight - 8;
    this.sub.style.left = `${x}px`;
    this.sub.style.top = `${Math.max(4, y)}px`;
  }

  hideSub(): void {
    this.sub.style.display = 'none';
    this.sub.dataset.for = '';
  }

  /** Подсказка для элементов карты (вызывается из игры каждый кадр) */
  showAt(x: number, y: number, html: string): void {
    this.show(x, y, html);
    this.fromMap = true;
    this.main.classList.add('map');
  }

  /** Показана ли сейчас подсказка интерфейса (не карты) */
  get uiActive(): boolean {
    return this.main.style.display === 'block' && !this.fromMap;
  }

  /** Скрыть подсказку карты (подсказки интерфейса не трогаем) */
  hideMap(): void {
    if (this.fromMap) this.hide();
  }

  get rootEl(): HTMLElement {
    return this.root;
  }
}
