import { describe, expect, it } from 'vitest';
import { LIMITS } from './constants';
import { parseWsClientMessage, parseWsMessage, WsClientEventSchema } from './ws';

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
