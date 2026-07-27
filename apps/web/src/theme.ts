export interface ThemeSettings {
  accent: string;
  /** Fullscreen background style */
  fsStyle: 'aurora' | 'pulse' | 'minimal';
  /** Panel look: solid or translucent glass */
  panels: 'opaque' | 'clear';
}

export const ACCENTS: { name: string; value: string }[] = [
  { name: 'Sky', value: '#8ab4ff' },
  { name: 'Violet', value: '#b18aff' },
  { name: 'Rosé', value: '#ff8ab4' },
  { name: 'Mint', value: '#7dd8a8' },
  { name: 'Amber', value: '#ffc27d' },
  { name: 'Crimson', value: '#ff6b6b' },
];

const KEY = 'baes.theme';

export function loadTheme(): ThemeSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults(), ...(JSON.parse(raw) as Partial<ThemeSettings>) };
  } catch {
    // corrupted — fall through to defaults
  }
  return defaults();
}

function defaults(): ThemeSettings {
  return { accent: '#8ab4ff', fsStyle: 'aurora', panels: 'opaque' };
}

export function applyTheme(t: ThemeSettings): void {
  document.documentElement.style.setProperty('--accent', t.accent);
  document.body.classList.toggle('panels-clear', t.panels === 'clear');
}

export function saveTheme(t: ThemeSettings): void {
  localStorage.setItem(KEY, JSON.stringify(t));
  applyTheme(t);
}
