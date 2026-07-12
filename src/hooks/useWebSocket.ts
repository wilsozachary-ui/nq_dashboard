import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BotWebSocketClient, BotWebSocketOptions, BotWsMessage, BotWsStatus } from '../services/websocket';

type UseWebSocketOptions = BotWebSocketOptions & {
  autoConnect?: boolean;
};

type UseWebSocketResult = {
  status: BotWsStatus;
  lastMessage: BotWsMessage | null;
  messages: BotWsMessage[];
  send: (message: BotWsMessage) => boolean;
  connect: () => void;
  disconnect: () => void;
  clearMessages: () => void;
};

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

function normalizeMessageType(message: BotWsMessage): string {
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

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketResult {
  const {
    autoConnect = true,
    onMessage,
    onStatusChange,
    onError,
    ...clientOptions
  } = options;

  const [status, setStatus] = useState<BotWsStatus>('disconnected');
  const [lastMessage, setLastMessage] = useState<BotWsMessage | null>(null);
  const [messages, setMessages] = useState<BotWsMessage[]>([]);

  const externalHandlersRef = useRef({ onMessage, onStatusChange, onError });
  externalHandlersRef.current = { onMessage, onStatusChange, onError };

  const clientRef = useRef<BotWebSocketClient | null>(null);

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
        externalHandlersRef.current.onMessage?.(normalizedMessage);
      },
      onStatusChange: nextStatus => {
        setStatus(nextStatus);
        externalHandlersRef.current.onStatusChange?.(nextStatus);
      },
      onError: event => {
        externalHandlersRef.current.onError?.(event);
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

  const connect = useCallback(() => {
    clientRef.current?.connect();
  }, []);

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
  }, []);

  const send = useCallback((message: BotWsMessage) => {
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
