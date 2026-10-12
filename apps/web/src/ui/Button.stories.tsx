import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { Button } from './Button';
import { IconPencil, IconPlus } from './icons';

/** Actions. One primary button per view; danger only for destructive, confirmed actions. */
const meta = {
  title: 'Components/Button',
  component: Button,
  args: { children: 'Save area', onClick: fn() },
  argTypes: {
    variant: { control: 'inline-radio', options: ['primary', 'secondary', 'ghost', 'danger'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    icon: { control: false },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Save area' }));
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};

export const Secondary: Story = { args: { variant: 'secondary', children: 'Cancel' } };

export const Ghost: Story = { args: { variant: 'ghost', children: 'Load theirs' } };

export const Danger: Story = { args: { variant: 'danger', children: 'Delete area' } };

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      <Button {...args} size="sm">
        Small
      </Button>
      <Button {...args} size="md">
        Medium
      </Button>
      <Button {...args} size="lg">
        Large
      </Button>
    </div>
  ),
};

export const WithIcon: Story = { args: { icon: IconPencil, children: 'Draw area' } };

/** Icon-only buttons are square and must have an `aria-label` (or a Tooltip with relation="label"). */
export const IconOnly: Story = {
  args: { icon: IconPlus, children: undefined, 'aria-label': 'Zoom in', variant: 'secondary' },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvas, userEvent, args }) => {
    const button = canvas.getByRole('button', { name: 'Save area' });
    await expect(button).toBeDisabled();
    await userEvent.click(button);
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};

/** Keyboard: Tab focuses (visible ring), Enter and Space activate. */
export const Keyboard: Story = {
  play: async ({ canvas, userEvent, args, step }) => {
    await step('Tab to the button', async () => {
      await userEvent.tab();
      await expect(canvas.getByRole('button', { name: 'Save area' })).toHaveFocus();
    });
    await step('Enter and Space activate it', async () => {
      await userEvent.keyboard('{Enter}');
      await userEvent.keyboard(' ');
      await expect(args.onClick).toHaveBeenCalledTimes(2);
    });
  },
};
