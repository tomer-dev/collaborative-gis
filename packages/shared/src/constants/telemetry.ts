/**
 * Metrics (ticket 6.7): Analytics Engine datapoints. Every datapoint is
 * `{ indexes: [event], blobs: [event, subject], doubles: [value] }`, so one SQL query over the
 * dataset groups by `blob1` (the README's Metrics paragraph, under Performance considerations).
 */
export const TELEMETRY = {
  /** The Analytics Engine dataset the `METRICS` binding writes to (wrangler.jsonc, every env). */
  DATASET: 'cgis_metrics',
  /** `blob1` (and the index) of each datapoint; `blob2` and `double1` are named per event. */
  EVENTS: {
    /** A Room socket accepted. `blob2`: the room id; `double1`: 1. */
    WS_OPEN: 'ws_open',
    /**
     * A Room socket closed or errored. `blob2`: the room id; `double1`: 1. Not paired one-to-one
     * with `WS_OPEN`: sockets dropped by an eviction or a deploy write none, so
     * `ws_open - ws_close` is not a live-socket count.
     */
    WS_CLOSE: 'ws_close',
    /** Client frames a Room received in one `MESSAGES_FLUSH_MS` window. `blob2`: the room id; `double1`: the count. */
    ROOM_MESSAGES: 'room_messages',
    /**
     * One areas request's database time, connect + query (the Hyperdrive connection is acquired
     * inside the timed span). `blob2`: a `DB_OPS` value; `double1`: milliseconds.
     */
    DB_QUERY: 'db_query',
  },
  /** `blob2` of a `DB_QUERY` datapoint: which areas path ran. */
  DB_OPS: {
    /** `GET /api/areas` (the bounds read). */
    LIST: 'areas.list',
    /** `GET /api/areas/:id/versions`. */
    VERSIONS: 'areas.versions',
    /** A create, update, delete or revert transaction. */
    WRITE: 'areas.write',
  },
  /**
   * A Room batches its message count into one datapoint per this window (never one per draft
   * frame): the first frame after a flush arms a timer, which writes the count when it fires.
   */
  MESSAGES_FLUSH_MS: 1000,
} as const;
