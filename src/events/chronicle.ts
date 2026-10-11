// Хроника города: лента событий.
export const enum EventKind {
  Info = 0,
  Social = 1,
  Crime = 2,
  Disaster = 3,
  Economy = 4,
  Birth = 5,
  Death = 6,
  Faith = 7,
}

export interface ChronicleEvent {
  id: number;
  tick: number;
  kind: EventKind;
  text: string;
  x: number;
  y: number;
  /** id жителей-участников */
  actors: number[];
  /** Важность 0..1 (для слухов и ленты) */
  importance: number;
}

export class Chronicle {
  events: ChronicleEvent[] = [];
  private nextId = 1;
  /** Слушатели (устарело: используйте sim.events.on('chronicle')) */
  listeners: ((e: ChronicleEvent) => void)[] = [];
  maxEvents = 600;

  log(tick: number, kind: EventKind, text: string, x: number, y: number, actors: number[] = [], importance = 0.3): ChronicleEvent {
    const e: ChronicleEvent = { id: this.nextId++, tick, kind, text, x, y, actors, importance };
    this.events.push(e);
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
    for (const l of this.listeners) l(e);
    return e;
  }

  recent(n: number): ChronicleEvent[] {
    return this.events.slice(-n);
  }
}
