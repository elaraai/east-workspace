/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Blend` — the assembly surface for blending / batching decisions: pull
 * amounts from many sources into one or more targets ("what proportion of
 * what"). Pairs with a `Library` on the left; one pattern, three render
 * modes by target count — `single` focus, `compare` with the derived diff
 * table, `portfolio` horizontal scroll.
 *
 * @packageDocumentation
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    type TypeOf,
    East,
    Expr,
    variant,
    some,
    none,
    ArrayType,
    type BooleanType,
    FloatType,
    type FunctionType,
    type NullType,
    StringType,
    StructType,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { mapRows } from "../../shared/reify.js";
import { type DragEventType } from "../../contracts/drag.js";
import { PlannerStateType } from "../planner/types.js";
import {
    BlendRootType,
    BlendTargetType,
    BlendAllocationType,
    BlendMetricType,
    BlendActionType,
    BlendAmountEventType,
    BlendActionEventType,
} from "./types.js";

// Re-export types
export {
    BlendRootType,
    BlendTargetType,
    BlendAllocationType,
    BlendMetricType,
    BlendActionType,
    BlendAmountEventType,
    BlendActionEventType,
} from "./types.js";

/**
 * The struct element type of a `SubtypeExprOrValue<ArrayType<StructType>>`.
 */
export type RowElement<T extends SubtypeExprOrValue<ArrayType<StructType>>> =
    TypeOf<T> extends ArrayType<infer S> ? (S extends StructType ? S : never) : never;

// ============================================================================
// Value constructors (expression-level rows)
// ============================================================================

/**
 * Fields accepted by {@link allocation}.
 *
 * @property source - Source identity (a Library item key when paired)
 * @property label - Row label (defaults to the source key)
 * @property sublabel - Optional muted second line (class / site)
 * @property amount - Allocated amount, in the target's unit
 * @property pinned - Held fixed — excluded from drag-out (default false)
 * @property state - The audit state (default committed)
 */
export interface BlendAllocationFields {
    /** Source identity (a Library item key when paired). */
    source: SubtypeExprOrValue<StringType>;
    /** Row label (defaults to the source key). */
    label?: SubtypeExprOrValue<StringType>;
    /** Optional muted second line (class / site). */
    sublabel?: SubtypeExprOrValue<StringType>;
    /** Allocated amount, in the target's unit. */
    amount: SubtypeExprOrValue<FloatType>;
    /** Held fixed — excluded from drag-out (default false). */
    pinned?: SubtypeExprOrValue<BooleanType>;
    /** The audit state (default committed). */
    state?: SubtypeExprOrValue<PlannerStateType>;
}

/**
 * Builds one allocation value — usable inside expressions (e.g. inside a
 * `t.allocations.map(...)` callback).
 *
 * @param fields - Allocation fields ({@link BlendAllocationFields})
 * @returns An East expression of `BlendAllocationType`
 *
 * @example
 * ```ts
 * Blend.allocation({ source: a.sourceId, amount: a.amount, state: a.state })
 * ```
 */
function allocation(fields: BlendAllocationFields): ExprType<BlendAllocationType> {
    return East.value({
        source: fields.source,
        label: fields.label !== undefined ? fields.label : fields.source,
        sublabel: fields.sublabel !== undefined ? some(fields.sublabel) : none,
        amount: fields.amount,
        pinned: fields.pinned !== undefined ? fields.pinned : false,
        state: fields.state !== undefined ? fields.state : variant("committed", null),
    }, BlendAllocationType);
}

/**
 * Fields accepted by {@link metric}.
 *
 * @property key - Metric identity — referenced by the compare `diff` list
 * @property label - Row label (e.g. `cost / unit`)
 * @property value - Display text (host-formatted, e.g. `$3.42`)
 * @property numeric - Optional numeric value — drives the compare Δ column
 * @property model - Optional trust-chip model id (e.g. `cost-v1.4`)
 * @property band - Optional confidence band
 */
export interface BlendMetricFields {
    /** Metric identity — referenced by the compare `diff` list. */
    key: SubtypeExprOrValue<StringType>;
    /** Row label (e.g. `cost / unit`). */
    label: SubtypeExprOrValue<StringType>;
    /** Display text (host-formatted, e.g. `$3.42`). */
    value: SubtypeExprOrValue<StringType>;
    /** Optional numeric value — drives the compare Δ column. */
    numeric?: SubtypeExprOrValue<FloatType>;
    /** Optional trust-chip model id (e.g. `cost-v1.4`). */
    model?: SubtypeExprOrValue<StringType>;
    /** Optional confidence band. */
    band?: { min: SubtypeExprOrValue<FloatType>; max: SubtypeExprOrValue<FloatType> };
}

/**
 * Builds one metric row value — usable inside expressions.
 *
 * @param fields - Metric fields ({@link BlendMetricFields})
 * @returns An East expression of `BlendMetricType`
 *
 * @example
 * ```ts
 * Blend.metric({ key: "cost", label: "cost / unit", value: East.str`$${t.cost}`, numeric: t.cost, model: "cost-v1.4" })
 * ```
 */
function metric(fields: BlendMetricFields): ExprType<BlendMetricType> {
    return East.value({
        key: fields.key,
        label: fields.label,
        value: fields.value,
        numeric: fields.numeric !== undefined ? some(fields.numeric) : none,
        model: fields.model !== undefined ? some(fields.model) : none,
        band: fields.band !== undefined
            ? some(East.value({ min: fields.band.min, max: fields.band.max },
                StructType({ min: FloatType, max: FloatType })))
            : none,
    }, BlendMetricType);
}

// ============================================================================
// Root factory
// ============================================================================

/**
 * Fields the `target` mapper returns — one target panel, before defaults.
 *
 * @property key - Target identity
 * @property label - Panel title
 * @property capacity - Full capacity, in `unit`
 * @property unit - Display unit (default `u`)
 * @property objective - Optional objective line text
 * @property allocations - The allocations (`Blend.allocation(...)` values)
 * @property metrics - Predicted metric rows (`Blend.metric(...)` values)
 */
export interface BlendTargetFields {
    /** Target identity. */
    key: SubtypeExprOrValue<StringType>;
    /** Panel title. */
    label: SubtypeExprOrValue<StringType>;
    /** Full capacity, in `unit`. */
    capacity: SubtypeExprOrValue<FloatType>;
    /** Display unit (default `u`). */
    unit?: SubtypeExprOrValue<StringType>;
    /** Optional objective line text. */
    objective?: SubtypeExprOrValue<StringType>;
    /** The allocations (`Blend.allocation(...)` values). */
    allocations: SubtypeExprOrValue<ArrayType<BlendAllocationType>>;
    /** Predicted metric rows (`Blend.metric(...)` values). */
    metrics?: SubtypeExprOrValue<ArrayType<BlendMetricType>>;
}

/**
 * Configuration for {@link createBlend}.
 *
 * @typeParam R - The target row struct
 * @property id - DnD target identity
 * @property sources - Library ids accepted for `add` drags (omit = no adds)
 * @property target - Target row mapper (omit when rows are already resolved)
 * @property diff - Compare mode: metric keys for the foot table (default all)
 * @property verdict - Optional compare verdict line
 * @property onDrag - Drag funnel — add / remove events
 * @property canDrop - Optional IR-level drop veto over synthesized candidate events
 * @property onAmountChange - Allocation amount edits
 * @property onAction - Panel actions (reset / apply / discard)
 */
export interface BlendConfig<R extends StructType> {
    /** DnD target identity. */
    id: string;
    /** Library ids accepted for `add` drags (omit = no adds). */
    sources?: string[];
    /** Target row mapper; omit when `targets` is already `ArrayType(Blend.Types.Target)`. */
    target?: (target: ExprType<R>) => BlendTargetFields;
    /** Compare mode: metric keys for the foot table (default all). */
    diff?: string[];
    /** Optional compare verdict line. */
    verdict?: SubtypeExprOrValue<StringType>;
    /** Drag funnel — add / remove events. */
    onDrag?: SubtypeExprOrValue<FunctionType<[DragEventType], NullType>>;
    /** Optional IR-level drop veto — consulted per hovered target panel with
     *  the synthesized candidate event (`CanDropFnType` semantics, see
     *  `contracts/drag.ts`); `false` ⇒ the ⊘ invalid stage and the drop is a
     *  no-op. Absent ⇒ accept (the pre-#261 behaviour). */
    canDrop?: SubtypeExprOrValue<FunctionType<[DragEventType], BooleanType>>;
    /** Allocation amount edits. */
    onAmountChange?: SubtypeExprOrValue<FunctionType<[BlendAmountEventType], NullType>>;
    /** Panel actions (reset / apply / discard). */
    onAction?: SubtypeExprOrValue<FunctionType<[BlendActionEventType], NullType>>;
}

function buildRoot(
    targets: SubtypeExprOrValue<ArrayType<StructType>>,
    config: BlendConfig<StructType>,
): ExprType<UIComponentType> {
    const targetMapper = config.target;
    const resolvedTargets = targetMapper === undefined
        ? East.value(targets as SubtypeExprOrValue<ArrayType<BlendTargetType>>, ArrayType(BlendTargetType))
        : mapRows(East.value(targets) as ExprType<ArrayType<StructType>>, BlendTargetType, (row) => {
            const r: BlendTargetFields | ExprType<BlendTargetType> = targetMapper(row);
            if (r instanceof Expr) return East.value(r, BlendTargetType);
            return East.value({
                key: r.key,
                label: r.label,
                capacity: r.capacity,
                unit: r.unit !== undefined ? r.unit : "u",
                objective: r.objective !== undefined ? some(r.objective) : none,
                allocations: r.allocations,
                metrics: r.metrics !== undefined
                    ? r.metrics
                    : East.value([], ArrayType(BlendMetricType)),
            }, BlendTargetType);
        });

    return East.value(variant("Blend", {
        id: config.id,
        sources: East.value(config.sources ?? [], ArrayType(StringType)),
        targets: resolvedTargets,
        diff: East.value(config.diff ?? [], ArrayType(StringType)),
        verdict: config.verdict !== undefined ? some(config.verdict) : none,
        onDrag: config.onDrag !== undefined ? some(config.onDrag) : none,
        canDrop: config.canDrop !== undefined ? some(config.canDrop) : none,
        onAmountChange: config.onAmountChange !== undefined ? some(config.onAmountChange) : none,
        onAction: config.onAction !== undefined ? some(config.onAction) : none,
    }), UIComponentType);
}

/**
 * Creates a Blend — the assembly surface for blending / batching decisions.
 *
 * @typeParam T - The targets-table input
 * @param targets - The target rows (length picks the render mode: 1 single, 2 compare, 3+ portfolio)
 * @param config - The Blend configuration ({@link BlendConfig})
 * @returns An East expression of `UIComponentType`
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Blend, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, _$ =>
 *     Blend.Root(
 *         [{ key: "BLEND-318", name: "Blend 318", cap: 40000.0 }],
 *         {
 *             id: "bench",
 *             sources: ["materials"],
 *             target: t => ({
 *                 key: t.key, label: t.name, capacity: t.cap,
 *                 allocations: [Blend.allocation({ source: "LOT-204", amount: 16000.0 })],
 *             }),
 *         },
 *     ),
 * );
 * ```
 */
function createBlend<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    targets: T,
    config: BlendConfig<RowElement<T>>,
): ExprType<UIComponentType> {
    return buildRoot(targets, config as unknown as BlendConfig<StructType>);
}

// ============================================================================
// Namespace export
// ============================================================================

/**
 * Blend component namespace.
 *
 * @remarks
 * `Blend.Root(targets, config)` builds the surface; `Blend.allocation` /
 * `Blend.metric` build the expression-level row values; allocation states
 * reuse the shared event-state grammar (`Blend.Types.State`).
 */
export const Blend = {
    /**
     * Creates a Blend — the assembly surface for blending / batching
     * decisions, with the drag & drop target role (`add` / `remove`).
     *
     * @typeParam T - The targets-table input
     * @param targets - The target rows (1 = single, 2 = compare, 3+ = portfolio)
     * @param config - The Blend configuration ({@link BlendConfig})
     * @returns An East expression of `UIComponentType`
     *
     * @remarks
     * The compare diff table and Δ column are derived by the renderer from
     * the two targets' metrics (`numeric` field) — the host doesn't compute
     * the comparison. Optimisation is precalculated upstream — proposals
     * arrive in the data; the component never triggers computation.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Blend, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, _$ =>
     *     Blend.Root(
     *         [{ key: "BLEND-318", name: "Blend 318", cap: 40000.0 }],
     *         {
     *             id: "bench",
     *             target: t => ({
     *                 key: t.key, label: t.name, capacity: t.cap,
     *                 allocations: [Blend.allocation({ source: "LOT-204", amount: 16000.0 })],
     *             }),
     *         },
     *     ),
     * );
     * ```
     */
    Root: createBlend,
    /**
     * Builds one allocation value — usable inside expressions.
     *
     * @param fields - Allocation fields ({@link BlendAllocationFields})
     * @returns An East expression of `BlendAllocationType`
     *
     * @example
     * ```ts
     * Blend.allocation({ source: a.sourceId, amount: a.amount, pinned: a.pinned, state: a.state })
     * ```
     */
    allocation,
    /**
     * Builds one metric row value — usable inside expressions.
     *
     * @param fields - Metric fields ({@link BlendMetricFields})
     * @returns An East expression of `BlendMetricType`
     *
     * @example
     * ```ts
     * Blend.metric({ key: "grade", label: "predicted grade", value: t.grade, model: "blend-v2.1" })
     * ```
     */
    metric,
    Types: {
        /**
         * East StructType for the Blend component.
         *
         * @remarks
         * See {@link BlendRootType} for per-field docs.
         *
         * @property id - DnD target identity
         * @property sources - Library ids accepted for `add`
         * @property targets - The target panels
         * @property diff - Compare-mode metric keys
         * @property verdict - Optional compare verdict line
         * @property onDrag - Drag funnel
         * @property onAmountChange - Amount edits
         * @property onAction - Panel actions
         */
        Blend: BlendRootType,
        /**
         * One blend target panel.
         *
         * @property key - Target identity
         * @property label - Panel title
         * @property capacity - Full capacity
         * @property unit - Display unit
         * @property objective - Optional objective line
         * @property allocations - The source allocations
         * @property metrics - Predicted metric rows
         */
        Target: BlendTargetType,
        /**
         * One source allocation.
         *
         * @property source - Source identity
         * @property label - Row label
         * @property sublabel - Optional muted second line
         * @property amount - Allocated amount
         * @property pinned - Excluded from optimise / drag-out
         * @property state - The audit state
         */
        Allocation: BlendAllocationType,
        /**
         * A predicted metric row.
         *
         * @property key - Metric identity
         * @property label - Row label
         * @property value - Display text
         * @property numeric - Optional numeric value (compare Δ)
         * @property model - Optional trust-chip model id
         * @property band - Optional confidence band
         */
        Metric: BlendMetricType,
        /**
         * A target-panel action (`reset` / `apply` / `discard`).
         *
         * @property reset - Revert proposed changes
         * @property apply - Commit the blend
         * @property discard - Drop a compare candidate
         */
        Action: BlendActionType,
        /**
         * The `onAmountChange` payload.
         *
         * @property target - Target key
         * @property source - Allocation source key
         * @property amount - The edited amount
         */
        AmountEvent: BlendAmountEventType,
        /**
         * The `onAction` payload.
         *
         * @property target - The target key, or `none` for surface-wide actions
         * @property action - Which action fired
         */
        ActionEvent: BlendActionEventType,
        /**
         * The shared event-state grammar (committed / proposed / rejected).
         *
         * @property committed - A committed allocation
         * @property proposed - A proposal (`added` / `model` / `removed`)
         * @property rejected - A rejected proposal
         */
        State: PlannerStateType,
    },
} as const;
