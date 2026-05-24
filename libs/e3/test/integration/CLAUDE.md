# e3 integration tests

End-to-end tests exercising the e3 CLI against a real `e3-api-server`
(and, where supported, against `e3-cloud`). Test scenarios live under
`src/`; helpers and the runner are split into `generators/`,
`helpers.ts`, `reporter.ts`, `runner.ts`.

## See also

- [`../../CLAUDE.md`](../../CLAUDE.md) — e3 lib-level overview.
- [`../../packages/e3-cli/CLAUDE.md`](../../packages/e3-cli/CLAUDE.md)
  — the CLI under test.
