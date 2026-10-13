import type { AUDIT } from '@cgis/shared';
import { z } from 'zod';
import type { Env } from '../app';
import { log, redact } from '../log';
import { withClient } from './index';
import { type AuditRow, writeAudit } from './spatial';

// Audit rows written outside a mutation transaction (D20): auth events and rejected requests (the
// audit middleware). Area mutations and draw sessions write theirs inside the mutation's own
// transaction (services/areas.ts) and never come through here, so no event is written twice.

type Values<T> = T[keyof T];

/** A row for `recordAudit`: `action` and `entity` from the shared `AUDIT` vocabulary. */
export type AuditEvent = AuditRow & {
  action: Values<typeof AUDIT.ACTIONS>;
  entity: Values<typeof AUDIT.ENTITIES>;
};

const DetailsSchema = z.record(z.string(), z.unknown());

/**
 * Appends `event` on its own client, with `details` redacted (`LOG.REDACT_KEYS`, any depth).
 * Never rejects: a failed write is logged as one JSON error line, so the request or the frame it
 * records goes on unaffected. Callers run it in `waitUntil`, after their response, so it takes no
 * abort signal from the request.
 */
export async function recordAudit(env: Env, event: AuditEvent): Promise<void> {
  try {
    const details = event.details
      ? DetailsSchema.parse(JSON.parse(JSON.stringify(event.details, redact)))
      : null;
    // Detached from the request's signal: this runs after the response, and a client that has
    // gone (or the request deadline) must not end the write.
    await withClient(env, (client) => writeAudit(client, { ...event, details }), { signal: null });
  } catch (err) {
    log('error', 'audit write failed', {
      action: event.action,
      requestId: event.requestId ?? null,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
