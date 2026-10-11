// Нижняя панель строительства (заготовка под фазу 14): категории зданий и подсказка, что строит город сам.
import type { Game } from '../main';
import { iconImg } from './icons';
import { BUILDING_DEFS, BuildingType } from '../world/buildings';

const CATS: { id: string; label: string; icon: string; types: BuildingType[] }[] = [
  { id: 'homes', label: 'Жильё', icon: 'population', types: [BuildingType.House, BuildingType.Shack, BuildingType.Manor] },
  { id: 'food', label: 'Еда', icon: 'bread', types: [BuildingType.Farm, BuildingType.Mill, BuildingType.Bakery, BuildingType.Butcher, BuildingType.Tavern] },
  { id: 'craft', label: 'Ремесло', icon: 'tools', types: [BuildingType.Smithy, BuildingType.Carpenter, BuildingType.Tannery, BuildingType.Mason, BuildingType.Sawmill, BuildingType.Quarry] },
  { id: 'trade', label: 'Торговля', icon: 'trade', types: [BuildingType.MarketStall, BuildingType.Warehouse, BuildingType.Merchant, BuildingType.Stable] },
  { id: 'order', label: 'Порядок', icon: 'edicts', types: [BuildingType.Barracks, BuildingType.Prison, BuildingType.FireTower, BuildingType.Pillory] },
  { id: 'faith', label: 'Вера', icon: 'god', types: [BuildingType.Cathedral, BuildingType.Monastery, BuildingType.Chapel] },
];

export class BuildBar {
  el: HTMLElement;
  private game: Game;
  private last = 0;

  constructor(root: HTMLElement, game: Game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.id = 'buildbar';
    this.el.className = 'panel';
    this.el.dataset.fixed = '1';
    this.el.innerHTML = `<span class="bt">${iconImg('build', 14)} Строительство</span>` + CATS.map((c) => `<button class="btn bc" data-cat="${c.id}">${iconImg(c.icon, 14)}<span>${c.label}</span><span class="n"></span></button>`).join('');
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cat]');
      if (b) this.game.openWindow('development');
    });
  }

  update(): void {
    const now = performance.now();
    if (now - this.last < 1500) return;
    this.last = now;
    const bs = this.game.sim.world.buildings;
    for (const c of CATS) {
      const btn = this.el.querySelector<HTMLElement>(`[data-cat="${c.id}"]`)!;
      let n = 0;
      let building = 0;
      for (const b of bs) {
        if (b.w <= 0 || !c.types.includes(b.type)) continue;
        if (b.underConstruction !== undefined) building++;
        else if (b.condition > 0) n++;
      }
      btn.querySelector('.n')!.textContent = String(n);
      btn.classList.toggle('busy', building > 0);
      const names = c.types.map((t) => BUILDING_DEFS[t].name).join(', ');
      btn.dataset.tip = `<b>${c.label}</b>: ${n} ${building ? `(+${building} строится)` : ''}<br><span class="muted">${names}</span><br><i>Город строит сам по нужде; заказ построек по воле правителя появится в следующих фазах.</i>`;
    }
  }
}
