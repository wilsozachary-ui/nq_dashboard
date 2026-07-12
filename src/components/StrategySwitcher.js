import { useEffect, useState } from 'react';
import { STRATEGY_LABELS, useMultiStrategy } from '../MultiStrategyFramework';
import './StrategySwitcher.css';

export default function StrategySwitcher() {
  const { currentStrategy, availableStrategies, setStrategy, switching } = useMultiStrategy();
  const [isLive, setIsLive] = useState(false);
  useEffect(() => {
    const handler = event => setIsLive(Boolean(event.detail.active));
    window.addEventListener('nq:market-open-mode', handler);
    return () => window.removeEventListener('nq:market-open-mode', handler);
  }, []);
  return (
    <nav className={`strategy-switcher${isLive ? ' strategy-switcher--live' : ''}`} aria-label="Trading strategy">
      {availableStrategies.map(strategy => (
        <button key={strategy} className={strategy === currentStrategy ? 'active' : ''} disabled={switching} aria-pressed={strategy === currentStrategy} onClick={() => setStrategy(strategy)}>
          {STRATEGY_LABELS[strategy]}
          {isLive && strategy === currentStrategy && <span className="strategy-live-badge">LIVE MODE</span>}
        </button>
      ))}
    </nav>
  );
}
