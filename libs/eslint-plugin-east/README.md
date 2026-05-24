# ESLint Plugin East

> East idiom diagnostics for ESLint — editor and CI

[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE.md)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)

**ESLint Plugin East** surfaces the [`@elaraai/east-diagnostics`](../east-diagnostics)
rule set — the same East idiom checks the Claude plugin runs at write-time — in
the editor (via the ESLint extension) and in CI (via `eslint` / `pnpm lint`).

It is one type-aware rule, `east/east-rules`, that runs the whole set against the
file's TypeScript program. Native TypeScript type errors are intentionally **not**
reported here — those are `tsc`'s job; this plugin only surfaces the East-specific
idioms `tsc` can't see.

## Features

- **One rule, every East check** - `east/east-rules` runs the full east-diagnostics set.
- **Type-aware** - Bridges to the TS program via typescript-eslint `parserServices`.
- **Editor + CI** - Shows as squiggles through the ESLint VS Code extension and fails CI through `pnpm lint`.
- **Configurable** - Disable individual rules by name; tune rule options.

## Installation

```bash
npm install -D @elaraai/eslint-plugin-east @typescript-eslint/parser eslint
```

## Quick Start

Requires **type-aware** linting (`@typescript-eslint/parser` with a `project`).

```js
// eslint.config.js
import east from "@elaraai/eslint-plugin-east";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { projectService: true },
    },
    plugins: { east },
    rules: { "east/east-rules": "warn" },
  },
];
```

Or extend the bundled config: `export default [east.configs.recommended];`

## Options

```js
"east/east-rules": ["warn", {
  disabled: ["prefer-some-none"],            // turn off specific rules by name
  preferExplicitEastType: { mode: "all-raw-values" },
}]
```

## Claude Code plugin

The East ecosystem also ships a [Claude Code](https://claude.com/claude-code) plugin — East language skills, example search, and preemptive diagnostics for East code — installed separately from the `elaraai` marketplace:

```text
# Inside Claude Code
/plugin marketplace add elaraai/east-workspace
/plugin install east@elaraai
```

```bash
# From a terminal
claude plugin marketplace add elaraai/east-workspace
claude plugin install east@elaraai
```

## License

Dual-licensed:
- **Open Source**: [AGPL-3.0](LICENSE.md) - Free for open source use
- **Commercial**: Available for proprietary use - contact support@elara.ai

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/)*
