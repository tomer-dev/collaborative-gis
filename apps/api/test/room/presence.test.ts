import { MAP, PresenceUserSchema } from '@cgis/shared';
import { describe, expect, it } from 'vitest';
import { attachmentOf, presenceColor } from '../../src/do/presence';

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
  const valid = {
    userId: 'u1',
    name: 'Alice',
    color: MAP.PRESENCE_COLORS[0],
    state: 'viewing',
    lastSeen: 1_700_000_000_000,
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
  ])('returns undefined for %s', (_label, attachment) => {
    expect(attachmentOf(socketWith(attachment))).toBeUndefined();
  });
});
