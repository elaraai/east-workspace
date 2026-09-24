import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import headers from 'eslint-plugin-headers';
import reactHooks from 'eslint-plugin-react-hooks';

// One formatter for every component (#850): numbers and dates print through
// @elaraai/east-ui-components' shared formatters — in the app's locale, dates in UTC. These
// selectors are its drift guard: a direct Intl formatter, a toLocale* call, a
// local-time Date getter or setter, or a local-time Date constructor fails
// lint. (ESLint's AST selector syntax; the UTC methods — getUTCHours,
// setUTCDate — and toLocaleUpperCase stay allowed.)
const ONE_FORMATTER = [
  {
    selector: "NewExpression[callee.object.name='Intl']",
    message: 'Format numbers and dates through the shared formatters (#850) — useFormatters() in a component, a Formatters parameter elsewhere — never a direct Intl formatter.'
  },
  {
    selector: "CallExpression[callee.object.name='Intl']",
    message: 'Format numbers and dates through the shared formatters (#850) — useFormatters() in a component, a Formatters parameter elsewhere — never a direct Intl formatter.'
  },
  {
    selector: "CallExpression[callee.property.name=/^toLocale(String|DateString|TimeString)$/]",
    message: "toLocaleString / toLocaleDateString / toLocaleTimeString print in the runtime's locale and the viewer's timezone. Use the shared formatters (#850)."
  },
  {
    selector: "CallExpression[callee.property.name=/^(get|set)(FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)$/]",
    message: "A local-time Date getter or setter reads the viewer's timezone, and an East DateTime is a UTC instant. Use the UTC method (getUTCHours, setUTCDate, …) or the shared formatters (#850)."
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.length>1]",
    message: 'new Date(y, m, …) builds a LOCAL-time date, and an East DateTime is a UTC instant. Use new Date(Date.UTC(y, m, …)) (#850).'
  }
];

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '**/*.test.tsx', '**/*.test.ts']
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json',
        ecmaFeatures: {
          jsx: true
        }
      }
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'headers': headers,
      'react-hooks': reactHooks
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_', 'varsIgnorePattern': '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unnecessary-type-constraint': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // This is a BROWSER renderer package. The bare '@elaraai/e3-ui' barrel
      // re-exports ui(), which value-imports the Node-only '@elaraai/e3'
      // (node:fs via sha256/export) and so drags node:fs into browser bundles
      // (issue #99). The e3-free '@elaraai/e3-ui/internal' entry exposes the
      // same factories/types for renderers — always import from there.
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@elaraai/e3-ui',
          message: "Import from '@elaraai/e3-ui/internal' instead — the bare '@elaraai/e3-ui' barrel pulls Node-only '@elaraai/e3' (node:fs) into the browser bundle (issue #99).",
        }],
      }],
      'headers/header-format': ['error', {
        source: 'string',
        content: 'Copyright (c) 2025 Elara AI Pty Ltd\nDual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.'
      }],
      'no-restricted-syntax': ['error', ...ONE_FORMATTER]
    }
  }
];
