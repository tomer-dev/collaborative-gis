import { COPY, MAP, type PresenceUser } from '@cgis/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { PresenceList } from './PresenceList';

afterEach(cleanup);

const users: PresenceUser[] = [
  { userId: 'me', name: 'Ada Lovelace', color: MAP.PRESENCE_COLORS[0], state: 'viewing' },
  { userId: 'u2', name: 'Bo Diddley', color: MAP.PRESENCE_COLORS[1], state: 'drawing' },
];

it('lists everyone in a titled panel with their server colour, marks you and who is drawing', () => {
  render(<PresenceList users={users} selfId="me" />);

  expect(screen.getByRole('region', { name: COPY.PRESENCE.TITLE })).toBeTruthy();
  const rows = within(screen.getByRole('list', { name: COPY.PRESENCE.LABEL })).getAllByRole(
    'listitem',
  );
  expect(rows).toHaveLength(2);
  expect(rows[0]!.textContent).toContain('Ada Lovelace');
  expect(rows[0]!.textContent).toContain('(you)');
  expect(rows[0]!.textContent).not.toContain('Drawing');
  expect(rows[1]!.textContent).toContain('Drawing');
  const avatar = rows[1]!.querySelector<HTMLElement>('[aria-hidden="true"]');
  expect(avatar?.style.getPropertyValue('--presence')).toBe(MAP.PRESENCE_COLORS[1]);
});

it('renders nothing before the first presence list', () => {
  const view = render(<PresenceList users={[]} selfId="me" />);
  expect(view.container.innerHTML).toBe('');
});
