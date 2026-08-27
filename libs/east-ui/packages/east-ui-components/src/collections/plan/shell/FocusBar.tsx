/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The row-focus header band (R1 links / R2 expand) — `← ALL ROWS` on the
 * left, the focus caption on the right (`LINKS · M-214 · 4 UPSTREAM ·
 * 6 DOWNSTREAM` / `EXPANDED · L4-M13`). Returning: the chip, esc, any rail
 * (R1), or the row's own control.
 */

import { Box, chakra } from "@chakra-ui/react";
import { usePlanDispatch } from "../context.js";

type Styles = Record<string, Record<string, unknown>>;

export interface FocusBarProps {
    styles: Styles;
    /** The active focus. */
    focus: { kind: "links" | "expand"; key: string };
    /** Family sizes (links focus). */
    counts?: { upstream: number; downstream: number } | undefined;
}

/** The focus header band — the return chip + the caption. */
export function FocusBar({ styles, focus, counts }: FocusBarProps) {
    const dispatch = usePlanDispatch();
    const caption = focus.kind === "links"
        ? `LINKS · ${focus.key}${counts !== undefined ? ` · ${counts.upstream} UPSTREAM · ${counts.downstream} DOWNSTREAM` : ""}`
        : `EXPANDED · ${focus.key}`;
    return (
        <Box css={styles.focusBar} data-plan-focusbar={focus.kind}>
            <chakra.button
                type="button"
                css={styles.focusBack}
                data-plan-focusback
                onClick={() => dispatch({ t: "focus.clear" })}
            >
                ← ALL ROWS
            </chakra.button>
            <Box css={styles.focusCaption}>{caption}</Box>
        </Box>
    );
}
