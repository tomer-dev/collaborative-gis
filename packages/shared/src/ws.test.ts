import { describe, expect, it } from 'vitest';
import { parseWsMessage } from './ws';

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
});
