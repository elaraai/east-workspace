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
// @elaraai/east-ui-components' shared formatters — in the app's locale, dates in UTC. These
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

// The Plan renderer (#1177) derives over production row counts. A spread into
// a call — `Math.max(...xs)`, `out.push(...xs)`, `new Set(...xs)` — passes
// every element as a separate ARGUMENT, and past the engine's argument limit
// (~125,000 on Node 22) it throws RangeError: a big band crashed the canvas
// (#810). Array and object literals (`[...xs]`, `{...o}`) have no such limit
// and stay allowed. The selectors are ESLint's AST syntax: a `...` spread
// directly inside a function / constructor call.
const PLAN_NO_SPREAD = [
  {
    selector: 'CallExpression > SpreadElement',
    message: 'No spread into a call under src/plan/ — it throws RangeError past ~125,000 elements (#810). Use maxOf / minOf / appendAll from src/plan/reductions.ts.'
  },
  {
    selector: 'NewExpression > SpreadElement',
    message: 'No spread into a constructor call under src/plan/ — it throws RangeError past ~125,000 elements (#810). Build the arguments with a loop.'
  }
];

// The Sheet renderer (#1179) derives over production row counts too (#859):
// the same guard.
const SHEET_NO_SPREAD = [
  {
    selector: 'CallExpression > SpreadElement',
    message: 'No spread into a call under src/sheet/ — it throws RangeError past ~125,000 elements (#859). Push in a loop.'
  },
  {
    selector: 'NewExpression > SpreadElement',
    message: 'No spread into a constructor call under src/sheet/ — it throws RangeError past ~125,000 elements (#859). Build the arguments with a loop.'
  }
];

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
      // This is a BROWSER renderer package. The bare '@elaraai/e3-ui' barrel
      // re-exports ui(), which value-imports the Node-only '@elaraai/e3'
      // (node:fs via sha256/export) and so drags node:fs into browser bundles
      // (issue #99). The e3-free '@elaraai/e3-ui/internal' entry exposes the
      // same factories/types for renderers — always import from there.
      // No modals: the design system's one modal is east-ui's <Dialog>, a
      // confirmation step before a destructive or irreversible act. A form
      // that makes or names something is the edit popover (SliceEditPopover)
      // hanging from the control that starts it.
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@elaraai/e3-ui',
          message: "Import from '@elaraai/e3-ui/internal' instead — the bare '@elaraai/e3-ui' barrel pulls Node-only '@elaraai/e3' (node:fs) into the browser bundle (issue #99).",
        }, {
          name: '@chakra-ui/react',
          importNames: ['Dialog'],
          message: "No modals: a form that makes or names something is the edit popover (SliceEditPopover) hanging from its trigger. The one modal is east-ui's <Dialog>, a confirmation step before a destructive or irreversible act — never Chakra's Dialog in a renderer.",
        }],
      }],
      'headers/header-format': ['error', {
        source: 'string',
        content: 'Copyright (c) 2025 Elara AI Pty Ltd\nDual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.'
      }],
      'no-restricted-syntax': ['error', ...ONE_FORMATTER]
    }
  },
  {
    // A later block REPLACES a rule's options for the files it matches, so the
    // Plan's list carries the formatter guard as well as its own (#810).
    files: ['src/plan/**/*.ts', 'src/plan/**/*.tsx'],
    ignores: TESTS,
    rules: {
      'no-restricted-syntax': ['error', ...ONE_FORMATTER, ...PLAN_NO_SPREAD]
    }
  },
  {
    // The Sheet's own block, carrying the formatter guard as well as its own (#859).
    files: ['src/sheet/**/*.ts', 'src/sheet/**/*.tsx'],
    ignores: TESTS,
    rules: {
      'no-restricted-syntax': ['error', ...ONE_FORMATTER, ...SHEET_NO_SPREAD]
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
  }
];
