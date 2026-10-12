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

const SELECTED = 'M40 150 L110 120 L140 190 L70 220 Z';
const DRAFT = [
  [200, 40],
  [320, 30],
  [300, 130],
  [210, 120],
] as const;
const { HANDLE_HIT_PX, DRAFT_STYLE } = MAP;

/**
 * The map.css classes on plain SVG paths, as Leaflet renders them. As in
 * src/lib/geo/draw-tool.ts, the sketch takes its shape from MAP.DRAFT_STYLE and the vertex
 * handles are empty MAP.HANDLE_HIT_PX boxes whose dot comes from .cgis-draw-handle in map.css.
 */
function MapSample() {
  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox="0 0 640 260"
        role="img"
        aria-label="Sample map styles: a saved area, a selected area, your draft with vertex handles and eight other users' drafts"
        className="w-full rounded-md border border-line bg-bg-sunken"
      >
        <path className={MAP_CLASS.area} d="M30 30 L150 20 L170 90 L60 110 Z" />
        <path className={MAP_CLASS.areaSelected} d={SELECTED} />
        <path
          className={MAP_CLASS.draft}
          strokeWidth={DRAFT_STYLE.weight}
          strokeDasharray={DRAFT_STYLE.dashArray}
          fillOpacity={DRAFT_STYLE.fillOpacity}
          d={`M${DRAFT.map(([x, y]) => `${x} ${y}`).join(' L')} Z`}
        />
        {DRAFT.map(([x, y], index) => (
          <foreignObject
            key={`${x}-${y}`}
            x={x - HANDLE_HIT_PX / 2}
            y={y - HANDLE_HIT_PX / 2}
            width={HANDLE_HIT_PX}
            height={HANDLE_HIT_PX}
          >
            <div
              className={
                index === 0 ? 'cgis-draw-handle cgis-draw-handle--first' : 'cgis-draw-handle'
              }
              style={{ position: 'relative', width: '100%', height: '100%' }}
            />
          </foreignObject>
        ))}
        {MAP.PRESENCE_COLORS.map((color, index) => {
          const x = 360 + (index % 4) * 68;
          const y = 30 + Math.floor(index / 4) * 110;
          // What ghostPathOptions(color) makes Leaflet write: the colour as stroke and fill.
          return (
            <path
              key={color}
              className={MAP_CLASS.ghost}
              stroke={color}
              fill={color}
              d={`M${x} ${y} L${x + 56} ${y + 8} L${x + 48} ${y + 80} L${x + 4} ${y + 64} Z`}
            />
          );
        })}
      </svg>
      <figcaption className="text-xs text-fg-muted">
        Saved area · selected area · your draft (accent, dashed) with vertex handles in a{' '}
        {HANDLE_HIT_PX} px hit area, the first filled (&ldquo;close here&rdquo;) · ghosts in the
        server-assigned presence colours.
      </figcaption>
    </figure>
  );
}

const drawTool = [
  { name: 'HANDLE_HIT_PX', value: HANDLE_HIT_PX, use: 'Vertex hit box (marker icon size)' },
  { name: 'DRAFT_STYLE.weight', value: DRAFT_STYLE.weight, use: 'Sketch stroke width' },
  { name: 'DRAFT_STYLE.dashArray', value: DRAFT_STYLE.dashArray, use: 'Sketch dash' },
  { name: 'DRAFT_STYLE.fillOpacity', value: DRAFT_STYLE.fillOpacity, use: 'Sketch fill' },
];

const panes = [
  { name: MAP.AREAS_PANE, z: MAP.AREAS_PANE_Z, token: '--z-index-map-areas' },
  { name: MAP.DRAFTS_PANE, z: MAP.DRAFTS_PANE_Z, token: '--z-index-map-drafts' },
];

export const MapStyles: Story = {
  name: 'Map',
  render: () => (
    <Page
      title="Map"
      intro="Leaflet paths take a className from src/ui/map-styles.ts and map.css styles it from the --map-* tokens (the vertex handle dot too); the numbers Leaflet takes in JS (handle hit box, sketch width, dash and fill) come from MAP in @cgis/shared. The basemap is light imagery in both UI themes, so map styles do not switch with dark mode."
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
        caption="Draw tool (MAP in @cgis/shared; Leaflet takes these in JS)"
        columns={['Constant', 'Value', 'Use']}
        rows={drawTool.map((row) => ({
          name: row.name,
          cells: [
            <Code key="name">MAP.{row.name}</Code>,
            <Code key="value">{String(row.value)}</Code>,
            <span key="use" className="text-fg-muted">
              {row.use}
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
