import { COPY } from '@cgis/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConnectionBanner } from './ConnectionBanner';

afterEach(cleanup);

it('shows nothing while connecting or open', () => {
  const view = render(<ConnectionBanner state="connecting" onRetry={vi.fn()} />);
  expect(view.container.innerHTML).toBe('');
  view.rerender(<ConnectionBanner state="open" onRetry={vi.fn()} />);
  expect(view.container.innerHTML).toBe('');
});

it('degraded: a polite reconnecting status without a retry button', () => {
  render(<ConnectionBanner state="degraded" onRetry={vi.fn()} />);
  const status = screen.getByRole('status');
  expect(status.textContent).toContain(COPY.CONNECTION.DEGRADED_TITLE);
  expect(status.textContent).toContain(COPY.CONNECTION.DEGRADED_DETAIL);
  expect(screen.queryByRole('button')).toBeNull();
});

it('offline: an alert with the polling note and a Retry that reconnects', () => {
  const onRetry = vi.fn();
  render(<ConnectionBanner state="offline" onRetry={onRetry} />);
  const alert = screen.getByRole('alert');
  expect(alert.textContent).toContain(COPY.CONNECTION.OFFLINE_TITLE);
  expect(alert.textContent).toContain(COPY.CONNECTION.OFFLINE_DETAIL);

  fireEvent.click(screen.getByRole('button', { name: COPY.CONNECTION.RETRY }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});
