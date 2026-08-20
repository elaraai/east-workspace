/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Span rows (`Plan Spec.md` §4·K1) — continuous `[start, end)` state-run bars
 * on the shared scale, plus factory-computed rollup bands, decision diamonds
 * and quantity ports. The §4.3 run-state truth table maps `EventStateType` to
 * the recipe `bar` slot's `data-state` axis; `status: warning` adds the
 * `.stuck` warn ring; a run crossing either window edge keeps its TRUE
 * geometry and mask-fades at the edge (`data-runoff` / `data-runon`) — never
 * a fabricated end OR start (#620). Popovers / hovercards
 * resolve through the root's generalized resolvers ({@link ElementOverlays});
 * decision diamonds ride the `mark` arm of the element ref.
 */

import { useMemo } from "react";
import { Box, Portal, Tooltip } from "@chakra-ui/react";
import { variant, type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { usePlanDispatch, usePlanResolvers, usePlanScale, type PlanElementRefValue } from "../context.js";
import { ElementOverlays } from "./ElementOverlays.js";
import type { DerivedBand } from "../model.js";

type Styles = Record<string, Record<string, unknown>>;
type SpanKindValue = Extract<ValueTypeOf<typeof Plan.Types.Row>["kind"], { type: "span" }>["value"];
type RunValue = ValueTypeOf<typeof Plan.Types.Run>;

/** EventState → the recipe `data-state` key (the §4.3 truth table). */
export function runStateKey(state: RunValue["state"]): "obs" | "appr" | "prop" | "propRemoved" | "estimated" | "rejected" {
    switch (state.type) {
        case "actual":
        case "in-progress": return "obs";
        case "confirmed": return "appr";
        case "proposed": return state.value.type === "removed" ? "propRemoved" : "prop";
        case "estimated": return "estimated";
        case "rejected": return "rejected";
    }
}



export interface SpanRowProps {
    /** R2 context strip (#591) — render this row's marks at strip size. */
    ctx?: boolean | undefined;

    rowKey: string;
    kind: SpanKindValue;
    /** Renderer-derived rollup bands (the IR carries only the declaration). */
    bands: readonly DerivedBand[];
    styles: Styles;
    /** Bar height (20 default / 16 dense; the §8 sheet). */
    barHeight: number;
    storageKey: string;
    /** Whether the derived bands cover an INCOMPLETE prefix (a paged canvas
     *  still loading) — their captions print `~×2 · 276 t` (#567 D9). */
    partial?: boolean | undefined;
}

/** The span-row plot content — bars, rollup bands, diamonds, ports. */
export function SpanRow({ rowKey, kind, bands: rollBands, styles, barHeight, storageKey, partial, ctx }: SpanRowProps) {
    const ctxAttr = ctx === true ? "" : undefined;
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    const { onElementClick } = usePlanResolvers();

    const bars = useMemo(() => kind.runs.map((run) => {
        const f0 = scale.fracOf(run.start);
        const f1 = scale.fracOf(run.end);
        // Cull against the RENDER bounds (#619 — the schematic's
        // viewport-cull discipline, one axis) and mount at TRUE geometry,
        // always (#620): a window-clamped straddler translated by a brush
        // pan was a lie — its box slid at the clamped length, then popped to
        // the truth at the settle. The window-edge chrome is re-expressed in
        // BAR-LOCAL fractions of the true box so the at-rest pixels match
        // the old clamped form: the runoff fade lands on the same screen
        // stops, the label pins to the window edge via computed padding, and
        // a run STARTING before the window fades in symmetrically instead of
        // drawing a fabricated hard start (§4.3's "never a fabricated end",
        // applied to starts — a deliberate rest change).
        if (f1 <= scale.renderMin || f0 >= scale.renderMax) return null;
        const width = f1 - f0;
        if (!(width > 0)) return null;
        const runoff = f1 > 1 && f0 < 1;
        const runon = f0 < 0 && f1 > 0;
        // The visible span in bar-local fractions — the mask stops and the
        // label pin are computed against it.
        const vL = runon ? -f0 / width : 0;
        const vR = runoff ? (1 - f0) / width : 1;
        const vis = Math.max(vR - vL, 0);
        const mask = runoff || runon
            ? `linear-gradient(to right, ${runon
                ? `transparent ${(100 * (vL + 0.01 * vis)).toFixed(2)}%, black ${(100 * (vL + 0.16 * vis)).toFixed(2)}%`
                : "black 0%"}, ${runoff
                ? `black ${(100 * (vL + 0.84 * vis)).toFixed(2)}%, transparent ${(100 * (vL + 0.99 * vis)).toFixed(2)}%`
                : "black 100%"})`
            : undefined;
        const labelPad = runon ? `calc(${(vL * 100).toFixed(4)}% + 7px)` : undefined;
        return { run, left: f0, width, runoff, runon, mask, labelPad };
    }).filter((b): b is NonNullable<typeof b> => b !== null), [kind.runs, scale]);

    return (
        <>
            {bars.map(({ run, left, width, runoff, runon, mask, labelPad }) => {
                const stateKey = runStateKey(run.state);
                const stuck = run.status.type === "some" && run.status.value.type === "warning";
                const qty = run.quantity.type === "some" ? run.quantity.value : undefined;
                const moved = run.moved.type === "some" ? Number(run.moved.value) : undefined;
                const ref = variant("run", { row: rowKey, run: run.key }) as PlanElementRefValue;
                const bar = (
                    <Box
                        css={styles.bar}
                        data-ctx={ctxAttr}
                        data-state={stateKey}
                        data-stuck={stuck ? "" : undefined}
                        data-runoff={runoff ? "" : undefined}
                        data-runon={runon ? "" : undefined}
                        data-run={run.key}
                        height={`${barHeight}px`}
                        // Geometry + edge chrome as INLINE style: computed
                        // per bar, and inline always wins over the recipe's
                        // fixed `data-runoff` stops.
                        style={{
                            left: `${(left * 100).toFixed(4)}%`,
                            width: `${(width * 100).toFixed(4)}%`,
                            ...(mask !== undefined ? { maskImage: mask, WebkitMaskImage: mask } : {}),
                            ...(labelPad !== undefined ? { paddingLeft: labelPad } : {}),
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            dispatch({ t: "row.select", key: rowKey });
                            onElementClick?.(ref);
                        }}
                    >
                        <Box as="span" overflow="hidden" textOverflow="ellipsis" minW={0}>{run.label}</Box>
                        {qty !== undefined && <Box as="span" css={styles.barQty}>{qty}</Box>}
                        {moved !== undefined && moved > 0 && <Box as="span" css={styles.barQty}>{`moved ×${moved}`}</Box>}
                    </Box>
                );
                return (
                    <ElementOverlays key={run.key}
                        elementRef={ref} styles={styles}
                        storageKey={`${storageKey}.${run.key}`}>
                        {bar}
                    </ElementOverlays>
                );
            })}
            {rollBands.map((band, i) => {
                const f0 = scale.fracOf(band.from);
                const f1 = scale.fracOf(band.to);
                // True geometry + render-bounds cull (#620, the bar rule).
                // The centred caption pads back into the VISIBLE span so a
                // straddling band's caption sits where the clamped form put
                // it at rest.
                if (f1 <= scale.renderMin || f0 >= scale.renderMax) return null;
                const width = f1 - f0;
                if (!(width > 0)) return null;
                const counts = [band.count > 1 ? `×${band.count}` : undefined, band.quantity].filter(Boolean).join(" · ");
                // A rollup over a partial prefix is an understatement, not a
                // number — mark it rather than print it as if it were final.
                const caption = partial === true && counts !== "" ? `~${counts}` : counts;
                return (
                    <Box key={`band-${i}`} css={styles.rollBand} data-state={runStateKey(band.state)} data-ctx={ctxAttr}
                        data-plan-partial={partial === true ? "" : undefined}
                        style={{
                            left: `${(f0 * 100).toFixed(4)}%`,
                            width: `${(width * 100).toFixed(4)}%`,
                            ...(f0 < 0 && f1 > 0 ? { paddingLeft: `${((-f0 / width) * 100).toFixed(4)}%` } : {}),
                            ...(f1 > 1 && f0 < 1 ? { paddingRight: `${(((f1 - 1) / width) * 100).toFixed(4)}%` } : {}),
                        }}>
                        {caption}
                    </Box>
                );
            })}
            {kind.ports.map((port, i) => {
                const x = scale.fracOf(port.at);
                // Point marks cull to the render bounds (#619) — overscan
                // ports sit clipped at rest and slide in on a brush pan.
                if (x <= scale.renderMin || x >= scale.renderMax) return null;
                const label = port.label.type === "some" ? port.label.value : undefined;
                if (label === undefined) return <Box key={`port-${i}`} css={styles.port} left={`${x * 100}%`} />;
                // The design-system tooltip, never the native `title=` — the
                // same overlay every other labelled mark uses (#617; the
                // BucketsRow marker precedent).
                return (
                    <Tooltip.Root key={`port-${i}`} openDelay={150}>
                        <Tooltip.Trigger asChild>
                            <Box css={styles.port} left={`${x * 100}%`} />
                        </Tooltip.Trigger>
                        <Portal>
                            <Tooltip.Positioner>
                                <Tooltip.Content>{label}</Tooltip.Content>
                            </Tooltip.Positioner>
                        </Portal>
                    </Tooltip.Root>
                );
            })}
            {kind.decisions.map((dec) => {
                const x = scale.fracOf(dec.at);
                if (x <= scale.renderMin || x >= scale.renderMax) return null;
                const ref = variant("mark", { row: rowKey, mark: dec.key }) as PlanElementRefValue;
                const diamond = (
                    <Box css={styles.diamond} data-applied={dec.applied ? "" : undefined} data-ctx={ctxAttr}
                        data-mark={dec.key} left={`${x * 100}%`}
                        onClick={(e) => { e.stopPropagation(); onElementClick?.(ref); }} cursor="pointer" />
                );
                return (
                    <ElementOverlays key={dec.key}
                        elementRef={ref} styles={styles}
                        storageKey={`${storageKey}.${dec.key}`}>
                        {diamond}
                    </ElementOverlays>
                );
            })}
        </>
    );
}
