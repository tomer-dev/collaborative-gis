import type { Meta, StoryObj } from '@storybook/react-vite';
import { Code, Page, TokenTable } from './TokenTable';
import { tokens, toPx } from './tokens';

/** Grid 4 spacing, radii and control sizes, read from src/styles/tokens.css. */
const meta = {
  title: 'Foundations/Spacing',
  parameters: { layout: 'fullscreen' },
  tags: ['!autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const spacing = tokens(/^--spacing-\d+$/);
const radii = tokens(/^--radius-/);

export const Spacing: Story = {
  render: () => (
    <Page
      title="Spacing"
      intro="Base unit 4 px. These steps are the only spacing utilities (p-*, m-*, gap-*, w-*, h-*, inset-*); Tailwind's open-ended multiplier is reset, so p-5.5 does not exist, and an arbitrary length or colour in brackets fails lint."
    >
      <TokenTable
        caption="Spacing steps"
        columns={['Utility step', 'Token', 'Value', 'Scale']}
        rows={spacing.map((token) => ({
          name: token.name,
          cells: [
            <Code key="step">{token.name.replace('--spacing-', '')}</Code>,
            <Code key="token">{token.name}</Code>,
            `${token.value} = ${toPx(token.value)}`,
            <span
              key="bar"
              aria-hidden="true"
              className="block h-2 rounded-sm bg-primary"
              style={{ width: `var(${token.name})` }}
            />,
          ],
        }))}
      />
      <TokenTable
        caption="Control and icon sizes"
        columns={['Size', 'Control height', 'Icon']}
        rows={[
          {
            name: 'sm',
            cells: ['sm', <Code key="h">h-8 = 32px</Code>, <Code key="i">size-4 = 16px</Code>],
          },
          {
            name: 'md',
            cells: ['md', <Code key="h">h-10 = 40px</Code>, <Code key="i">size-4 = 16px</Code>],
          },
          {
            name: 'lg',
            cells: ['lg', <Code key="h">h-12 = 48px</Code>, <Code key="i">size-5 = 20px</Code>],
          },
        ]}
      />
      <TokenTable
        caption="Radius"
        columns={['Token', 'Value', 'Sample']}
        rows={[
          ...radii.map((token) => ({
            name: token.name,
            cells: [
              <Code key="token">{token.name}</Code>,
              `${token.value} = ${toPx(token.value)}`,
              <span
                key="sample"
                aria-hidden="true"
                className="block size-10 border-2 border-primary bg-bg-sunken"
                style={{ borderRadius: `var(${token.name})` }}
              />,
            ],
          })),
          {
            name: 'full',
            cells: [
              <Code key="token">rounded-full</Code>,
              'pill / circle',
              <span
                key="sample"
                aria-hidden="true"
                className="block size-10 rounded-full border-2 border-primary bg-bg-sunken"
              />,
            ],
          },
        ]}
      />
    </Page>
  ),
};
