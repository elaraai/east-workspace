/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Table (`Allocation Spec.md` §8, A41–A49, A84, #1329): one row per lane
 * slot of the day and one per extra bin of a batch, in foldable time bands
 * (the app's, four by default), narrowed by the lanes, the resources and the
 * arrivals the slice shows (#1336, #1339) and never reordered by an
 * allocation. Each row's arrival and resource are a chip or a dashed
 * placeholder; a chip's × removes or unlinks, and a cell's chevron opens the
 * shared Chooser, every section of it the app's fit's answer. A bin's chip
 * drags onto a free row's arrival cell (A47). A split or partly allocated bin lists its parts as resource chips
 * with their quantities across the Resource and Load columns, each its own
 * chevron and ×, and `+ resource` for its remainder (A71, #1332). Every
 * figure and word is e3-ui's; every size the `allocationBuilder` recipe's. A
 * day not read yet draws its column heads and its bands at once, each band's
 * count a placeholder and one placeholder row in it (#1398, CL2); a day whose
 * read failed says so once, in the first of those rows in view, with Retry
 * (CL11).
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { Box, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faArrowDown, faChevronDown, faChevronUp, faCircleExclamation, faGripVertical, faInbox, faLink, faLinkSlash, faPlus, faTriangleExclamation, faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { variant, type SortedMap, type option } from "@elaraai/east";
import { SliceEditPopover, useDragEventChip, useDropCell, useTrackedEvaluation, type Formatters } from "@elaraai/east-ui-components";
import {
    Chooser, LoadingFailedLine, PlaceholderShape, VirtualRows, formatDatePattern, useRowsTop, type ChooserSection, type PlaceholderKind,
} from "@elaraai/east-ui-components/internal";
import type { PeriodRead } from "../shared/loading.js";
import { GroupHeading, useGroupCollapse } from "../shared/schedule/group-heading.js";
import { MoveGhost } from "../shared/schedule/move-ghost.js";
import { useRowAnchor, type RowAnchor } from "../shared/schedule/row-anchor.js";
import { linkedQuantity, remainderOf, type AllocationCommands } from "./actions.js";
import { arrivalChoices, resourceChoices, type ChoiceWords } from "./choices.js";
import { dropTarget, gripCoord, laneCoord, resourceCellCoord, type AllocationDrag, type Grip, type Target } from "./drag.js";
import type { AllocationFit } from "./fit.js";
import { bandLine, narrowBands, rowStatus, tableBands, tableRows, type TableBand, type TableRow } from "./table-rows.js";
import { NarrowedEmpty } from "./narrowed.js";
import { a, one, useNouns } from "./nouns.js";
import type { TimelineFollow } from "./timeline.js";
import {
    allocationWords, compareFloat, partsOf, type AllocationDomain, type AllocationStyles, type AllocationValue, type Bin, type Context, type Day, type FitAsk,
    type Load, type ResourceLine, type Selection, type Slot,
} from "./model.js";

/** A band's and a row's height, the recipe's: the rows are virtualised by them. */
const BAND_H = 38;
const ROW_H = 36;
/** The probe reservation a free row's resource Chooser asks the fit about. */
export const RESERVE_PROBE = "\u0000reserve";

/** The Table's props. */
export interface TableProps {
    value: AllocationValue;
    domain: AllocationDomain;
    context: Context;
    styles: AllocationStyles;
    format: Formatters;
    day: Date;
    plan: Day;
    held: Day | undefined;
    sameBin: (a: Bin, b: Bin) => boolean;
    loads: SortedMap<string, Load>;
    slots: readonly Slot[];
    selection: Selection | undefined;
    editable: boolean;
    select: (next: Selection | undefined, soft?: boolean) => void;
    follow: TimelineFollow;
    drag: AllocationDrag;
    commands: AllocationCommands;
    fit: AllocationFit;
    /** The day without a bin, and with a probe reservation in a free slot: what a cell's Chooser asks the fit of. */
    without: (bin: string) => Day;
    reserving: (lane: string, at: Date) => Day;
    /** The lanes, the resources and the arrivals the narrowing shows, by key; `none` for every one (#1336, #1339). */
    visibleLanes: option<Set<string>>;
    visibleResources: option<Set<string>>;
    visibleArrivals: option<Set<string>>;
    /** Clears the narrowing, where nothing shows; `undefined` with no narrowing. */
    clearFilters: (() => void) | undefined;
    /** The arrival whose every bin the Library's Allocated card highlights (A10). */
    highlight: string | undefined;
    /** Books the picked arrival where a click lands, as its drop would (A11). */
    book: (target: Target) => void;
    /**
     * What it draws of the day's read (#1398): the day as read; a day not read yet — the day without its bins handed in
     * as `plan`, its bands real, a placeholder row in each once the reveal says so; or one whose read failed — the failure
     * said once, in the first of those rows in view.
     */
    read: PeriodRead;
    /** Where the Table's view last rested (#1398): its top line, by key, which it comes back to as it mounts. */
    anchor?: RowAnchor | undefined;
    /** Told where the Table's view rests as its scroll settles. */
    onAnchor?: ((at: RowAnchor) => void) | undefined;
}

/**
 * A row's cell a Chooser is open on: its arrival, or its resource — the
 * row's, one part of a split bin's (`part`, its resource), or the remainder's
 * (`part: null`, `+ resource`, A71). A narrow card's actions open the same
 * Choosers (A78).
 */
export interface Open { row: string; side: "arrival" | "resource"; part?: string | null | undefined }

/** A Chooser's identity in its row, as a row's memo compares it: `arrival`, `resource`, `resource:K-203`, `resource:+`. */
export const openKey = (side: Open["side"], part: Open["part"]) => part === undefined ? side : `${side}:${part ?? "+"}`;

/** One flattened line of the virtualised Table: a band's head, a row, or a band's placeholder row while the day is not read (#1398). */
type Line = { kind: "band"; band: TableBand } | { kind: "row"; band: TableBand; row: TableRow } | { kind: "unread"; band: TableBand };

/** What a placeholder row draws in each of the Table's columns, in their order (#1398): Time, Lane, Arrival, Quantity, the app's, Resource, Load, Status. */
function unreadColumns(shown: number): PlaceholderKind[] {
    return ["date", "label", "chip", "number", ...Array.from({ length: shown }, (): PlaceholderKind => "text"), "chip", "aggregate", "enum"];
}

/**
 * The line a failed day says so in (#1398, CL11): the first placeholder row at or below the row at the top of the view,
 * else the last one above it.
 *
 * @param lines - The Table's lines
 * @param top - The line at the top of the view; `undefined` before the lines are placed
 * @returns The line's index; `undefined` with no placeholder row
 */
function firstUnreadInView(lines: readonly Line[], top: number | undefined): number | undefined {
    const from = Math.max(0, top ?? 0);
    for (let i = from; i < lines.length; i++) if (lines[i]!.kind === "unread") return i;
    for (let i = Math.min(from, lines.length) - 1; i >= 0; i--) if (lines[i]!.kind === "unread") return i;
    return undefined;
}

/**
 * A band's placeholder row of a day not read, or whose read failed (#1398, CL2, CL11): a placeholder in each column — or,
 * the first of them in view of a failed day, the failure said across the row. It reads which line is at the top of the
 * view itself, drawn again only as it becomes or stops being the one that says it (CL9).
 */
function UnreadRow({ styles, band, index, lines, read, shown }: {
    styles: AllocationStyles; band: TableBand; index: number; lines: readonly Line[]; read: PeriodRead; shown: number;
}) {
    const says = useRowsTop(top => read.state === "failed" && index === firstUnreadInView(lines, top));
    const failure = says && read.state === "failed" ? read : undefined;
    return <Box css={styles.tableRow} data-allocation-unread-row={band.key} data-columns={shown === 0 ? "none" : undefined}
        aria-hidden={failure === undefined ? true : undefined}>
        {failure !== undefined
            ? <Box css={styles.tableReadLine} data-allocation-read-line="failed"><LoadingFailedLine message={failure.message} retry={{ onRetry: failure.retry }} /></Box>
            : unreadColumns(shown).map((kind, i) => <Box key={i} as="span" css={styles.tableUnreadCell} data-align={kind === "number" ? "end" : undefined}>
                {read.state === "pending" && <PlaceholderShape kind={kind} index={index + i} />}
            </Box>)}
    </Box>;
}

/**
 * The Table (see the module docs).
 *
 * @param props - See {@link TableProps}
 * @returns Its bands and rows under their column heads
 */
export function AllocationTable(props: TableProps) {
    const { value, domain, plan, slots, day, context, styles, drag } = props;
    const words = allocationWords();
    const nouns = useNouns();
    const unit = context.unit;
    // A row a hidden lane holds, whose every resource is hidden, or whose arrival is, goes; a band the narrowing empties goes with it.
    const { visibleLanes, visibleResources, visibleArrivals } = props;
    const bands = useMemo(() => narrowBands(tableBands(tableRows(slots, plan), plan, day, value.table.bands), plan, visibleLanes, visibleResources, visibleArrivals),
        [slots, plan, day, value.table.bands, visibleLanes, visibleResources, visibleArrivals]);
    const rows = useMemo(() => bands.flatMap(band => band.rows), [bands]);
    const { collapsed, toggle } = useGroupCollapse(`${drag.surface}.table`);
    // A day not read yet, or whose read failed (#1398): its bands, known from its slots, and one placeholder row in each
    // that holds a slot — how many rows it has waits on its bins.
    const { read } = props;
    const unread = read.state !== "held";
    // Not read yet, a placeholder where each figure goes, unseen until the frame's reveal says so, which each reads itself (CL4).
    const pending = read.state === "pending";
    const lines = useMemo((): Line[] => bands.flatMap(band => [{ kind: "band" as const, band },
        ...(collapsed.includes(band.key) ? [] : unread ? band.rows.length === 0 ? [] : [{ kind: "unread" as const, band }]
            : band.rows.map(row => ({ kind: "row" as const, band, row })))]), [bands, collapsed, unread]);
    const sizes = useMemo(() => lines.map(l => l.kind === "band" ? BAND_H : ROW_H), [lines]);
    const getItemKey = useCallback((index: number) => {
        const l = lines[index]!;
        return l.kind === "band" ? `band:${l.band.key}` : l.kind === "unread" ? `unread:${l.band.key}` : l.row.key;
    }, [lines]);
    // Where the Table's view rests (#1398): its top line by key and the px into it, saved as a scroll settles and brought
    // back once its lines are laid out — the line it left, wherever the lines above it moved.
    const keyed = useMemo(() => lines.map((_, i) => ({ key: getItemKey(i) })), [lines, getItemKey]);
    const { restore, onAnchorChange } = useRowAnchor(keyed, props.anchor, props.onAnchor);
    // The app's columns shown in the Table, each bin's text and tone over its row, through its callbacks (§6).
    const shown = useMemo(() => value.columns.filter(c => c.table), [value.columns]);
    const readColumns = useCallback(() => {
        const out = new Map<string, { text: string; warn: boolean }[]>();
        for (const [id, bin] of plan.bins) {
            if (bin.arrival.type !== "some") continue;
            const bytes = domain.encodeRow(bin.row);
            out.set(id, shown.map(c => {
                const tone = c.tone.type === "some" ? c.tone.value(bytes) : undefined;
                return { text: c.text(bytes), warn: tone?.type === "some" && (tone.value.type === "warning" || tone.value.type === "danger") };
            }));
        }
        return out;
    }, [plan, domain, shown]);
    const columns = useTrackedEvaluation(readColumns);
    const cells = columns.result.ok ? columns.result.value : undefined;
    const resourceLines = useMemo(() => new Map(value.resources.map(r => [r.key, words.line(day, r, props.loads.get(r.key)!, unit)] as const)), [value.resources, props.loads, day, unit, words]);
    const [open, setOpen] = useState<Open>();
    // Another day, or the drafts' row gone: its Chooser closes.
    useEffect(() => { if (open !== undefined && !rows.some(r => r.key === open.row)) setOpen(undefined); }, [rows, open]);
    const vars = { "--allocation-columns": shown.length, "--allocation-arrival-span": 2 + shown.length } as CSSProperties;

    // Selecting follows the selection (A12): its row scrolls into view a third from the top.
    const pane = useRef<HTMLDivElement | null>(null);
    const selectionRef = useRef(props.selection);
    selectionRef.current = props.selection;
    useLayoutEffect(() => {
        const el = pane.current, selection = selectionRef.current;
        if (props.follow.nonce === 0 || el === null || selection === undefined) return;
        const index = lines.findIndex(l => l.kind === "row" && selects(selection, l.row, plan, props.highlight) === "row");
        if (index < 0) return;
        const y = sizes.slice(0, index).reduce((a, b) => a + b, 0), view = el.clientHeight - ROW_H;
        if (y < el.scrollTop || y + ROW_H > el.scrollTop + view) el.scrollTop = Math.max(0, Math.round((y - view / 3) / ROW_H) * ROW_H);
        // The follow request is the trigger.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.follow.nonce]);

    // A picked arrival's question of each reservation, asked once the Table has rendered: its arrival cell says whether it fits (A11, A45).
    const pickKey = drag.grip === undefined && drag.subject !== undefined && (drag.subject.kind === "arrival" || drag.subject.kind === "removed") ? `${drag.subject.kind}|${drag.subject.kind === "arrival" ? drag.subject.arrival : drag.subject.bin}` : "";
    const { verdict } = drag;
    useEffect(() => {
        const subject = drag.subject;
        if (pickKey === "" || subject === undefined) return;
        for (const row of rows) if (row.kind === "reserved") verdict(subject, arrivalTarget(row));
        // The pick and the rows are the question.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pickKey, rows]);

    const choiceWords: ChoiceWords = useMemo(() => ({
        quantity: v => words.quantity(v, unit), number: v => words.quantity(v, ""), lane: key => value.lanes.find(l => l.key === key)?.label ?? key,
    }), [words, unit, value.lanes]);
    const head = <Box css={styles.tableHead} data-columns={shown.length === 0 ? "none" : undefined} data-allocation-table-head="">
        <span>Time</span><span title={nouns.lane.one}>{nouns.lane.one}</span><span title={nouns.arrival.one}>{nouns.arrival.one}</span>
        <Box as="span" data-align="end" title={nouns.quantity}>{nouns.quantity}</Box>
        {shown.map(c => <span key={c.key} title={c.label}>{c.label}</span>)}<span title={nouns.resource.one}>{nouns.resource.one}</span><span>Load</span><span>Status</span>
    </Box>;
    // The narrowing's empty state only under a narrowing (#1398, CL13).
    const narrowed = visibleLanes.type === "some" || visibleResources.type === "some" || visibleArrivals.type === "some";
    return <Box css={styles.table} style={vars} data-allocation-table="" data-allocation-drag={drag.grip?.kind} data-allocation-unread={unread ? read.state : undefined}>
        {/* Its rows as wide as the recipe's least width for its tracks: no cell past a row's edge. */}
        {lines.length === 0 ? <>{head}{narrowed && <NarrowedEmpty styles={styles} clear={props.clearFilters} />}</> : <VirtualRows fillParent height={undefined} maxHeight={undefined} rootCss={styles.tablePane} minWidth="var(--allocation-table-least)" scrollElRef={pane}
            headerZIndex={4} header={head} count={lines.length} getItemKey={getItemKey} sizes={sizes} measureRows={false}
            onAnchorChange={onAnchorChange} restoreAnchor={restore}
            renderRow={index => {
                const line = lines[index]!;
                if (line.kind === "band") {
                    const folded = collapsed.includes(line.band.key);
                    // A day not read yet: its band's count a placeholder, its line said once its rows land.
                    return <GroupHeading scope="allocation" group={{ key: line.band.key, label: line.band.label }} styles={styles} collapsed={folded} toggle={toggle}>
                        {unread ? pending && <PlaceholderShape kind="count" index={index} /> : <>
                            <Box as="span" css={styles.bandCount} data-allocation-band-count="">{line.band.rows.length}</Box>
                            <Box as="span" css={styles.groupMeta}>{bandLine(line.band, words.quantity(Math.round(line.band.quantity), unit), folded)}</Box>
                        </>}
                    </GroupHeading>;
                }
                if (line.kind === "unread") return <UnreadRow styles={styles} band={line.band} index={index} lines={lines} read={read} shown={shown.length} />;
                return <Row props={props} row={line.row} columns={cells?.get(line.row.bin ?? "")} shown={shown.length} lines={resourceLines}
                    open={open?.row === line.row.key ? openKey(open.side, open.part) : undefined} setOpen={setOpen} words={choiceWords} />;
            }} />}
    </Box>;
}

/** A row's arrival cell, as a drop or a pick names it: its slot, the reservation it holds, on the Table. */
const arrivalTarget = (row: TableRow): Target => ({ kind: "lane", lane: row.lane, at: row.slotAt, card: row.kind === "reserved" ? row.bin : undefined, table: true });

/** How a selection marks a row (A44): as its own, as one of the selected resource's, or as one of the bins the Library highlights (A10). */
function selects(selection: Selection | undefined, row: TableRow, plan: Day, highlight?: string): "row" | "resource" | undefined {
    const shown = row.bin === undefined ? undefined : plan.bins.get(row.bin);
    if (highlight !== undefined && shown?.arrival.type === "some" && shown.arrival.value === highlight) return "row";
    if (selection === undefined) return undefined;
    if (selection.type === "bin") return row.bin === selection.id ? "row" : undefined;
    if (selection.type === "slot") return row.kind === "free" && row.lane === selection.lane && row.slotAt.getTime() === selection.at ? "row" : undefined;
    const bin = row.bin === undefined ? undefined : plan.bins.get(row.bin);
    return bin?.parts.has(selection.key) === true ? "resource" : undefined;
}

interface RowProps {
    props: TableProps; row: TableRow; columns: readonly { text: string; warn: boolean }[] | undefined; shown: number;
    lines: ReadonlyMap<string, ResourceLine>;
    /** The row's open Chooser, by its key (`openKey`). */
    open: string | undefined;
    setOpen: (open: Open | undefined) => void; words: ChoiceWords;
}

/**
 * What an empty cell says during a drag or a pick (A45): it takes the drop
 * (`fits`, its words under the pointer), it refuses it (`doesn't fit`, the
 * reason as its tooltip and, under the pointer, the reason itself), or — a
 * pick — a click books it there.
 */
interface Say { state: "fits" | "refused" | "pick"; drop: string; reason: string | undefined; pick: string | undefined }

/** A verdict as a cell says it; nothing while the fit's answer is on its way, or where nothing drops. */
function sayOf(verdict: { allowed: boolean; pending: boolean; caption: string; reason?: string | undefined }, drop: string, pick: string | undefined): Say | undefined {
    if (verdict.pending || (!verdict.allowed && verdict.caption === "")) return undefined;
    if (!verdict.allowed) return { state: "refused", drop, reason: verdict.reason ?? verdict.caption, pick: undefined };
    return pick === undefined ? { state: "fits", drop, reason: undefined, pick: undefined } : { state: "pick", drop, reason: undefined, pick };
}

/**
 * A row (A43): the drag hooks here — its arrival chip's handle, its arrival
 * and resource cells' targets — outside its body, so pointer motion repaints
 * nothing in it (A35).
 */
function Row(args: RowProps) {
    const { props, row } = args;
    const { drag, plan, context, styles } = props;
    const bin = row.bin === undefined ? undefined : plan.bins.get(row.bin);
    const words = allocationWords();
    const code = bin?.arrival.type === "some" ? context.arrivals.get(bin.arrival.value)?.label ?? bin.arrival.value : undefined;
    const label = useMemo(() => code === undefined || bin === undefined ? "" : `${code} · ${words.quantity(bin.quantity, context.unit)}`, [code, bin, words, context.unit]);
    const ghost = useMemo(() => <MoveGhost styles={styles} label={label} />, [styles, label]);
    const chipAt = useMemo(() => drag.enabled && row.kind === "bin" && row.bin !== undefined ? gripCoord(drag.surface, { kind: "body", bin: row.bin }) : null, [drag.enabled, drag.surface, row.kind, row.bin]);
    const chip = useDragEventChip(chipAt, ghost, false, label);
    // A free row's arrival cell takes a bin to its slot; a reserved row's, a bin into the reservation (A37, A38): each the board's one drop target (§10).
    const takes = row.kind !== "bin";
    const arrival = dropTarget(drag, { kind: "lane", lane: row.lane, at: row.slotAt, card: row.kind === "reserved" ? row.bin : undefined, table: true });
    const arrivalDrop = useDropCell(drag.enabled && takes ? laneCoord(drag.surface, row.lane, row.slotAt, row.kind === "reserved" ? row.bin : undefined, true) : null, false, arrival.veto, undefined, arrival.options);
    const resource = dropTarget(drag, { kind: "cell", row: row.key });
    const resourceDrop = useDropCell(drag.enabled ? resourceCellCoord(drag.surface, row.key) : null, false, resource.veto, undefined, resource.options);
    // What the cells say while something is dragged, or an arrival picked (A11, A32, A45): the board's one verdict, asked nothing here.
    const subject = drag.subject, dragging = drag.grip !== undefined;
    const pickedCode = !dragging && subject !== undefined && (subject.kind === "arrival" || subject.kind === "removed") ? libraryCode(props, subject) : undefined;
    const arrivalVerdict = takes && subject !== undefined && subject.kind !== "resource" && (dragging ? subject.kind !== "port" && subject.kind !== "link" : pickedCode !== undefined)
        ? drag.peek(subject, arrivalTarget(row)) : undefined;
    const resourceVerdict = dragging && subject?.kind === "resource" ? drag.peek(subject, { kind: "cell", row: row.key }) : undefined;
    const arrivalSay = arrivalVerdict === undefined ? undefined : sayOf(arrivalVerdict, subject?.kind === "body" ? "drop to move here" : "drop to book here",
        pickedCode === undefined ? undefined : `click to book ${pickedCode} here`);
    const resourceSay = resourceVerdict === undefined || resourceVerdict.caption === "already on it" ? undefined
        : sayOf(resourceVerdict, row.kind === "free" ? "drop to reserve" : "drop to link", undefined);
    return <RowBody {...args} bin={bin} code={code} chip={chip} arrivalDrop={arrivalDrop} resourceDrop={resourceDrop}
        arrivalState={arrivalSay?.state} arrivalWords={arrivalSay?.drop} arrivalReason={arrivalSay?.reason} arrivalPick={arrivalSay?.pick}
        resourceState={resourceSay?.state} resourceWords={resourceSay?.drop} resourceReason={resourceSay?.reason} />;
}

/** A Library card's code, as a cell's words name it. */
function libraryCode(props: TableProps, grip: Extract<Grip, { kind: "arrival" | "removed" }>): string {
    if (grip.kind === "arrival") return props.context.arrivals.get(grip.arrival)?.label ?? grip.arrival;
    const arrival = props.held?.bins.get(grip.bin)?.arrival;
    return arrival?.type === "some" ? props.context.arrivals.get(arrival.value)?.label ?? arrival.value : grip.bin;
}

/** A row's body: its cells, from the drafts, the loads and the app's columns. */
const RowBody = memo(function RowBody({ props, row, columns, shown, lines, open, setOpen, words, bin, code, chip, arrivalDrop, resourceDrop,
    arrivalState, arrivalWords, arrivalReason, arrivalPick, resourceState, resourceWords, resourceReason }: RowProps & {
    bin: Bin | undefined; code: string | undefined; chip: ReturnType<typeof useDragEventChip>;
    arrivalDrop: (el: HTMLElement | null) => void; resourceDrop: (el: HTMLElement | null) => void;
    /** What the arrival and the resource cells say during a drag or a pick, as primitives, so pointer motion repaints nothing (A35). */
    arrivalState: Say["state"] | undefined; arrivalWords: string | undefined; arrivalReason: string | undefined; arrivalPick: string | undefined;
    resourceState: Say["state"] | undefined; resourceWords: string | undefined; resourceReason: string | undefined;
}) {
    const { styles, context, plan, held, commands, drag, editable } = props;
    const board = allocationWords();
    const nouns = useNouns();
    const unit = context.unit;
    const parts = bin === undefined ? [] : partsOf(bin);
    const resource = parts[0] === undefined ? undefined : context.resources.get(parts[0].key);
    const line = resource === undefined ? undefined : lines.get(resource.key);
    const load = resource === undefined ? undefined : props.loads.get(resource.key);
    const committed = row.bin === undefined ? undefined : held?.bins.get(row.bin);
    const draft = bin !== undefined && (committed === undefined || !props.sameBin(committed, bin));
    const marked = selects(props.selection, row, plan, props.highlight);
    const arrivalSay: Say | undefined = arrivalState === undefined ? undefined : { state: arrivalState, drop: arrivalWords ?? "", reason: arrivalReason, pick: arrivalPick };
    const resourceSay: Say | undefined = resourceState === undefined ? undefined : { state: resourceState, drop: resourceWords ?? "", reason: resourceReason, pick: undefined };
    const time = formatDatePattern("HH:mm", row.at);
    const lane = words.lane(row.lane);
    const meta = bin?.arrival.type === "some" ? context.arrivals.get(bin.arrival.value)?.meta : undefined;
    // A split or partly allocated bin (A71): its parts' chips, and `+ resource` for what they leave, across the Resource and Load columns.
    const remainder = bin === undefined ? 0 : remainderOf(bin);
    const split = row.kind === "bin" && parts.length > 0 && (parts.length > 1 || compareFloat(remainder, 0) > 0);
    // Its status (A43): what it holds, and whether a resource of it needs a look.
    const check = parts.some(part => { const l = lines.get(part.key); return l !== undefined && (l.over || l.overlap); });
    const status = rowStatus(row.kind, parts.length > 0, check, draft);
    const select = () => props.select(row.bin !== undefined ? { type: "bin", id: row.bin } : { type: "slot", lane: row.lane, at: row.slotAt.getTime() });
    const loadText = resource !== undefined && load !== undefined ? board.load(load.fill, resource, unit) : undefined;
    const into = line?.overlap === true && line.next.type === "some" && load?.hold.type === "some"
        ? (load.hold.value.to.getTime() - line.next.value.start.getTime()) / 86_400_000 : undefined;
    // A chip's chevron, and a placeholder whole, open its cell's Chooser.
    const chevron = (label: string) => (isOpen: boolean) => <chakra.button type="button" css={styles.tableChipButton} aria-label={label} title={label} aria-haspopup="listbox"
        onPointerDown={event => event.stopPropagation()}><FontAwesomeIcon icon={isOpen ? faChevronUp : faChevronDown} /></chakra.button>;
    const placeholder = (side: "arrival" | "resource") => (isOpen: boolean) => <Placeholder props={props} side={side} reserved={row.kind === "reserved"} open={isOpen} button
        say={side === "arrival" ? arrivalSay : resourceSay} />;
    const chooser = (side: "arrival" | "resource", trigger: (isOpen: boolean) => ReactElement, part?: string | null) => editable
        ? <ChoiceCell props={props} row={row} side={side} part={part} open={open === openKey(side, part)} setOpen={setOpen} words={words} trigger={trigger} /> : null;
    const arrivalLabel = row.kind === "bin" ? `Replace ${code} with another ${one(nouns.arrival)}` : `Choose ${a(nouns.arrival)}`;
    const resourceLabel = resource !== undefined ? `Change the ${one(nouns.resource)}` : row.kind === "bin" ? `Choose ${a(nouns.resource)}` : `Reserve ${a(nouns.resource)}`;
    // A resource's marks (A43): ⚠ overlapping, ● over max, ↓ under min.
    const marksOf = (of: ResourceLine | undefined) => <>
        {of?.overlap === true && !of.over && <Box as="span" css={styles.cardMark} data-mark="overlap"><FontAwesomeIcon icon={faTriangleExclamation} aria-label="Overlaps the next job" /></Box>}
        {of?.over === true && <Box as="span" css={styles.cardMark} data-mark="over"><FontAwesomeIcon icon={faCircleExclamation} aria-label="Over max" /></Box>}
        {of?.under === true && !of.over && <Box as="span" css={styles.cardMark} data-mark="under"><FontAwesomeIcon icon={faArrowDown} aria-label="Under minimum" /></Box>}
    </>;
    // A split bin's part (A71): its resource and what it holds there — one button, which opens the Chooser that moves it — and its ×.
    // Two parts and `+ resource` share the Resource and Load columns, 176 + 144px at the Table's least width, so a part has no chevron
    // of its own and no marks: its tooltip is its resource's load line, as the Load cell's is (A84), and the row's Status says Check
    // for any resource of it over max or held into its next job (A43).
    const partChip = (part: { key: string; quantity: number }) => {
        const of = context.resources.get(part.key), at = props.loads.get(part.key);
        const name = of?.label ?? part.key, figure = board.quantity(part.quantity, unit);
        const loadLine = of === undefined || at === undefined ? undefined : board.load(at.fill, of, unit);
        const was = committed?.parts.get(part.key);
        const title = `${name} · ${figure}${loadLine === undefined ? "" : ` · ${loadLine}`}`;
        const inside = <><Box as="span" css={styles.tableChipCode}>{name}</Box><Box as="span" css={styles.tableChipQty}>{figure}</Box></>;
        const face = (isOpen: boolean) => <chakra.button type="button" css={styles.tablePartFace} aria-haspopup="listbox" data-open={isOpen ? "" : undefined}
            aria-label={`Move the ${figure} on ${name} to another ${one(nouns.resource)}`} title={title} onPointerDown={event => event.stopPropagation()}>{inside}</chakra.button>;
        return <Box key={part.key} css={[styles.tableChip, styles.tablePart]} data-allocation-chip="part" data-allocation-part={part.key}
            data-draft={was === undefined || compareFloat(was, part.quantity) !== 0 ? "" : undefined}>
            {chooser("resource", face, part.key) ?? <Box as="span" css={styles.tablePartFace} title={title}>{inside}</Box>}
            {editable && <chakra.button type="button" css={styles.tableChipButton} data-allocation-chip-remove="" aria-label={`Unlink ${code} from ${name}`} title={`Unlink ${code} from ${name}`}
                onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); if (row.bin !== undefined) commands.unlink(row.bin, part.key); }}>
                <FontAwesomeIcon icon={faXmark} />
            </chakra.button>}
        </Box>;
    };
    // `+ resource` for what the parts leave (A71): its Chooser links the remainder.
    const remainderWords = `Choose ${a(nouns.resource)} for the ${board.quantity(remainder, unit)} unallocated`;
    const remainderInside = <>
        <Box as="span" css={styles.tableChipIcon} data-icon-role="idle"><FontAwesomeIcon icon={faPlus} /></Box>
        <Box as="span" css={styles.tablePlaceholderText} data-say="idle">{one(nouns.resource)}</Box>
    </>;
    const remainderTrigger = (isOpen: boolean) => <chakra.button type="button" css={styles.tablePlaceholder} data-allocation-placeholder="remainder" data-open={isOpen ? "" : undefined}
        title={remainderWords} aria-label={remainderWords} aria-haspopup="listbox" onPointerDown={event => event.stopPropagation()}>{remainderInside}</chakra.button>;
    return <Box css={styles.tableRow} role="row" data-allocation-row={row.key} data-kind={row.kind} data-columns={shown === 0 ? "none" : undefined}
        data-selected={marked !== undefined ? "" : undefined} data-draft={draft ? "" : undefined} onClick={select}>
        <Box as="span" css={styles.tableTime} data-holds={bin !== undefined ? "" : undefined}>{time}</Box>
        <Box as="span" css={styles.tableLane}>{lane}</Box>
        {row.kind === "bin" && bin !== undefined ? <>
            <Box css={styles.tableCell} data-allocation-cell-side="arrival">
                <Box {...chip} css={styles.tableChip} data-scope="allocation" data-allocation-chip="arrival" data-draft={draft ? "" : undefined} data-draggable={chip !== undefined ? "" : undefined}
                    title={`${code}${meta?.type === "some" ? ` · ${meta.value}` : ""} · ${board.quantity(bin.quantity, unit)} · drag onto an empty row to move it`}
                    onPointerDown={event => { if (row.bin !== undefined) drag.arm({ kind: "body", bin: row.bin }); chip?.onPointerDown?.(event); }}>
                    {chip !== undefined && <Box as="span" css={styles.tableChipIcon} data-icon-role="grip"><FontAwesomeIcon icon={faGripVertical} /></Box>}
                    <Box as="span" css={styles.tableChipCode}>{code}</Box>
                    {meta?.type === "some" && <Box as="span" css={styles.tableChipMeta}>{meta.value}</Box>}
                    {chooser("arrival", chevron(arrivalLabel))}
                    {editable && <chakra.button type="button" css={styles.tableChipButton} data-allocation-chip-remove=""
                        aria-label={committed !== undefined ? `Remove ${code} from the plan · it moves to ${nouns.arrival.other}` : `Return ${code} to ${nouns.arrival.other}`}
                        title={committed !== undefined ? `Remove ${code} from the plan · it moves to ${nouns.arrival.other}` : `Return ${code} to ${nouns.arrival.other}`}
                        onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); if (row.bin !== undefined) commands.remove(row.bin); }}>
                        <FontAwesomeIcon icon={faXmark} />
                    </chakra.button>}
                </Box>
            </Box>
            <Box as="span" css={styles.tableUnits}>{board.quantity(bin.quantity, unit)}</Box>
            {Array.from({ length: shown }, (_, i) => { const cell = columns?.[i]; return <Box as="span" key={i} css={styles.tableValue} data-tone={cell?.warn === true ? "warning" : undefined}>{cell?.text}</Box>; })}
        </> : <Box ref={arrivalDrop} css={[styles.tableCell, styles.tableSpan]} data-allocation-cell-side="arrival">
            {/* With an arrival picked, a cell that takes it books it there on a click (A11); its Chooser waits. */}
            {arrivalSay?.state === "pick" && editable
                ? <Placeholder props={props} side="arrival" reserved={row.kind === "reserved"} open={false} button say={arrivalSay} onBook={() => props.book(arrivalTarget(row))} />
                : chooser("arrival", placeholder("arrival")) ?? <Placeholder props={props} side="arrival" reserved={row.kind === "reserved"} open={false} button={false} say={arrivalSay} />}
        </Box>}
        {split && row.bin !== undefined ? <Box ref={resourceDrop} css={[styles.tableCell, styles.tableResourceSpan, styles.tableParts]} data-allocation-cell-side="resource"
            data-allocation-parts="">
            {parts.map(partChip)}
            {compareFloat(remainder, 0) > 0 && (chooser("resource", remainderTrigger, null)
                ?? <Box css={styles.tablePlaceholder} data-allocation-placeholder="remainder" title={`${board.quantity(remainder, unit)} unallocated`}>{remainderInside}</Box>)}
        </Box> : resource !== undefined && row.bin !== undefined ? <>
            <Box ref={resourceDrop} css={styles.tableCell} data-allocation-cell-side="resource">
                <Box css={styles.tableChip} data-allocation-chip="resource" data-draft={draft ? "" : undefined} data-verdict={resourceSay?.state}
                    title={resourceSay?.state === "refused" && resourceSay.reason !== undefined ? resourceSay.reason : `${resource.label}${resource.meta.type === "some" ? ` · ${resource.meta.value}` : ""}`}>
                    <Box as="span" css={styles.tableChipIcon}><FontAwesomeIcon icon={faLink} /></Box>
                    <Box as="span" css={styles.tableChipCode}>{resource.label}</Box>
                    {chooser("resource", chevron(resourceLabel))}
                    {editable && <chakra.button type="button" css={styles.tableChipButton} data-allocation-chip-remove=""
                        aria-label={row.kind === "reserved" ? "Remove the reservation" : `Unlink ${code} from ${resource.label}`}
                        title={row.kind === "reserved" ? "Remove the reservation" : `Unlink ${code} from ${resource.label}`}
                        onPointerDown={event => event.stopPropagation()}
                        onClick={event => { event.stopPropagation(); if (row.kind === "reserved") commands.remove(row.bin!); else commands.unlink(row.bin!, resource.key); }}>
                        <FontAwesomeIcon icon={faXmark} />
                    </chakra.button>}
                </Box>
            </Box>
            <Box as="span" css={styles.tableLoad} data-tone={line?.over === true ? "danger" : line?.overlap === true || line?.under === true ? "warning" : undefined}
                title={`${resource.label} · ${loadText}${into === undefined ? "" : ` · ${board.quantity(into, "")} d into the next job`}`}>
                <span>{loadText}</span>
                {marksOf(line)}
            </Box>
        </> : <Box ref={resourceDrop} css={[styles.tableCell, styles.tableResourceSpan]} data-allocation-cell-side="resource">
            {chooser("resource", placeholder("resource")) ?? <Placeholder props={props} side="resource" reserved={false} open={false} button={false} say={resourceSay} />}
        </Box>}
        <Box as="span" css={styles.tableStatus} data-status={status}><Box as="span" css={styles.tableStatusDot} />{status}</Box>
    </Box>;
});

/**
 * A dashed placeholder (A45): `no arrival` (`no arrival · reserved`) or `no
 * resource`, in the board's nouns; editable, it is its cell's Chooser's
 * button, the chevron at its end. During a drag it says what a drop does.
 */
function Placeholder({ props, side, reserved, open, button, say, onBook, ...trigger }: {
    props: TableProps; side: "arrival" | "resource"; reserved: boolean; open: boolean; button: boolean;
    /** What it says during a drag or a pick (A45). */
    say?: Say | undefined;
    /** With an arrival picked, its click books it here (A11). */
    onBook?: (() => void) | undefined;
}) {
    const { styles } = props;
    const nouns = useNouns();
    const idle = side === "arrival" ? `no ${one(nouns.arrival)}${reserved ? " · reserved" : ""}` : `no ${one(nouns.resource)}`;
    const choose = side === "arrival" ? `Choose ${a(nouns.arrival)}, or drag one here from ${nouns.arrival.other}` : `Choose ${a(nouns.resource)}, or drag one here from ${nouns.resource.other}`;
    // Refused, its reason is its tooltip (A45).
    const title = say?.state === "refused" && say.reason !== undefined ? say.reason : say?.state === "pick" && say.pick !== undefined ? say.pick : choose;
    const inside = <>
        <Box as="span" css={styles.tableChipIcon} data-icon-role="idle"><FontAwesomeIcon icon={side === "arrival" ? faInbox : faLinkSlash} /></Box>
        <Box as="span" css={styles.tableChipIcon} data-icon-role="refused"><FontAwesomeIcon icon={faXmark} /></Box>
        <Box as="span" css={styles.tablePlaceholderText} data-say="idle">{idle}</Box>
        <Box as="span" css={styles.tablePlaceholderText} data-say="drop">{say?.drop ?? "drop to move here"}</Box>
        <Box as="span" css={styles.tablePlaceholderText} data-say="refused">doesn’t fit</Box>
        {say?.reason !== undefined && <Box as="span" css={styles.tablePlaceholderText} data-say="reason">{say.reason}</Box>}
        {say?.pick !== undefined && <Box as="span" css={styles.tablePlaceholderText} data-say="pick">{say.pick}</Box>}
        {button && onBook === undefined && <Box as="span" css={styles.tableChipIcon} data-icon-role="chevron"><FontAwesomeIcon icon={open ? faChevronUp : faChevronDown} /></Box>}
    </>;
    if (onBook !== undefined) {
        return <chakra.button type="button" css={styles.tablePlaceholder} data-allocation-placeholder={side} data-verdict={say?.state} title={title} aria-label={title}
            onClick={event => { event.stopPropagation(); onBook(); }}>{inside}</chakra.button>;
    }
    return button
        ? <chakra.button type="button" {...trigger} css={styles.tablePlaceholder} data-allocation-placeholder={side} data-verdict={say?.state} data-open={open ? "" : undefined} title={title} aria-label={title} aria-haspopup="listbox">{inside}</chakra.button>
        : <Box css={styles.tablePlaceholder} data-allocation-placeholder={side} data-verdict={say?.state} title={title}>{inside}</Box>;
}

/**
 * A Chooser in the shared anchored popover (A48): its trigger, the sections
 * its question was answered with, and what a choice does; its search takes the
 * focus as it opens.
 *
 * @param args - Its identity (`data-allocation-choices`), its label, its trigger, whether it is open, its sections, its search's words and what a choice does
 * @returns The popover
 */
export function ChooserPopover({ id, label, trigger, open, onOpenChange, sections, placeholder, onChoose }: {
    id: string; label: string; trigger: ReactElement; open: boolean; onOpenChange: (open: boolean) => void;
    sections: ChooserSection[]; placeholder: string; onChoose: (key: string) => void;
}) {
    return <SliceEditPopover trigger={trigger} open={open} onOpenChange={onOpenChange} flush label={label}
        initialFocusEl={() => document.querySelector<HTMLElement>(`[data-allocation-choices="${id}"] input`)}>
        <Box data-allocation-choices={id}>
            {open && <Chooser sections={sections} placeholder={placeholder} onChoose={onChoose} />}
        </Box>
    </SliceEditPopover>;
}

/** What a cell's Chooser reads of the board: the day, every arrival and resource, the fit, the commands, the days it asks of, and what the narrowing shows. */
export type ChoiceScene = Pick<TableProps, "plan" | "context" | "day" | "fit" | "commands" | "without" | "reserving" | "visibleArrivals" | "visibleResources">;

/**
 * A cell's chevron and its Chooser (A48, A49): the question the cell asks the
 * fit, its answer's sections, and what a choice does. A split bin's part
 * chip moves that part, and `+ resource` links the remainder, each asked
 * for the quantity it places (A71, A73). A narrow card's `Book…`, `Reserve…`,
 * `Allocate…` and `Move` are these Choosers on its own trigger (A78).
 *
 * @param args - The board, the row, its side and part, whether it is open, the words and its trigger
 * @returns The Chooser's popover on its trigger
 */
export function ChoiceCell({ props, row, side, part, open, setOpen, words, trigger }: {
    props: ChoiceScene; row: TableRow; side: "arrival" | "resource";
    /** A resource Chooser's part: the row's (`undefined`, its bin's first), a part's resource, or the remainder (`null`). */
    part?: string | null | undefined;
    open: boolean; setOpen: (open: Open | undefined) => void; words: ChoiceWords;
    trigger: (open: boolean) => ReactElement;
}) {
    const { plan, context, day, fit, commands } = props;
    const nouns = useNouns();
    const bin = row.bin === undefined ? undefined : plan.bins.get(row.bin);
    const current = bin === undefined ? undefined : partsOf(bin)[0]?.key;
    // The part a resource Chooser moves: the row's first, a chip's own, or none for the remainder, which it links.
    const from = part === undefined ? current : part ?? undefined;
    // The question (F1): an arrival cell takes its row's resource, of the day without its bin; a resource cell places what it moves of
    // its bin — the part, or the remainder (A73) — or a reservation in its free slot.
    const question = useMemo((): { ask: FitAsk; of: Day | undefined } | undefined => {
        if (side === "arrival") {
            if (current === undefined || row.bin === undefined) return undefined;
            return { ask: variant("take", { resource: current }), of: props.without(row.bin) };
        }
        if (row.bin === undefined) return { ask: variant("place", { subject: variant("bin", RESERVE_PROBE), quantity: 0 }), of: props.reserving(row.lane, row.slotAt) };
        const quantity = bin === undefined ? 0 : bin.arrival.type === "none" ? 0 : linkedQuantity(bin, from)?.quantity ?? bin.quantity;
        return { ask: variant("place", { subject: variant("bin", row.bin), quantity }), of: undefined };
        // The question stands for the row's cell and the drafts.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [side, row.bin, row.lane, row.slotAt, current, from, plan]);
    const { ask } = fit;
    useEffect(() => { if (open && question !== undefined) ask(question.ask, question.of); }, [open, question, ask]);
    const answer = question === undefined ? undefined : fit.answer(question.ask, question.of);
    // `+ resource` offers the resources its bin is not on: each it is on is a part of its own (A71).
    const except = part === null && bin !== undefined ? new Set(bin.parts.keys()) : undefined;
    const sections: ChooserSection[] = !open ? [] : side === "arrival"
        ? arrivalChoices({ plan, context, day, words, bin: row.bin, resource: current, answer, shown: props.visibleArrivals })
        : resourceChoices({ context, words, binRow: row.kind === "bin", current: from, answer, shown: props.visibleResources, except });
    const close = () => setOpen(undefined);
    const choose = (key: string) => {
        close();
        if (side === "arrival") {
            if (bin?.arrival.type === "some" && key === bin.arrival.value) return;
            if (row.kind === "bin" && row.bin !== undefined) commands.replace(row.bin, key);
            else if (row.kind === "reserved" && row.bin !== undefined) commands.fillWith(row.bin, key);
            else commands.book(key, row.lane, row.slotAt, undefined);
            return;
        }
        if (key === from) return;
        if (row.bin !== undefined) commands.link(row.bin, key, from);
        else commands.reserve(row.lane, row.slotAt, key);
    };
    return <ChooserPopover id={`${row.key}|${openKey(side, part)}`} trigger={trigger(open)} open={open} onOpenChange={next => setOpen(next ? { row: row.key, side, part } : undefined)}
        label={`${side === "arrival" ? nouns.arrival.one : nouns.resource.one} · ${words.lane(row.lane)} ${formatDatePattern("HH:mm", row.at)}`}
        sections={sections} placeholder={`Find ${a(side === "arrival" ? nouns.arrival : nouns.resource)}`} onChoose={choose} />;
}
