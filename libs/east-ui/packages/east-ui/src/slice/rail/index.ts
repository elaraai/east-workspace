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
import { isRecordSlice, recordSliceChrome, type RecordSliceChromeOptions } from "../../platform/slice/record-chrome.js";
import { RecordSliceRailComponent } from "../record/index.js";
import { localSliceHandle, SliceBindType } from "../../platform/slice/index.js";
import {
    SliceAffordanceType,
    type SliceAffordanceLiteral,
} from "../../contracts/slice-affordances.js";

/** A single rail affordance — a `"filter" | "search" | …` literal or a variant expression. */
export type SliceRailAffordance = SliceAffordanceLiteral | SubtypeExprOrValue<SliceAffordanceType>;

/** Options for `Slice.Rail.Root`. */
export interface LocalSliceRailOptions {
    /** The bound slice (from `Slice.bind`) every affordance writes to. */
    slice: SubtypeExprOrValue<SliceBindType>;
    /**
     * Rail affordances, in order. Plain strings or variant expressions. The
     * rail renders them in one row that never wraps, and folds as the row's
     * width asks, one step at a time: a filter's trailing clause chips into
     * `+M more`, then each affordance into a summary chip (search and range
     * first, the filter builder last), then those into one chip that names
     * the rail's contents, then the icon alone. Every folded chip opens the
     * sectioned `Slice.Edit` popover floating over whatever sits below. The
     * fold follows the width alone — never an animation through the steps
     * between (#952).
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

/** Both arms use the shared rail; record affordances stay typed separately. */
export type SliceRailOptions = LocalSliceRailOptions | RecordSliceChromeOptions;

/**
 * Creates a `Slice.Rail` — the slice affordance cluster as a standalone
 * strip. This is the *entire* slice chrome in one row: place it above any
 * components reading `Slice.rows(slice)` (a Stat row, a Table, a Chart — chrome
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
 *     <Table data={Slice.rows(slice)} columns={columns} />
 * </VStack>
 * ```
 */
function createSliceRail(input: SliceRailOptions): ExprType<UIComponentType> {
    if (isRecordSlice(input.slice)) return RecordSliceRailComponent.Root(recordSliceChrome(input as RecordSliceChromeOptions));
    const options = input as LocalSliceRailOptions;
    const affordances = (options.affordances ?? []).map(a =>
        typeof a === "string" ? variant(a, null) : a,
    );
    return East.value(variant("SliceRail", {
        slice: localSliceHandle(options.slice),
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
