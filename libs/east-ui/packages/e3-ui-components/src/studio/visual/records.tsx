/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A records table's tile (#1671, TBL-1): a page of its rows — its own program,
 * asked through the page's answers — in the Table, filling its tile, which
 * scrolls a wide table inside it (TBL-5); a header's sort sorting every row by
 * its program, so a page is never one page reordered; and under it, on one
 * line, where the page stands among every row and the Pagination, at the
 * design system's small size (`paging.tsx`). What it shows is
 * {@link recordsModel}'s; this draws it with the parts' own renderers. (A
 * tile's Show rows lists any visual's rows as a value tree: `rows.tsx`.)
 *
 * @packageDocumentation
 */

import { useCallback, useMemo } from "react";
import { Box } from "@chakra-ui/react";
import { EastChakraTable, usePersistedState, type ColumnSort } from "@elaraai/east-ui-components";
import { keptRead, useSlotStyles, type KeptReader } from "@elaraai/east-ui-components/internal";
import type { PrintSource, PrintState } from "../../query/visual/print.js";
import { useQueryWords } from "../../query/words.js";
import { useStudioMessages } from "../messages.js";
import { useMarked, useTableClicks } from "./clicks.js";
import { SourceFailed } from "./notes.js";
import { VisualPageFoot, usePagedModel, type PageModelOf } from "./paging.js";
import { recordsField, recordsModel, recordsOf, recordsSorted, sortedBy, type RecordsModel, type RecordsSort } from "./records-table.js";
import type { Visual, VisualSource } from "./values.js";

/** What a viewer's sort keeps: the sort, while there is one. */
interface KeptSort {
    readonly sort?: RecordsSort;
}

/** Reads a kept sort in the shape this version writes. */
const readSort: KeptReader<KeptSort> = keptRead.record<KeptSort>({
    sort: keptRead.optional(keptRead.record<RecordsSort>({ field: keptRead.string, descending: keptRead.boolean })),
});

/** Props of {@link RecordsVisual}. */
export interface RecordsVisualProps {
    /** The visual: a records table. */
    readonly visual: Visual;
    /** Its source, as the surface lists it. */
    readonly source: VisualSource;
    /** Its source, as the printer reads it. */
    readonly read: PrintSource;
    /** The page's state, as its programs read it. */
    readonly state: PrintState;
    /** Where its parts keep their state: the Table's, and the viewer's sort of every row. */
    readonly storageKey: string;
}

/**
 * A records table's tile: a page of its rows, and where it stands.
 *
 * @param props - The visual, its source, the page's state, and where its parts keep their state
 * @returns The tile's body
 */
export function RecordsVisual({ visual, source, read, state, storageKey }: RecordsVisualProps) {
    const m = useStudioMessages();
    const words = useQueryWords();
    const styles = useSlotStyles("studioVisual");
    // The viewer's sort: kept beside the Table's own, so the two agree after a reload.
    const { state: kept, setState: setKept } = usePersistedState<KeptSort>(`${storageKey}.sort`, {}, readSort);
    const sorted = useMemo(() => sortedBy(visual, kept.sort), [visual, kept.sort]);
    const records = recordsOf(sorted);
    // What its program sorted by: the head of that column shows it.
    const programSort = useMemo(() => (records === undefined ? undefined : recordsSorted(records)), [records]);
    // A page of its rows; a sort asks other programs, so it starts at the first page.
    const modelOf = useCallback<PageModelOf<RecordsModel>>((_asks, answers, offset) => {
        const answer = answers[0];
        return answer?.kind === "answered" && records !== undefined ? recordsModel(records, answer, offset, source, words, m) : undefined;
    }, [records, source, words, m]);
    const { drawn, waiting, failed, offset, setPage } = usePagedModel(sorted, read, state, modelOf);
    // A header's sort sorts every row: the program's; none sorts as the table does.
    const onSort = useMemo(() => (sorts: ColumnSort[]) => {
        const first = sorts[0];
        const field = first === undefined || records === undefined ? undefined : recordsField(records, first.columnKey);
        setKept(field === undefined || first === undefined ? {} : { sort: { field, descending: first.direction === "desc" } });
    }, [records, setKept]);
    // A click on a row tells the group it stands for (TBL-6): its first column's value.
    const { table, onClickCapture } = useTableClicks(drawn?.table, drawn?.clicked);
    // A row the placement's selection holds is marked: every row whose first column is the selected value.
    const marked = useMarked(drawn?.clicked);
    if (failed !== undefined) return <SourceFailed source={source.name} message={failed.message} retry={failed.retry} />;
    if (drawn === undefined || table === undefined) return null;
    return (
        <Box css={styles.root} data-studio-records={waiting ? "waiting" : ""} onClickCapture={onClickCapture}>
            <Box css={styles.table}>
                <EastChakraTable value={table} storageKey={`${storageKey}.table`} tile sorted={programSort} enableMultiSort={false} onSortChange={onSort} rowMarked={marked} />
            </Box>
            <VisualPageFoot place={drawn} offset={offset} onPage={setPage} storageKey={storageKey} />
        </Box>
    );
}
