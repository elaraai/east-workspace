/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Slice chrome and the one shared scale (§3/§8).
 *
 * Slice integration is the Table adopter pattern, chrome-only: the rows are
 * whatever the host fed (`Slice.rows` upstream) — the Plan never narrows its
 * own data. Beyond Table, the slice's `range` / `resolution` STATE is the
 * window / resolution source of truth; the axis declaration seeds the unbound
 * case, and the rows only when the window is fitted to them.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../../utils.js";
import { useSliceReactivity } from "../../../slice/use-slice-reactivity.js";
import { resolveScale, scaleReadsRows, sliceWindowOf } from "../axis.js";
import type { PlanScale } from "../scale.js";
import type { PlanRootValue, PlanRowValue } from "../model.js";

type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;

/** The rows a scale with a stated window is resolved over — none (#812). */
const NO_ROWS: readonly PlanRowValue[] = [];

/** The canvas's slice chrome and scale. */
export interface PlanWindow {
    /** Whether slice chrome is declared at all. */
    chrome: boolean;
    /** The bound slice handle, when there is one. */
    slice: SliceBindValue | undefined;
    /** The declared affordance kinds. */
    affordances: readonly string[];
    /** The shared scale, or `undefined` when no window resolves. */
    scale: PlanScale | undefined;
}

/**
 * The slice chrome and the scale every row positions against.
 *
 * @param value - The latest root (its slice chrome)
 * @param data - The root's data-stable twin (its axis)
 * @param rows - The canvas's rows (inline, or the resident paged ones)
 * @returns The chrome and the scale
 */
export function usePlanWindow(value: PlanRootValue, data: PlanRootValue, rows: readonly PlanRowValue[]): PlanWindow {
    const paged = data.rows.type === "paged";
    const decl = useMemo(() => getSomeorUndefined(value.slice), [value.slice]);
    const slice = decl !== undefined ? (decl.slice as SliceBindValue) : undefined;
    // Re-render on every write to the slice — the window and resolution are
    // its state, whoever wrote them.
    useSliceReactivity(slice?.key);
    const affordances = useMemo(
        () => (decl !== undefined ? decl.affordances.map((a: { type: string }) => a.type) : []),
        [decl],
    );
    const sliceState = slice !== undefined ? slice.read() : undefined;
    // Keyed on the DOMAIN NUMBERS, never on the range object. `slice.read()`
    // decodes fresh state on every render, so `sliceState.range` has a new
    // identity each time even when the window has not moved. Keying the memo
    // on that identity rebuilt the scale (up to MAX_PLAN_BUCKETS buckets, each
    // with a formatted label), which published a new PlanScale to every row —
    // busting `edges`, `resolveCoord`, `dropVeto` and so the drop cell's own
    // ref callback, so React detached and re-attached every registered cell on
    // every render of a slice-bound canvas.
    const sliceWin = sliceWindowOf(sliceState, data.axis.type);
    const sliceFromN = sliceWin?.[0];
    const sliceToN = sliceWin?.[1];
    const sliceResolution = sliceState !== undefined ? getSomeorUndefined(sliceState.resolution)?.type : undefined;
    // `resolveScale` owns the ladder: the slice's range ▸ the declared window
    // ▸ fit-to-data (a PAGED canvas must declare — #567 D8), per axis kind.
    // The rows are an input only when the window is fitted to them: a stated
    // window keeps one scale while windows land, rather than handing every
    // mounted row a new one (#812).
    const fitRows = scaleReadsRows(data.axis, sliceWin, paged) ? rows : NO_ROWS;
    const scale = useMemo(() => resolveScale({
        axis: data.axis,
        sliceWindow: sliceFromN === undefined || sliceToN === undefined ? undefined : [sliceFromN, sliceToN],
        sliceResolution,
        rows: fitRows,
        paged,
    }), [data.axis, sliceFromN, sliceToN, sliceResolution, fitRows, paged]);
    return { chrome: decl !== undefined, slice, affordances, scale };
}
