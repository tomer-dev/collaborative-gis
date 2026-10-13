import { describe, expect, it } from 'vitest';
import * as shared from './index';

describe('constants', () => {
  it('the WS client thresholds are ordered and the ping beats the Room idle sweep', () => {
    expect(shared.WS.CLIENT_DEGRADED_AFTER).toBeLessThan(shared.WS.CLIENT_OFFLINE_AFTER);
    expect(shared.WS.SOCKET_IDLE_MS).toBe(3 * shared.WS.PING_INTERVAL_MS);
    // Chrome runs the timers of a long-hidden tab once a minute: its ping still beats the cutoff.
    const hiddenTabTimerMs = 60_000;
    expect(Math.max(shared.WS.PING_INTERVAL_MS, hiddenTabTimerMs)).toBeLessThan(
      shared.WS.SOCKET_IDLE_MS,
    );
    expect(shared.WS.CLIENT_BACKOFF_JITTER).toBeGreaterThan(0);
    expect(shared.WS.CLIENT_BACKOFF_JITTER).toBeLessThan(1);
  });

  it('the offline banner states WS.OFFLINE_POLL_MS in seconds', () => {
    expect(shared.COPY.CONNECTION.OFFLINE_DETAIL).toContain(
      `every ${shared.WS.OFFLINE_POLL_MS / 1000} s`,
    );
  });

  it('the area name hint states LIMITS.AREA_NAME_MAX; the diff note carries both values', () => {
    expect(shared.COPY.AREAS.NAME_HINT).toContain(String(shared.LIMITS.AREA_NAME_MAX));
    const note = shared.COPY.AREAS.AREA_DIFF_NOTE('1.240 km²', '1.234 km²');
    expect(note).toContain('1.240 km²');
    expect(note).toContain('1.234 km²');
    expect(shared.MAP.AREA_DIFF_WARN_RATIO).toBe(0.005);
  });
});
