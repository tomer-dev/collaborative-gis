import type { StorybookConfig } from '@storybook/react-vite';

// Story titles: "Foundations/<Topic>" for token pages (src/stories), "Components/<Name>" for
// src/ui. Titles are permalinks; rename a story with `name`, not by retitling.
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y', '@storybook/addon-themes'],
  framework: {
    name: '@storybook/react-vite',
    // Storybook-only Vite config: React + Tailwind, without the app's router codegen and dev proxy.
    options: { builder: { viteConfigPath: '.storybook/vite.config.ts' } },
  },
  core: { disableTelemetry: true },
};

export default config;
