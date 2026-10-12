import { RETENTION } from '@cgis/shared';
import type { Env } from './app';
import { withClient } from './db';
import { purgeDeleted } from './db/purge';

/**
 * The Worker's Cron Trigger handler (`RETENTION.CRON`, declared in wrangler.jsonc `triggers.crons`):
 * purges areas soft-deleted more than `RETENTION.DAYS` before the scheduled time and logs one JSON
 * line with the counts. A failure propagates, so the invocation is recorded as failed; the next
 * day's run picks up whatever this one left (the purge is idempotent).
 */
export const scheduled: ExportedHandlerScheduledHandler<Env> = async (controller, env) => {
  const counts = await withClient(env, (client) =>
    purgeDeleted(client, new Date(controller.scheduledTime)),
  );
  console.log(
    JSON.stringify({
      level: 'info',
      msg: RETENTION.AUDIT_ACTION,
      ...counts,
      cron: controller.cron,
    }),
  );
};
