/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The ranks a rail folds at, among a host's (#952, #1673): every step of a
 * rail's clusters folds below {@link HOST_RANK}, and a host's own items fold
 * from it. A module of its own, so a host reads it without the rail's forms.
 *
 * @packageDocumentation
 */

import { FLOOR_RANK } from "../fold.js";

/**
 * The rank each kind of affordance folds at — the order affordances give way
 * from live control to summary chip as the row narrows. Lower folds first:
 * `search` and `range` summarise cheaply, so they go first; the `filter`
 * builder is the primary narrowing surface, so it stays live longest.
 */
export const KIND_RANK: Readonly<Record<string, number>> = {
    search: 1,
    range: 2,
    cohort: 3,
    presets: 3,
    breakdown: 4,
    filter: 5,
};

/** The rank a kind with none of its own folds at: mid-pack. */
export const MID_RANK = 3;

/**
 * The rail's own ranks around {@link KIND_RANK}: the filter's chips fold
 * first; the merged terminal chip and the icon last; and, below the toolbar's
 * ladder, the icon without its caret — the first rung of the row's floor
 * (`FLOOR_RANK`, hand retest, 27 Oct 2026).
 */
export const RAIL_RANK = { chips: 0, terminal: 6, icon: 7, bare: FLOOR_RANK } as const;

/** The first rank a host's own toolbar items fold at — after every step of the rail's. */
export const HOST_RANK = 10;

/**
 * The rank a record rail's summary (`12 of 69 people`) folds at: after every
 * step of the rail, so the Filters editor its fields have folded into keeps
 * the summary a click away, and before a host's own items, so a builder's
 * view controls outlast its counts (ruled 18 Oct 2026, #1340).
 */
export const SUMMARY_RANK = HOST_RANK - 1;
