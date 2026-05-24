# east-c-std

Standard platform functions for `east-c`: console, fs, path, crypto,
time, random, fetch, test. C11 implementations of the same surface
TypeScript `@elaraai/east-node-std` provides.

## Key files

- `include/east/` — public headers.
- `src/` — implementations (one file per module).
- `tests/` — unit tests + compliance against TS-exported test IR.
- `scripts/` — std-specific compliance runner.

## See also

- [`../../CLAUDE.md`](../../CLAUDE.md) — lib-level overview and `make` targets.
- [`../east-c/CLAUDE.md`](../east-c/CLAUDE.md) — core C runtime this depends on.
