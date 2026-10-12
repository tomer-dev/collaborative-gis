import type { Meta, StoryObj } from '@storybook/react-vite';
import { Code, Page, TokenTable } from './TokenTable';
import { tokens, toPx } from './tokens';

/** Type scale, weights and families, read from src/styles/tokens.css. */
const meta = {
  title: 'Foundations/Typography',
  parameters: { layout: 'fullscreen' },
  tags: ['!autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const USES: Record<string, string> = {
  xs: 'Captions, coordinate readouts',
  sm: 'Body in panels, table cells, buttons',
  md: 'Default body, inputs',
  lg: 'Section titles',
  xl: 'Page titles',
  '2xl': 'Hero number (area readout)',
};

const sizes = tokens(/^--text-[\w]+$/).map((token) => {
  const size = token.name.replace('--text-', '');
  const lineHeight = tokens(new RegExp(`^--text-${size}--line-height$`))[0]?.value ?? '';
  return { size, token, lineHeight };
});
const weights = tokens(/^--font-weight-/);
const families = tokens(/^--font-(sans|mono)$/);

export const Typography: Story = {
  render: () => (
    <Page
      title="Typography"
      intro="One family (Inter, self-hosted) for UI, ui-monospace for coordinates and ids. Six sizes; every line-height is a multiple of 4 px. Weights 400, 500 and 600 only; no letter-spacing."
    >
      <TokenTable
        caption="Type scale"
        columns={['Utility', 'Size / line-height', 'Use', 'Sample']}
        rows={sizes.map(({ size, token, lineHeight }) => ({
          name: token.name,
          cells: [
            <Code key="utility">text-{size}</Code>,
            `${toPx(token.value)} / ${toPx(lineHeight)}`,
            <span key="use" className="text-fg-muted">
              {USES[size] ?? ''}
            </span>,
            <span
              key="sample"
              style={{
                fontSize: `var(${token.name})`,
                lineHeight: `var(${token.name}--line-height)`,
              }}
            >
              Area 12.35&nbsp;km²
            </span>,
          ],
        }))}
      />
      <TokenTable
        caption="Weights"
        columns={['Utility', 'Value', 'Sample']}
        rows={weights.map((token) => ({
          name: token.name,
          cells: [
            <Code key="utility">{token.name.replace('--font-weight-', 'font-')}</Code>,
            token.value,
            <span key="sample" className="text-md" style={{ fontWeight: `var(${token.name})` }}>
              Save area
            </span>,
          ],
        }))}
      />
      <TokenTable
        caption="Families"
        columns={['Utility', 'Stack', 'Sample']}
        rows={families.map((token) => ({
          name: token.name,
          cells: [
            <Code key="utility">{token.name.replace('--font-', 'font-')}</Code>,
            <span key="stack" className="text-xs text-fg-muted">
              {token.value}
            </span>,
            <span key="sample" className="text-md" style={{ fontFamily: `var(${token.name})` }}>
              31.7683, 35.2137
            </span>,
          ],
        }))}
      />
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Tabular numbers</h2>
        <p className="text-sm text-fg-muted">
          The live area readout uses <Code>tabular-nums</Code> so digits keep their width while
          drawing.
        </p>
        <div className="flex gap-8 text-2xl font-semibold">
          <span className="tabular-nums">111.1 km²</span>
          <span className="tabular-nums">188.8 km²</span>
        </div>
      </section>
    </Page>
  ),
};
