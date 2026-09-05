// A compact "author to the rules up front" cheat-sheet, injected at session /
// subagent start so an agent writes idiomatic East BEFORE the preemptive
// `<east-code-review>` (and the editor language server / ESLint `east/east-rules`)
// start flagging it. One `avoid … → use …` line per rule.
//
// Keep in sync with libs/east-diagnostics/src/rules. The linter self-gates on
// East-ness (an East type/block, an `e3` construct, or an `@elaraai/*` import), so
// these only apply to actual East code.
export const EAST_RULES_CONTEXT: string = [
  "What the East linter checks — the editor language server, ESLint `east/east-rules`, and the preemptive `<east-code-review>` all run the SAME rule set, so author to these from the start. Inside an `East.function` / `$`-block, the code must be East all the way down:",
  "",
  "Host-vs-East (most common):",
  "- no-host-in-east-block — avoid host TypeScript inside a block (`a + b`, `cond ? a : b`, `a && b`, `arr[i]`, a JS `for`/`if` that builds IR, a TS helper/closure call, a `${x}` string template); use East instead: `a.add(b)`, `cond.ifElse(() => a, () => b)`, `a.and(() => b)`, `coll.get(i)`, `$.for(...)` / `data.map(($, x) => …)`, `East.str`.",
  "- no-module-scope-east-macro — avoid a module-scope TS helper that returns East IR or a composite string key like `(o, l) => `${o}|${l}``; make a real `East.function`, or model typed / nested East data.",
  "- no-compile-time-data-injection — avoid reading data at module load (`node:fs`, `readFileSync`, `JSON.parse`, `process.env`); load at runtime via `e3.input` / datasets / a platform task.",
  "- no-compile-time-seed-data — avoid computing an `e3.input` seed in host code (a Map filled by loops, `{ a: num(cfg.x) }`); pass a small literal / empty default and parse real data at runtime (`blob.decodeCsv` in a task).",
  "",
  "Bindings & values:",
  "- no-let-const-in-expression — avoid burying `$.let`/`$.const` mid-expression (a struct-field value, call argument, array element); declare it on its own line and reuse the binding.",
  "- no-redundant-east-cast — avoid a cast / generic / wrapper the East type already governs: `$.let(x as T, T)`, `$.let(new Map<K, V>(), DictType(...))`, `$.let(East.value(x, T), T)`; drop it.",
  "- prefer-explicit-east-type — avoid an under-determined `$.let([])` / `$.let({})` / `$.let(new Map())`; give the East type, e.g. `$.let([], ArrayType(IntegerType))`.",
  "- no-untracked-east-data — avoid a bare JS literal in an East-typed slot inside a block; bind it with `$.const`/`$.let`.",
  "- no-reinlined-east-binding — avoid reusing an East `Expr` held in a JS `const` across a block (it re-inlines per use); bind it once with `$.let`/`$.const`.",
  "- no-unexecuted-east-expression — avoid a bare East expression statement; execute it with `$(expr)` or bind it.",
  "",
  "Variants, types, imports, UI:",
  "- prefer-some-none — avoid `variant(\"some\", x)` / `variant(\"none\", null)`; use `some(x)` / `none`.",
  "- no-handrolled-variant — avoid a hand-rolled `{ type: \"x\", value: v }`; use `variant(\"x\", v)`.",
  "- no-east-namespaced-type — avoid `East.IntegerType`; import `IntegerType` and use it bare.",
  "- prefer-let-const-over-east-value — avoid `East.value(...)` inside a block; use `$.let`/`$.const`.",
  "- prefer-jsx-over-factory-call — in a `.tsx` file, avoid `Foo.Root(...)`; author the `<Foo>` tag.",
  "- no-relative-src-import — avoid importing another package via `../src` or `@elaraai/x/src`; use its published package name.",
].join("\n");

// The python twin, covering `east.diagnostics` (`east-py lint`, the flake8
// plugin, the language server). Spelled in python: the block is `b`, not `$`;
// bodies take the block first; the strict expression surface (#625) REFUSES
// most of these at build time rather than merely discouraging them.
//
// Keep in sync with libs/east-py/packages/east-py/east/diagnostics/rules.
export const EAST_RULES_CONTEXT_PY: string = [
  "What the East python linter checks — `east-py lint`, the flake8 `EAS` codes and the language server all run the SAME rules, so author to these from the start. Inside an `East.function` body the code must be East all the way down, and most of these are BUILD-TIME REFUSALS said early, not style notes:",
  "",
  "Body shape (the strict surface):",
  "- body-takes-block-first — every body takes the block first: `lambda b, x: …` / `def f(b, x)`, never `lambda x: …`; the block is for statements, so `b.price` is not a field read.",
  "- no-statement-on-outer-block — inside a nested body use THAT body's block: `lambda b: b.assign(...)`, not `lambda _b: b.assign(...)` reaching outward.",
  "- no-discarded-expression — a bare expression statement is built and thrown away; append it with `b.do(...)` or return it.",
  "",
  "Python that cannot be traced (the build refuses these):",
  "- no-python-boolean — avoid `and` / `or` / `not` / `if` / `in` / `len()` / iteration / `int()` / `float()` over an expression; use `&`, `|`, `~`, `b.if_(...)` / `East.if_else(...)`, and the expression's own methods.",
  "- no-python-formatting — avoid f-strings / `str()` / `format()` / `%` over an expression; build strings with `+`, or `East.String.print(T, value)`.",
  "- no-operator-fork — avoid `//`, `%`, `**` and `a[-1]` on an expression; call `East.Integer.divide` / `remainder` / `pow`, and spell the element you mean.",
  "- no-python-round — avoid `round(x)` (ties-to-even); call `East.Float.round_half` / `round_floor` / `round_ceil` / `round_trunc`.",
  "- no-python-work — avoid an eager callback reaching for a module, an installed package, or a python `def` doing work; express it in East.",
  "- no-deprecated-alias — use the canonical spelling (e.g. `.reduce()`, not `.fold()`).",
  "",
  "Bindings & values:",
  "- no-let-const-in-expression — give `b.let` / `b.const` its own statement; don't bury a declaration inside an expression.",
  "- prefer-explicit-east-type — avoid `b.let([])` / `b.let({})`; pass the East type, e.g. `b.let([], ArrayType(IntegerType))`.",
  "- no-untracked-east-data — avoid a plain python literal local reaching an expression's method; bind it with `b.const(rows, Type)`.",
  "- no-reinlined-east-binding — an expression held in a python local and used twice is re-inlined and re-evaluated; bind it once with `b.let` / `b.const`.",
  "- no-redundant-east-cast — avoid `b.let(East.value(x, T), T)`; pass the value and type to `b.let` directly.",
  "- prefer-let-const-over-east-value — inside a body declare with `b.const(value, Type)` / `b.let`, not `East.value(...)`.",
  "",
  "Variants & comparison:",
  "- prefer-some-none — avoid `variant(\"some\", x)` / `variant(\"none\", None)`; use `some(x)` / `none`.",
  "- no-handrolled-variant — avoid a `{\"type\": …, \"value\": …}` dict; use `variant(\"Tag\", value, Type)` — the encoder needs what it constructs.",
  "- no-host-comparison-on-east-values — outside a body, avoid `==` / `<` on a decoded variant or option; use `equal_for(T)` / `compare_for(T)` (and `make_east_key(T)` for `sorted`).",
  "",
  "Build time vs runtime (python computing what East should declare):",
  "- no-build-time-clock — avoid `datetime.now()` / `time.time()` at module scope; author the constant, or read the clock inside a platform function.",
  "- no-compile-time-data-injection — avoid `open()` / `json.load` / `os.environ` at module import; load at runtime (an e3 input, a dataset, a platform function).",
  "- no-inline-credentials — avoid a literal password / token; `East.Env.get(\"YOUR_VAR\")`, since IR is content-addressed and replicated.",
  "- no-module-scope-east-macro — avoid a module-scope helper that builds IR for a body, or a composite `f\"{a}|{b}\"` key; make it an `East.function`, or model typed / nested East data.",
  "- no-python-east-data — avoid assembling East rows with a module-scope comprehension or loop; write them out, or produce them at runtime.",
  "- no-python-string-building — avoid an f-string assembling an East string constant (a regex, a template, a key); spell the constant out.",
  "- no-derived-struct-fields — avoid declaring a type from another type's fields; a declaration is a wire format, so spell the fields.",
  "- no-python-data-work — avoid a python helper doing the parse / strip / null-check / coerce work for a body; express it in East.",
].join("\n");

/** The cheat-sheet(s) for the detected language(s) — both, for a project that
 * is both. An unknown/empty language list falls back to TypeScript, which is
 * what a project with an `@elaraai/*` dependency and no python is. */
export function eastRulesContextFor(languages: readonly string[]): string {
  const python = languages.includes("python");
  const typescript = languages.includes("typescript") || !python;
  const parts: string[] = [];
  if (typescript) parts.push(EAST_RULES_CONTEXT);
  if (python) parts.push(EAST_RULES_CONTEXT_PY);
  return parts.join("\n\n");
}
