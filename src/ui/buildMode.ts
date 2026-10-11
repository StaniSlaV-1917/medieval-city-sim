// Режим строительства (фаза 14): выбранный инструмент, призрак постройки, подсветка допустимых мест,
// радиусы влияния/работы, дороги линией со снапом, кисти зон, участки прямоугольником, снос.
import type { Game } from '../main';
import { BuildItem, catalogItem, costText } from '../data/buildCatalog';
import { checkPlace, placeBuilding, snappedLine, roadTileOk, buildRoad, paintZone, placePlot, demolishBuilding, upgradeBuilding, doorFor, materialAvailable, upgradePlan } from '../sim/build';
import { Building, BUILDING_DEFS, District } from '../world/buildings';
import { TILE } from '../render/camera';
import { idx, inBounds, PropType } from '../world/world';
import { Tile } from '../world/tiles';
import { Good } from '../economy/goods';

export interface BuildPreview {
  tiles: { x: number; y: number; ok: boolean }[];
  ghost: { b: Building; ok: boolean } | null;
  circles: { x: number; y: number; r: number; color: string }[];
  /** Прямоугольник участка */
  rect: { x0: number; y0: number; x1: number; y1: number } | null;
  text: string;
}

export class BuildMode {
  item: BuildItem | null = null;
  facing = 0;
  brush = 3;
  private dragStart: { x: number; y: number } | null = null;
  private hover = { x: -1, y: -1 };
  preview: BuildPreview | null = null;
  message = '';
  private game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  get active(): boolean {
    return this.item !== null;
  }

  select(id: string): void {
    const it = catalogItem(id);
    if (!it) return;
    if (this.item?.id === id) {
      this.cancel();
      return;
    }
    this.item = it;
    this.dragStart = null;
    this.message = '';
    this.game.paused = this.game.paused; // стройка не меняет паузу
    this.updatePreview();
  }

  cancel(): void {
    this.item = null;
    this.dragStart = null;
    this.preview = null;
    this.message = '';
  }

  rotate(): void {
    this.facing = (this.facing + 1) % 4;
    this.updatePreview();
  }

  setBrush(n: number): void {
    this.brush = Math.max(1, Math.min(6, n));
  }

  private tileAt(sx: number, sy: number): { x: number; y: number } {
    const w = this.game.renderer.camera.screenToWorld(sx, sy);
    return { x: Math.floor(w.x / TILE), y: Math.floor(w.y / TILE) };
  }

  onMove(sx: number, sy: number): void {
    const t = this.tileAt(sx, sy);
    if (t.x === this.hover.x && t.y === this.hover.y && !this.dragStart) return;
    this.hover = t;
    this.updatePreview();
  }

  onDown(sx: number, sy: number): void {
    if (!this.item) return;
    const t = this.tileAt(sx, sy);
    const tool = this.item.tool;
    if (tool === 'path' || tool === 'road' || tool === 'plot' || tool === 'wall') this.dragStart = t;
    else if (tool === 'field' || tool === 'pasture' || tool === 'grove') {
      this.dragStart = t;
      this.applyBrush(t);
    }
    this.updatePreview();
  }

  onDrag(sx: number, sy: number): void {
    if (!this.item) return;
    const t = this.tileAt(sx, sy);
    this.hover = t;
    const tool = this.item.tool;
    if ((tool === 'field' || tool === 'pasture' || tool === 'grove') && this.dragStart) this.applyBrush(t);
    this.updatePreview();
  }

  onUp(sx: number, sy: number): void {
    if (!this.item) return;
    const t = this.tileAt(sx, sy);
    const sim = this.game.sim;
    const it = this.item;
    const tool = it.tool;
    if (it.type !== undefined) {
      const chk = checkPlace(sim, it, this.anchor(t).x, this.anchor(t).y, this.facing);
      if (!chk.ok) {
        this.message = chk.reason;
      } else if (sim.treasury < it.money) {
        this.message = `В казне нет ${it.money} монет.`;
      } else {
        const b = placeBuilding(sim, it, this.anchor(t).x, this.anchor(t).y, this.facing);
        this.message = b ? `${BUILDING_DEFS[b.type].name}: стройка заложена. Материалы подвезут строители.` : 'Не удалось.';
        this.game.toasts.show(this.message, 0);
      }
    } else if (tool === 'path' || tool === 'road') {
      if (this.dragStart) {
        const line = snappedLine(this.dragStart.x, this.dragStart.y, t.x, t.y);
        const n = buildRoad(sim, line, tool === 'road');
        this.message = n ? `Проложено ${n} тайлов ${tool === 'road' ? 'мощёной улицы' : 'тропы'}.` : tool === 'road' && materialAvailable(sim, 'stone') < 1 ? 'На складах нет камня для мощения.' : 'Здесь дорогу не проложить.';
      }
      this.dragStart = null;
    } else if (tool === 'wall') {
      if (this.dragStart) {
        const line = snappedLine(this.dragStart.x, this.dragStart.y, t.x, t.y);
        this.message = `Стены по воле правителя появятся в следующих фазах (${line.length} тайлов отмечено).`;
      }
      this.dragStart = null;
    } else if (tool === 'plot') {
      if (this.dragStart) {
        const placed = placePlot(sim, this.dragStart.x, this.dragStart.y, t.x, t.y);
        this.message = placed.length ? `Жилой участок: заложено домов — ${placed.length}.` : 'Участок должен примыкать к дороге, а внутри должно быть место под дома 3×3.';
        if (placed.length) this.game.toasts.show(this.message, 0);
      }
      this.dragStart = null;
    } else if (tool === 'field' || tool === 'pasture' || tool === 'grove') {
      this.dragStart = null;
    } else if (tool === 'demolish') {
      const bid = this.pickBuilding(t);
      if (bid >= 0) {
        const b = sim.world.buildings[bid];
        this.message = demolishBuilding(sim, bid);
        if (this.game.renderer.selectedBuilding === bid) this.game.deselect();
        void b;
      } else {
        // убрать проп (скамья, фонарь, ограда)
        const pi = sim.world.props.findIndex((p) => p.x === t.x && p.y === t.y && (p.type === PropType.Bench || p.type === PropType.Lamp || p.type === PropType.Torch || p.type === PropType.Fence || p.type === PropType.Flowers));
        if (pi >= 0) {
          sim.world.props.splice(pi, 1);
          sim.world.solidProp.fill(-1);
          sim.world.props.forEach((p, i) => {
            if (p.solid) sim.world.solidProp[idx(sim.world, p.x, p.y)] = i;
          });
          sim.pathfinder.invalidateRect(t.x, t.y, 1, 1);
          sim.tileVersion++;
          this.message = 'Убрано.';
        } else this.message = 'Здесь нечего сносить.';
      }
    } else if (tool === 'upgrade') {
      const bid = this.pickBuilding(t);
      this.message = bid >= 0 ? upgradeBuilding(sim, bid) : 'Выберите дом.';
    } else if (tool === 'prop' && it.prop !== undefined) {
      this.placeProp(t, it);
    }
    this.updatePreview();
  }

  private pickBuilding(t: { x: number; y: number }): number {
    const world = this.game.sim.world;
    if (!inBounds(world, t.x, t.y)) return -1;
    return world.buildingAt[idx(world, t.x, t.y)];
  }

  private placeProp(t: { x: number; y: number }, it: BuildItem): void {
    const sim = this.game.sim;
    const world = sim.world;
    if (!inBounds(world, t.x, t.y)) return;
    const i = idx(world, t.x, t.y);
    const tt = world.tiles[i] as Tile;
    const ok = world.buildingAt[i] < 0 && world.solidProp[i] >= 0 === false && (tt === Tile.Grass || tt === Tile.Meadow || tt === Tile.Garden || tt === Tile.Dirt || tt === Tile.Mud || tt === Tile.Plaza || tt === Tile.Road || tt === Tile.Pasture);
    if (!ok) {
      this.message = 'Сюда не поставить.';
      return;
    }
    if (sim.treasury < it.money) {
      this.message = `В казне нет ${it.money} монет.`;
      return;
    }
    for (const [g, n] of Object.entries(it.cost) as [Good, number][]) {
      if (n && materialAvailable(sim, g) < n) {
        this.message = `На складах нет материала: ${costText(it.cost, 0)}.`;
        return;
      }
    }
    sim.treasury -= it.money;
    const solid = it.prop === PropType.Fence || it.prop === PropType.Bench;
    world.props.push({ type: it.prop!, x: t.x, y: t.y, ox: 0.5, oy: 0.5, variant: sim.rng.int(0, 2), solid });
    if (solid) world.solidProp[i] = world.props.length - 1;
    if (it.prop === PropType.Bench) sim.world.poi.benches.push({ x: t.x, y: t.y });
    sim.pathfinder.invalidateRect(t.x, t.y, 1, 1);
    sim.tileVersion++;
    this.message = `${it.name}: поставлено.`;
  }

  private applyBrush(t: { x: number; y: number }): void {
    const zone = this.item!.tool as 'field' | 'pasture' | 'grove';
    const n = paintZone(this.game.sim, zone, t.x, t.y, this.brush - 1);
    if (n) this.message = `${zone === 'field' ? 'Поле' : zone === 'pasture' ? 'Выпас' : 'Роща'}: +${n} тайлов.`;
  }

  /** Левый верхний угол футпринта так, чтобы курсор был в его центре */
  private anchor(t: { x: number; y: number }): { x: number; y: number } {
    const def = BUILDING_DEFS[this.item!.type!];
    return { x: t.x - Math.floor(def.minW / 2), y: t.y - Math.floor(def.minH / 2) };
  }

  updatePreview(): void {
    const it = this.item;
    if (!it) {
      this.preview = null;
      return;
    }
    const sim = this.game.sim;
    const world = sim.world;
    const t = this.hover;
    const pv: BuildPreview = { tiles: [], ghost: null, circles: [], rect: null, text: '' };
    if (it.type !== undefined) {
      const a = this.anchor(t);
      const chk = checkPlace(sim, it, a.x, a.y, this.facing);
      const def = BUILDING_DEFS[it.type];
      pv.tiles = chk.tiles;
      pv.tiles.push(chk.door);
      const d = doorFor(a.x, a.y, def.minW, def.minH, this.facing);
      const ghost: Building = { id: -1, type: it.type, x: a.x, y: a.y, w: def.minW, h: def.minH, doorX: d.x, doorY: d.y, facing: this.facing, material: def.material === 'any' ? 'timber' : def.material, roof: def.roof === 'any' ? 'tile' : def.roof, stories: def.stories, variant: 7, name: '', residents: [], workers: [], owner: -1, condition: 1, storage: {}, district: District.Outskirts, lit: false };
      pv.ghost = { b: ghost, ok: chk.ok };
      const cx = a.x + def.minW / 2;
      const cy = a.y + def.minH / 2;
      if (it.influence) pv.circles.push({ x: cx, y: cy, r: it.influence, color: 'rgba(80,140,220,0.5)' });
      if (it.workRadius) pv.circles.push({ x: cx, y: cy, r: it.workRadius, color: 'rgba(200,160,40,0.55)' });
      const costs = Object.entries(it.cost).filter(([, n]) => n).map(([g, n]) => `${n} ${g === 'planks' ? 'досок' : g === 'stone' ? 'камня' : g === 'wood' ? 'брёвен' : g} (на складах ${materialAvailable(sim, g as Good)})`).join(', ');
      pv.text = chk.ok ? `${def.name}: ${costs || 'без материалов'}${it.money ? `, ${it.money} монет` : ''} · R — повернуть · ПКМ/Esc — отмена` : `${def.name}: ${chk.reason}`;
    } else if (it.tool === 'path' || it.tool === 'road' || it.tool === 'wall') {
      if (this.dragStart) {
        const line = snappedLine(this.dragStart.x, this.dragStart.y, t.x, t.y);
        for (const p of line) pv.tiles.push({ x: p.x, y: p.y, ok: roadTileOk(world, p.x, p.y, it.tool === 'road') });
        pv.text = `${it.name}: ${line.length} тайлов${it.tool === 'road' ? ` · камень на складах: ${materialAvailable(sim, 'stone')}` : ''}`;
      } else {
        pv.tiles.push({ x: t.x, y: t.y, ok: roadTileOk(world, t.x, t.y, it.tool === 'road') });
        pv.text = `${it.name}: зажмите и ведите линию (снап к 45°) · ПКМ/Esc — отмена`;
      }
    } else if (it.tool === 'plot') {
      if (this.dragStart) {
        pv.rect = { x0: Math.min(this.dragStart.x, t.x), y0: Math.min(this.dragStart.y, t.y), x1: Math.max(this.dragStart.x, t.x), y1: Math.max(this.dragStart.y, t.y) };
        pv.text = `Жилой участок ${pv.rect.x1 - pv.rect.x0 + 1}×${pv.rect.y1 - pv.rect.y0 + 1}: дома встанут вдоль примыкающих дорог`;
      } else pv.text = 'Жилой участок: растяните прямоугольник вдоль дороги';
    } else if (it.tool === 'field' || it.tool === 'pasture' || it.tool === 'grove') {
      const r = this.brush - 1;
      for (let y = t.y - r; y <= t.y + r; y++)
        for (let x = t.x - r; x <= t.x + r; x++) {
          if (Math.hypot(x - t.x, y - t.y) > r + 0.3 || !inBounds(world, x, y)) continue;
          const i = idx(world, x, y);
          const tt = world.tiles[i] as Tile;
          pv.tiles.push({ x, y, ok: world.buildingAt[i] < 0 && (tt === Tile.Grass || tt === Tile.Meadow || tt === Tile.Field || tt === Tile.Pasture) && !world.inside[i] });
        }
      const fert = inBounds(world, t.x, t.y) ? Math.round(world.fertility[idx(world, t.x, t.y)] * 100) : 0;
      pv.text = `${it.name}: кисть ${this.brush} (колесо+Shift) · плодородие здесь ${fert}% · ведите мышью`;
    } else if (it.tool === 'demolish' || it.tool === 'upgrade') {
      const bid = this.pickBuilding(t);
      if (bid >= 0) {
        const b = world.buildings[bid];
        for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) pv.tiles.push({ x, y, ok: it.tool === 'demolish' ? false : !!upgradePlan(b) });
        const plan = upgradePlan(b);
        pv.text = it.tool === 'demolish' ? `Снести: ${b.name || BUILDING_DEFS[b.type].name} (вернётся половина материалов)` : plan ? `Улучшить: ${plan.label} — ${costText(plan.cost, plan.money)}` : 'Это здание улучшить нельзя';
      } else pv.text = it.tool === 'demolish' ? 'Снос: кликните по зданию или украшению' : 'Улучшение: кликните по дому';
    } else if (it.tool === 'prop') {
      pv.tiles.push({ x: t.x, y: t.y, ok: inBounds(world, t.x, t.y) && world.buildingAt[idx(world, t.x, t.y)] < 0 && world.solidProp[idx(world, t.x, t.y)] < 0 });
      pv.text = `${it.name}: ${costText(it.cost, it.money)} · клик — поставить`;
    }
    this.preview = pv;
  }
}
