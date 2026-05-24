# e3 UI Showcase

Internal — not published.

Development and snapshot app for the e3-specific UI surface
(`@elaraai/e3-ui` types and `@elaraai/e3-ui-components` React renderers).
Mirrors the role of `east-ui-showcase` for e3-specific components.

## Setup

```bash
make install
```

## Usage

```bash
make update     # Update @elaraai packages and e3 CLI
make build      # Build TypeScript
make test       # Run full test suite (exports IR, runs Python tests)
make test-ts    # Run TypeScript tests only
make test-py    # Run Python tests only (requires IR exported first)
make repo       # Create e3 repository and workspace
make start      # Build, package, import, deploy and run
make watch      # Watch mode (auto-deploy on changes)
```

## See also

- [Parent lib README](../../README.md)
- [Parent lib CLAUDE.md](../../CLAUDE.md) — agent orientation
- [`packages/e3-ui-components/README.md`](../e3-ui-components/README.md) — the renderer components this app showcases
