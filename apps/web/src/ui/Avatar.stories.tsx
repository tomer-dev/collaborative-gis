import { MAP } from '@cgis/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Avatar } from './Avatar';

/** A user's initials in their presence colour (server-assigned), matching their ghost polygon. */
const meta = {
  title: 'Components/Avatar',
  component: Avatar,
  args: { name: 'Ada Lovelace', color: MAP.PRESENCE_COLORS[0] },
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    color: { control: 'select', options: [...MAP.PRESENCE_COLORS] },
  },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      <Avatar {...args} size="sm" />
      <Avatar {...args} size="md" />
      <Avatar {...args} size="lg" />
    </div>
  ),
};

const NAMES = [
  'Ada Lovelace',
  'Grace Hopper',
  'Alan Turing',
  'Katherine Johnson',
  'Edsger Dijkstra',
  'Barbara Liskov',
  'Donald Knuth',
  'Margaret Hamilton',
];

/** Every colour of MAP.PRESENCE_COLORS, the palette the server hashes user ids into. */
export const Palette: Story = {
  render: (args) => (
    <ul className="flex flex-wrap gap-3" aria-label="Presence colours">
      {MAP.PRESENCE_COLORS.map((color, index) => (
        <li key={color}>
          <Avatar {...args} name={NAMES[index] ?? args.name} color={color} />
        </li>
      ))}
    </ul>
  ),
};

export const SingleName: Story = { args: { name: 'Hypatia', color: MAP.PRESENCE_COLORS[6] } };
