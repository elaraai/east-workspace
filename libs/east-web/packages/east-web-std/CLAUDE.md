# East Web Std

The standard platform functions for East programs in a browser: `Console`,
`Time`, `Random`, `Crypto`, `Fetch`, `Path` and the test functions, under
east-node-std's names and East types, from web-standard globals only.

`WebPlatform` bundles them for `compile()` / `compileAsync()`.
`createWebPlatform({ console, test })` gives one program a platform of its
own: the host's console sink (e3-web appends it to the execution's log), its
test host, and a Random generator nobody else shares. FileSystem, Env and the
large-JSON reader have no browser meaning and are left out.

## Rules

- **Mirror east-node-std.** Every platform function has east-node-std's name,
  input and output types and sync/async kind; `test/platform.spec.ts`
  compares each one. A change to east-node-std's surface is made here too.
- **Reach no Node module from `src/`.** Web-standard globals only (`fetch`,
  `crypto.getRandomValues` / `randomUUID`, `TextEncoder`, `setTimeout`,
  `Intl`, `console`); SHA-256 is East's own `sha256Hex`, since the platform
  functions are synchronous. `test/portable.spec.ts` walks the imports from
  `src/index.ts`.
- **Random is east-node-std's, ported verbatim.** A seed gives east-node-std's
  stream bit for bit (`test/random.spec.ts`), unmasked `bigint` state
  included. Change it only together with east-node-std.
- **Path is Node's POSIX path, ported.** `test/path.spec.ts` holds it to
  `node:path/posix`; `resolve` resolves against `/`.

## Tests

`make test` from `libs/east-web` runs the specs in `test/`, then exports
east-node-std's compliance suite and runs it over east-web-std in Node
(`src/compliance.spec.ts`), as east-c-std and east-py-std run it. Its Fetch
suite needs httpbin on `:8085`.

## See also

- [`../../../east-node/packages/east-node-std/STANDARDS.md`](../../../east-node/packages/east-node-std/STANDARDS.md)
  — the TypeDoc and testing standards this package follows, as the package
  it mirrors does.
- [`../../../../docs/conventions/EAST_TS_INTEROP.md`](../../../../docs/conventions/EAST_TS_INTEROP.md)
  — TS↔East rules.
- [`README.md`](README.md) — public-facing user docs.
- [`../../CLAUDE.md`](../../CLAUDE.md) — lib-level overview.
