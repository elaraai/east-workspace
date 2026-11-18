/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A records table's tile (#1671, TBL-1): a page of its rows — its own program,
 * asked through the page's answers — in the Table, filling its tile, which
 * scrolls a wide table inside it (TBL-5); a header's sort sorting every row by
 * its program, so a page is never one page reordered; and under it, where the
 * page stands among every row and the Pagination. What it shows is
 * {@link recordsModel}'s; this draws it with the parts' own renderers. (A
 * tile's Show rows lists any visual's rows as a value tree: `rows.tsx`.)
 *
 * @packageDocumentation
 */

import { useEffect, useMemo, useState } from "react";
import { Box } from "@chakra-ui/react";
import { none, some } from "@elaraai/east";
import {
    EastChakraPagination, EastChakraTable, useFormatters, usePersistedState,
    type ColumnSort, type PaginationValue, type TableRootValue,
} from "@elaraai/east-ui-components";
import { keptRead, useSlotStyles, type KeptReader } from "@elaraai/east-ui-components/internal";
import { useVisualAnswers } from "../../query/visual/answers.js";
import { printVisual, VISUAL_RECORDS_PAGE, type PrintSource, type PrintState, type VisualAsk } from "../../query/visual/print.js";
import { useQueryWords } from "../../query/words.js";
import { useStudioMessages } from "../messages.js";
import { useGroupClicks, useMarked } from "./clicks.js";
import { SourceFailed, VisualNote } from "./notes.js";
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

/** No programs: a records view that does not print. */
const NO_ASKS: readonly VisualAsk[] = [];

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
    const f = useFormatters();
    const styles = useSlotStyles("studioVisual");
    const [page, setPage] = useState(0);
    // The viewer's sort: kept beside the Table's own, so the two agree after a reload.
    const { state: kept, setState: setKept } = usePersistedState<KeptSort>(`${storageKey}.sort`, {}, readSort);
    const sorted = useMemo(() => sortedBy(visual, kept.sort), [visual, kept.sort]);
    const records = recordsOf(sorted);
    // What its program sorted by: the head of that column shows it.
    const programSort = useMemo(() => (records === undefined ? undefined : recordsSorted(records)), [records]);
    const offset = page * VISUAL_RECORDS_PAGE;
    const printed = useMemo(() => printVisual(sorted, read, state, { offset, size: VISUAL_RECORDS_PAGE }), [sorted, read, state, offset]);
    const asks = printed.kind === "asks" ? printed.asks : NO_ASKS;
    const asked = useVisualAnswers(asks, visual.source);
    const answer = asked.status === "answered" ? asked.answers[0] : undefined;
    const model = useMemo(() => (answer?.kind === "answered" && records !== undefined ? recordsModel(records, answer, offset, source, words, m) : undefined),
        [answer, records, offset, source, words, m]);
    // While another page is asked, the page before stays.
    const [held, setHeld] = useState<RecordsModel | undefined>(undefined);
    useEffect(() => {
        if (model !== undefined) setHeld(model);
    }, [model]);
    const drawn = model ?? held;
    // A header's sort sorts every row: the program's, from the first page; none sorts as the table does.
    const onSort = useMemo(() => (sorts: ColumnSort[]) => {
        const first = sorts[0];
        const field = first === undefined || records === undefined ? undefined : recordsField(records, first.columnKey);
        setPage(0);
        setKept(field === undefined || first === undefined ? {} : { sort: { field, descending: first.direction === "desc" } });
    }, [records, setKept]);
    const pagination = useMemo((): PaginationValue | undefined => (drawn === undefined || drawn.total <= VISUAL_RECORDS_PAGE ? undefined : {
        count: BigInt(drawn.total),
        pageSize: BigInt(VISUAL_RECORDS_PAGE),
        page: BigInt(page),
        onPageChange: (next: bigint) => {
            setPage(Number(next));
            return null;
        },
        style: none,
    }), [drawn, page]);
    // A click on a row tells the group it stands for (TBL-6): its first column's value.
    const { raise, onClickCapture } = useGroupClicks();
    const table = useMemo((): TableRootValue | undefined => (drawn === undefined || raise === undefined ? drawn?.table : {
        ...drawn.table,
        onRowClick: some((event) => {
            raise(drawn.clicked(Number(event.rowIndex)));
            return null;
        }),
    }), [drawn, raise]);
    // A row the placement's selection holds is marked: every row whose first column is the selected value.
    const marked = useMarked(drawn?.clicked);
    if (asked.status === "failed") return <SourceFailed source={source.name} message={asked.message} retry={asked.retry} />;
    if (drawn === undefined || table === undefined) return null;
    return (
        <Box css={styles.root} data-studio-records={model === undefined ? "waiting" : ""} onClickCapture={onClickCapture}>
            <Box css={styles.table}>
                <EastChakraTable value={table} storageKey={`${storageKey}.table`} tile sorted={programSort} enableMultiSort={false} onSortChange={onSort} rowMarked={marked} />
            </Box>
            <Box css={styles.foot}>
                <VisualNote>{m.rowsShown({ first: f.number(drawn.first), last: f.number(drawn.last), of: f.number(drawn.total) })}</VisualNote>
                {pagination !== undefined && <EastChakraPagination value={pagination} storageKey={`${storageKey}.pages`} />}
            </Box>
        </Box>
    );
}
