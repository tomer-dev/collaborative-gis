import type { StorybookConfig } from '@storybook/react-vite';

// Story titles: "Foundations/<Topic>" for token pages (src/stories), "Components/<Name>" for
// src/ui. Titles are permalinks; rename a story with `name`, not by retitling.
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [
    '@storybook/addon-docs',
    '@storybook/addon-a11y',
    '@storybook/addon-themes',
    '@storybook/addon-vitest',
  ],
  // The react-vite builder reads the app's vite.config.ts (React and Tailwind; the router plugin
  // only touches src/routes and the proxy only the dev server).
  framework: '@storybook/react-vite',
  core: { disableTelemetry: true },
};

export default config;
