import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import headers from 'eslint-plugin-headers';

// Proprietary license header
const proprietaryHeader = 'Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.\nProprietary and confidential.';

// BSL 1.1 license header (for e3-admin-* packages)
const bslHeader = 'Copyright (c) 2025 Elara AI Pty Ltd\nLicensed under the Business Source License 1.1. See LICENSE.md for details.';

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
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/cdk.out/**',
      '**/.legacy/**',
      '**/vitest.config.ts',
      'cdk/platform/test/**',
      'cdk/platform/scripts/**',  // Standalone scripts run with npx tsx
    ]
  },
  // CDK - Platform (e3 cloud app)
  {
    files: ['cdk/platform/**/*.ts'],
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
  // BSL-licensed packages (e3-admin-*)
  {
    files: ['packages/e3-admin-*/src/**/*.ts'],
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
        content: bslHeader
      }]
    }
  },
  // Packages - source files (proprietary, excludes e3-admin-*)
  {
    files: ['packages/*/src/**/*.ts'],
    ignores: ['**/*.spec.ts', '**/*.test.ts', 'packages/e3-admin-*/src/**/*.ts'],
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
  // CDK - Accounts (AWS Organization management)
  {
    files: ['cdk/accounts/**/*.ts'],
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
  // Web (frontend) - different config for React/Vite
  {
    files: ['web/src/**/*.ts', 'web/src/**/*.tsx'],
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
      '@typescript-eslint/no-misused-promises': 'off',
      'headers/header-format': ['error', {
        source: 'string',
        content: proprietaryHeader
      }]
    }
  }
];
