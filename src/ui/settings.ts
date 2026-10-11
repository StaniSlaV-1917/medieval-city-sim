// Настройки интерфейса: масштаб, паузы на событиях, субтитры, плотность облачков. Хранятся в localStorage.
export interface UiSettings {
  scale: number;
  pauseOn: Record<string, boolean>;
  subtitles: boolean;
  bubbleDensity: number; // 0.5..2
  toasts: boolean;
}

const KEY = 'waldmark.ui.settings';

export const PAUSE_EVENTS: { id: string; label: string }[] = [
  { id: 'fire', label: 'Пожар' },
  { id: 'disaster', label: 'Бедствие (разбойники, дракон, наводнение)' },
  { id: 'riot', label: 'Бунт и протест' },
  { id: 'death', label: 'Смерть жителя' },
  { id: 'crime', label: 'Тяжкое преступление (взлом, драка)' },
  { id: 'birth', label: 'Рождение' },
  { id: 'wedding', label: 'Свадьба' },
  { id: 'caravan', label: 'Караван' },
];

export const DEFAULT_SETTINGS: UiSettings = {
  scale: 1,
  pauseOn: { fire: true, disaster: true, riot: true, death: false, crime: false, birth: false, wedding: false, caravan: false },
  subtitles: true,
  bubbleDensity: 1,
  toasts: true,
};

export function loadSettings(): UiSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<UiSettings>;
      return { ...DEFAULT_SETTINGS, ...s, pauseOn: { ...DEFAULT_SETTINGS.pauseOn, ...(s.pauseOn ?? {}) } };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS, pauseOn: { ...DEFAULT_SETTINGS.pauseOn } };
}

export function saveSettings(s: UiSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
