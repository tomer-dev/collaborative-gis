import { MAP, PresenceUserSchema } from '@cgis/shared';
import { describe, expect, it } from 'vitest';
import { presenceColor } from '../../src/do/presence';

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
