/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A summary table's tile (#1671, TBL-2, TBL-3): {@link summaryModel}'s rows —
 * each head of its first group over its groups of the second, with its count —
 * its total row and its marked cells, drawn by east-ui-components' Table as a
 * tile's, its numbers in short and a value's goal after its header, filling
 * its tile, which scrolls a wide table inside it (TBL-5); and, when it
 * holds fewer groups than its source has, a line that says how many of how
 * many.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { Box } from "@chakra-ui/react";
import { some, variant } from "@elaraai/east";
import { EastChakraTable, type TableRootValue } from "@elaraai/east-ui-components";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import { useQueryWords } from "../../query/words.js";
import { useStudioMessages } from "../messages.js";
import { useGroupClicks, useMarked } from "./clicks.js";
import { VisualMeta } from "./meta.js";
import { ShownNote } from "./notes.js";
import { summaryModel, type SummaryView } from "./summary-table.js";
import type { VisualAsked } from "./values.js";

/** Props of {@link SummaryVisual}: the summary, its answers and its source, and where its Table keeps its state. */
export interface SummaryVisualProps extends VisualAsked {
    /** The summary. */
    readonly summary: SummaryView;
    /** Where its Table keeps its state: its sort, its folds, its columns' widths. */
    readonly storageKey: string;
}

/**
 * A summary table's tile: its rows, its total row, and what it holds of how
 * many.
 *
 * @param props - The summary, its answers, its source and where its Table keeps its state
 * @returns The tile's body; nothing when its groups' program did not answer
 */
export function SummaryVisual({ summary, asks, answers, source, storageKey }: SummaryVisualProps) {
    const m = useStudioMessages();
    const words = useQueryWords();
    const styles = useSlotStyles("studioVisual");
    const model = useMemo(() => summaryModel(summary, asks, answers, source, words, m), [summary, asks, answers, source, words, m]);
    // A click on a row tells the groups it stands for (TBL-6): the Table tells its row, by its pre-order index.
    const { raise, onClickCapture } = useGroupClicks();
    const table = useMemo((): TableRootValue | undefined => (model === undefined || raise === undefined ? model?.table : {
        ...model.table,
        onRowClick: some((event) => {
            raise(model.clicked(Number(event.rowIndex)));
            return null;
        }),
    }), [model, raise]);
    // A row the placement's selection holds is marked.
    const marked = useMarked(model?.clicked);
    if (model === undefined || table === undefined) return null;
    return (
        <Box css={styles.root} data-studio-summary="" onClickCapture={onClickCapture}>
            <VisualMeta view={variant("table", variant("summary", summary))} source={source} shown={model.shown} />
            <Box css={styles.table}>
                <EastChakraTable value={table} storageKey={`${storageKey}.table`} tile totals={model.totals} cellTone={model.tone} rowHead={model.head} rowMarked={marked}
                    headerNote={model.note} numberText={model.number} />
            </Box>
            {model.shown !== undefined && (
                <Box css={styles.foot}>
                    <ShownNote shown={model.shown} />
                </Box>
            )}
        </Box>
    );
}
