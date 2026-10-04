import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import headers from 'eslint-plugin-headers';
import east, { hostValueRules } from '@elaraai/eslint-plugin-east';

// East values through East (#963), as east-ui runs them (#1177 moved the Plan
// here): the factories author East IR in module-scope helpers by design, so the
// source and tests run only the rules over host code that builds or holds
// DECODED East values — the set the renderer packages run too.
const EAST_HOST_VALUES = ['error', { only: hostValueRules }];

// The license header every source and test file opens with.
const HEADER = ['error', {
  source: 'string',
  content: 'Copyright (c) 2025 Elara AI Pty Ltd\nDual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.'
}];

// One formatter for every component (#850), as east-ui guards it: numbers and
// dates print through @elaraai/east-ui-components' shared formatters, in the
// app's locale and dates in UTC. A direct Intl formatter, a toLocale* call, a
// local-time Date getter or setter, or a local-time Date constructor fails lint.
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
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'contrib/**']
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json'
      }
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'headers': headers,
      'east': east
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      'east/east-rules': EAST_HOST_VALUES,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_', 'varsIgnorePattern': '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unnecessary-type-constraint': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'headers/header-format': HEADER,
      'no-restricted-syntax': ['error', ...ONE_FORMATTER]
    }
  },
  {
    files: ['test/**/*.ts', 'test/**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json'
      }
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'headers': headers,
      'east': east
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      'east/east-rules': EAST_HOST_VALUES,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { 'argsIgnorePattern': '^[$_]', 'varsIgnorePattern': '^[$_]' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unnecessary-type-constraint': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      'no-console': 'off',
      'headers/header-format': HEADER
    }
  }
];
