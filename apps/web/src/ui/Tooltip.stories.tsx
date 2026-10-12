import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import { Button } from './Button';
import { IconLayers } from './icons';
import { Tooltip } from './Tooltip';

/** Short plain-text hint on hover and focus; Escape hides it. Never put controls inside. */
const meta = {
  title: 'Components/Tooltip',
  component: Tooltip,
  args: {
    content: 'Only areas saved in the last 7 days',
    children: <Button variant="secondary">Recent</Button>,
  },
  argTypes: {
    side: { control: 'inline-radio', options: ['top', 'right', 'bottom', 'left'] },
    children: { control: false },
  },
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="p-16">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Recent' });
    await userEvent.tab();
    await expect(trigger).toHaveFocus();
    const tooltip = await canvas.findByRole('tooltip');
    await expect(tooltip).toBeVisible();
    await expect(trigger).toHaveAccessibleDescription('Only areas saved in the last 7 days');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.queryByRole('tooltip')).toBeNull());
  },
};

export const Right: Story = { args: { side: 'right' } };

export const Bottom: Story = { args: { side: 'bottom' } };

export const Left: Story = { args: { side: 'left' } };

/** On an icon-only button the tooltip is the button's name (relation="label"). */
export const AsLabel: Story = {
  args: {
    content: 'Map layers',
    relation: 'label',
    children: <Button variant="secondary" icon={IconLayers} />,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Map layers' })).toBeInTheDocument();
  },
};
