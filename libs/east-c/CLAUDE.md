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
make bench-cli # The interpreter, dict-output and paged-read benchmarks (needs a built libs/east)
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
- Tree-walking interpreter (not code generation). Variables are resolved to
  frame cells once, at IR construction (`src/ir_resolve.c`); a resolved read
  is verified against the live frame and falls back to the by-name walk, and
  `EAST_C_NO_SLOT_RESOLVE=1` skips the resolver so every read takes that walk
  — the oracle the resolved path is checked against.
- A closure holds the frame it was made in, unless the resolver marked its
  function `closed` (it reads nothing it does not bind). The evaluator drops
  every frame it makes through `frame_release` (`src/compiler.c`), which
  unbinds a frame only what it binds still holds — a closure, or a struct,
  array, dict or ref with one inside, walked within a small bound — at once,
  without waiting for a collection (#1002, #1010). The cycle collector
  (`src/gc.c`) counts references to the frames closures hold as it counts them
  to values, and reclaims the rest — a closure that escaped and was dropped
  later — at a collection; one it first finds alive is promoted, and waits for
  a full collection, which a single long call never runs (#1013).
- A Set or Dict of up to `EAST_SMALL_COLLECTION_MAX` elements keeps them in
  its sorted arrays alone (`items`, `keys`/`values`), with no B-tree; one more
  moves them into a tree, whose lazily synced cache the arrays become (#1005).
  Only `src/values.c` touches either store — everything else reads through
  `east_set_at` / `east_dict_key_at` / `east_dict_val_at`.
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
- `packages/east-c/src/ir_resolve.c` — static name resolution over a built IR tree.
- `packages/east-c-cli/contrib/` — benchmark generators for the interpreter,
  dict-output and paged-read profiles (`make bench-cli`).
- `packages/east-c/tests/` — unit tests and compliance runner.
- `packages/east-c-std/` — platform functions.
