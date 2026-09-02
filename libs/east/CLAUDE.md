# East

Core language: a statically + structurally typed, expression-based language
embedded in TypeScript. Compiles to serializable IR (the "narrow waist") and
runs on multiple backends (TS reference compiler, Python, C, future Julia).

## Structure

- `src/` — TypeScript source: types, expression builders, serialization, the
  reference JS compiler.
- `src/containers/` — JS runtime containers (sorted set / dict, variants).
- `src/expr/` — fluent expression builder.
- `src/serialization/` — JSON, Beast2, CSV, East text format.
- `src/codegen/` — the IR → TypeScript printer (`East.toSource`; `printer.ts`,
  the builtin spelling table `spellings.ts` — whose per-slot `exprs` /
  `inferred` flags `spellings.spec.ts` checks against the surface's
  signatures with the compiler — `types.ts`, and `doc.ts`, the
  layout document algebra the source is written in — prettier's model,
  pinned in `doc.spec.ts`) and its round-trip spec over the hand-written
  cases, every exported example and the compliance corpus. Contract +
  construct table: `../../docs/conventions/EAST_CODEGEN.md`.
- `src/naming.ts` — authoring names for IR variables (#639): parameter
  names from a body's source and `$.let`/`$.const` binding names from the
  call site, both parsed by the TypeScript compiler (`typescript` is an
  optional peer; absent it, variables stay `_N`). python twin
  `east/expression/naming.py`. `docs/conventions/EAST_CODEGEN.md` §7.
- `src/functions.ts` — cross-language functions (`East.exportFunctions` /
  `importFunction` / `linkImports`, the manifest type); python twin
  `east/functions.py`; `e3.export` links; contract in
  `../../docs/conventions/EAST_CODEGEN.md` §6.
- `src/datetime_format/` — format specifiers, printers, parsers.
- `test/` — compliance suite (serializes to IR; runs on any backend).
- `devdocs/` — living design docs (start with `SERIALIZATION.md`).
- `example/`, `contrib/` — experiments and scratch (per
  `[Scratch files in contrib/]` rule).

## Commands

`make build`, `make test`, `make lint` from this directory. See
`../../docs/conventions/MAKEFILE_TARGETS.md` for the full target list.

## See also

- `STANDARDS.md` — mandatory dev standards (TypeDoc, testing). Read before
  editing any public export.
- `SKILL.md` — authoring cheat-sheet for end-users; **matches the `east:east`
  plugin skill — DO NOT EDIT casually**.
- `devdocs/SERIALIZATION.md` — canonical reference for the type system,
  ordering, and serialization formats.
- `../../docs/conventions/EAST_TS_INTEROP.md` — TS↔East interop rules
  (`isValueOf`, `compareFor`, `variant`).
- `../../docs/conventions/EXAMPLES_AUTHORING.md` — the `*.examples.ts`
  pattern used by `test/`.
- `../../docs/conventions/EAST_CODEGEN.md` — IR ↔ source in both
  languages: the printers' contract, the construct mapping, the three
  round-trip suites (`src/codegen/codegen.spec.ts` reads the exported
  corpora from `/tmp/east-test-ir` and `/tmp/east-examples-ir`; missing
  ones skip unless `EAST_CONFORMANCE_REQUIRED=1`).
