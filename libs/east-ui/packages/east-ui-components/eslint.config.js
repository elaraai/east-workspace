import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import headers from 'eslint-plugin-headers';
import reactHooks from 'eslint-plugin-react-hooks';

// One formatter for every component (#850): numbers and dates print through
// src/format/ — in the app's locale, dates in UTC. These
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

// The Plan renderer derives over production row counts. A spread into a
// call — `Math.max(...xs)`, `out.push(...xs)`, `new Set(...xs)` — passes
// every element as a separate ARGUMENT, and past the engine's argument
// limit (~125,000 on Node 22) it throws RangeError: a big band crashed
// the canvas (#810). Array and object literals (`[...xs]`, `{...o}`) have
// no such limit and stay allowed. The selectors are ESLint's AST syntax:
// a `...` spread directly inside a function / constructor call.
const PLAN_NO_SPREAD = [
  {
    selector: 'CallExpression > SpreadElement',
    message: 'No spread into a call under collections/plan/ — it throws RangeError past ~125,000 elements (#810). Use maxOf / minOf / appendAll from collections/plan/reductions.ts.'
  },
  {
    selector: 'NewExpression > SpreadElement',
    message: 'No spread into a constructor call under collections/plan/ — it throws RangeError past ~125,000 elements (#810). Build the arguments with a loop.'
  }
];

// The Sheet derives over production row counts too (#859): the same guard.
const SHEET_NO_SPREAD = [
  {
    selector: 'CallExpression > SpreadElement',
    message: 'No spread into a call under collections/sheet/ — it throws RangeError past ~125,000 elements (#859). Push in a loop.'
  },
  {
    selector: 'NewExpression > SpreadElement',
    message: 'No spread into a constructor call under collections/sheet/ — it throws RangeError past ~125,000 elements (#859). Build the arguments with a loop.'
  }
];

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '**/*.test.tsx', '**/*.test.ts', '**/*.test-utils.ts']
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
      'headers/header-format': ['error', {
        source: 'string',
        content: 'Copyright (c) 2025 Elara AI Pty Ltd\nDual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.'
      }]
    }
  },
  {
    // Everything but the formatter module itself formats through it (#850).
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/format/**'],
    rules: {
      'no-restricted-syntax': ['error', ...ONE_FORMATTER]
    }
  },
  {
    // A later block REPLACES a rule's options for the files it matches, so the
    // Plan's list carries the formatter guard as well as its own (#810).
    files: ['src/collections/plan/**/*.ts', 'src/collections/plan/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...ONE_FORMATTER, ...PLAN_NO_SPREAD]
    }
  },
  {
    // The Sheet's own block, carrying the formatter guard as the Plan's does (#859).
    files: ['src/collections/sheet/**/*.ts', 'src/collections/sheet/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...ONE_FORMATTER, ...SHEET_NO_SPREAD]
    }
  },
  {
    files: ['dev/**/*.ts', 'dev/**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      }
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react-hooks': reactHooks
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { 'argsIgnorePattern': '^[$_]', 'varsIgnorePattern': '^[$_]' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-console': 'off'
    }
  }
];
