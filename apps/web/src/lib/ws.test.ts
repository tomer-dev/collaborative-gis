import { MAP, ROOM, WS } from '@cgis/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSockets, serverFrame } from './fake-websocket';
import {
  backoffDelay,
  createRoomConnection,
  roomUrl,
  stateAfter,
  type ConnectionState,
  type OutgoingEvent,
  type RoomConnection,
} from './ws';

const URL = 'ws://localhost/ws';
const { min, max } = WS.RECONNECT_BACKOFF_MS;

let connection: RoomConnection;

/** A connection on fake sockets with no jitter (`random` = 0: every delay is the full backoff). */
function connect() {
  const fake = fakeSockets();
  connection = createRoomConnection({ url: URL, createSocket: fake.factory, random: () => 0 });
  const states: ConnectionState[] = [];
  connection.onState((state) => states.push(state));
  return { ...fake, states };
}

/** Fails `count` connects in a row (each retry after its full backoff). */
function failConnects(fake: ReturnType<typeof connect>, count: number) {
  for (let failures = 1; failures <= count; failures++) {
    fake.latest().drop(1006);
    vi.advanceTimersByTime(backoffDelay(failures, () => 0));
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  connection.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('state machine', () => {
  it('starts connecting to the given URL and is open once the socket opens', () => {
    const fake = connect();
    expect(connection.state).toBe('connecting');
    expect(fake.latest().url).toBe(URL);

    fake.latest().open();

    expect(connection.state).toBe('open');
    expect(fake.states).toEqual(['open']);
  });

  it('close 1001 (Room idle sweep): connecting, then a new socket after the first backoff', () => {
    const fake = connect();
    fake.latest().open();

    fake.latest().drop(WS.CLOSE_IDLE);

    expect(connection.state).toBe('connecting');
    vi.advanceTimersByTime(min - 1);
    expect(fake.sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(fake.sockets).toHaveLength(2);
    fake.latest().open();
    expect(connection.state).toBe('open');
  });

  it(`degraded after ${WS.CLIENT_DEGRADED_AFTER} failed connects, offline after ${WS.CLIENT_OFFLINE_AFTER}, and still retrying`, () => {
    const fake = connect();

    failConnects(fake, WS.CLIENT_DEGRADED_AFTER - 1);
    expect(connection.state).toBe('connecting');
    failConnects(fake, 1);
    expect(connection.state).toBe('degraded');
    fake.latest().drop(1006);
    for (let n = WS.CLIENT_DEGRADED_AFTER + 2; n <= WS.CLIENT_OFFLINE_AFTER; n++) {
      vi.advanceTimersByTime(max);
      fake.latest().drop(1006);
    }
    expect(connection.state).toBe('offline');
    expect(fake.states).toEqual(['degraded', 'offline']);

    const before = fake.sockets.length;
    vi.advanceTimersByTime(max);
    expect(fake.sockets).toHaveLength(before + 1);
    fake.latest().open();
    expect(connection.state).toBe('open');
  });

  it('close 1008 (policy violation): offline with no retry until reconnect()', () => {
    const fake = connect();
    fake.latest().open();

    fake.latest().drop(WS.CLOSE_POLICY_VIOLATION);

    expect(connection.state).toBe('offline');
    vi.advanceTimersByTime(max * 4);
    expect(fake.sockets).toHaveLength(1);
    window.dispatchEvent(new Event('online'));
    expect(fake.sockets).toHaveLength(1);

    connection.reconnect();
    expect(fake.sockets).toHaveLength(2);
    fake.latest().open();
    expect(connection.state).toBe('open');
  });

  it('the browser coming back online retries at once, without waiting out the backoff', () => {
    const fake = connect();
    failConnects(fake, WS.CLIENT_DEGRADED_AFTER);
    fake.latest().drop(1006);
    const before = fake.sockets.length;

    window.dispatchEvent(new Event('online'));

    expect(fake.sockets).toHaveLength(before + 1);
  });

  it('close() stops for good: socket closed, no retry', () => {
    const fake = connect();
    fake.latest().open();
    connection.close();
    expect(fake.latest().closedByClient).toBe(true);
    vi.advanceTimersByTime(max * 4);
    expect(fake.sockets).toHaveLength(1);
  });
});

describe('backoff', () => {
  it('doubles from RECONNECT_BACKOFF_MS.min and caps at .max', () => {
    expect([1, 2, 3, 4, 5, 6, 20].map((n) => backoffDelay(n, () => 0))).toEqual([
      min,
      min * 2,
      min * 4,
      min * 8,
      min * 16,
      max,
      max,
    ]);
  });

  it('jitter shortens a delay by at most CLIENT_BACKOFF_JITTER of it', () => {
    expect(backoffDelay(1, () => 1)).toBe(min * (1 - WS.CLIENT_BACKOFF_JITTER));
    expect(backoffDelay(1, () => 0.5)).toBe(min * (1 - WS.CLIENT_BACKOFF_JITTER / 2));
  });

  it('maps failures to states by the WS.CLIENT_* thresholds', () => {
    expect(stateAfter(0)).toBe('connecting');
    expect(stateAfter(WS.CLIENT_DEGRADED_AFTER)).toBe('degraded');
    expect(stateAfter(WS.CLIENT_OFFLINE_AFTER)).toBe('offline');
  });
});

describe('ping', () => {
  it(`sends ${WS.AUTO_PING} every WS.PING_INTERVAL_MS while open, never while offline`, () => {
    const fake = connect();
    const first = fake.latest();
    vi.advanceTimersByTime(WS.PING_INTERVAL_MS);
    expect(first.pings()).toBe(0);

    first.open();
    vi.advanceTimersByTime(WS.PING_INTERVAL_MS - 1);
    expect(first.pings()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(first.pings()).toBe(1);
    vi.advanceTimersByTime(WS.PING_INTERVAL_MS);
    expect(first.pings()).toBe(2);

    first.drop(WS.CLOSE_POLICY_VIOLATION);
    vi.advanceTimersByTime(WS.PING_INTERVAL_MS * 4);
    expect(first.pings()).toBe(2);
    expect(fake.sockets).toHaveLength(1);
  });
});

describe('visibility', () => {
  const setVisibility = (value: DocumentVisibilityState) => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(value);
    document.dispatchEvent(new Event('visibilitychange'));
  };

  it(`sends one ${WS.AUTO_PING} when the tab is shown again while open, none when hidden or closed`, () => {
    const fake = connect();
    const socket = fake.latest();
    setVisibility('visible');
    expect(socket.pings()).toBe(0);

    socket.open();
    setVisibility('hidden');
    expect(socket.pings()).toBe(0);
    setVisibility('visible');
    expect(socket.pings()).toBe(1);

    connection.close();
    setVisibility('visible');
    expect(socket.pings()).toBe(1);
  });
});

describe('send', () => {
  const join: OutgoingEvent = { type: 'join', payload: { mapId: ROOM.DEFAULT_ROOM_ID } };
  const drawing: OutgoingEvent = { type: 'presence:set', payload: { state: 'drawing' } };
  const draft: OutgoingEvent = { type: 'draft:update', payload: { op: 'clear' } };

  it('stamps seq (increasing) and ts on every frame', () => {
    vi.setSystemTime(5000);
    const fake = connect();
    fake.latest().open();
    connection.send(join);
    connection.send(drawing);
    expect(fake.latest().frames()).toEqual([
      { ...join, seq: 1, ts: 5000 },
      { ...drawing, seq: 2, ts: 5000 },
    ]);
  });

  it('queues while connecting and flushes after the open handlers (join goes first)', () => {
    const fake = connect();
    connection.onOpen(() => connection.send(join));
    expect(connection.send(drawing)).toBe(true);
    expect(fake.latest().sent).toEqual([]);

    fake.latest().open();

    expect(
      fake
        .latest()
        .frames()
        .map((frame) => frame.type),
    ).toEqual(['join', 'presence:set']);
  });

  it('drops draft:update while offline and still queues the rest', () => {
    const fake = connect();
    failConnects(fake, WS.CLIENT_OFFLINE_AFTER - 1);
    fake.latest().drop(1006);
    expect(connection.state).toBe('offline');

    expect(connection.send(draft)).toBe(false);
    expect(connection.send(drawing)).toBe(true);
    vi.advanceTimersByTime(max);
    fake.latest().open();

    expect(
      fake
        .latest()
        .frames()
        .map((frame) => frame.type),
    ).toEqual(['presence:set']);
  });
});

describe('on', () => {
  it('delivers Zod-parsed frames to the handlers of their type only', () => {
    const fake = connect();
    const presence = vi.fn();
    const errors = vi.fn();
    connection.on('presence', presence);
    const off = connection.on('error', errors);
    fake.latest().open();
    const users = [{ userId: 'u1', name: 'Ada', color: MAP.PRESENCE_COLORS[0], state: 'viewing' }];

    fake.latest().receive(serverFrame({ type: 'presence', payload: { users } }));

    expect(presence).toHaveBeenCalledWith(expect.objectContaining({ payload: { users } }));
    expect(errors).not.toHaveBeenCalled();
    off();
    fake
      .latest()
      .receive(serverFrame({ type: 'error', payload: { code: 'BAD_REQUEST', message: 'x' } }));
    expect(errors).not.toHaveBeenCalled();
  });

  it('ignores pong, non-JSON and schema-invalid frames', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = connect();
    const presence = vi.fn();
    connection.on('presence', presence);
    fake.latest().open();

    fake.latest().receive(WS.AUTO_PONG);
    fake.latest().receive('{nope');
    fake.latest().receive(serverFrame({ type: 'presence', payload: { users: [{ userId: 1 }] } }));

    expect(presence).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});

describe('roomUrl', () => {
  it('is ROUTES.WS on the page origin over ws: or wss:', () => {
    expect(roomUrl({ href: 'http://localhost:5173/map' })).toBe('ws://localhost:5173/ws');
    expect(roomUrl({ href: 'https://gis.example/map?x=1' })).toBe('wss://gis.example/ws');
  });
});
