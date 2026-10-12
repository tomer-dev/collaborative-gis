import type { Meta, StoryObj } from '@storybook/react-vite';
import { PresenceList, type PresenceUser } from './PresenceList';

const USERS: PresenceUser[] = [
  { id: 'u1', name: 'Ada Lovelace', colorSlot: 0, state: 'drawing', self: true },
  { id: 'u2', name: 'Grace Hopper', colorSlot: 1, state: 'viewing' },
  { id: 'u3', name: 'Alan Turing', colorSlot: 2, state: 'drawing' },
  { id: 'u4', name: 'Katherine Johnson', colorSlot: 3 },
  { id: 'u5', name: 'Edsger Dijkstra', colorSlot: 4 },
  { id: 'u6', name: 'Barbara Liskov', colorSlot: 5 },
  { id: 'u7', name: 'Donald Knuth', colorSlot: 6 },
  { id: 'u8', name: 'Margaret Hamilton', colorSlot: 7 },
  { id: 'u9', name: 'Ninth Visitor', colorSlot: null },
];

/** Who is on the map, in join order. `list` for the side panel, `stack` for the top bar. */
const meta = {
  title: 'Components/PresenceList',
  component: PresenceList,
  args: { users: USERS.slice(0, 3) },
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

/** Nine users: the ninth has no hue left and gets the neutral. */
export const Crowded: Story = { args: { users: USERS } };

export const Stack: Story = { args: { variant: 'stack' } };

export const StackOverflow: Story = { args: { variant: 'stack', users: USERS, max: 4 } };

export const Empty: Story = { args: { users: [] } };
