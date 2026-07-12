import { useEffect, useMemo, useState } from 'react';
import botStore, { BotStoreState } from '../stores/botStore';

type UseBotDataOptions = {
  autoInitialize?: boolean;
  autoRefresh?: boolean;
  refreshIntervalMs?: number;
};

type UseBotDataResult = {
  state: BotStoreState;
  connected: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  send: (message: Record<string, any>) => boolean;
  initialize: () => void;
  destroy: () => void;
  reset: () => void;
};

export function useBotData(options: UseBotDataOptions = {}): UseBotDataResult {
  const {
    autoInitialize = true,
    autoRefresh = false,
    refreshIntervalMs = 5000,
  } = options;

  const [state, setState] = useState<BotStoreState>(() => botStore.getState());

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
    send: (message: Record<string, any>) => botStore.send(message),
    initialize: () => botStore.initialize(),
    destroy: () => botStore.destroy(),
    reset: () => botStore.reset(),
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
