import {
  type AreaList,
  type Draft,
  ERROR_CODES,
  type PresenceState,
  type PresenceUser,
  QUERY,
  ROOM,
  WS,
} from '@cgis/shared';
import { type QueryFilters, useQueryClient } from '@tanstack/react-query';
import type * as L from 'leaflet';
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyRemoteDraftOp, patchAreas, sessionEnded, type AreaWsEvent } from './areas-patch';
import { DRAFT_INTERVAL_MS, DraftSender } from './draft-sender';
import { onDraw } from './geo';
import {
  backoffDelay,
  createRoomConnection,
  roomUrl,
  type ConnectionState,
  type RoomConnection,
} from './ws';

export type UseRoomOptions = {
  /** The signed-in user: their own draft is the draw tool's sketch, never a ghost. */
  selfId: string;
  /** The map whose draw events become `draft:update`s; null until it exists. */
  map: L.Map | null;
};

export type Room = {
  /** The connection's state (spec §5: connecting → open → degraded → offline). */
  state: ConnectionState;
  /** Everyone in the room (you included), each with the colour the Room assigned. Empty unless open. */
  users: PresenceUser[];
  /** The other users' drafts. Empty unless open. */
  drafts: Draft[];
  /** Connect now (the offline banner's Retry). */
  reconnect: () => void;
};

/**
 * The map room: one WebSocket to the Room, joined on every open and again on every `error` with
 * `resync` (the Room lost what this client relies on). Presence and other users' drafts come back
 * as state, each `draft:state` replacing the ghosts; `area:*` events patch every cached
 * `[QUERY.AREAS_KEY, …]` list; each reopen invalidates those queries (area events are not
 * replayed; not on the first open of a healthy connection), and while degraded or offline they
 * are invalidated every `WS.OFFLINE_POLL_MS`. The map's draw events stream your draft and
 * presence state; the draft stays in memory across reconnects and is sent again after each join.
 */
export function useRoom({ selfId, map }: UseRoomOptions): Room {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConnectionState>('connecting');
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const connectionRef = useRef<RoomConnection | null>(null);
  const senderRef = useRef<DraftSender | null>(null);
  const presenceRef = useRef<PresenceState>('viewing');

  useEffect(() => {
    const connection = createRoomConnection({
      url: roomUrl(window.location),
      // A 401 on the upgrade reaches the page as a plain close. Once the API has answered 401,
      // every retry would get one too, so they stop (the query client sends the visitor to sign in).
      shouldRetry: () => !sessionEnded(queryClient),
    });
    const sender = new DraftSender(
      // Sent only while open, so the frame is written at once and `lastSeq` is its seq.
      (op) => (connection.send({ type: 'draft:update', payload: op }) ? connection.lastSeq : null),
      () => connection.state === 'open',
    );
    connectionRef.current = connection;
    senderRef.current = sender;
    const areasKey = { queryKey: [QUERY.AREAS_KEY] };
    // On-screen viewports whose first GET has not answered yet: no list to patch.
    const unfetched: QueryFilters = {
      ...areasKey,
      type: 'active',
      predicate: (query) => query.state.data === undefined,
    };
    const patch = (event: AreaWsEvent) => {
      queryClient.setQueriesData<AreaList>(areasKey, (list) => patchAreas(list, event));
      // That GET may have read the database before this change, and a refetch would only join it,
      // so it is cancelled and sent again.
      void queryClient.cancelQueries(unfetched).then(() => queryClient.refetchQueries(unfetched));
    };
    // The viewport lists are refetched on an open only once events may have been missed: after an
    // earlier open, or after the connection degraded. The first open of a healthy connection skips
    // it, so loading the map costs one GET, not two (the list was fetched moments before).
    let resyncOnOpen = false;

    // The join (the Room's resync contract): `join`, answered with `presence` and the full
    // `draft:state`; then `presence:set` when drawing; then the draft again as `clear` + one `add`
    // per vertex (`restart`). One join at a time: the Room answers frames in order, so a `resync`
    // error before the join's `draft:state` is about a frame sent before the join. When that
    // answer does not come (the join itself failed), the join is sent again after a backoff delay.
    // A `draft:state` the Room broadcasts after a departure also ends the wait; at worst that
    // costs one extra join.
    let joinPending = false;
    let rejoins = 0;
    let rejoinTimer: ReturnType<typeof setTimeout> | undefined;
    const cancelRejoin = () => {
      clearTimeout(rejoinTimer);
      rejoinTimer = undefined;
    };
    // The join was answered, or the socket closed: nothing is pending.
    const settle = () => {
      cancelRejoin();
      joinPending = false;
      rejoins = 0;
    };
    const join = () => {
      cancelRejoin();
      joinPending = true;
      connection.send({ type: 'join', payload: { mapId: ROOM.DEFAULT_ROOM_ID } });
      if (presenceRef.current !== 'viewing') {
        connection.send({ type: 'presence:set', payload: { state: presenceRef.current } });
      }
      sender.restart();
    };
    const resync = () => {
      if (!joinPending) join();
      else if (rejoinTimer === undefined) {
        rejoins += 1;
        rejoinTimer = setTimeout(join, backoffDelay(rejoins, Math.random));
      }
    };

    const unsubscribe = [
      connection.onState((next) => {
        setState(next);
        if (next === 'degraded' || next === 'offline') resyncOnOpen = true;
        if (next === 'open') return;
        // Nothing live arrives while closed: drop what would go stale; the next join resends it.
        settle();
        setUsers([]);
        setDrafts([]);
      }),
      connection.onOpen(() => {
        if (resyncOnOpen) void queryClient.invalidateQueries(areasKey);
        resyncOnOpen = true;
        join();
      }),
      connection.on('presence', ({ payload }) => setUsers(payload.users)),
      connection.on('draft:state', ({ payload }) => {
        settle();
        setDrafts(payload.drafts.filter((draft) => draft.userId !== selfId));
      }),
      connection.on('draft:update', ({ payload }) =>
        setDrafts((current) => applyRemoteDraftOp(current, payload, selfId)),
      ),
      connection.on('area:created', patch),
      connection.on('area:updated', patch),
      connection.on('area:deleted', patch),
      // Branch on the flag, not the code (CONFLICT, DRAFT_OP_MISFIT and INTERNAL carry it today).
      connection.on('error', ({ payload }) => {
        if (payload.resync) resync();
        else if (payload.code === ERROR_CODES.RATE_LIMITED) {
          sender.pause(payload.retryAfter ?? DRAFT_INTERVAL_MS, payload.frameSeq);
        }
      }),
    ];

    return () => {
      for (const off of unsubscribe) off();
      cancelRejoin();
      sender.dispose();
      connection.close();
      connectionRef.current = null;
      senderRef.current = null;
      setState('connecting');
      setUsers([]);
      setDrafts([]);
    };
  }, [queryClient, selfId]);

  // Degraded or offline: no area events arrive, so the viewport lists are refetched on a timer
  // instead, from the first failed reconnects on. The first refetch the API answers after none
  // did means the network is back: the socket is retried at once, so the banner does not outlive
  // the outage by a backoff wait (up to `WS.RECONNECT_BACKOFF_MS.max`). Only on that edge: while
  // the API answers and the Room does not, the socket keeps its jittered backoff (spec §5). The
  // poll stops once the API answers 401: polling cannot fix a session that ended (the app's query
  // client sends the visitor to sign in).
  useEffect(() => {
    if (state !== 'degraded' && state !== 'offline') return;
    let lastPollFailed = true;
    const timer = setInterval(() => {
      if (sessionEnded(queryClient)) clearInterval(timer);
      else {
        void queryClient
          .invalidateQueries({ queryKey: [QUERY.AREAS_KEY] }, { throwOnError: true })
          .then(
            () => {
              if (lastPollFailed) connectionRef.current?.retryNow();
              lastPollFailed = false;
            },
            () => {
              lastPollFailed = true;
            },
          );
      }
    }, WS.OFFLINE_POLL_MS);
    return () => clearInterval(timer);
  }, [state, queryClient]);

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
      senderRef.current?.update([]);
      setPresence('viewing');
    };
    const unsubscribe = [
      onDraw(map, 'draw:change', ({ vertices }) => {
        setPresence('drawing');
        senderRef.current?.update(vertices);
      }),
      onDraw(map, 'draw:done', end),
      onDraw(map, 'draw:cancel', end),
    ];
    return () => {
      for (const off of unsubscribe) off();
      // The sketch on this map is gone (the draw control is keyed on the map).
      end();
    };
  }, [map]);

  return { state, users, drafts, reconnect };
}
