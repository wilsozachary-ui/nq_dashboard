import { useEffect, useState } from 'react';

export function usePnLWebSocket(wsUrl) {
  const [lastEvent, setLastEvent] = useState(null);
  const [wsStatus, setWsStatus] = useState('connecting');

  useEffect(() => {
    const message = event => {
      const payload = event.detail;
      setWsStatus('connected');
      if (payload?.pnl != null || payload.type === 'trade' || payload.type === 'trade_closed') {
        setLastEvent({ ...payload, _seq: performance.now() });
      }
    };
    const connection = event => { if (event.detail.stream === 'pnl') setWsStatus(event.detail.status); };
    window.addEventListener('nq:integrated-pnl', message);
    window.addEventListener('cockpit:connection:status', connection);
    return () => { window.removeEventListener('nq:integrated-pnl', message); window.removeEventListener('cockpit:connection:status', connection); };
  }, [wsUrl]);

  return { lastEvent, wsStatus };
}
