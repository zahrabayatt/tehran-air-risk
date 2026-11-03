import { useCallback, useState } from 'react';

export type Theme = 'light' | 'asphalt';
export const THEME_KEY = 'tar-theme';

export function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'asphalt' ? 'asphalt' : 'light';
  } catch {
    return 'light';
  }
}

function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage can be blocked; the theme still works for this visit */
  }
}

/** Light or asphalt, remembered across visits when storage is available. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const toggle = useCallback(() => {
    const next: Theme = theme === 'light' ? 'asphalt' : 'light';
    storeTheme(next);
    setTheme(next);
  }, [theme]);
  return { theme, toggle };
}
