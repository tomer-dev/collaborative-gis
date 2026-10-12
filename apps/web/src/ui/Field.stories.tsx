import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Field } from './Field';
import { Input } from './Input';

/** Label, control, hint and error, wired with label/for and aria-describedby. */
const meta = {
  title: 'Components/Field',
  component: Field,
  args: { label: 'Area name', children: <Input placeholder="e.g. North orchard…" /> },
  argTypes: { children: { control: false } },
  decorators: [
    (Story) => (
      <div className="w-xs">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithHint: Story = { args: { hint: 'Up to 120 characters.' } };

export const Required: Story = { args: { required: true, hint: 'Shown to everyone on the map.' } };

export const WithError: Story = {
  args: {
    required: true,
    hint: 'Up to 120 characters.',
    error: 'Give the area a name.',
    children: <Input defaultValue="" />,
  },
  play: async ({ canvas }) => {
    const input = canvas.getByRole('textbox', { name: /Area name/ });
    await expect(input).toBeInvalid();
    await expect(input).toHaveAccessibleDescription('Up to 120 characters. Give the area a name.');
  },
};
