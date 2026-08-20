/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Event rows (`Plan Spec.md` §4·K7) — instant marks on the shared scale:
 * ● milestone dots, ◇/◆ decision diamonds (the span `diamond` slot,
 * verbatim), ▲ warn exception triangles. `icon` swaps the kind's default
 * glyph for an FA icon on the `markIcon` slot (12px, still kind-coloured);
 * labels print beside their mark on the `markLabel` slot.
 */

import type { MouseEvent } from "react";
import { variant, type ValueTypeOf } from "@elaraai/east";
import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-svg-core";
import { Plan } from "@elaraai/east-ui/internal";
import { usePlanDispatch, usePlanResolvers, usePlanScale, type PlanElementRefValue } from "../context.js";
import { ElementOverlays } from "./ElementOverlays.js";

type Styles = Record<string, Record<string, unknown>>;
type EventsKindValue = Extract<ValueTypeOf<typeof Plan.Types.Row>["kind"], { type: "events" }>["value"];

export interface EventsRowProps {
    /** R2 context strip (#591) — marks keep their silhouette, shrink, and a
     *  K7 icon override falls back to the kind's default geometry. */
    ctx?: boolean | undefined;
    rowKey: string;
    kind: EventsKindValue;
    styles: Styles;
    storageKey: string;
}

/** The event-row plot content — kind-glyph marks + labels. */
export function EventsRow({ rowKey, kind, styles, storageKey, ctx }: EventsRowProps) {
    const ctxAttr = ctx === true ? "" : undefined;
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    const { onElementClick } = usePlanResolvers();
    return (
        <>
            {kind.marks.map((mark) => {
                const x = scale.fracOf(mark.at);
                // Render-bounds cull (#619): overscan marks sit clipped at
                // rest and slide in on a brush pan.
                if (x <= scale.renderMin || x >= scale.renderMax) return null;
                const label = mark.label.type === "some" ? mark.label.value : undefined;
                const icon = mark.icon.type === "some" ? mark.icon.value : undefined;
                const ref = variant("mark", { row: rowKey, mark: mark.key }) as PlanElementRefValue;
                const onClick = (e: MouseEvent) => {
                    e.stopPropagation();
                    dispatch({ t: "row.select", key: rowKey });
                    onElementClick?.(ref);
                };
                // ── R4 (#591) ──
                // A K7 override swaps the kind's geometry for the host's own
                // 12px FA icon. At strip size that has nowhere to go — a
                // detailed glyph at 6px is a blob — so a collapsed mark falls
                // back to its KIND's default silhouette. The kind is still
                // known, an outline survives smallness where an icon does not,
                // and the host's icon returns on expand.
                const glyph = icon !== undefined && ctx !== true
                    ? (
                        <Box css={styles.markIcon} data-mark={mark.key} data-kind={mark.kind.type}
                            left={`${x * 100}%`} onClick={onClick} cursor="pointer">
                            <FontAwesomeIcon icon={[icon.prefix as IconPrefix, icon.name as IconName]} />
                        </Box>
                    )
                    : mark.kind.type === "decision"
                        ? <Box css={styles.diamond} data-mark={mark.key} data-ctx={ctxAttr}
                            data-applied={mark.kind.value.applied ? "" : undefined}
                            left={`${x * 100}%`} onClick={onClick} cursor="pointer" />
                        : mark.kind.type === "exception"
                            ? <Box css={styles.exceptionTri} data-mark={mark.key} data-ctx={ctxAttr}
                                left={`${x * 100}%`} onClick={onClick} cursor="pointer" />
                            : <Box css={styles.milestoneDot} data-mark={mark.key} data-ctx={ctxAttr}
                                left={`${x * 100}%`} onClick={onClick} cursor="pointer" />;
                return (
                    <ElementOverlays key={mark.key}
                        elementRef={ref} styles={styles}
                        storageKey={`${storageKey}.${mark.key}`}>
                        <Box as="span" display="contents">
                            {glyph}
                            {label !== undefined && (
                                <Box css={styles.markLabel} data-ctx={ctxAttr}
                                    left={`calc(${x * 100}% + 9px)`}>{label}</Box>
                            )}
                        </Box>
                    </ElementOverlays>
                );
            })}
        </>
    );
}
