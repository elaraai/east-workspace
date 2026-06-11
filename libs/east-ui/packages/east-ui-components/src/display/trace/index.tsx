/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Read-only inline heatmap: tracks × steps, value-encoded fills, with a
 * continuous now-line dividing measured steps from predicted ones.
 *
 * The recipe (`theme/slot-recipes/trace.ts`) owns density sizing + static
 * chrome; this renderer computes the dynamic parts — grid column count,
 * per-step heat fill, and the now-line position.
 */

import { memo, Fragment, useMemo } from "react";
import { Box as ChakraBox, useSlotRecipe } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Trace } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { useDensity, type Density } from "../../contracts/density";

const traceEqual = equalFor(Trace.Types.Trace);

/** East Trace value type. */
export type TraceValue = ValueTypeOf<typeof Trace.Types.Trace>;

/** Heat hue per categorical track, by track index. */
const CATEGORICAL = [
    "var(--chakra-colors-brand-600)",
    "var(--chakra-colors-orange-500)",
    "var(--chakra-colors-purple-500)",
    "var(--chakra-colors-cyan-600)",
    "var(--chakra-colors-pink-500)",
];
/** Warm pole of the diverging ramp (cool pole is the brand hue). */
const DIVERGE_WARM = "var(--chakra-colors-orange-500)";
const PAST_BASE = "var(--chakra-colors-bg-muted)";
const FUTURE_BASE = "var(--chakra-colors-bg-surface)";

function fmt(v: number): string {
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** Resolved fill for one step. */
interface Fill {
    fill: string;
    edge: string;
    hot: boolean;
}

function computeFill(
    v: number, min: number, max: number, mid: number,
    scale: string, hue: string, future: boolean,
): Fill {
    if (scale === "diverge") {
        const half = Math.max(max - mid, mid - min) || 1;
        const sgn = (v - mid) / half;
        const edge = sgn >= 0 ? DIVERGE_WARM : hue;
        const t = Math.min(Math.abs(sgn), 1);
        const base = future ? FUTURE_BASE : PAST_BASE;
        const pct = future ? t * 34 : t * 80;
        return { fill: `color-mix(in srgb, ${edge} ${pct.toFixed(0)}%, ${base})`, edge, hot: !future && t > 0.62 };
    }
    const t = max > min ? (v - min) / (max - min) : 0.5;
    const base = future ? FUTURE_BASE : PAST_BASE;
    const pct = future ? t * 42 : t * 100;
    return { fill: `color-mix(in srgb, ${hue} ${pct.toFixed(0)}%, ${base})`, edge: hue, hot: !future && t > 0.6 };
}

export interface EastChakraTraceProps {
    value: TraceValue;
    storageKey: string;
}

export const EastChakraTrace = memo(function EastChakraTrace({ value, storageKey }: EastChakraTraceProps) {
    const recipe = useSlotRecipe({ key: "trace" });
    const inheritedDensity = useDensity();
    const localDensity = useMemo(() => getSomeorUndefined(value.density)?.type, [value.density]);
    const density: Density = localDensity ?? inheritedDensity ?? "comfortable";
    const styles = recipe({ density });

    const scale = useMemo(() => getSomeorUndefined(value.scale)?.type ?? "brand", [value.scale]);
    const future = useMemo(() => getSomeorUndefined(value.future)?.type ?? "ghost", [value.future]);
    const axis = useMemo(() => getSomeorUndefined(value.axis), [value.axis]);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const brandHue = (style ? getSomeorUndefined(style.brandColor) : undefined) ?? "var(--chakra-colors-brand-600)";
    const nowColor = style ? getSomeorUndefined(style.nowLineColor) : undefined;

    const nowRaw = useMemo(() => getSomeorUndefined(value.now), [value.now]);
    const now = nowRaw !== undefined ? Number(nowRaw) : undefined;

    const tracks = value.tracks;
    const steps = tracks.length > 0 ? tracks[0]!.values.length : 0;
    const columns = `var(--t-stub-w) repeat(${steps}, var(--t-step-w))`;
    const showNow = now !== undefined && now > 0 && now < steps;
    // x of the now-line: past the stub, past `now` step columns + their gaps,
    // back-shifted half a gap to sit between the measured and predicted steps.
    const nowLeft = `calc(var(--t-stub-w) + var(--t-gap) + ${now} * (var(--t-step-w) + var(--t-gap)) - var(--t-gap) / 2)`;

    const showAxis = density === "comfortable" && axis !== undefined && axis.length > 0;

    return (
        <ChakraBox css={styles.root} data-future={future}>
            {showAxis && (
                <ChakraBox css={styles.axis} style={{ gridTemplateColumns: columns }}>
                    <span />
                    {Array.from({ length: steps }, (_, k) => (
                        <ChakraBox key={`ax.${k}`} css={styles.axisCell}>{axis![k] ?? ""}</ChakraBox>
                    ))}
                </ChakraBox>
            )}
            <ChakraBox css={styles.grid} style={{ gridTemplateColumns: columns }} position="relative">
                {tracks.map((track, ti) => {
                    const values = track.values as unknown as number[];
                    const min = Math.min(...values);
                    const max = Math.max(...values);
                    const mid = (min + max) / 2;
                    const hue = scale === "categorical" ? CATEGORICAL[ti % CATEGORICAL.length]! : brandHue;
                    return (
                        <Fragment key={`${storageKey}.track.${ti}`}>
                            <ChakraBox css={styles.stub}>{track.name}</ChakraBox>
                            {values.map((v, i) => {
                                const isFuture = now !== undefined && i >= now;
                                const { fill, edge, hot } = computeFill(v, min, max, mid, scale, hue, isFuture);
                                const stepStyle: Record<string, string> = { background: fill };
                                if (isFuture) {
                                    stepStyle.color = edge;
                                    stepStyle.fontStyle = "italic";
                                    if (future === "fade") {
                                        stepStyle.opacity = "0.7";
                                    } else {
                                        stepStyle.borderColor = edge;
                                        stepStyle.borderStyle = "dashed";
                                    }
                                    if (future === "hatch") {
                                        stepStyle.backgroundImage = `repeating-linear-gradient(-45deg, transparent 0 5px, color-mix(in srgb, ${edge} 12%, transparent) 5px 6px)`;
                                    }
                                } else if (hot) {
                                    stepStyle.color = "var(--chakra-colors-bg-surface)";
                                }
                                const title = `${axis?.[i] ? `${axis[i]} · ` : ""}${track.name} ${fmt(v)} · ${isFuture ? "predicted" : "measured"}`;
                                return (
                                    <ChakraBox key={`step.${ti}.${i}`} css={styles.step} style={stepStyle} title={title}>
                                        <ChakraBox as="span" css={styles.value}>{fmt(v)}</ChakraBox>
                                    </ChakraBox>
                                );
                            })}
                        </Fragment>
                    );
                })}
                {showNow && (
                    <ChakraBox
                        css={styles.now}
                        style={{ left: nowLeft, ...(nowColor ? { background: nowColor } : {}) }}
                    />
                )}
            </ChakraBox>
        </ChakraBox>
    );
}, (prev, next) => traceEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
