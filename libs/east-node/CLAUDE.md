# east-node

Node.js platform integration for the East language. Provides three
packages, layered: a CLI runner, the standard platform library, and the
I/O platform library.

## Packages

| Package | Purpose |
|---|---|
| `packages/east-node-std` | Standard platform — `Console`, `FileSystem`, `Fetch`, `Crypto`, `Time`, `Path`, `Random`; test framework (`describeEast`, `Assert`). Backs the `east:east-node-std` plugin skill. |
| `packages/east-node-io` | I/O platform — SQL/NoSQL databases, S3 storage, FTP/SFTP, file formats (XLSX, XML, CSV), compression. Backs the `east:east-node-io` plugin skill. |
| `packages/east-node-cli` | Command-line runner for `.beast2` / `.beast` / `.east` / `.json` IR files with dynamic platform loading. |

## Commands

```bash
make build       # build all three packages (topological order)
make test        # run all TS tests
make lint        # eslint
```

Integration tests under `east-node-io` need Docker services up — see
the workspace root's `make services-up`.

See [`../../docs/conventions/MAKEFILE_TARGETS.md`](../../docs/conventions/MAKEFILE_TARGETS.md).

## Lib-wide rules

Both std and io packages do extensive interop between East values and JS
runtime values. Follow the rules in
[`../../docs/conventions/EAST_TS_INTEROP.md`](../../docs/conventions/EAST_TS_INTEROP.md):

- `isValueOf(value, Type)` for runtime type checks — never `typeof` or
  `instanceof`.
- `compareFor(KeyType)` for sort comparators, `equalFor` for equality,
  `lessFor` for less-than.
- `variant()` / `some()` / `none` — never hand-roll `{ tag, data }`.

## Plugin skills (DO NOT EDIT casually)

- `packages/east-node-std/SKILL.md` → `east:east-node-std`
- `packages/east-node-io/SKILL.md` → `east:east-node-io`

## See also

- Per-package `STANDARDS.md` files — mandatory TypeDoc + testing
  standards.
- [`../../docs/conventions/EXAMPLES_AUTHORING.md`](../../docs/conventions/EXAMPLES_AUTHORING.md)
  — the `*.spec.ts` ↔ `*.examples.ts` pattern used in `test/`.
- [`../east/CLAUDE.md`](../east/CLAUDE.md) — core language this builds on.
