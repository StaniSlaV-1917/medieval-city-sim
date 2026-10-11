// Данные жителя (чистые данные, логика — в системах).
export type Sex = 'm' | 'f';

export const enum Profession {
  None = 0,
  Farmer = 1,
  Miller = 2,
  Baker = 3,
  Butcher = 4,
  Smith = 5,
  Carpenter = 6,
  Mason = 7,
  Tanner = 8,
  Merchant = 9,
  Innkeeper = 10,
  Bard = 11,
  Herald = 12,
  Beggar = 13,
  Priest = 14,
  Monk = 15,
  Noble = 16,
  Burgomaster = 17,
  Guard = 18,
  Thief = 19,
  Child = 20,
  Elder = 21,
  Housewife = 22,
  Lord = 23,
  Woodcutter = 24,
  Quarryman = 25,
  Stablehand = 26,
  Fireman = 27,
  Servant = 28,
  Laborer = 29,
}

export const PROFESSION_NAMES: Record<number, { m: string; f: string }> = {
  [Profession.None]: { m: 'Без занятия', f: 'Без занятия' },
  [Profession.Farmer]: { m: 'Крестьянин', f: 'Крестьянка' },
  [Profession.Miller]: { m: 'Мельник', f: 'Мельничиха' },
  [Profession.Baker]: { m: 'Пекарь', f: 'Пекарка' },
  [Profession.Butcher]: { m: 'Мясник', f: 'Мясничиха' },
  [Profession.Smith]: { m: 'Кузнец', f: 'Кузнец' },
  [Profession.Carpenter]: { m: 'Плотник', f: 'Плотник' },
  [Profession.Mason]: { m: 'Каменщик', f: 'Каменщик' },
  [Profession.Tanner]: { m: 'Кожевник', f: 'Кожевница' },
  [Profession.Merchant]: { m: 'Торговец', f: 'Торговка' },
  [Profession.Innkeeper]: { m: 'Трактирщик', f: 'Трактирщица' },
  [Profession.Bard]: { m: 'Бард', f: 'Певица' },
  [Profession.Herald]: { m: 'Глашатай', f: 'Глашатай' },
  [Profession.Beggar]: { m: 'Нищий', f: 'Нищенка' },
  [Profession.Priest]: { m: 'Священник', f: 'Священник' },
  [Profession.Monk]: { m: 'Монах-лекарь', f: 'Монахиня-лекарка' },
  [Profession.Noble]: { m: 'Дворянин', f: 'Дворянка' },
  [Profession.Burgomaster]: { m: 'Бургомистр', f: 'Бургомистр' },
  [Profession.Guard]: { m: 'Стражник', f: 'Стражница' },
  [Profession.Thief]: { m: 'Вор', f: 'Воровка' },
  [Profession.Child]: { m: 'Ребёнок', f: 'Ребёнок' },
  [Profession.Elder]: { m: 'Старик', f: 'Старуха' },
  [Profession.Housewife]: { m: 'Домохозяин', f: 'Домохозяйка' },
  [Profession.Lord]: { m: 'Лорд', f: 'Леди' },
  [Profession.Woodcutter]: { m: 'Лесоруб', f: 'Лесоруб' },
  [Profession.Quarryman]: { m: 'Каменотёс', f: 'Каменотёс' },
  [Profession.Stablehand]: { m: 'Конюх', f: 'Конюх' },
  [Profession.Fireman]: { m: 'Пожарный', f: 'Пожарный' },
  [Profession.Servant]: { m: 'Слуга', f: 'Служанка' },
  [Profession.Laborer]: { m: 'Подёнщик', f: 'Подёнщица' },
};

export const enum Trait {
  Greedy = 0, // жадный
  Honest = 1, // честный
  HotTempered = 2, // вспыльчивый
  Cowardly = 3, // трусливый
  Pious = 4, // набожный
  Talkative = 5, // болтливый
  Lazy = 6, // ленивый
  Ambitious = 7, // амбициозный
  Kind = 8, // добрый
  Drunkard = 9, // пьяница
  Cheerful = 10, // весёлый
  Gloomy = 11, // угрюмый
  Hardworking = 12, // работящий
  Curious = 13, // любопытный
  Envious = 14, // завистливый
  Brave = 15, // храбрый
}

export const TRAIT_NAMES: Record<number, { m: string; f: string; desc: string }> = {
  [Trait.Greedy]: { m: 'Жадный', f: 'Жадная', desc: 'Копит деньги, неохотно тратит, склонен к кражам' },
  [Trait.Honest]: { m: 'Честный', f: 'Честная', desc: 'Не ворует, может отказаться от дурных приказов' },
  [Trait.HotTempered]: { m: 'Вспыльчивый', f: 'Вспыльчивая', desc: 'Легко ввязывается в ссоры и драки' },
  [Trait.Cowardly]: { m: 'Трусливый', f: 'Трусливая', desc: 'Избегает опасности, убегает от драк' },
  [Trait.Pious]: { m: 'Набожный', f: 'Набожная', desc: 'Часто ходит в собор, сильна потребность в вере' },
  [Trait.Talkative]: { m: 'Болтливый', f: 'Болтливая', desc: 'Любит поговорить, быстро разносит слухи' },
  [Trait.Lazy]: { m: 'Ленивый', f: 'Ленивая', desc: 'Опаздывает на работу, рано уходит' },
  [Trait.Ambitious]: { m: 'Амбициозный', f: 'Амбициозная', desc: 'Много работает, стремится к богатству' },
  [Trait.Kind]: { m: 'Добрый', f: 'Добрая', desc: 'Помогает другим, легко заводит друзей' },
  [Trait.Drunkard]: { m: 'Пьяница', f: 'Пьяница', desc: 'Тянет в таверну, тратит деньги на выпивку' },
  [Trait.Cheerful]: { m: 'Весёлый', f: 'Весёлая', desc: 'Поднимает настроение собеседникам' },
  [Trait.Gloomy]: { m: 'Угрюмый', f: 'Угрюмая', desc: 'Мало общается, недоволен жизнью' },
  [Trait.Hardworking]: { m: 'Работящий', f: 'Работящая', desc: 'Работает дольше и усерднее' },
  [Trait.Curious]: { m: 'Любопытный', f: 'Любопытная', desc: 'Бродит по городу, подходит к событиям' },
  [Trait.Envious]: { m: 'Завистливый', f: 'Завистливая', desc: 'Злится на богатых, портит отношения' },
  [Trait.Brave]: { m: 'Храбрый', f: 'Храбрая', desc: 'Не боится драк и пожаров, помогает страже' },
};

export interface Appearance {
  skin: number; // индекс тона кожи
  hair: number; // индекс цвета волос
  hairStyle: number; // 0..3
  cloth: number; // индекс цвета одежды
  cloth2: number; // второй цвет (штаны/юбка)
  hat: number; // 0 — нет
  beard: number; // 0 — нет
}

export interface Needs {
  hunger: number; // 100 = сыт
  energy: number; // 100 = бодр
  social: number; // 100 = наобщался
  safety: number; // 100 = в безопасности
  faith: number; // 100 = духовно спокоен
  fun: number; // 100 = развлечён
  health: number; // 100 = здоров
}

export type NeedKey = keyof Needs;

export const NEED_NAMES: Record<NeedKey, string> = {
  hunger: 'Сытость',
  energy: 'Бодрость',
  social: 'Общение',
  safety: 'Безопасность',
  faith: 'Вера',
  fun: 'Развлечение',
  health: 'Здоровье',
};

export interface Memory {
  tick: number;
  text: string;
  /** Важность 0..1 */
  importance: number;
  /** Связанный житель (если есть) */
  about: number;
  /** Тема для сплетен (опционально) */
  topic?: string;
}

export const enum CitizenState {
  Idle = 0,
  Moving = 1,
  Acting = 2,
  Talking = 3,
  Sleeping = 4,
}

export interface Speech {
  text: string;
  until: number;
  /** Мысль (не вслух) */
  thought: boolean;
  /** Тик начала (для плавного появления) */
  from?: number;
  /** Эмоция для значка в облачке */
  emo?: string;
}

export interface Citizen {
  id: number;
  alive: boolean;
  firstName: string;
  lastName: string;
  sex: Sex;
  age: number; // лет
  birthTick: number;
  appearance: Appearance;
  traits: Trait[];
  profession: Profession;
  home: number; // id здания или -1
  workplace: number; // id здания или -1
  /** Позиция в тайлах (с дробной частью) */
  x: number;
  y: number;
  /** Предыдущая позиция (для интерполяции) */
  px: number;
  py: number;
  /** Направление 0=вниз 1=влево 2=вправо 3=вверх */
  dir: number;
  speed: number;
  /** Путь: индексы тайлов; pathIdx — следующий тайл */
  path: Int32Array | null;
  pathIdx: number;
  /** Цель движения */
  targetX: number;
  targetY: number;
  /** Внутри здания (не рисуется) */
  inside: number; // id здания или -1
  state: CitizenState;
  needs: Needs;
  money: number;
  inventory: Record<string, number>;
  spouse: number;
  children: number[];
  parents: number[];
  relations: Map<number, number>;
  memories: Memory[];
  bio: { tick: number; text: string }[];
  thought: string;
  speech: Speech | null;
  /** Текущее действие (id) и данные */
  action: string;
  actionData: Record<string, number>;
  actionUntil: number;
  /** Тик, когда можно заново выбрать действие */
  nextThink: number;
  /** Собеседник */
  talkingTo: number;
  talkCooldown: number;
  /** Счётчик тиков без движения в состоянии Moving (застревание) */
  stuckTicks: number;
  /** Счётчик неудач пути */
  pathFails: number;
  /** Уровень детализации симуляции 0=полный 1=упрощённый */
  lod: number;
  /** Пьян (0..100) */
  drunk: number;
  /** Настроение -100..100 (кэш) */
  mood: number;
  /** Анимация шага */
  animPhase: number;
  /** Флаги */
  flags: number;
  /** Текущий приказ игрока (null — нет) */
  order: Order | null;
  /** Здоровье «тела» для драк 0..100 */
  hp: number;
  /** Тик, до которого в тюрьме (0 — нет) */
  jailedUntil: number;
  /** Репутация преступника 0..100 (известность страже) */
  notoriety: number;
}

export interface OrderTarget {
  kind: 'citizen' | 'building' | 'tile';
  id: number;
  x: number;
  y: number;
}

export interface Order {
  type: string;
  target: OrderTarget | null;
  good?: string;
  /** Этап выполнения */
  phase: number;
  /** Дополнительные данные */
  data: Record<string, number>;
  /** Тик выдачи */
  givenAt: number;
}

export const FLAG_FIREMAN = 1; // доброволец-пожарный
export const FLAG_WANTED = 2; // в розыске
export const FLAG_SICK = 4; // болен
export const FLAG_INJURED = 8; // ранен

export function fullName(c: Citizen): string {
  return `${c.firstName} ${c.lastName}`;
}

/** Имя и фамилия в винительном падеже (упрощённо) */
export function nameAcc(c: Citizen): string {
  const f = c.firstName;
  let fa = f;
  if (f.endsWith('а')) fa = f.slice(0, -1) + 'у';
  else if (f.endsWith('я')) fa = f.slice(0, -1) + 'ю';
  else if (f.endsWith('й')) fa = f.slice(0, -1) + 'я';
  else if (/[бвгджзклмнпрстфхцчшщ]$/.test(f)) fa = f + 'а';
  let la = c.lastName;
  if (c.sex === 'm' && !la.startsWith('фон') && /[бвгджзклмнпрстфхцчшщ]$/.test(la)) la = la + 'а';
  else if (c.sex === 'f' && la.endsWith('а')) la = la.slice(0, -1) + 'у';
  return `${fa} ${la}`;
}

export function professionName(c: Citizen): string {
  return PROFESSION_NAMES[c.profession][c.sex];
}

export function traitName(t: Trait, sex: Sex): string {
  return TRAIT_NAMES[t][sex];
}

export function hasTrait(c: Citizen, t: Trait): boolean {
  return c.traits.includes(t);
}

export function isChild(c: Citizen): boolean {
  return c.age < 14;
}

export function isElder(c: Citizen): boolean {
  return c.age >= 62;
}

export function relation(c: Citizen, other: number): number {
  return c.relations.get(other) ?? 0;
}

export function changeRelation(c: Citizen, other: number, delta: number): number {
  const v = Math.max(-100, Math.min(100, (c.relations.get(other) ?? 0) + delta));
  c.relations.set(other, v);
  return v;
}
