import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { Input } from './Input';

/** Single-line text input. Always give it a label: wrap it in a Field, or pass aria-label. */
const meta = {
  title: 'Components/Input',
  component: Input,
  args: { 'aria-label': 'Area name', placeholder: 'e.g. North orchard…', onChange: fn() },
  argTypes: { size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] } },
  decorators: [
    (Story) => (
      <div className="w-xs">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, userEvent, args }) => {
    const input = canvas.getByRole('textbox', { name: 'Area name' });
    await userEvent.type(input, 'Orchard');
    await expect(input).toHaveValue('Orchard');
    await expect(args.onChange).toHaveBeenCalledTimes('Orchard'.length);
  },
};

export const WithValue: Story = { args: { defaultValue: 'North orchard' } };

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-col gap-3">
      <Input {...args} size="sm" aria-label="Small" />
      <Input {...args} size="md" aria-label="Medium" />
      <Input {...args} size="lg" aria-label="Large" />
    </div>
  ),
};

export const Invalid: Story = {
  args: { invalid: true, defaultValue: '' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: 'Area name' })).toBeInvalid();
  },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: 'Read only while offline' },
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole('textbox', { name: 'Area name' });
    await userEvent.type(input, 'x');
    await expect(input).toHaveValue('Read only while offline');
  },
};
