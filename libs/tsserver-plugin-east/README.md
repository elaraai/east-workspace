# tsserver-plugin-east

> East diagnostics as a TypeScript language service plugin

[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE.md)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)

**tsserver-plugin-east** rides inside the editor's existing TypeScript language
service and surfaces [`@elaraai/east-diagnostics`](../east-diagnostics) as
native squiggles — no second type-checker, no ESLint setup required.

## Features

- **East idiom diagnostics** - the full east-diagnostics rule set (prefer `some()`/`none`, no hand-rolled variants, redundant casts, unexecuted East expressions, prefer JSX tags, …) reported alongside TypeScript's own diagnostics.
- **Readable East type errors** - native assignability errors on East types are rewritten via east's structural type diff, so a mismatch deep inside a recursive type reads as one localized line instead of pages of restated generics.
- **In-process** - decorates the language service the editor already runs; no extra server or program build.
- **Self-contained** - a single CommonJS bundle; only `typescript` is expected from the host.

## Usage

Add the plugin to `compilerOptions` in `tsconfig.json` and install it as a dev
dependency:

```jsonc
{
  "compilerOptions": {
    "plugins": [{ "name": "@elaraai/tsserver-plugin-east" }]
  }
}
```

```bash
npm install --save-dev @elaraai/tsserver-plugin-east
```

In VS Code, tsconfig-configured plugins load when the **workspace TypeScript
version** is selected ("TypeScript: Select TypeScript Version…"). The
[East UI Preview extension](../east-ui/packages/east-ui-extension) contributes
the same plugin globally, which also covers VS Code's built-in TypeScript.

Projects scaffolded with `npm create @elaraai/e3` / `npm create @elaraai/east`
ship with the plugin preconfigured, alongside
[`@elaraai/eslint-plugin-east`](../eslint-plugin-east) for the same rules in CI.

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
