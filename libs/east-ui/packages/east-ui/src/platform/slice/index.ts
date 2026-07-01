/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Slice platform — shared narrowing state for the `Slice.*` UI family.
 *
 * # Two platforms, one model
 *
 *   - `Slice.bind<T>(key, config)`      — stateful. Browser-local reactive
 *                                          state + structured mutators.
 *                                          Implemented by the host (React
 *                                          renderer).
 *   - `Slice.apply.matches<T>(...)`     — pure narrowing engine. Given a
 *     `Slice.apply.where<T>(...)`        slice state, the schema (config),
 *     `Slice.apply.breakdownKey<T>(...)` and a row / array, returns the
 *                                          filtered result. Pure JS, no
 *                                          React; the default impl lives
 *                                          in `slice-impl.ts` next to this
 *                                          file.
 *
 * # Typed narrowing
 *
 * A slice is generic over `T` (the row type of the dataset being narrowed).
 * The config declares **fields** — typed accessors `T → V` for each
 * dimension the user can filter, search, break by, or restrict via Range.
 * Predicates reference fields by id; the op carries a typed value matching
 * the field's type.
 *
 *     // Schema
 *     fields:  { sessions: { string: { label, accessor } }, count: { integer: ... } }
 *
 *     // A predicate: typed comparison
 *     { fieldId: "count", op: variant("integerGte", 10n) }   // not `value: "10"`
 *
 * The apply engine validates `fieldId` against the config's fields dict
 * and dispatches the op variant against the field's typed accessor. Op
 * variants whose payload type doesn't match the field's type are
 * configuration errors — well-built UIs only construct well-formed
 * predicates.
 *
 * # Range
 *
 * Range is a `SliceDateTimeRange` — preset variants (`today / last7d /
 * last30d / last90d / ytd`) plus a `custom: DateTimeRange` variant.
 * Presets re-resolve to absolute dates relative to "now" at apply time;
 * `custom` pins absolute dates. Range applies via `config.timeFieldId`,
 * which names the datetime field on `T` to compare against.
 *
 * # Search and breakdown
 *
 * Both reference fields by id from the config:
 *
 *   - `config.searchFieldIds: ArrayType(StringType)` — fields to text-search across
 *   - `config.breakdownFieldIds: ArrayType(StringType)` — fields available as breakdowns
 *
 * `Slice.apply.breakdownKey(state, config, row)` returns the active
 * breakdown's stringified key for `row`, or `none` when no breakdown is
 * active. Series visibility (`state.visible`) filters this set.
 *
 * @packageDocumentation
 */

import {
    East,
    StringType,
    NullType,
    BooleanType,
    IntegerType,
    FloatType,
    DateTimeType,
    StructType,
    VariantType,
    ArrayType,
    SetType,
    DictType,
    OptionType,
    FunctionType,
    variant,
    some,
    none,
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
} from "@elaraai/east";

import { ChartXType } from "../../charts/spec/types.js";
import { SliceAffordanceType } from "../../contracts/slice-affordances.js";

// ============================================================================
// DateTimeRange — generic { from, to } interval
// (Could move to Foundation later; keeping here for now so Slice is self-contained.)
// ============================================================================

/**
 * Absolute datetime interval — `from` inclusive, `to` inclusive.
 */
export const DateTimeRangeType = StructType({
    from: DateTimeType,
    to:   DateTimeType,
});
export type DateTimeRangeType = typeof DateTimeRangeType;

// ============================================================================
// Slice Range — generic ranged narrowing over datetime / integer / float
// ============================================================================

/** Closed integer range. */
export const IntegerRangeType = StructType({
    from: IntegerType,
    to:   IntegerType,
});
export type IntegerRangeType = typeof IntegerRangeType;

/** Closed float range. */
export const FloatRangeType = StructType({
    from: FloatType,
    to:   FloatType,
});
export type FloatRangeType = typeof FloatRangeType;

/**
 * Datetime preset — re-resolves to absolute dates relative to "now" at
 * apply time. Paired with `SliceRangeType` variant `datetimePreset`.
 *
 *   - `today`   - midnight today → now
 *   - `last7d`  - rolling 7-day window
 *   - `last30d` - rolling 30-day window
 *   - `last90d` - rolling 90-day window
 *   - `ytd`     - calendar year-to-date
 */
export const DateTimePresetType = VariantType({
    today:   NullType,
    last7d:  NullType,
    last30d: NullType,
    last90d: NullType,
    ytd:     NullType,
});
export type DateTimePresetType = typeof DateTimePresetType;

/**
 * Active range narrowing. Tag-discriminated by the value type of the
 * ranged dimension; the apply engine validates that the referenced
 * `config.rangeFieldId` field has a matching type.
 *
 * Renderer dispatches on the tag:
 *   - `datetime`       → calendar picker (pinned dates)
 *   - `datetimePreset` → preset chips (re-resolves at apply time)
 *   - `integer` / `float` → numeric range slider
 */
export const SliceRangeType = VariantType({
    datetime:       DateTimeRangeType,
    datetimePreset: DateTimePresetType,
    integer:        IntegerRangeType,
    float:          FloatRangeType,
});
export type SliceRangeType = typeof SliceRangeType;

/**
 * Comparison period for `Slice.Range`'s "compare with" row. A presentation
 * concern — the host resolves the comparison window from the active range
 * plus this offset; the apply engine is unaffected.
 *
 *   - `previousPeriod` - the window immediately preceding the active range
 *   - `previousYear`   - the same calendar window one year earlier
 */
export const SliceCompareType = VariantType({
    previousPeriod: NullType,
    previousYear:   NullType,
});
export type SliceCompareType = typeof SliceCompareType;

// ============================================================================
// FieldSpec<T> — describes one dimension on T (typed accessor + label)
// ============================================================================

/**
 * One declared dimension on the row type `T`. Tag distinguishes the
 * field's value type; payload carries the human label and an East
 * accessor function `T → V`.
 *
 * The module-scope value uses the `"T"` placeholder string so it can be
 * embedded directly in the `slice_bind` generic-platform declaration.
 * Consumer code never touches this — `Slice.config({...})` builds the
 * concrete value internally.
 */
const SliceFieldSpecType = VariantType({
    string:   StructType({ label: StringType, accessor: FunctionType(["T"], StringType) }),
    integer:  StructType({ label: StringType, accessor: FunctionType(["T"], IntegerType) }),
    float:    StructType({ label: StringType, accessor: FunctionType(["T"], FloatType) }),
    datetime: StructType({ label: StringType, accessor: FunctionType(["T"], DateTimeType) }),
    boolean:  StructType({ label: StringType, accessor: FunctionType(["T"], BooleanType) }),
});

// Internal: materialise a concrete `SliceFieldSpec` East type for the
// given row type. Only the `Slice.config` factory uses this; consumers
// don't need a hand on it.
function sliceFieldSpecFor<T>(rowType: T) {
    return VariantType({
        string:   StructType({ label: StringType, accessor: FunctionType([rowType], StringType) }),
        integer:  StructType({ label: StringType, accessor: FunctionType([rowType], IntegerType) }),
        float:    StructType({ label: StringType, accessor: FunctionType([rowType], FloatType) }),
        datetime: StructType({ label: StringType, accessor: FunctionType([rowType], DateTimeType) }),
        boolean:  StructType({ label: StringType, accessor: FunctionType([rowType], BooleanType) }),
    });
}

// ============================================================================
// SliceConfig<T> — the slice's schema of available dimensions
// ============================================================================

/**
 * Schema configuration for a slice. Declares every dimension on `T` that
 * the user can filter, search, break by, or restrict via Range.
 *
 * The module-scope value uses the `"T"` placeholder for use inside the
 * `slice_bind` generic-platform declaration. Consumer code never touches
 * this — `Slice.config({...})` materialises a concrete instance per row
 * type internally.
 *
 * @property fields            - Dict of declared dimensions keyed by `fieldId`
 * @property rangeFieldId      - Optional id of the field `Slice.Range` narrows on.
 *                                Must reference a datetime / integer / float field.
 *                                Renderer dispatches the right control based on the
 *                                field's type.
 * @property searchFieldIds    - Fields the typeahead search applies to
 * @property breakdownFieldIds - Fields available as breakdown dimensions
 */
/**
 * Materialise the concrete `SliceConfig` East type for a row type — for
 * payloads that carry a slice config across an encoding boundary (e.g. a
 * `DecisionQueue`'s queue-owned slice). The module-scope `SliceConfigType`
 * keeps the `"T"` placeholder for the `slice_bind` declaration.
 */
export function sliceConfigTypeFor<T extends EastType>(rowType: T) {
    return StructType({
        fields:            DictType(StringType, sliceFieldSpecFor(rowType)),
        rangeFieldId:      OptionType(StringType),
        searchFieldIds:    ArrayType(StringType),
        breakdownFieldIds: ArrayType(StringType),
        fieldHints:        DictType(StringType, ArrayType(StringType)),
    });
}

export const SliceConfigType = StructType({
    fields:            DictType(StringType, SliceFieldSpecType),
    rangeFieldId:      OptionType(StringType),
    searchFieldIds:    ArrayType(StringType),
    breakdownFieldIds: ArrayType(StringType),
    fieldHints:        DictType(StringType, ArrayType(StringType)),
});

// Internal: materialise a concrete `SliceConfig` East type for the given
// row type. Used by the `Slice.config` JS factory and the `slice_bind`
// platform's runtime type-check.
function sliceConfigFor<T>(rowType: T) {
    return StructType({
        fields:            DictType(StringType, sliceFieldSpecFor(rowType)),
        rangeFieldId:      OptionType(StringType),
        searchFieldIds:    ArrayType(StringType),
        breakdownFieldIds: ArrayType(StringType),
        fieldHints:        DictType(StringType, ArrayType(StringType)),
    });
}

// Map from a primitive East type's runtime tag to the SliceFieldSpec
// variant tag. Anything outside this table is rejected by the factory.
const FIELD_KIND_BY_TYPE_TAG: Record<string, "string" | "integer" | "float" | "datetime" | "boolean"> = {
    String:   "string",
    Integer:  "integer",
    Float:    "float",
    DateTime: "datetime",
    Boolean:  "boolean",
};

/**
 * One field declaration in `Slice.config`. Only the label is required —
 * the accessor is auto-derived as `r => r[fieldId]` and the field's kind
 * (string / integer / float / datetime / boolean) is inferred from the
 * row's struct field type.
 *
 * @property label - Human-readable label shown in filter / breakdown UI
 * @property hints - Optional candidate values surfaced as autocomplete in the filter's `in` / `notIn` / `eq` / `neq` controls
 */
export interface SliceFieldUserConfig {
    label: string;
    hints?: ReadonlyArray<string>;
}

/**
 * Plain TS config for `Slice.config`. The row type is passed as the first
 * positional argument; this interface carries the field declarations and
 * the optional range / search / breakdown field ids. `Fields` is inferred
 * from the `fields` literal; the optional id-list fields are narrowed to
 * keys of that literal via `NoInfer` so they cannot widen the inferred
 * field set.
 *
 * @typeParam Fields - Map of field id to declaration (inferred from `fields`)
 *
 * @property fields            - Declared dimensions, keyed by field id
 * @property rangeFieldId      - Optional field id `Slice.Range` narrows on; must reference a datetime / integer / float field
 * @property searchFieldIds    - Field ids the typeahead applies to
 * @property breakdownFieldIds - Field ids available as breakdown dimensions
 */
export interface SliceUserConfig<
    Fields extends Record<string, SliceFieldUserConfig>,
> {
    fields: Fields;
    rangeFieldId?:      NoInfer<Extract<keyof Fields, string>>;
    searchFieldIds?:    ReadonlyArray<NoInfer<Extract<keyof Fields, string>>>;
    breakdownFieldIds?: ReadonlyArray<NoInfer<Extract<keyof Fields, string>>>;
}

/**
 * Build a typed `SliceConfig` East value from a plain JS declaration.
 *
 * The factory inspects each `rowType` field, dispatches to the right
 * `SliceFieldSpec` variant tag (string / integer / float / datetime /
 * boolean), wraps `r => r[fieldId]` as a typed East accessor, and emits a
 * `SliceConfig` East value sized to the row.
 *
 * ```ts
 * const cfg = $.let(Slice.config(UserEventType, {
 *     fields: {
 *         timestamp: { label: "Time"     },
 *         country:   { label: "Country"  },
 *         sessions:  { label: "Sessions" },
 *     },
 *     rangeFieldId:      "timestamp",
 *     searchFieldIds:    ["country"],
 *     breakdownFieldIds: ["country"],
 * }));
 *
 * const slice = $.let(Slice.bind([UserEventType], "demo.events", cfg, Slice.state()));
 * const filtered = $.let(Slice.apply.where([UserEventType], slice.read(), cfg, events));
 * ```
 *
 * @typeParam RowType - The row's East StructType (passed positionally)
 * @param rowType     - The East row type the slice will narrow
 * @param userConfig  - Field declarations + optional range/search/breakdown ids
 * @returns East SliceConfig value sized to `RowType`
 */
function createSliceConfig<
    RowType extends EastType,
    Fields extends Record<string, SliceFieldUserConfig>,
>(
    rowType: RowType,
    userConfig: SliceUserConfig<Fields>,
) {
    // Inspect the row's struct fields. East StructType values shape:
    //   { type: "Struct", fields: { fieldName: <EastType>, ... } }
    const rowFields = (rowType as unknown as { fields?: Record<string, EastType> }).fields ?? {};
    const fieldEntries: Array<[string, unknown]> = [];
    // Explicit per-field autocomplete hints for the filter `in`/`notIn`/`eq`/`neq`
    // controls (#131); omitted ⇒ no entry.
    const fieldHints = new Map<string, string[]>();
    for (const [fieldId, fieldConfig] of Object.entries(userConfig.fields) as Array<[string, SliceFieldUserConfig]>) {
        const fieldType = rowFields[fieldId];
        if (!fieldType) {
            throw new Error(`Slice.config: field "${fieldId}" not declared on rowType`);
        }
        const kind = FIELD_KIND_BY_TYPE_TAG[(fieldType as { type: string }).type];
        if (!kind) {
            throw new Error(`Slice.config: field "${fieldId}" has type "${(fieldType as { type: string }).type}", which is not supported (need String / Integer / Float / DateTime / Boolean)`);
        }
        // Auto-derive accessor `r => r[fieldId]`. East struct field access
        // works via property syntax on the typed expression.
        const accessor = East.function(
            [rowType] as [RowType],
            fieldType,
            (_$, row) => (row as unknown as Record<string, ExprType<EastType>>)[fieldId] as never,
        );
        fieldEntries.push([fieldId, variant(kind, { label: fieldConfig.label, accessor })]);
        if (fieldConfig.hints !== undefined) fieldHints.set(fieldId, [...fieldConfig.hints]);
    }
    // Default `searchFieldIds` to every string field when not given, so the
    // search affordance works out of the box (#129). Explicit ids still win.
    const stringFieldIds = fieldEntries
        .filter(([, spec]) => (spec as { type: string }).type === "string")
        .map(([id]) => id);
    return East.value({
        fields: new Map(fieldEntries) as unknown as Map<string, never>,
        rangeFieldId:      userConfig.rangeFieldId !== undefined ? some(userConfig.rangeFieldId) : none,
        searchFieldIds:    userConfig.searchFieldIds !== undefined ? [...userConfig.searchFieldIds] : stringFieldIds,
        breakdownFieldIds: [...(userConfig.breakdownFieldIds ?? [])],
        fieldHints:        fieldHints as unknown as Map<string, never>,
    }, sliceConfigFor(rowType));
}

// ============================================================================
// SliceState constructor — `Slice.state({...})` with `SubtypeExprOrValue`
// fields. All fields are optional; omitted ones default to the slice's
// "no narrowing active" state.
// ============================================================================

// Forward declarations — the actual *Type values are declared further down
// (predicates, cohorts, breakdown, state). The TS interface below references
// them as types only, so the forward use compiles.
//
// `SliceStateOptions` is the public entry point — see `createSliceState`.

/**
 * Optional fields for `Slice.state`. Each field carries either a plain
 * JS value (e.g. `[]`, `new Set()`, `some(...)`) or an East expression.
 * Omitted fields fall back to the slice's "no narrowing active" defaults:
 * empty arrays / sets, `none` for every option.
 *
 * @property range          - Active range narrowing (`some(variant(...))`) or `none`
 * @property filters        - AND-chain of typed predicates
 * @property cohorts        - Registered cohort definitions
 * @property activeCohorts  - Set of cohort ids whose filters are currently applied
 * @property breakdown      - Active group-by dimension (`some({fieldId, limit})`) or `none`
 * @property search         - Typeahead query (`some(query)`) or `none`
 * @property visible        - Legend visibility whitelist (`some(set)`) or `none`
 * @property selectedIndex  - Master-detail selection (`some(index)`) or `none`
 */
export interface SliceStateOptions {
    range?:         SubtypeExprOrValue<OptionType<SliceRangeType>>;
    compare?:       SubtypeExprOrValue<OptionType<SliceCompareType>>;
    filters?:       SubtypeExprOrValue<ArrayType<SlicePredicateType>>;
    cohorts?:       SubtypeExprOrValue<ArrayType<SliceCohortType>>;
    activeCohorts?: SubtypeExprOrValue<SetType<StringType>>;
    breakdown?:     SubtypeExprOrValue<OptionType<SliceBreakdownType>>;
    search?:        SubtypeExprOrValue<OptionType<StringType>>;
    visible?:       SubtypeExprOrValue<OptionType<SetType<StringType>>>;
    selectedIndex?: SubtypeExprOrValue<OptionType<IntegerType>>;
}

/**
 * Build a typed `SliceState` East value from a partial JS declaration.
 * Every field is optional; omitted fields fall back to defaults
 * (`none` for options, `[]` for arrays, `new Set()` for sets).
 *
 * ```ts
 * // Empty slice — all defaults
 * const s = $.const(Slice.state());
 *
 * // Slice with one filter, search query set, defaults for everything else
 * const s2 = $.const(Slice.state({
 *     filters: [variant("integer", { fieldId: "sessions", op: variant("gte", 10n) })],
 *     search:  some("query"),
 * }));
 * ```
 *
 * @param opts - Partial state options
 * @returns East `SliceState` value with defaults filled in
 */
function createSliceState(opts: SliceStateOptions = {}) {
    return East.value({
        range:         opts.range         ?? none,
        compare:       opts.compare       ?? none,
        filters:       opts.filters       ?? [],
        cohorts:       opts.cohorts       ?? [],
        activeCohorts: opts.activeCohorts ?? new Set<string>(),
        breakdown:     opts.breakdown     ?? none,
        search:        opts.search        ?? none,
        visible:       opts.visible       ?? none,
        selectedIndex: opts.selectedIndex ?? none,
    }, SliceStateType);
}

// ============================================================================
// SlicePredicate — nested by type family
//
// Outer variant tag = field's value-type family. Inner variant = the
// operator under that family, carrying the typed comparison value.
// Two-level nesting is the right shape: each typed-predicate variant
// pairs `fieldId` with its op variant, and the op variant can only carry
// values of its family's type. Mismatch is impossible by construction.
// ============================================================================

/**
 * Operators for string-typed dimensions.
 *
 * @property eq         - exact equality
 * @property neq        - exact inequality
 * @property in         - membership in a value set
 * @property notIn      - non-membership in a value set
 * @property contains   - substring match
 * @property matches    - regular-expression match (an invalid pattern narrows to nothing)
 * @property startsWith - prefix match
 * @property endsWith   - suffix match
 * @property isEmpty    - empty or whitespace-only value (carries no comparison value)
 * @property isNotEmpty - non-whitespace content present (carries no comparison value)
 */
export const SliceStringOpType = VariantType({
    eq:         StringType,
    neq:        StringType,
    in:         SetType(StringType),
    notIn:      SetType(StringType),
    contains:   StringType,
    matches:    StringType,
    startsWith: StringType,
    endsWith:   StringType,
    isEmpty:    NullType,
    isNotEmpty: NullType,
});
export type SliceStringOpType = typeof SliceStringOpType;

/** Operators for integer-typed dimensions. */
export const SliceIntegerOpType = VariantType({
    eq:  IntegerType,
    neq: IntegerType,
    lt:  IntegerType,
    lte: IntegerType,
    gt:  IntegerType,
    gte: IntegerType,
    in:  SetType(IntegerType),
});
export type SliceIntegerOpType = typeof SliceIntegerOpType;

/** Operators for float-typed dimensions. */
export const SliceFloatOpType = VariantType({
    lt:  FloatType,
    lte: FloatType,
    gt:  FloatType,
    gte: FloatType,
});
export type SliceFloatOpType = typeof SliceFloatOpType;

/** Operators for datetime-typed dimensions. */
export const SliceDateTimeOpType = VariantType({
    before:  DateTimeType,
    after:   DateTimeType,
    between: DateTimeRangeType,
});
export type SliceDateTimeOpType = typeof SliceDateTimeOpType;

/** Operator for boolean-typed dimensions. */
export const SliceBooleanOpType = VariantType({
    is: BooleanType,
});
export type SliceBooleanOpType = typeof SliceBooleanOpType;

/**
 * One filter clause. The outer variant tag is the field's type family;
 * the inner struct carries `fieldId` + a typed op variant.
 *
 * Construction:
 *
 *     variant("integer", { fieldId: "sessions", op: variant("gte", 10n) })
 *     variant("string",  { fieldId: "country",  op: variant("eq",  "US") })
 *
 * @property string   - String-typed predicate
 * @property integer  - Integer-typed predicate
 * @property float    - Float-typed predicate
 * @property datetime - DateTime-typed predicate
 * @property boolean  - Boolean-typed predicate
 */
export const SlicePredicateType = VariantType({
    string:   StructType({ fieldId: StringType, op: SliceStringOpType }),
    integer:  StructType({ fieldId: StringType, op: SliceIntegerOpType }),
    float:    StructType({ fieldId: StringType, op: SliceFloatOpType }),
    datetime: StructType({ fieldId: StringType, op: SliceDateTimeOpType }),
    boolean:  StructType({ fieldId: StringType, op: SliceBooleanOpType }),
});
export type SlicePredicateType = typeof SlicePredicateType;

// ============================================================================
// Cohort — named bundle of predicates
// ============================================================================

/**
 * Saved cohort definition. Inline in the slice; not shared across slices.
 *
 * @property id      - Unique-within-slice id; referenced by `activeCohorts`
 * @property name    - Human-readable label rendered in the cohort chip
 * @property filters - AND-ed predicates; row matches the cohort when every clause holds
 */
export const SliceCohortType = StructType({
    id:      StringType,
    name:    StringType,
    filters: ArrayType(SlicePredicateType),
});
export type SliceCohortType = typeof SliceCohortType;

// ============================================================================
// Breakdown — fieldId + optional top-N
// ============================================================================

/**
 * Group-by configuration.
 *
 * @property fieldId - References a key in `SliceConfig<T>.fields`
 *                     (must also appear in `breakdownFieldIds`)
 * @property limit   - Optional top-N cut; values beyond N collapse into "other"
 */
export const SliceBreakdownType = StructType({
    fieldId: StringType,
    limit:   OptionType(IntegerType),
});
export type SliceBreakdownType = typeof SliceBreakdownType;

// ============================================================================
// SliceState — the shared struct the binding manages
// (Note: NOT generic over T. Predicates reference fields by id, which is
//  resolved against the bind's config at apply time.)
// ============================================================================

/**
 * The full state of a slice. State is plain data — no embedded accessors,
 * no `T` type parameter — so it round-trips cleanly through `East.diff` /
 * `applyPatch` and serialises trivially.
 *
 * @property range          - Optional ranged narrowing (datetime / integer / float); `none` = no range active
 * @property filters        - AND-ed filter clauses
 * @property cohorts        - Inline registry of saved cohorts
 * @property activeCohorts  - Cohort ids currently applied
 * @property breakdown      - Optional group-by dimension
 * @property search         - Optional typeahead text query
 * @property visible        - Visible-series whitelist for `Slice.Legend`; none = all visible
 * @property selectedIndex  - Master-detail selection driven by `Slice.Layout`
 */
export const SliceStateType = StructType({
    range:         OptionType(SliceRangeType),
    compare:       OptionType(SliceCompareType),
    filters:       ArrayType(SlicePredicateType),
    cohorts:       ArrayType(SliceCohortType),
    activeCohorts: SetType(StringType),
    breakdown:     OptionType(SliceBreakdownType),
    search:        OptionType(StringType),
    visible:       OptionType(SetType(StringType)),
    selectedIndex: OptionType(IntegerType),
});
export type SliceStateType = typeof SliceStateType;

// ============================================================================
// Config-derived metadata — `slice.dimensions()` / `slice.fields()` returns
// ============================================================================

/**
 * One selectable breakdown dimension — `fieldId` + display `label`, derived
 * from `config.breakdownFieldIds` + the field labels.
 *
 * @property fieldId - Field id (key into `config.fields`)
 * @property label   - Human label
 */
export const SliceDimensionType = StructType({
    fieldId: StringType,
    label:   StringType,
});
export type SliceDimensionType = typeof SliceDimensionType;

/** Array of {@link SliceDimensionType}. */
export const SliceDimensionArrayType = ArrayType(SliceDimensionType);
export type SliceDimensionArrayType = typeof SliceDimensionArrayType;

/**
 * One filterable field — `fieldId` + display `label` + primitive `kind`,
 * derived from `config.fields`. Drives the built-in predicate builder in
 * `Slice.Filter` / `Slice.Cohort`: the `kind` selects the operator set and
 * value input.
 *
 * @property fieldId - Field id (key into `config.fields`)
 * @property label   - Human label
 * @property kind    - Primitive kind: `string` / `integer` / `float` / `datetime` / `boolean`
 * @property hints   - Explicit autocomplete candidate values (from `Slice.config`); empty when none
 */
export const SliceFieldDescriptorType = StructType({
    fieldId: StringType,
    label:   StringType,
    kind:    StringType,
    hints:   ArrayType(StringType),
});
export type SliceFieldDescriptorType = typeof SliceFieldDescriptorType;

/** Array of {@link SliceFieldDescriptorType}. */
export const SliceFieldDescriptorArrayType = ArrayType(SliceFieldDescriptorType);
export type SliceFieldDescriptorArrayType = typeof SliceFieldDescriptorArrayType;

/**
 * One typeahead suggestion for `Slice.Search` — the projection of a matched row
 * to `{ id, label, meta }`. Produced by the bind's `matches()` closure via the
 * `toMatch` projection supplied at `Slice.bind`. Defined here (not in
 * `slice/search`) so `SliceBindType` can reference it without a circular import.
 *
 * @property id    - Stable identifier, committed via `slice.setSearch`
 * @property label - Primary label
 * @property meta  - Optional trailing meta (e.g. "last seen 09-12")
 */
export const SliceSearchMatchType = StructType({
    id:    StringType,
    label: StringType,
    meta:  OptionType(StringType),
});
export type SliceSearchMatchType = typeof SliceSearchMatchType;

/** Array of {@link SliceSearchMatchType}. */
export const SliceSearchMatchArrayType = ArrayType(SliceSearchMatchType);
export type SliceSearchMatchArrayType = typeof SliceSearchMatchArrayType;

/**
 * One computed breakdown group — a stringified key + its row count. The
 * engine produces these from the narrowed data; `Slice.Breakdown` / `Slice.Legend`
 * render them (assigning swatch colours by position).
 *
 * @property key   - Stringified breakdown value (matches `state.visible` membership)
 * @property count - Number of narrowed rows in this group
 */
/**
 * One breakdown group over the bound rows.
 *
 * @property key   - Stringified breakdown value (matches `state.visible` membership)
 * @property count - Number of narrowed rows in this group
 * @property color - Series colour assigned by the slice (group order → palette), so a
 *   chart drawing this group and a `Slice.Legend` labelling it share one colour source
 */
export const SliceBreakdownGroupType = StructType({
    key:   StringType,
    count: IntegerType,
    color: StringType,
});
export type SliceBreakdownGroupType = typeof SliceBreakdownGroupType;

/** Array of {@link SliceBreakdownGroupType}. */
export const SliceBreakdownGroupArrayType = ArrayType(SliceBreakdownGroupType);
export type SliceBreakdownGroupArrayType = typeof SliceBreakdownGroupArrayType;

/**
 * One point of a pivoted series — a typed x position and its aggregated value.
 *
 * @remarks
 * The x coordinate is the chart's {@link ChartXType} (band category / linear
 * number / time date), so the pivot feeds `Chart.Spec.series` directly and the
 * renderer derives the scale from the coordinate.
 *
 * @property x     - The point's typed x coordinate
 * @property value - Aggregated (summed) numeric value at this `x`
 * @property size  - Mirrors {@link ChartPointType} so the pivot feeds
 *                   `Chart.Spec.series` directly; always `none` (slice series
 *                   carry no per-point bubble magnitude)
 * @property color - Mirrors {@link ChartPointType}'s per-point colour; always
 *                   `none` (slice series colour their points at the series level)
 */
export const SliceSeriesPointType = StructType({
    x:     ChartXType,
    value: FloatType,
    size:  OptionType(FloatType),
    color: OptionType(StringType),
});
export type SliceSeriesPointType = typeof SliceSeriesPointType;

/**
 * One pivoted, coloured series, produced by `slice.series(...)`. The narrowed
 * data is grouped by the active breakdown dimension into one series per value,
 * each carrying the slice-assigned `color` (the same source the legend reads) and
 * its `points` in data order — chart-ready multi-series, no reshaping needed.
 *
 * @property key    - Stringified breakdown value (the series identity)
 * @property color  - Slice-assigned series colour (matches the legend swatch)
 * @property points - The series' points along the x-axis, in data order
 */
export const SliceSeriesType = StructType({
    key:    StringType,
    color:  StringType,
    points: ArrayType(SliceSeriesPointType),
});
export type SliceSeriesType = typeof SliceSeriesType;

/** Array of {@link SliceSeriesType}. */
export const SliceSeriesArrayType = ArrayType(SliceSeriesType);
export type SliceSeriesArrayType = typeof SliceSeriesArrayType;

/**
 * Render density for a `Slice.*` affordance. `compact` = the one-row eyebrow
 * form used inside a chrome rail; `focused` = the standalone configuration
 * surface. Components default to `focused` standalone and `compact` when the
 * surrounding rail sets the density.
 */
export const SliceDensityType = VariantType({
    compact: NullType,
    focused: NullType,
});
export type SliceDensityType = typeof SliceDensityType;

// ============================================================================
// slice_bind — stateful platform
// ============================================================================

/**
 * Bind to a named slice. Returns a closure struct UI components plug into.
 *
 * The platform itself manages state; the apply engine (below) is a
 * separate set of pure platform calls.
 *
 * First bind for a key seeds the store with the caller-supplied initial
 * `SliceState` (built with `Slice.state({...})`); subsequent binds reuse
 * the existing state.
 */
/**
 * The closure struct `Slice.bind` returns — `read`/`write` plus structured
 * mutators. Every signature uses the non-generic `Slice*Type`s, so this struct
 * is itself non-generic and can be embedded directly in `UIComponentType`
 * variants. The `Slice.*` UI components carry one of these and the renderer
 * wires controls to its mutators.
 */
export const SliceBindType = StructType({
        // --- raw read / write ---
        /** The store key this slice is bound to — lets renderers self-subscribe. */
        key:   StringType,
        /** Read the entire slice state; tracked for reactive re-render. */
        read:  FunctionType([], SliceStateType),
        /** Replace the entire slice state. Rare — prefer the structured mutators. */
        write: FunctionType([SliceStateType], NullType),

        // --- range ---
        /** Set or clear the ranged narrowing. `none` clears; `some(range)` activates. */
        setRange: FunctionType([OptionType(SliceRangeType)], NullType),
        /** Set or clear the comparison period. `none` clears. */
        setCompare: FunctionType([OptionType(SliceCompareType)], NullType),

        // --- filters ---
        /** Append a new filter clause to the AND chain. */
        addFilter:    FunctionType([SlicePredicateType], NullType),
        /** Remove the filter at the given index. */
        removeFilter: FunctionType([IntegerType], NullType),
        /** Clear every applied filter (and active cohorts). */
        clearFilters: FunctionType([], NullType),

        // --- cohorts ---
        /** Register a new cohort definition. Errors if id already exists. */
        defineCohort: FunctionType([SliceCohortType], NullType),
        /** Replace the cohort with the given id in place (keeps active state). */
        updateCohort: FunctionType([StringType, SliceCohortType], NullType),
        /** Drop a cohort from the registry (and from active cohorts). */
        removeCohort: FunctionType([StringType], NullType),
        /** Flip whether the cohort with this id is being applied. */
        toggleCohort: FunctionType([StringType], NullType),

        // --- breakdown ---
        /** Set or clear the group-by dimension. `none` = no breakdown. */
        setBreakdown: FunctionType([OptionType(SliceBreakdownType)], NullType),

        // --- search ---
        /** Set the typeahead query. `none` clears; `some("query")` activates it. */
        setSearch: FunctionType([OptionType(StringType)], NullType),

        // --- legend / visibility ---
        /** Set the visible-series whitelist. `none` = all series visible. */
        setVisible: FunctionType([OptionType(SetType(StringType))], NullType),

        // --- layout / selection ---
        /** Set the master-detail selection index. `none` = no selection. */
        select: FunctionType([OptionType(IntegerType)], NullType),

        // --- derived ---
        /** True when at least one narrowing is active. */
        isActive: FunctionType([], BooleanType),
        /** Count of currently-applied narrowings — used by `Slice.Summary`. */
        activeCount: FunctionType([], IntegerType),

        // --- config-derived metadata (no data needed) ---
        /** Selectable breakdown dimensions for this slice's config → `[{ fieldId, label }]`. */
        dimensions: FunctionType([], SliceDimensionArrayType),
        /** Every filterable field → `[{ fieldId, label, kind }]`; feeds the predicate builder. */
        fields: FunctionType([], SliceFieldDescriptorArrayType),
        /** Field ids the typeahead searches over — the chrome rail shows Search when non-empty. */
        searchFieldIds: FunctionType([], ArrayType(StringType)),
        /** Field id `Slice.Range` narrows on — the chrome rail shows Range when `some`. */
        rangeFieldId: FunctionType([], OptionType(StringType)),

        // --- data-derived results (computed over the collection bound at `Slice.bind`) ---
        /** Total bound rows, before any narrowing — used by the chrome footer ("N of M"). */
        totalCount: FunctionType([], IntegerType),
        /** Count of bound rows passing every active narrowing — used by Filter / Summary. */
        resultCount: FunctionType([], IntegerType),
        /** Active-breakdown series over the bound rows → `[{ key, count }]` — Breakdown / Legend. */
        groups: FunctionType([], SliceBreakdownGroupArrayType),
        /**
         * Pivot the narrowed rows into chart-ready multi-series long format:
         * grouped by the active breakdown dimension (`key`) and the given x-axis
         * field, summing the value field → `[{ key, x, value }]`. Feed a
         * multi-series chart by filtering per (statically-known) series key.
         * @param xFieldId     - field whose value positions each point on the x-axis
         * @param valueFieldId - numeric field summed into each point's `value`
         */
        series: FunctionType([StringType, StringType], SliceSeriesArrayType),
        /** Typeahead suggestions for the current query (via the bind `toMatch`) → `[{ id, label, meta }]`. */
        matches: FunctionType([], SliceSearchMatchArrayType),
        /** Size of each cohort over the bound rows, keyed by cohort id — Cohort chips. */
        cohortCounts: FunctionType([], DictType(StringType, IntegerType)),

        // --- cross-filtering (#165 — appended last: wire-order compatibility) ---
        /**
         * Idempotent filter toggle: appends the predicate when no
         * structurally-equal clause is applied, removes the structurally-equal
         * one when it is. Backs the "filter to this" gestures (Legend /
         * Breakdown click-to-filter), so the same gesture narrows and
         * un-narrows every view sharing this slice key.
         */
        toggleFilter: FunctionType([SlicePredicateType], NullType),
});
export type SliceBindType = typeof SliceBindType;

// ============================================================================
// slice_* primitives — low-level host I/O backing a Slice.bind handle's methods
// (issue #106)
//
// The `Slice.bind` handle is a struct of ~27 closures. For it to serialize, each
// closure must be an IR-bearing `East.function` rather than a raw host closure —
// so a captured handle (e.g. `onClick={() => slice.setSearch(some(q))}`) encodes
// through beast2 and `decodeBeast2For({ platform })` re-binds it to the decoder's
// store + bound-rows registry. The handle methods are thin `East.function`s over
// these primitives, capturing only the plain-data store key.
//
// Every primitive is NON-generic (`East.platform`): keys, slice state, and all
// outputs are concrete types — the row type `T` never appears (the data-derived
// primitives resolve the bound rows from a host registry keyed by `key`, so they
// don't carry `T`). Only `slice_bind` / `slice_rows` stay generic over `T`.
// Implemented by `SliceImpl` in `@elaraai/east-ui-components`.
// ----------------------------------------------------------------------------

// --- raw read / write ---
const slice_read          = East.platform("slice_read",          [StringType], SliceStateType, { optional: true });
const slice_write         = East.platform("slice_write",         [StringType, SliceStateType], NullType, { optional: true });
// --- range ---
const slice_set_range     = East.platform("slice_set_range",     [StringType, OptionType(SliceRangeType)], NullType, { optional: true });
const slice_set_compare   = East.platform("slice_set_compare",   [StringType, OptionType(SliceCompareType)], NullType, { optional: true });
// --- filters ---
const slice_add_filter    = East.platform("slice_add_filter",    [StringType, SlicePredicateType], NullType, { optional: true });
const slice_remove_filter = East.platform("slice_remove_filter", [StringType, IntegerType], NullType, { optional: true });
const slice_clear_filters = East.platform("slice_clear_filters", [StringType], NullType, { optional: true });
const slice_toggle_filter = East.platform("slice_toggle_filter", [StringType, SlicePredicateType], NullType, { optional: true });
// --- cohorts ---
const slice_define_cohort = East.platform("slice_define_cohort", [StringType, SliceCohortType], NullType, { optional: true });
const slice_update_cohort = East.platform("slice_update_cohort", [StringType, StringType, SliceCohortType], NullType, { optional: true });
const slice_remove_cohort = East.platform("slice_remove_cohort", [StringType, StringType], NullType, { optional: true });
const slice_toggle_cohort = East.platform("slice_toggle_cohort", [StringType, StringType], NullType, { optional: true });
// --- breakdown / search / visible / selection ---
const slice_set_breakdown = East.platform("slice_set_breakdown", [StringType, OptionType(SliceBreakdownType)], NullType, { optional: true });
const slice_set_search    = East.platform("slice_set_search",    [StringType, OptionType(StringType)], NullType, { optional: true });
const slice_set_visible   = East.platform("slice_set_visible",   [StringType, OptionType(SetType(StringType))], NullType, { optional: true });
const slice_select        = East.platform("slice_select",        [StringType, OptionType(IntegerType)], NullType, { optional: true });
// --- derived ---
const slice_is_active     = East.platform("slice_is_active",     [StringType], BooleanType, { optional: true });
const slice_active_count  = East.platform("slice_active_count",  [StringType], IntegerType, { optional: true });
// --- config-derived metadata ---
const slice_dimensions    = East.platform("slice_dimensions",    [StringType], SliceDimensionArrayType, { optional: true });
const slice_fields_meta   = East.platform("slice_fields_meta",   [StringType], SliceFieldDescriptorArrayType, { optional: true });
const slice_search_fields = East.platform("slice_search_fields", [StringType], ArrayType(StringType), { optional: true });
const slice_range_field   = East.platform("slice_range_field",   [StringType], OptionType(StringType), { optional: true });
// --- data-derived results (over the rows bound at Slice.bind) ---
const slice_total_count   = East.platform("slice_total_count",   [StringType], IntegerType, { optional: true });
const slice_result_count  = East.platform("slice_result_count",  [StringType], IntegerType, { optional: true });
const slice_groups        = East.platform("slice_groups",        [StringType], SliceBreakdownGroupArrayType, { optional: true });
const slice_series_data   = East.platform("slice_series_data",   [StringType, StringType, StringType], SliceSeriesArrayType, { optional: true });
const slice_matches       = East.platform("slice_matches",       [StringType], SliceSearchMatchArrayType, { optional: true });
const slice_cohort_counts = East.platform("slice_cohort_counts", [StringType], DictType(StringType, IntegerType), { optional: true });

/**
 * Low-level platform primitives that back {@link Slice.bind}'s handle methods.
 *
 * @internal Not for direct use — author against {@link Slice.bind}. These exist
 * so each handle method can be an IR-bearing `East.function` (serializable)
 * rather than a raw host closure. Keyed entirely by the slice's store key; the
 * data-derived primitives resolve the bound rows / config / `toMatch` from a host
 * registry that `Slice.bind` refreshes on every bind.
 */
export const SliceBindPrimitives = {
    read: slice_read,
    write: slice_write,
    setRange: slice_set_range,
    setCompare: slice_set_compare,
    addFilter: slice_add_filter,
    removeFilter: slice_remove_filter,
    clearFilters: slice_clear_filters,
    toggleFilter: slice_toggle_filter,
    defineCohort: slice_define_cohort,
    updateCohort: slice_update_cohort,
    removeCohort: slice_remove_cohort,
    toggleCohort: slice_toggle_cohort,
    setBreakdown: slice_set_breakdown,
    setSearch: slice_set_search,
    setVisible: slice_set_visible,
    select: slice_select,
    isActive: slice_is_active,
    activeCount: slice_active_count,
    dimensions: slice_dimensions,
    fields: slice_fields_meta,
    searchFieldIds: slice_search_fields,
    rangeFieldId: slice_range_field,
    totalCount: slice_total_count,
    resultCount: slice_result_count,
    groups: slice_groups,
    series: slice_series_data,
    matches: slice_matches,
    cohortCounts: slice_cohort_counts,
} as const;

const slice_bind = East.genericPlatform("slice_bind", ["T"],
    [StringType, SliceConfigType, SliceStateType, ArrayType("T"), OptionType(FunctionType(["T"], SliceSearchMatchType))],
    SliceBindType,
    { optional: true },
);

/**
 * The narrowed rows for a bound slice — every row bound at `Slice.bind`
 * that passes the active narrowing. The explicit, typed data feed for
 * consumers: `rows={Slice.rows([EventType], slice)}`. A component's `slice`
 * chrome option never narrows data itself.
 */
const slice_rows = East.genericPlatform("slice_rows", ["T"],
    [SliceBindType],
    ArrayType("T"),
    { optional: true },
);

/**
 * The slice-chrome payload every slice-accepting component carries — the
 * bound handle plus the affordances its rail mounts. Chrome only: the
 * component's data is always fed explicitly (`Slice.rows([RowType], slice)`).
 */
export const SliceChromeType = StructType({
    slice: SliceBindType,
    affordances: ArrayType(SliceAffordanceType),
});
/** Type alias for {@link SliceChromeType}. */
export type SliceChromeType = typeof SliceChromeType;

// ============================================================================
// slice_apply_* — pure narrowing engine (no state, no React)
//
// Three platform calls, each generic over T. The default JS impl lives in
// `./slice-impl.ts` next to this file — pure data-in / data-out, suitable
// for registration in any host (React renderer, server-side, tests).
// ============================================================================

/**
 * Predicate for one row.
 *
 * @returns true when every active narrowing in `state` matches `row`
 *   under the dimensions declared in `config`.
 */
const slice_apply_matches = East.genericPlatform("slice_apply_matches", ["T"],
    [SliceStateType, SliceConfigType, "T"],
    BooleanType,
    { optional: true },
);

/**
 * Filter an array. Equivalent to `data.filter(row => Slice.apply.matches(state, config, row))`
 * but the impl may apply ordering optimisations (e.g. range index, search
 * trigram pre-pass).
 */
const slice_apply_where = East.genericPlatform("slice_apply_where", ["T"],
    [SliceStateType, SliceConfigType, ArrayType("T")],
    ArrayType("T"),
    { optional: true },
);

/**
 * Resolve the active breakdown's key for a row.
 *
 * @returns the stringified value of `config.fields[state.breakdown.fieldId]`
 *   applied to `row`, or `none` when no breakdown is active.
 */
const slice_apply_breakdown_key = East.genericPlatform("slice_apply_breakdown_key", ["T"],
    [SliceStateType, SliceConfigType, "T"],
    OptionType(StringType),
    { optional: true },
);


/**
 * Group the narrowed data by the active breakdown dimension. Rows are first
 * filtered through every active narrowing (as `where`), then bucketed by the
 * breakdown field's stringified value and counted, sorted descending. When
 * `state.breakdown.limit` is set, groups beyond the top-N collapse into a
 * single `"other"` bucket. Returns `[]` when no breakdown is active.
 */
const slice_apply_breakdown = East.genericPlatform("slice_apply_breakdown", ["T"],
    [SliceStateType, SliceConfigType, ArrayType("T")],
    SliceBreakdownGroupArrayType,
    { optional: true },
);

// ============================================================================
// Public namespace
// ============================================================================

/**
 * Slice platform — typed narrowing state for the `Slice.*` UI family.
 *
 * @example
 * ```ts
 * import { East, ArrayType, StringType, IntegerType, NullType, variant, some, none } from "@elaraai/east";
 * import { Reactive, Slice, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * // 1. Declare the row type
 * const UserEventType = StructType({
 *     timestamp: DateTimeType,
 *     country:   StringType,
 *     sessions:  IntegerType,
 * });
 *
 * const view = East.function([], UIComponentType, (_$) => {
 *     return Reactive.Root(East.function([], UIComponentType, $ => {
 *         // 2. Bind with a config declaring available dimensions
 *         const slice = $.let(Slice.bind("view.events", East.value({
 *             fields: new Map([
 *                 ["timestamp", variant("datetime", { label: "Time",     accessor: East.function([UserEventType], DateTimeType, ($, r) => r.timestamp) })],
 *                 ["country",   variant("string",   { label: "Country",  accessor: East.function([UserEventType], StringType,   ($, r) => r.country)   })],
 *                 ["sessions",  variant("integer",  { label: "Sessions", accessor: East.function([UserEventType], IntegerType,  ($, r) => r.sessions)  })],
 *             ]),
 *             timeFieldId:       some("timestamp"),
 *             searchFieldIds:    ["country"],
 *             breakdownFieldIds: ["country"],
 *         })));
 *
 *         // 3. Add a TYPED filter — `integerGte` carries an IntegerType, not a parsed string
 *         $(slice.addFilter(East.value({
 *             fieldId: "sessions",
 *             op:      variant("integerGte", 10n),
 *         }, Slice.Types.Predicate)));
 *
 *         // 4. Apply: pure narrowing engine
 *         //    const filtered = $.let(Slice.apply.where(slice.read(), config, events));
 *
 *         const state = $.let(slice.read(), Slice.Types.State);
 *         return Text.Root(East.str`${state.filters.length()} active filters`);
 *     }));
 * });
 * ```
 */
export const Slice = {
    /**
     * Bind a slice to a named key. Returns a closure struct UI components
     * plug into and downstream consumers read.
     *
     * The third argument is the initial `SliceState` — built ergonomically
     * with `Slice.state({...})` (omitted fields default to "no narrowing
     * active"). First bind for a key seeds the store with it; subsequent
     * binds return a fresh closure struct over the existing state and ignore
     * the initial value. `read()` tracks the dependency so `Reactive.Root`
     * re-renders on change.
     *
     * @example
     * ```ts
     * // Empty slice — all defaults
     * const slice = $.let(Slice.bind([EventType], "view.events", cfg, Slice.state({})));
     *
     * // Seeded — a preset range and an active cohort on first bind
     * const seeded = $.let(Slice.bind([EventType], "view.seeded", cfg, Slice.state({
     *     range:         some(variant("datetimePreset", variant("last30d", null))),
     *     cohorts:       [{ id: "power", name: "Power users", filters: [] }],
     *     activeCohorts: new Set(["power"]),
     * })));
     * ```
     */
    bind: slice_bind,

    /** Narrowed rows for a bound slice — the typed data feed (`Slice.rows([RowType], slice)`). */
    rows: slice_rows,

    /**
     * Pure narrowing engine. State + config + data → narrowed data.
     * Stateless, deterministic, host-impl-portable.
     */
    apply: {
        /** Row-level predicate: does this row pass every active narrowing? */
        matches: slice_apply_matches,
        /** Array filter: returns the subset of `data` that passes. */
        where:   slice_apply_where,
        /** Active breakdown key for a row, if any. */
        breakdownKey: slice_apply_breakdown_key,
        /** Group the narrowed data by the active breakdown → `[{ key, count }]`. */
        breakdown: slice_apply_breakdown,
    },

    /**
     * East types — re-exported on the namespace for ergonomic access.
     *
     * `FieldSpec(T)` and `Config(T)` are factories that materialise concrete
     * East types from a given row type, suitable for `$.const` / `$.let`
     * type annotations in consumer code.
     */
    Types: {
        DateTimeRange:  DateTimeRangeType,
        IntegerRange:   IntegerRangeType,
        FloatRange:     FloatRangeType,
        DateTimePreset: DateTimePresetType,
        Range:          SliceRangeType,
        Compare:        SliceCompareType,
        StringOp:       SliceStringOpType,
        IntegerOp:      SliceIntegerOpType,
        FloatOp:        SliceFloatOpType,
        DateTimeOp:     SliceDateTimeOpType,
        BooleanOp:      SliceBooleanOpType,
        Predicate:      SlicePredicateType,
        Cohort:         SliceCohortType,
        Breakdown:      SliceBreakdownType,
        State:          SliceStateType,
        Bind:           SliceBindType,
        BreakdownGroup: SliceBreakdownGroupType,
        SeriesPoint:    SliceSeriesPointType,
        Series:         SliceSeriesType,
        Dimension:      SliceDimensionType,
        Field:          SliceFieldDescriptorType,
        SearchMatch:    SliceSearchMatchType,
        Density:        SliceDensityType,
    },

    /**
     * Build an East `SliceConfig` value from a plain JS declaration.
     * Hides the variant / accessor / Map construction the platform needs.
     */
    config: createSliceConfig,

    /**
     * Build an East `SliceState` value from a partial JS declaration. All
     * fields are optional; omitted fields fall back to "no narrowing
     * active" defaults.
     */
    state: createSliceState,
} as const;
