import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import headers from 'eslint-plugin-headers';

// Proprietary license header
const proprietaryHeader = 'Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.\nProprietary and confidential.';

const baseRules = {
  ...tseslint.configs.recommended.rules,
  '@typescript-eslint/no-explicit-any': 'off',
  '@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_', 'varsIgnorePattern': '^_' }],
  '@typescript-eslint/explicit-function-return-type': 'off',
  '@typescript-eslint/no-unnecessary-type-constraint': 'off',
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/require-await': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
};

const testRules = {
  ...tseslint.configs.recommended.rules,
  '@typescript-eslint/no-explicit-any': 'off',
  '@typescript-eslint/no-unused-vars': ['warn', { 'argsIgnorePattern': '^_', 'varsIgnorePattern': '^_' }],
  '@typescript-eslint/explicit-function-return-type': 'off',
  '@typescript-eslint/no-unnecessary-type-constraint': 'off',
  '@typescript-eslint/no-floating-promises': 'off',
  '@typescript-eslint/require-await': 'off',
  '@typescript-eslint/no-misused-promises': 'off',
  'no-console': 'off',
};

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/cdk.out/**']
  },
  // Infrastructure (CDK)
  {
    files: ['infrastructure/**/*.ts'],
    ignores: ['**/*.spec.ts', '**/*.test.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: true
      }
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'headers': headers
    },
    rules: {
      ...baseRules,
      'headers/header-format': ['error', {
        source: 'string',
        content: proprietaryHeader
      }]
    }
  },
  // Packages - source files
  {
    files: ['packages/*/src/**/*.ts'],
    ignores: ['**/*.spec.ts', '**/*.test.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: true
      }
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'headers': headers
    },
    rules: {
      ...baseRules,
      'headers/header-format': ['error', {
        source: 'string',
        content: proprietaryHeader
      }]
    }
  },
  // Packages - test files
  {
    files: ['packages/*/src/**/*.spec.ts', 'packages/*/src/**/*.test.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: true
      }
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'headers': headers
    },
    rules: {
      ...testRules,
      'headers/header-format': ['error', {
        source: 'string',
        content: proprietaryHeader
      }]
    }
  },
  // Organization (CDK for account management)
  {
    files: ['organization/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: true
      }
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'headers': headers
    },
    rules: {
      ...baseRules,
      'headers/header-format': ['error', {
        source: 'string',
        content: proprietaryHeader
      }]
    }
  },
  // Apps (frontend) - different config for React/Vite
  {
    files: ['apps/*/src/**/*.ts', 'apps/*/src/**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: true
      }
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'headers': headers
    },
    rules: {
      ...baseRules,
      // Relax some rules for React apps
      '@typescript-eslint/no-floating-promises': 'off',
      'headers/header-format': ['error', {
        source: 'string',
        content: proprietaryHeader
      }]
    }
  }
];
