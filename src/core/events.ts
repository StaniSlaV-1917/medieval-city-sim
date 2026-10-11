// Шина событий симуляции: типизированные события для интерфейса, статистики и будущих систем
// (указы, развитие, регион). Слушатели не сериализуются и живут вместе с экземпляром Simulation.
import type { ChronicleEvent } from '../events/chronicle';

export interface SimEvents {
  /** Любая запись в хронике */
  chronicle: ChronicleEvent;
  /** Начало дня (номер дня от основания) */
  day: { day: number };
  /** Смена сезона */
  season: { season: number };
  /** Начало и конец разговора */
  'talk:start': { a: number; b: number };
  'talk:end': { a: number; b: number; completed: boolean; quarrel: boolean };
  /** Рождение и смерть */
  'citizen:born': { id: number; parents: number[] };
  'citizen:died': { id: number; cause: string };
  /** Пожар и разрушение здания */
  'building:fire': { id: number; cause: string };
  'building:destroyed': { id: number; cause: string };
  'building:done': { id: number };
  /** Преступление зафиксировано */
  crime: { kind: string; suspect: number; victim: number; x: number; y: number };
  /** Приказ отдан жителю */
  'order:given': { citizen: number; type: string; refused: boolean };
  /** Божественная сила применена */
  'god:power': { id: string; x: number; y: number };
  /** Голод в городе начался / отступил */
  famine: { active: boolean; avgHunger: number };
}

type Handler<T> = (payload: T) => void;

export class EventBus<M extends object> {
  private handlers = new Map<keyof M, Handler<unknown>[]>();
  /** Счётчики по типам (для тестов и статистики) */
  counts: Partial<Record<keyof M, number>> = {};

  on<K extends keyof M>(type: K, fn: Handler<M[K]>): () => void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn as Handler<unknown>);
    this.handlers.set(type, list);
    return () => this.off(type, fn);
  }

  once<K extends keyof M>(type: K, fn: Handler<M[K]>): void {
    const off = this.on(type, (p) => {
      off();
      fn(p);
    });
  }

  off<K extends keyof M>(type: K, fn: Handler<M[K]>): void {
    const list = this.handlers.get(type);
    if (!list) return;
    const i = list.indexOf(fn as Handler<unknown>);
    if (i >= 0) list.splice(i, 1);
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    this.counts[type] = (this.counts[type] ?? 0) + 1;
    const list = this.handlers.get(type);
    if (!list || !list.length) return;
    for (const h of [...list]) h(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
