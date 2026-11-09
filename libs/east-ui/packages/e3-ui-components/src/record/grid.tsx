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
 * - **A row** — its select column's box, then a cell for each column: a
 *   Record kind's its own (`cells.tsx`, C1–C10), counting an age to the
 *   Record's clock, and a Sheet kind's the Sheet's (C11). The ring's row and
 *   a ticked row are selected; a row holding drafts takes the draft wash;
 *   the ring's cell is active; a cell its drafts changed is tinted until
 *   Apply; a new row's empty cell a person must fill is washed and says so on
 *   hover, as is any row's number its field's bounds don't hold; a cycle, a toggle or a boolean a person may step lights under the
 *   pointer; an owned row, and every row of a read-only Record, takes no
 *   hover. A cell's mark (#1560) draws its words: a note after the value, or
 *   in an empty cell in its place; a lock the design system's Tag, after the
 *   value or alone, and the cell it locks takes no hover and no gesture. A
 *   conflict not yet chosen rings its cell in the warn colour — a column from
 *   data's where it falls on its member's place in the field — or the row's
 *   edge, where the row itself is one — as the Sheet's rows draw it; a row
 *   with a field still missing is marked incomplete, and a cell's issue is
 *   its description to a screen reader.
 * - **The header** — the column groups' row, each group's label over a rule
 *   under its columns, the columns before the first group and an unlabelled
 *   group drawing neither, then the header row, the select column's box
 *   ticking every row shown, or unticking them once every one is — drawn only
 *   while every row the narrowing shows is read: a paged record's not read
 *   whole has none, so it never ticks the rows read so far for all (#1579).
 * - **The empty state** — the narrowing leaves no row to show: it says so,
 *   and clears the search, or the filters.
 *
 * A press anywhere in the select column's cell ticks, not only on its box. A
 * tick never moves the ring, and the ring never ticks. The select column
 * stays at the left as the columns scroll sideways; a read-only Record has
 * none.
 *
 * On a phone's frame the grid is the Sheet's (#1536): no select column — a row
 * is picked by its title, and its ticks are not shown — the title held at the
 * left behind a strong rule, and the other columns a window the Sheet's pager
 * pages; over them, the pinned title's segment of the group row its own,
 * drawing nothing, and each group's label held over its columns in view and
 * cut to them, as the Sheet says which are in view.
 *
 * @packageDocumentation
 */

import { createContext, memo, useContext, useId, useMemo, useSyncExternalStore, type CSSProperties } from "react";
import { Box, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faMinus } from "@fortawesome/free-solid-svg-icons";
import { StringType, equalFor, printFor, type ValueTypeOf } from "@elaraai/east";
import type { RecordPayloadType } from "@elaraai/e3-ui/internal";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import type { ConflictMarks, SlotStyles } from "@elaraai/east-ui-components/internal";
import type { SheetHostEmptyProps, SheetHostHeaderProps, SheetHostRowProps } from "../sheet/index.js";
import { cellIsBlank, cellWritable, driverKeyOf, markOf, resolveMember, unitOf, type SheetColumnIndex, type SheetColumnMeta } from "../sheet/model.js";
import { SheetCellContent } from "../sheet/cells/Cell.js";
import { cellDetail } from "../sheet/detail.js";
import { namesMember } from "../sheet/Rows.js";
import { stepsInPlace } from "../sheet/steps.js";
import { ActionCellSlot } from "../sheet/actions/ActionCell.js";
import { actionColumnOf } from "../sheet/actions/model.js";
import { useSheetWords } from "../sheet/words.js";
import type { SheetRowValue } from "../sheet/values.js";
import { chipWidths, recordCell } from "./cells.js";
import { useRecordNow } from "./clock.js";
import { recordMessages as m } from "./messages.js";
import type { RecordNoun } from "./status.js";
import type { RecordTicks } from "./ticks.js";

/** The Record's column groups, decoded. */
type RecordColumnGroups = ValueTypeOf<typeof RecordPayloadType>["columnGroups"];

const stringEqual = equalFor(StringType);
/** A member's key as a conflict's step names a `Dict`'s key: as East prints it. */
const printKey = printFor(StringType);

/**
 * What the Record's grid parts read beside the Sheet's: the record recipe's styles, the ticks, the column groups, the
 * rows' word, the title and whether there is an inspector.
 */
export interface RecordGrid {
    /** The record recipe's slot styles, at the Record's density. */
    styles: SlotStyles;
    /** The rows ticked. */
    ticks: RecordTicks;
    /** The column groups, in order. */
    groups: RecordColumnGroups;
    /** The rows' word, one and many — `person`, `people`: what the empty state and the strip say. */
    noun: RecordNoun;
    /** The Record's title: what the strip over nothing names (SP1). */
    title: string | undefined;
    /** Whether the Record has an inspector: where the strip sends a row's details (SP1, SP3). */
    inspector: boolean;
}

const RecordGridContext = createContext<RecordGrid | undefined>(undefined);

/** Provides what the Record's grid parts read beside the Sheet's. */
export const RecordGridProvider = RecordGridContext.Provider;

/**
 * Reads what the Record's grid parts read beside the Sheet's; a part outside a {@link RecordGridProvider} is a
 * mistake of the frame's, and throws.
 *
 * @returns The Record's grid facts
 */
export function useRecordGrid(): RecordGrid {
    const grid = useContext(RecordGridContext);
    if (grid === undefined) throw new Error("A Record grid part is drawn outside a RecordGridProvider");
    return grid;
}

/**
 * How a column's cells and its header sit in them (GR2): a cycle's, a toggle's and a boolean's centred; an age's and a
 * number's at the end, a number's header over its figures; every other at the start.
 */
function alignOf(meta: SheetColumnMeta): "center" | "end" | undefined {
    return meta.kind === "cycle" || meta.kind === "toggle" || meta.kind === "boolean" ? "center"
        : meta.kind === "age" || meta.kind === "quantity" || meta.kind === "integer" ? "end" : undefined;
}

/**
 * The Record's title column — the one a phone pins: its first title column but one made from data, whose cells title a
 * member's value, never the row. What the head of a row's Details names, and where Add and Duplicate put the ring.
 *
 * @param columns - The columns drawn
 * @returns The title column, or `undefined` for a Record with none
 */
export function titleColumnOf(columns: SheetColumnIndex): SheetColumnMeta | undefined {
    return columns.list.find((meta) => meta.kind === "title" && meta.raw.from.type === "none");
}

/**
 * A row's title as it reads: its title column's text, else — with no title column — its first text's but one made
 * from data; `undefined` where that is empty.
 *
 * @param row - The row
 * @param columns - The columns drawn
 * @returns The title, or `undefined`
 */
export function titleOf(row: SheetRowValue, columns: SheetColumnIndex): string | undefined {
    const named = titleColumnOf(columns) ?? columns.list.find((meta) => meta.kind === "text" && meta.raw.from.type === "none");
    const cell = named === undefined ? undefined : row.cells.get(named.key);
    return cell?.type === "String" && cell.value.trim().length > 0 ? cell.value : undefined;
}

/**
 * A row as its box and the strip name it: its title, else its first text, else its key.
 *
 * @param row - The row
 * @param columns - The columns drawn
 * @returns The name
 */
export function nameOf(row: SheetRowValue, columns: SheetColumnIndex): string {
    return titleOf(row, columns) ?? row.id;
}

/**
 * Whether a conflict not yet chosen falls on a cell: on its column's field — or a column from data's on its member's
 * place in the field, a `Dict`'s entry keyed by the member or the struct's field, or on the field whole.
 *
 * @param meta - The cell's column
 * @param conflicts - Where the row's conflicts are
 * @returns Whether the cell wears the warn ring
 */
function conflicted(meta: SheetColumnMeta, conflicts: ConflictMarks | undefined): boolean {
    if (conflicts === undefined) return false;
    const from = getSomeorUndefined(meta.raw.from);
    if (from === undefined) return conflicts.fields.has(meta.key);
    return conflicts.within.get(from.field)?.some(([step]) => step === undefined
        || (step.kind === "key" && stringEqual(step.key, printKey(from.member)))
        || (step.kind === "field" && stringEqual(step.name, from.member))) === true;
}

/**
 * A row (GR1–GR3, SL1, ST1–ST9): its select column's box, then its cells, the
 * Sheet's gestures on each — see the module docs.
 */
export const RecordRow = memo(function RecordRow(props: SheetHostRowProps) {
    const { styles: sheetStyles, r, row, columns, registers, gridTemplate, layout, rowPx, idPrefix, selC, range, editor, draft, changes, writable } = props;
    const { styles, ticks } = useRecordGrid();
    const words = useSheetWords();
    // Each cell's issue, read out as its description: `{issuePrefix}-{c}`.
    const issuePrefix = useId();
    // The select column, where the grid lays it out: a read-only Record has none, nor a phone's frame.
    const lead = layout.lead;
    const pinned = layout.pinPx > 0;
    // The clock, read once for the row's every age; the row draws again as it moves.
    const now = useRecordNow();
    const chips = useMemo(() => chipWidths(columns, registers), [columns, registers]);
    const id = row?.id;
    // A tick shows where the select column does: on a phone a row is picked by its title.
    const ticked = useSyncExternalStore(ticks.subscribe, () => lead && id !== undefined && ticks.has(id));
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
            data-conflict={draft?.conflicts?.whole === true ? "" : undefined}
            data-incomplete={draft?.incomplete === true ? "" : undefined}
            data-still={still ? "" : undefined}
            role="row"
            aria-rowindex={props.ariaRowIndex}
            aria-selected={selC !== undefined || ticked}
        >
            {lead && (
                // The whole cell ticks, its box the checkbox a screen reader names; a press leaves the keyboard where it is.
                <Box css={styles.cell} data-pick="" data-first="" role="gridcell" aria-colindex={1}
                    onMouseDown={row !== undefined ? (event) => { event.preventDefault(); event.stopPropagation(); } : undefined}
                    onClick={row !== undefined ? (event) => { event.stopPropagation(); ticks.toggle(row.id); } : undefined}>
                    {row !== undefined && (
                        // Out of the tab order, as every control in the grid is: the grid is one tab stop.
                        <chakra.button type="button" css={styles.tick} tabIndex={-1} role="checkbox" aria-checked={ticked}
                            aria-label={m.tickRow({ name, ticked })} title={m.tickRow({ name, ticked })} data-on={ticked ? "" : undefined}>
                            {ticked && <FontAwesomeIcon icon={faCheck} />}
                        </chakra.button>
                    )}
                </Box>
            )}
            {columns.list.map((meta, c) => {
                const cell = row?.cells.get(meta.key);
                const editing = editor?.c === c;
                // The one check every gesture asks (#1560): the column writes, and no mark locks the cell.
                const mark = markOf(meta, row?.cells);
                const locked = mark?.lock === true;
                const editable = writable && cellWritable(meta, row?.cells) && meta.kind !== "stamped" && meta.kind !== "action";
                // A new row's empty cell a person must fill (ST8) — its field still missing: never an option's, nor a column
                // from data's — washed, empty, and saying so on hover.
                const required = changes?.added === true && editable && cellIsBlank(cell) && changes.missing.has(meta.key);
                // A number its field's bounds don't hold (#1585), whatever row holds it: washed as a missing field is, saying the bound.
                const bounded = draft?.bounds?.has(meta.key) === true;
                const issue = cell?.type === "Invalid" ? words.m.issueInvalid({ value: cell.value }) : draft?.issues.get(meta.key);
                const issueId = `${issuePrefix}-${c}`;
                const detail = row !== undefined ? cellDetail(meta, row.cells, words) : undefined;
                const member = namesMember(meta) && cell?.type === "String" ? resolveMember(registers, meta.register, cell.value) : undefined;
                const actualCell = meta.kind === "date" && meta.actual !== undefined ? row?.cells.get(meta.actual) : undefined;
                const when = meta.kind === "date" && meta.level !== undefined && row !== undefined
                    ? { level: meta.level(row.cells), actual: actualCell?.type === "DateTime" ? actualCell.value : undefined }
                    : undefined;
                // An action cell (#1475): its state, its summary and the controls of what it offers, over the Sheet's host.
                const action = meta.kind === "action" && props.actions !== undefined && row !== undefined ? actionColumnOf(meta) : undefined;
                const summary = action !== undefined ? row?.cells.get(action.summary) : undefined;
                // A Record kind's cell, and what it says on hover; a Sheet kind's is the Sheet's (C11).
                const view = row === undefined || required ? undefined
                    : recordCell({ styles, meta, row, cell, registers, changes, now, words, chip: chips.get(meta.key) });
                // A mark's words: in an empty cell in its place — but an action cell's, whose state draws whatever it holds — else
                // after the value; a lock's as the Tag either way.
                const alone = mark !== undefined && action === undefined && cellIsBlank(cell);
                const marked = mark === undefined || (mark.words === "" && !locked) ? null
                    : locked ? <Box as="span" css={styles.lock} data-slot="lock" data-alone={alone ? "" : undefined}>{mark.words}</Box>
                        : <Box as="span" css={alone ? styles.absent : styles.note} data-slot="note" data-alone={alone ? "" : undefined}>{mark.words}</Box>;
                const said = required ? m.required({ header: meta.header }) : issue ?? view?.title ?? detail?.title;
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
                        data-bounds={bounded ? "" : undefined}
                        data-first={!lead && c === 0 ? "" : undefined}
                        data-last={c === last ? "" : undefined}
                        data-pinned={pinned && c === 0 ? "" : undefined}
                        data-align={alignOf(meta)}
                        data-still={still || locked ? "" : undefined}
                        data-locked={locked ? "" : undefined}
                        data-conflict={conflicted(meta, draft?.conflicts) ? "" : undefined}
                        // A required cell's one issue is that it is empty: it says so in the Record's words. A mark's words follow.
                        title={mark === undefined ? said : m.marked({ text: said, words: mark.words, lock: locked })}
                        aria-invalid={issue !== undefined ? true : undefined}
                        aria-describedby={issue !== undefined ? issueId : undefined}
                        aria-readonly={locked ? true : undefined}
                        role="gridcell"
                        id={`${idPrefix}-${r}-${c}`}
                        aria-colindex={c + (lead ? 2 : 1)}
                        aria-selected={selC === c || (range !== undefined && c >= range.c0 && c <= range.c1)}
                        onMouseDown={(event) => props.onCellDown(r, c, event)}
                        onDoubleClick={() => props.onCellDouble(r, c)}
                        onMouseEnter={() => props.onCellEnter(r, c)}
                    >
                        {issue !== undefined && <Box as="span" css={sheetStyles.cellIssue} id={issueId}>{issue}</Box>}
                        {alone ? null : required ? null : action !== undefined && props.actions !== undefined ? (
                            <ActionCellSlot host={props.actions} r={r} columnKey={meta.key} column={action} cell={cell}
                                summary={summary?.type === "String" ? summary.value : ""} selected={selC === c} />
                        ) : view !== undefined ? view.content : (
                            <SheetCellContent
                                styles={sheetStyles}
                                meta={meta}
                                cell={cell}
                                rowBlank={row === undefined}
                                unit={unitOf(meta, driverKey)}
                                member={member}
                                ghost={undefined}
                                link={meta.kind === "link" ? props.linkCtx(row, meta) : undefined}
                                when={when}
                            />
                        )}
                        {marked}
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
    /** A phone's pinned column's own, held at the left with it: it draws nothing. */
    pinned: boolean;
    /** Where its first track stands among the columns drawn: the select column's at `-1`, before the first. */
    from: number;
}

/**
 * The column groups' row over the columns drawn (HD1): each group's run of
 * columns one segment, and the columns before, between and after them — the
 * select column with the first — segments with no label. A column a phone's
 * frame pins is a segment of its own, which draws nothing: the groups are
 * labelled over the window beside it.
 *
 * @param columns - The columns drawn
 * @param groups - The column groups
 * @param lead - Whether the grid lays out its select column
 * @param pinned - Whether the first column is held at the left
 * @returns The segments, or `undefined` with no group, which draws no row
 */
function segmentsOf(columns: readonly SheetColumnMeta[], groups: RecordColumnGroups, lead: boolean, pinned: boolean): GroupSegment[] | undefined {
    if (groups.length === 0) return undefined;
    const groupOf = new Map<string, number>();
    groups.forEach((group, i) => { for (const key of group.columnKeys) groupOf.set(key, i); });
    const out: GroupSegment[] = [];
    const take = (at: number, from: number) => {
        const before = out[out.length - 1];
        if (before !== undefined && !before.pinned && before.at === at) { before.span += 1; return; }
        const label = at < 0 ? undefined : groups[at]!.label;
        out.push({ label: label === undefined || label.trim().length === 0 ? undefined : label, span: 1, at, pinned: false, from });
    };
    if (lead) take(-1, -1);
    columns.forEach((meta, c) => {
        if (pinned && c === 0) out.push({ label: undefined, span: 1, at: -1, pinned: true, from: 0 });
        else take(groupOf.get(meta.key) ?? -1, c);
    });
    return out;
}

/**
 * The header (GR4, HD1–HD4, SL1): the column groups' row, then the header
 * row, its select column's box ticking every row shown. The two stick
 * together over the rows; nothing sorts.
 */
export function RecordHeader({ columns, gridTemplate, layout, rowPx, rowIds, whole, columnWindow }: SheetHostHeaderProps) {
    const { styles, ticks, groups } = useRecordGrid();
    const lead = layout.lead;
    const pinned = layout.pinPx > 0;
    useSyncExternalStore(ticks.subscribe, ticks.version);
    const n = ticks.count(rowIds);
    const all = rowIds.length > 0 && n === rowIds.length;
    const some = n > 0 && !all;
    const segments = useMemo(() => segmentsOf(columns, groups, lead, pinned), [columns, groups, lead, pinned]);
    const last = columns.length - 1;
    // A phone's window among the columns drawn: the paged ones start past the pinned one.
    const shownFrom = columnWindow === undefined ? 0 : columnWindow.first + (pinned ? 1 : 0);
    return (
        // The pinned column's width: on a phone a group's label holds past it, over the group's columns in view.
        <Box css={styles.head} data-slot="head" data-phone={layout.phone ? "" : undefined} style={{ "--record-pin": `${layout.pinPx}px` } as CSSProperties}>
            {segments !== undefined && (
                <Box css={styles.groupRow} style={{ gridTemplateColumns: gridTemplate }} data-slot="groupRow" aria-hidden="true">
                    {segments.map((segment, i) => {
                        // How much of the group the window shows: its label is cut to it, so a long one holds clear of the
                        // pinned column as the window pages part of the group off (#1536).
                        const shown = columnWindow === undefined ? undefined
                            : Math.max(0, Math.min(segment.from + segment.span, shownFrom + columnWindow.inView) - Math.max(segment.from, shownFrom)) * columnWindow.slotPx;
                        return (
                            <Box key={i} css={styles.groupSeg} style={{ gridColumn: `span ${segment.span}` }} data-slot="groupSeg" data-pinned={segment.pinned ? "" : undefined}>
                                {segment.label !== undefined && (
                                    <Box css={styles.groupLabel} data-slot="groupLabel" title={segment.label}
                                        style={shown === undefined ? undefined : { "--record-group-shown": `${shown}px` } as CSSProperties}>{segment.label}</Box>
                                )}
                                <Box css={styles.groupRule} data-unlabelled={segment.label === undefined ? "" : undefined} />
                            </Box>
                        );
                    })}
                </Box>
            )}
            <Box css={styles.headerRow} style={{ gridTemplateColumns: gridTemplate, height: `${rowPx}px` }} data-slot="headerRow" role="row" aria-rowindex={1}>
                {lead && (
                    // While it draws its box, the whole cell ticks every row shown, or unticks them.
                    <Box css={styles.headerCell} data-tick="" data-first="" role="columnheader" aria-colindex={1}
                        onMouseDown={whole ? (event) => { event.preventDefault(); event.stopPropagation(); } : undefined}
                        onClick={whole ? () => { if (all) ticks.clear(); else ticks.set(rowIds); } : undefined}>
                        {whole && (
                            <chakra.button type="button" css={styles.tick} tabIndex={-1} role="checkbox" aria-checked={all ? true : some ? "mixed" : false}
                                aria-label={m.tickAll({ all })} title={m.tickAll({ all })} data-on={all ? "" : undefined} data-mixed={some ? "" : undefined}>
                                {all ? <FontAwesomeIcon icon={faCheck} /> : some ? <FontAwesomeIcon icon={faMinus} /> : null}
                            </chakra.button>
                        )}
                    </Box>
                )}
                {columns.map((meta, c) => (
                    // Each column's cell is a `headerCell`, as the Sheet's are: a key's move reads where its column is from it.
                    <Box key={meta.key} css={styles.headerCell} data-slot="headerCell" data-key={meta.key} data-kind={meta.kind}
                        data-first={!lead && c === 0 ? "" : undefined} data-last={c === last ? "" : undefined} data-pinned={pinned && c === 0 ? "" : undefined}
                        data-align={alignOf(meta)} role="columnheader" aria-colindex={c + (lead ? 2 : 1)} title={meta.header}>
                        <Box as="span" css={styles.headerLabel}>{meta.header}</Box>
                    </Box>
                ))}
            </Box>
        </Box>
    );
}

/** The empty state (EM1): the narrowing leaves no row to show — it says so, and clears the search, or the filters. */
export function RecordEmpty({ query, onClear }: SheetHostEmptyProps) {
    const { styles, noun } = useRecordGrid();
    return (
        <Box css={styles.empty} data-slot="empty" role="status">
            <Box as="span" css={styles.emptyMark} aria-hidden="true">×</Box>
            <Box as="span" css={styles.emptyTitle}>{m.emptyTitle({ nouns: noun.plural, query })}</Box>
            <chakra.button type="button" css={styles.emptyClear} data-slot="emptyClear" onClick={onClear}>
                <Box as="span" css={styles.emptyBox} aria-hidden="true">☐</Box>
                <Box as="span" css={styles.emptyLink}>{m.emptyClear({ query })}</Box>
            </chakra.button>
        </Box>
    );
}
