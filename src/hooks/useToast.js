/**
 * useToast — lightweight toast notification system.
 *
 * Architecture:
 *   ToastProvider wraps the app root (in App.js).
 *   Any component or hook calls useToast() to get { show, dismiss }.
 *
 * show(message, options?) → id string
 *   options.type     'error' | 'warning' | 'info' | 'success'  (default: 'error')
 *   options.duration  total visible time in ms                  (default: 4000)
 *
 * dismiss(id) — removes the toast immediately (with exit animation).
 *
 * At most 5 toasts are shown at once; oldest are dropped first.
 */

import { createContext, useContext, useState, useCallback, useRef } from 'react';

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    // Mark as exiting so the CSS exit animation plays before removal.
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 280);
  }, []);

  const show = useCallback((message, { type = 'error', duration = 4000 } = {}) => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    setToasts(prev => {
      const trimmed = prev.length >= 5 ? prev.slice(1) : prev;
      return [...trimmed, { id, message, type, exiting: false }];
    });

    // Start removal timer (fire the exit animation 280ms before full removal).
    timers.current[id] = setTimeout(() => dismiss(id), Math.max(duration - 280, 200));

    return id;
  }, [dismiss]);

  return (
    <ToastCtx.Provider value={{ toasts, show, dismiss }}>
      {children}
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be called inside <ToastProvider>');
  return ctx;
}
