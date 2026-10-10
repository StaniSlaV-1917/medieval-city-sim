import { CitySize, CITY_SIZES } from '../world/generator';

const RANDOM_WORDS = ['Вальдмарк', 'Хольцбург', 'Штайнфурт', 'Розенау', 'Айзенберг', 'Грюнвальд', 'Линденхоф', 'Зильберталь', 'Фалькенштайн', 'Кройцбург', 'Мондорф', 'Хиршфельд'];

export function showStartScreen(root: HTMLElement, onStart: (seed: string, size: CitySize) => void, saved: { savedAt: number; load: () => void } | null = null, onImport: (() => Promise<boolean>) | null = null): void {
  const div = document.createElement('div');
  div.id = 'start';
  div.innerHTML = `
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
        ${(Object.keys(CITY_SIZES) as CitySize[]).map((k) => `<option value="${k}" ${k === 'medium' ? 'selected' : ''}>${CITY_SIZES[k].name} (${CITY_SIZES[k].tiles}×${CITY_SIZES[k].tiles})</option>`).join('')}
      </select>
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
    div.remove();
    onStart(seed, size);
  };
  div.querySelector('#go')!.addEventListener('click', go);
  div.querySelector('#cont')?.addEventListener('click', () => {
    div.remove();
    saved!.load();
  });
  div.querySelector('#imp')!.addEventListener('click', async () => {
    if (onImport && (await onImport())) div.remove();
  });
  seedInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go();
  });
  seedInput.focus();
}
