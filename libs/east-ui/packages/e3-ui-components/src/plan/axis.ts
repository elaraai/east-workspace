/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The canvas axis, resolved (#631) — from the decoded root `axis` (one of
 * the three arms) and the window the sources of the Plan's slice hold (#1344,
 * `root/window.ts`) to the one `PlanScale` every row positions against. A
 * source's range speaks the axis's arm — `datetime` on a time axis, `float` /
 * `integer` on a number axis, none on an ordinal one (its list is its window)
 * — and a window written to it is the record slice's own
 * (`setRecordSliceWindow`), half-open on the axis's domain.
 *
 * The window is never fitted to the rows (#822): it is the sources' range or
 * the axis's stated window, so the canvas reads the same inline and paged,
 * and rows landing or changing never move it.
 *
 * A time axis's columns take the period its window's range and the plot's
 * width give (#1740, `shared/time/period.ts`), of the periods the axis offers
 * ({@link axisPeriods}): a reading of the range, which nothing stores.
 *
 * @packageDocumentation
 */

import { variant, type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/e3-ui/internal";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import { columnPeriod, finestFirst } from "../shared/time/period.js";
import { PLAN_COLUMN_WIDTHS, PLAN_UNLAID_PLOT } from "./geometry.js";
import { planScale, type PlanResolution, type PlanScale } from "./scale.js";
import type { PlanInstantValue } from "./instant.js";
import type { PlanWords } from "./words.js";

/** The decoded axis declaration — `{ time | number | ordinal }`. */
export type PlanAxisValue = ValueTypeOf<typeof Plan.Types.Axis>;

/** The declared `now`, as an instant on the axis's arm. */
export function axisNow(axis: PlanAxisValue): PlanInstantValue | undefined {
    switch (axis.type) {
        case "time": {
            const d = getSomeorUndefined(axis.value.now);
            return d !== undefined ? (variant("time", d) as PlanInstantValue) : undefined;
        }
        case "number": {
            const n = getSomeorUndefined(axis.value.now);
            return n !== undefined ? (variant("number", n) as PlanInstantValue) : undefined;
        }
        case "ordinal": {
            const s = getSomeorUndefined(axis.value.now);
            return s !== undefined ? (variant("ordinal", s) as PlanInstantValue) : undefined;
        }
    }
}

/** The resolution segment options — a `time` axis only (`step` is fixed on
 *  a number axis; an ordinal list has no unit). */
export function axisResolutions(axis: PlanAxisValue): string[] {
    return axis.type === "time" ? axis.value.resolutions.map((r) => r.type) : [];
}

/** The periods a time axis offers where it names none. */
const CALENDAR_PERIODS: readonly PlanResolution[] = ["day", "week", "month", "quarter", "year"];
const NO_PERIODS: readonly PlanResolution[] = [];

/**
 * The periods a time axis's columns may take (#1740), finest first: the ones
 * its `resolutions` name; where it names none, the one its `resolution` pins —
 * or, left to `auto`, a day to a year. Hours only where named.
 *
 * @param axis - The decoded root axis
 * @returns The periods offered; none for an axis of numbers or of a list
 */
export function axisPeriods(axis: PlanAxisValue): readonly PlanResolution[] {
    if (axis.type !== "time") return NO_PERIODS;
    const named = axis.value.resolutions.flatMap((r): PlanResolution[] => (r.type === "auto" ? [] : [r.type]));
    if (named.length > 0) return finestFirst(named);
    const pinned = axis.value.resolution.type;
    return pinned === "auto" ? CALENDAR_PERIODS : [pinned];
}

/**
 * Whether the axis states its own window — a time or number axis's `window`;
 * an ordinal axis's list is its window. An axis that states none takes its
 * window from the sources' range (#822, #1344).
 *
 * @param axis - The decoded root axis
 * @returns `true` when the axis supplies a window without the slice
 */
export function axisStatesWindow(axis: PlanAxisValue): boolean {
    return axis.type === "ordinal" || axis.value.window.type === "some";
}

/** An ordinal axis's value → index map (what orders its instants); `undefined` otherwise. */
export function ordinalIndexOf(axis: PlanAxisValue): ReadonlyMap<string, number> | undefined {
    if (axis.type !== "ordinal") return undefined;
    const index = new Map<string, number>();
    axis.value.values.forEach((v, i) => { if (!index.has(v)) index.set(v, i); });
    return index;
}

/** What {@link resolveScale} needs — the declaration and the slice's say. */
export interface ResolveScaleArgs {
    /** The decoded root axis. */
    axis: PlanAxisValue;
    /** The sources' window on this axis's domain, `[from, to)` (`root/window.ts`); `undefined` while none holds one. */
    sliceWindow: readonly [number, number] | undefined;
    /**
     * The period a time axis's columns take (#1740), as the canvas's window
     * hold works it out for the window and its plot (`root/window.ts`); left
     * out, the period the window takes on a plot not laid out.
     */
    period?: PlanResolution | undefined;
    /** The canvas's words — the locale its ruler labels format in (#820); the default English `en-US` words when omitted. */
    words?: PlanWords | undefined;
}

/**
 * Resolve the scale: the sources' range ▸ the axis's stated window (§3/§8).
 *
 * @remarks
 * Never the rows (#822): a window fitted to the data would be fitted to
 * whatever has loaded, so the axis would widen and every bar re-flow as a
 * paged canvas's windows land, and an inline canvas would read differently
 * from the same data paged. The rows are no input, so a canvas keeps ONE scale
 * while rows change under it (#812). An ordinal axis needs nothing resolved —
 * its list is its window.
 *
 * @param args - See {@link ResolveScaleArgs}
 * @returns The scale, or `undefined` when neither states a window
 */
export function resolveScale({ axis, sliceWindow, period, words }: ResolveScaleArgs): PlanScale | undefined {
    switch (axis.type) {
        case "time": {
            const a = axis.value;
            const declared = getSomeorUndefined(a.window);
            const window = sliceWindow !== undefined
                ? { min: new Date(sliceWindow[0]), max: new Date(sliceWindow[1]) }
                : (declared !== undefined ? { min: declared.min, max: declared.max } : undefined);
            if (window === undefined) return undefined;
            const res = period
                ?? columnPeriod(window.min.getTime(), window.max.getTime(), PLAN_UNLAID_PLOT, axisPeriods(axis), PLAN_COLUMN_WIDTHS.floor);
            if (res === undefined) return undefined;
            return planScale({
                kind: "time", window, resolution: res,
                now: getSomeorUndefined(a.now), format: getSomeorUndefined(a.format), words,
            });
        }
        case "number": {
            const a = axis.value;
            const step = a.step;
            if (!Number.isFinite(step) || !(step > 0)) return undefined;
            const declared = getSomeorUndefined(a.window);
            const window = sliceWindow !== undefined
                ? { min: sliceWindow[0], max: sliceWindow[1] }
                : (declared !== undefined ? { min: declared.min, max: declared.max } : undefined);
            if (window === undefined) return undefined;
            return planScale({
                kind: "number", window, step,
                now: getSomeorUndefined(a.now), format: getSomeorUndefined(a.format), words,
            });
        }
        case "ordinal":
            return planScale({ kind: "ordinal", values: axis.value.values, now: getSomeorUndefined(axis.value.now), words });
    }
}
