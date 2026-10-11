import { CitySize, CITY_SIZES } from '../world/generator';
import { StartScene } from './startScene';

const RANDOM_WORDS = ['Вальдмарк', 'Хольцбург', 'Штайнфурт', 'Розенау', 'Айзенберг', 'Грюнвальд', 'Линденхоф', 'Зильберталь', 'Фалькенштайн', 'Кройцбург', 'Мондорф', 'Хиршфельд'];

export function showStartScreen(root: HTMLElement, onStart: (seed: string, size: CitySize, fog: boolean) => void, saved: { savedAt: number; load: () => void } | null = null, onImport: (() => Promise<boolean>) | null = null): void {
  const div = document.createElement('div');
  div.id = 'start';
  div.innerHTML = `
    <div class="scene-wrap"></div>
    <div class="panel">
      <h1>Вальдмарк</h1>
      <p class="sub">живой средневековый город, за которым можно наблюдать часами</p>
      <label for="seed">Сид города</label>
      <div class="row">
        <input id="seed" type="text" placeholder="любое слово или число" />
        <button class="btn" id="rnd" style="flex:0 0 auto">Случайный</button>
      </div>
      <label for="size">Размер города</label>
      <select id="size">
        ${(Object.keys(CITY_SIZES) as CitySize[]).map((k) => `<option value="${k}" ${k === 'medium' ? 'selected' : ''}>${CITY_SIZES[k].name} карта (${CITY_SIZES[k].tiles}×${CITY_SIZES[k].tiles}), город ${CITY_SIZES[k].city === 128 ? 'малый' : CITY_SIZES[k].city === 160 ? 'средний' : 'большой'}</option>`).join('')}
      </select>
      <label class="chk" style="margin-top:10px;font-weight:normal"><input type="checkbox" id="fog"> Туман неизведанного — окрестности открывают горожане и рудознатцы</label>
      <div style="margin-top:18px"><button class="btn primary" id="go" style="width:100%;font-size:18px">Основать город</button></div>
      <div class="row" style="margin-top:8px">
        ${saved ? `<button class="btn" id="cont">Продолжить (автосейв ${new Date(saved.savedAt).toLocaleString('ru-RU')})</button>` : ''}
        <button class="btn" id="imp" style="flex:0 0 auto">Загрузить из файла…</button>
      </div>
      <div class="hint">
        <kbd>WASD</kbd>/<kbd>стрелки</kbd> или перетаскивание мышью — камера, <kbd>колесо</kbd> — зум,
        <kbd>пробел</kbd> — пауза, <kbd>1</kbd>–<kbd>4</kbd> — скорость, <kbd>F</kbd> — следовать за выбранным, <kbd>Esc</kbd> — снять выделение.
        Клик по жителю или зданию — карточка.
      </div>
    </div>`;
  root.appendChild(div);
  const scene = new StartScene(div.querySelector('.scene-wrap')!);
  const seedInput = div.querySelector<HTMLInputElement>('#seed')!;
  const sizeSel = div.querySelector<HTMLSelectElement>('#size')!;
  const randomSeed = () => {
    const w = RANDOM_WORDS[Math.floor(Math.random() * RANDOM_WORDS.length)];
    seedInput.value = `${w}-${Math.floor(Math.random() * 9000 + 1000)}`;
  };
  randomSeed();
  div.querySelector('#rnd')!.addEventListener('click', randomSeed);
  const go = () => {
    const seed = seedInput.value.trim() || 'Вальдмарк';
    const size = sizeSel.value as CitySize;
    const fog = div.querySelector<HTMLInputElement>('#fog')!.checked;
    scene.stop();
    div.remove();
    onStart(seed, size, fog);
  };
  div.querySelector('#go')!.addEventListener('click', go);
  div.querySelector('#cont')?.addEventListener('click', () => {
    scene.stop();
    div.remove();
    saved!.load();
  });
  div.querySelector('#imp')!.addEventListener('click', async () => {
    if (onImport && (await onImport())) {
      scene.stop();
      div.remove();
    }
  });
  seedInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go();
  });
  seedInput.focus();
}
