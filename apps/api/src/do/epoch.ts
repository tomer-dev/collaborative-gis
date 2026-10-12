/**
 * The Room's storage epoch: a random id that the first `join` on this storage writes to the
 * Room's synchronous KV, and that every `join` copies into the socket's attachment. Attachments
 * outlive the instance (hibernation) and storage outlives both, so the two agree, unless the
 * storage was lost while sockets stayed attached. A joined socket whose epoch is not the stored one
 * joined state that the Room no longer has; handlers.ts tells it to resync.
 */
const EPOCH_KEY = 'epoch';

/** The stored epoch; `null` before the first join on this storage. */
export function storedEpoch(storage: DurableObjectStorage): string | null {
  const value = storage.kv.get(EPOCH_KEY);
  return typeof value === 'string' ? value : null;
}

/** The stored epoch, written first when there is none (the first join on this storage). */
export function ensureEpoch(storage: DurableObjectStorage): string {
  const stored = storedEpoch(storage);
  if (stored !== null) return stored;
  const epoch = crypto.randomUUID();
  storage.kv.put(EPOCH_KEY, epoch);
  return epoch;
}
