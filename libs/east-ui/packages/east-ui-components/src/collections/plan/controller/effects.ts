/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The Plan's effects (#815) — what a state transition asks of the world: slice
 * writes, and the author's callbacks. The controller runs them INSIDE the
 * action that produced them, right after the transition.
 *
 * # Every window write reads the CURRENT window
 *
 * A pan, the now rung and the resolution zoom are all arithmetic on the window
 * the slice holds. They resolve the scale from a fresh `slice.read()` rather
 * than from the one the last render drew with, so two effectful actions in one
 * handler compose: two `]` presses pan two periods, where the second one used
 * to be computed from the window the first had already moved.
 *
 * # A resolution change is ONE slice write
 *
 * Switching WEEK → DAY keeps the column count, so it moves the resolution and
 * the window together. Two writes (`setResolution`, then `setRange`) rendered
 * once in between at the new resolution over the old window — 84 day columns
 * for a 12-week window. One `write` of the whole state moves both at once.
 *
 * @packageDocumentation
 */

import { none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../../utils.js";
import { boundRangeDomain } from "../../../platform/slice/index.js";
import { axisNow, axisStatesWindow, rangeArmOf, rangeOf, resolveScale, sliceWindowOf } from "../axis.js";
import { resolutionInterval, type PlanResolution, type PlanScale } from "../scale.js";
import type { PlanInstantValue } from "../instant.js";
import { rowIdOfKey, type PlanRootValue } from "../model.js";
import type { PlanEffect } from "../plan-state.js";

type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;
type SliceStateValue = ValueTypeOf<typeof Slice.Types.State>;

/** The bound slice handle a root carries, if any. */
export function sliceOf(value: PlanRootValue): SliceBindValue | undefined {
    const chrome = getSomeorUndefined(value.slice);
    return chrome !== undefined ? (chrome.slice as SliceBindValue) : undefined;
}

/**
 * The scale as the slice holds it NOW — the same resolution the canvas renders
 * with (`resolveScale` over the slice's range and resolution, and the axis's
 * stated window).
 *
 * @param value - The latest root
 * @returns The scale, or `undefined` when no window resolves
 */
export function currentScale(value: PlanRootValue): PlanScale | undefined {
    const slice = sliceOf(value);
    const state: SliceStateValue | undefined = slice !== undefined ? slice.read() : undefined;
    return resolveScale({
        axis: value.axis,
        sliceWindow: sliceWindowOf(state, value.axis.type),
        sliceResolution: state !== undefined ? getSomeorUndefined(state.resolution)?.type : undefined,
    });
}

/**
 * Write a window to the slice, as the range arm the axis speaks (#631): the
 * instants land as `datetime` on a time axis, as the field's `float` /
 * `integer` on a number axis, and not at all on an ordinal one, whose list is
 * its window (the keys and the pan idle there, as on an unbound canvas).
 */
function writeWindow(slice: SliceBindValue, scale: PlanScale, min: PlanInstantValue, max: PlanInstantValue): void {
    const arm = rangeArmOf(scale.kind, slice.read(), boundRangeDomain(slice.key)?.kind);
    if (arm === undefined) return;
    slice.setRange(some(rangeOf(arm, min, max)));
}

/**
 * Run one transition's effects, in order.
 *
 * @param effects - The effects the transition returned
 * @param value - The latest root (its slice and callbacks)
 */
export function runPlanEffects(effects: readonly PlanEffect[], value: PlanRootValue): void {
    for (const eff of effects) {
        const slice = sliceOf(value);
        switch (eff.t) {
            case "slice.setRange": {
                const scale = slice !== undefined ? currentScale(value) : undefined;
                if (slice !== undefined && scale !== undefined) writeWindow(slice, scale, eff.min, eff.max);
                break;
            }
            case "slice.clearRange":
                // A cleared range falls back to the axis's stated window. An
                // axis that states none takes its window FROM the range
                // (#822), so clearing it would leave the canvas nothing to
                // draw on: the brush moves that window, and never removes it.
                if (slice !== undefined && axisStatesWindow(value.axis)) slice.setRange(none);
                break;
            case "slice.setResolution": {
                // A resolution is a TIME-axis fact — the segment only mounts
                // there (a number axis has `step`; an ordinal list no unit).
                if (slice === undefined) break;
                const scale = currentScale(value);
                if (scale === undefined || scale.kind !== "time" || scale.window.min.type !== "time") break;
                // Zoom to the new resolution keeping the CURRENT column count
                // (12 weeks showing → DAY shows 12 days), anchored at the window
                // start on the new period edges — ONE write for both.
                const interval = resolutionInterval(eff.resolution as PlanResolution);
                const from = interval.floor(scale.window.min.value);
                const to = interval.offset(from, scale.n);
                const state = slice.read();
                slice.write({
                    ...state,
                    resolution: some(variant(eff.resolution, null)),
                    range: some(variant("datetime", { from, to })),
                } as SliceStateValue);
                break;
            }
            case "emit.select": {
                // A callback names the row by its typed id, never its key (#822).
                const fn = getSomeorUndefined(value.onSelect);
                const id = fn !== undefined ? rowIdOfKey(eff.key) : undefined;
                if (fn !== undefined && id !== undefined) queueMicrotask(() => fn(id));
                break;
            }
            case "emit.groupToggle": {
                const fn = getSomeorUndefined(value.onGroupToggle);
                const id = fn !== undefined ? rowIdOfKey(eff.key) : undefined;
                if (fn !== undefined && id !== undefined) queueMicrotask(() => fn({ row: id, expanded: eff.expanded }));
                break;
            }
            case "emit.grainChange": {
                const fn = getSomeorUndefined(value.onGrainChange);
                if (fn !== undefined) queueMicrotask(() => fn(variant(eff.grain, null)));
                break;
            }
            case "scroll.toNow": {
                // The now instant is an AXIS fact, so reaching it means moving
                // the WINDOW — slice state. An unbound canvas has no writable
                // window, so the rung idles there, like the resolution segment.
                if (slice === undefined) break;
                const scale = currentScale(value);
                const nowInstant = axisNow(value.axis);
                if (scale === undefined || nowInstant === undefined) break;
                // Re-derive the window on period edges with the SAME column
                // count, now a third of the way in (ahead is where the plan
                // lives) — snap + `n` periods on the scale's own domain.
                const from = scale.offset(scale.floor(nowInstant), -Math.floor(scale.n / 3));
                writeWindow(slice, scale, from, scale.offset(from, scale.n));
                break;
            }
            case "pan": {
                if (slice === undefined) break;
                const scale = currentScale(value);
                if (scale === undefined) break;
                writeWindow(slice, scale, scale.offset(scale.window.min, eff.buckets), scale.offset(scale.window.max, eff.buckets));
                break;
            }
        }
    }
}
