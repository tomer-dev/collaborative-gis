import { MAP, type PresenceUser } from '@cgis/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { PresenceList } from './PresenceList';

const NAMES = [
  'Ada Lovelace',
  'Grace Hopper',
  'Alan Turing',
  'Katherine Johnson',
  'Edsger Dijkstra',
  'Barbara Liskov',
  'Donald Knuth',
  'Margaret Hamilton',
  'Hedy Lamarr',
];

/** What the room sends: each user with the colour the server hashed from their id. */
const USERS: PresenceUser[] = NAMES.map((name, index) => ({
  userId: `u${index + 1}`,
  name,
  color: MAP.PRESENCE_COLORS[index % MAP.PRESENCE_COLORS.length] ?? MAP.PRESENCE_COLORS[0],
  state: index === 0 || index === 2 ? 'drawing' : 'viewing',
}));

/** Who is on the map. `list` for the side panel, `stack` for the top bar. */
const meta = {
  title: 'Components/PresenceList',
  component: PresenceList,
  args: { users: USERS.slice(0, 3), selfId: 'u1' },
  argTypes: { variant: { control: 'inline-radio', options: ['list', 'stack'] } },
  decorators: [
    (Story) => (
      <div className="w-xs">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PresenceList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const List: Story = {};

/** Nine users on an eight-colour palette: two share a colour; names tell them apart. */
export const Crowded: Story = { args: { users: USERS } };

export const Stack: Story = { args: { variant: 'stack' } };

export const StackOverflow: Story = { args: { variant: 'stack', users: USERS, max: 4 } };

export const Empty: Story = { args: { users: [] } };
