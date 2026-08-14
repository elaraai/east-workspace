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
import { type ValueTypeOf } from "@elaraai/east";
import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-svg-core";
import { Plan } from "@elaraai/east-ui/internal";
import { usePlanDispatch, usePlanScale } from "../context.js";
import { withOverlays } from "./SpanRow.js";

type Styles = Record<string, Record<string, unknown>>;
type EventsKindValue = Extract<ValueTypeOf<typeof Plan.Types.Row>["kind"], { type: "events" }>["value"];

export interface EventsRowProps {
    rowKey: string;
    kind: EventsKindValue;
    styles: Styles;
    storageKey: string;
}

/** The event-row plot content — kind-glyph marks + labels. */
export function EventsRow({ rowKey, kind, styles, storageKey }: EventsRowProps) {
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    return (
        <>
            {kind.marks.map((mark) => {
                const x = scale.fracOf(mark.at);
                if (x < 0 || x > 1) return null;
                const label = mark.label.type === "some" ? mark.label.value : undefined;
                const icon = mark.icon.type === "some" ? mark.icon.value : undefined;
                const onClick = (e: MouseEvent) => {
                    e.stopPropagation();
                    dispatch({ t: "row.select", key: rowKey });
                };
                const glyph = icon !== undefined
                    ? (
                        <Box css={styles.markIcon} data-mark={mark.key} data-kind={mark.kind.type}
                            left={`${x * 100}%`} onClick={onClick} cursor="pointer">
                            <FontAwesomeIcon icon={[icon.prefix as IconPrefix, icon.name as IconName]} />
                        </Box>
                    )
                    : mark.kind.type === "decision"
                        ? <Box css={styles.diamond} data-mark={mark.key}
                            data-applied={mark.kind.value.applied ? "" : undefined}
                            left={`${x * 100}%`} onClick={onClick} cursor="pointer" />
                        : mark.kind.type === "exception"
                            ? <Box css={styles.exceptionTri} data-mark={mark.key}
                                left={`${x * 100}%`} onClick={onClick} cursor="pointer" />
                            : <Box css={styles.milestoneDot} data-mark={mark.key}
                                left={`${x * 100}%`} onClick={onClick} cursor="pointer" />;
                return (
                    <Box as="span" key={mark.key} display="contents">
                        {withOverlays(
                            <Box as="span" display="contents">
                                {glyph}
                                {label !== undefined && (
                                    <Box css={styles.markLabel} left={`calc(${x * 100}% + 9px)`}>{label}</Box>
                                )}
                            </Box>,
                            mark.popover, undefined, `${storageKey}.${mark.key}`)}
                    </Box>
                );
            })}
        </>
    );
}
