import type { Env } from '../../src/app';
import { withClient } from '../../src/db';
import { laneEnv } from '../auth/lane-db';

/** The audit tests' own database (created and migrated by `laneEnv`), shared by test/audit/*. */
export const auditEnv = (): Promise<Env> => laneEnv('cgis_audit');

/** An `audit_log` row by its column names, without `id` and `at`. */
export type AuditLogRow = {
  user_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  version: number | null;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  details: unknown;
};

/** The `audit_log` rows matching `where` (test-controlled text), oldest first. */
export function auditRowsWhere(env: Env, where: string, values: unknown[]): Promise<AuditLogRow[]> {
  return withClient(env, async (client) => {
    const { rows } = await client.query<AuditLogRow>(
      `select user_id, action, entity, entity_id, version, ip, user_agent, request_id, details
       from audit_log where ${where} order by id`,
      values,
    );
    return rows;
  });
}

/** The rows one request wrote, found by the `x-request-id` its response carries. */
export function auditRowsOf(env: Env, res: Response): Promise<AuditLogRow[]> {
  const requestId = res.headers.get('x-request-id');
  if (!requestId) throw new Error('response has no x-request-id');
  return auditRowsWhere(env, 'request_id = $1', [requestId]);
}
