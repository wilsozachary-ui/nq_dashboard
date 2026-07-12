import { useEffect, useMemo, useState } from 'react';
import botStore from '../stores/botStore';

export function useBotData(options = {}) {
  const {
    autoInitialize = true,
    autoRefresh = false,
    refreshIntervalMs = 5000,
  } = options;

  const [state, setState] = useState(() => botStore.getState());

  useEffect(() => {
    const unsubscribe = botStore.subscribe(setState);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!autoInitialize) return;
    botStore.initialize();
    return () => {
      botStore.destroy();
    };
  }, [autoInitialize]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      botStore.refresh().catch(() => {});
    }, refreshIntervalMs);
    return () => clearInterval(timer);
  }, [autoRefresh, refreshIntervalMs]);

  const actions = useMemo(() => ({
    refresh: () => botStore.refresh(),
    send: message => botStore.send(message),
    initialize: () => botStore.initialize(),
    destroy: () => botStore.destroy(),
    reset: () => botStore.reset(),
    clearActivityEvents: () => botStore.clearActivityEvents(),
  }), []);

  return {
    state,
    connected: state.connected,
    loading: state.loading,
    error: state.error,
    ...actions,
  };
}

export default useBotData;
