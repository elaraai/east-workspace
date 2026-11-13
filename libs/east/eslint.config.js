import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import headers from 'eslint-plugin-headers';
import browserFloor from './eslint/browser-floor.js';

// Doc comments are never compiled, so nothing else notices when an example
// stops matching the API. `East.compile` takes the function built by
// `East.function`; its IR is refused.
const docExamples = {
  rules: {
    'compile-takes-the-function': {
      meta: {
        type: 'problem',
        fixable: 'code',
        schema: [],
        messages: {
          toIR: 'East.compile takes the function itself: East.compile({{name}}, …), not {{name}}.toIR().',
        },
      },
      create(context) {
        const source = context.sourceCode;
        return {
          Program() {
            for (const comment of source.getAllComments()) {
              const body = comment.range[0] + 2; // past the "/*" or "//"
              for (const match of comment.value.matchAll(/East\.compile\((\w+)(\.toIR\(\))/g)) {
                const start = body + match.index;
                const toIR = start + 'East.compile('.length + match[1].length;
                context.report({
                  loc: { start: source.getLocFromIndex(start), end: source.getLocFromIndex(start + match[0].length) },
                  messageId: 'toIR',
                  data: { name: match[1] },
                  fix: fixer => fixer.removeRange([toIR, toIR + match[2].length]),
                });
              }
            }
          },
        };
      },
    },
  },
};

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
      'headers': headers,
      'doc-examples': docExamples
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      'doc-examples/compile-takes-the-function': 'error',
      // A module that exports a `then` is a thenable: a promise resolved with
      // its namespace calls that `then` and waits on it forever. vitest's
      // module runner resolves every module that way, so each suite that
      // imported East hung until CI killed it.
      'no-restricted-exports': ['error', { restrictedNamedExports: ['then'] }],
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
      }]
    }
  },
  {
    files: ['test/**/*.ts', 'example/**/*.ts'],
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
  // East runs in a browser, on iPhones back to iOS 16.4: its source names no built-in newer than ES2023
  // (docs/conventions/BROWSER_FLOOR.md). The specs run in Node alone; `make test-floor` runs them all on an engine
  // without the newer built-ins, which is what holds a value typed `any`, where no rule can see.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.spec.ts'],
    plugins: { 'east-floor': { rules: { 'browser-floor': browserFloor } } },
    rules: { 'east-floor/browser-floor': 'error' }
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