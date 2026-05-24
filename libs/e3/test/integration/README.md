# e3-integration-tests

Internal — not published.

End-to-end tests exercising the e3 CLI against a real `e3-api-server` (and,
where supported, against `e3-cloud`).

Test scenarios live under `src/`; helpers and the runner are split into:

- `generators/` — scenario generators
- `helpers.ts` — shared helpers
- `reporter.ts` — test result reporting
- `runner.ts` — test runner

## Run

```bash
# from this directory
npm run build
npm test

# or, from libs/e3:
make integration-test
```

The harness expects services to be running — start them from the workspace
root with `make services-up` if needed.

## See also

- [Parent lib README](../../README.md)
- [Parent lib CLAUDE.md](../../CLAUDE.md)
- [`@elaraai/e3-cli`](../../packages/e3-cli) — the CLI under test
- [`@elaraai/e3-api-server`](../../packages/e3-api-server) — the server under test
