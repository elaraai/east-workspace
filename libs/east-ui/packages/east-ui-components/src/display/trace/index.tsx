/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Read-only inline heatmap: tracks × steps, value-encoded fills, with a
 * continuous now-line dividing measured steps from predicted ones.
 *
 * The recipe (`theme/slot-recipes/trace.ts`) owns density sizing, static
 * chrome and every scale's fills; this renderer computes the dynamic parts —
 * grid column count, each step's level on its ramp, an author's own hue, and
 * the now-line position.
 */

import { memo, Fragment, useEffect, useMemo } from "react";
import { Box as ChakraBox, useChakraContext, useSlotRecipe } from "@chakra-ui/react";
import { equivalentFor, type ValueTypeOf } from "@elaraai/east";
import { Trace } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { resolveColor } from "../../collections/shared/helpers.js";
import { useDensity, type Density } from "../../contracts/density";
import { usePlotGutter } from "../../contracts/plot-gutter.js";
import { useFormatters } from "../../format/index.js";

const traceEqual = equivalentFor(Trace.Types.Trace);

/** East Trace value type. */
export type TraceValue = ValueTypeOf<typeof Trace.Types.Trace>;

/** The design system's series order a categorical scale's tracks take, in turn: the brand, then teal, purple, blue and orange. */
const SERIES = 5;

export interface EastChakraTraceProps {
    value: TraceValue;
    storageKey: string;
}

export const EastChakraTrace = memo(function EastChakraTrace({ value, storageKey }: EastChakraTraceProps) {
    const system = useChakraContext();
    const recipe = useSlotRecipe({ key: "trace" });
    const inheritedDensity = useDensity();
    const localDensity = useMemo(() => getSomeorUndefined(value.density)?.type, [value.density]);
    const density: Density = localDensity ?? inheritedDensity ?? "comfortable";
    const styles = recipe({ density });
    // Step values as bare ticks — whole, else one decimal, never grouped — in
    // the app's locale (#850).
    const words = useFormatters();

    const scale = useMemo(() => getSomeorUndefined(value.scale)?.type ?? "brand", [value.scale]);
    const future = useMemo(() => getSomeorUndefined(value.future)?.type ?? "ghost", [value.future]);
    const axis = useMemo(() => getSomeorUndefined(value.axis), [value.axis]);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const ownHue = style ? getSomeorUndefined(style.brandColor) : undefined;
    // Every scale's fills are the recipe's, drawn from each step's level so their values read on them in both themes:
    // the brand scale's on the design system's heat ramp, the categorical scale's on its series hues built the same
    // way, the diverging scale's on the brand's ramp below each track's midpoint and the warning hue's above it. An
    // author's hue — a theme colour's name (`"accent.purple"`) or a CSS colour — takes the brand's place, its steps
    // built as the series hues' are.
    const hue = ownHue === undefined || scale === "categorical" ? undefined : resolveColor(system, ownHue);
    const nowColor = style ? getSomeorUndefined(style.nowLineColor) : undefined;
    // Optional label-gutter width override (#137) — overrides the density
    // default `--t-stub-w`, which both the grid columns and now-line read.
    const labelWidth = style ? getSomeorUndefined(style.labelWidth) : undefined;
    // Shared plot gutter (#147) — own prop wins over an inherited plot-gutter
    // context. When active the step lane fills [left, W−right] via leading/trailing
    // gutter tracks (the flexible step columns keep their inter-cell gap) so the
    // lane lines up with a stacked Chart's plot.
    const ctxGutter = usePlotGutter();
    const ownGutter = useMemo(() => (style ? getSomeorUndefined(style.plotGutter) : undefined), [style]);
    const gLeft = (ownGutter ? getSomeorUndefined(ownGutter.left) : undefined) ?? ctxGutter?.left;
    const gRight = (ownGutter ? getSomeorUndefined(ownGutter.right) : undefined) ?? ctxGutter?.right;
    const gutterActive = gLeft !== undefined || gRight !== undefined;
    const leftCol = gLeft ?? labelWidth ?? "var(--t-stub-w)";
    const rightCol = gRight ?? "0px";

    const nowRaw = useMemo(() => getSomeorUndefined(value.now), [value.now]);
    const now = nowRaw !== undefined ? Number(nowRaw) : undefined;

    const tracks = value.tracks;
    // Tracks share one step grid; size it to the LONGEST track so a longer
    // track can't auto-flow its surplus cells onto a new, stub-less row (#126).
    // Shorter tracks are padded with empty trailing cells (below) so each track
    // stays on exactly one grid row.
    const steps = tracks.reduce((m, t) => Math.max(m, t.values.length), 0);
    const columns = gutterActive
        ? `${leftCol} repeat(${steps}, minmax(0, 1fr)) ${rightCol}`
        : `var(--t-stub-w) repeat(${steps}, var(--t-step-w))`;
    // Under the gutter the step tracks must tile EDGE-TO-EDGE so each cell's
    // centre lands on the chart's band centre (#147); a column `gap` redistributes
    // into the flexible tracks and drifts the outer cells off-axis (accumulating to
    // ~±1.3px by step 6). Drop the column gap (keep the row gap between tracks) and
    // restore the inter-cell space as a symmetric per-cell `marginInline` below —
    // symmetric insets leave the cell centre on the track centre.
    const gutterGap = gutterActive ? ({ columnGap: "0px" } as React.CSSProperties) : undefined;

    // Tracks are expected to share one step grid (equal lengths). Ragged tracks
    // are now padded rather than producing a phantom row, but surface the
    // mismatch so authors can correct the data.
    useEffect(() => {
        if (tracks.length < 2) return;
        const lens = tracks.map(t => t.values.length);
        if (lens.some(l => l !== lens[0])) {
            console.warn(`<Trace>: tracks have unequal value lengths [${lens.join(", ")}]; short tracks padded to ${steps} steps — tracks are expected to share one step grid.`);
        }
    }, [tracks, steps]);
    const showNow = now !== undefined && now > 0 && now < steps;
    // x of the now-line: past the stub, past `now` step columns + their gaps,
    // back-shifted half a gap to sit between the measured and predicted steps.
    const nowLeft = gutterActive
        ? `calc(${leftCol} + (100% - ${leftCol} - ${rightCol}) * ${now} / ${steps})`
        : `calc(var(--t-stub-w) + var(--t-gap) + ${now} * (var(--t-step-w) + var(--t-gap)) - var(--t-gap) / 2)`;

    const showAxis = density === "comfortable" && axis !== undefined && axis.length > 0;

    return (
        <ChakraBox
            css={styles.root}
            data-future={future}
            {...(gutterActive ? { display: "block", width: "100%" } : {})}
            style={{
                ...(labelWidth !== undefined ? { ["--t-stub-w"]: labelWidth } : {}),
                ...(hue !== undefined ? { ["--t-hue"]: hue } : {}),
            } as React.CSSProperties}
        >
            {showAxis && (
                <ChakraBox css={styles.axis} style={{ gridTemplateColumns: columns, ...gutterGap }}>
                    <span />
                    {Array.from({ length: steps }, (_, k) => (
                        <ChakraBox key={`ax.${k}`} css={styles.axisCell}>{axis![k] ?? ""}</ChakraBox>
                    ))}
                    {gutterActive && <span />}
                </ChakraBox>
            )}
            <ChakraBox css={styles.grid} style={{ gridTemplateColumns: columns, ...gutterGap }} position="relative">
                {tracks.map((track, ti) => {
                    const values = track.values as unknown as number[];
                    const min = Math.min(...values);
                    const max = Math.max(...values);
                    const mid = (min + max) / 2;
                    // A categorical track's place in the series order; the first is the brand's own ramp, as the brand scale's.
                    const series = scale === "categorical" ? ti % SERIES : 0;
                    return (
                        <Fragment key={`${storageKey}.track.${ti}`}>
                            <ChakraBox css={styles.stub} title={track.name}>{track.name}</ChakraBox>
                            {values.map((v, i) => {
                                const isFuture = now !== undefined && i >= now;
                                const title = `${axis?.[i] ? `${axis[i]} · ` : ""}${track.name} ${words.tick(v)} · ${isFuture ? "predicted" : "measured"}`;
                                // Gutter mode drops the grid column gap for exact
                                // axis alignment; put the inter-cell space back as a
                                // symmetric margin so the cell centre stays on-track.
                                const gap = gutterActive ? { marginInline: "calc(var(--t-gap) / 2)" } : undefined;
                                // Diverging, a step's side of the track's midpoint and its distance from it in three
                                // equal steps, its ramp's first, second or fourth; else five equal-width steps of the
                                // track's range, the top one closed. A predicted step takes its ramp's lighter steps —
                                // the first two, or three — so it reads paler than a measured one.
                                const d = scale === "diverge" ? (v - mid) / (Math.max(max - mid, mid - min) || 1) : undefined;
                                const t = d !== undefined ? Math.min(Math.abs(d), 1) : max > min ? (v - min) / (max - min) : 0.5;
                                const level = d !== undefined
                                    ? [0, 1, 3][isFuture ? Math.min(1, Math.floor(t * 2)) : Math.min(2, Math.floor(t * 3))]
                                    : (isFuture ? Math.min(2, Math.floor(t * 3)) : Math.min(4, Math.floor(t * 5)));
                                const side = d === undefined ? undefined : d >= 0 ? "above" : "below";
                                return (
                                    <ChakraBox key={`step.${ti}.${i}`} css={styles.step} style={gap} title={title}
                                        data-level={level} data-side={side} data-series={series > 0 ? series : undefined}
                                        data-hue={hue !== undefined && side !== "above" ? "" : undefined}
                                        data-predicted={isFuture ? "" : undefined}>
                                        <ChakraBox as="span" css={styles.value}>{words.tick(v)}</ChakraBox>
                                    </ChakraBox>
                                );
                            })}
                            {/* Pad a short track to the shared step count so its
                                row stays full and the next track's stub starts
                                on a fresh row instead of wrapping into this one (#126). */}
                            {Array.from({ length: steps - values.length }, (_, k) => (
                                <span key={`pad.${ti}.${k}`} aria-hidden="true" />
                            ))}
                            {/* trailing right-gutter cell so the lane ends at W−right (#147) */}
                            {gutterActive && <span key={`rpad.${ti}`} aria-hidden="true" />}
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
