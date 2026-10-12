import { MAP } from '@cgis/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Avatar } from './Avatar';

/** A user's initials in their presence hue (join-order slot), matching their ghost polygon. */
const meta = {
  title: 'Components/Avatar',
  component: Avatar,
  args: { name: 'Ada Lovelace', colorSlot: 0 },
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    colorSlot: { control: { type: 'number', min: 0, max: MAP.PRESENCE_COLORS.length } },
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
  'Ninth Visitor',
];

/** Slots 1–8 get the presence hues; the ninth user gets the neutral. */
export const AllSlots: Story = {
  render: (args) => (
    <ul className="flex flex-wrap gap-3" aria-label="Presence hues">
      {NAMES.map((name, slot) => (
        <li key={name}>
          <Avatar {...args} name={name} colorSlot={slot} />
        </li>
      ))}
    </ul>
  ),
};

export const SingleName: Story = { args: { name: 'Hypatia', colorSlot: 6 } };
