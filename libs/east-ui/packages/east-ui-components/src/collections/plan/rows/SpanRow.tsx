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
 * mask-fades (`data-runoff`) — never a fabricated end. Popovers and hover cards
 * resolve through the root's generalized resolvers: the canvas's one overlay
 * layer opens them from a bar's `data-run` or a diamond's `data-mark` (#816),
 * and a labelled port's tooltip is its `aria-label`. Decision diamonds ride
 * the `mark` arm of the element ref.
 *
 * Every bar and diamond is a button whose name says what its look encodes —
 * label, span and state (`a11y.ts`, #819); a labelled port is an image named
 * by its label.
 *
 * On a row whose series declares a move's fields (#825) a bar moves: the
 * pointer drags it, or one of its two end handles, and Space picks it up for
 * the keyboard (`edit/`).
 */

import { useMemo } from "react";
import { Box } from "@chakra-ui/react";
import { variant, type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { usePlanDispatch, usePlanResolvers, usePlanScale, type PlanElementRefValue } from "../context.js";
import { decisionName, runName } from "../a11y.js";
import { quantityText } from "../quantity.js";
import { usePlanWords } from "../words.js";
import { usePlanMovable } from "../edit/movable.js";
import type { PlanMovable } from "../edit/store.js";
import type { DerivedBand, PlanRowId } from "../model.js";

type Styles = Record<string, Record<string, unknown>>;
type SpanKindValue = Extract<ValueTypeOf<typeof Plan.Types.Row>["kind"], { type: "span" }>["value"];
type RunValue = ValueTypeOf<typeof Plan.Types.Run>;
/** How a row's elements move (#825) — its `edits.move`. */
export type PlanRowMove = { items: string; resize: boolean };

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
    /** The row's id — what an element click names the row by (#822). */
    rowId: PlanRowId;
    kind: SpanKindValue;
    /** Renderer-derived rollup bands (the IR carries only the declaration). */
    bands: readonly DerivedBand[];
    styles: Styles;
    /** Bar height, px — the canvas geometry's `bar` (or `rollBar` for a
     *  collapsed parent; `KindPlot` decides). */
    barHeight: number;
    /** How its runs move (#825) — `undefined` when they do not. */
    move?: PlanRowMove | undefined;
}

/** One run bar — a button that moves, with its end handles, where its row takes moves (#825). */
function RunBar({ run, left, width, runoff, rowKey, rowId, styles, barHeight, ctx, move }: {
    run: RunValue; left: number; width: number; runoff: boolean;
    rowKey: string; rowId: PlanRowId; styles: Styles; barHeight: number; ctx: boolean | undefined;
    move: PlanRowMove | undefined;
}) {
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    const words = usePlanWords();
    const { onElementClick } = usePlanResolvers();
    const movable = useMemo<PlanMovable | undefined>(() => (move !== undefined
        ? { rowKey, key: run.key, label: run.label, kind: "run", span: { start: run.start, end: run.end }, items: move.items, resize: move.resize }
        : undefined), [move, rowKey, run]);
    const { handle, edges, carried } = usePlanMovable(movable);
    const stateKey = runStateKey(run.state);
    const stuck = run.status.type === "some" && run.status.value.type === "warning";
    // ONE quantity (#824): its caption is its text, else its value
    // through its format, then its unit.
    const qty = run.quantity.type === "some" ? quantityText(run.quantity.value, words) : undefined;
    const moved = run.moved.type === "some" ? Number(run.moved.value) : undefined;
    const ref = variant("run", { row: rowId, run: run.key }) as PlanElementRefValue;
    return (
        <Box
            css={styles.bar}
            data-ctx={ctx === true ? "" : undefined}
            data-state={stateKey}
            data-stuck={stuck ? "" : undefined}
            data-runoff={runoff ? "" : undefined}
            data-run={run.key}
            data-plan-frac={left.toFixed(4)}
            // Focusable: Enter opens its popover (#816), and the
            // row's Tab walk reaches it (#819).
            tabIndex={-1}
            role="button"
            aria-label={runName(run, scale, words)}
            left={`${left * 100}%`}
            width={`${width * 100}%`}
            // The bar height is a style PROP, and a style prop
            // outranks the recipe — so in a strip it is not set at
            // all, or the `bar[data-ctx]` 7px rule never wins and
            // a 20px bar sits clipped inside a 16px strip (#591).
            height={ctx === true ? undefined : `${barHeight}px`}
            {...handle}
            // Carried by the keyboard (#825) — dimmed as a dragged origin is.
            data-dragging={carried ? "" : undefined}
            onClick={(e) => {
                e.stopPropagation();
                dispatch({ t: "row.select", key: rowKey });
                onElementClick?.(ref);
            }}
        >
            <Box as="span" overflow="hidden" textOverflow="ellipsis" minW={0}>{run.label}</Box>
            {qty !== undefined && <Box as="span" css={styles.barQty}>{qty}</Box>}
            {moved !== undefined && moved > 0 && (
                <Box as="span" css={styles.barQty}>{words.m.moved({ n: moved, count: words.number(moved) })}</Box>
            )}
            {edges !== undefined && (
                <>
                    <Box css={styles.moveEdge} {...edges.start} />
                    <Box css={styles.moveEdge} {...edges.end} />
                </>
            )}
        </Box>
    );
}

/** The span-row plot content — bars, rollup bands, diamonds, ports. */
export function SpanRow({ rowKey, rowId, kind, bands: rollBands, styles, barHeight, ctx, move }: SpanRowProps) {
    const ctxAttr = ctx === true ? "" : undefined;
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    const words = usePlanWords();
    const { onElementClick } = usePlanResolvers();

    const bars = useMemo(() => kind.runs.map((run) => {
        const f0 = scale.fracOf(run.start);
        // An interval END: half-open on a time / number axis, the far edge
        // of the named bucket on an ordinal one (#631).
        const f1 = scale.endFracOf(run.end);
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
        if (!Number.isFinite(f0) || !Number.isFinite(f1)) return null;
        return { run, left, width: Math.max(0, right - left), runoff: !outside && f1 > 1 };
    }).filter((b): b is NonNullable<typeof b> => b !== null), [kind.runs, scale]);

    return (
        <>
            {bars.map(({ run, left, width, runoff }) => (
                <RunBar key={run.key} run={run} left={left} width={width} runoff={runoff}
                    rowKey={rowKey} rowId={rowId} styles={styles} barHeight={barHeight} ctx={ctx} move={move} />
            ))}
            {rollBands.map((band, i) => {
                const f0 = scale.fracOf(band.from);
                const f1 = scale.endFracOf(band.to);
                if (f1 <= 0 || f0 >= 1) return null;
                const left = Math.max(0, f0);
                const width = Math.max(0, Math.min(1, f1) - left);
                // The band rolls up this row's own subtree, which rides whole
                // in one entry — exact on a paged canvas too (#822).
                const caption = words.m.rollupCaption({
                    count: band.count > 1 ? words.number(band.count) : undefined,
                    quantity: band.quantity,
                });
                return (
                    <Box key={`band-${i}`} css={styles.rollBand} data-state={runStateKey(band.state)} data-ctx={ctxAttr}
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
                // The label is the port's accessible name, and the canvas's
                // one tooltip shows it on hover (#816) — the design-system
                // tooltip, never the native `title=` (#617).
                return <Box key={`port-${i}`} css={styles.port} left={`${x * 100}%`} data-port={i}
                    role="img" aria-label={label} />;
            })}
            {kind.decisions.map((dec) => {
                const x = scale.fracOf(dec.at);
                if (x <= scale.renderMin || x >= scale.renderMax) return null;
                const ref = variant("mark", { row: rowId, mark: dec.key }) as PlanElementRefValue;
                return (
                    <Box key={dec.key} css={styles.diamond} data-applied={dec.applied ? "" : undefined} data-ctx={ctxAttr}
                        data-mark={dec.key} data-plan-frac={x.toFixed(4)} left={`${x * 100}%`} tabIndex={-1}
                        role="button" aria-label={decisionName(dec, scale, words)}
                        // Selects its row like every other element — Enter on
                        // it does the same (#819).
                        onClick={(e) => {
                            e.stopPropagation();
                            dispatch({ t: "row.select", key: rowKey });
                            onElementClick?.(ref);
                        }} cursor="pointer" />
                );
            })}
        </>
    );
}
