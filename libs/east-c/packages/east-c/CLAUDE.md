# east-c (core)

C11 implementation of the East language runtime: types, values, IR
parsing, tree-walking interpreter, serialization (JSON, Beast2, CSV,
East text), and 200+ builtins.

- Reference counting for `EastValue` / `EastType`.
- Tree-walking interpreter — no codegen.
- `int64_t` integers (no bigint).
- Async preserved in IR but executed synchronously.

The TS package `@elaraai/east` is the reference implementation; this
package must pass the compliance suite under
[`tests/`](tests/) using IR files exported from the TS side.

## Key files

- `include/east/` — public headers.
- `src/builtins/` — builtin operations (integer, float, string, array, …).
- `src/serialization/` — JSON, Beast2, CSV, East text.
- `src/type_of_type.c` — IR JSON decoder.
- `tests/` — unit tests + compliance runner.
- `scripts/` — compliance runner, leak checker, profiler.

## See also

- [`../../CLAUDE.md`](../../CLAUDE.md) — lib-level overview and `make` targets.
