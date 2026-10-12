/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The canvas axis, resolved (#631) — from the decoded root `axis` (one of
 * the three arms) and the bound slice's range / resolution state to the one
 * `PlanScale` every row positions against; plus the slice bridge the other
 * way: a window WRITE (the brush, `[` / `]` / `n`, the narrow pan) becomes the
 * range arm the slice's field speaks — `datetime` for a time axis, `float` /
 * `integer` for a number axis, nothing for an ordinal one (its list is its
 * window).
 *
 * The window is never fitted to the rows (#822): it is the slice's range or
 * the axis's stated window, so the canvas reads the same inline and paged,
 * and rows landing or changing never move it.
 *
 * @packageDocumentation
 */

import { variant, type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/e3-ui/internal";
import { Slice } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import { effectiveResolution, planScale, type PlanScale } from "./scale.js";
import type { PlanAxisKind, PlanInstantValue } from "./instant.js";
import type { PlanWords } from "./words.js";

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

/**
 * Whether the axis states its own window — a time or number axis's `window`;
 * an ordinal axis's list is its window. An axis that states none takes its
 * window from the bound slice's range (#822).
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

/**
 * The bound slice's applied window on the axis's own domain — the HALF-OPEN
 * `[from, to)` the canvas draws, as numbers (epoch ms / values), or
 * `undefined` when the slice carries no literal range of the arm this axis
 * reads: `datetime` for a time axis, `float` / `integer` for a number axis,
 * never for an ordinal one.
 *
 * @remarks
 * A slice range is CLOSED — both ends inclusive (`Slice.Types.Range`) — so the
 * read is the inverse of {@link rangeOf}, on the field's own lattice:
 * - an `integer` range counts its values: `[1, 8]` is the eight steps
 *   `[1, 9)`;
 * - a `datetime` / `float` range is continuous: its end reads as the window's
 *   end, and the scale's whole periods (`planScale`) carry a window the canvas
 *   wrote — ending a millisecond, or one float, short of a period edge — back
 *   to that edge. A range an author seeds ON an edge (`{ from: w27, to: w39 }`)
 *   ends there.
 *
 * Returns PRIMITIVES so a caller can key a memo on them. The decoded state is a
 * fresh object every read, so its `range` can never be a stable dependency.
 *
 * @param state - The decoded slice state, when a slice is bound
 * @param kind - The axis kind
 * @returns `[fromN, toN)` for a non-empty range of the matching arm, else `undefined`
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
        to = Number(r.value.to) + 1;
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
 * @remarks
 * A slice range is CLOSED — both ends inclusive (`Slice.Types.Range`) — and
 * the window is half-open, so the range ends at the LAST value before `max` on
 * the field's own lattice: `max − 1` on an integer field, a millisecond before
 * it on a datetime, the next float down on a float. The slice then keeps
 * exactly the rows the canvas draws — a row at `max` sits in the period after
 * the window, off the canvas, and no longer counts in its summary — and the
 * range chip, which prints the stored bounds, reads an eight-step window as
 * `1–8` (#949). {@link sliceWindowOf} reads it back.
 *
 * @param arm - The range arm (see {@link rangeArmOf})
 * @param min - The window start (an instant on the axis's arm)
 * @param max - The window end, exclusive
 * @returns The `SliceRangeType` value to hand `setRange`
 */
export function rangeOf(arm: PlanRangeArm, min: PlanInstantValue, max: PlanInstantValue): SliceRangeValue {
    switch (arm) {
        case "datetime": {
            const from = min.type === "time" ? min.value : new Date(NaN);
            const to = max.type === "time" ? new Date(max.value.getTime() - 1) : new Date(NaN);
            return variant("datetime", { from, to }) as SliceRangeValue;
        }
        case "float": {
            const from = min.type === "number" ? min.value : NaN;
            const to = max.type === "number" ? nextDown(max.value) : NaN;
            return variant("float", { from, to }) as SliceRangeValue;
        }
        case "integer": {
            const from = min.type === "number" ? BigInt(Math.round(min.value)) : 0n;
            const to = max.type === "number" ? BigInt(Math.round(max.value)) - 1n : 0n;
            return variant("integer", { from, to }) as SliceRangeValue;
        }
    }
}

/**
 * The largest double below `x` — the float lattice's value before an end, as
 * {@link rangeOf} closes a window on a float field.
 *
 * @param x - The value
 * @returns The next double down (`x` itself when it is not finite)
 */
function nextDown(x: number): number {
    if (!Number.isFinite(x)) return x;
    if (x === 0) return -Number.MIN_VALUE;
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, x);
    const bits = view.getBigUint64(0);
    view.setBigUint64(0, x > 0 ? bits - 1n : bits + 1n);
    return view.getFloat64(0);
}

/** What {@link resolveScale} needs — the declaration and the slice's say. */
export interface ResolveScaleArgs {
    /** The decoded root axis. */
    axis: PlanAxisValue;
    /** The bound slice's window on this axis's domain (see {@link sliceWindowOf}). */
    sliceWindow: readonly [number, number] | undefined;
    /** The bound slice's resolution tag, when it carries one (a time axis only). */
    sliceResolution: string | undefined;
    /** The canvas's words — the locale its ruler labels format in (#820); the default English `en-US` words when omitted. */
    words?: PlanWords | undefined;
}

/**
 * Resolve the scale: the slice's range ▸ the axis's stated window (§3/§8).
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
export function resolveScale({ axis, sliceWindow, sliceResolution, words }: ResolveScaleArgs): PlanScale | undefined {
    switch (axis.type) {
        case "time": {
            const a = axis.value;
            const declared = getSomeorUndefined(a.window);
            const window = sliceWindow !== undefined
                ? { min: new Date(sliceWindow[0]), max: new Date(sliceWindow[1]) }
                : (declared !== undefined ? { min: declared.min, max: declared.max } : undefined);
            if (window === undefined) return undefined;
            const res = effectiveResolution(sliceResolution ?? a.resolution.type, window);
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
