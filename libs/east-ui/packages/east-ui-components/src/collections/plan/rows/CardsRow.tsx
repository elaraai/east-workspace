/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Cards rows (`Plan Spec.md` §4·K6) — the Roster surface on the shared scale:
 * shift chips spanning whole buckets, wearing the lifecycle looks on the
 * recipe `cardChip` slot's `data-state` axis (confirmed brand tint · proposed
 * dashed · `proposed(removed)` warn strikethrough · estimated ghost). A chip's
 * popover and hover card come from the canvas's one overlay layer (#816).
 * Each chip is a button named by its label, span and state (#819).
 *
 * On a row whose series declares a move's fields (#825) a chip moves — by
 * itself or by an end — as a run bar does.
 */

import { useMemo } from "react";
import { variant, type ValueTypeOf } from "@elaraai/east";
import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-svg-core";
import { Plan } from "@elaraai/east-ui/internal";
import { usePlanDispatch, usePlanResolvers, usePlanScale, type PlanElementRefValue } from "../context.js";
import { runStateKey, type PlanRowMove } from "./SpanRow.js";
import { chipName } from "../a11y.js";
import type { PlanRowId } from "../model.js";
import { usePlanWords } from "../words.js";
import { usePlanMovable } from "../edit/movable.js";
import type { PlanMovable } from "../edit/store.js";

type Styles = Record<string, Record<string, unknown>>;
type CardsKindValue = Extract<ValueTypeOf<typeof Plan.Types.Row>["kind"], { type: "cards" }>["value"];
type ChipValue = CardsKindValue["chips"][number];

export interface CardsRowProps {
    /** R2 context strip (#591) — render this row's marks at strip size. */
    ctx?: boolean | undefined;

    rowKey: string;
    /** The row's id — what an element click names the row by (#822). */
    rowId: PlanRowId;
    kind: CardsKindValue;
    styles: Styles;
    /** How its chips move (#825) — `undefined` when they do not. */
    move?: PlanRowMove | undefined;
}

/** One chip — a button that moves, with its end handles, where its row takes moves (#825). */
function CardChip({ chip, left, width, rowKey, rowId, styles, ctx, move }: {
    chip: ChipValue; left: number; width: number;
    rowKey: string; rowId: PlanRowId; styles: Styles; ctx: boolean | undefined; move: PlanRowMove | undefined;
}) {
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    const words = usePlanWords();
    const { onElementClick } = usePlanResolvers();
    const movable = useMemo<PlanMovable | undefined>(() => (move !== undefined
        ? { rowKey, key: chip.key, label: chip.label, kind: "chip", span: { start: chip.from, end: chip.to }, items: move.items, resize: move.resize }
        : undefined), [move, rowKey, chip]);
    const { handle, edges, carried } = usePlanMovable(movable);
    const icon = chip.icon.type === "some" ? chip.icon.value : undefined;
    const ref = variant("chip", { row: rowId, chip: chip.key }) as PlanElementRefValue;
    return (
        <Box css={styles.cardChip}
            data-ctx={ctx === true ? "" : undefined}
            data-chip={chip.key}
            // Focusable: Enter opens its popover (#816), and the
            // row's Tab walk reaches it (#819).
            tabIndex={-1}
            role="button"
            aria-label={chipName(chip, scale, words)}
            data-plan-frac={left.toFixed(4)}
            data-state={runStateKey(chip.state)}
            left={`calc(${left * 100}% + 2px)`}
            width={`calc(${width * 100}% - 4px)`}
            {...handle}
            // Carried by the keyboard (#825) — dimmed as a dragged origin is.
            data-dragging={carried ? "" : undefined}
            onClick={(e) => {
                e.stopPropagation();
                dispatch({ t: "row.select", key: rowKey });
                onElementClick?.(ref);
            }}
        >
            {icon !== undefined && <FontAwesomeIcon icon={[icon.prefix as IconPrefix, icon.name as IconName]} />}
            <Box as="span" overflow="hidden" textOverflow="ellipsis" minW={0}>{chip.label}</Box>
            {edges !== undefined && (
                <>
                    <Box css={styles.moveEdge} {...edges.start} />
                    <Box css={styles.moveEdge} {...edges.end} />
                </>
            )}
        </Box>
    );
}

/** The cards-row plot content — whole-bucket shift chips. */
export function CardsRow({ rowKey, rowId, kind, styles, ctx, move }: CardsRowProps) {
    const scale = usePlanScale();
    return (
        <>
            {kind.chips.map((chip) => {
                const f0 = scale.fracOf(chip.from);
                // The chip's END — half-open on time / number, the far edge
                // of the named bucket on an ordinal axis (#631).
                const f1 = scale.endFracOf(chip.to);
                if (!Number.isFinite(f0) || !Number.isFinite(f1)) return null;
                // Render-bounds cull (#619): a chip wholly in the overscan
                // mounts at its true geometry (clipped at rest, revealed by a
                // brush pan); one touching the window keeps its clamped form
                // so the at-rest render is unchanged.
                if (f1 <= scale.renderMin || f0 >= scale.renderMax) return null;
                const outside = f1 <= 0 || f0 >= 1;
                const left = outside ? f0 : Math.max(0, f0);
                const width = Math.max(0, (outside ? f1 : Math.min(1, f1)) - left);
                return (
                    <CardChip key={chip.key} chip={chip} left={left} width={width}
                        rowKey={rowKey} rowId={rowId} styles={styles} ctx={ctx} move={move} />
                );
            })}
        </>
    );
}
