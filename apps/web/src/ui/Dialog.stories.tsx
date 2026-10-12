import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { Button } from './Button';
import { Dialog, type DialogProps } from './Dialog';
import { Field } from './Field';
import { Input } from './Input';

/**
 * Modal dialog on native `<dialog>`. Controlled with `open` + `onClose`; Escape and close requests
 * call `onClose`. Stories start closed (a modal would trap the docs page); press the trigger.
 */
const meta = {
  title: 'Components/Dialog',
  component: Dialog,
  args: {
    open: false,
    onClose: fn(),
    title: 'Save area',
    description: 'Name the polygon so others can find it.',
  },
  argTypes: { open: { control: false }, footer: { control: false } },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

function SaveDialog(args: DialogProps) {
  const [open, setOpen] = useState(args.open);
  const close = () => {
    args.onClose();
    setOpen(false);
  };
  return (
    <>
      <Button onClick={() => setOpen(true)}>Save area…</Button>
      <Dialog
        {...args}
        open={open}
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button onClick={close}>Save</Button>
          </>
        }
      >
        <Field label="Area name" hint="Up to 120 characters.">
          <Input defaultValue="North orchard" />
        </Field>
      </Dialog>
    </>
  );
}

export const Save: Story = {
  render: (args) => <SaveDialog {...args} />,
  play: async ({ canvas, userEvent, args, step }) => {
    const trigger = canvas.getByRole('button', { name: 'Save area…' });
    await step('Open: focus moves into the dialog', async () => {
      await userEvent.click(trigger);
      const dialog = await canvas.findByRole('dialog', { name: 'Save area' });
      // It fades in (motion token), so wait for it rather than asserting on the first frame.
      await waitFor(() => expect(dialog).toBeVisible());
      await expect(dialog.contains(document.activeElement)).toBe(true);
    });
    await step('A close request (Escape) closes and returns focus to the trigger', async () => {
      // Browsers turn a trusted Escape press into a `cancel` event on the modal dialog; a
      // synthetic keydown cannot, so the play sends the close request itself.
      const dialog = canvas.getByRole('dialog', { name: 'Save area' });
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
      await expect(args.onClose).toHaveBeenCalledOnce();
      await waitFor(() => expect(trigger).toHaveFocus());
    });
  },
};

function ConflictDialog(args: DialogProps) {
  const [open, setOpen] = useState(args.open);
  const loadTheirs = useRef<HTMLButtonElement>(null);
  const close = () => {
    args.onClose();
    setOpen(false);
  };
  return (
    <>
      <Button onClick={() => setOpen(true)}>Save changes</Button>
      <Dialog
        {...args}
        open={open}
        onClose={close}
        role="alertdialog"
        initialFocusRef={loadTheirs}
        footer={
          <>
            <Button ref={loadTheirs} variant="secondary" onClick={close}>
              Load theirs
            </Button>
            <Button onClick={close}>Overwrite with mine</Button>
          </>
        }
      />
    </>
  );
}

/** Save conflict (409): an alertdialog that opens on the least destructive choice. */
export const Conflict: Story = {
  args: {
    title: 'Someone else changed this area',
    description:
      'Grace Hopper saved a new version while you were editing. Keep yours or load theirs.',
  },
  render: (args) => <ConflictDialog {...args} />,
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Save changes' }));
    const dialog = await canvas.findByRole('alertdialog', {
      name: 'Someone else changed this area',
    });
    await expect(dialog).toHaveAccessibleDescription(/Keep yours or load theirs/);
    await expect(canvas.getByRole('button', { name: 'Load theirs' })).toHaveFocus();
    await userEvent.click(canvas.getByRole('button', { name: 'Load theirs' }));
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};
