import { setStoredItem } from '../utils/safe-storage.js';

export type Theme = 'light' | 'dark';

const THEME_KEY = 'cit:theme';

/** Fired on document after the theme changes, so other controls can sync. */
export const THEME_EVENT = 'cit:theme-change';

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function setTheme(theme: Theme): void {
  if (theme === 'light') {
    document.documentElement.dataset.theme = 'light';
  } else {
    delete document.documentElement.dataset.theme;
  }
  setStoredItem(THEME_KEY, theme);
  document.dispatchEvent(new CustomEvent(THEME_EVENT));
}
