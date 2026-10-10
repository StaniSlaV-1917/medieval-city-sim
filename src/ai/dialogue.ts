// Шаблоны реплик жителей. Контекст: погода, сезон, время, работа, семья, цены, сплетни, события.
import type { Simulation } from '../sim/game';
import { Citizen, Profession, Trait, hasTrait, isChild, isElder, relation, fullName } from '../sim/citizen';
import { Season, hourOf } from '../core/time';
import { RNG } from '../core/rng';
import { priceOf } from './actions';

export type Topic = 'greet' | 'weather' | 'work' | 'family' | 'prices' | 'gossip' | 'memory' | 'needs' | 'tavern' | 'faith' | 'city' | 'kids' | 'bye' | 'quarrel' | 'flirt' | 'elder';

const pick = (rng: RNG, arr: string[]) => arr[Math.floor(rng.next() * arr.length)];

const GREET = {
  friend: ['Привет, {name}! Рад{a} тебя видеть.', '{name}! Сколько лет, сколько зим!', 'А, {name}! Как {sam}?', 'Здорово, {friend}!', 'Привет, {name}. Как дела?'],
  neutral: ['Доброго дня.', 'Здравствуй, сосед.', 'Привет.', 'Бог в помощь.', 'Доброго здоровья!', 'Здравствуйте.'],
  foe: ['Опять ты…', 'Ну здравствуй, {name}.', 'Чего тебе?', 'Хм.', 'Не ожидал тебя тут встретить.'],
  kid: ['Привет! Пошли играть!', 'Эй, {name}!', 'Ты чего тут?', 'Айда на площадь!', 'Я первый добегу до колодца!'],
  morning: ['Доброе утро!', 'С утречком!', 'Рано встал сегодня?'],
  evening: ['Добрый вечер.', 'Вечер добрый!', 'Уже темнеет, а ты всё ходишь.'],
};

const WEATHER: Record<number, string[]> = {
  [Season.Spring]: ['Весна наконец-то. Грязи по колено, зато тепло.', 'Слышал, за рекой уже сеют.', 'Ручьи бегут — скоро всё зазеленеет.', 'Птицы вернулись, слышишь?', 'Весной и дышится легче.', 'Такая весна — быть урожаю.'],
  [Season.Summer]: ['Ну и жара сегодня!', 'Солнце печёт — хоть в реку лезь.', 'Хорошо бы дождик, поля сохнут.', 'Лето красное, а работы невпроворот.', 'В такую жару только в тени сидеть.', 'Вечером у реки прохладно.'],
  [Season.Autumn]: ['Листья желтеют, скоро холода.', 'Дожди зарядили, дороги раскисли.', 'Пора запасать дрова на зиму.', 'Урожай собрали — теперь можно и выдохнуть.', 'Осень, грибов в лесу — хоть косой коси.', 'Ветер какой — крыши сорвёт.'],
  [Season.Winter]: ['Мороз-то какой! Уши отваливаются.', 'Снега намело по самые окна.', 'Реку льдом сковало.', 'Дрова кончаются, а зима только началась.', 'В такой холод и волки к стенам подходят.', 'Скорей бы весна.', 'Печь топи не топи — всё одно холодно.'],
};

const WORK: Partial<Record<Profession, string[]>> = {
  [Profession.Farmer]: ['Поле вспахал, спина отваливается.', 'Если дождей не будет — пропадёт урожай.', 'Землю надо любить, тогда и родит.', 'В поле с рассвета до заката.', 'Лорд опять оброк поднял.'],
  [Profession.Baker]: ['С четырёх утра у печи стою.', 'Мука нынче дорогая.', 'Хлеб разобрали ещё до полудня!', 'Руки по локоть в тесте.', 'Пекарня — это не лавка, тут вставать затемно.'],
  [Profession.Smith]: ['Заказов — на месяц вперёд.', 'Уголь опять подорожал.', 'Выковал сегодня подкову — загляденье.', 'От горна спина не разгибается.', 'Стража просит новые алебарды.'],
  [Profession.Guard]: ['Ночью на восточной стене было тихо.', 'Воры совсем распоясались.', 'Капитан опять ругался.', 'Патрулирую, патрулирую — а толку.', 'Смотри у меня, чтоб без драк!'],
  [Profession.Merchant]: ['Торговля идёт ни шатко ни валко.', 'Караван обещали на той неделе.', 'Пошлины душат, честное слово.', 'Покупатель нынче жадный.', 'Хороший товар сам себя хвалит.'],
  [Profession.Innkeeper]: ['Вчера в таверне яблоку негде было упасть.', 'Эль закончился — варю новый.', 'Пьяные — беда, но платят.', 'Заходи вечером, спою за кружкой.'],
  [Profession.Priest]: ['Паства нынче редко ходит в собор.', 'Молись, и воздастся.', 'Грехов в городе много, а кающихся мало.', 'На службу приходи, сын мой.'],
  [Profession.Monk]: ['В больнице опять двое с лихорадкой.', 'Травы собрал, настой готовлю.', 'Господь исцеляет, мы лишь помогаем.'],
  [Profession.Carpenter]: ['Доски сырые — крыша потечёт.', 'Заказали новую дверь для ратуши.', 'Плотник без топора — не плотник.'],
  [Profession.Mason]: ['Камень из каменоломни — отличный.', 'Стена у ворот трещину дала.', 'Кладка — дело неторопливое.'],
  [Profession.Tanner]: ['От кожевни запах — соседи ругаются.', 'Шкуры вымачиваю, работа грязная.', 'Зато сапоги у всех мои.'],
  [Profession.Woodcutter]: ['В лесу волки воют.', 'Сосну свалил — трое не обхватят.', 'Топор затупился, к кузнецу надо.'],
  [Profession.Quarryman]: ['В каменоломне пыль столбом.', 'Камень тяжёлый, а платят мало.', 'Чуть глыбой не придавило.'],
  [Profession.Miller]: ['Колесо крутится, мука сыплется.', 'Река обмелела — мельница еле тянет.', 'Зерно везут с полей, работы много.'],
  [Profession.Butcher]: ['Свежая свинина, заходи.', 'Скот нынче тощий.', 'Нож наточил — режет как бритва.'],
  [Profession.Burgomaster]: ['Дела городские — одна головная боль.', 'Казна пустеет, а расходы растут.', 'Лорд требует отчёта.'],
  [Profession.Herald]: ['Слушайте, слушайте! Новости будут.', 'Голос сорвал на площади.', 'Указ оглашать — это тебе не песни петь.'],
  [Profession.Servant]: ['Господа опять не в духе.', 'С утра до ночи на побегушках.', 'В замке полы мыть — дело неблагодарное.'],
  [Profession.Laborer]: ['Мешки таскаю, спина трещит.', 'Хоть какая работа — и то хлеб.', 'Нанялся на день, а завтра — как Бог даст.'],
  [Profession.Beggar]: ['Подайте, люди добрые…', 'С утра ни крошки во рту.', 'Был и я когда-то человеком.'],
  [Profession.Thief]: ['Дела? Да так, кручусь.', 'Стража сегодня злая.', 'Не твоё дело, чем я занимаюсь.'],
  [Profession.Noble]: ['Эти простолюдины так шумят.', 'На охоте вчера подняли кабана.', 'При дворе скучно.'],
  [Profession.Lord]: ['Город должен платить вовремя.', 'Я слежу за порядком.', 'Стража распустилась.'],
  [Profession.Housewife]: ['Дома дел — не переделать.', 'Дети совсем от рук отбились.', 'Хлеб опять подорожал.', 'Муж допоздна работает.'],
  [Profession.Bard]: ['Сочинил новую балладу про дракона.', 'В таверне вчера пели до утра.', 'Хочешь, спою?'],
  [Profession.Stablehand]: ['Лошадь лорда захромала.', 'Конюшню чистить — не сахар.'],
  [Profession.Fireman]: ['Проверяй печь, а то сгорим все.', 'Вёдра на каланче полны.'],
};
const WORK_GENERIC = ['Работа — не волк, но и не убежит.', 'Устал как собака.', 'Дела идут помаленьку.', 'Работы много, денег мало.', 'Вот закончу — и в таверну.'];

const FAMILY = {
  spouse: ['Жена опять ворчит.', 'Муж всё по тавернам.', 'Дома ждут, пойду.', 'Мы с {spouse} поженились в такую же весну.', 'Моя половина готовит лучше всех в городе.'],
  kids: ['Дети растут — одежда мала.', 'Сын весь в отца.', 'Дочка уже хозяйке помогает.', 'Детвора весь день на площади.', 'Малой опять порвал штаны.'],
  none: ['Один живу, тихо.', 'Жениться бы, да на что семью кормить.', 'Родня далеко, в других краях.', 'Сам себе хозяин.'],
  parents: ['Старик совсем плох стал.', 'Мать всё молится за нас.', 'Отец учил меня ремеслу.'],
};

const PRICE_TEMPL = ['Хлеб нынче по {bread}, куда это годится!', 'Эль в таверне — {ale}. Терпимо.', 'За {meal} монеты в таверне кормят до отвала.', 'Говорят, цены на муку растут.', 'На рынке всё дорожает, а жалованье то же.', 'Раньше за монету два каравая давали.', 'Мясо по {meat} — не укупишь.', 'Пекарь дерёт три шкуры.'];

const GOSSIP = {
  praise: ['{other} — душа-человек.', 'Видел {otherAcc} вчера, кланялся.', 'Таких, как {other}, поискать.', '{other} мне в прошлом году помог, не забуду.', 'На {otherAcc} можно положиться.'],
  blame: ['{other} — тот ещё жук.', 'Не доверяй {otherDat}, попомни моё слово.', 'Говорят, {other} по ночам шастает.', '{other} мне до сих пор долг не вернул.', 'Видел я {otherAcc} у таверны — на ногах не стоял.', '{other} с соседями не здоровается.'],
  neutral: ['{other} новый дом строить собрался.', 'Слыхал, {other} в собор зачастил.', '{other} опять с утра на рынке.', 'Говорят, у {otherGen} корова пропала.'],
};

const NEEDS = {
  hunger: ['Живот от голода сводит.', 'Поесть бы чего.', 'С утра маковой росинки во рту не было.'],
  energy: ['Еле на ногах стою.', 'Спать хочу — сил нет.', 'Ночь не спал.'],
  fun: ['Скучно в этом городе.', 'Хоть бы ярмарка какая.', 'Развлечений — одна таверна.'],
  poor: ['В кошельке ветер гуляет.', 'Денег нет совсем.', 'До жалованья дотянуть бы.'],
  rich: ['Дела идут, грех жаловаться.', 'Заработал на днях неплохо.'],
  drunk: ['Ик… хорош-шо посидели!', 'А ты знаешь, я тебя уважаю!', 'Ещё бы кружечку…', 'Где мой дом, не подскажешь?'],
  sick: ['Что-то знобит меня.', 'Голова раскалывается.', 'К монахам бы сходить.'],
};

const TAVERN_INV = ['Пойдём вечером в «{tavern}»?', 'В «{tavern}» новый эль, говорят.', 'После работы — в таверну, как всегда?', 'Угощу тебя кружечкой.'];
const FAITH_T = ['Господь всё видит.', 'Был сегодня в соборе, легче стало.', 'Священник сегодня хорошо говорил.', 'Поставлю свечу за родных.', 'Молись — и беда минует.', 'Грешны мы все, грешны.'];
const CITY_T = ['Стражи на улицах мало.', 'Бургомистр опять налог поднимает.', 'Лорд в замке пирует, а мы работаем.', 'Город растёт — чужаков всё больше.', 'У речных ворот грязь — не пройти.', 'Ночью опять кто-то кричал у трущоб.', 'Мост скоро развалится, чинить надо.', 'На площади колодец хорош — вода чистая.'];
const KIDS_T = ['Давай в догонялки!', 'А я видел в реке огромную рыбу!', 'Мама не разрешает к реке ходить.', 'У кузнеца искры летят — страшно!', 'Пошли на стену залезем!', 'Я вырасту и стану стражником!', 'А у меня зуб выпал!', 'Спорим, я быстрее добегу?'];
const ELDER_T = ['В наше время молодёжь уважала старших.', 'Зима будет суровая, кости ноют.', 'Я ещё помню, как эту стену строили.', 'Раньше и хлеб был вкуснее.', 'Доживёшь до моих лет — поймёшь.'];
const BYE = {
  friend: ['Ну, бывай! Заходи вечером.', 'Рад{a} был{a} повидать, {name}.', 'Береги себя!', 'До встречи, {friend}.'],
  neutral: ['Ладно, пора мне.', 'Доброго дня.', 'Ну, бывай.', 'Дела ждут.', 'Увидимся.'],
  foe: ['Всё, некогда мне.', 'Ладно, ладно.', 'Не задерживаю.'],
};
const QUARREL = ['Да что ты понимаешь!', 'Не твоё дело!', 'Сам такой!', 'Я тебе это припомню!', 'Отстань от меня!', 'Ещё раз скажешь — пожалеешь!', 'Ты мне долг верни сначала!', 'Да ты пьян!', 'Тьфу на тебя!', 'Вот и катись!'];
const QUARREL_OPEN = ['Ты зачем вчера про меня болтал?', 'Это твоя свинья мой огород перерыла?', 'Долг когда вернёшь?', 'Чего уставился?', 'Опять ты мне дорогу перешёл!'];
const FLIRT = ['Какой сегодня чудесный день, {name}…', 'Я тебе цветы принёс.', 'Ты сегодня особенно хороша.', 'Может, прогуляемся до реки?', 'У тебя глаза как весеннее небо.'];
const FLIRT_REPLY = ['Ах, перестань…', 'Ну и выдумщик!', 'Может, и прогуляемся.', 'Мама не велит с тобой говорить.', 'Приходи вечером к колодцу.'];
const RUMOR_PREFIX = ['Слыхал, ', 'Говорят, ', 'Люди болтают: ', 'Мне сказали, что ', 'Ты не поверишь — '];
export function rumorPrefix(rng: RNG): string {
  return pick(rng, RUMOR_PREFIX);
}

// Склонение имён (упрощённое)
function accusative(name: string): string {
  if (name.endsWith('а')) return name.slice(0, -1) + 'у';
  if (name.endsWith('я')) return name.slice(0, -1) + 'ю';
  if (name.endsWith('й')) return name.slice(0, -1) + 'я';
  if (/[бвгджзклмнпрстфхцчшщ]$/.test(name)) return name + 'а';
  return name;
}
function dative(name: string): string {
  if (name.endsWith('а')) return name.slice(0, -1) + 'е';
  if (name.endsWith('я')) return name.slice(0, -1) + 'е';
  if (name.endsWith('й')) return name.slice(0, -1) + 'ю';
  if (/[бвгджзклмнпрстфхцчшщ]$/.test(name)) return name + 'у';
  return name;
}
function genitive(name: string): string {
  if (name.endsWith('а')) return name.slice(0, -1) + 'ы';
  if (name.endsWith('я')) return name.slice(0, -1) + 'и';
  if (name.endsWith('й')) return name.slice(0, -1) + 'я';
  if (/[бвгджзклмнпрстфхцчшщ]$/.test(name)) return name + 'а';
  return name;
}

export interface LineCtx {
  sim: Simulation;
  rng: RNG;
  speaker: Citizen;
  listener: Citizen;
}

function fill(t: string, ctx: LineCtx, other?: Citizen): string {
  const { sim, speaker, listener } = ctx;
  let s = t.replace(/\{name\}/g, listener.firstName);
  s = s.replace(/\{sam\}/g, listener.sex === 'f' ? 'сама' : 'сам').replace(/\{friend\}/g, listener.sex === 'f' ? 'подруга' : 'дружище').replace(/\{a\}/g, speaker.sex === 'f' ? 'а' : '');
  if (other) {
    s = s.replace(/\{other\}/g, other.firstName).replace(/\{otherAcc\}/g, accusative(other.firstName)).replace(/\{otherDat\}/g, dative(other.firstName)).replace(/\{otherGen\}/g, genitive(other.firstName));
  }
  if (s.includes('{spouse}')) {
    const sp = speaker.spouse >= 0 ? sim.citizens[speaker.spouse] : null;
    s = s.replace(/\{spouse\}/g, sp ? sp.firstName : 'женой');
  }
  if (s.includes('{tavern}')) {
    const t = sim.world.buildings.filter((b) => b.type === 6);
    s = s.replace(/\{tavern\}/g, t.length ? t[Math.floor(ctx.rng.next() * t.length)].name : 'таверне');
  }
  s = s.replace(/\{meat\}/g, String(priceOf(sim, 'meat')));
  s = s.replace(/\{bread\}/g, String(priceOf(sim, 'bread'))).replace(/\{ale\}/g, String(priceOf(sim, 'ale'))).replace(/\{meal\}/g, String(priceOf(sim, 'bread') + priceOf(sim, 'meat')));
  return s;
}

/** Выбор темы по контексту */
export function pickTopic(ctx: LineCtx, prevTopic: Topic | null, lineIndex: number, total: number, quarrel: boolean): Topic {
  const { rng, speaker, listener } = ctx;
  if (quarrel) return 'quarrel';
  if (lineIndex === 0) return 'greet';
  if (lineIndex === total - 1) return 'bye';
  const kidS = isChild(speaker);
  const kidL = isChild(listener);
  if (kidS && kidL) return 'kids';
  const w: [Topic, number][] = [];
  const n = speaker.needs;
  w.push(['weather', 10]);
  w.push(['work', speaker.workplace >= 0 ? 10 : 4]);
  w.push(['family', 6]);
  w.push(['prices', 6 + (speaker.money < 10 ? 4 : 0)]);
  w.push(['gossip', 8 + (hasTrait(speaker, Trait.Talkative) ? 8 : 0) + (hasTrait(speaker, Trait.Envious) ? 4 : 0)]);
  const mems = speaker.memories.filter((m) => m.importance >= 0.35);
  w.push(['memory', mems.length ? 10 + (hasTrait(speaker, Trait.Talkative) ? 6 : 0) : 0]);
  w.push(['needs', (n.hunger < 35 ? 6 : 0) + (n.energy < 30 ? 4 : 0) + (n.fun < 30 ? 3 : 0) + (speaker.drunk > 40 ? 10 : 0) + (speaker.money < 5 ? 3 : 0)]);
  w.push(['tavern', hasTrait(speaker, Trait.Drunkard) ? 8 : hourOf(ctx.sim.tick) > 15 ? 4 : 1]);
  w.push(['faith', hasTrait(speaker, Trait.Pious) ? 10 : speaker.profession === Profession.Priest ? 12 : 2]);
  w.push(['city', 6 + (hasTrait(speaker, Trait.Gloomy) ? 4 : 0)]);
  w.push(['elder', isElder(speaker) ? 10 : 0]);
  if (!kidS && !kidL && speaker.sex !== listener.sex && speaker.spouse < 0 && listener.spouse < 0 && Math.abs(speaker.age - listener.age) < 12 && speaker.age < 40) w.push(['flirt', 10]);
  if (kidS !== kidL) {
    // взрослый и ребёнок
    return rng.chance(0.5) ? 'kids' : 'family';
  }
  const topics = w.filter((x) => x[1] > 0 && x[0] !== prevTopic);
  const total2 = topics.reduce((a, b) => a + b[1], 0);
  let r = rng.next() * total2;
  for (const [t, wt] of topics) {
    r -= wt;
    if (r <= 0) return t;
  }
  return 'weather';
}

export interface Line {
  text: string;
  topic: Topic;
  /** Затронутый третий житель (для сплетен) */
  about: number;
  /** Переданное воспоминание (слух) */
  rumor?: { text: string; importance: number; about: number; topic?: string };
}

export function makeLine(ctx: LineCtx, topic: Topic, replyTo: Line | null): Line {
  const { sim, rng, speaker, listener } = ctx;
  const rel = relation(speaker, listener.id);
  const relClass = rel >= 30 ? 'friend' : rel <= -25 ? 'foe' : 'neutral';
  const hour = hourOf(sim.tick);
  const line: Line = { text: '', topic, about: -1 };
  switch (topic) {
    case 'greet': {
      if (isChild(speaker) && isChild(listener)) line.text = pick(rng, GREET.kid);
      else if (hour < 10 && rng.chance(0.4)) line.text = pick(rng, GREET.morning);
      else if (hour > 19 && rng.chance(0.4)) line.text = pick(rng, GREET.evening);
      else line.text = pick(rng, GREET[relClass]);
      break;
    }
    case 'bye':
      line.text = pick(rng, BYE[relClass]);
      break;
    case 'weather':
      line.text = pick(rng, WEATHER[sim.season]);
      break;
    case 'work':
      line.text = pick(rng, WORK[speaker.profession] ?? WORK_GENERIC);
      break;
    case 'family': {
      const sp = speaker.spouse >= 0 && sim.citizens[speaker.spouse]?.alive;
      const kids = speaker.children.some((k) => sim.citizens[k]?.alive);
      const par = speaker.parents.some((k) => sim.citizens[k]?.alive);
      const opts: string[] = [];
      if (sp) opts.push(...FAMILY.spouse);
      if (kids) opts.push(...FAMILY.kids);
      if (par) opts.push(...FAMILY.parents);
      if (!opts.length) opts.push(...FAMILY.none);
      line.text = pick(rng, opts);
      break;
    }
    case 'prices':
      line.text = pick(rng, PRICE_TEMPL);
      break;
    case 'gossip': {
      // третий житель, известный говорящему
      const known = [...speaker.relations.entries()].filter(([id, v]) => id !== listener.id && Math.abs(v) >= 15 && sim.citizens[id]?.alive);
      if (!known.length) {
        line.text = pick(rng, CITY_T);
        line.topic = 'city';
        break;
      }
      const [oid, v] = known[Math.floor(rng.next() * known.length)];
      const other = sim.citizens[oid];
      line.about = oid;
      const arr = v > 25 ? GOSSIP.praise : v < -20 ? GOSSIP.blame : GOSSIP.neutral;
      line.text = fill(pick(rng, arr), ctx, other);
      line.rumor = { text: `${fullName(speaker)} ${v > 0 ? 'хвалил' : 'ругал'}${speaker.sex === 'f' ? 'а' : ''} ${accusative(other.firstName)} ${other.lastName}`, importance: 0.2, about: oid, topic: v > 0 ? 'praise' : 'blame' };
      break;
    }
    case 'memory': {
      const mems = speaker.memories.filter((m) => m.importance >= 0.35);
      if (!mems.length) {
        line.text = pick(rng, WEATHER[sim.season]);
        line.topic = 'weather';
        break;
      }
      const m = mems[Math.floor(rng.next() * mems.length)];
      const isRumor = RUMOR_PREFIX.some((p) => m.text.startsWith(p));
      line.text = isRumor ? m.text : `${pick(rng, ['А знаешь, ', 'Представляешь, ', '', 'Вот ещё что: '])}${lowerFirst(m.text)}`;
      line.about = m.about;
      // искажение слуха при передаче
      let txt = isRumor ? m.text : `${rumorPrefix(rng)}${lowerFirst(m.text)}`;
      if (rng.chance(0.25)) txt = distort(rng, txt);
      line.rumor = { text: txt, importance: m.importance * 0.8, about: m.about, topic: m.topic };
      break;
    }
    case 'needs': {
      const n = speaker.needs;
      const opts: string[] = [];
      if (speaker.drunk > 40) opts.push(...NEEDS.drunk);
      if (n.hunger < 35) opts.push(...NEEDS.hunger);
      if (n.energy < 30) opts.push(...NEEDS.energy);
      if (n.fun < 30) opts.push(...NEEDS.fun);
      if (speaker.money < 5) opts.push(...NEEDS.poor);
      if (speaker.money > 80) opts.push(...NEEDS.rich);
      if (n.health < 50) opts.push(...NEEDS.sick);
      if (!opts.length) opts.push(...NEEDS.fun);
      line.text = pick(rng, opts);
      break;
    }
    case 'tavern':
      line.text = fill(pick(rng, TAVERN_INV), ctx);
      break;
    case 'faith':
      line.text = pick(rng, FAITH_T);
      break;
    case 'city':
      line.text = pick(rng, CITY_T);
      break;
    case 'kids':
      line.text = pick(rng, KIDS_T);
      break;
    case 'elder':
      line.text = pick(rng, ELDER_T);
      break;
    case 'flirt':
      line.text = replyTo && replyTo.topic === 'flirt' ? pick(rng, FLIRT_REPLY) : fill(pick(rng, FLIRT), ctx);
      break;
    case 'quarrel':
      line.text = replyTo && replyTo.topic === 'quarrel' ? pick(rng, QUARREL) : pick(rng, QUARREL_OPEN);
      break;
  }
  line.text = fill(line.text, ctx);
  // Ответные реакции на предыдущую реплику (иногда)
  if (replyTo && replyTo.topic !== 'greet' && replyTo.topic !== 'quarrel' && topic !== 'bye' && topic !== 'quarrel' && rng.chance(0.3)) {
    const react = hasTrait(speaker, Trait.Cheerful) ? ['Ха-ха! ', 'Да ну! ', 'Вот это да! '] : hasTrait(speaker, Trait.Gloomy) ? ['Угу. ', 'Ну-ну. ', 'Всё одно. '] : ['Да уж. ', 'И не говори. ', 'Вот и я о том же. ', 'Правда? '];
    line.text = pick(rng, react) + line.text;
  }
  return line;
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Искажение слуха: усиление */
function distort(rng: RNG, t: string): string {
  const subs: [RegExp, string][] = [
    [/подрался/g, 'чуть не убил'], [/украл/g, 'ограбил'], [/поссорил/g, 'подрал'], [/пьян/g, 'мертвецки пьян'],
    [/один/g, 'целый мешок'], [/монет/g, 'золотых'], [/хвалил/g, 'нахваливал'], [/ругал/g, 'проклинал'],
  ];
  for (const [re, to] of subs) if (re.test(t) && rng.chance(0.6)) return t.replace(re, to);
  return t + pick(rng, [' — и не только!', ', и это ещё не всё.', ', ей-богу!']);
}

export const ALMS_GIVE = ['Держи, бедняга.', 'На, возьми.', 'Да поможет тебе Бог.', 'На хлеб.'];
export const ALMS_THANKS = ['Благослови вас Бог!', 'Спасибо, добрый человек!', 'Век не забуду!', 'Храни вас Господь!'];
