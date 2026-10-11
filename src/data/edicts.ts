// Указы правителя — описания в таблице. Пока действуют два (подать и стража), остальные — заготовки
// для фазы 13: интерфейс показывает их как «скоро», симуляция их не читает.
import type { Simulation } from '../sim/game';
import { Profession } from '../sim/citizen';

export interface EdictDef {
  id: string;
  name: string;
  desc: string;
  category: 'treasury' | 'order' | 'economy' | 'faith' | 'social';
  /** Ползунок: минимум, максимум, шаг и формат подписи */
  slider?: { min: number; max: number; step: number; format: (v: number) => string };
  /** Прочитать текущее значение из симуляции */
  get?: (sim: Simulation) => number;
  /** Применить значение к симуляции */
  set?: (sim: Simulation, v: number) => void;
  /** Дополнительная строка состояния */
  status?: (sim: Simulation) => string;
  /** Ещё не действует (появится в будущих фазах) */
  planned?: boolean;
}

export const EDICT_DEFS: EdictDef[] = [
  {
    id: 'tax',
    name: 'Подать',
    desc: 'Высокая подать наполняет казну, но растит недовольство. Бедняки получают милостыню из казны.',
    category: 'treasury',
    slider: { min: 0, max: 30, step: 1, format: (v) => `${v}%` },
    get: (sim) => Math.round(sim.taxRate * 100),
    set: (sim, v) => {
      sim.taxRate = v / 100;
    },
    status: (sim) => `собрано за день ${sim.lastTax}, роздано бедным ${sim.lastCharity}`,
  },
  {
    id: 'guards',
    name: 'Стража',
    desc: 'Казарма набирает или распускает людей постепенно. Стража ловит воров и гасит бунты, но каждому платят из казны.',
    category: 'order',
    slider: { min: 2, max: 30, step: 1, format: (v) => String(v) },
    get: (sim) => (sim.guardTarget >= 0 ? sim.guardTarget : sim.citizens.filter((c) => c.alive && c.profession === Profession.Guard && !c.actionData.visitor).length),
    set: (sim, v) => {
      sim.guardTarget = v;
    },
    status: (sim) => `сейчас на службе ${sim.citizens.filter((c) => c.alive && c.profession === Profession.Guard && !c.actionData.visitor).length}`,
  },
  { id: 'price_cap', name: 'Твёрдая цена на хлеб', desc: 'Запретить пекарям продавать хлеб дороже указанного. Снижает недовольство, но пекарни могут разориться.', category: 'economy', planned: true },
  { id: 'curfew', name: 'Комендантский час', desc: 'После заката улицы пусты: меньше краж и драк, но таверны теряют выручку.', category: 'order', planned: true },
  { id: 'feast', name: 'Городской праздник', desc: 'Объявить гулянья за счёт казны. Недовольство падает, таверны полны.', category: 'social', planned: true },
  { id: 'tithe', name: 'Десятина собору', desc: 'Часть казны уходит на собор: вера растёт, священники довольны, казна беднее.', category: 'faith', planned: true },
  { id: 'guild', name: 'Цеховой устав', desc: 'Разрешить ремесленникам объединяться в цехи: качество растёт, цены тоже.', category: 'economy', planned: true },
];
