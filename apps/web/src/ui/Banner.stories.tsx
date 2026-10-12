import type { Meta, StoryObj } from '@storybook/react-vite';
import { Banner } from './Banner';
import { Button } from './Button';

/** Page-level status, chiefly the realtime connection. Icon + label carry the meaning, not colour. */
const meta = {
  title: 'Components/Banner',
  component: Banner,
  args: { tone: 'ok', title: 'Connected', children: 'Live updates are on.' },
  argTypes: {
    tone: { control: 'inline-radio', options: ['ok', 'warn', 'danger', 'info'] },
    action: { control: false },
  },
  decorators: [
    (Story) => (
      <div className="w-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Banner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Connected: Story = {};

export const Reconnecting: Story = {
  args: { tone: 'warn', title: 'Reconnecting', children: 'Your drafts are kept on this device.' },
};

export const Offline: Story = {
  args: {
    tone: 'danger',
    title: 'Offline',
    children: 'Checking again every 10 seconds.',
    action: (
      <Button size="sm" variant="secondary">
        Retry now
      </Button>
    ),
  },
};

export const Info: Story = {
  args: { tone: 'info', title: 'Read only', children: 'Sign in to draw areas.' },
};

export const TitleOnly: Story = {
  args: { tone: 'warn', title: 'Reconnecting…', children: undefined },
};
