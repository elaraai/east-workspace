/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    ArrayType,
    BooleanType,
    FloatType,
    FunctionType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

import { PlannerStateType } from "../planner/types.js";
import { DragEventType } from "../../contracts/drag.js";

/**
 * A predicted metric row on a target panel.
 *
 * @property key - Metric identity — referenced by the compare `diff` list
 * @property label - Row label (e.g. `cost / unit`)
 * @property value - Display text (host-formatted, e.g. `$3.42`)
 * @property numeric - Optional numeric value — drives the compare Δ column
 * @property model - Optional trust-chip model id (e.g. `cost-v1.4`)
 * @property band - Optional confidence band
 */
export const BlendMetricType = StructType({
    /** Metric identity — referenced by the compare `diff` list */
    key: StringType,
    /** Row label (e.g. `cost / unit`) */
    label: StringType,
    /** Display text (host-formatted, e.g. `$3.42`) */
    value: StringType,
    /** Optional numeric value — drives the compare Δ column */
    numeric: OptionType(FloatType),
    /** Optional trust-chip model id (e.g. `cost-v1.4`) */
    model: OptionType(StringType),
    /** Optional confidence band */
    band: OptionType(StructType({
        /** Band minimum */
        min: FloatType,
        /** Band maximum */
        max: FloatType,
    })),
});

/**
 * Type representing blend metrics.
 */
export type BlendMetricType = typeof BlendMetricType;

/**
 * One source allocation in a target.
 *
 * @property source - Source identity (a Library item key when paired)
 * @property label - Row label (defaults to the source key)
 * @property sublabel - Optional muted second line (class / site)
 * @property amount - Allocated amount, in the target's unit
 * @property pinned - Excluded from optimise and from drag-out
 * @property state - The audit state (committed / proposed)
 */
export const BlendAllocationType = StructType({
    /** Source identity (a Library item key when paired) */
    source: StringType,
    /** Row label (defaults to the source key) */
    label: StringType,
    /** Optional muted second line (class / site) */
    sublabel: OptionType(StringType),
    /** Allocated amount, in the target's unit */
    amount: FloatType,
    /** Held fixed — excluded from drag-out and from recalculated proposals */
    pinned: BooleanType,
    /** The audit state (committed / proposed) */
    state: PlannerStateType,
});

/**
 * Type representing blend allocations.
 */
export type BlendAllocationType = typeof BlendAllocationType;

/**
 * One blend target panel.
 *
 * @property key - Target identity (drag-grammar row; action events carry it)
 * @property label - Panel title (e.g. `BLEND-318a`)
 * @property capacity - Full capacity, in `unit`
 * @property unit - Display unit (e.g. `u`, `kL`, `t`)
 * @property objective - Optional objective line text
 * @property allocations - The source allocations
 * @property metrics - Predicted metric rows
 */
export const BlendTargetType = StructType({
    /** Target identity (drag-grammar row; action events carry it) */
    key: StringType,
    /** Panel title (e.g. `BLEND-318a`) */
    label: StringType,
    /** Full capacity, in `unit` */
    capacity: FloatType,
    /** Display unit (e.g. `u`, `kL`, `t`) */
    unit: StringType,
    /** Optional objective line text */
    objective: OptionType(StringType),
    /** The source allocations */
    allocations: ArrayType(BlendAllocationType),
    /** Predicted metric rows */
    metrics: ArrayType(BlendMetricType),
});

/**
 * Type representing blend targets.
 */
export type BlendTargetType = typeof BlendTargetType;

/**
 * A target-panel action.
 *
 * @property reset - Revert proposed changes
 * @property apply - Commit the blend
 * @property discard - Drop a compare candidate
 */
export const BlendActionType = VariantType({
    /** Revert proposed changes */
    reset: NullType,
    /** Commit the blend */
    apply: NullType,
    /** Drop a compare candidate */
    discard: NullType,
});

/**
 * Type representing blend actions.
 */
export type BlendActionType = typeof BlendActionType;

/**
 * The `onAmountChange` payload.
 *
 * @property target - Target key
 * @property source - Allocation source key
 * @property amount - The edited amount
 */
export const BlendAmountEventType = StructType({
    /** Target key */
    target: StringType,
    /** Allocation source key */
    source: StringType,
    /** The edited amount */
    amount: FloatType,
});

/**
 * Type representing amount-edit events.
 */
export type BlendAmountEventType = typeof BlendAmountEventType;

/**
 * The `onAction` payload.
 *
 * @property target - The target key, or `none` for surface-wide actions
 * @property action - Which action fired
 */
export const BlendActionEventType = StructType({
    /** The target key, or `none` for surface-wide actions */
    target: OptionType(StringType),
    /** Which action fired */
    action: BlendActionType,
});

/**
 * Type representing action events.
 */
export type BlendActionEventType = typeof BlendActionEventType;

/**
 * East StructType for the Blend component.
 *
 * @remarks
 * The assembly surface for blending / batching decisions — pull amounts
 * from many sources into one or more targets. One pattern, three render
 * modes by target count: `single` (1), `compare` (2, with the derived diff
 * table), `portfolio` (3+, horizontal scroll). Declares the drag & drop
 * **target** role: `add` from declared Libraries and `remove` back — no
 * intra-surface `move`.
 *
 * @property id - DnD target identity
 * @property sources - Library ids accepted for `add` drags
 * @property targets - The target panels (length picks the render mode)
 * @property diff - Compare mode: metric keys for the foot table (empty = all)
 * @property verdict - Optional compare verdict line
 * @property onDrag - Drag funnel — add / remove events
 * @property onAmountChange - Allocation amount edits
 * @property onAction - Panel actions (reset / optimise / apply / discard)
 */
export const BlendRootType = StructType({
    /** DnD target identity */
    id: StringType,
    /** Library ids accepted for `add` drags */
    sources: ArrayType(StringType),
    /** The target panels (length picks the render mode) */
    targets: ArrayType(BlendTargetType),
    /** Compare mode: metric keys for the foot table (empty = all) */
    diff: ArrayType(StringType),
    /** Optional compare verdict line */
    verdict: OptionType(StringType),
    /** Drag funnel — add / remove events */
    onDrag: OptionType(FunctionType([DragEventType], NullType)),
    /** Allocation amount edits */
    onAmountChange: OptionType(FunctionType([BlendAmountEventType], NullType)),
    /** Panel actions (reset / optimise / apply / discard) */
    onAction: OptionType(FunctionType([BlendActionEventType], NullType)),
});

/**
 * Type representing the Blend component.
 */
export type BlendRootType = typeof BlendRootType;
