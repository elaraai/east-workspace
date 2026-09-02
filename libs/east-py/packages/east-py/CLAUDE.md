# east-py

Python runtime for the East programming language. The East type system lives
in python; everything that *executes* — IR compilation, the builtin library,
serialization — is the native **east-c** runtime, reached through Cython
bridges (`_eastc_bridge.pyx`, `runtime/_compiler_eastc.pyx`,
`serialization/_*_eastc.pyx`). No builtin is implemented in python.

East values are plain python data (`EastArray`, `EastDict`, `EastStruct`,
… plus `int`/`float`/`str`/`bool`/`datetime`) whose eager methods invoke the
east-c builtins; `East.function` builds East programs from python bodies.
Both are one vocabulary — **East function / expression / body / build /
capture**. There are no "kernels", "traces" or "push-downs" here: a test
(`tests/test_expression_builder.py`) pins that those spellings stay retired.

## Commands

`make build`, `make test`, `make lint`, `make typecheck`, `make check`,
`make repl`, `make coverage`, `make bench`, `make build-cython` from this
directory. See
[`../../../../docs/conventions/MAKEFILE_TARGETS.md`](../../../../docs/conventions/MAKEFILE_TARGETS.md).

Pytest is run through uv against an editable install — a `.py` edit is live,
a `.pyx` edit needs `cd ../.. && make reinstall-east-py` (rebuilds the
extensions). A `pytest … | grep | tail` pipeline's exit code is `tail`'s:
read the summary line.

```bash
uv run pytest tests -q --no-cov --ignore=tests/conformance   # units + compliance
uv run pytest tests/test_stdlib.py -q --no-cov -k round        # one file / keyword
uv run pytest tests/conformance -q --no-cov              # IR round trip, ~1 min
```

## Architecture

### Two surfaces, one builtin

- **Values** (`east/types/values/`) — `primitives.py`, `collections.py`
  (`EastArray`/`EastSet`/`EastDict`), `structural.py` (`EastStruct`/
  `EastVariant`/`EastRef`), `tensor.py` (`EastVector`/`EastMatrix`),
  `guards.py`, `validation.py`, `_helpers.py`. An eager method calls its
  builtin through `_call_builtin`. Python scalars take no methods, so their
  builtins are the `East.<Type>` namespace functions, value first
  (`East.DateTime.add_days(d, n)`).
- **Expressions** (`east/expression/expr/<type>.py`, one file per type —
  `ArrayExpression`, `FloatExpression`, …) — the same method names, recording
  IR inside an `East.function` body. `_call_builtin` is dual-mode: on values
  it runs now, in a build it emits the `Builtin` node. The scalar namespaces
  and the stdlib are dual-mode the same way.
- **Callbacks** — a python lambda passed to an eager collection method
  (`xs.map(lambda b, x: …)`) is a body: `expression/capture.py`
  (`capture_callback`) builds it into an East function once (cached, #422)
  and east-c runs it. It builds or it raises; there is no interpreter
  fallback (#625).
- **Name parity** — `tests/test_ts_name_parity.py` reads the TypeScript
  sources (`libs/east/src/expr/*.ts`): every TS method exists on the
  expression class and on the eager class / scalar namespace; every
  python-only name is declared with its reason.

### Module layers

1. **`east/types/`** — `types.py` (`EastType` and the constructors),
   `type_of_type.py`, `ir.py` (IRType), `coercion.py`, `construct.py`, and
   `values/` above. `_values_cy.pyx` accelerates the struct/variant classes.
2. **`east/expression/`** — the builders. `function.py` (`East.function` /
   `asyncFunction`, strict: declared `out` required and enforced;
   `East.compile`), `platform.py` (`East.platform` declarations),
   `statements.py` (the block a body receives: `b.let`, `b.if_`, `b.for_`,
   `b.return_`, …), `control.py` (the expression forms `East.while_`,
   `East.for_`, `block`/`let`/`ref`/`try_catch`), `nodes.py`/`lift.py`/
   `finalize.py` (IR construction, lifting python values, build-time CSE),
   `location.py` (authoring-frame source maps, #626), `capture.py`,
   `project.py` (field masks for beast2 projection), `errors.py`,
   `helpers.py`. `libs/<type>.py` is the TypeScript `expr/libs` stdlib,
   ported body for body and built on first use (`LazyFunction`).
3. **`east/namespace.py`** — the `East` object: the scalar namespaces
   (`East.Float`, `East.Integer`, `East.String`, `East.DateTime`,
   `East.Boolean`), the tensor and collection constructors, the root
   helpers (`str`, `print`, `min`/`max`/`clamp`, the comparisons, diff/patch)
   and the builders above.
4. **`east/ir/`** — `builders.py` (IR node constructors), `analyze.py`
   (type checking, validation, async propagation).
5. **`east/runtime/`** — `compiler.py` over `_compiler_eastc.pyx` (compile
   IR in east-c, bind platform functions, `native_function_for` — the eager
   callbacks' native handles), `platform.py`, `builtin_signatures.py` (the
   builtin → type signature table), `memo.py`, `errors.py`.
6. **`east/codegen/`** — the IR → python printer (`printer.py`) and the
   builtin spelling table (`spellings.py`) it shares with the compliance
   replay, so what the printer writes is what the replay executes (#627).
7. **`east/functions.py`** — cross-language functions (#628): the function
   manifest type, `East.export_functions` / `import_function` /
   `link_imports` (name for name with `libs/east/src/functions.ts`); the CLI
   is `east-py export-functions`. Contract: `docs/conventions/EAST_CODEGEN.md` §6.
8. **`east/serialization/`** — `beast2.py`, `json.py`, `csv.py`,
   `east_parser.py`/`east_printer.py` (East text), each over its `_*_eastc.pyx`.
9. **`east/datetime_format.py`**, **`east/utils/ordering.py`** (East's total
   order; `_ordering_cy.pyx`).

### Invariants

1. **Immutability.** `EastStruct` and `EastVariant` are frozen; `EastArray`,
   `EastSet`, `EastDict` and `EastRef` are mutable.
2. **Container ordering.** Sets and Dicts keep East's total order.
3. **Type-value correspondence.** Every East value carries its type
   (`arr.element_type`, `expr.east_type`, `type_of(value)`).
4. **Type-driven operations.** Parsing, serialization and the generic
   builtins take the target type explicitly.
5. **Operators only where python agrees with East** (#624): `//`, `%` and
   Integer `**`/`/` raise at build time naming the East spelling.

## Cython

Every `.pyx` is a bridge to east-c (or an accelerator: `_values_cy`,
`_ordering_cy`). `setup.py` discovers all `.pyx` files; `make build-cython`
rebuilds them in place. A `cpdef` is callable from python and Cython; class
swaps (`EastStruct = CyEastStruct`) happen in `types/values`, so test with
`is_east_struct()` / `is_east_variant()`, not `isinstance`.

## Type checking

mypy runs gradually typed (`disallow_untyped_defs = false`) — East is
dynamically typed at the boundary. See `pyproject.toml`.

## Tests

- `tests/test_*.py` — units, one file per concern (`test_stdlib.py`,
  `test_expression_*.py`, `test_ts_name_parity.py`, `test_codegen_spellings.py`,
  `test_eager_capture_matrix.py`, …); `tests/serialization/` for the codecs.
- **Compliance** — `test_compliance.py` runs the TypeScript-exported spec
  corpus (`/tmp/east-test-ir`, from `cd libs/east && make test-export`)
  through east-c; `test_compliance_eager.py` + `eager_replay.py` replay the
  same corpus through the python surface, builtin by builtin, gated by an
  exact `KNOWN_DIFFS` pin that only ratchets down.
- **Conformance** (`tests/conformance/`) — `build(print(IR)) ≡ IR` under
  east-c's normalizer for the corpus and for the exported examples
  (`/tmp/east-examples-ir`, from `pnpm --filter @elaraai/east run
  export:examples`); every corpus program also runs its compliance suite
  on the rebuilt IR and must agree with the original test by test.
  `EAST_CONFORMANCE_REQUIRED=1` fails instead of skipping when a corpus is
  missing (the per-OS CI sweep sets it). About a minute in all.
  `test_three_way_sweep.py` continues the round trip through TypeScript —
  IR₁ → python → IR₂ → `east-node transpile --rebuild` → IR₃, all equal
  under the normalizer — and needs the built east-node CLI
  (`EAST_NODE_CLI=…/east-node-cli/bin/east-node.mjs`, or `east-node` on
  PATH; skips otherwise, `EAST_SWEEP_REQUIRED=1` in its own CI job). The
  contract and construct table: `docs/conventions/EAST_CODEGEN.md`.
- **No clocks in CI.** A test that asserts on elapsed time is
  `@pytest.mark.perf` and runs only under `EAST_PERF=1` (`make bench`);
  `tests/conftest.py` skips it otherwise. CI pins the mechanism a timing
  claim rests on (a counter, a decode plan, a call count), never the clock.
- `SKILL.md` is the `east:east-py` plugin skill — edit it as one document,
  never by grep-patching, and keep its decision tree exhaustive.

## See also

- [`../../CLAUDE.md`](../../CLAUDE.md) — lib-level overview.
- [`../../../east/CLAUDE.md`](../../../east/CLAUDE.md) — the TypeScript
  reference implementation; this package passes the same compliance suite.
