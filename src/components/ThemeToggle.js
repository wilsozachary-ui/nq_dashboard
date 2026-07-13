import { useTheme } from '../theme/ThemeContext';
import { IconSun, IconMoon } from './TabIcons';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      <span className="theme-toggle-icon" aria-hidden="true">
        {isDark ? <IconMoon /> : <IconSun />}
      </span>
      <span className="theme-toggle-label">{isDark ? 'Dark' : 'Light'}</span>
    </button>
  );
}
