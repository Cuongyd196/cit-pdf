import { getStoredItem, setStoredItem } from '../utils/safe-storage.js';

export type Theme = 'light' | 'dark';
/** What the user chose: a theme, or whatever the OS uses. */
export type ThemePreference = Theme | 'system';

const THEME_KEY = 'cit:theme';
// The app was dark-only at first; people who never chose keep it.
const DEFAULT_PREFERENCE: ThemePreference = 'dark';
const OS_LIGHT = '(prefers-color-scheme: light)';

/** Fired on document after the theme changes, so other controls can sync. */
export const THEME_EVENT = 'cit:theme-change';

/** The theme on screen. */
export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function themePreference(): ThemePreference {
  const stored = getStoredItem(THEME_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system'
    ? stored
    : DEFAULT_PREFERENCE;
}

function resolve(preference: ThemePreference): Theme {
  if (preference !== 'system') return preference;
  return window.matchMedia?.(OS_LIGHT).matches ? 'light' : 'dark';
}

function apply(): void {
  if (resolve(themePreference()) === 'light') {
    document.documentElement.dataset.theme = 'light';
  } else {
    delete document.documentElement.dataset.theme;
  }
  document.dispatchEvent(new CustomEvent(THEME_EVENT));
}

export function setThemePreference(preference: ThemePreference): void {
  setStoredItem(THEME_KEY, preference);
  apply();
}

/** Follows the OS while the preference is "system". */
export function initTheme(): void {
  window.matchMedia?.(OS_LIGHT).addEventListener('change', () => {
    if (themePreference() === 'system') apply();
  });
  apply();
}
