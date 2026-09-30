# east-web

The browser's platform integration for the East language. Every runtime
has its own standard platform package — `east-node-std`, `east-c-std`,
`east-py-std` — and this is the browser's.

## Packages

| Package | Purpose |
|---|---|
| `packages/east-web-std` | Standard platform — `Console`, `Time`, `Random`, `Crypto`, `Fetch`, `Path` and the test functions, under east-node-std's names and East types, from web-standard globals only. `WebPlatform` bundles them; `createWebPlatform` gives a host's console sink and test host. e3-web's unit workers run East programs on it. |

## Commands

```bash
make build            # build
make test             # the specs, then east-node-std's compliance suite (exported first)
make test-compliance  # the compliance suite alone, from /tmp/east-node-std
make lint             # eslint
```

The compliance suite's Fetch tests need httpbin on `:8085` — the
workspace root's `make services-up`. The specs import east-node-std, the
reference they are compared against, so build `libs/east` and east-node-std
first.

See [`../../docs/conventions/MAKEFILE_TARGETS.md`](../../docs/conventions/MAKEFILE_TARGETS.md).

## Lib-wide rules

- **One API with east-node-std.** A platform function here is east-node-std's
  — same name, types and kind — so an East program runs on Node, C, Python
  and in a browser unchanged. What has no browser meaning (FileSystem, Env,
  the large-JSON reader) is left out, and a program that calls it fails to
  compile, naming the function.
- **No Node module.** `src/` imports only its own modules and `@elaraai/east`,
  and names no Node-only global.
- Follow [`../../docs/conventions/EAST_TS_INTEROP.md`](../../docs/conventions/EAST_TS_INTEROP.md)
  for values crossing between East and TypeScript: `compareFor` / `equalFor`,
  `variant()` / `some()` / `none`, `SortedMap` for a Dict.

## See also

- [`packages/east-web-std/CLAUDE.md`](packages/east-web-std/CLAUDE.md) — the
  package's rules and tests.
- [`../east-node/CLAUDE.md`](../east-node/CLAUDE.md) — the Node platform this
  mirrors.
- [`../east/CLAUDE.md`](../east/CLAUDE.md) — core language this builds on.
