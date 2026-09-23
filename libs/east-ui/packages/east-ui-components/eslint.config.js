import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import headers from 'eslint-plugin-headers';
import reactHooks from 'eslint-plugin-react-hooks';

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
      'headers/header-format': ['error', {
        source: 'string',
        content: 'Copyright (c) 2025 Elara AI Pty Ltd\nDual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.'
      }]
    }
  },
  {
    // The Plan renderer derives over production row counts. A spread into a
    // call — `Math.max(...xs)`, `out.push(...xs)`, `new Set(...xs)` — passes
    // every element as a separate ARGUMENT, and past the engine's argument
    // limit (~125,000 on Node 22) it throws RangeError: a big band crashed
    // the canvas (#810). Array and object literals (`[...xs]`, `{...o}`) have
    // no such limit and stay allowed. The selectors are ESLint's AST syntax:
    // a `...` spread directly inside a function / constructor call.
    files: ['src/collections/plan/**/*.ts', 'src/collections/plan/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error',
        {
          selector: 'CallExpression > SpreadElement',
          message: 'No spread into a call under collections/plan/ — it throws RangeError past ~125,000 elements (#810). Use maxOf / minOf / appendAll from collections/plan/reductions.ts.'
        },
        {
          selector: 'NewExpression > SpreadElement',
          message: 'No spread into a constructor call under collections/plan/ — it throws RangeError past ~125,000 elements (#810). Build the arguments with a loop.'
        }
      ]
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
