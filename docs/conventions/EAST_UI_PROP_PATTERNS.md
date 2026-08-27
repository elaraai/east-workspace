# East UI prop patterns — data vs behavior, and the factory reification rule

Rules for authoring **east-ui / e3-ui component APIs and factories**
(`libs/east-ui/packages/{east-ui,e3-ui}`). Established by epic
[#203](https://github.com/elaraai/east-workspace/issues/203); enforcement
history: #136 (behavior props became pass-through `FunctionType`) and #205
(mapper reification, PR #224).

## The two prop kinds

Every component prop is exactly one of:

1. **Data** — `SubtypeExprOrValue<T>`. Materialized eagerly into the IR
   (rows, entities, encodings). Sorting / filtering / serialization read it.
2. **Behavior** — `SubtypeExprOrValue<FunctionType<[…fixed], T>>`. A real
   East function value stored in the IR, **lifted, never invoked at build
   time**; the renderer calls the compiled closure at render / interaction
   time (per visible cell, per drag probe, per event).

There is no third kind. In particular: never a TS callback whose *result
expression* is spliced into the component IR.

## Bare lambdas ARE East functions (authoring sugar)

In any `FunctionType`-typed position, a bare `($, arg) => { … }` lambda is
coerced into a real East function with the types lifted from the prop's
declared `FunctionType` (`east/src/expr/ast.ts:315`) — identical IR to an
explicit `East.function(...)`. With no expected type the coercion throws
(`ast.ts:84`); that is why *generic* mapper props (typed over the caller's
row struct) cannot ride the same sugar, and factories must reify them:

## Factory rule: reify mapper callbacks — never splice (MANDATORY)

A factory that accepts generic per-row TS callbacks
(`value: (v, row) => …`, `assignment: x => ({ … })`, chart encodings) MUST
wrap the callback into a real East function once per factory call and CALL
that function inside the eager `.map` — never invoke the callback mid-map
and paste its expression tree into the map body. Use the internal helpers
in `east-ui/src/shared/reify.ts`:

- `mapRows(rows, OutType, row => …)` — fixed-output row normalization.
- `mapRowsBlock(rows, OutType, ($, row) => …)` — same, for bodies that
  need a block builder (`$.let`, statements).
- `reifyAccessor([inputTypes], lambda)` — output type inferred from the
  lambda's expansion (Table column `value`, Chart encodings), via
  `East.function`'s inference overload (`East.function(inputs, undefined,
  body)`, `east/src/expr/block.ts:311`).

Why splices are banned: double evaluation when a spliced result is
referenced twice (the old `no-reinlined-east-binding` error at
`table/index.ts:508`), undefined capture semantics for user callbacks, and
per-expansion type checks. A reified function expands the lambda exactly
once, captures like a closure, and type-checks once at the boundary.

Materialization semantics are unchanged: the function is applied eagerly
inside the same map, so evaluated component values are identical to the
historical splice.

## Capture rule (behavior props)

A `FunctionType` prop's East function may capture only **data and
bind-handles** (both serializable — the #106 series). Never capture a
recursive-typed `UIComponentType` value from an enclosing scope — the
beast2 encoder fails with `Recursive type context not found` /
`Cannot serialize function: no IR attached` (the #136 failure class).
Build UI *inside* the function body, from captured data.

## Full row access in render functions (index + capture)

Renderers can only construct argument types they statically know —
indices, keys, fixed context structs (e.g. `TableCellRenderContextType`
`{rowIndex, columnKey, cellValue}`). Caller-typed data crosses the closed
`UIComponentType` boundary via **captures**:

```ts
const rows = $.const(orders, ArrayType(OrderType));
// …
render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
    const row = $.const(rows.get(ctx.rowIndex));      // capture + index
    return Badge.Root(East.str`${row.currency} ${ctx.cellValue.unwrap("Float")}`);
}),
```

This is the general mechanism, not a workaround: IR-level generics were
assessed and rejected in #203 — closures are the existential the language
already ships, in all three runtimes.

## Table cell IR (#206)

Table cells are bare `LiteralValueType` variants — the sortable value
IS the cell. `TableColumnType.render` is **required**; the factory
synthesizes a capture-free text default (`ctx.cellValue.unwrap(tag)` via the
column's statically-known value tag) when the author omits it. The IR
carries no per-cell UI content: payloads shrink, every Reactive tick skips
per-cell component construction, and the renderer has a single render path
(per visible cell). Note `equalFor` treats function values as always equal
(`east/src/comparison.ts:361`), so synthesized defaults can never
destabilize the renderer's memo guard.
