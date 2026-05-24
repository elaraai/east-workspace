# East Node IO

I/O platform functions for the East language on Node.js: SQL/NoSQL
databases, S3 storage, FTP/SFTP transfer, file format parsing, and
compression.

## Package map

The README lists every namespace and its functions. Quick reference:

| Namespace | Sub-namespaces |
|---|---|
| `SQL` | `SQLite`, `Postgres`, `MySQL`, `Access` |
| `NoSQL` | `Redis`, `MongoDB` |
| `Storage` | `S3` |
| `Transfer` | `FTP`, `SFTP` |
| `Compression` | `Gzip`, `Zip`, `Tar` |
| `Format` | `XLSX`, `XML` |

## Commands

`make build`, `make test`, `make lint` from this directory. Integration
tests need Docker services up:

```bash
make services-up        # From workspace root
make test:integration   # Or `pnpm test:integration` from this dir
make services-down
```

See [`../../../../docs/conventions/MAKEFILE_TARGETS.md`](../../../../docs/conventions/MAKEFILE_TARGETS.md).

## See also

- [`../../../../docs/conventions/EAST_TS_INTEROP.md`](../../../../docs/conventions/EAST_TS_INTEROP.md)
  — **MUST READ.** All East value handling here uses `isValueOf` (not
  `typeof`), `compareFor` (not raw `<`/`>`), `variant()` (not
  hand-rolled). Especially important for converting native DB values
  into East types.
- [`SKILL.md`](SKILL.md) — authoring cheat-sheet for end users.
  **Matches the `east:east-node-io` plugin skill — DO NOT EDIT
  casually.**
- [`STANDARDS.md`](STANDARDS.md) — mandatory TypeDoc + testing
  standards.
- [`README.md`](README.md) — public-facing user docs + full namespace
  reference.
