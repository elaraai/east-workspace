/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Record's grid (`Record - DX Proposal.md` GR1–GR4, HD1–HD4, SL1, EM1,
 * ST1–ST9), in the Table's anatomy, drawn by the Sheet's grid through
 * its host (decision 8): the Sheet's one machine, session, lens and paging
 * under it, and here what a row, the header and the empty state look like.
 *
 * - **A row** — its select column's box, then a cell for each column, each
 *   cell's content the Sheet's for its kind. The ring's row and a ticked row
 *   are selected; a row holding drafts takes the draft wash; the ring's cell
 *   is active; a cell its drafts changed is tinted until Apply; a new row's
 *   empty cell a person must fill is washed and says so on hover; a cycle, a
 *   toggle or a boolean a person may step lights under the pointer; an owned
 *   row, and every row of a read-only Record, takes no hover.
 * - **The header** — the column groups' row, each group's label over a rule
 *   under its columns, the columns before the first group and an unlabelled
 *   group drawing neither, then the header row, the select column's box
 *   ticking every row shown, or unticking them once every one is.
 * - **The empty state** — the narrowing leaves no row to show: it says so,
 *   and clears the search, or the filters.
 *
 * A tick never moves the ring, and the ring never ticks. The select column
 * stays at the left as the columns scroll sideways; a read-only Record has
 * none.
 *
 * @packageDocumentation
 */

import { createContext, memo, useContext, useMemo, useSyncExternalStore } from "react";
import { Box, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faMinus } from "@fortawesome/free-solid-svg-icons";
import type { ValueTypeOf } from "@elaraai/east";
import type { RecordPayloadType } from "@elaraai/e3-ui/internal";
import type { SlotStyles } from "@elaraai/east-ui-components/internal";
import type { SheetHostEmptyProps, SheetHostHeaderProps, SheetHostRowProps } from "../sheet/index.js";
import { cellIsBlank, driverKeyOf, resolveMember, type SheetColumnIndex, type SheetColumnMeta } from "../sheet/model.js";
import { SheetCellContent } from "../sheet/cells/Cell.js";
import { cellDetail } from "../sheet/detail.js";
import { namesMember } from "../sheet/Rows.js";
import { stepsInPlace } from "../sheet/steps.js";
import { ActionCellSlot } from "../sheet/actions/ActionCell.js";
import { actionColumnOf } from "../sheet/actions/model.js";
import { useSheetWords } from "../sheet/words.js";
import type { SheetRowValue } from "../sheet/values.js";
import { recordMessages as m } from "./messages.js";
import type { RecordTicks } from "./ticks.js";

/** The Record's column groups, decoded. */
type RecordColumnGroups = ValueTypeOf<typeof RecordPayloadType>["columnGroups"];

/** What the Record's grid parts read beside the Sheet's: the record recipe's styles, the ticks, the column groups and the rows' word. */
export interface RecordGrid {
    /** The record recipe's slot styles, at the Record's density. */
    styles: SlotStyles;
    /** The rows ticked. */
    ticks: RecordTicks;
    /** The column groups, in order. */
    groups: RecordColumnGroups;
    /** Whether the grid has its select column: a read-only Record has none. */
    lead: boolean;
    /** The rows' word, plural — `people`: what the empty state says. */
    nouns: string;
}

const RecordGridContext = createContext<RecordGrid | undefined>(undefined);

/** Provides what the Record's grid parts read beside the Sheet's. */
export const RecordGridProvider = RecordGridContext.Provider;

/** What the Record's grid parts read; a part outside a {@link RecordGridProvider} is a mistake of the frame's, and throws. */
function useRecordGrid(): RecordGrid {
    const grid = useContext(RecordGridContext);
    if (grid === undefined) throw new Error("A Record grid part is drawn outside a RecordGridProvider");
    return grid;
}

/** How a column's cells sit in them (GR2): a cycle's, a toggle's and a boolean's centred, an age's at the end, every other at the start. */
function alignOf(meta: SheetColumnMeta): "center" | "end" | undefined {
    return meta.kind === "cycle" || meta.kind === "toggle" || meta.kind === "boolean" ? "center" : meta.kind === "age" ? "end" : undefined;
}

/** A row as its box names it: its title, else its first text, else its key. */
function nameOf(row: SheetRowValue, columns: SheetColumnIndex): string {
    const named = columns.list.find((meta) => meta.kind === "title") ?? columns.list.find((meta) => meta.kind === "text");
    const cell = named === undefined ? undefined : row.cells.get(named.key);
    return cell?.type === "String" && cell.value.trim().length > 0 ? cell.value : row.id;
}

/**
 * A row (GR1–GR3, SL1, ST1–ST9): its select column's box, then its cells, the
 * Sheet's gestures on each — see the module docs.
 */
export const RecordRow = memo(function RecordRow(props: SheetHostRowProps) {
    const { styles: sheetStyles, r, row, columns, registers, gridTemplate, rowPx, idPrefix, selC, range, editor, draft, changes, writable } = props;
    const { styles, ticks, lead } = useRecordGrid();
    const words = useSheetWords();
    const id = row?.id;
    const ticked = useSyncExternalStore(ticks.subscribe, () => id !== undefined && ticks.has(id));
    // An owned row, and a Record no gesture may change, takes no hover and steps nothing (ST9).
    const owned = row?.owned === true;
    const still = owned || !writable;
    const driverKey = driverKeyOf(row, props.driverColumn);
    const last = columns.list.length - 1;
    const name = row === undefined ? "" : nameOf(row, columns);
    return (
        <Box
            css={styles.row}
            style={{ gridTemplateColumns: gridTemplate, height: `${rowPx}px` }}
            data-slot="row"
            data-row={r}
            data-row-id={id}
            data-selected={selC !== undefined || range !== undefined || ticked ? "" : undefined}
            data-ticked={ticked ? "" : undefined}
            data-draft={draft?.pending === true ? "" : undefined}
            data-still={still ? "" : undefined}
            role="row"
            aria-rowindex={props.ariaRowIndex}
            aria-selected={selC !== undefined || ticked}
        >
            {lead && (
                <Box css={styles.cell} data-pick="" data-first="" role="gridcell" aria-colindex={1}>
                    {row !== undefined && (
                        // Out of the tab order, as every control in the grid is: the grid is one tab stop.
                        <chakra.button type="button" css={styles.tick} tabIndex={-1} role="checkbox" aria-checked={ticked}
                            aria-label={m.tickRow({ name, ticked })} title={m.tickRow({ name, ticked })} data-on={ticked ? "" : undefined}
                            onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
                            onClick={(event) => { event.stopPropagation(); ticks.toggle(row.id); }}>
                            {ticked && <FontAwesomeIcon icon={faCheck} />}
                        </chakra.button>
                    )}
                </Box>
            )}
            {columns.list.map((meta, c) => {
                const cell = row?.cells.get(meta.key);
                const editing = editor?.c === c;
                const editable = writable && meta.editable && meta.kind !== "stamped" && meta.kind !== "action";
                // A new row's empty cell a person must fill (ST8): washed, empty, and saying so on hover.
                const required = changes?.added === true && editable && cellIsBlank(cell);
                const issue = cell?.type === "Invalid" ? words.m.issueInvalid({ value: cell.value }) : draft?.issues.get(meta.key);
                const detail = row !== undefined ? cellDetail(meta, row.cells, words) : undefined;
                const member = namesMember(meta) && cell?.type === "String" ? resolveMember(registers, meta.register, cell.value) : undefined;
                const actualCell = meta.kind === "date" && meta.actual !== undefined ? row?.cells.get(meta.actual) : undefined;
                const when = meta.kind === "date" && meta.level !== undefined && row !== undefined
                    ? { level: meta.level(row.cells), actual: actualCell?.type === "DateTime" ? actualCell.value : undefined }
                    : undefined;
                // An action cell (#1475): its state, its summary and the controls of what it offers, over the Sheet's host.
                const action = meta.kind === "action" && props.actions !== undefined && row !== undefined ? actionColumnOf(meta) : undefined;
                const summary = action !== undefined ? row?.cells.get(action.summary) : undefined;
                return (
                    <Box
                        key={meta.key}
                        css={styles.cell}
                        data-slot="cell"
                        data-key={meta.key}
                        data-kind={meta.kind}
                        data-active={selC === c && !editing ? "" : undefined}
                        data-steps={editable && !owned && stepsInPlace(meta) ? "" : undefined}
                        data-dirty={changes?.dirty.has(meta.key) === true ? "" : undefined}
                        data-required={required ? "" : undefined}
                        data-first={!lead && c === 0 ? "" : undefined}
                        data-last={c === last ? "" : undefined}
                        data-align={alignOf(meta)}
                        data-still={still ? "" : undefined}
                        // A required cell's one issue is that it is empty: it says so in the Record's words.
                        title={required ? m.required({ header: meta.header }) : issue ?? detail?.title}
                        aria-invalid={issue !== undefined ? true : undefined}
                        role="gridcell"
                        id={`${idPrefix}-${r}-${c}`}
                        aria-colindex={c + (lead ? 2 : 1)}
                        aria-selected={selC === c || (range !== undefined && c >= range.c0 && c <= range.c1)}
                        onMouseDown={(event) => props.onCellDown(r, c, event)}
                        onDoubleClick={() => props.onCellDouble(r, c)}
                        onMouseEnter={() => props.onCellEnter(r, c)}
                    >
                        {required ? null : action !== undefined && props.actions !== undefined ? (
                            <ActionCellSlot host={props.actions} r={r} columnKey={meta.key} column={action} cell={cell}
                                summary={summary?.type === "String" ? summary.value : ""} selected={selC === c} />
                        ) : (
                            <SheetCellContent
                                styles={sheetStyles}
                                meta={meta}
                                cell={cell}
                                rowBlank={row === undefined}
                                unit={meta.kind === "quantity" && driverKey !== undefined ? meta.uom?.get(driverKey) : undefined}
                                member={member}
                                ghost={undefined}
                                link={meta.kind === "link" ? props.linkCtx(row, meta) : undefined}
                                when={when}
                            />
                        )}
                        {editing && editor.node}
                    </Box>
                );
            })}
        </Box>
    );
});

/** One segment of the column groups' row: a group's columns, or a run of columns no labelled group holds. */
interface GroupSegment {
    /** The group's label; `undefined` for an unlabelled run, which draws no label and no rule. */
    label: string | undefined;
    /** How many tracks it spans. */
    span: number;
    /** The group's place among the groups; `-1` for columns in none. */
    at: number;
}

/**
 * The column groups' row over the columns drawn (HD1): each group's run of
 * columns one segment, and the columns before, between and after them — the
 * select column with the first — segments with no label.
 *
 * @param columns - The columns drawn
 * @param groups - The column groups
 * @param lead - Whether the grid has its select column
 * @returns The segments, or `undefined` with no group, which draws no row
 */
function segmentsOf(columns: readonly SheetColumnMeta[], groups: RecordColumnGroups, lead: boolean): GroupSegment[] | undefined {
    if (groups.length === 0) return undefined;
    const groupOf = new Map<string, number>();
    groups.forEach((group, i) => { for (const key of group.columnKeys) groupOf.set(key, i); });
    const out: GroupSegment[] = [];
    const take = (at: number) => {
        const before = out[out.length - 1];
        if (before !== undefined && before.at === at) { before.span += 1; return; }
        const label = at < 0 ? undefined : groups[at]!.label;
        out.push({ label: label === undefined || label.trim().length === 0 ? undefined : label, span: 1, at });
    };
    if (lead) take(-1);
    for (const meta of columns) take(groupOf.get(meta.key) ?? -1);
    return out;
}

/**
 * The header (GR4, HD1–HD4, SL1): the column groups' row, then the header
 * row, its select column's box ticking every row shown. The two stick
 * together over the rows; nothing sorts.
 */
export function RecordHeader({ columns, gridTemplate, rowPx, rowIds }: SheetHostHeaderProps) {
    const { styles, ticks, groups, lead } = useRecordGrid();
    useSyncExternalStore(ticks.subscribe, ticks.version);
    const n = ticks.count(rowIds);
    const all = rowIds.length > 0 && n === rowIds.length;
    const some = n > 0 && !all;
    const segments = useMemo(() => segmentsOf(columns, groups, lead), [columns, groups, lead]);
    const last = columns.length - 1;
    return (
        <Box css={styles.head} data-slot="head">
            {segments !== undefined && (
                <Box css={styles.groupRow} style={{ gridTemplateColumns: gridTemplate }} data-slot="groupRow" aria-hidden="true">
                    {segments.map((segment, i) => (
                        <Box key={i} css={styles.groupSeg} style={{ gridColumn: `span ${segment.span}` }} data-slot="groupSeg">
                            {segment.label !== undefined && <Box css={styles.groupLabel} title={segment.label}>{segment.label}</Box>}
                            <Box css={styles.groupRule} data-unlabelled={segment.label === undefined ? "" : undefined} />
                        </Box>
                    ))}
                </Box>
            )}
            <Box css={styles.headerRow} style={{ gridTemplateColumns: gridTemplate, height: `${rowPx}px` }} data-slot="headerRow" role="row" aria-rowindex={1}>
                {lead && (
                    <Box css={styles.headerCell} data-tick="" data-first="" role="columnheader" aria-colindex={1}>
                        <chakra.button type="button" css={styles.tick} tabIndex={-1} role="checkbox" aria-checked={all ? true : some ? "mixed" : false}
                            aria-label={m.tickAll({ all })} title={m.tickAll({ all })} data-on={all ? "" : undefined} data-mixed={some ? "" : undefined}
                            onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
                            onClick={() => { if (all) ticks.clear(); else ticks.set(rowIds); }}>
                            {all ? <FontAwesomeIcon icon={faCheck} /> : some ? <FontAwesomeIcon icon={faMinus} /> : null}
                        </chakra.button>
                    </Box>
                )}
                {columns.map((meta, c) => (
                    // Each column's cell is a `headerCell`, as the Sheet's are: a key's move reads where its column is from it.
                    <Box key={meta.key} css={styles.headerCell} data-slot="headerCell" data-key={meta.key} data-kind={meta.kind}
                        data-first={!lead && c === 0 ? "" : undefined} data-last={c === last ? "" : undefined} data-align={alignOf(meta)}
                        role="columnheader" aria-colindex={c + (lead ? 2 : 1)} title={meta.header}>
                        <Box as="span" css={styles.headerLabel}>{meta.header}</Box>
                    </Box>
                ))}
            </Box>
        </Box>
    );
}

/** The empty state (EM1): the narrowing leaves no row to show — it says so, and clears the search, or the filters. */
export function RecordEmpty({ query, onClear }: SheetHostEmptyProps) {
    const { styles, nouns } = useRecordGrid();
    return (
        <Box css={styles.empty} data-slot="empty" role="status">
            <Box as="span" css={styles.emptyMark} aria-hidden="true">×</Box>
            <Box as="span" css={styles.emptyTitle}>{m.emptyTitle({ nouns, query })}</Box>
            <chakra.button type="button" css={styles.emptyClear} data-slot="emptyClear" onClick={onClear}>
                <Box as="span" css={styles.emptyBox} aria-hidden="true">☐</Box>
                <Box as="span" css={styles.emptyLink}>{m.emptyClear({ query })}</Box>
            </chakra.button>
        </Box>
    );
}
