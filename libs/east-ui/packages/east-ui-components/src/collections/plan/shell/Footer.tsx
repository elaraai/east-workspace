/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The status footer (28px, `Plan Spec.html` §1) — mono 10px status items;
 * `tone` tints (`warning` for the exceptions count), `end: true` right-aligns.
 */

import { Box } from "@chakra-ui/react";
import { type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";

type Styles = Record<string, Record<string, unknown>>;
type FooterItemValue = ValueTypeOf<typeof Plan.Types.FooterItem>;

/** The 28px footer band (renders nothing without items). */
export function PlanFooter({ styles, items }: { styles: Styles; items: ReadonlyArray<FooterItemValue> }) {
    if (items.length === 0) return null;
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
        </Box>
    );
}
