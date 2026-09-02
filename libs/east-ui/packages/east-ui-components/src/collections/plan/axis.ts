/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The canvas axis, resolved (#631) — from the decoded root `axis` (one of
 * the three arms), the bound slice's range / resolution state and the rows
 * (fit-to-data) to the one `PlanScale` every row positions against; plus the
 * slice bridge the other way: a window WRITE (the brush, `[` / `]` / `n`,
 * the narrow pan) becomes the range arm the slice's field speaks —
 * `datetime` for a time axis, `float` / `integer` for a number axis, nothing
 * for an ordinal one (its list is its window).
 *
 * @packageDocumentation
 */

import { variant, type ValueTypeOf } from "@elaraai/east";
import { Plan, Slice } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils.js";
import { effectiveResolution, planScale, resolutionInterval, type PlanResolution, type PlanScale } from "./scale.js";
import type { PlanAxisKind, PlanInstantValue } from "./instant.js";
import { dataExtent, type PlanRowValue } from "./model.js";

/** The decoded axis declaration — `{ time | number | ordinal }`. */
export type PlanAxisValue = ValueTypeOf<typeof Plan.Types.Axis>;
type SliceStateValue = ValueTypeOf<typeof Slice.Types.State>;
/** One decoded slice range narrowing. */
export type SliceRangeValue = ValueTypeOf<typeof Slice.Types.Range>;

/** The slice range ARM a window write takes — the slice field's own kind. */
export type PlanRangeArm = "datetime" | "float" | "integer";

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

/** An ordinal axis's value → index map (what orders its instants); `undefined` otherwise. */
export function ordinalIndexOf(axis: PlanAxisValue): ReadonlyMap<string, number> | undefined {
    if (axis.type !== "ordinal") return undefined;
    const index = new Map<string, number>();
    axis.value.values.forEach((v, i) => { if (!index.has(v)) index.set(v, i); });
    return index;
}

/**
 * The bound slice's applied window on the axis's own domain — `[from, to]`
 * as numbers (epoch ms / values), or `undefined` when the slice carries no
 * literal range of the arm this axis reads: `datetime` for a time axis,
 * `float` / `integer` for a number axis, never for an ordinal one.
 *
 * @remarks
 * Returns PRIMITIVES so a caller can key a memo on them. The decoded state is a
 * fresh object every read, so its `range` can never be a stable dependency.
 *
 * @param state - The decoded slice state, when a slice is bound
 * @param kind - The axis kind
 * @returns `[fromN, toN]` for a non-empty range of the matching arm, else `undefined`
 */
export function sliceWindowOf(state: SliceStateValue | undefined, kind: PlanAxisKind): readonly [number, number] | undefined {
    if (state === undefined || kind === "ordinal") return undefined;
    const r = getSomeorUndefined(state.range);
    if (r === undefined) return undefined;
    let from: number;
    let to: number;
    if (kind === "time") {
        if (r.type !== "datetime") return undefined;
        from = r.value.from.getTime();
        to = r.value.to.getTime();
    } else if (r.type === "float") {
        from = r.value.from;
        to = r.value.to;
    } else if (r.type === "integer") {
        from = Number(r.value.from);
        to = Number(r.value.to);
    } else {
        return undefined;
    }
    return to > from ? [from, to] as const : undefined;
}

/**
 * Which range arm a window write takes. A time axis writes `datetime`. A
 * number axis writes the arm the slice's field speaks — an Integer field
 * needs bigint bounds or the range is inert (`isValueOf` guard, #167): the
 * current range's own arm when one is applied, else the bound domain's
 * kind, else `float`. An ordinal axis has no arm.
 *
 * @param kind - The axis kind
 * @param state - The decoded slice state
 * @param domainKind - The bound range field's kind (`boundRangeDomain`), when known
 * @returns The arm, or `undefined` when the axis has no slice window
 */
export function rangeArmOf(
    kind: PlanAxisKind,
    state: SliceStateValue | undefined,
    domainKind: "datetime" | "integer" | "float" | undefined,
): PlanRangeArm | undefined {
    if (kind === "time") return "datetime";
    if (kind === "ordinal") return undefined;
    const r = state !== undefined ? getSomeorUndefined(state.range) : undefined;
    if (r !== undefined && (r.type === "float" || r.type === "integer")) return r.type;
    return domainKind === "integer" ? "integer" : "float";
}

/**
 * A slice range value for a window `[min, max)` on the given arm — a REAL
 * East variant value (`variant`), never a `{ type, value }` literal.
 *
 * @param arm - The range arm (see {@link rangeArmOf})
 * @param min - The window start (an instant on the axis's arm)
 * @param max - The window end
 * @returns The `SliceRangeType` value to hand `setRange`
 */
export function rangeOf(arm: PlanRangeArm, min: PlanInstantValue, max: PlanInstantValue): SliceRangeValue {
    switch (arm) {
        case "datetime": {
            const from = min.type === "time" ? min.value : new Date(NaN);
            const to = max.type === "time" ? max.value : new Date(NaN);
            return variant("datetime", { from, to }) as SliceRangeValue;
        }
        case "float": {
            const from = min.type === "number" ? min.value : NaN;
            const to = max.type === "number" ? max.value : NaN;
            return variant("float", { from, to }) as SliceRangeValue;
        }
        case "integer": {
            const from = min.type === "number" ? BigInt(Math.round(min.value)) : 0n;
            const to = max.type === "number" ? BigInt(Math.round(max.value)) : 0n;
            return variant("integer", { from, to }) as SliceRangeValue;
        }
    }
}

/** What {@link resolveScale} needs — the declaration, the slice's say, the rows. */
export interface ResolveScaleArgs {
    /** The decoded root axis. */
    axis: PlanAxisValue;
    /** The bound slice's window on this axis's domain (see {@link sliceWindowOf}). */
    sliceWindow: readonly [number, number] | undefined;
    /** The bound slice's resolution tag, when it carries one (a time axis only). */
    sliceResolution: string | undefined;
    /** The decoded rows (the fit-to-data fallback). */
    rows: ReadonlyArray<PlanRowValue>;
    /** Whether the rows stream from a paged source — such a canvas must DECLARE its window (#567 D8). */
    paged: boolean;
}

/**
 * Resolve the scale: slice state ▸ the axis declaration ▸ fit-to-data (§3/§8).
 *
 * @remarks
 * A PAGED canvas must declare its window (or bind a slice range): fitting to
 * the data means fitting to whatever prefix has landed, so the axis would
 * widen and every bar re-flow as each window arrives (#567 D8). A fitted
 * window extends to whole periods, half-open. An ordinal axis needs nothing
 * resolved — its list is its window.
 *
 * @param args - See {@link ResolveScaleArgs}
 * @returns The scale, or `undefined` when no window can be resolved
 */
export function resolveScale({ axis, sliceWindow, sliceResolution, rows, paged }: ResolveScaleArgs): PlanScale | undefined {
    switch (axis.type) {
        case "time": {
            const a = axis.value;
            const declared = getSomeorUndefined(a.window);
            let window = sliceWindow !== undefined
                ? { min: new Date(sliceWindow[0]), max: new Date(sliceWindow[1]) }
                : (declared !== undefined ? { min: declared.min, max: declared.max } : undefined);
            const declaredResolution = sliceResolution ?? a.resolution.type;
            let res: PlanResolution;
            if (window === undefined) {
                if (paged) return undefined;
                const extent = dataExtent(rows, "time");
                if (extent === undefined) return undefined;
                const fitted = { min: new Date(extent.min), max: new Date(extent.max) };
                res = effectiveResolution(declaredResolution, fitted);
                // Extend the fitted extent to whole periods, half-open.
                const interval = resolutionInterval(res);
                window = { min: interval.floor(fitted.min), max: interval.offset(interval.floor(fitted.max), 1) };
            } else {
                res = effectiveResolution(declaredResolution, window);
            }
            return planScale({
                kind: "time", window, resolution: res,
                now: getSomeorUndefined(a.now), format: getSomeorUndefined(a.format),
            });
        }
        case "number": {
            const a = axis.value;
            const step = a.step;
            if (!Number.isFinite(step) || !(step > 0)) return undefined;
            const declared = getSomeorUndefined(a.window);
            let window = sliceWindow !== undefined
                ? { min: sliceWindow[0], max: sliceWindow[1] }
                : (declared !== undefined ? { min: declared.min, max: declared.max } : undefined);
            if (window === undefined) {
                if (paged) return undefined;
                const extent = dataExtent(rows, "number");
                if (extent === undefined) return undefined;
                // Whole steps, half-open — the `TimeResolution` rule, numerically.
                const eps = step * 1e-9;
                const floor = (n: number) => Math.floor((n + eps) / step) * step;
                window = { min: floor(extent.min), max: floor(extent.max) + step };
            }
            return planScale({
                kind: "number", window, step,
                now: getSomeorUndefined(a.now), format: getSomeorUndefined(a.format),
            });
        }
        case "ordinal":
            return planScale({ kind: "ordinal", values: axis.value.values, now: getSomeorUndefined(axis.value.now) });
    }
}
