import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { IconLayers, IconMinus, IconPencil, IconPlus, IconPointer } from './icons';
import { MapControl, MapControlButton } from './MapControl';

/**
 * Map toolbar. With `map` it mounts inside a Leaflet control at `position`; these stories render
 * it inline. One Tab stop; arrows move between buttons; mode buttons use `pressed`.
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
    map: { control: false },
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
    await step('Tab enters the toolbar once', async () => {
      await userEvent.tab();
      await expect(pan).toHaveFocus();
    });
    await step('Arrow keys move along it, wrapping at the ends', async () => {
      await userEvent.keyboard('{ArrowDown}');
      await expect(draw).toHaveFocus();
      await userEvent.keyboard('{End}');
      await expect(layers).toHaveFocus();
      await userEvent.keyboard('{ArrowDown}');
      await expect(pan).toHaveFocus();
    });
    await step('The pressed mode is exposed', async () => {
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
        <MapControlButton label="Zoom in" icon={IconPlus} tooltipSide="bottom" />
        <MapControlButton label="Zoom out" icon={IconMinus} tooltipSide="bottom" />
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
