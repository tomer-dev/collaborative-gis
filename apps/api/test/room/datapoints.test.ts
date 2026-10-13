import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { closeRoom, connect, join, newRoom, stub } from './protocol-harness';

// Wire values (event names, blob order) are spelled out: they are what the dashboard query reads.
// The Room runs in the test isolate, so a spy on the test env's METRICS binding sees its writes.

/** The Room's name (`idFromName`), the datapoints' `blob2`. */
let roomId: string;
let points: MockInstance<AnalyticsEngineDataset['writeDataPoint']>;

/** The datapoints written so far with `blob1 = event`. */
const written = (event: string) =>
  points.mock.calls.map(([point]) => point).filter((point) => point?.blobs?.[0] === event);

beforeEach(() => {
  newRoom();
  roomId = stub.id.name ?? '';
  points = vi.spyOn(env.METRICS, 'writeDataPoint');
});
afterEach(closeRoom);

describe('Room datapoints (Analytics Engine)', () => {
  it('ws_open: one datapoint per accepted socket, double 1', async () => {
    await connect('alice');
    await connect('bob');
    expect(written('ws_open')).toEqual([
      { indexes: ['ws_open'], blobs: ['ws_open', roomId], doubles: [1] },
      { indexes: ['ws_open'], blobs: ['ws_open', roomId], doubles: [1] },
    ]);
  });

  it('ws_close: one datapoint when a socket closes, double 1', async () => {
    const alice = await connect('alice');
    alice.ws.close(1000);
    // A client-initiated close fires no close event on this end in workerd; poll the spy instead.
    await vi.waitFor(() =>
      expect(written('ws_close')).toEqual([
        { indexes: ['ws_close'], blobs: ['ws_close', roomId], doubles: [1] },
      ]),
    );
  });

  it('room_messages: client frames batched into one datapoint per window, not one per frame', async () => {
    const alice = await join('alice');
    alice.send('presence:set', { state: 'drawing' });
    alice.send('presence:set', { state: 'viewing' });
    await vi.waitFor(() => expect(written('room_messages')).toHaveLength(1), { timeout: 3000 });
    expect(written('room_messages')).toEqual([
      { indexes: ['room_messages'], blobs: ['room_messages', roomId], doubles: [3] },
    ]);
  });
});
