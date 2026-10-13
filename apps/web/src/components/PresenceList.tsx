import { COPY, type PresenceUser } from '@cgis/shared';
import { Panel, PresenceList as PresenceListView } from '../ui';

export type PresenceListProps = {
  /** `useRoom().users`: everyone in the room with their server-assigned colour and state. */
  users: PresenceUser[];
  /** The signed-in user, labelled "(you)". */
  selfId: string;
};

/**
 * Who is on the map (the map route places it in its bottom-left column): name, presence colour,
 * and whether each person is drawing. Hidden until the room's first presence list arrives (and
 * while offline).
 */
export function PresenceList({ users, selfId }: PresenceListProps) {
  if (users.length === 0) return null;
  return (
    <Panel as="section" variant="floating" title={COPY.PRESENCE.TITLE}>
      <PresenceListView users={users} selfId={selfId} label={COPY.PRESENCE.LABEL} />
    </Panel>
  );
}
