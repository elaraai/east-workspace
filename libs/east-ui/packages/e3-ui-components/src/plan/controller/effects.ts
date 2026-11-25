/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The Plan's effects (#815) — what a state transition asks of the world: the
 * window written into the sources of its slice (#1344), and the author's
 * callbacks. The controller runs them INSIDE the action that produced them,
 * right after the transition.
 *
 * # One window across the sources
 *
 * Every source of the Plan's `Slice.bindRecords` whose range field speaks the
 * axis's arm holds the window (`root/window.ts`) — but the canvas's rows', the
 * `rows` source's, which the dates on screen never narrow. A pan, the now rung, the brush and the time navigator write the
 * window into each of them at once — the reader's own gesture, so a choice of
 * a source's that no index takes beside a window gives way, as the range
 * editor says it would. A canvas whose slice has no source holding the window
 * holds its own (`PlanWindowHold`), and the same gestures move it; a canvas
 * with no slice keeps the axis's stated window, and an ordinal axis's list is
 * its window.
 *
 * # Every window write reads the CURRENT window
 *
 * A pan, the now rung and a period's preset are all arithmetic on the window
 * shown — the one the sources hold, or the canvas's own. They resolve the
 * scale from a fresh read rather than from the one the last render drew with,
 * so two effectful actions in one handler compose: two `]` presses pan two
 * periods, where the second one used to be computed from the window the first
 * had already moved.
 *
 * # A period pressed is a range
 *
 * The columns' period follows the window's range and the plot's width (#1740,
 * `shared/time/period.ts`), and nothing stores it. A period pressed in the
 * toolbar's segment is a preset: it sets the range that period fills on the
 * plot at the preset width, from the window's own start — the start date
 * never moves (ruled 23 Nov 2026) — and the period that follows is the one
 * pressed. A zoom to a table cell's period (#1438) sets as many of it about
 * the middle the cell names instead, inside the data. Either is written as
 * every window is, and the sources holding the window read the range it lands
 * on.
 *
 * @packageDocumentation
 */

import { variant } from "@elaraai/east";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import { setRecordSliceWindow } from "@elaraai/east-ui-components/internal";
import { axisNow, axisPeriods, resolveScale } from "../axis.js";
import { PLAN_COLUMN_WIDTHS, PLAN_UNLAID_PLOT } from "../geometry.js";
import type { PlanScale } from "../scale.js";
import { instantOrder, type PlanInstantValue } from "../instant.js";
import { rowIdOfKey, type PlanRootValue } from "../model.js";
import type { PlanEffect } from "../plan-state.js";
import { planSlices, planWindowParts } from "../root/sources.js";
import { leadingWindow, statedWindow, windowPartsDomain, type PlanWindowHold, type PlanWindowPart } from "../root/window.js";
import { presetAround, presetWindow } from "../../shared/time/period.js";

/**
 * The scale as the window is held NOW — the same period the canvas renders
 * with (`resolveScale` over the leading source's window, else the window last
 * shown — the canvas's own, while no source holds one — and the axis's stated
 * window, at the period the hold picks for it).
 *
 * @param value - The latest root
 * @param hold - The canvas's window hold: the window last shown, its columns' period, and the sources whose ranges never hold it
 * @returns The scale, or `undefined` when no window resolves
 */
export function currentScale(value: PlanRootValue, hold?: PlanWindowHold): PlanScale | undefined {
    const chrome = planSlices(value);
    const parts = planWindowParts(chrome, value.axis.type, hold?.rows);
    const window = leadingWindow(parts, value.axis.type) ?? hold?.last;
    const shown = window ?? statedWindow(value.axis);
    const period = hold === undefined || value.axis.type !== "time" || shown === undefined
        ? undefined : hold.periodFor(shown[0], shown[1], axisPeriods(value.axis));
    return resolveScale({ axis: value.axis, sliceWindow: window, period });
}

/**
 * Write a window `[min, max)` — the reader's own gesture, a pan, the brush,
 * the time navigator: into every source holding the window, else into the
 * canvas's own (#1344), which its render follows.
 *
 * @param parts - The sources holding the window
 * @param min - The window's start, on the axis's domain
 * @param max - Its end, exclusive
 * @param hold - The canvas's window hold: what holds the window while no source does
 */
export function writePlanWindow(parts: readonly PlanWindowPart[], min: number, max: number, hold: PlanWindowHold | undefined): void {
    if (parts.length === 0) {
        hold?.move(min, max);
        return;
    }
    for (const { part } of parts) setRecordSliceWindow(part, min, max);
}

/**
 * Run one transition's effects, in order.
 *
 * @param effects - The effects the transition returned
 * @param value - The latest root (its slice and callbacks)
 * @param hold - The canvas's window hold: the window last shown, the canvas's own while no source holds one, and the
 *   sources whose ranges never hold it
 */
export function runPlanEffects(effects: readonly PlanEffect[], value: PlanRootValue, hold?: PlanWindowHold): void {
    for (const eff of effects) {
        const chrome = planSlices(value);
        const parts = planWindowParts(chrome, value.axis.type, hold?.rows);
        const bound = parts.length > 0;
        // The window a gesture moves: the sources holding it, else — a canvas whose slice has none holding it — the
        // canvas's own. A canvas with no slice keeps the axis's stated window, and an ordinal axis's list is its window.
        const writable = bound || (chrome !== undefined && hold !== undefined && value.axis.type !== "ordinal");
        const write = (min: PlanInstantValue, max: PlanInstantValue) => writePlanWindow(parts, instantOrder(min), instantOrder(max), hold);
        switch (eff.t) {
            case "slice.setRange": {
                if (writable) write(eff.min, eff.max);
                break;
            }
            case "slice.clearRange": {
                // A cleared range falls back to the axis's stated window, written as every window is. An axis that
                // states none takes its window FROM the sources (#822), so clearing would leave the canvas nothing to
                // draw on: the brush moves that window, and never removes it.
                const stated = statedWindow(value.axis);
                if (writable && stated !== undefined) writePlanWindow(parts, stated[0], stated[1], hold);
                break;
            }
            case "window.preset": {
                // A period is a TIME-axis fact — the segment only mounts there (a number axis has `step`; an ordinal
                // list no unit) — and pressing one sets a range (#1740): as many of it as the plot holds at the preset
                // width, from the window's own start (ruled 23 Nov 2026) — or, a zoom to a cell's period (#1438),
                // about the middle the cell names, inside the data: the sources' domain where they hold the window,
                // the span of what its series read where the canvas holds its own. Written as every window is — into
                // the sources holding it, or the canvas's own — and the period that follows is the one pressed.
                const period = axisPeriods(value.axis).find((offered) => offered === eff.period);
                const shown = writable && period !== undefined ? currentScale(value, hold) : undefined;
                if (period === undefined || shown === undefined) break;
                const held = bound ? leadingWindow(parts, value.axis.type) : hold?.last;
                // The window as it is held, never the scale's whole periods around it: a month's scale draws from the
                // 1st, and a preset from there moved the start date. The scale's, while none is held yet — the axis's
                // stated window.
                const from = held ?? [shown.toNumber(shown.window.min), shown.toNumber(shown.window.max)] as const;
                const plot = hold?.plot ?? PLAN_UNLAID_PLOT;
                const domain = bound ? windowPartsDomain(parts) : undefined;
                const span = domain !== undefined ? [domain.min, domain.max] as const : hold?.span;
                const preset = eff.about === undefined
                    ? presetWindow(from[0], period, plot, PLAN_COLUMN_WIDTHS)
                    // Inside the data, and over the window shown too where it lies outside it.
                    : presetAround(eff.about, period, plot, PLAN_COLUMN_WIDTHS,
                        span === undefined ? undefined : [Math.min(span[0], from[0]), Math.max(span[1], from[1])]);
                if (held === undefined || held[0] !== preset[0] || held[1] !== preset[1]) writePlanWindow(parts, preset[0], preset[1], hold);
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
                // The now instant is an AXIS fact, so reaching it means moving the WINDOW — the sources', or the
                // canvas's own. A canvas with no slice has no writable one, so the rung idles there, like the
                // segment's presets.
                if (!writable) break;
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
                if (!writable) break;
                const scale = currentScale(value, hold);
                if (scale === undefined) break;
                write(scale.offset(scale.window.min, eff.buckets), scale.offset(scale.window.max, eff.buckets));
                break;
            }
        }
    }
}
