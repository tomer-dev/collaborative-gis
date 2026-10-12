import { MAP } from '@cgis/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { MAP_CLASS } from '../ui/map-styles';
import { Code, Page, TokenTable } from './TokenTable';
import { tokens } from './tokens';

/** Map styles, stacking and motion, read from src/styles/tokens.css and MAP in @cgis/shared. */
const meta = {
  title: 'Foundations/Map',
  parameters: { layout: 'fullscreen' },
  tags: ['!autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const SELECTED = [
  [40, 150],
  [110, 120],
  [140, 190],
  [70, 220],
] as const;

/** The map.css classes on plain SVG paths, as Leaflet would render them. */
function MapSample() {
  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox="0 0 640 260"
        role="img"
        aria-label="Sample map styles: a saved area, a selected area with vertex handles, your draft and eight other users' drafts"
        className="w-full rounded-md border border-line bg-bg-sunken"
      >
        <path className={MAP_CLASS.area} d="M30 30 L150 20 L170 90 L60 110 Z" />
        <path
          className={MAP_CLASS.areaSelected}
          d={`M${SELECTED.map(([x, y]) => `${x} ${y}`).join(' L')} Z`}
        />
        {SELECTED.map(([x, y]) => (
          <foreignObject key={`${x}-${y}`} x={x - 12} y={y - 12} width="24" height="24">
            <div className={MAP_CLASS.handle} style={{ margin: 0 }} />
          </foreignObject>
        ))}
        <path className={MAP_CLASS.draft} d="M200 40 L320 30 L300 130 L210 120 Z" />
        {MAP.PRESENCE_COLORS.map((_, index) => {
          const x = 360 + (index % 4) * 68;
          const y = 30 + Math.floor(index / 4) * 110;
          return (
            <path
              key={index}
              className={`${MAP_CLASS.ghost} ${MAP_CLASS.ghost}-${index + 1}`}
              d={`M${x} ${y} L${x + 56} ${y + 8} L${x + 48} ${y + 80} L${x + 4} ${y + 64} Z`}
            />
          );
        })}
      </svg>
      <figcaption className="text-xs text-fg-muted">
        Saved area · selected area with 12 px handles (24 px hit area) · your draft (accent, dashed)
        · ghosts in presence hues 1–8.
      </figcaption>
    </figure>
  );
}

const panes = [
  { name: MAP.AREAS_PANE, z: MAP.AREAS_PANE_Z, token: '--z-index-map-areas' },
  { name: MAP.DRAFTS_PANE, z: MAP.DRAFTS_PANE_Z, token: '--z-index-map-drafts' },
];

export const MapStyles: Story = {
  name: 'Map',
  render: () => (
    <Page
      title="Map"
      intro="Leaflet paths take a className from src/ui/map-styles.ts; map.css styles it from the --map-* tokens. The basemap is light imagery in both UI themes, so map styles do not switch with dark mode."
    >
      <MapSample />
      <TokenTable
        caption="Map tokens"
        columns={['Token', 'Value', 'Note']}
        rows={tokens(/^--map-/).map((token) => ({
          name: token.name,
          cells: [
            <Code key="token">{token.name}</Code>,
            <Code key="value">{token.value}</Code>,
            <span key="note" className="text-fg-muted">
              {token.note ?? ''}
            </span>,
          ],
        }))}
      />
      <TokenTable
        caption="Panes (MAP in @cgis/shared; tokens.css mirrors the z-index)"
        columns={['Pane', 'z-index', 'Token']}
        rows={panes.map((pane) => ({
          name: pane.name,
          cells: [
            <Code key="pane">{pane.name}</Code>,
            pane.z,
            <Code key="token">{pane.token}</Code>,
          ],
        }))}
      />
      <TokenTable
        caption="Stacking"
        columns={['Token', 'Value', 'Utility']}
        rows={tokens(/^--z-index-/).map((token) => ({
          name: token.name,
          cells: [
            <Code key="token">{token.name}</Code>,
            token.value,
            <Code key="utility">{token.name.replace('--z-index-', 'z-')}</Code>,
          ],
        }))}
      />
      <TokenTable
        caption="Motion (0 ms under prefers-reduced-motion)"
        columns={['Token', 'Value', 'Utility']}
        rows={tokens(/^--(transition-duration|ease)-/).map((token) => ({
          name: token.name,
          cells: [
            <Code key="token">{token.name}</Code>,
            <Code key="value">{token.value}</Code>,
            <Code key="utility">
              {token.name
                .replace('--transition-duration-', 'duration-')
                .replace('--ease-', 'ease-')}
            </Code>,
          ],
        }))}
      />
    </Page>
  ),
};
