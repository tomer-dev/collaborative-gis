import { describe, expect, it } from 'vitest';
import { LIMITS } from './constants';
import type { Position } from './geo';
import {
  applyDraftOp,
  AreaEventSchema,
  parseWsClientMessage,
  parseWsMessage,
  WsClientEventSchema,
} from './ws';

describe('parseWsMessage', () => {
  it('parses a join event', () => {
    const ev = parseWsMessage(
      JSON.stringify({ type: 'join', seq: 1, ts: 1700000000000, payload: { mapId: 'default' } }),
    );
    expect(ev.type).toBe('join');
  });

  it('rejects an unknown type', () => {
    expect(() =>
      parseWsMessage(JSON.stringify({ type: 'nope', seq: 1, ts: 1, payload: {} })),
    ).toThrow();
  });

  it('rejects a draft:update whose vertex is out of range', () => {
    const raw = JSON.stringify({
      type: 'draft:update',
      seq: 2,
      ts: 1,
      payload: { op: 'add', index: 0, vertex: [200, 0] },
    });
    expect(() => parseWsMessage(raw)).toThrow();
  });

  it('throws SyntaxError, not ZodError, on malformed JSON (callers must catch both)', () => {
    expect(() => parseWsMessage('{nope')).toThrow(SyntaxError);
  });
});

describe('M1 events', () => {
  const frame = (type: string, payload: unknown) =>
    JSON.stringify({ type, seq: 3, ts: 1, payload });

  it('parses a draft:state with two drafts', () => {
    const ev = parseWsMessage(
      frame('draft:state', {
        drafts: [
          {
            userId: 'u1',
            vertices: [
              [34.8, 32.0],
              [34.9, 32.0],
            ],
          },
          { userId: 'u2', vertices: [] },
        ],
      }),
    );
    expect(ev.type === 'draft:state' && ev.payload.drafts).toHaveLength(2);
  });

  it('parses presence:set and rejects an unknown state', () => {
    expect(parseWsMessage(frame('presence:set', { state: 'drawing' })).type).toBe('presence:set');
    expect(() => parseWsMessage(frame('presence:set', { state: 'sleeping' }))).toThrow();
  });

  it('WsClientEventSchema accepts client events and rejects server-only ones', () => {
    const parse = (raw: string) => WsClientEventSchema.safeParse(JSON.parse(raw)).success;
    expect(parse(frame('area:created', { area: {} }))).toBe(false);
    expect(parse(frame('leave', {}))).toBe(true);
    expect(() => parseWsClientMessage(frame('presence', { users: [] }))).toThrow();
    expect(parseWsClientMessage(frame('presence:set', { state: 'viewing' })).type).toBe(
      'presence:set',
    );
  });
});

describe('draft:update userId', () => {
  const update = (payload: Record<string, unknown>) =>
    JSON.stringify({ type: 'draft:update', seq: 4, ts: 1, payload });
  const op = { op: 'add', index: 0, vertex: [34.8, 32.0] };

  it('an outbound draft:update keeps the author the Room stamped', () => {
    const ev = parseWsMessage(update({ ...op, userId: 'u1' }));
    expect(ev.type === 'draft:update' && ev.payload).toEqual({ ...op, userId: 'u1' });
  });

  it('an inbound draft:update may omit userId', () => {
    const ev = parseWsClientMessage(update(op));
    expect(ev.type === 'draft:update' && ev.payload).toEqual(op);
  });

  it('rejects a userId over LIMITS.USER_ID_MAX', () => {
    expect(() =>
      parseWsMessage(update({ ...op, userId: 'x'.repeat(LIMITS.USER_ID_MAX + 1) })),
    ).toThrow();
  });
});

describe('area events and mapVersion', () => {
  const area = {
    id: '3f8b6c1e-2a4d-4e5f-9a7b-1c2d3e4f5a6b',
    name: 'Yarkon park',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [34.8, 32.0],
          [34.9, 32.0],
          [34.9, 32.1],
          [34.8, 32.0],
        ],
      ],
    },
    areaKm2: 12.3,
    version: 2,
    createdBy: 'user-1',
    createdAt: '2026-10-12T10:00:00Z',
    updatedAt: '2026-10-12T11:00:00Z',
  };
  const created = { type: 'area:created', payload: { area } };
  const stamped = (event: object, extra: object = {}) =>
    JSON.stringify({ ...event, seq: 7, ts: 1, ...extra });

  it('an outbound area event carries the mapVersion the Room stamped', () => {
    const ev = parseWsMessage(stamped(created, { mapVersion: 3 }));
    expect(ev.type === 'area:created' && ev.mapVersion).toBe(3);
  });

  it('mapVersion is optional (additive) and must be a non-negative integer', () => {
    expect(parseWsMessage(stamped(created)).type).toBe('area:created');
    expect(() => parseWsMessage(stamped(created, { mapVersion: -1 }))).toThrow();
    expect(() => parseWsMessage(stamped(created, { mapVersion: 1.5 }))).toThrow();
  });

  it('AreaEventSchema accepts the three unstamped area changes', () => {
    for (const event of [
      created,
      { type: 'area:updated', payload: { area } },
      { type: 'area:deleted', payload: { id: area.id } },
    ]) {
      expect(AreaEventSchema.parse(event)).toEqual(event);
    }
  });

  it('AreaEventSchema drops client-sent stamps: the Room sets seq, ts and mapVersion', () => {
    expect(AreaEventSchema.parse({ ...created, seq: 1, ts: 1, mapVersion: 99 })).toEqual(created);
  });

  it('AreaEventSchema rejects other event types and invalid payloads', () => {
    const invalid = [
      { type: 'presence', payload: { users: [] } },
      { type: 'area:deleted', payload: { id: 'not-a-uuid' } },
      { type: 'area:created', payload: { area: { ...area, name: '' } } },
      { type: 'area:updated', payload: {} },
    ];
    for (const event of invalid) expect(AreaEventSchema.safeParse(event).success).toBe(false);
  });
});

describe('error events and resync', () => {
  const error = (payload: object) => JSON.stringify({ type: 'error', seq: 9, ts: 1, payload });
  const base = { code: 'CONFLICT', message: 'room state lost; join again' };

  it('an error event may carry resync: true (the Room lost what the client relies on)', () => {
    const ev = parseWsMessage(error({ ...base, resync: true }));
    expect(ev.type === 'error' && ev.payload).toEqual({ ...base, resync: true });
  });

  it('resync is optional (additive) and must be a boolean', () => {
    const ev = parseWsMessage(error(base));
    expect(ev.type === 'error' && ev.payload).toEqual(base);
    expect(() => parseWsMessage(error({ ...base, resync: 'yes' }))).toThrow();
  });
});

describe('applyDraftOp', () => {
  const A: Position = [34.8, 32.0];
  const B: Position = [34.9, 32.0];
  const C: Position = [34.9, 32.1];

  it('adds at an index (index === length appends), moves, removes and clears', () => {
    expect(applyDraftOp([], { op: 'add', index: 0, vertex: A })).toEqual([A]);
    expect(applyDraftOp([A], { op: 'add', index: 1, vertex: C })).toEqual([A, C]);
    expect(applyDraftOp([A, C], { op: 'add', index: 1, vertex: B })).toEqual([A, B, C]);
    expect(applyDraftOp([A, B], { op: 'move', index: 1, vertex: C })).toEqual([A, C]);
    expect(applyDraftOp([A, B, C], { op: 'remove', index: 1 })).toEqual([A, C]);
    expect(applyDraftOp([A, B], { op: 'clear' })).toEqual([]);
  });

  it('rejects an index past the end', () => {
    expect(applyDraftOp([A], { op: 'add', index: 2, vertex: B })).toBeUndefined();
    expect(applyDraftOp([A], { op: 'move', index: 1, vertex: B })).toBeUndefined();
    expect(applyDraftOp([], { op: 'remove', index: 0 })).toBeUndefined();
  });

  it(`rejects an add beyond LIMITS.POLYGON_MAX_VERTICES (${LIMITS.POLYGON_MAX_VERTICES})`, () => {
    const full: Position[] = Array.from({ length: LIMITS.POLYGON_MAX_VERTICES }, () => A);
    expect(applyDraftOp(full, { op: 'add', index: 0, vertex: B })).toBeUndefined();
    expect(applyDraftOp(full.slice(1), { op: 'add', index: 0, vertex: B })).toHaveLength(
      LIMITS.POLYGON_MAX_VERTICES,
    );
  });
});
