/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    ArrayType,
    FloatType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

import { DensityType } from "../../style.js";
import type { DensityLiteral } from "../../style.js";
import { PlotGutterType, type PlotGutter } from "../../shared/plot-gutter.js";

/**
 * Colour encoding for a Trace's heat fills.
 *
 * @property brand - Sequential brand-tint ramp; one hue, intensity scales with value
 * @property diverge - Two-sided ramp centred on each track's midpoint (cool below, warm above)
 * @property categorical - One hue per track, intensity scales with value within the track
 */
export const TraceScaleType = VariantType({
    brand: NullType,
    diverge: NullType,
    categorical: NullType,
});
export type TraceScaleType = typeof TraceScaleType;
export type TraceScaleLiteral = "brand" | "diverge" | "categorical";

/**
 * How predicted steps (those at or after `now`) are distinguished from
 * measured steps.
 *
 * @property ghost - Lighter fill with a dashed heat-coloured edge (default)
 * @property hatch - As `ghost`, plus 45° hatch lines over the fill
 * @property fade - Edgeless, lowered opacity
 */
export const TraceFutureType = VariantType({
    ghost: NullType,
    hatch: NullType,
    fade: NullType,
});
export type TraceFutureType = typeof TraceFutureType;
export type TraceFutureLiteral = "ghost" | "hatch" | "fade";

/**
 * East StructType for one Trace track — a single measure rendered as a row of
 * value-encoded steps.
 *
 * @property name - Short stub label shown to the left of the row
 * @property values - One scalar per step; the heat fill normalises across this track's own min/max
 */
export const TraceTrackType = StructType({
    name: StringType,
    values: ArrayType(FloatType),
});
export type TraceTrackType = typeof TraceTrackType;

/**
 * Visual escape hatches for a Trace.
 *
 * @property brandColor - Override the heat hue used by the `brand` / `diverge` scales
 * @property nowLineColor - Override the colour of the now-line
 * @property labelWidth - Width of the left-hand track-name gutter (any CSS length); omit for the density default
 * @property plotGutter - Shared plot gutter (#147): pins the lane to `[left, W−right]` so a stacked Chart/Trace line up. `left` supersedes `labelWidth`; presence makes the lane fill the container (flexible steps)
 */
export const TraceStyleType = StructType({
    brandColor: OptionType(StringType),
    nowLineColor: OptionType(StringType),
    labelWidth: OptionType(StringType),
    plotGutter: OptionType(PlotGutterType),
});
export type TraceStyleType = typeof TraceStyleType;

/**
 * East StructType for a Trace value — mirrors the inline `Trace` variant
 * registered in `component.ts`. Defined here (not in `index.ts`) so
 * `component.ts` can import it without the `index.ts → component.ts` cycle.
 *
 * @property tracks - The measures, one row each
 * @property now - Step index of the continuous now-line; `[0, now)` measured, `[now, end)` predicted
 * @property axis - Optional per-step labels
 * @property density - Step + font sizing (shared cascade with `ChipRail`)
 * @property scale - Heat-fill colour encoding
 * @property future - How predicted steps are distinguished
 * @property style - Optional visual escape hatches
 */
export const TraceType = StructType({
    tracks: ArrayType(TraceTrackType),
    now: OptionType(IntegerType),
    axis: OptionType(ArrayType(StringType)),
    density: OptionType(DensityType),
    scale: OptionType(TraceScaleType),
    future: OptionType(TraceFutureType),
    style: OptionType(TraceStyleType),
});
export type TraceType = typeof TraceType;

/**
 * TypeScript shape for one track at the factory boundary.
 *
 * @property name - Short stub label shown to the left of the row
 * @property values - One scalar per step; the heat fill normalises across this track's own min/max
 */
export interface TraceTrack {
    /** Short stub label shown to the left of the row. */
    name: SubtypeExprOrValue<StringType>;
    /** One scalar per step; the heat fill normalises across this track's own min/max. */
    values: SubtypeExprOrValue<ArrayType<FloatType>>;
}

/**
 * TypeScript options bag for `Trace.Root` / the `<Trace>` tag.
 *
 * @property now - Step index of the continuous now-line; steps `[0, now)` read as measured, `[now, end)` as predicted. Omit for a measured-only trace with no line
 * @property density - Step + font sizing; shares the cascade with `ChipRail` so the two align in adjacent table cells
 * @property scale - Heat-fill colour encoding
 * @property future - How predicted steps are distinguished
 * @property axis - Optional per-step labels (ruler at `comfortable`, step tooltips at every density)
 * @property brandColor - Override the heat hue used by the `brand` / `diverge` scales
 * @property nowLineColor - Override the colour of the now-line
 */
export interface TraceOptions {
    /** Step index of the continuous now-line; `[0, now)` measured, `[now, end)` predicted. Omit for measured-only. */
    now?: SubtypeExprOrValue<IntegerType>;
    /** Step + font sizing; shares the cascade with `ChipRail`. */
    density?: SubtypeExprOrValue<DensityType> | DensityLiteral;
    /** Heat-fill colour encoding. */
    scale?: SubtypeExprOrValue<TraceScaleType> | TraceScaleLiteral;
    /** How predicted steps are distinguished. */
    future?: SubtypeExprOrValue<TraceFutureType> | TraceFutureLiteral;
    /** Optional per-step labels (ruler at `comfortable`, step tooltips always). */
    axis?: SubtypeExprOrValue<ArrayType<StringType>>;
    /** Override the heat hue used by the `brand` / `diverge` scales. */
    brandColor?: SubtypeExprOrValue<StringType>;
    /** Override the colour of the now-line. */
    nowLineColor?: SubtypeExprOrValue<StringType>;
    /** Width of the left-hand track-name gutter (any CSS length, e.g. `"120px"`); omit for the density default. */
    labelWidth?: SubtypeExprOrValue<StringType>;
    /** Shared plot gutter (#147) — pins the step lane to `[left, W−right]` (px) so a Trace stacked under a Chart lines up on a common x. `left` supersedes `labelWidth`; when present the steps become flexible (`1fr`) and the lane fills the container. Usually supplied by an enclosing `<AlignedStack>`. */
    plotGutter?: PlotGutter;
}
