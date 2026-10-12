import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button';
import { IconClose } from './icons';
import { Panel } from './Panel';
import { PresenceList } from './PresenceList';
import { Stat } from './Stat';

/** Side panel shell: titled landmark, scrolling body, optional footer. */
const meta = {
  title: 'Components/Panel',
  component: Panel,
  args: {
    title: 'North orchard',
    actions: <Button variant="ghost" size="sm" icon={IconClose} aria-label="Close panel" />,
    children: (
      <div className="flex flex-col gap-6">
        <Stat label="Area" value={12.3456} unit="km²" />
        <PresenceList
          users={[
            { id: 'u1', name: 'Ada Lovelace', colorSlot: 0, state: 'drawing', self: true },
            { id: 'u2', name: 'Grace Hopper', colorSlot: 1 },
          ]}
        />
      </div>
    ),
  },
  argTypes: {
    variant: { control: 'inline-radio', options: ['docked', 'floating'] },
    actions: { control: false },
    children: { control: false },
    footer: { control: false },
  },
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Docked: Story = {
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="flex h-screen justify-end bg-bg-sunken">
        <Story />
      </div>
    ),
  ],
};

export const Floating: Story = { args: { variant: 'floating' } };

export const WithFooter: Story = {
  args: {
    variant: 'floating',
    footer: (
      <div className="flex justify-end gap-2">
        <Button variant="secondary">Cancel</Button>
        <Button>Save area</Button>
      </div>
    ),
  },
};
