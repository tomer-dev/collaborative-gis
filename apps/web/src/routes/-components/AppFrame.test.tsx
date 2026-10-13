import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SessionMenu } from './AppFrame';

describe('SessionMenu', () => {
  it('keeps the avatar slot until the room gives a colour, so the bar never changes width', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionMenu user={{ id: 'u1', name: 'Ada Lovelace' }} color={null} />
      </QueryClientProvider>,
    );
    const slot = container.querySelector('.rounded-full');
    expect(slot?.getAttribute('aria-hidden')).toBe('true');
    expect(slot?.className).toContain('size-6');
    expect(slot?.textContent).toBe('');
  });
});
