/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The Plan's effects (#815) — what a state transition asks of the world: the
 * window and the resolution written into the sources of its slice (#1344),
 * and the author's callbacks. The controller runs them INSIDE the action that
 * produced them, right after the transition.
 *
 * # One window across the sources
 *
 * Every source of the Plan's `Slice.bindRecords` whose range field speaks the
 * axis's arm holds the window (`root/window.ts`). A pan, the now rung, the
 * brush and the time navigator write the window into each of them at once —
 * the reader's own gesture, so a choice of a source's that no index takes
 * beside a window gives way, as the range editor says it would.
 *
 * # Every window write reads the CURRENT window
 *
 * A pan, the now rung and the resolution zoom are all arithmetic on the window
 * the sources hold. They resolve the scale from a fresh read rather than from
 * the one the last render drew with, so two effectful actions in one handler
 * compose: two `]` presses pan two periods, where the second one used to be
 * computed from the window the first had already moved.
 *
 * # A resolution only re-buckets
 *
 * A record's resolution is presentation: switching WEEK → DAY re-buckets the
 * window the sources hold, and fetches nothing. It is written to each source
 * holding the window, else to every source — a slice with no window holds it
 * there.
 *
 * @packageDocumentation
 */

import { some, variant } from "@elaraai/east";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import { setRecordSliceWindow } from "@elaraai/east-ui-components/internal";
import { axisNow, resolveScale } from "../axis.js";
import type { PlanScale } from "../scale.js";
import { instantOrder, type PlanInstantValue } from "../instant.js";
import { rowIdOfKey, type PlanRootValue } from "../model.js";
import type { PlanEffect } from "../plan-state.js";
import { planSlices, planWindowParts } from "../root/sources.js";
import { leadingWindow, slicedResolution, statedWindow, type PlanWindowHold, type PlanWindowPart } from "../root/window.js";

/**
 * The scale as the sources hold it NOW — the same resolution the canvas
 * renders with (`resolveScale` over the leading source's window and the
 * resolution, else the window last shown, and the axis's stated window).
 *
 * @param value - The latest root
 * @param hold - The canvas's window hold: the window last shown, while no source holds one
 * @returns The scale, or `undefined` when no window resolves
 */
export function currentScale(value: PlanRootValue, hold?: PlanWindowHold): PlanScale | undefined {
    const chrome = planSlices(value);
    const parts = planWindowParts(chrome, value.axis.type);
    const window = leadingWindow(parts, value.axis.type) ?? hold?.last;
    return resolveScale({ axis: value.axis, sliceWindow: window, sliceResolution: slicedResolution(chrome, parts) });
}

/**
 * Write a window `[min, max)` into every source holding the window — the
 * reader's own gesture, a pan, the brush, the time navigator.
 *
 * @param parts - The sources holding the window
 * @param min - The window's start, on the axis's domain
 * @param max - Its end, exclusive
 */
export function writePlanWindow(parts: readonly PlanWindowPart[], min: number, max: number): void {
    for (const { part } of parts) setRecordSliceWindow(part, min, max);
}

/**
 * Run one transition's effects, in order.
 *
 * @param effects - The effects the transition returned
 * @param value - The latest root (its slice and callbacks)
 * @param hold - The canvas's window hold: the window last shown, while no source holds one
 */
export function runPlanEffects(effects: readonly PlanEffect[], value: PlanRootValue, hold?: PlanWindowHold): void {
    for (const eff of effects) {
        const chrome = planSlices(value);
        const parts = planWindowParts(chrome, value.axis.type);
        const bound = parts.length > 0;
        const write = (min: PlanInstantValue, max: PlanInstantValue) => writePlanWindow(parts, instantOrder(min), instantOrder(max));
        switch (eff.t) {
            case "slice.setRange": {
                if (bound) write(eff.min, eff.max);
                break;
            }
            case "slice.clearRange": {
                // A cleared range falls back to the axis's stated window, written into every source as a window
                // is. An axis that states none takes its window FROM the sources (#822), so clearing would leave
                // the canvas nothing to draw on: the brush moves that window, and never removes it.
                const stated = statedWindow(value.axis);
                if (bound && stated !== undefined) writePlanWindow(parts, stated[0], stated[1]);
                break;
            }
            case "slice.setResolution": {
                // A resolution is a TIME-axis fact — the segment only mounts there (a number axis has `step`; an
                // ordinal list no unit). It only re-buckets: the window, the narrowing, stays.
                if (chrome === undefined || value.axis.type !== "time") break;
                const holders = bound ? parts.map(({ part }) => part) : chrome.slice.parts.map(({ slice }) => slice);
                const resolution = some(variant(eff.resolution, null)) as Parameters<(typeof holders)[number]["setResolution"]>[0];
                for (const part of holders) part.setResolution(resolution);
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
                // The now instant is an AXIS fact, so reaching it means moving the WINDOW — the sources' state. A
                // canvas whose sources hold no window has no writable one, so the rung idles there, like the
                // resolution segment.
                if (!bound) break;
                const scale = currentScale(value, hold);
                const nowInstant = axisNow(value.axis);
                if (scale === undefined || nowInstant === undefined) break;
                // Re-derive the window on period edges with the SAME column count, now a third of the way in (ahead
                // is where the plan lives) — snap + `n` periods on the scale's own domain.
                const from = scale.offset(scale.floor(nowInstant), -Math.floor(scale.n / 3));
                write(from, scale.offset(from, scale.n));
                break;
            }
            case "pan": {
                if (!bound) break;
                const scale = currentScale(value, hold);
                if (scale === undefined) break;
                write(scale.offset(scale.window.min, eff.buckets), scale.offset(scale.window.max, eff.buckets));
                break;
            }
        }
    }
}
