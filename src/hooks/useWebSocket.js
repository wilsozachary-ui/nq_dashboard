import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BotWebSocketClient } from '../services/websocket';

const ALLOWED_TYPES = new Set([
  'price',
  'bid_ask',
  'tick',
  'orb_state',
  'orb_range',
  'orb_trades',
  'orb_pnl',
  'testbot',
  'trailing_status',
  'trailing_extreme',
  'trailing_stop',
  'trailing_update',
  'pnl',
  'risk',
  'strategy',
  'activity',
]);

function normalizeMessageType(message) {
  const raw = String(message.type || message.event || message.topic || '').toLowerCase();
  if (ALLOWED_TYPES.has(raw)) return raw;
  if (raw.includes('bid') && raw.includes('ask')) return 'bid_ask';
  if (raw.includes('orb') && raw.includes('trade')) return 'orb_trades';
  if (raw.includes('orb') && raw.includes('state')) return 'orb_state';
  if (raw.includes('orb') && raw.includes('range')) return 'orb_range';
  if (raw.includes('orb') && raw.includes('pnl')) return 'orb_pnl';
  if (raw.includes('trail') && raw.includes('status')) return 'trailing_status';
  if (raw.includes('trail') && raw.includes('extreme')) return 'trailing_extreme';
  if (raw.includes('trail') && raw.includes('stop')) return 'trailing_stop';
  if (raw.includes('trail') && raw.includes('update')) return 'trailing_update';
  if (raw.includes('testbot')) return 'testbot';
  if (raw.includes('price')) return 'price';
  if (raw.includes('tick')) return 'tick';
  return raw || 'activity';
}

export function useWebSocket(options = {}) {
  const {
    autoConnect = true,
    onMessage,
    onStatusChange,
    onError,
    ...clientOptions
  } = options;

  const [status, setStatus] = useState('disconnected');
  const [lastMessage, setLastMessage] = useState(null);
  const [messages, setMessages] = useState([]);

  const externalHandlersRef = useRef({ onMessage, onStatusChange, onError });
  externalHandlersRef.current = { onMessage, onStatusChange, onError };

  const clientRef = useRef(null);

  // clientOptions is deliberately omitted from the deps array below: it's a
  // fresh object every render (rest-destructured from `options` above), so
  // including it would defeat the memo entirely and reintroduce the
  // reference-churn this exists to avoid. Tracking its primitive fields
  // individually is the actual fix, not the one eslint suggests.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableClientOptions = useMemo(() => clientOptions, [
    clientOptions.url,
    clientOptions.reconnect,
    clientOptions.reconnectBaseDelayMs,
    clientOptions.reconnectMaxDelayMs,
    clientOptions.maxReconnectAttempts,
  ]);

  useEffect(() => {
    const client = new BotWebSocketClient({
      ...stableClientOptions,
      onMessage: message => {
        const normalizedMessage = { ...message, type: normalizeMessageType(message) };
        setLastMessage(normalizedMessage);
        setMessages(prev => [...prev, normalizedMessage]);
        externalHandlersRef.current.onMessage && externalHandlersRef.current.onMessage(normalizedMessage);
      },
      onStatusChange: nextStatus => {
        setStatus(nextStatus);
        externalHandlersRef.current.onStatusChange && externalHandlersRef.current.onStatusChange(nextStatus);
      },
      onError: event => {
        externalHandlersRef.current.onError && externalHandlersRef.current.onError(event);
      },
    });

    clientRef.current = client;

    if (autoConnect) {
      client.connect();
    }

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [autoConnect, stableClientOptions]);

  // Browsers throttle background-tab timers (including reconnect backoff),
  // so a connection that quietly died while a tab was backgrounded can sit
  // disconnected until the user happens to trigger something -- switching
  // back to the tab feels "stale" until then. connect() is already a safe
  // no-op when the socket is OPEN/CONNECTING (see BotWebSocketClient.connect
  // above), so this only ever does real work when reconnection is actually
  // needed.
  useEffect(() => {
    if (!autoConnect) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        clientRef.current && clientRef.current.connect();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [autoConnect]);

  const connect = useCallback(() => {
    clientRef.current && clientRef.current.connect();
  }, []);

  const disconnect = useCallback(() => {
    clientRef.current && clientRef.current.disconnect();
  }, []);

  const send = useCallback(message => {
    if (!clientRef.current) return false;
    return clientRef.current.send(message);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setLastMessage(null);
  }, []);

  return {
    status,
    lastMessage,
    messages,
    send,
    connect,
    disconnect,
    clearMessages,
  };
}

export default useWebSocket;
