/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The status footer (28px, `Plan Spec.html` §1) — mono 10px status items;
 * `tone` tints (`warning` for the exceptions count), `end: true` right-aligns.
 *
 * On a PAGED canvas the footer also carries the component's own transport line
 * (#567 D9) — `N loaded of M · Loading…`, right-aligned and marked
 * `data-slot="footerTransport"` so it is distinguishable from the
 * author-supplied items it sits beside. The footer therefore renders for a
 * paged canvas even when the author supplied no items at all: a canvas showing
 * a prefix must say so.
 */

import { Box } from "@chakra-ui/react";
import { type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { transportLabel, type PlanTransport } from "./transport.js";

type Styles = Record<string, Record<string, unknown>>;
type FooterItemValue = ValueTypeOf<typeof Plan.Types.FooterItem>;

export interface PlanFooterProps {
    styles: Styles;
    /** The author's footer items, in order. */
    items: ReadonlyArray<FooterItemValue>;
    /** Paged transport state — omitted on an inline canvas. */
    transport?: PlanTransport | undefined;
}

/** The 28px footer band (renders nothing without items or transport). */
export function PlanFooter({ styles, items, transport }: PlanFooterProps) {
    if (items.length === 0 && transport === undefined) return null;
    return (
        <Box css={styles.footer} data-slot="footer">
            {items.map((item, i) => {
                const tone = item.tone.type === "some" ? item.tone.value.type : undefined;
                const end = item.end.type === "some" && item.end.value;
                return (
                    <Box key={i} css={styles.footerItem} data-tone={tone} data-end={end ? "" : undefined}>
                        {item.text}
                    </Box>
                );
            })}
            {transport !== undefined && (
                <Box css={styles.footerItem} data-end="" data-slot="footerTransport"
                    data-partial={transport.partial ? "" : undefined}>
                    {transport.loading ? `${transportLabel(transport)} · Loading…` : transportLabel(transport)}
                </Box>
            )}
        </Box>
    );
}
