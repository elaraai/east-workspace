# Experiment component — design

A causal-experiment surface as a **registered e3-ui component** (architecturally
like `Ontology`). The developer wires an input dataset + estimator functions; the
**end user** re-frames the experiment from the dataset's columns and re-runs it.
This doc is the contract to build against; nothing here is implemented yet.

---

## 0. Principles (locked)

1. **Visual-first, derived — never authored.** The result side is composed by the
   renderer from numbers + the user's chosen column names. No tone / bar-width /
   label / sentence is stored in data.
2. **Data-driven & generic over the input row**, exactly like `Table`: the
   component introspects the bound dataset's row struct to drive the
   treatment / outcome / confounder pickers.
3. **The user adjusts → results go stale → Run re-computes.** Editing the spec
   marks the displayed result stale; **Run** calls the bound functions; the result
   arrives reactively. **Commit** appends to the journal.
4. **`e3-ui` never imports `east-py-datascience`.** The causal compute lives in the
   developer's `e3.function` bodies, reached over `Func.bind`.
5. **Closed choices are variants, column refs are strings, presentation is
   derived** (the string-vs-variant rule).

---

## 1. Change to `east-py-datascience` — generic platform over the row struct

Today: `causal_effect(Matrix<Float>, CausalEffectConfig)` — positional floats + a
parallel `config.columns`. Every caller must encode `Array<Struct>` → matrix
(project columns, 0/1 booleans, one-hot categoricals). There is **no good place to
do that in East**, so it's the wrong layer.

**New:** make the Causal platform functions **generic over the row struct `T`** and
take the **typed table** directly. The DataFrame is built inside Python (one line),
where categorical handling is native and DoWhy/EconML want a frame anyway.

```ts
// east-py-datascience/src/causal/causal.ts
export const causal_effect = East.asyncGenericPlatform(
    "causal_effect",
    ["T"],                                              // T = the row struct type
    (T) => [ArrayType(T), CausalEffectConfigType],      // typed table + config
    (_T) => CausalEffectResultType,
);
// .implement((T) => async (records, config) => { df = pd.DataFrame(records); … DoWhy … })

export const causal_refute = East.asyncGenericPlatform("causal_refute", ["T"],
    (T) => [ArrayType(T), CausalEffectConfigType, CausalRefuterType], (_T) => CausalRefuteResultType);

export const causal_ale = East.asyncGenericPlatform("causal_ale", ["T"],
    (T) => [ArrayType(T), CausalALEConfigType], (_T) => ALEResultType);
```

**Config change:** `columns` drops out of `CausalEffectConfigType` / `CausalALEConfigType`
(the struct fields *are* the columns). `treatment` / `outcome` / `common_causes` /
`categorical` reference field names. Everything else (the `method` / `target_units`
/ `trim` / `bootstrap` variants, the result types) is **unchanged**.

**Python impl change** (`causal_impl.py`): receive a list of records (EastStruct →
dict) instead of a Matrix; `df = pd.DataFrame(records)`; select/encode by column
name. The DoWhy/EconML logic is untouched. The `_impl` functions become generic
(receive `T` + records).

**DX result:** the developer's body is `Causal.effect(data, toConfig(spec))` — no
encoding, no matrix. The component passes the bound `data` straight through.

---

## 2. Types — Framing B (`e3-ui` owns the render contract)

The developer's bound function returns an **`e3-ui`-owned contract** whose fields
*are* the causal quantities (plus the two additions a sign-flip surface needs:
`naive` and `balance`). `e3-ui` never imports causal config/result types; the
developer's ~10-line body bridges spec↔config and result↔contract.

These live in **`e3-ui/src/experiment/types.ts`**, reachable via `Experiment.Types.*`
(not public named exports). Where a shape overlaps the library (e.g. `Ci`, the ALE
vectors) it is **structurally identical**, so it unifies by shape — repeated in both
packages, no shared package.

```ts
// e3-ui/src/experiment/types.ts

// ── the user's Advanced choices (closed → variants; mirror the causal vocabulary) ──
const EstimatorType   = Variant({ linear_regression, propensity_score_weighting: { weighting_scheme: Option(WeightingScheme) } });
const TargetUnitsType = Variant({ ate, att, atc });
const TrimType        = Variant({ overlap, bounds: { lower: Float, upper: Float } });

// ── the experiment the user framed (column refs = strings) ──
const ExperimentSpecType = Struct({
  treatment:   String,                       // chosen column
  outcome:     String,                       // chosen column
  confounders: Array(String),                // the backdoor set
  categorical: Array(String),                // which confounders are categorical
  population:  Option(PredicateType),        // Slice predicate (optional narrowing)
  method:      Option(EstimatorType),        // variant
  targetUnits: Option(TargetUnitsType),      // variant
  trim:        Option(TrimType),             // variant
});

const Ci = Struct({ lower: Float, upper: Float });

// ── what `estimate` returns: causal quantities, packaged for the surface ──
const ExperimentResultType = Struct({
  effect: Float, ci: Option(Ci),                            // = CausalEffectResult
  naive:  Float, naiveCi: Option(Ci),                       // unadjusted (for the sign-flip)
  nTotal: Int, nTreated: Int, nControl: Int, nDropped: Int, // sample accounting
  balance: Array(Struct({ column: String, treatedMean: Float, controlMean: Float, stdDiff: Float })),
});

// ── what `refute` returns: the kind + the real refuter numbers ──
const RefuteKindType = Variant({ placebo, random_common_cause, data_subset, unobserved });
const RefuteResultType = Struct({
  checks: Array(Struct({ kind: RefuteKindType, estimatedEffect: Float, newEffects: Vector(Float), pValue: Option(Float) })),
});

// ── what `dose` returns: the ALE curve (= ALEResult) + optional per-segment CATE ──
const DoseResultType = Struct({
  feature: String,
  grid: Vector(Float), effect: Vector(Float), lower: Option(Vector(Float)), upper: Option(Vector(Float)), size: Vector(Int),
  segments: Option(Array(Struct({ label: String, grid: Vector(Float), effect: Vector(Float), lower: Option(Vector(Float)), upper: Option(Vector(Float)) }))),
});

const JournalRowType = Struct({ spec: ExperimentSpecType, effect: Float, ci: Option(Ci), committedAt: DateTime, committedBy: String });
const ColumnMetaType = Dict(String, Struct({ label: Option(String), unit: Option(String), higherIsBetter: Option(Boolean) }));
```

Everything the old types stored as presentation (`tone`, `frac`, `level`, `display`,
`*Kind`, `xTicks`, `tradeoff`, `marginal`, `dataLabel`) is **gone** — derived in the
renderer (§5).

---

## 3. The function contract (what the developer provides)

Three bound functions, generic over the row `T`. Bodies call the (now generic)
Causal functions:

```ts
// developer package — the only east-py-datascience import
estimate: e3.function('estimate',
  East.asyncFunction([ArrayType(Row), ExperimentSpecType], ExperimentResultType, ($, data, spec) => {
     const cfg  = specToConfig(spec, /*common_causes*/ spec.confounders);   // → CausalEffectConfig (no columns)
     const adj  = Causal.effect(data, cfg);                                  // generic: Array<Row>
     const nai  = Causal.effect(data, { …cfg, common_causes: [] });          // naive
     return assemble(adj, nai, balanceOf(data, spec));                       // pack ExperimentResult
  }));
refute: e3.function('refute', … runs the refuter battery → RefuteResult …);
dose:   e3.function('dose',   … Causal.ale(data, aleConfig)   → DoseResult …);
```

In the **example/showcase** these bodies are pure-East fixtures returning constants
(no Python); a matching JS impl is seeded in `snapshot/main.tsx` so the snapshot can
execute them (§6).

---

## 4. The component interface (generic, like `Table`)

```ts
Experiment.Root<Row extends StructType>({
  data:     BoundValue<ArrayType<Row>>,      // input dataset — columns + passed to fns
  spec:     BoundValue<ExperimentSpecType>,  // staged — the pickers write this
  estimate: FuncBind<[ArrayType<Row>, ExperimentSpecType], ExperimentResultType>,
  refute?:  FuncBind<…, RefuteResultType>,
  dose?:    FuncBind<…, DoseResultType>,
  journal?: BoundValue<ArrayType<JournalRowType>>,
  columnMeta?, readonly?, defaultTab?,
}) → UIComponentType
```

The payload carries `DiffBindingType` (data, spec, journal) + `FuncBindingType`
(estimate, refute, dose). Authoring-time, `treatment`/`outcome` defaults are
`keyof Row` (Table's `DataFieldKeys<T>` pattern). At runtime the renderer recovers
the field list from `getBindingTypes(...).sourceType` (Array→Struct→`[{name,type}]`).

---

## 5. Interaction model (the renderer)

1. **Introspect** the bound `data` row type → `[{name, type}]`. Filter candidates:
   treatment = Boolean/Integer; outcome = Float/Integer; confounder = any primitive.
2. **Pickers** (set-up rail) read the current `spec` and `write` it staged on change
   (the MANDATORY `useState`+`useEffect`+`queueMicrotask` pattern). Editing any
   picker marks the result **stale**.
3. **Run** (enabled when treatment+outcome set; pulsing when stale): imperatively
   `estimate.call(data, spec)` (+ `refute`, `dose`) via `defaultFuncRuntime` —
   subscribe to the func channel with `useSyncExternalStore`; spinner while
   `pending()`; on settle read `estimate.read()`.
4. **Derive** all presentation from the result (§ derivations below) and paint the
   exact current visual (header, forest, balance, tabs, dose, journal).
5. **Commit**: append `{ spec, effect, ci, committedAt, committedBy }` to `journal`
   (staged write + commit), and commit the `spec`.
6. **First mount / empty**: auto-run once when there is no result and the spec is
   valid, so the surface loads populated (also what makes the static snapshot show
   the full mock). Subsequent edits require an explicit Run.

### Derivations (renderer, from numbers only)
- `status` = `lo>0 → HIGHER` / `hi<0 → LOWER` / else `NO CLEAR EFFECT` → colour.
- `flip` = `sign(naive) ≠ sign(effect)` → the amber "raw & like-for-like disagree"
  banner, templated over `treatment`/`outcome`/`naive` + the top-`|stdDiff|` balance row.
- balance bar width = normalised `|stdDiff|`; tone + "large gap"/"some"/"small" = `|stdDiff|` thresholds; `"6.1 vs 8.0"` = `format(treatedMean, controlMean)`.
- forest = `[Raw(naive, naiveCi), Like-for-like(effect, ci)]`; axis ticks from extents.
- dose: recommended point = where lower-CI first clears 0 / marginal gain flattens; marginal bars = `diff(effect)`; trade-off sentence = template; markers from grid.
- refute check name/description/pass = `kind` variant + `newEffects`/`pValue` (placebo→≈0; subset→stable; unobserved→tipping strength).
- `columnMeta.higherIsBetter` upgrades "lower"→"worse" in the derived words.

---

## 6. Examples + showcase

### 6a. `east-py-datascience` causal example (the source of truth for the numbers)

Add a `causal.examples.ts` scene that **replicates the e3-ui scenario with hardcoded
inputs** and calls the *real* (now generic, `Array<Struct>`) Causal functions:

```ts
// a hardcoded Array<Struct> dataset with confounding by indication:
// slow_cure is applied preferentially to low incoming_grade rows, so the raw
// difference in bond_strength is negative while the adjusted effect is positive.
const batches = [ { slow_cure: 1.0, bond_strength: …, incoming_grade: …, … }, … ];
const cfg = { treatment: 'slow_cure', outcome: 'bond_strength',
              common_causes: ['incoming_grade', 'mix_viscosity', 'supplier'], … };  // no `columns`
const adjusted = Causal.effect(batches, cfg);                 // generic over the row struct
const naive    = Causal.effect(batches, { …cfg, common_causes: [] });
// assert naive.effect < 0 < adjusted.effect  (the sign flip, against the real DoWhy impl)
```

This (a) **validates the generic `Array<Struct>` interface end-to-end against the real
Python impl**, and (b) gives the realistic numbers the e3-ui fixture mirrors, so the
component's mock and the library agree.

### 6b. e3-ui showcase example

`e3-ui/test/experiment/experiment.examples.tsx`:
- An input dataset `e3.input('batches', ArrayType(BatchRow), [...])` — the slow-cure
  batches (treatment `slow_cure`, outcome `bond_strength`, `incoming_grade`, …).
- `e3.function` fixtures `estimate`/`refute`/`dose` returning the contract constants
  (pure East — no Python).
- A `spec` input with the initial framing.
- Renders `<Experiment data spec estimate refute dose journal />`.

Showcase reality (verified): the snapshot **never clicks**, so to show populated the
component **auto-runs on first mount** (an eager `call` while `status()==='idle'`),
and the example's three functions must be **seeded in `e3-ui-components/snapshot/main.tsx`**
(`createInMemoryFunctionApi([...])`) with matching `name`/`inputTypes`/`outputType`
and a JS `fn` returning the same fixtures (import the fixtures from the example so
the two copies can't drift). Dataset columns render from the seeded `data` default.

---

## 7. File layout

```
east-py-datascience/src/causal/causal.ts          # generic platform fns; drop `columns`
east-py-datascience/.../causal_impl.py             # records → DataFrame; generic _impl
e3-ui/src/experiment/types.ts                      # the contract (§2)
e3-ui/src/experiment/index.ts (or experiment.ts)   # EastUI.component carrier + Experiment.Root<Row>
e3-ui/src/runtime/experiment.ts                    # the <Experiment> tag (generic)
e3-ui-components/src/experiment/index.tsx           # renderer: introspect + edit + run + derive
e3-ui-components/src/experiment/charts.tsx          # forest + area-range (keep)
e3-ui-components/src/experiment/run-runtime.ts      # imperative estimate/refute/dose via defaultFuncRuntime
e3-ui/test/experiment/experiment.examples.tsx       # input dataset + fixture fns + scene
e3-ui/test/experiment/experiment.spec.ts            # Assert.examples + shape tests
e3-ui-components/snapshot/main.tsx                   # seed the 3 fixture fn impls
```

---

## 8. Implementation order

1. **Causal generic change** (east-py-datascience): TS signatures + `columns` drop +
   Python `_impl` records→DataFrame. Add the §6a confounding example + spec assertion
   (proves the new interface against the real DoWhy impl and pins the numbers).
   Verify the existing causal tests still pass (updated to the new shape).
2. **`experiment/types.ts`** (e3-ui): the §2 contract. Build clean.
3. **Factory + tag**: generic `Experiment.Root<Row>` + payload + `<Experiment>` tag.
4. **Renderer**: column introspection + interactive pickers (write spec) + Run
   orchestration (`defaultFuncRuntime`) + stale + commit + derivations. Reuse the
   existing visual shell + charts.
5. **Example + seeding + spec test**; snapshot; verify it matches the mock **and**
   the buttons work (probe a click).

Open question to confirm before step 1: are we OK changing the **deployed** Causal
signatures (`Matrix→Array<Struct>`, drop `columns`) — i.e. updating the existing
`causal.examples.ts` + `causal.spec.ts` to the new shape — or should the generic
`Array<Struct>` variants be **added alongside** the matrix ones (non-breaking)?
