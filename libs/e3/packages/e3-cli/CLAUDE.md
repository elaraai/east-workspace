# e3-cli

Command-line tool for managing e3 repositories: `e3 repo|package|workspace|list|get|set|run|start|watch|logs|convert|login`.

## Internal entry (`@elaraai/e3-cli/internal`)

`src/internal.ts` re-exports the surface another first-party binary must
share exactly rather than re-implement — repo-location parsing
(`parseRepoLocation`, `defaultRepoArg`), the credential store + device flow
(`getValidToken`, `createAuthCommand`, …), the dataset path resolver, the
progress reporter, and the formatters (`formatError`, `formatSize`,
`formatTaskStatus`). `@elaraai/e3-ui-cli` mounts it so `e3-ui auth` and
`e3 auth` are one code path and one `~/.e3/credentials.json`. It is **not**
semver-stable API: keep it to what a workspace binary needs, and never let
`e3`'s own behaviour depend on it (the CLI imports its modules directly).

## See also

- [`../../CLAUDE.md`](../../CLAUDE.md) — e3 lib-level overview with the
  concept glossary (repo, package, workspace, dataflow, …).
- [`../../USAGE.md`](../../USAGE.md) — end-user guide.
- [`../../design/e3-cli.md`](../../design/e3-cli.md) — CLI design spec.
- [`../../design/e3-watch.md`](../../design/e3-watch.md) — `e3 watch`
  workflow.
- [`../../VIEWER.md`](../../VIEWER.md) — `e3 view` TUI design.
- [`../../SKILL.md`](../../SKILL.md) — authoring cheat-sheet. **Matches
  the `east:e3` plugin skill — DO NOT EDIT casually.**
