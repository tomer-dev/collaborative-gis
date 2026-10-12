import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { IconLayers, IconMinus, IconPencil, IconPlus, IconPointer } from './icons';
import { MapControl, MapControlButton } from './MapControl';

/**
 * Map toolbar: a labelled group of icon buttons, each its own Tab stop, named by `label`
 * (aria-label + native title). Mode buttons use `pressed`. The map component places it in a
 * Leaflet control container.
 */
const meta = {
  title: 'Components/MapControl',
  component: MapControl,
  args: {
    label: 'Drawing tools',
    children: (
      <>
        <MapControlButton label="Pan the map" icon={IconPointer} pressed={false} />
        <MapControlButton label="Draw an area" icon={IconPencil} pressed />
        <MapControlButton label="Map layers" icon={IconLayers} />
      </>
    ),
  },
  argTypes: {
    orientation: { control: 'inline-radio', options: ['vertical', 'horizontal'] },
    children: { control: false },
  },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof MapControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Vertical: Story = {
  play: async ({ canvas, userEvent, step }) => {
    const pan = canvas.getByRole('button', { name: 'Pan the map' });
    const draw = canvas.getByRole('button', { name: 'Draw an area' });
    const layers = canvas.getByRole('button', { name: 'Map layers' });
    await step('Tab visits each button in order', async () => {
      await userEvent.tab();
      await expect(pan).toHaveFocus();
      await userEvent.tab();
      await expect(draw).toHaveFocus();
      await userEvent.tab();
      await expect(layers).toHaveFocus();
    });
    await step('Labels double as the native title; the pressed mode is exposed', async () => {
      await expect(draw).toHaveAttribute('title', 'Draw an area');
      await expect(draw).toHaveAttribute('aria-pressed', 'true');
    });
  },
};

export const Horizontal: Story = {
  args: {
    orientation: 'horizontal',
    label: 'Zoom',
    children: (
      <>
        <MapControlButton label="Zoom in" icon={IconPlus} />
        <MapControlButton label="Zoom out" icon={IconMinus} />
      </>
    ),
  },
};

const onZoomIn = fn();

export const WithDisabled: Story = {
  args: {
    label: 'Zoom',
    children: (
      <>
        <MapControlButton label="Zoom in" icon={IconPlus} onClick={onZoomIn} />
        <MapControlButton label="Zoom out" icon={IconMinus} disabled />
      </>
    ),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Zoom in' }));
    await expect(onZoomIn).toHaveBeenCalled();
    await expect(canvas.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
  },
};
