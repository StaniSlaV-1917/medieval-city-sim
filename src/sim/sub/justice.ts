// Правопорядок: тревоги, журнал преступлений, драки, протесты и бунты.
import type { Alarm, CrimeRecord } from '../crime';

export interface Protest {
  until: number;
  riot: boolean;
  members: number[];
  x: number;
  y: number;
  responded?: boolean;
}

export class Justice {
  alarms: Alarm[] = [];
  crimeLog: CrimeRecord[] = [];
  fights: { a: number; b: number; until: number }[] = [];
  protest: Protest | null = null;

  /** Преступлений за последние N тиков */
  crimesSince(tick: number): number {
    let n = 0;
    for (const r of this.crimeLog) if (r.tick >= tick) n++;
    return n;
  }
}
