import js from '@eslint/js';
import storybook from 'eslint-plugin-storybook';
import tseslint from 'typescript-eslint';

// Grid 4 (D15): sizes and colours come from apps/web/src/styles/tokens.css. A Tailwind arbitrary
// value carrying a length or a colour (w-[23px], p-[0.3rem], bg-[#fff]) bypasses the tokens.
const ARBITRARY_VALUE = String.raw`/\[[^\]]*(px|rem|#)[^\]]*\]/`;
const ARBITRARY_MESSAGE =
  'Arbitrary Tailwind value: use a token utility from apps/web/src/styles/tokens.css (Grid 4, D15).';
const RAW_HEX = String.raw`/#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/`;

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.wrangler/**',
      '**/node_modules/**',
      '**/worker-configuration.d.ts',
      '**/routeTree.gen.ts',
      '**/coverage/**',
      '**/storybook-static/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...storybook.configs['flat/recommended'],
  {
    files: ['apps/web/src/**/*.tsx', 'apps/web/.storybook/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `JSXAttribute[name.name='className'] Literal[value=${ARBITRARY_VALUE}]`,
          message: ARBITRARY_MESSAGE,
        },
        {
          selector: `JSXAttribute[name.name='className'] TemplateElement[value.raw=${ARBITRARY_VALUE}]`,
          message: ARBITRARY_MESSAGE,
        },
        {
          selector: `CallExpression[callee.name=/^(cva|cx)$/] Literal[value=${ARBITRARY_VALUE}]`,
          message: ARBITRARY_MESSAGE,
        },
        {
          selector: `Literal[value=${RAW_HEX}]`,
          message: 'Raw hex colour in TSX: use a colour token from apps/web/src/styles/tokens.css.',
        },
      ],
    },
  },
);
