import type { Meta, StoryObj } from '@storybook/react-vite';
import { Code, Page, TokenTable } from './TokenTable';
import { darkTokens, tokens, type Token } from './tokens';

/** Colour ramps, semantic tokens, status, accent and presence hues, read from src/styles/tokens.css. */
const meta = {
  title: 'Foundations/Colour',
  parameters: { layout: 'fullscreen' },
  tags: ['!autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Swatch({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  return (
    <span
      aria-hidden="true"
      className={
        size === 'lg'
          ? 'block h-12 w-full rounded-md border border-line'
          : 'block size-8 shrink-0 rounded-sm border border-line'
      }
      style={{ background: `var(${name})` }}
    />
  );
}

function Ramp({ title, ramp }: { title: string; ramp: Token[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-medium">{title}</h2>
      <ul className="grid grid-cols-6 gap-2 sm:grid-cols-11">
        {ramp.map((token) => (
          <li key={token.name} className="flex flex-col gap-1">
            <Swatch name={token.name} size="lg" />
            <span className="text-xs font-medium">{token.name.split('-').pop()}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Light value, dark value (if it switches) and note for a semantic token. */
function semanticRows(list: Token[]) {
  return list.map((token) => ({
    name: token.name,
    cells: [
      <span key="swatch" className="flex items-center gap-2">
        <Swatch name={token.name} />
        <Code>{token.name}</Code>
      </span>,
      <Code key="light">{token.value}</Code>,
      <Code key="dark">{darkTokens.get(token.name) ?? 'same'}</Code>,
      <span key="note" className="text-fg-muted">
        {token.note ?? ''}
      </span>,
    ],
  }));
}

const SEMANTIC_COLUMNS = ['Token (current theme)', 'Light', 'Dark', 'Use'];

export const Colour: Story = {
  render: () => (
    <Page
      title="Colour"
      intro="OKLCH ramps; components use only the semantic tokens, which pick a ramp step per theme (toggle light/dark in the toolbar). Interactive colours have base, hover (+1 step), active (+2) and disabled (base at 40 %)."
    >
      <Ramp title="Neutral ramp" ramp={tokens(/^--color-neutral-\d+$/)} />
      <Ramp title="Primary ramp (blue, D17)" ramp={tokens(/^--color-primary-\d+$/)} />
      <TokenTable
        caption="Surfaces, text and lines"
        columns={SEMANTIC_COLUMNS}
        rows={semanticRows(tokens(/^--color-(bg|fg|line)(-|$)/))}
      />
      <TokenTable
        caption="Primary and accent"
        columns={SEMANTIC_COLUMNS}
        rows={semanticRows(tokens(/^--color-(primary(-hover|-active|-fg)?|accent|scrim|shadow)$/))}
      />
      <TokenTable
        caption="Status (always with an icon and a label)"
        columns={SEMANTIC_COLUMNS}
        rows={semanticRows(tokens(/^--color-(ok|warn|danger|info)(-|$)/))}
      />
      <TokenTable
        caption="Presence (by join order; mirrors MAP.PRESENCE_COLORS)"
        columns={SEMANTIC_COLUMNS}
        rows={semanticRows(tokens(/^--color-presence-/))}
      />
    </Page>
  ),
};
