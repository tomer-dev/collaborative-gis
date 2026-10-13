import { type AreaList, type Draft, QUERY } from '@cgis/shared';
import type { QueryClient } from '@tanstack/react-query';
import { isUnauthorized } from './api-client';
import { applyDraftOp, type DraftOp } from './draft-sender';
import type { IncomingEvent } from './ws';

/** The `area:*` events, each patched into the areas cache. */
export type AreaWsEvent = IncomingEvent<'area:created' | 'area:updated' | 'area:deleted'>;

/**
 * An `area:*` event applied to one cached viewport list: created/updated replace the area by id
 * (or append it) unless the cache already holds a newer version; deleted removes it. Returns the
 * list unchanged when there is nothing to do, and `undefined` for an empty cache entry.
 */
export function patchAreas(list: AreaList | undefined, event: AreaWsEvent): AreaList | undefined {
  if (!list) return list;
  if (event.type === 'area:deleted') {
    const { id } = event.payload;
    return list.areas.some((area) => area.id === id)
      ? { areas: list.areas.filter((area) => area.id !== id) }
      : list;
  }
  const { area } = event.payload;
  const cached = list.areas.find((candidate) => candidate.id === area.id);
  if (!cached) return { areas: [...list.areas, area] };
  if (cached.version > area.version) return list;
  return { areas: list.areas.map((candidate) => (candidate.id === area.id ? area : candidate)) };
}

/** A relayed `draft:update` applied to the other users' drafts (an op that does not fit is ignored). */
export function applyRemoteDraftOp(drafts: Draft[], op: DraftOp, selfId: string): Draft[] {
  const { userId } = op;
  if (userId === undefined || userId === selfId) return drafts;
  const current = drafts.find((draft) => draft.userId === userId);
  const vertices = applyDraftOp(current?.vertices ?? [], op);
  if (!vertices) return drafts;
  if (vertices.length === 0) return drafts.filter((draft) => draft !== current);
  if (!current) return [...drafts, { userId, vertices }];
  return drafts.map((draft) => (draft === current ? { userId, vertices } : draft));
}

/** An areas query holds a 401: the session ended (the app's query client sends the visitor to sign in). */
export function sessionEnded(queryClient: QueryClient): boolean {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: [QUERY.AREAS_KEY] })
    .some((query) => isUnauthorized(query.state.error));
}
