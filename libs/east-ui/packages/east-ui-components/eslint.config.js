import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import headers from 'eslint-plugin-headers';
import reactHooks from 'eslint-plugin-react-hooks';
import east, { hostValueRules } from '@elaraai/eslint-plugin-east';

// East values through East (#963): source and tests run the rules over host code
// that builds or holds East values. The IR-authoring rules are for East programs,
// and where this package builds one (a handle builder, a test's helper) it is the
// library those rules are written for, as east-ui's factories are. The tests
// type-check under their own project, and the renderer's own rules below skip
// them, as they always have.
const EAST_HOST_VALUES = ['error', { only: hostValueRules }];
const TESTS = ['**/*.test.ts', '**/*.test.tsx', '**/*.test-utils.ts', '**/*.test-utils.tsx'];

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

// The paged canvases' shared parts — the window ledger and the residency
// policy, the Plan's and the Sheet's (both e3-ui-components' now, #1177,
// #1179) — derive over production row counts. A spread into a call — `Math.max(...xs)`,
// `out.push(...xs)`, `new Set(...xs)` — passes every element as a separate
// ARGUMENT, and past the engine's argument limit (~125,000 on Node 22) it
// throws RangeError: a big band crashed the Plan's canvas (#810). Array and
// object literals (`[...xs]`, `{...o}`) have no such limit and stay allowed.
// The selectors are ESLint's AST syntax: a `...` spread directly inside a
// function / constructor call.
const PAGING_NO_SPREAD = [
  {
    selector: 'CallExpression > SpreadElement',
    message: 'No spread into a call in a paged canvas\'s shared parts — it throws RangeError past ~125,000 elements (#810). Loop instead.'
  },
  {
    selector: 'NewExpression > SpreadElement',
    message: 'No spread into a constructor call in a paged canvas\'s shared parts — it throws RangeError past ~125,000 elements (#810). Build the arguments with a loop.'
  }
];

// No modals. The design system's one modal is <Dialog>, a confirmation step
// before a destructive or irreversible act: east-ui's Dialog renderer draws
// it, and the command palette is an overlay of its own. A form that makes or
// names something — a new page, a template, a cohort — is the edit popover
// (SliceEditPopover) hanging from the control that starts it.
const NO_MODALS = {
  paths: [{
    name: '@chakra-ui/react',
    importNames: ['Dialog'],
    message: "No modals: a form that makes or names something is the edit popover (SliceEditPopover) hanging from its trigger. The one modal is east-ui's <Dialog>, a confirmation step before a destructive or irreversible act — render it through that component, never Chakra's Dialog directly."
  }]
};

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**']
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: TESTS,
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
      'react-hooks': reactHooks,
      'east': east
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
      'east/east-rules': EAST_HOST_VALUES,
      'no-restricted-imports': ['error', NO_MODALS],
      'headers/header-format': ['error', {
        source: 'string',
        content: 'Copyright (c) 2025 Elara AI Pty Ltd\nDual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.'
      }]
    }
  },
  {
    // The two overlays that ARE Chakra's Dialog: east-ui's <Dialog>, and the command palette.
    files: ['src/overlays/dialog/index.tsx', 'src/overlays/command-palette/index.tsx'],
    rules: {
      'no-restricted-imports': 'off'
    }
  },
  {
    // Everything but the formatter module itself formats through it (#850).
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/format/**', ...TESTS],
    rules: {
      'no-restricted-syntax': ['error', ...ONE_FORMATTER]
    }
  },
  {
    // A later block REPLACES a rule's options for the files it matches, so the
    // paged canvases' shared parts carry the formatter guard as well as their own (#810).
    files: ['src/collections/window-ledger.ts', 'src/collections/window-residency.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...ONE_FORMATTER, ...PAGING_NO_SPREAD]
    }
  },
  {
    // The tests hold decoded East values: the host-value rules (#963).
    files: [...TESTS.map((glob) => `src/${glob}`), 'test/**/*.ts', 'test/**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.typecheck.json',
        ecmaFeatures: {
          jsx: true
        }
      }
    },
    plugins: {
      'east': east
    },
    rules: {
      'east/east-rules': EAST_HOST_VALUES
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
