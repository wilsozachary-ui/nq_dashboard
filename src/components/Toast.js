import { useToast } from '../hooks/useToast';
import './Toast.css';

const ICONS = {
  error:   '⚠',
  warning: '◈',
  info:    '◉',
  success: '✓',
};

/**
 * ToastContainer — renders all active toasts at the bottom-right of the screen.
 * Mount once inside <ToastProvider> (App.js renders it just before </ToastProvider>).
 *
 * The toast state is managed by useToast / ToastProvider — this component is
 * purely presentational.
 */
export function ToastContainer() {
  const { toasts, dismiss } = useToast();
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map(({ id, message, type, exiting }) => (
        <div
          key={id}
          className={`toast toast--${type}${exiting ? ' toast--exiting' : ''}`}
          role="alert"
        >
          <span className="toast-icon" aria-hidden="true">{ICONS[type] ?? ICONS.info}</span>
          <span className="toast-message">{message}</span>
          <button
            className="toast-close"
            onClick={() => dismiss(id)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
