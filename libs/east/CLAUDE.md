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
- `src/codegen/` — the IR → TypeScript printer (`East.toSource`; `printer.ts` —
  given `libraries`, a platform call prints as the library exports its
  declaration handle (`Compression.Tar.create`), else as a declaration named
  after the platform function; the handles `East.platform` returns carry
  their identity, `isPlatformDeclaration` —
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
- `src/query/` — typed jq queries over East values (#875): the wire types
  (`types.ts`; python twins `east/query/types.py`), and in `jq/` the lexer,
  parser and canonical printer (`lexJq`, `parseJq`, `printJq`; node spans in
  `spans.ts`), whose round-trip law `test/query.parse.spec.ts` holds over the
  corpus and generated programs, and the checker (`checkJq` in `check.ts`:
  shapes and multiplicities in `shapes.ts`, every sentence it says in
  `messages.ts`, the builtin catalog — jq 1.8.1's builtins exactly, each with
  its typing rule and East definition — in `catalog.ts`, strftime tokens in
  `strftime.ts`), and the translator (`translateJq` in `translate.ts`, each
  builtin's rule in `translate-builtins.ts`): a checked program as ordinary
  East IR, typed from the checker's records (a node the checker's one record
  cannot serve is checked again for its input's type, `retype`). `East.jq`
  (`src/expr/query.ts`) translates at build time and emits a call of the
  `Query` builtin (#1041), which carries the program as written
  (`QueryCallType`) beside the translation and gives the translation — every
  runtime implements it as any builtin, and the printers print it back as
  `East.jq`; `evaluateJq` and `QueryError` (`src/query/evaluate.ts`) are the
  host entry.
  Normative spec `devdocs/QUERY.md` (§10 catalog, §12 diagnostics, §13
  deviations, §15 translation, §18 grammar and canonical text). The shared
  fixture (`test/query.fixture.ts`) and the corpus (`test/query.corpus.ts`)
  generate the checked-in `test/fixtures/query-fixture.beast2` and
  `query-corpus.beast2` (each case's output, and its translation's IR), which
  the other runtimes read; `make query-corpus` rewrites both, and QUERY.md
  §10's and §12's generated tables, and a spec fails while any of them is
  stale. A change to the translator changes the corpus's IR bytes: rewrite
  it. The type matrix (`test/query-types/`, `test/query.types.spec.ts`,
  QUERY.md §16.5) runs every shape of East type through every jq program
  its kind admits, judged by jq 1.8.1's recorded runs
  (`test/fixtures/query-types.json`: `make query-types`, with jq on the
  PATH) or by QUERY.md; `make query-types-tables` rewrites §16.5's tables.
  `make test-export` writes the query suites to `query-conformance/`,
  `query-types/` and `query-corpus/`, which every runtime's compliance leg
  runs.
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
