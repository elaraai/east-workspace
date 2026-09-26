/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Event rows (`Plan Spec.md` §4·K7) — instant marks on the shared scale:
 * ● milestone dots, ◇/◆ decision diamonds (the span `diamond` slot,
 * verbatim), ▲ warn exception triangles. `icon` swaps the kind's default
 * glyph for an FA icon on the `markIcon` slot (12px, still kind-coloured);
 * labels print beside their mark on the `markLabel` slot. A mark and its label
 * both name the mark (`data-mark`), so either opens its popover from the
 * canvas's one overlay layer (#816).
 *
 * The glyph is a button named by its label, its kind (the glyph's meaning) and
 * its instant (#819); the printed label is then that name's echo, hidden from
 * a reader.
 *
 * On a row whose series declares a move's fields (#825) a mark moves to
 * another instant, or another row of its item type, by its glyph.
 */

import { useMemo, type MouseEvent } from "react";
import { variant, type ValueTypeOf } from "@elaraai/east";
import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-svg-core";
import { Plan } from "@elaraai/east-ui/internal";
import { usePlanDispatch, usePlanResolvers, usePlanScale, type PlanElementRefValue } from "../context.js";
import { markName } from "../a11y.js";
import type { PlanRowId } from "../model.js";
import { usePlanWords } from "../words.js";
import type { PlanRowMove } from "./SpanRow.js";
import { usePlanMovable } from "../edit/movable.js";
import type { PlanMovable } from "../edit/store.js";

type Styles = Record<string, Record<string, unknown>>;
type EventsKindValue = Extract<ValueTypeOf<typeof Plan.Types.Row>["kind"], { type: "events" }>["value"];
type MarkValue = EventsKindValue["marks"][number];

export interface EventsRowProps {
    /** R2 context strip (#591) — marks keep their silhouette, shrink, and a
     *  K7 icon override falls back to the kind's default geometry. */
    ctx?: boolean | undefined;
    rowKey: string;
    /** The row's id — what an element click names the row by (#822). */
    rowId: PlanRowId;
    kind: EventsKindValue;
    styles: Styles;
    /** How its marks move (#825) — `undefined` when they do not. */
    move?: PlanRowMove | undefined;
}

/** One mark's glyph — a button that moves, where its row takes moves (#825). */
function MarkGlyph({ mark, x, rowKey, rowId, styles, ctx, move }: {
    mark: MarkValue; x: number; rowKey: string; rowId: PlanRowId; styles: Styles; ctx: boolean | undefined;
    move: PlanRowMove | undefined;
}) {
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    const words = usePlanWords();
    const { onElementClick } = usePlanResolvers();
    const ctxAttr = ctx === true ? "" : undefined;
    const frac = x.toFixed(4);
    const label = mark.label.type === "some" ? mark.label.value : undefined;
    const icon = mark.icon.type === "some" ? mark.icon.value : undefined;
    // A mark has one instant — its extent is that instant twice.
    const movable = useMemo<PlanMovable | undefined>(() => (move !== undefined
        ? { rowKey, key: mark.key, label: label ?? mark.key, kind: "mark", span: { start: mark.at, end: mark.at }, items: move.items, resize: false }
        : undefined), [move, rowKey, mark, label]);
    const { handle, carried } = usePlanMovable(movable);
    const ref = variant("mark", { row: rowId, mark: mark.key }) as PlanElementRefValue;
    const onClick = (e: MouseEvent) => {
        e.stopPropagation();
        dispatch({ t: "row.select", key: rowKey });
        onElementClick?.(ref);
    };
    // Every glyph is the same button to a reader (#819) — and, where it
    // moves, the same draggable (#825).
    const common = {
        role: "button", "aria-label": markName(mark, scale, words),
        "data-mark": mark.key, "data-plan-frac": frac, left: `${x * 100}%`, tabIndex: -1, onClick,
        // A mark that moves takes the recipe's grab cursor.
        cursor: handle !== undefined ? undefined : "pointer",
        ...handle,
        "data-dragging": carried ? "" : undefined,
    } as const;
    // ── R4 (#591) ──
    // A K7 override swaps the kind's geometry for the host's own
    // 12px FA icon. At strip size that has nowhere to go — a
    // detailed glyph at 6px is a blob — so a collapsed mark falls
    // back to its KIND's default silhouette. The kind is still
    // known, an outline survives smallness where an icon does not,
    // and the host's icon returns on expand.
    if (icon !== undefined && ctx !== true) {
        return (
            <Box css={styles.markIcon} data-kind={mark.kind.type} {...common}>
                <FontAwesomeIcon icon={[icon.prefix as IconPrefix, icon.name as IconName]} />
            </Box>
        );
    }
    if (mark.kind.type === "decision") {
        return <Box css={styles.diamond} data-ctx={ctxAttr} data-applied={mark.kind.value.applied ? "" : undefined} {...common} />;
    }
    if (mark.kind.type === "exception") return <Box css={styles.exceptionTri} data-ctx={ctxAttr} {...common} />;
    return <Box css={styles.milestoneDot} data-ctx={ctxAttr} {...common} />;
}

/** The event-row plot content — kind-glyph marks + labels. */
export function EventsRow({ rowKey, rowId, kind, styles, ctx, move }: EventsRowProps) {
    const ctxAttr = ctx === true ? "" : undefined;
    const scale = usePlanScale();
    return (
        <>
            {kind.marks.map((mark) => {
                const x = scale.fracOf(mark.at);
                // Render-bounds cull (#619): overscan marks sit clipped at
                // rest and slide in on a brush pan.
                if (!Number.isFinite(x) || x <= scale.renderMin || x >= scale.renderMax) return null;
                const label = mark.label.type === "some" ? mark.label.value : undefined;
                return (
                    <Box as="span" key={mark.key} display="contents">
                        <MarkGlyph mark={mark} x={x} rowKey={rowKey} rowId={rowId} styles={styles} ctx={ctx} move={move} />
                        {label !== undefined && (
                            <Box css={styles.markLabel} data-ctx={ctxAttr} data-mark={mark.key} aria-hidden="true"
                                left={`calc(${x * 100}% + 9px)`}>{label}</Box>
                        )}
                    </Box>
                );
            })}
        </>
    );
}
