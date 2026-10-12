import {
  type AreaList,
  type Draft,
  ERROR_CODES,
  LIMITS,
  type Position,
  type PresenceState,
  type PresenceUser,
  QUERY,
  ROOM,
  WS,
} from '@cgis/shared';
import { useQueryClient } from '@tanstack/react-query';
import type * as L from 'leaflet';
import { useCallback, useEffect, useRef, useState } from 'react';
import { onDraw } from './geo';
import {
  createRoomConnection,
  roomUrl,
  type ConnectionState,
  type IncomingEvent,
  type OutgoingEvent,
  type RoomConnection,
  type SocketFactory,
} from './ws';

const MS_PER_SECOND = 1000;
/** Spacing between `draft:update` frames: exactly the Room's per-socket budget. */
export const DRAFT_INTERVAL_MS = MS_PER_SECOND / WS.DRAFT_RATE_PER_SEC;

/** One edit to a draft as `draft:update` carries it (`userId` is the author, set by the Room). */
export type DraftOp = Extract<OutgoingEvent, { type: 'draft:update' }>['payload'];

/** The `area:*` events, each patched into the areas cache. */
export type AreaWsEvent = IncomingEvent<'area:created' | 'area:updated' | 'area:deleted'>;

const CLEAR: DraftOp = { op: 'clear' };

/**
 * `vertices` after `op`, or `undefined` when it does not fit (index past the end, or an `add`
 * beyond `LIMITS.POLYGON_MAX_VERTICES`). The Room's rule (apps/api/src/do/drafts.ts): `add`
 * inserts at `index`, `move` replaces, `remove` deletes, `clear` empties.
 */
export function applyDraftOp(vertices: readonly Position[], op: DraftOp): Position[] | undefined {
  switch (op.op) {
    case 'add':
      if (op.index > vertices.length || vertices.length >= LIMITS.POLYGON_MAX_VERTICES) return;
      return [...vertices.slice(0, op.index), op.vertex, ...vertices.slice(op.index)];
    case 'move':
      if (op.index >= vertices.length) return;
      return vertices.map((vertex, i) => (i === op.index ? op.vertex : vertex));
    case 'remove':
      if (op.index >= vertices.length) return;
      return vertices.filter((_, i) => i !== op.index);
    case 'clear':
      return [];
  }
}

const same = (a: Position | undefined, b: Position | undefined) =>
  a !== undefined && b !== undefined && a[0] === b[0] && a[1] === b[1];

/**
 * The one op that takes the Room's copy (`sent`) a step toward the draw tool's (`target`), or
 * null when they match. Past the common prefix and suffix, a pure insertion is an `add`, a pure
 * deletion a `remove`, anything else a `move` at the first difference; an empty target is
 * `clear`. A click is one `add`, a vertex drag one `move` (the draw tool reports it at drag end),
 * an undo one `remove`.
 */
export function nextDraftOp(
  sent: readonly Position[],
  target: readonly Position[],
): DraftOp | null {
  if (target.length === 0) return sent.length > 0 ? CLEAR : null;
  const shorter = Math.min(sent.length, target.length);
  let prefix = 0;
  while (prefix < shorter && same(sent[prefix], target[prefix])) prefix++;
  if (prefix === sent.length && prefix === target.length) return null;
  let suffix = 0;
  while (
    suffix < shorter - prefix &&
    same(sent[sent.length - 1 - suffix], target[target.length - 1 - suffix])
  ) {
    suffix++;
  }
  const vertex = target[prefix];
  if (vertex === undefined || (target.length < sent.length && prefix + suffix === target.length)) {
    return { op: 'remove', index: prefix };
  }
  if (target.length > sent.length && prefix + suffix === sent.length) {
    return { op: 'add', index: prefix, vertex };
  }
  return { op: 'move', index: prefix, vertex };
}

/**
 * Streams the signed-in user's draft to the Room as single-op `draft:update`s, one every
 * `DRAFT_INTERVAL_MS` at most (the first at once). Ops are computed when sent, from what the Room
 * has (`sent`) to the latest vertices, so a burst of draw events collapses into the ops still
 * needed. `restart()` is for when the Room's copy is unknown: it sends `clear`, then the whole
 * draft again.
 */
export class DraftSender {
  private sent: Position[] = [];
  private target: Position[] = [];
  private mustClear = false;
  private lastSentAt = -Infinity;
  private resumeAt = -Infinity;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private readonly send: (op: DraftOp) => boolean;
  private readonly canSend: () => boolean;

  /** `send` returns false when the frame was dropped; nothing is sent while `canSend()` is false. */
  constructor(send: (op: DraftOp) => boolean, canSend: () => boolean) {
    this.send = send;
    this.canSend = canSend;
  }

  /** The draw tool's current vertices; `[]` ends the draft (one `clear`). */
  update(vertices: Position[]): void {
    this.target = vertices;
    this.pump();
  }

  /** The Room's copy is unknown (new socket, `DRAFT_OP_MISFIT`): clear it and send all again. */
  restart(): void {
    this.mustClear = this.sent.length > 0 || this.target.length > 0;
    this.sent = [];
    this.pump();
  }

  /** `RATE_LIMITED`: send nothing for `ms`, then restart (the refused op never reached the Room). */
  pause(ms: number): void {
    this.resumeAt = Date.now() + ms;
    this.restart();
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
  }

  private pump(): void {
    if (this.disposed || this.timer !== undefined || !this.canSend()) return;
    const op = this.mustClear ? CLEAR : nextDraftOp(this.sent, this.target);
    const next = op && applyDraftOp(this.sent, op);
    if (!op || !next) return;
    const wait = Math.max(this.lastSentAt + DRAFT_INTERVAL_MS, this.resumeAt) - Date.now();
    if (wait > 0) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.pump();
      }, wait);
      return;
    }
    if (!this.send(op)) return;
    this.lastSentAt = Date.now();
    this.mustClear = false;
    this.sent = next;
    this.pump();
  }
}

/**
 * An `area:*` event applied to one cached viewport list: created/updated replace the area by id
 * (or append it) unless the cache already holds a newer version; deleted removes it. Returns the
 * list unchanged when there is nothing to do, and `undefined` for an empty cache entry.
 */
export function patchAreas(list: AreaList | undefined, event: AreaWsEvent): AreaList | undefined {
  if (!list) return list;
  if (event.type === 'area:deleted') {
    const { id } = event.payload;
    return list.areas.some((area) => area.id === id)
      ? { areas: list.areas.filter((area) => area.id !== id) }
      : list;
  }
  const { area } = event.payload;
  const cached = list.areas.find((candidate) => candidate.id === area.id);
  if (!cached) return { areas: [...list.areas, area] };
  if (cached.version > area.version) return list;
  return { areas: list.areas.map((candidate) => (candidate.id === area.id ? area : candidate)) };
}

/** A relayed `draft:update` applied to the other users' drafts (an op that does not fit is ignored). */
export function applyRemoteDraftOp(drafts: Draft[], op: DraftOp, selfId: string): Draft[] {
  const { userId } = op;
  if (userId === undefined || userId === selfId) return drafts;
  const current = drafts.find((draft) => draft.userId === userId);
  const vertices = applyDraftOp(current?.vertices ?? [], op);
  if (!vertices) return drafts;
  if (vertices.length === 0) return drafts.filter((draft) => draft !== current);
  if (!current) return [...drafts, { userId, vertices }];
  return drafts.map((draft) => (draft === current ? { userId, vertices } : draft));
}

export type UseRoomOptions = {
  /** The signed-in user: their own draft is the draw tool's sketch, never a ghost. */
  selfId: string;
  /** The map whose draw events become `draft:update`s; null until it exists. */
  map: L.Map | null;
  /** Read once, on mount. Default: the browser `WebSocket`. */
  createSocket?: SocketFactory | undefined;
};

export type Room = {
  state: ConnectionState;
  /** Everyone in the room (you included), each with the colour the Room assigned. Empty unless open. */
  users: PresenceUser[];
  /** The other users' drafts. Empty unless open. */
  drafts: Draft[];
  /** Your draft's current vertices, streamed as throttled deltas; `[]` ends it with `clear`. */
  sendDraft: (vertices: Position[]) => void;
  /** Connect now (the offline banner's Retry). */
  reconnect: () => void;
};

/**
 * The map room: one WebSocket to the Room, joined on every open. Presence and other users'
 * drafts come back as state; `area:*` events patch every cached `[QUERY.AREAS_KEY, …]` list;
 * each (re)open invalidates those queries (the resync), and while offline they are invalidated
 * every `WS.OFFLINE_POLL_MS`. The map's draw events stream your draft and presence state.
 */
export function useRoom({ selfId, map, createSocket }: UseRoomOptions): Room {
  const queryClient = useQueryClient();
  const [socketFactory] = useState(() => createSocket);
  const [state, setState] = useState<ConnectionState>('connecting');
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const connectionRef = useRef<RoomConnection | null>(null);
  const senderRef = useRef<DraftSender | null>(null);
  const presenceRef = useRef<PresenceState>('viewing');

  useEffect(() => {
    const connection = createRoomConnection({
      url: roomUrl(window.location),
      createSocket: socketFactory,
    });
    const sender = new DraftSender(
      (op) => connection.send({ type: 'draft:update', payload: op }),
      () => connection.state === 'open',
    );
    connectionRef.current = connection;
    senderRef.current = sender;
    const areasKey = { queryKey: [QUERY.AREAS_KEY] };
    const patch = (event: AreaWsEvent) =>
      queryClient.setQueriesData<AreaList>(areasKey, (list) => patchAreas(list, event));

    const unsubscribe = [
      connection.onState((next) => {
        setState(next);
        if (next === 'open') return;
        // Nothing live arrives while closed: drop what would go stale; the next join resends it.
        setUsers([]);
        setDrafts([]);
      }),
      connection.onOpen(() => {
        // presence:set first: the join then announces the user already in that state.
        if (presenceRef.current !== 'viewing') {
          connection.send({ type: 'presence:set', payload: { state: presenceRef.current } });
        }
        connection.send({ type: 'join', payload: { mapId: ROOM.DEFAULT_ROOM_ID } });
        void queryClient.invalidateQueries(areasKey);
        sender.restart();
      }),
      connection.on('presence', ({ payload }) => setUsers(payload.users)),
      connection.on('draft:state', ({ payload }) =>
        setDrafts(payload.drafts.filter((draft) => draft.userId !== selfId)),
      ),
      connection.on('draft:update', ({ payload }) =>
        setDrafts((current) => applyRemoteDraftOp(current, payload, selfId)),
      ),
      connection.on('area:created', patch),
      connection.on('area:updated', patch),
      connection.on('area:deleted', patch),
      connection.on('error', ({ payload }) => {
        if (payload.code === ERROR_CODES.RATE_LIMITED) {
          sender.pause(payload.retryAfter ?? DRAFT_INTERVAL_MS);
        } else if (payload.code === ERROR_CODES.DRAFT_OP_MISFIT) {
          sender.restart();
        }
      }),
    ];

    return () => {
      for (const off of unsubscribe) off();
      sender.dispose();
      connection.close();
      connectionRef.current = null;
      senderRef.current = null;
      setState('connecting');
      setUsers([]);
      setDrafts([]);
    };
  }, [queryClient, selfId, socketFactory]);

  // Offline: no area events arrive, so the viewport lists are refetched on a timer instead.
  useEffect(() => {
    if (state !== 'offline') return;
    const timer = setInterval(
      () => void queryClient.invalidateQueries({ queryKey: [QUERY.AREAS_KEY] }),
      WS.OFFLINE_POLL_MS,
    );
    return () => clearInterval(timer);
  }, [state, queryClient]);

  const sendDraft = useCallback((vertices: Position[]) => senderRef.current?.update(vertices), []);
  const reconnect = useCallback(() => connectionRef.current?.reconnect(), []);

  useEffect(() => {
    if (!map) return;
    // Sent only while open; a reopen sends the current state before the join.
    const setPresence = (next: PresenceState) => {
      if (presenceRef.current === next) return;
      presenceRef.current = next;
      const connection = connectionRef.current;
      if (connection?.state === 'open') {
        connection.send({ type: 'presence:set', payload: { state: next } });
      }
    };
    const end = () => {
      sendDraft([]);
      setPresence('viewing');
    };
    const unsubscribe = [
      onDraw(map, 'draw:change', ({ vertices }) => {
        setPresence('drawing');
        sendDraft(vertices);
      }),
      onDraw(map, 'draw:done', end),
      onDraw(map, 'draw:cancel', end),
    ];
    return () => {
      for (const off of unsubscribe) off();
      // The sketch on this map is gone (the draw control is keyed on the map).
      end();
    };
  }, [map, sendDraft]);

  return { state, users, drafts, sendDraft, reconnect };
}
