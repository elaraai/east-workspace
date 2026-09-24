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
 */

import type { MouseEvent } from "react";
import { variant, type ValueTypeOf } from "@elaraai/east";
import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-svg-core";
import { Plan } from "@elaraai/east-ui/internal";
import { usePlanDispatch, usePlanResolvers, usePlanScale, type PlanElementRefValue } from "../context.js";
import { markName } from "../a11y.js";
import { usePlanWords } from "../words.js";

type Styles = Record<string, Record<string, unknown>>;
type EventsKindValue = Extract<ValueTypeOf<typeof Plan.Types.Row>["kind"], { type: "events" }>["value"];

export interface EventsRowProps {
    /** R2 context strip (#591) — marks keep their silhouette, shrink, and a
     *  K7 icon override falls back to the kind's default geometry. */
    ctx?: boolean | undefined;
    rowKey: string;
    kind: EventsKindValue;
    styles: Styles;
}

/** The event-row plot content — kind-glyph marks + labels. */
export function EventsRow({ rowKey, kind, styles, ctx }: EventsRowProps) {
    const ctxAttr = ctx === true ? "" : undefined;
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    const words = usePlanWords();
    const { onElementClick } = usePlanResolvers();
    return (
        <>
            {kind.marks.map((mark) => {
                const x = scale.fracOf(mark.at);
                // Render-bounds cull (#619): overscan marks sit clipped at
                // rest and slide in on a brush pan.
                if (!Number.isFinite(x) || x <= scale.renderMin || x >= scale.renderMax) return null;
                const frac = x.toFixed(4);
                const label = mark.label.type === "some" ? mark.label.value : undefined;
                const icon = mark.icon.type === "some" ? mark.icon.value : undefined;
                const ref = variant("mark", { row: rowKey, mark: mark.key }) as PlanElementRefValue;
                const onClick = (e: MouseEvent) => {
                    e.stopPropagation();
                    dispatch({ t: "row.select", key: rowKey });
                    onElementClick?.(ref);
                };
                // Every glyph is the same button to a reader (#819).
                const a11y = { role: "button", "aria-label": markName(mark, scale, words) } as const;
                // ── R4 (#591) ──
                // A K7 override swaps the kind's geometry for the host's own
                // 12px FA icon. At strip size that has nowhere to go — a
                // detailed glyph at 6px is a blob — so a collapsed mark falls
                // back to its KIND's default silhouette. The kind is still
                // known, an outline survives smallness where an icon does not,
                // and the host's icon returns on expand.
                const glyph = icon !== undefined && ctx !== true
                    ? (
                        <Box css={styles.markIcon} data-mark={mark.key} data-kind={mark.kind.type} data-plan-frac={frac}
                            left={`${x * 100}%`} onClick={onClick} cursor="pointer" tabIndex={-1} {...a11y}>
                            <FontAwesomeIcon icon={[icon.prefix as IconPrefix, icon.name as IconName]} />
                        </Box>
                    )
                    : mark.kind.type === "decision"
                        ? <Box css={styles.diamond} data-mark={mark.key} data-ctx={ctxAttr} data-plan-frac={frac}
                            data-applied={mark.kind.value.applied ? "" : undefined}
                            left={`${x * 100}%`} onClick={onClick} cursor="pointer" tabIndex={-1} {...a11y} />
                        : mark.kind.type === "exception"
                            ? <Box css={styles.exceptionTri} data-mark={mark.key} data-ctx={ctxAttr} data-plan-frac={frac}
                                left={`${x * 100}%`} onClick={onClick} cursor="pointer" tabIndex={-1} {...a11y} />
                            : <Box css={styles.milestoneDot} data-mark={mark.key} data-ctx={ctxAttr} data-plan-frac={frac}
                                left={`${x * 100}%`} onClick={onClick} cursor="pointer" tabIndex={-1} {...a11y} />;
                return (
                    <Box as="span" key={mark.key} display="contents">
                        {glyph}
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
