// Реплики жителей: выбор темы по контексту, многоходовые разговоры (приветствие → тема → ответ → … → прощание),
// голос по профессии/чертам/настроению, подстановка имён, цен, погоды, строек и событий хроники.
import type { Simulation } from '../sim/game';
import { Citizen, Profession, Trait, hasTrait, isChild, isElder, relation, fullName } from '../sim/citizen';
import { Season, hourOf, TICKS_PER_DAY } from '../core/time';
import { RNG } from '../core/rng';
import { priceOf } from './actions';
import { BUILDING_DEFS, DISTRICT_NAMES } from '../world/buildings';
import { EventKind } from '../events/chronicle';
import * as D from './dialogueData';

export type Topic =
  | 'greet' | 'weather' | 'work' | 'family' | 'prices' | 'gossip' | 'memory' | 'needs' | 'tavern' | 'faith' | 'city' | 'kids' | 'bye'
  | 'quarrel' | 'flirt' | 'elder' | 'harvest' | 'edicts' | 'building' | 'trade' | 'news' | 'fear' | 'tale' | 'joke' | 'makeup';

export type Emotion = 'none' | 'happy' | 'angry' | 'sad' | 'love' | 'fear' | 'question' | 'laugh' | 'think';

const pick = (rng: RNG, arr: string[]) => arr[Math.floor(rng.next() * arr.length)];

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
function instrumental(name: string): string {
  if (name.endsWith('а')) return name.slice(0, -1) + 'ой';
  if (name.endsWith('я')) return name.slice(0, -1) + 'ей';
  if (name.endsWith('й')) return name.slice(0, -1) + 'ем';
  if (/[бвгджзклмнпрстфхцчшщ]$/.test(name)) return name + 'ом';
  return name;
}

export interface LineCtx {
  sim: Simulation;
  rng: RNG;
  speaker: Citizen;
  listener: Citizen;
}

function fill(t: string, ctx: LineCtx, other?: Citizen): string {
  const { sim, speaker, listener, rng } = ctx;
  let s = t.replace(/\{name\}/g, listener.firstName);
  const f = speaker.sex === 'f';
  s = s.replace(/\{sam\}/g, listener.sex === 'f' ? 'сама' : 'сам').replace(/\{friend\}/g, listener.sex === 'f' ? 'подруга' : 'дружище').replace(/\{a\}/g, f ? 'а' : '');
  s = s.replace(/\{la\}/g, f ? 'ла' : '').replace(/\{el\}/g, f ? 'ла' : 'ёл').replace(/\{sya\}/g, f ? 'ась' : 'ся').replace(/\{odin\}/g, f ? 'Одна' : 'Один').replace(/\{odinL\}/g, f ? 'одна' : 'один').replace(/\{milyi\}/g, listener.sex === 'f' ? 'Милая' : 'Милый');
  if (other) {
    s = s.replace(/\{other\}/g, other.firstName).replace(/\{otherAcc\}/g, accusative(other.firstName)).replace(/\{otherDat\}/g, dative(other.firstName)).replace(/\{otherGen\}/g, genitive(other.firstName)).replace(/\{otherInst\}/g, instrumental(other.firstName));
  }
  if (s.includes('{spouse}')) {
    const sp = speaker.spouse >= 0 ? sim.citizens[speaker.spouse] : null;
    s = s.replace(/\{spouse\}/g, sp ? sp.firstName : speaker.sex === 'm' ? 'жена' : 'муж');
  }
  if (s.includes('{tavern}')) {
    const t = sim.world.buildings.filter((b) => b.type === 6 && b.condition > 0);
    s = s.replace(/\{tavern\}/g, t.length ? t[Math.floor(rng.next() * t.length)].name : 'таверне');
  }
  if (s.includes('{work}')) {
    const wp = speaker.workplace >= 0 ? sim.world.buildings[speaker.workplace] : listener.workplace >= 0 ? sim.world.buildings[listener.workplace] : null;
    s = s.replace(/\{work\}/g, wp ? (wp.name ? `«${wp.name}»` : BUILDING_DEFS[wp.type].name.toLowerCase()) : 'цехе');
  }
  if (s.includes('{site}') || s.includes('{district}')) {
    const sites = sim.world.buildings.filter((b) => b.w > 0 && b.underConstruction !== undefined);
    const site = sites.length ? sites[Math.floor(rng.next() * sites.length)] : null;
    s = s.replace(/\{site\}/g, site ? BUILDING_DEFS[site.type].name.toLowerCase() : 'дом');
    const d = site ? site.district : speaker.home >= 0 ? sim.world.buildings[speaker.home].district : 0;
    s = s.replace(/\{district\}/g, DISTRICT_NAMES[d].toLowerCase());
  }
  s = s.replace(/\{city\}/g, sim.seedText);
  s = s.replace(/\{tax\}/g, `${Math.round(sim.taxRate * 100)}%`);
  s = s.replace(/\{temp\}/g, `${Math.round(sim.weather.temp)}°`);
  s = s.replace(/\{wage\}/g, '7');
  s = s.replace(/\{meat\}/g, String(priceOf(sim, 'meat')));
  s = s.replace(/\{bread\}/g, String(priceOf(sim, 'bread'))).replace(/\{ale\}/g, String(priceOf(sim, 'ale'))).replace(/\{meal\}/g, String(priceOf(sim, 'bread') + priceOf(sim, 'meat')));
  return s;
}

/** Темы, на которые есть осмысленный ответ собеседника */
const REPLYABLE: Partial<Record<Topic, true>> = { weather: true, work: true, harvest: true, prices: true, family: true, gossip: true, needs: true, tavern: true, faith: true, city: true, edicts: true, building: true, trade: true, news: true, fear: true, flirt: true, kids: true, elder: true, tale: true, joke: true, memory: true };

/** Есть ли в городе повод для страха */
function fearKind(sim: Simulation): keyof typeof D.FEAR | null {
  if (sim.dragon) return 'dragon';
  if (sim.fires.length) return 'fire';
  if (sim.raid) return 'raid';
  if (sim.protest) return 'riot';
  if (sim.flood) return 'flood';
  const sick = sim.citizens.reduce((n, c) => n + (c.alive && c.flags & 4 ? 1 : 0), 0);
  if (sick >= Math.max(3, sim.stats.population * 0.05)) return 'epidemic';
  if (sim.unrest > 60) return 'unrest';
  return null;
}

/** Выбор темы по контексту. prevTopic — тема предыдущей реплики собеседника. */
export function pickTopic(ctx: LineCtx, prevTopic: Topic | null, lineIndex: number, total: number, quarrel: boolean): Topic {
  const { rng, speaker, listener, sim } = ctx;
  if (quarrel) return 'quarrel';
  if (lineIndex === 0) return 'greet';
  if (lineIndex === total - 1) return 'bye';
  const kidS = isChild(speaker);
  const kidL = isChild(listener);
  if (kidS && kidL) return 'kids';
  if (kidS !== kidL) return rng.chance(0.6) ? 'kids' : 'family';
  // Ответ на реплику собеседника — чаще всего; тема остаётся той же (makeLine выдаст ответную фразу)
  if (prevTopic && REPLYABLE[prevTopic] && prevTopic !== 'greet' && rng.chance(0.78)) return prevTopic;
  const w: [Topic, number][] = [];
  const n = speaker.needs;
  const fear = fearKind(sim);
  w.push(['fear', fear ? 30 : 0]);
  w.push(['weather', 8 + (sim.weather.rain > 0.4 || sim.weather.snow > 0.3 || sim.weather.storm > 0.3 ? 8 : 0)]);
  w.push(['work', speaker.workplace >= 0 ? 10 : 5]);
  w.push(['family', 6]);
  w.push(['prices', 6 + (speaker.money < 10 ? 4 : 0) + (priceOf(sim, 'bread') >= 2 ? 6 : 0)]);
  w.push(['harvest', speaker.profession === Profession.Farmer || speaker.profession === Profession.Miller || speaker.profession === Profession.Baker ? 10 : 3]);
  w.push(['gossip', 7 + (hasTrait(speaker, Trait.Talkative) ? 8 : 0) + (hasTrait(speaker, Trait.Envious) ? 4 : 0)]);
  const mems = speaker.memories.filter((m) => m.importance >= 0.35);
  w.push(['memory', mems.length ? 8 + (hasTrait(speaker, Trait.Talkative) ? 6 : 0) : 0]);
  const fresh = sim.chronicle.events.length && sim.tick - sim.chronicle.events[sim.chronicle.events.length - 1].tick < TICKS_PER_DAY * 2;
  w.push(['news', fresh ? 8 + (hasTrait(speaker, Trait.Curious) ? 6 : 0) + (speaker.profession === Profession.Herald || speaker.profession === Profession.Innkeeper ? 8 : 0) : 0]);
  w.push(['needs', (n.hunger < 35 ? 6 : 0) + (n.energy < 30 ? 4 : 0) + (n.fun < 30 ? 3 : 0) + (speaker.drunk > 40 ? 10 : 0) + (speaker.money < 5 ? 3 : 0) + (speaker.flags & 4 ? 6 : 0) + (speaker.flags & 8 ? 4 : 0)]);
  w.push(['tavern', hasTrait(speaker, Trait.Drunkard) ? 8 : hourOf(sim.tick) > 15 ? 4 : 1]);
  w.push(['faith', hasTrait(speaker, Trait.Pious) ? 10 : speaker.profession === Profession.Priest || speaker.profession === Profession.Monk ? 12 : 2]);
  w.push(['city', 4 + (hasTrait(speaker, Trait.Gloomy) ? 4 : 0)]);
  w.push(['edicts', 4 + (sim.taxRate >= 0.18 ? 10 : 0) + (sim.taxRate <= 0.04 ? 3 : 0) + (speaker.profession === Profession.Burgomaster || speaker.profession === Profession.Noble ? 4 : 0)]);
  const sites = sim.world.buildings.some((b) => b.w > 0 && b.underConstruction !== undefined);
  w.push(['building', (sites ? 6 : 2) + (speaker.profession === Profession.Carpenter || speaker.profession === Profession.Mason || speaker.profession === Profession.Laborer ? 6 : 0)]);
  w.push(['trade', (sim.caravan ? 12 : 3) + (speaker.profession === Profession.Merchant ? 8 : 0)]);
  w.push(['elder', isElder(speaker) ? 10 : 0]);
  w.push(['tale', (isElder(speaker) ? 6 : 2) + (speaker.profession === Profession.Bard || speaker.profession === Profession.Innkeeper ? 8 : 0) + (hourOf(sim.tick) > 18 ? 2 : 0)]);
  w.push(['joke', (hasTrait(speaker, Trait.Cheerful) ? 10 : 3) + (speaker.profession === Profession.Bard ? 6 : 0) + (speaker.drunk > 30 ? 4 : 0) - (hasTrait(speaker, Trait.Gloomy) ? 3 : 0)]);
  if (!kidS && !kidL && speaker.sex !== listener.sex && speaker.spouse < 0 && listener.spouse < 0 && Math.abs(speaker.age - listener.age) < 12 && speaker.age < 40) w.push(['flirt', 10]);
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
  /** Эмоция для облачка */
  emo: Emotion;
  /** Это ответ на реплику собеседника */
  reply?: boolean;
  /** Переданное воспоминание (слух) */
  rumor?: { text: string; importance: number; about: number; topic?: string };
}

function weatherLine(ctx: LineCtx): string {
  const { sim, rng } = ctx;
  const w = sim.weather;
  const opts: string[] = [];
  if (w.storm > 0.3 && w.rain > 0.3) opts.push(...D.WEATHER_NOW.storm);
  else if (w.rain > 0.3) opts.push(...D.WEATHER_NOW.rain);
  if (w.snow > 0.3) opts.push(...D.WEATHER_NOW.snow);
  if (w.fog > 0.4) opts.push(...D.WEATHER_NOW.fog);
  if (w.wind > 0.65) opts.push(...D.WEATHER_NOW.wind);
  if (w.temp > 27) opts.push(...D.WEATHER_NOW.heat);
  if (w.temp < -8) opts.push(...D.WEATHER_NOW.frost);
  if (!opts.length && w.rain < 0.1 && w.fog < 0.2 && w.temp > 8 && w.temp < 26 && rng.chance(0.4)) opts.push(...D.WEATHER_NOW.nice);
  if (!opts.length || rng.chance(0.4)) opts.push(...D.WEATHER_SEASON[sim.season]);
  return pick(rng, opts);
}

function replyLine(ctx: LineCtx, topic: Topic, prev: Line): string | null {
  const { rng, speaker, sim } = ctx;
  switch (topic) {
    case 'weather': return pick(rng, D.WEATHER_REPLY);
    case 'work': return pick(rng, D.WORK_REPLY);
    case 'harvest': return pick(rng, D.HARVEST_REPLY);
    case 'prices': return pick(rng, D.PRICES_REPLY);
    case 'family': return pick(rng, D.FAMILY.reply);
    case 'gossip': return prev.about >= 0 && sim.citizens[prev.about] ? fill(pick(rng, D.GOSSIP.reply), ctx, sim.citizens[prev.about]) : pick(rng, D.GOSSIP.reply.filter((s) => !s.includes('{other')));
    case 'memory': return pick(rng, D.NEWS_REPLY);
    case 'needs': return pick(rng, D.NEEDS.reply);
    case 'tavern': return pick(rng, D.TAVERN_REPLY);
    case 'faith': return pick(rng, D.FAITH_REPLY);
    case 'city': return pick(rng, D.CITY_REPLY);
    case 'edicts': return pick(rng, D.EDICTS.reply);
    case 'building': return pick(rng, D.BUILDING_REPLY);
    case 'trade': return pick(rng, D.TRADE.reply);
    case 'news': return rng.chance(0.5) ? pick(rng, D.NEWS_REPLY) : pick(rng, D.NEWS_REACT[prev.rumor ? 1 : 0] ?? D.NEWS_REACT[0]);
    case 'fear': return pick(rng, D.FEAR.reply);
    case 'flirt': return pick(rng, D.FLIRT_REPLY);
    case 'kids': return isChild(speaker) ? pick(rng, D.KIDS_REPLY) : pick(rng, D.ADULT_TO_KID);
    case 'elder': return pick(rng, D.ELDER_REPLY);
    case 'tale': return pick(rng, D.TALES_REPLY);
    case 'joke': return pick(rng, D.JOKE_REACT);
    default: return null;
  }
}

/** Эмоция по теме и содержанию */
function emotionFor(topic: Topic, text: string, isReply: boolean, speaker: Citizen): Emotion {
  switch (topic) {
    case 'quarrel': return 'angry';
    case 'flirt': return 'love';
    case 'fear': return 'fear';
    case 'joke': return isReply ? (/ха|умора|смешно|не могу/i.test(text) ? 'laugh' : 'none') : 'happy';
    case 'needs': return speaker.drunk > 40 ? 'happy' : 'sad';
    case 'makeup': return 'happy';
    case 'tale': return isReply ? 'none' : 'think';
    case 'greet': return speaker.mood > 20 ? 'happy' : 'none';
    default:
      if (text.endsWith('?')) return 'question';
      if (/ха-ха|хе-хе/i.test(text)) return 'laugh';
      if (speaker.mood < -30) return 'sad';
      return 'none';
  }
}

export function makeLine(ctx: LineCtx, topic: Topic, replyTo: Line | null): Line {
  const { sim, rng, speaker, listener } = ctx;
  const rel = relation(speaker, listener.id);
  const relClass = rel >= 30 ? 'friend' : rel <= -25 ? 'foe' : 'neutral';
  const hour = hourOf(sim.tick);
  const line: Line = { text: '', topic, about: -1, emo: 'none' };
  // Ответ на реплику собеседника по той же теме
  if (replyTo && replyTo.topic === topic && !replyTo.reply && REPLYABLE[topic]) {
    const r = replyLine(ctx, topic, replyTo);
    if (r) {
      line.text = fill(r, ctx);
      line.reply = true;
      line.about = replyTo.about;
      line.emo = emotionFor(topic, line.text, true, speaker);
      return voice(ctx, line);
    }
  }
  switch (topic) {
    case 'greet': {
      const w = sim.weather;
      if (isChild(speaker) && isChild(listener)) line.text = pick(rng, D.GREET.kid);
      else if (w.rain > 0.4 && rng.chance(0.5)) line.text = pick(rng, D.GREET.rain);
      else if (w.temp < -5 && rng.chance(0.5)) line.text = pick(rng, D.GREET.cold);
      else if (hour < 10 && rng.chance(0.4)) line.text = pick(rng, D.GREET.morning);
      else if (hour > 19 && rng.chance(0.4)) line.text = pick(rng, D.GREET.evening);
      else line.text = pick(rng, D.GREET[relClass]);
      break;
    }
    case 'bye':
      if (isChild(speaker)) line.text = pick(rng, D.BYE.kid);
      else if (speaker.action === 'work' || (speaker.needs.hunger < 30 && rng.chance(0.5))) line.text = pick(rng, D.BYE.hurry);
      else line.text = pick(rng, D.BYE[relClass]);
      break;
    case 'weather':
      line.text = weatherLine(ctx);
      break;
    case 'work':
      line.text = pick(rng, D.WORK[speaker.profession] ?? D.WORK_GENERIC);
      break;
    case 'harvest': {
      const yf = sim.market.yearFactor;
      const arr = sim.season === Season.Winter || sim.season === Season.Spring ? (rng.chance(0.5) ? D.HARVEST.season : yf < 0.8 ? D.HARVEST.poor : yf > 1.2 ? D.HARVEST.rich : D.HARVEST.normal) : yf < 0.8 ? D.HARVEST.poor : yf > 1.2 ? D.HARVEST.rich : rng.chance(0.4) ? D.HARVEST.season : D.HARVEST.normal;
      line.text = pick(rng, arr);
      break;
    }
    case 'family': {
      const spAlive = speaker.spouse >= 0 && sim.citizens[speaker.spouse]?.alive;
      const widowed = speaker.spouse >= 0 && !spAlive;
      const kids = speaker.children.some((k) => sim.citizens[k]?.alive);
      const par = speaker.parents.some((k) => sim.citizens[k]?.alive);
      const opts: string[] = [];
      if (spAlive) opts.push(...D.FAMILY.spouse, ...(rng.chance(0.3) ? D.MARRIED : []));
      if (widowed) opts.push(...D.FAMILY.widow);
      if (kids) opts.push(...D.FAMILY.kids);
      if (par) opts.push(...D.FAMILY.parents);
      if (!opts.length) opts.push(...D.FAMILY.none);
      line.text = pick(rng, opts);
      break;
    }
    case 'prices':
      line.text = pick(rng, D.PRICES);
      break;
    case 'gossip': {
      const known = [...speaker.relations.entries()].filter(([id, v]) => id !== listener.id && Math.abs(v) >= 15 && sim.citizens[id]?.alive);
      if (!known.length) {
        line.text = pick(rng, D.CITY);
        line.topic = 'city';
        break;
      }
      const [oid, v] = known[Math.floor(rng.next() * known.length)];
      const other = sim.citizens[oid];
      line.about = oid;
      const arr = v > 25 ? D.GOSSIP.praise : v < -20 ? D.GOSSIP.blame : D.GOSSIP.neutral;
      line.text = fill(pick(rng, arr), ctx, other);
      line.rumor = { text: `${fullName(speaker)} ${v > 0 ? 'хвалил' : 'ругал'}${speaker.sex === 'f' ? 'а' : ''} ${accusative(other.firstName)} ${other.lastName}`, importance: 0.2, about: oid, topic: v > 0 ? 'praise' : 'blame' };
      break;
    }
    case 'memory': {
      const mems = speaker.memories.filter((m) => m.importance >= 0.35);
      if (!mems.length) {
        line.text = weatherLine(ctx);
        line.topic = 'weather';
        break;
      }
      const m = mems[Math.floor(rng.next() * mems.length)];
      const isRumor = RUMOR_PREFIX.some((p) => m.text.startsWith(p));
      line.text = isRumor ? m.text : `${pick(rng, ['А знаешь, ', 'Представляешь, ', '', 'Вот ещё что: '])}${lowerFirst(m.text)}`;
      line.about = m.about;
      let txt = isRumor ? m.text : `${rumorPrefix(rng)}${lowerFirst(m.text)}`;
      if (rng.chance(0.25)) txt = distort(rng, txt);
      line.rumor = { text: txt, importance: m.importance * 0.8, about: m.about, topic: m.topic };
      break;
    }
    case 'news': {
      // свежее событие хроники, желательно важное и не про самих собеседников
      const recent = sim.chronicle.events.filter((e) => sim.tick - e.tick < TICKS_PER_DAY * 2 && e.importance >= 0.3 && !e.actors.includes(speaker.id) && !e.actors.includes(listener.id));
      if (!recent.length) {
        line.text = pick(rng, D.CITY);
        line.topic = 'city';
        break;
      }
      const e = recent[Math.floor(rng.next() * Math.min(recent.length, 12) + Math.max(0, recent.length - 12))];
      const god = D.GOD_REACT.find((g) => g.re.test(e.text));
      if (god && rng.chance(0.6)) line.text = pick(rng, god.lines);
      else {
        const t = e.text.replace(/\.$/, '');
        line.text = `${pick(rng, D.NEWS_PREFIX)}${lowerFirst(t)}. ${pick(rng, D.NEWS_REACT[e.kind as number] ?? D.NEWS_REACT[0])}`;
      }
      line.about = e.actors[0] ?? -1;
      line.rumor = { text: `${rumorPrefix(rng)}${lowerFirst(e.text)}`, importance: Math.min(0.6, e.importance), about: e.actors[0] ?? -1, topic: e.kind === EventKind.Crime ? 'blame' : undefined };
      break;
    }
    case 'needs': {
      const n = speaker.needs;
      const opts: string[] = [];
      if (speaker.drunk > 40) opts.push(...D.NEEDS.drunk);
      if (n.hunger < 35) opts.push(...D.NEEDS.hunger);
      if (n.energy < 30) opts.push(...D.NEEDS.energy);
      if (n.fun < 30) opts.push(...D.NEEDS.fun);
      if (n.social < 30) opts.push(...D.NEEDS.social);
      if (n.safety < 35) opts.push(...D.NEEDS.safety);
      if (n.faith < 25) opts.push(...D.NEEDS.faith);
      if (speaker.money < 5) opts.push(...D.NEEDS.poor);
      if (speaker.money > 80) opts.push(...D.NEEDS.rich);
      if (n.health < 50 || speaker.flags & 4) opts.push(...D.NEEDS.sick);
      if (speaker.flags & 8) opts.push(...D.NEEDS.injured);
      if (!opts.length) opts.push(...D.NEEDS.fun);
      line.text = pick(rng, opts);
      break;
    }
    case 'tavern':
      line.text = pick(rng, D.TAVERN);
      break;
    case 'faith':
      line.text = pick(rng, D.FAITH);
      break;
    case 'city':
      line.text = pick(rng, D.CITY);
      break;
    case 'edicts': {
      const opts: string[] = [];
      if (sim.taxRate >= 0.16) opts.push(...D.EDICTS.taxHigh);
      else if (sim.taxRate <= 0.05) opts.push(...D.EDICTS.taxLow);
      const guards = sim.citizens.reduce((k, c) => k + (c.alive && c.profession === Profession.Guard ? 1 : 0), 0);
      const pop = Math.max(1, sim.stats.population);
      if (guards / pop < 0.02) opts.push(...D.EDICTS.guardsFew);
      else if (guards / pop > 0.05) opts.push(...D.EDICTS.guardsMany);
      if (sim.lastCharity > 0) opts.push(...D.EDICTS.charity);
      if (!opts.length) opts.push(...D.CITY, ...D.EDICTS.taxHigh.slice(0, 2));
      line.text = pick(rng, opts);
      break;
    }
    case 'building': {
      const sites = sim.world.buildings.some((b) => b.w > 0 && b.underConstruction !== undefined);
      line.text = pick(rng, sites ? D.BUILDING : D.BUILDING_NONE);
      break;
    }
    case 'trade':
      line.text = pick(rng, sim.caravan ? D.TRADE.caravan : rng.chance(0.5) ? D.TRADE.expect : D.TRADE.export);
      break;
    case 'fear': {
      const k = fearKind(sim) ?? 'unrest';
      line.text = pick(rng, D.FEAR[k]);
      break;
    }
    case 'kids':
      line.text = isChild(speaker) ? (isChild(listener) ? pick(rng, D.KIDS) : pick(rng, D.KID_TO_ADULT)) : pick(rng, D.ADULT_TO_KID);
      break;
    case 'elder':
      line.text = pick(rng, D.ELDER);
      break;
    case 'tale':
      line.text = pick(rng, D.TALES);
      break;
    case 'joke':
      line.text = pick(rng, D.JOKES);
      break;
    case 'flirt':
      line.text = replyTo && replyTo.topic === 'flirt' ? pick(rng, D.FLIRT_REPLY) : pick(rng, D.FLIRT);
      break;
    case 'quarrel':
      line.text = replyTo && replyTo.topic === 'quarrel' ? (rng.chance(0.3) ? pick(rng, D.QUARREL_REPLY) : pick(rng, D.QUARREL)) : pick(rng, D.QUARREL_OPEN);
      break;
    case 'makeup':
      line.text = pick(rng, D.MAKEUP);
      break;
  }
  line.text = fill(line.text, ctx);
  line.emo = emotionFor(line.topic, line.text, false, speaker);
  return voice(ctx, line);
}

/** Голос говорящего: реакции на предыдущее, вставки по чертам и профессии, настроение */
function voice(ctx: LineCtx, line: Line): Line {
  const { rng, speaker } = ctx;
  if (line.topic === 'greet' || line.topic === 'bye' || line.topic === 'quarrel' || line.topic === 'joke' || line.topic === 'tale') return line;
  let t = line.text;
  const kid = isChild(speaker);
  // Реакция-междометие перед ответом
  if (line.reply && rng.chance(0.35)) {
    const arr = kid ? D.REACT.kid : speaker.drunk > 40 ? D.REACT.drunk : hasTrait(speaker, Trait.Cheerful) ? D.REACT.cheerful : hasTrait(speaker, Trait.Gloomy) ? D.REACT.gloomy : hasTrait(speaker, Trait.Pious) && rng.chance(0.5) ? D.REACT.pious : D.REACT.neutral;
    t = pick(rng, arr) + lowerFirst(t);
  }
  // Черты характера
  if (!kid && rng.chance(0.18) && speaker.traits.length) {
    const tr = speaker.traits[Math.floor(rng.next() * speaker.traits.length)];
    const v = D.VOICE_TRAIT[tr as number];
    if (v) {
      if (rng.chance(0.5)) t = fill(pick(rng, v.pre), ctx) + lowerFirst(t);
      else t = t + fill(pick(rng, v.post), ctx);
    }
  }
  // Профессия
  const vp = D.VOICE_PROF[speaker.profession];
  if (!kid && vp && rng.chance(0.12)) t = t + pick(rng, vp);
  // Настроение
  if (!kid && speaker.mood < -40 && rng.chance(0.25)) t = pick(rng, ['Эх… ', 'Тоска. ', 'Ох… ']) + lowerFirst(t);
  if (speaker.drunk > 60 && rng.chance(0.4)) t = t.replace(/с/g, 'ш').replace(/С/g, 'Ш');
  line.text = t;
  return line;
}

function lowerFirst(s: string): string {
  if (s.startsWith('{')) return s;
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

export const ALMS_GIVE = ['Держи, бедняга.', 'На, возьми.', 'Да поможет тебе Бог.', 'На хлеб.', 'Возьми, не благодари.', 'Храни тебя Господь, бедняга.'];
export const ALMS_THANKS = ['Благослови вас Бог!', 'Спасибо, добрый человек!', 'Век не забуду!', 'Храни вас Господь!', 'Дай вам Бог здоровья!', 'Спасибо, кормилец!'];

/** Сколько всего шаблонов реплик в банке (для теста и отчёта) */
export function dialogueLineCount(): number {
  let n = 0;
  const walk = (v: unknown): void => {
    if (typeof v === 'string') n++;
    else if (Array.isArray(v)) for (const x of v) walk(x);
    else if (v && typeof v === 'object') for (const x of Object.values(v as Record<string, unknown>)) walk(x);
  };
  const data = D as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(data)) {
    if (k === 'GOD_REACT') for (const g of v as { lines: string[] }[]) walk(g.lines);
    else walk(v);
  }
  walk(RUMOR_PREFIX);
  walk(ALMS_GIVE);
  walk(ALMS_THANKS);
  return n;
}
