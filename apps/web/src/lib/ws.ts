import {
  parseWsMessage,
  ROUTES,
  WS,
  type WsClientEvent,
  type WsEvent,
  type WsEventType,
} from '@cgis/shared';

/**
 * Room connection state (spec §5 degradation): `connecting` (first connect, or one retry after a
 * drop), `open`, `degraded` (`WS.CLIENT_DEGRADED_AFTER` failed connects in a row, still retrying),
 * `offline` (`WS.CLIENT_OFFLINE_AFTER` in a row, or the Room closed us with 1008). Every state but
 * `open` retries with backoff, except after a 1008, which waits for `reconnect()`.
 */
export type ConnectionState = 'connecting' | 'open' | 'degraded' | 'offline';

/** The part of the browser `WebSocket` the connection uses, so tests can inject a fake. */
export interface SocketLike {
  onopen: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(data: string): void;
  close(): void;
}

export type SocketFactory = (url: string) => SocketLike;

type Unstamped<E> = E extends unknown ? Omit<E, 'seq' | 'ts'> : never;
/** A client frame before the connection stamps its `seq` and `ts`. */
export type OutgoingEvent = Unstamped<WsClientEvent>;

/** One server event type, narrowed from the envelope union. */
export type IncomingEvent<T extends WsEventType> = Extract<WsEvent, { type: T }>;

export interface RoomConnection {
  readonly state: ConnectionState;
  /**
   * Sends now when open. Otherwise queues the frame for the next open, except a `draft:update`
   * while offline, which is dropped (the room hook resends the whole draft after reconnecting).
   * Returns false when dropped.
   */
  send(event: OutgoingEvent): boolean;
  /** Typed handler for one server event type; returns the unsubscribe. */
  on<T extends WsEventType>(type: T, handler: (event: IncomingEvent<T>) => void): () => void;
  /** Called on every state change. */
  onState(handler: (state: ConnectionState) => void): () => void;
  /** Called each time a socket opens, before queued frames are flushed (send `join` here). */
  onOpen(handler: () => void): () => void;
  /** Connects now: skips the backoff wait, and resumes after a 1008. */
  reconnect(): void;
  /** Closes the socket and stops for good. */
  close(): void;
}

export type RoomConnectionOptions = {
  url: string;
  /** Default: the browser `WebSocket`. */
  createSocket?: SocketFactory | undefined;
  /** Default: `Math.random` (jitter). */
  random?: (() => number) | undefined;
};

/** The `ws:`/`wss:` URL of `ROUTES.WS` on the page's origin (Vite proxies it in dev). */
export function roomUrl(location: Pick<Location, 'href'>): string {
  const url = new URL(ROUTES.WS, location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

/**
 * Delay before reconnect attempt number `failures` (1-based): `RECONNECT_BACKOFF_MS.min`
 * doubling up to `.max`, then shortened by up to `CLIENT_BACKOFF_JITTER` of itself at random so
 * clients dropped together do not return together.
 */
export function backoffDelay(failures: number, random: () => number): number {
  const { min, max } = WS.RECONNECT_BACKOFF_MS;
  const base = Math.min(max, min * 2 ** Math.max(0, failures - 1));
  return base * (1 - WS.CLIENT_BACKOFF_JITTER * random());
}

/** The state after `failures` failed connects in a row. */
export function stateAfter(failures: number): ConnectionState {
  if (failures >= WS.CLIENT_OFFLINE_AFTER) return 'offline';
  if (failures >= WS.CLIENT_DEGRADED_AFTER) return 'degraded';
  return 'connecting';
}

function isType<T extends WsEventType>(event: WsEvent, type: T): event is IncomingEvent<T> {
  return event.type === type;
}

/**
 * A self-healing connection to the Room over the native `WebSocket`: connects at once, pings
 * every `WS.PING_INTERVAL_MS` while open (the Room auto-answers, so the idle sweep never closes a
 * live tab), parses every frame with the shared protocol, and reconnects with backoff.
 */
export function createRoomConnection({
  url,
  createSocket = (target) => new WebSocket(target),
  random = Math.random,
}: RoomConnectionOptions): RoomConnection {
  let state: ConnectionState = 'connecting';
  let socket: SocketLike | null = null;
  let failures = 0;
  let halted = false;
  let disposed = false;
  let seq = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  const queue: OutgoingEvent[] = [];
  const handlers = new Set<(event: WsEvent) => void>();
  const stateHandlers = new Set<(state: ConnectionState) => void>();
  const openHandlers = new Set<() => void>();

  const setState = (next: ConnectionState) => {
    if (next === state) return;
    state = next;
    for (const handler of stateHandlers) handler(next);
  };

  const write = (event: OutgoingEvent) => {
    seq += 1;
    socket?.send(JSON.stringify({ ...event, seq, ts: Date.now() }));
  };

  const detach = () => {
    clearInterval(pingTimer);
    if (!socket) return;
    socket.onopen = socket.onclose = socket.onmessage = socket.onerror = null;
    socket.close();
    socket = null;
  };

  const receive = ({ data }: MessageEvent) => {
    if (data === WS.AUTO_PONG || typeof data !== 'string') return;
    let event: WsEvent;
    try {
      event = parseWsMessage(data);
    } catch (err) {
      console.warn(JSON.stringify({ msg: 'room frame rejected', error: String(err) }));
      return;
    }
    for (const handler of handlers) handler(event);
  };

  const closed = ({ code }: CloseEvent) => {
    clearInterval(pingTimer);
    socket = null;
    if (code === WS.CLOSE_POLICY_VIOLATION) {
      halted = true;
      setState('offline');
      return;
    }
    failures += 1;
    setState(stateAfter(failures));
    retryTimer = setTimeout(connect, backoffDelay(failures, random));
  };

  function connect() {
    clearTimeout(retryTimer);
    detach();
    if (disposed) return;
    const next = createSocket(url);
    socket = next;
    next.onopen = () => {
      failures = 0;
      setState('open');
      pingTimer = setInterval(() => next.send(WS.AUTO_PING), WS.PING_INTERVAL_MS);
      for (const handler of openHandlers) handler();
      for (const event of queue.splice(0)) write(event);
    };
    next.onmessage = receive;
    // An error is always followed by a close, which decides what happens next: no onerror.
    next.onclose = closed;
  }

  // The browser is back on the network: retry now rather than at the end of the backoff wait
  // (a socket already connecting is left to finish).
  const online = () => {
    if (!socket && !halted && !disposed) connect();
  };

  connect();
  window.addEventListener('online', online);

  return {
    get state() {
      return state;
    },
    send(event) {
      if (state === 'open') {
        write(event);
        return true;
      }
      if (state === 'offline' && event.type === 'draft:update') return false;
      queue.push(event);
      return true;
    },
    on(type, handler) {
      const listener = (event: WsEvent) => {
        if (isType(event, type)) handler(event);
      };
      handlers.add(listener);
      return () => handlers.delete(listener);
    },
    onState(handler) {
      stateHandlers.add(handler);
      return () => stateHandlers.delete(handler);
    },
    onOpen(handler) {
      openHandlers.add(handler);
      return () => openHandlers.delete(handler);
    },
    reconnect() {
      if (disposed || state === 'open') return;
      halted = false;
      connect();
    },
    close() {
      disposed = true;
      clearTimeout(retryTimer);
      window.removeEventListener('online', online);
      detach();
    },
  };
}
