# east-c

C port of the East language runtime. Three packages:

- `packages/east-c/` — Core runtime (types, values, IR, compiler, builtins, serialization).
- `packages/east-c-std/` — Standard platform functions (console, fs, path, crypto, time, random, fetch, test).
- `packages/east-c-cli/` — Native C CLI binary source **and** the npm launcher `@elaraai/east-c-cli`. The same directory carries both: CMake builds the binary; `package.json` + `bin/east-c.mjs` are the npm-side launcher that resolves a per-platform binary (`@elaraai/east-c-cli-<target>`) via `require.resolve` and spawns it. Per-platform packages are generated at release time, not committed. See `docs/npm-runner-distribution.md`.

## Commands

```bash
make build    # Build both packages
make unit     # Run the ctest gates (no exported IR needed)
make test     # Gates + both compliance suites
make clean    # Remove build directory
```

See `../../docs/conventions/MAKEFILE_TARGETS.md` for the full target list.

## Compliance tests

IR JSON test files are exported from the TypeScript `east` package and live in `/tmp/east-test-ir/`.

```bash
# Export IR from the TS side first (from the workspace root)
make test-export

# Then run compliance tests
make test-east-c       # east-c core
make test-east-c-std   # east-c-std
make test-all          # gates + both

# Run a single compliance test
./build/packages/east-c/test_compliance /tmp/east-test-ir/Array.json

# ASan/LSan over the whole corpus — the oracle for any lifetime change
REBUILD=1 make leak-check-all
```

## Architecture

- C11, CMake.
- Reference counting for memory management (`EastValue`, `EastType`).
- Tree-walking interpreter (not code generation).
- `int64_t` for integers (no bigint).
- Async preserved in IR but executed synchronously.

## Reference implementations

- TypeScript: `../east` (core), `../east-node/packages/east-node-std` (platform).
- Python: `../east-py` (core + platform in one package).

## Key files

- `packages/east-c/include/east/` — public headers.
- `packages/east-c/src/` — core implementation.
- `packages/east-c/src/builtins/` — builtin operations.
- `packages/east-c/src/serialization/` — JSON, Beast2, CSV, East text.
- `packages/east-c/src/type_of_type.c` — IR JSON decoder.
- `packages/east-c/tests/` — unit tests and compliance runner.
- `packages/east-c-std/` — platform functions.
