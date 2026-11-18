/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The row-focus header band (R1 links / R2 expand) — the `← All rows` link on
 * the left, the focus caption on the right, set in capitals (`Links · H1-P03 ·
 * 2 upstream · 1 linked · 3 downstream` / `EXPANDED · H4-P13`); it names the
 * row by its gutter label (`Plan links.html`, #1258) and counts the rows each
 * role band gathers (#1680's review). Returning: the link, esc, a strip, or the
 * row's own control.
 */

import { Box, chakra } from "@chakra-ui/react";
import { usePlanDispatch } from "../context.js";
import { usePlanWords } from "../words.js";

type Styles = Record<string, Record<string, unknown>>;

export interface FocusBarProps {
    styles: Styles;
    /** The active focus. */
    focus: { kind: "links" | "expand"; key: string };
    /** The focused row's name — its gutter label, never its key (#822). */
    label: string;
    /** The rows each role band gathers (links focus): only upstream, both ways, only downstream. */
    counts?: { upstream: number; linked: number; downstream: number } | undefined;
}

/** The focus header band — the return chip + the caption. */
export function FocusBar({ styles, focus, label, counts }: FocusBarProps) {
    const dispatch = usePlanDispatch();
    const words = usePlanWords();
    const caption = focus.kind === "links"
        ? words.m.focusLinks({
            label,
            upstream: counts !== undefined ? words.number(counts.upstream) : undefined,
            // The rows linked both ways are counted only where there are some, as their band stands only then.
            linked: counts !== undefined && counts.linked > 0 ? words.number(counts.linked) : undefined,
            downstream: counts !== undefined ? words.number(counts.downstream) : undefined,
        })
        : words.m.focusExpanded({ label });
    return (
        <Box css={styles.focusBar} data-plan-focusbar={focus.kind}>
            <chakra.button
                type="button"
                css={styles.focusBack}
                data-plan-focusback
                onClick={() => dispatch({ t: "focus.clear" })}
            >
                {words.m.allRows()}
            </chakra.button>
            <Box css={styles.focusCaption}>{caption}</Box>
        </Box>
    );
}
