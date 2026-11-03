# Queries (typed jq)

`East.jq` inside an East body, and the host-side checker. Part of the `east` skill.

## Queries (typed jq)

`East.jq` asks a question of a value in jq, inside an East body. The program is
parsed, type-checked against the input's East type and translated to ordinary
IR when the function is built, so it runs on every runner; a mistake is a
`QueryError` at build time, with the checker's sentence, span and fixes. The
language is jq 1.8 over East values: `libs/east/devdocs/QUERY.md` in the East
repository says what each builtin does, and every place East differs from jq.

```typescript
const Order = StructType({ id: IntegerType, total: FloatType });

const bigOrders = East.function([ArrayType(Order)], ArrayType(IntegerType), ($, orders) =>
    East.jq(orders, "[.[] | select(.total > 1000) | .id]", ArrayType(IntegerType)));

// An object of inputs is read as an e3 root: `.orders` is that input alone, so a lazy one stays lazy.
const revenue = East.function([ArrayType(Order)], FloatType, ($, orders) =>
    East.jq({ orders }, ".orders | map(.total) | add", FloatType));
```

A stage that collects rows before a step that reads them one at a time —
`map(f) | add`, `| length`, `| any`, `| first`, `| .[:n]`, a `reduce` over
`.[]` — runs as one loop, so the array between them is never built; `first`
and `.[:n]` stop the stage once they have their rows, unless a later row could
raise (QUERY.md §15.1–15.2).

A row a stage builds or keeps holds only the fields the steps after it read:
`map(. + {region: …}) | group_by(.region) | map(… .total …)` builds each row of
its region and total, and over an e3 root `map(select(p))` keeps each row as
the fields read after it, so a paged dataset decodes those alone. A row read
whole — the output, `keys`, `tojson`, `==` — is built whole (QUERY.md §15.1).

| Signature | Description | Example |
|-----------|-------------|---------|
| **In an East body** |
| `East.jq<T>(input: Expr \| { [name: string]: Expr }, program: string, resultType: T): ExprType<T>` **❗** | The query's result, an expression of `resultType`: the outputs' type `T` for a query that gives exactly one output, `Option<T>` for at most one, `Array<T>` for any number. Throws `QueryError` when the query does not check, or checks to another type | `East.jq(orders, "map(.total)", ArrayType(FloatType)).sum()` |
| **Host-side** |
| `checkJq(program: string, input: EastType, options?: { root?: boolean, tooling?: boolean }): CheckJqResult` | The checker: `program` (the program as written, a `JqType` tree, or `null` when it does not check), `inputType`, `diagnostics` (each a code, a span, one sentence, suggestions and fixes), `elementType`, `multiplicity` (`"one"`, `"maybe"` or `"many"`). A query's types are never stored: check the program against its data wherever they are needed | `checkJq(".orders[0].totl", Root).diagnostics[0].message` |
| `completeJq(text: string, offset: number, input: EastType, options?): JqCompletions \| null` | The completions at a cursor, from the type there: fields, cases, variables, builtins | `completeJq(".orders[0].to", 13, Root)` |
| `printJq(program: JqNode, options?: { layout?: "line" \| "pipeline" }): PrintedJq` | A program's canonical text, and its nodes' spans; `pipeline` puts each top-level stage on a line of its own | `printJq(checked.program!).text` |
| `translateJq(checked: CheckJqResult, options?: { maxOutputs?: number, tooling?: boolean }): JqTranslation` **❗** | The translation: `fn()`, an East function of the inputs the query reads (`inputs`), and its `resultType` | `East.compile(translateJq(checked).fn(), [])` |
| `evaluateJq(program: string \| CheckJqResult, input: unknown, options?: { inputType?, root?, tooling?, platform? }): unknown` **❗** | Checks, translates, compiles (cached) and runs a query over a TypeScript value. Throws `QueryError`: the checker's diagnostics, or one `runtime` diagnostic at the node that raised | `evaluateJq("[.[] \| .id]", orders, { inputType: ArrayType(Order) })` |
| `splitJq(checked: CheckJqResult, options?: { maxOutputs?: number }): JqSplit` | A query checked as an e3 root, split over one dataset's pieces for an e3 split call: `piece()` each piece runs, the `output` kind its outputs combine by (`array`, `set`, `dict` with `merge()`, `fold` with `zero` and `combine()`, or `first` with its `limit`, a stream's first rows in input order for `first(f)` and `limit(n; f)`), and `then()` over the result; or, `kind: "whole"`, why it runs as one unit. QUERY.md §17.1 | `splitJq(checkJq(".orders \| group_by(.region) \| map(length)", Root, { root: true })).output.kind` |

- **The values are East's.** A Dict is an object keyed by its key type, so
  `.byId[1035]` looks up an Integer key; a variant reads as `{type, value}`,
  and `select(.status.type == "shipped")` narrows it; an Option is `null` or
  its value. `.name` on a struct that lacks the field is an error (`.name?`
  gives `null`), and so is comparing values of two types.
- **A lookup can miss**, so `.[i]` and `.[k]` give an `Option`, and
  `first(f)` gives at most one output, so its result type is `Option<T>`.
- **In code a query is a call of the `Query` builtin**, which carries the
  program as written beside its translation: every runtime runs it as any
  builtin, and `East.toSource` prints it back as `East.jq(…)`.
