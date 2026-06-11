/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    ArrayType,
    East,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { DensityType } from "../../style.js";
import {
    TraceScaleType,
    TraceFutureType,
    TraceTrackType,
    TraceStyleType,
    TraceType,
    type TraceTrack,
    type TraceOptions,
} from "./types.js";

export {
    TraceScaleType,
    TraceFutureType,
    TraceTrackType,
    TraceStyleType,
    TraceType,
    type TraceScaleLiteral,
    type TraceFutureLiteral,
    type TraceTrack,
    type TraceOptions,
} from "./types.js";

function buildTrack(track: TraceTrack): ExprType<TraceTrackType> {
    return East.value({
        name: track.name,
        values: track.values,
    }, TraceTrackType);
}

function buildStyle(options: TraceOptions | undefined): ExprType<TraceStyleType> | undefined {
    if (options === undefined) return undefined;
    if (options.brandColor === undefined && options.nowLineColor === undefined) return undefined;
    return East.value({
        brandColor: options.brandColor !== undefined ? some(options.brandColor) : none,
        nowLineColor: options.nowLineColor !== undefined ? some(options.nowLineColor) : none,
    }, TraceStyleType);
}

/**
 * Trace — a read-only inline heatmap of one or more measures over a shared
 * step axis, with a continuous now-line dividing measured past from predicted
 * future.
 *
 * @param tracks - One row per measure, each `{ name, values }`
 * @param options - Optional config: `now`, `density`, `scale`, `future`, `axis`, colour overrides
 * @returns An East expression of type `UIComponentType`
 *
 * @remarks
 * Read-only by construction — no events, no commit, no drag. Each track's heat
 * fill normalises across its own min/max; tracks share one step grid, so `now`
 * (a single index) draws one line spanning every row. `density` shares the
 * cascade with `ChipRail`, so a Trace cell and a ChipRail cell line up in
 * adjacent table columns.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Trace, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, _$ => {
 *     return Trace.Root([
 *         { name: "A", values: [12, 14, 13, 18, 20, 22] },
 *         { name: "B", values: [40, 38, 35, 30, 28, 25] },
 *     ], { now: 4, density: "compact", scale: "brand" });
 * });
 * ```
 */
function createTrace(
    tracks: TraceTrack[],
    options?: TraceOptions,
): ExprType<UIComponentType> {
    const densityValue = options?.density !== undefined
        ? (typeof options.density === "string"
            ? East.value(variant(options.density, null), DensityType)
            : options.density)
        : undefined;
    const scaleValue = options?.scale !== undefined
        ? (typeof options.scale === "string"
            ? East.value(variant(options.scale, null), TraceScaleType)
            : options.scale)
        : undefined;
    const futureValue = options?.future !== undefined
        ? (typeof options.future === "string"
            ? East.value(variant(options.future, null), TraceFutureType)
            : options.future)
        : undefined;
    const styleValue = buildStyle(options);

    return East.value(variant("Trace", {
        tracks: East.value(tracks.map(buildTrack), ArrayType(TraceTrackType)),
        now: options?.now !== undefined ? some(options.now) : none,
        axis: options?.axis !== undefined ? some(options.axis) : none,
        density: densityValue ? some(densityValue) : none,
        scale: scaleValue ? some(scaleValue) : none,
        future: futureValue ? some(futureValue) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

/**
 * Trace namespace.
 */
export const Trace = {
    Root: createTrace,
    /**
     * Builds a single track value — the data-driven companion to the plain
     * `{ name, values }` objects accepted by `Trace.Root`, for tracks mapped
     * from East data.
     */
    Track: buildTrack,
    Types: {
        /** The East struct for the `Trace` variant payload — used by the renderer's memoisation. */
        Trace: TraceType,
        /** The East struct for one track. */
        Track: TraceTrackType,
        /** Heat-fill colour-encoding enum. */
        Scale: TraceScaleType,
        /** Predicted-step distinction enum. */
        Future: TraceFutureType,
        /** Visual escape-hatch struct. */
        Style: TraceStyleType,
    },
} as const;
