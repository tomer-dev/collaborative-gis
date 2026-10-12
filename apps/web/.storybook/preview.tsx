import { withThemeByClassName } from '@storybook/addon-themes';
import type { Preview } from '@storybook/react-vite';
import '../src/styles/index.css';

const preview = {
  parameters: {
    layout: 'centered',
    // Every story is checked against WCAG 2.x A/AA; a violation is an error, not a warning.
    a11y: { test: 'error' },
    controls: { matchers: { color: /(background|color)$/i } },
    options: { storySort: { order: ['Foundations', 'Components', '*'] } },
  },
  // Light/dark toolbar: tokens.css switches the semantic colours on .dark at <html>.
  decorators: [
    withThemeByClassName({ themes: { light: '', dark: 'dark' }, defaultTheme: 'light' }),
  ],
  tags: ['autodocs'],
} satisfies Preview;

export default preview;
