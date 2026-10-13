import { MAP, PresenceUserSchema } from '@cgis/shared';
import { describe, expect, it } from 'vitest';
import {
  attachmentOf,
  type PresenceAttachment,
  presenceColor,
  presenceOf,
} from '../../src/do/presence';

describe('presenceColor', () => {
  it('MAP.PRESENCE_COLORS is the 8-hue palette, each a valid PresenceUser colour', () => {
    expect(MAP.PRESENCE_COLORS).toHaveLength(8);
    expect(new Set(MAP.PRESENCE_COLORS).size).toBe(8);
    for (const color of MAP.PRESENCE_COLORS) {
      expect(() =>
        PresenceUserSchema.parse({ userId: 'u', name: 'n', color, state: 'viewing' }),
      ).not.toThrow();
    }
  });

  it('is deterministic per userId and always from the palette', async () => {
    const first = await presenceColor('user-123');
    expect(MAP.PRESENCE_COLORS).toContain(first);
    expect(await presenceColor('user-123')).toBe(first);
  });

  it('spreads users across the palette', async () => {
    const ids = Array.from({ length: 64 }, (_, i) => `user-${i}`);
    const colors = new Set(await Promise.all(ids.map(presenceColor)));
    expect(colors.size).toBeGreaterThanOrEqual(6);
  });
});

describe('attachmentOf', () => {
  const socketWith = (attachment?: unknown) => {
    const ws = new WebSocketPair()[1];
    if (attachment !== undefined) ws.serializeAttachment(attachment);
    return ws;
  };
  const valid: PresenceAttachment = {
    userId: 'u1',
    name: 'Alice',
    color: MAP.PRESENCE_COLORS[0],
    state: 'viewing',
    lastSeen: 1_700_000_000_000,
    joined: true,
    strikes: 0,
    windowStart: 1_700_000_000_000,
    frames: 3,
    lastSeq: 7,
    epoch: '3f8b6c1e-2a4d-4e5f-9a7b-1c2d3e4f5a6b',
  };

  it('returns a valid attachment', () => {
    expect(attachmentOf(socketWith(valid))).toEqual(valid);
  });

  it.each([
    ['no attachment', undefined],
    ['missing fields', { userId: 'u1' }],
    ['a colour outside the palette', { ...valid, color: '#000000' }],
    ['an unknown state', { ...valid, state: 'sleeping' }],
    ['a fractional lastSeen', { ...valid, lastSeen: 1.5 }],
    ['no joined flag', { ...valid, joined: undefined }],
    ['negative strikes', { ...valid, strikes: -1 }],
    ['negative frames', { ...valid, frames: -1 }],
    ['a fractional lastSeq', { ...valid, lastSeq: 1.5 }],
    ['an epoch that is not a UUID', { ...valid, epoch: 'epoch-1' }],
    ['no epoch field', { ...valid, epoch: undefined }],
  ])('returns undefined for %s', (_label, attachment) => {
    expect(attachmentOf(socketWith(attachment))).toBeUndefined();
  });
});

describe('presenceOf', () => {
  const base: PresenceAttachment = {
    userId: 'u1',
    name: 'Alice',
    color: MAP.PRESENCE_COLORS[0],
    state: 'viewing',
    lastSeen: 0,
    joined: true,
    strikes: 0,
    windowStart: 0,
    frames: 0,
    lastSeq: null,
    epoch: null,
  };
  const user = (over: Partial<PresenceAttachment>): PresenceAttachment => ({ ...base, ...over });

  it('lists joined users only, one entry per user, drawing if any socket draws, sorted by name', () => {
    expect(
      presenceOf([
        user({ userId: 'u3', name: 'Carol', joined: false }),
        user({ userId: 'u2', name: 'Bob' }),
        user({ userId: 'u1', name: 'Alice', state: 'drawing' }),
        user({ userId: 'u1', name: 'Alice' }),
      ]),
    ).toEqual([
      { userId: 'u1', name: 'Alice', color: MAP.PRESENCE_COLORS[0], state: 'drawing' },
      { userId: 'u2', name: 'Bob', color: MAP.PRESENCE_COLORS[0], state: 'viewing' },
    ]);
  });

  it('every entry is a valid PresenceUser', () => {
    for (const entry of presenceOf([user({})])) {
      expect(PresenceUserSchema.parse(entry)).toEqual(entry);
    }
  });
});
