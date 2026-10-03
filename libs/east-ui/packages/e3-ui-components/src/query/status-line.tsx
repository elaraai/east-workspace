/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The builder's status line (#936), under the pane and the results
 * (`Query Editor Spec.md` §4.12), in the `status` recipe's dots and words:
 *
 * - **its start**: the check — "Checks clean", "{n} to finish", "{n}
 *   problems", or "{n} warnings" in the jq view — then "Gives {shape}", its
 *   East type and multiplicity on hover, and its fields;
 * - **its end**: the save state — "Saved", its dot the success ink just
 *   after a save, then quiet; "Unsaved changes" while the session has drafts;
 *   "Not saved" for a query never saved — and the query's name.
 *
 * @packageDocumentation
 */

import { memo } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { Tip, type Styles } from "./parts.js";

/** The check, as the status line says it. */
export interface QueryCheckLine {
    /** Its dot's tone. */
    readonly tone: "success" | "warning" | "danger";
    /** Its word: "Checks clean", "2 to finish", "1 problem". */
    readonly word: string;
}

/** The shape the query gives, as the status line says it. */
export interface QueryGivesLine {
    /** "Gives up to 10 shipped orders". */
    readonly text: string;
    /** Its East type and multiplicity, on hover. */
    readonly hover: string;
    /** Its fields: "· order, customer, total". */
    readonly fields: string;
}

/** The save state, as the status line says it. */
export interface QuerySaveLine {
    /** Saved, drafts not yet saved, or never saved. */
    readonly state: "saved" | "unsaved" | "new";
    /** Whether it saved just now: its dot is the success ink for a moment, then quiet. */
    readonly fresh: boolean;
    /** Its word. */
    readonly word: string;
}

/** Props of {@link QueryStatusLine}. */
export interface QueryStatusLineProps {
    /** The check. */
    readonly check: QueryCheckLine;
    /** The shape the query gives, when it is known. */
    readonly gives: QueryGivesLine | undefined;
    /** The save state. */
    readonly save: QuerySaveLine;
    /** The query's name. */
    readonly name: string;
}

/** The save state's dot: the success ink just after a save, then quiet; the brand's with drafts; an open ring for a query never saved. */
function saveDot(save: QuerySaveLine): { status: "success" | "brand" | "neutral"; ring: boolean } {
    switch (save.state) {
        case "saved": return { status: save.fresh ? "success" : "neutral", ring: false };
        case "unsaved": return { status: "brand", ring: false };
        case "new": return { status: "neutral", ring: true };
    }
}

/**
 * Renders the status line — see the module docs.
 *
 * @param props - The check, the shape, the save state and the name ({@link QueryStatusLineProps})
 * @returns The status line
 */
export const QueryStatusLine = memo(function QueryStatusLine({ check, gives, save, name }: QueryStatusLineProps) {
    const styles = useSlotRecipe({ key: "queryBuilder" })() as Styles;
    const statusRecipe = useSlotRecipe({ key: "status" });
    const checkDot = statusRecipe({ status: check.tone, size: "sm" }) as Styles;
    const saveStyles = statusRecipe({ ...saveDot(save), size: "sm" }) as Styles;
    return (
        <Box css={styles.status} data-query-status="">
            <Box css={styles.statusCheck} data-query-check={check.tone}>
                <Box as="span" css={checkDot.root}>
                    <Box as="span" css={checkDot.indicator} aria-hidden />
                    <Box as="span" css={checkDot.label}>{check.word}</Box>
                </Box>
                {gives !== undefined && (
                    <>
                        <Box as="span" css={styles.statusRule} aria-hidden />
                        <Tip label={gives.hover}>
                            <Box as="span" css={styles.statusShape} data-query-gives="">{gives.text}</Box>
                        </Tip>
                        <Box as="span" css={styles.statusFields}>{gives.fields}</Box>
                    </>
                )}
            </Box>
            <Box css={styles.statusSave} data-query-save={save.state} data-fresh={save.fresh ? "" : undefined}>
                <Box as="span" css={saveStyles.root}>
                    <Box as="span" css={saveStyles.indicator} aria-hidden />
                    <Box as="span" css={saveStyles.label}>{save.word}</Box>
                </Box>
                <Box as="span" css={styles.statusName} data-query-name="">{name}</Box>
            </Box>
        </Box>
    );
});
