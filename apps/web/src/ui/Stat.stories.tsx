import type { Meta, StoryObj } from '@storybook/react-vite';
import { Stat } from './Stat';

/** Labelled hero number with tabular digits: the polygon area in km². */
const meta = {
  title: 'Components/Stat',
  component: Stat,
  args: { label: 'Area', value: 12.3456, unit: 'km²' },
  argTypes: { size: { control: 'inline-radio', options: ['md', 'lg'] } },
} satisfies Meta<typeof Stat>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Area: Story = {};

/** Fewer than three vertices: no area yet. */
export const Empty: Story = { args: { value: null } };

export const Small: Story = { args: { value: 0.004213 } };

export const Large: Story = { args: { value: 22072.4 } };

export const Medium: Story = { args: { size: 'md' } };

/** Settled values (after save) may announce; the live drawing readout should not. */
export const Live: Story = { args: { label: 'Saved area', live: true } };
