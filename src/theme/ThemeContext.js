import { createContext, useContext, useEffect, useState } from 'react';

// Kept in sync with public/index.html's pre-paint script, which reads this
// same key to set [data-theme] before React ever mounts (avoids a flash of
// the wrong theme on load). This is the only place after that which needs
// to touch localStorage or the <html> attribute.
const STORAGE_KEY = 'nq-theme';

function resolveInitialTheme() {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const ThemeContext = createContext({ theme: 'light', toggleTheme: () => {} });
export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(resolveInitialTheme);

  // Mirrors state -> DOM on every change, but deliberately does NOT write
  // to localStorage here -- that only happens on an explicit toggleTheme()
  // call below. Otherwise the very first render (theme resolved purely
  // from the OS preference) would immediately "lock in" that value as if
  // the user had chosen it, breaking the live-follow-system behavior.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Only follow the OS/browser preference live if the user has never made
  // an explicit choice here -- once they pick, that choice sticks.
  useEffect(() => {
    if (window.localStorage.getItem(STORAGE_KEY)) return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = e => setTheme(e.matches ? 'dark' : 'light');
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);

  const toggleTheme = () => {
    setTheme(t => {
      const next = t === 'dark' ? 'light' : 'dark';
      window.localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
