/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    ArrayType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { SliceBindType } from "../../platform/slice/index.js";
import {
    SliceAffordanceType,
    type SliceAffordanceLiteral,
} from "../../contracts/slice-affordances.js";

/** A single rail affordance — a `"filter" | "search" | …` literal or a variant expression. */
export type SliceRailAffordance = SliceAffordanceLiteral | SubtypeExprOrValue<SliceAffordanceType>;

/** Options for `Slice.Rail.Root`. */
export interface SliceRailOptions {
    /** The bound slice (from `Slice.bind`) every affordance writes to. */
    slice: SubtypeExprOrValue<SliceBindType>;
    /**
     * Rail affordances, in order. Plain strings or variant expressions. The
     * rail renders them in one row that never wraps: chips fold along the
     * compress ladder (whole chips → `+M more` within a family → family count
     * chips → one `N narrowed` chip), and under compression every chip opens
     * the sectioned `Slice.Edit` popover floating over whatever sits below.
     */
    affordances?: SliceRailAffordance[];
    /**
     * Opt the slice's state into persistence (#168): `"local"` /
     * `"session"` storage keyed by the slice key (survives reloads), or
     * `"url"` — a query parameter holding the encoded state, so the exact
     * narrowing is bookmarkable and shareable. On mount the rail hydrates the
     * slice from the chosen store (a stale or foreign blob is ignored);
     * every mutation writes back, debounced. Absent = in-memory only.
     */
    persist?: "local" | "session" | "url";
    /**
     * Presentation of the brush strip (#190). The strip is rich by default —
     * a formatted axis (min / ticks / max, per the range field's declared
     * `format` or a kind default) and a row-count histogram behind the track
     * (self-excluding, so it never collapses under its own window). Pass
     * `{ axis: false, count: false }` for the minimal bare track, or
     * `buckets` to change the histogram resolution (default 32).
     */
    brush?: { axis?: boolean; count?: boolean; buckets?: number };
}

/**
 * Creates a `Slice.Rail` — the slice affordance cluster as a standalone
 * strip. This is the *entire* slice chrome in one row: place it above any
 * components reading `slice.rows()` (a Stat row, a Table, a Chart — chrome
 * suppressed on each) and the rail narrows them all. Components that take a
 * `slice` chrome option mount this same rail inside their own header, so the
 * slice reads identically everywhere.
 *
 * @param options - The bound `slice` and the `affordances` to mount
 * @returns An East expression of type `UIComponentType`
 *
 * @example
 * ```tsx
 * <VStack gap="3" align="stretch">
 *     <Slice.Rail slice={slice} affordances={["filter", "search"]} />
 *     <Table rows={slice.rows()} columns={columns} />
 * </VStack>
 * ```
 */
function createSliceRail(options: SliceRailOptions): ExprType<UIComponentType> {
    const affordances = (options.affordances ?? []).map(a =>
        typeof a === "string" ? variant(a, null) : a,
    );
    return East.value(variant("SliceRail", {
        slice: options.slice,
        affordances: East.value(affordances, ArrayType(SliceAffordanceType)),
        persist: options.persist !== undefined ? some(variant(options.persist, null)) : none,
        brush: options.brush !== undefined
            ? some({
                axis:    options.brush.axis !== undefined ? some(options.brush.axis) : none,
                count:   options.brush.count !== undefined ? some(options.brush.count) : none,
                buckets: options.brush.buckets !== undefined ? some(BigInt(options.brush.buckets)) : none,
            })
            : none,
    }), UIComponentType);
}

/** `Slice.Rail` — the slice affordance cluster as a standalone strip. */
export const SliceRail = {
    Root: createSliceRail,
} as const;
