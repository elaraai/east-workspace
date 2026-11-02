# Performance

Part of the `east-py` skill.

## Performance — the levers, ranked

The point of the machinery: **data stays in east-c and python never runs per
element**.

1. **Keep values East end-to-end.** `EastArray`/`EastSet`/`EastDict` are
   C-backed, and every eager method runs its loop natively however deeply the
   element type nests. `list(...)`/`dict(...)` or a python loop pays a boxing
   crossing per element — convert at most once, at the very end.
2. **Let the callbacks build, and chain on the results** — a chain of
   `map`/`filter`/`reduce` stays native between steps. Return a dict literal
   (`lambda b, r: {"a": …, "b": …}`) to derive every column in ONE pass. **Bind
   shared work with `b.const`** — the builder emits exactly what the body
   spells, as TypeScript's does, so a python variable holding an expression is
   re-emitted (and re-evaluated) at every read: `fields = r.data.split("|")`
   read for 30 columns runs the split 30 times per row, and `table =
   derive(rec)` read inside a `.map` runs `derive` once per element. `fields =
   b.const(r.data.split("|"))` and `table = b.const(derive(rec))` run each
   once, as `$.const` does — the `no-reinlined-east-binding` rule (`east-py
   lint`, the LSP) points at every such read. There is no optimisation pass
   (#1312 removed the trace-time CSE: it moved reads across mutations it could
   not see), so what you write is what runs — a callback that pushes onto
   `order` and returns `order.size() - 1` reads the size after its push.
3. **Side tables: `b.const` a captured one, `bind` big ones** — opposite contracts:
   - **Capture (snapshot).** A collection captured by an `East.function` body
     is snapshot into its IR as a literal of its contents — exactly as a
     TypeScript literal is — and rebuilt wherever the body reads it: per call
     at the function's top level, per element inside a callback. **Bind it
     once per call with `t = b.const(TABLE)`** and read `t`. Right for small
     tables (up to a few thousand entries): the literal's size rides the IR,
     every call rebuilds it, and later mutations are **not** seen. Only an
     EXPLICIT build snapshots: an eager callback refuses a mutable capture.
   - **`East.function(...).bind(table)` (by reference, live).** Declare the
     table as a trailing parameter and pre-bind it: zero copy, O(1) at any
     size, nothing rebuilt per call, and the function **sees later
     mutations**. Rebinding gives independent callables, the unbound function
     stays usable, and a wrong-typed value raises `TypeError`.

   ```python
   fx = EastDict(StringType, FloatType, rates)          # small table → capture
   @East.function([Row], FloatType)                     # (the EXPLICIT build
   def to_usd(b, r):                                    #  opts into the snapshot)
       t = b.const(fx)                                  # the literal, once per call
       return r.amount * t.get_or_default(r.ccy, 1.0)

   TableT = DictType(StringType, FloatType)             # huge table → bind
   conv = East.function([Row, TableT], FloatType,
       lambda b, r, t: r.amount * t.get_or_default(r.ccy, 1.0))
   rows.map(conv.bind(big_table))                       # loop + lookup stay in east-c
   conv.bind(t1, t2)  # multi-table: binds the TRAILING parameters in order
   ```

   Function *parameters* always cross by reference (zero copy, any size, any
   depth); `bind` is what lets an eager method use a parameter-taking function
   where the callback signature is fixed.
4. **Hoist `East.function(...)` out of python loops** and reuse it — building
   is cheap, not free.
5. **When logic must stay python, go columnar** — one crossing per column or
   batch instead of per row × field, then back with `from_columns`/`extend`
   ([Columnar escape hatches](columns-and-platform-functions.md#columnar-escape-hatches--when-the-logic-must-stay-python)).
6. **See how a hot call ran** — `east.runtime.compiler.eager_stats()`:
   `function_direct` counts callbacks that rode a precompiled function value
   straight in, `c_to_py_decodes` counts values boxed C→python (an eager method
   quietly decoding a whole collection shows here), and the `beast2_*` counters
   report column projection. There is no per-element python counter because
   there is no per-element python path.
