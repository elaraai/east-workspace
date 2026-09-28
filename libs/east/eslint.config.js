import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import headers from 'eslint-plugin-headers';

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