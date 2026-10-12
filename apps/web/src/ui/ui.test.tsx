import { MAP, type PresenceUser } from '@cgis/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Avatar, initials } from './Avatar';
import { Banner } from './Banner';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Field } from './Field';
import { IconLayers, IconPencil, IconPlus } from './icons';
import { Input } from './Input';
import { MapControl, MapControlButton } from './MapControl';
import { areaPathOptions, draftPathOptions, ghostPathOptions } from './map-styles';
import { PresenceList } from './PresenceList';
import { formatStatValue, Stat } from './Stat';
import { syncColorScheme } from './theme';

beforeAll(() => {
  // jsdom has HTMLDialogElement but no modal API; this stand-in mirrors the parts Dialog uses.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

afterEach(cleanup);

describe('Button', () => {
  it('defaults to type="button" and is square when icon-only', () => {
    render(<Button icon={IconPlus} aria-label="Zoom in" />);
    const button = screen.getByRole('button', { name: 'Zoom in' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.className).toContain('w-10');
    expect(button.className).not.toContain('px-4');
    // lucide icons are hidden from assistive tech; the button's name comes from aria-label.
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('applies variant and size classes and stays inert when disabled', () => {
    const onClick = vi.fn();
    render(
      <Button variant="danger" size="lg" disabled onClick={onClick}>
        Delete area
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Delete area' });
    expect(button.className).toContain('bg-danger-strong');
    expect(button.className).toContain('h-12');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Field + Input', () => {
  it('labels the input and links hint and error through aria-describedby', () => {
    render(
      <Field label="Area name" hint="Up to 120 characters" error="Name is required" required>
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText(/Area name/);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.hasAttribute('required')).toBe(true);
    const described = (input.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual(['Up to 120 characters', 'Name is required']);
  });

  it('is valid and undescribed without hint or error', () => {
    render(
      <Field label="Search">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText('Search');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(input.hasAttribute('aria-describedby')).toBe(false);
  });
});

function DialogHarness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Save</Button>
      <Dialog
        open={open}
        role="alertdialog"
        initialFocusRef={keepRef}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        title="Someone else changed this area"
        description="Keep your version or load theirs."
        footer={
          <>
            <Button ref={keepRef} variant="secondary" onClick={() => setOpen(false)}>
              Load theirs
            </Button>
            <Button onClick={() => setOpen(false)}>Overwrite with mine</Button>
          </>
        }
      />
    </>
  );
}

describe('Dialog', () => {
  it('opens modally, is named by its title, focuses the initial element, closes on Escape and returns focus', () => {
    const onClose = vi.fn();
    render(<DialogHarness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Save' });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole('alertdialog', { name: 'Someone else changed this area' });
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Load theirs' }));

    // Escape fires `cancel` on a modal dialog.
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(opener);
  });
});

describe('MapControl', () => {
  it('is a labelled toolbar of icon buttons named by aria-label and title', () => {
    render(
      <MapControl label="Drawing tools">
        <MapControlButton label="Pan" icon={IconLayers} />
        <MapControlButton label="Draw polygon" icon={IconPencil} pressed />
        <MapControlButton label="Zoom in" icon={IconPlus} disabled />
      </MapControl>,
    );
    const toolbar = screen.getByRole('toolbar', { name: 'Drawing tools' });
    expect(toolbar.getAttribute('aria-orientation')).toBe('vertical');
    const draw = screen.getByRole('button', { name: 'Draw polygon' });
    expect(draw.getAttribute('title')).toBe('Draw polygon');
    expect(draw.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Pan' }).hasAttribute('aria-pressed')).toBe(false);
    expect(screen.getByRole('button', { name: 'Zoom in' }).matches(':disabled')).toBe(true);
  });
});

describe('Avatar', () => {
  it('derives initials and is an image named after the user unless decorative', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('  grace  brewster murray hopper ')).toBe('GH');
    expect(initials('Émile')).toBe('É');
    expect(initials('')).toBe('?');
    render(
      <>
        <Avatar name="Ada Lovelace" color={MAP.PRESENCE_COLORS[2]} />
        <Avatar name="Hidden" color={MAP.PRESENCE_COLORS[0]} decorative />
      </>,
    );
    // The server-assigned colour arrives as the --presence variable the tint and ring read.
    const avatar = screen.getByRole('img', { name: 'Ada Lovelace' });
    expect(avatar.style.getPropertyValue('--presence')).toBe(MAP.PRESENCE_COLORS[2]);
    expect(screen.queryByRole('img', { name: 'Hidden' })).toBeNull();
  });
});

describe('Banner', () => {
  it('announces danger assertively and other tones politely', () => {
    render(
      <>
        <Banner tone="danger" title="Offline">
          Changes stay on this device.
        </Banner>
        <Banner tone="warn" title="Reconnecting" />
      </>,
    );
    expect(screen.getByRole('alert').textContent).toContain('Offline');
    expect(screen.getByRole('status').textContent).toContain('Reconnecting');
  });
});

describe('Stat', () => {
  it('formats the value with its unit and shows an em dash without one', () => {
    const { rerender } = render(<Stat label="Area" value={12.3456} unit="km²" />);
    const output = screen.getByRole('status', { name: 'Area' });
    expect(output.textContent).toBe(`${(12.35).toLocaleString()} km²`);
    expect(output.getAttribute('aria-live')).toBe('off');
    rerender(<Stat label="Area" value={null} unit="km²" live />);
    expect(screen.getByRole('status', { name: 'Area' }).textContent).toBe('—No value');
    expect(screen.getByRole('status', { name: 'Area' }).getAttribute('aria-live')).toBe('polite');
  });
});

describe('formatStatValue', () => {
  it('keeps whole km² from 1,000, hundredths from 1 and 3 significant digits below', () => {
    expect(formatStatValue(22072.4)).toBe((22072).toLocaleString());
    expect(formatStatValue(12.3456)).toBe((12.35).toLocaleString());
    expect(formatStatValue(0.004213)).toBe(
      (0.00421).toLocaleString(undefined, { maximumSignificantDigits: 3 }),
    );
  });

  it('uses exactly `decimals` fraction digits when given', () => {
    const fixed = (value: number, digits: number) =>
      value.toLocaleString(undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
    expect(formatStatValue(104.79836, { decimals: 3 })).toBe(fixed(104.798, 3));
    expect(formatStatValue(12.5, { decimals: 3 })).toBe(fixed(12.5, 3));
    expect(formatStatValue(523.4, { decimals: 0 })).toBe(fixed(523, 0));
    expect(formatStatValue(262131.85, { decimals: 0 })).toBe(fixed(262132, 0));
  });
});

describe('PresenceList', () => {
  const users: PresenceUser[] = [
    { userId: 'a', name: 'Ada Lovelace', color: MAP.PRESENCE_COLORS[0], state: 'drawing' },
    { userId: 'b', name: 'Grace Hopper', color: MAP.PRESENCE_COLORS[1], state: 'viewing' },
    { userId: 'c', name: 'Alan Turing', color: MAP.PRESENCE_COLORS[2], state: 'viewing' },
  ];

  it('lists names with "(you)" and the drawing state', () => {
    render(<PresenceList users={users} selfId="a" />);
    const [ada, grace, alan] = screen.getAllByRole('listitem');
    expect(ada!.textContent).toMatch(/Ada Lovelace \(you\)Drawing$/);
    expect(grace!.textContent).toMatch(/Grace Hopper$/);
    expect(alan!.textContent).toMatch(/Alan Turing$/);
    // The avatar beside each name is decorative.
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it('stacks avatars with a "+N more" counter', () => {
    render(<PresenceList users={users} selfId="a" variant="stack" max={2} />);
    expect(screen.getByRole('img', { name: 'Ada Lovelace (you)' })).toBeTruthy();
    expect(screen.getByRole('img', { name: '1 more' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Alan Turing' })).toBeNull();
  });

  it('says so when nobody is here', () => {
    render(<PresenceList users={[]} emptyText="Nobody else is here yet." />);
    expect(screen.getByText('Nobody else is here yet.')).toBeTruthy();
  });
});

describe('map styles', () => {
  it('puts saved areas and drafts in the panes from MAP; ghosts take the presence colour', () => {
    expect(areaPathOptions()).toEqual({ pane: MAP.AREAS_PANE, className: 'map-area' });
    expect(areaPathOptions(true).className).toBe('map-area-selected');
    expect(draftPathOptions()).toEqual({
      pane: MAP.DRAFTS_PANE,
      className: 'cgis-draw-sketch',
      ...MAP.DRAFT_STYLE,
    });
    expect(ghostPathOptions(MAP.PRESENCE_COLORS[2])).toEqual({
      pane: MAP.DRAFTS_PANE,
      className: 'map-ghost',
      color: MAP.PRESENCE_COLORS[2],
      fillColor: MAP.PRESENCE_COLORS[2],
    });
  });
});

describe('syncColorScheme', () => {
  it('toggles the dark class with the OS preference', () => {
    let listener: (() => void) | undefined;
    const query = {
      matches: true,
      addEventListener: (_: string, fn: () => void) => (listener = fn),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', () => query);
    const root = document.createElement('div');
    const stop = syncColorScheme(root);
    expect(root.classList.contains('dark')).toBe(true);
    query.matches = false;
    act(() => listener?.());
    expect(root.classList.contains('dark')).toBe(false);
    stop();
    expect(query.removeEventListener).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
