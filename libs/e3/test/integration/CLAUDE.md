# e3 integration tests

End-to-end tests exercising the e3 CLI against a real `e3-api-server`
(and, where supported, against `e3-cloud`). Test scenarios live under
`src/`; process-spawning utilities live in `src/helpers.ts`. The
`api-compliance.spec.ts` entry point runs every shared suite from
`@elaraai/e3-api-tests` against a local server — new API surface belongs
in those shared suites (so the cloud runs them too), and only
CLI-/local-filesystem-specific behaviour belongs in the other specs
here.

## See also

- [`../../CLAUDE.md`](../../CLAUDE.md) — e3 lib-level overview.
- [`../../packages/e3-cli/CLAUDE.md`](../../packages/e3-cli/CLAUDE.md)
  — the CLI under test.
