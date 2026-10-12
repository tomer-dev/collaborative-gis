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
          // Any string in web TSX: classes live in className, cx() calls and Record variant maps.
          selector: `Literal[value=${ARBITRARY_VALUE}]`,
          message: ARBITRARY_MESSAGE,
        },
        {
          selector: `TemplateElement[value.raw=${ARBITRARY_VALUE}]`,
          message: ARBITRARY_MESSAGE,
        },
        {
          selector: `Literal[value=${RAW_HEX}]`,
          message: 'Raw hex colour in TSX: use a colour token from apps/web/src/styles/tokens.css.',
        },
      ],
    },
  },
  {
    // D23: the api reads through the Drizzle query builder. A tagged `sql` template that starts with
    // SELECT is a hand-written read; `sql` stays for PostGIS fragments and the write CTEs in
    // apps/api/src/db/spatial.ts, which start with WITH and so pass. Tests (apps/api/test) are
    // outside `files`.
    files: ['apps/api/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "TaggedTemplateExpression[tag.name='sql'] > TemplateLiteral.quasi > TemplateElement:first-child[value.raw=/^\\s*select\\b/i]",
          message:
            'Hand-written SELECT in sql``: use the Drizzle query builder, with sql only for PostGIS fragments (D23).',
        },
      ],
    },
  },
  {
    // No type assertions in the SPA (`as const` stays allowed): parse at the boundary with the
    // shared Zod schemas, or narrow. The generated route tree is ignored above. The files listed
    // under `ignores` predate the rule and belong to other lanes (T9b ui, T10 map test).
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: [
      'apps/web/src/ui/Dialog.tsx',
      'apps/web/src/ui/Dialog.stories.tsx',
      'apps/web/src/ui/PresenceList.tsx',
      'apps/web/src/ui/ui.test.tsx',
      'apps/web/src/components/Map.test.tsx',
    ],
    rules: {
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    },
  },
);
