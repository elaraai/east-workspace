/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A summary table's tile (#1671, TBL-2, TBL-3): {@link summaryModel}'s rows —
 * each head of its first group over its groups of the second, with its count —
 * its total row and its marked cells, drawn by east-ui-components' Table as a
 * tile's, its numbers in short and a value's goal after its header, filling
 * its tile, which scrolls a wide table inside it (TBL-5); a page of its first
 * group's groups at a time (#1667), with where the page stands and the
 * Pagination in its foot past one page; and, when its first N holds fewer
 * groups than its source has, a line that says how many of how many.
 *
 * @packageDocumentation
 */

import { useCallback } from "react";
import { Box } from "@chakra-ui/react";
import { variant } from "@elaraai/east";
import { EastChakraTable } from "@elaraai/east-ui-components";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import type { PrintSource, PrintState } from "../../query/visual/print.js";
import { useQueryWords } from "../../query/words.js";
import { useStudioMessages } from "../messages.js";
import { useMarked, useTableClicks } from "./clicks.js";
import { VisualMeta } from "./meta.js";
import { SourceFailed } from "./notes.js";
import { VisualGroupsFoot, usePagedModel, type PageModelOf } from "./paging.js";
import { summaryModel, type SummaryView } from "./summary-table.js";
import type { Visual, VisualSource } from "./values.js";

/** Props of {@link SummaryVisual}: the summary, its source, the page's state, and where its Table and pager keep their state. */
export interface SummaryVisualProps {
    /** The visual: a summary. */
    readonly visual: Visual;
    /** The summary. */
    readonly summary: SummaryView;
    /** Its source, as the surface lists it. */
    readonly source: VisualSource;
    /** Its source, as the printer reads it. */
    readonly read: PrintSource;
    /** The page's state, as its programs read it. */
    readonly state: PrintState;
    /** Where its Table keeps its state — its sort, its folds, its columns' widths — and its pager. */
    readonly storageKey: string;
}

/**
 * A summary table's tile: a page of its rows, its total row, where the page
 * stands, and what it holds of how many.
 *
 * @param props - The summary, its source, the page's state and where its Table and pager keep their state
 * @returns The tile's body; nothing until its groups' program answers
 */
export function SummaryVisual({ visual, summary, source, read, state, storageKey }: SummaryVisualProps) {
    const m = useStudioMessages();
    const words = useQueryWords();
    const styles = useSlotStyles("studioVisual");
    const modelOf = useCallback<PageModelOf<ReturnType<typeof summaryModel>>>((asks, answers, offset) => summaryModel(summary, asks, answers, source, words, m, offset),
        [summary, source, words, m]);
    const { drawn, waiting, failed, offset, setPage } = usePagedModel(visual, read, state, modelOf);
    // A click on a row tells the groups it stands for (TBL-6): the Table tells its row, by its pre-order index.
    const { table, onClickCapture } = useTableClicks(drawn?.table, drawn?.clicked);
    // A row the placement's selection holds is marked.
    const marked = useMarked(drawn?.clicked);
    if (failed !== undefined) return <SourceFailed source={source.name} message={failed.message} retry={failed.retry} />;
    if (drawn === undefined || table === undefined) return null;
    return (
        <Box css={styles.root} data-studio-summary="" data-waiting={waiting ? "" : undefined} onClickCapture={onClickCapture}>
            <VisualMeta view={variant("table", variant("summary", summary))} source={source} shown={drawn.shown} />
            <Box css={styles.table}>
                <EastChakraTable value={table} storageKey={`${storageKey}.table`} tile totals={drawn.totals} cellTone={drawn.tone} rowHead={drawn.head} rowMarked={marked}
                    headerNote={drawn.note} numberText={drawn.number} />
            </Box>
            <VisualGroupsFoot place={drawn.place} shown={drawn.shown} offset={offset} onPage={setPage} storageKey={storageKey} />
        </Box>
    );
}
