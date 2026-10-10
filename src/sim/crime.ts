// Преступность (фаза 5). Здесь — заглушки для приказов, заполняются в фазе 5.
import type { ActionCtx } from '../ai/actions';
import { actFor, say } from '../ai/actions';
import { Order } from './citizen';

export function crimeOrderStart(ctx: ActionCtx, o: Order): boolean {
  void o;
  say(ctx.c, 'Пока не умею.', 40, false, ctx.sim.tick);
  ctx.c.order = null;
  return false;
}

export function crimeOrderArrive(ctx: ActionCtx, o: Order): void {
  void o;
  ctx.c.order = null;
  actFor(ctx, 5);
}
