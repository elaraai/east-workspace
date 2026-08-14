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
import { Box } from "@chakra-ui/react";
import { variant, type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { usePlanDispatch, usePlanScale, type PlanElementRefValue } from "../context.js";
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
    rowKey: string;
    kind: SpanKindValue;
    /** Renderer-derived rollup bands (the IR carries only the declaration). */
    bands: readonly DerivedBand[];
    styles: Styles;
    /** Bar height (20 default / 16 dense; the §8 sheet). */
    barHeight: number;
    storageKey: string;
}

/** The span-row plot content — bars, rollup bands, diamonds, ports. */
export function SpanRow({ rowKey, kind, bands: rollBands, styles, barHeight, storageKey }: SpanRowProps) {
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();

    const bars = useMemo(() => kind.runs.map((run) => {
        const f0 = scale.fracOf(run.start);
        const f1 = scale.fracOf(run.end);
        if (f1 <= 0 || f0 >= 1) return null;                    // fully outside
        const left = Math.max(0, f0);
        const right = Math.min(1, f1);
        return { run, left, width: Math.max(0, right - left), runoff: f1 > 1 };
    }).filter((b): b is NonNullable<typeof b> => b !== null), [kind.runs, scale]);

    return (
        <>
            {bars.map(({ run, left, width, runoff }) => {
                const stateKey = runStateKey(run.state);
                const stuck = run.status.type === "some" && run.status.value.type === "warning";
                const qty = run.quantity.type === "some" ? run.quantity.value : undefined;
                const moved = run.moved.type === "some" ? Number(run.moved.value) : undefined;
                const bar = (
                    <Box
                        css={styles.bar}
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
                        }}
                    >
                        <Box as="span" overflow="hidden" textOverflow="ellipsis" minW={0}>{run.label}</Box>
                        {qty !== undefined && <Box as="span" css={styles.barQty}>{qty}</Box>}
                        {moved !== undefined && moved > 0 && <Box as="span" css={styles.barQty}>{`moved ×${moved}`}</Box>}
                    </Box>
                );
                return (
                    <ElementOverlays key={run.key}
                        elementRef={variant("run", { row: rowKey, run: run.key }) as PlanElementRefValue}
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
                const caption = [band.count > 1 ? `×${band.count}` : undefined, band.quantity].filter(Boolean).join(" · ");
                return (
                    <Box key={`band-${i}`} css={styles.rollBand} data-state={runStateKey(band.state)}
                        left={`${left * 100}%`} width={`${width * 100}%`}>
                        {caption}
                    </Box>
                );
            })}
            {kind.ports.map((port, i) => {
                const x = scale.fracOf(port.at);
                if (x < 0 || x > 1) return null;
                const label = port.label.type === "some" ? port.label.value : undefined;
                return <Box key={`port-${i}`} css={styles.port} left={`${x * 100}%`} title={label} />;
            })}
            {kind.decisions.map((dec) => {
                const x = scale.fracOf(dec.at);
                if (x < 0 || x > 1) return null;
                const diamond = (
                    <Box css={styles.diamond} data-applied={dec.applied ? "" : undefined}
                        data-mark={dec.key} left={`${x * 100}%`}
                        onClick={(e) => e.stopPropagation()} cursor="pointer" />
                );
                return (
                    <ElementOverlays key={dec.key}
                        elementRef={variant("mark", { row: rowKey, mark: dec.key }) as PlanElementRefValue}
                        storageKey={`${storageKey}.${dec.key}`}>
                        {diamond}
                    </ElementOverlays>
                );
            })}
        </>
    );
}
