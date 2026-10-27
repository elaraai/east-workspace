import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import headers from 'eslint-plugin-headers';
import east, { hostValueRules } from '@elaraai/eslint-plugin-east';

// BSL 1.1 packages: e3-core, e3-cli, e3-api-client, e3-api-server, e3-web
const bslHeader = 'Copyright (c) 2025 Elara AI Pty Ltd\nLicensed under BSL 1.1. See LICENSE for details.';

// Dual AGPL-3.0 / Commercial packages: e3, e3-types
const agplHeader = 'Copyright (c) 2025 Elara AI Pty Ltd\nDual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.';

const bslPackages = ['e3-core', 'e3-cli', 'e3-api-client', 'e3-api-server', 'e3-rack', 'e3-web'];

// The files written before the rules below were enforced (2026-10-27), which
// still break them: warned, not failed, until each is cleaned and leaves its
// list. Nothing is ever added.
const LEGACY_EAST_VALUES = [
  'packages/e3-api-server/src/handlers/functions.spec.ts',
];
const LEGACY_ANY = [
  'packages/e3-api-client/src/platform.ts',
  'packages/e3-api-server/src/handlers/functions.spec.ts',
  'packages/e3-api-server/src/handlers/records.spec.ts',
  'packages/e3-api-server/src/handlers/workspaces.ts',
  'packages/e3-api-tests/src/suites/package-transfer.ts',
  'packages/e3-cli/src/commands/convert.impl.ts',
  'packages/e3-cli/src/commands/workspace.ts',
  'packages/e3-core/src/contract/gc.ts',
  'packages/e3-core/src/formats.ts',
  'packages/e3-core/src/gc-graph.ts',
  'packages/e3-core/src/packages.spec.ts',
  'packages/e3-core/src/storage/local/LocalDatasetRefStore.ts',
  'packages/e3-core/src/trees.spec.ts',
  'packages/e3-core/src/workspaces.spec.ts',
  'packages/e3-web/src/testing/runner-cases.ts',
];
const agplPackages = ['e3', 'e3-types'];

const baseRules = {
  ...tseslint.configs.recommended.rules,
  '@typescript-eslint/no-explicit-any': 'off',
  '@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_', 'varsIgnorePattern': '^_' }],
  '@typescript-eslint/explicit-function-return-type': 'off',
  '@typescript-eslint/no-unnecessary-type-constraint': 'off',
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/require-await': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
  // A promise returned unawaited from inside `try` escapes its `catch`, and
  // inside `try`/`finally` it has no handler until the `finally` completes: a
  // rejection there is unhandled, and Node ends the process.
  '@typescript-eslint/return-await': ['error', 'error-handling-correctness-only'],
};

const testRules = {
  ...tseslint.configs.recommended.rules,
  '@typescript-eslint/no-explicit-any': 'off',
  '@typescript-eslint/no-unused-vars': ['warn', { 'argsIgnorePattern': '^[$_]', 'varsIgnorePattern': '^[$_]' }],
  '@typescript-eslint/explicit-function-return-type': 'off',
  '@typescript-eslint/no-unnecessary-type-constraint': 'off',
  '@typescript-eslint/no-floating-promises': 'off',
  '@typescript-eslint/require-await': 'off',
  '@typescript-eslint/no-misused-promises': 'off',
  'no-console': 'off',
};

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**']
  },
  // BSL 1.1 packages - source files
  ...bslPackages.map(pkg => ({
    files: [`packages/${pkg}/src/**/*.ts`],
    ignores: ['**/*.spec.ts'],
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
  })),
  // BSL 1.1 packages - test files
  ...bslPackages.map(pkg => ({
    files: [`packages/${pkg}/src/**/*.spec.ts`],
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
        content: bslHeader
      }]
    }
  })),
  // AGPL packages - source files
  ...agplPackages.map(pkg => ({
    files: [`packages/${pkg}/src/**/*.ts`],
    ignores: ['**/*.spec.ts'],
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
        content: agplHeader
      }]
    }
  })),
  // AGPL packages - test files
  ...agplPackages.map(pkg => ({
    files: [`packages/${pkg}/src/**/*.spec.ts`],
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
        content: agplHeader
      }]
    }
  })),
  // Integration tests (BSL 1.1)
  {
    files: ['test/integration/src/**/*.ts'],
    ignores: ['**/*.spec.ts'],
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
  {
    files: ['test/integration/src/**/*.spec.ts'],
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
        content: bslHeader
      }]
    }
  },
  // e3-core's contract suites: test code every storage backend runs, shipped
  // in the package's test entry (BSL 1.1)
  {
    files: ['packages/e3-core/src/contract/**/*.ts'],
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
        content: bslHeader
      }]
    }
  },
  // e3-web's test code beside its specs: the adapters' contract and the
  // assertions it runs with in Node and in a page, and the Chromium harness
  // with its test pages (BSL 1.1)
  {
    files: ['packages/e3-web/src/testing/**/*.ts', 'packages/e3-web/src/browser/**/*.ts'],
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
        content: bslHeader
      }]
    }
  },
  // e3-api-tests: entire package is test helpers/suites (BSL 1.1)
  {
    files: ['packages/e3-api-tests/src/**/*.ts'],
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
        content: bslHeader
      }]
    }
  },
  // Fuzz tests (BSL 1.1)
  {
    files: ['test/fuzz/**/*.ts'],
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
        content: bslHeader
      }]
    }
  },
  // East values through East, and no `any`, in every package's sources and
  // specs (2026-10-27): East's own rules over host code that builds or reads
  // East values — no variant built or cast by hand, none printed, parsed or
  // compared as plain JS — as east-ui runs them.
  {
    files: ['packages/*/src/**/*.ts', 'test/*/src/**/*.ts'],
    plugins: { east },
    rules: {
      'east/east-rules': ['error', { only: hostValueRules }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  // The record code that generates East programs: every East rule. Logic is a
  // typed East.function a program calls, never statements a TypeScript helper
  // writes into another function's body; a loop over a declaration's fields,
  // which a row names only at run time, is exempted where it is, with why.
  {
    files: ['packages/e3/src/record-*.ts'],
    ignores: ['**/*.spec.ts'],
    plugins: { east },
    rules: {
      // Options given whole: a severity alone would keep the host-value `only` above.
      'east/east-rules': ['error', {}],
    },
  },
  // Files not held to the above yet: each leaves its list as it is cleaned,
  // and the lists only shrink — a new file is held to the rules from the start.
  ...(LEGACY_EAST_VALUES.length === 0 ? [] : [{
    files: LEGACY_EAST_VALUES,
    plugins: { east },
    rules: { 'east/east-rules': ['warn', { only: hostValueRules }] },
  }]),
  ...(LEGACY_ANY.length === 0 ? [] : [{
    files: LEGACY_ANY,
    rules: { '@typescript-eslint/no-explicit-any': 'warn' },
  }]),
];
