import { useCallback, useEffect, useState } from 'react';

const KEY = 'rubayos-theme';
const LIGHT = 'rubayos-light';
const DARK = 'rubayos-dark';

function initial() {
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === DARK ? DARK : LIGHT;
}

/** Theme preference only. It is a UI setting, not a credential, so localStorage is fine. */
export function useTheme() {
  const [theme, setTheme] = useState(initial);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === DARK ? LIGHT : DARK)), []);
  return { theme, isDark: theme === DARK, toggle };
}
