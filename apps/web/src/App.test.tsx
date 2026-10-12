import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import App from './App';

it('renders the app title and the vertex cap from shared contracts', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /collaborative gis/i })).toBeTruthy();
  expect(screen.getByText(/1000 vertices/)).toBeTruthy();
});
