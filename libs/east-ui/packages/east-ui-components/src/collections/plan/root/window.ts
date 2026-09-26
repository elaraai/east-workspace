/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Slice chrome and the one shared scale (§3/§8).
 *
 * Slice integration is the Table adopter pattern, chrome-only: the rows are
 * whatever the host fed (`Slice.rows` upstream) — the Plan never narrows its
 * own data. Beyond Table, the slice's `range` / `resolution` STATE is the
 * window / resolution source of truth; the axis's stated window seeds the
 * unbound case. The rows never set the window (#822).
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../../utils.js";
import { useSliceReactivity } from "../../../slice/use-slice-reactivity.js";
import { resolveScale, sliceWindowOf } from "../axis.js";
import type { PlanScale } from "../scale.js";
import type { PlanRootValue } from "../model.js";
import type { PlanWords } from "../words.js";

type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;

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
 * @param words - The canvas's words — the locale the ruler labels format in (#820)
 * @returns The chrome and the scale
 */
export function usePlanWindow(value: PlanRootValue, data: PlanRootValue, words: PlanWords): PlanWindow {
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
    // `resolveScale` owns the ladder: the slice's range ▸ the stated window,
    // per axis kind. The rows are no input (#822), so windows landing keep
    // one scale rather than handing every mounted row a new one (#812).
    const scale = useMemo(() => resolveScale({
        axis: data.axis,
        sliceWindow: sliceFromN === undefined || sliceToN === undefined ? undefined : [sliceFromN, sliceToN],
        sliceResolution,
        words,
    }), [data.axis, sliceFromN, sliceToN, sliceResolution, words]);
    return { chrome: decl !== undefined, slice, affordances, scale };
}
