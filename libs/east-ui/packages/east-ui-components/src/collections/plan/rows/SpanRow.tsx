/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Span rows (`Plan Spec.md` §4·K1) — continuous `[start, end)` state-run bars
 * on the shared scale, plus factory-computed rollup bands, decision diamonds
 * and quantity ports. The §4.3 run-state truth table maps `EventStateType` to
 * the recipe `bar` slot's `data-state` axis; `status: warning` adds the
 * `.stuck` warn ring; a run ending past the window keeps its true geometry and
 * mask-fades (`data-runoff`) — never a fabricated end. Popovers / hovercards
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
        // viewport-cull discipline, one axis): a run WHOLLY outside the
        // window but inside the overscan mounts at its true geometry,
        // clipped at rest, so a brush-slide pan reveals it. A run TOUCHING
        // the window keeps its window-clamped form — its label pins to the
        // window edge and the runoff mask's proportions ride the clamp, so
        // the at-rest render is bit-identical to before.
        if (f1 <= scale.renderMin || f0 >= scale.renderMax) return null;
        const outside = f1 <= 0 || f0 >= 1;
        const left = outside ? f0 : Math.max(0, f0);
        const right = outside ? f1 : Math.min(1, f1);
        return { run, left, width: Math.max(0, right - left), runoff: !outside && f1 > 1 };
    }).filter((b): b is NonNullable<typeof b> => b !== null), [kind.runs, scale]);

    return (
        <>
            {bars.map(({ run, left, width, runoff }) => {
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
                        data-run={run.key}
                        left={`${left * 100}%`}
                        width={`${width * 100}%`}
                        height={`${barHeight}px`}
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
                if (f1 <= 0 || f0 >= 1) return null;
                const left = Math.max(0, f0);
                const width = Math.max(0, Math.min(1, f1) - left);
                const counts = [band.count > 1 ? `×${band.count}` : undefined, band.quantity].filter(Boolean).join(" · ");
                // A rollup over a partial prefix is an understatement, not a
                // number — mark it rather than print it as if it were final.
                const caption = partial === true && counts !== "" ? `~${counts}` : counts;
                return (
                    <Box key={`band-${i}`} css={styles.rollBand} data-state={runStateKey(band.state)} data-ctx={ctxAttr}
                        data-plan-partial={partial === true ? "" : undefined}
                        left={`${left * 100}%`} width={`${width * 100}%`}>
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
