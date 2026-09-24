import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import headers from 'eslint-plugin-headers';

// One formatter for every component (#850): the renderers print numbers and
// dates through @elaraai/east-ui-components' shared formatters, in the app's
// locale and dates in UTC, and this package's runtime code (the Slice engine's
// date windows) works on UTC days. These selectors are the drift guard: a
// direct Intl formatter, a toLocale* call, a local-time Date getter or setter,
// or a local-time Date constructor fails lint. (ESLint's AST selector syntax;
// the UTC methods — getUTCHours, setUTCDate — and toLocaleUpperCase stay
// allowed.)
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
    ignores: ['dist/**', '.package/**', 'node_modules/**', 'coverage/**']
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
      'headers': headers
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_', 'varsIgnorePattern': '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unnecessary-type-constraint': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'headers/header-format': ['error', {
        source: 'string',
        content: 'Copyright (c) 2025 Elara AI Pty Ltd\nDual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.'
      }],
      'no-restricted-syntax': ['error', ...ONE_FORMATTER]
    }
  },
  {
    files: ['test/**/*.ts', 'test/**/*.tsx', 'example/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json'
      }
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'headers': headers
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { 'argsIgnorePattern': '^[$_]', 'varsIgnorePattern': '^[$_]' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unnecessary-type-constraint': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-floating-promises': 'off', // strange interaction with node test runner
      'no-console': 'off',
      'headers/header-format': ['error', {
        source: 'string',
        content: 'Copyright (c) 2025 Elara AI Pty Ltd\nDual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.'
      }]
    }
  },
  {
    files: ['src/**/*.spec.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json'
      }
    },
    plugins: {
      '@typescript-eslint': tseslint
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { 'argsIgnorePattern': '^[$_]', 'varsIgnorePattern': '^[$_]' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unnecessary-type-constraint': 'off',
      '@typescript-eslint/no-floating-promises': 'off',  // Allow floating promises in test files
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      'no-console': 'off'
    }
  }
];