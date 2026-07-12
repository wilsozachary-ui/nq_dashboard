import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { API_ROOT } from './api/pnlApi';
import { useToast } from './hooks/useToast';
import { integratedFetch } from './CockpitIntegrator';

export const availableStrategies = ['morning_strategy', 'orb_strategy', 'scalper_strategy'];

export const STRATEGY_LABELS = {
  morning_strategy: 'Morning Strategy',
  orb_strategy: 'ORB Strategy',
  scalper_strategy: 'Scalper Strategy',
};

const EMPTY_CONFIG = { parameters: {}, risk: {}, bot: {}, pnl: {}, events: [] };

function unwrap(value, key) { return value?.[key] ?? value ?? {}; }

class MultiStrategyFramework {
  currentStrategy = 'morning_strategy';
  availableStrategies = availableStrategies;
  config = EMPTY_CONFIG;
  listeners = new Set();

  subscribeToStrategyChanges(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notify(payload) { this.listeners.forEach(callback => callback(payload)); }

  async getStrategyConfig(strategyName, signal) {
    if (!availableStrategies.includes(strategyName)) throw new Error(`Unknown strategy: ${strategyName}`);
    const q = encodeURIComponent(strategyName);
    const urls = [
      `${API_ROOT}/topstep/strategy/config?name=${q}`,
      `${API_ROOT}/topstep/risk/status?strategy=${q}`,
      `${API_ROOT}/topstep/pnl/today?strategy=${q}`,
      `${API_ROOT}/topstep/strategy/parameters?strategy=${q}`,
    ];
    const responses = await Promise.all(urls.map(url => integratedFetch(url, { signal })));
    if (responses.some(response => !response.ok)) throw new Error('Failed to load strategy configuration');
    const [config, risk, pnl, parameters] = await Promise.all(responses.map(response => response.json()));
    return {
      ...unwrap(config, 'config'),
      risk: unwrap(risk, 'risk'),
      pnl: unwrap(pnl, 'pnl'),
      parameters: unwrap(parameters, 'parameters'),
    };
  }

  async setStrategy(strategyName) {
    if (strategyName === this.currentStrategy) return this.config;
    const config = await this.getStrategyConfig(strategyName);
    const previousStrategy = this.currentStrategy;
    this.currentStrategy = strategyName;
    this.config = config;
    const detail = { strategy: strategyName, previousStrategy, config };
    this.notify(detail);
    window.dispatchEvent(new CustomEvent('nq:strategy-change', { detail }));
    return config;
  }

}

export const multiStrategyFramework = new MultiStrategyFramework();
const StrategyContext = createContext(null);

export function MultiStrategyProvider({ children }) {
  const { show: showToast } = useToast();
  const [state, setState] = useState({ currentStrategy: multiStrategyFramework.currentStrategy, config: multiStrategyFramework.config, switching: false });

  useEffect(() => multiStrategyFramework.subscribeToStrategyChanges(({ strategy, config, event }) => {
    setState(current => ({ ...current, currentStrategy: strategy, config: event ? { ...current.config, ...event } : config, switching: false }));
  }), []);
  useEffect(() => {
    let active = true;
    multiStrategyFramework.getStrategyConfig(multiStrategyFramework.currentStrategy)
      .then(config => {
        if (!active) return;
        multiStrategyFramework.config = config;
        setState(current => ({ ...current, config }));
      })
      .catch(() => showToast('Failed to load strategy configuration', { type: 'error' }));
    return () => { active = false; };
  }, [showToast]);
  useEffect(() => {
    const handler = event => {
      const payload = event.detail;
      if (payload.strategy !== multiStrategyFramework.currentStrategy) return;
      multiStrategyFramework.notify({ strategy: multiStrategyFramework.currentStrategy, config: multiStrategyFramework.config, event: payload });
      window.dispatchEvent(new CustomEvent('nq:strategy-event', { detail: payload }));
    };
    window.addEventListener('nq:integrated-strategy', handler);
    return () => window.removeEventListener('nq:integrated-strategy', handler);
  }, []);

  const setStrategy = useCallback(async strategy => {
    if (strategy === state.currentStrategy || state.switching) return;
    setState(current => ({ ...current, switching: true }));
    try { await multiStrategyFramework.setStrategy(strategy); }
    catch (_) {
      setState(current => ({ ...current, switching: false }));
      showToast('Failed to load strategy configuration', { type: 'error' });
    }
  }, [state.currentStrategy, state.switching, showToast]);

  const value = useMemo(() => ({ ...state, availableStrategies, setStrategy, getStrategyConfig: name => multiStrategyFramework.getStrategyConfig(name), subscribeToStrategyChanges: cb => multiStrategyFramework.subscribeToStrategyChanges(cb) }), [state, setStrategy]);
  return <StrategyContext.Provider value={value}>{children}</StrategyContext.Provider>;
}

export function useMultiStrategy() {
  const value = useContext(StrategyContext);
  if (!value) throw new Error('useMultiStrategy must be used inside MultiStrategyProvider');
  return value;
}

export default multiStrategyFramework;
