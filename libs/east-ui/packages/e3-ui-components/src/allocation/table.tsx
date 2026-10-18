/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Table (`Allocation Spec.md` §8, A41–A49, A84, #1329): one row per lane
 * slot of the day and one per extra bin of a batch, in four foldable time
 * bands, narrowed by the lanes and the resources the slice shows (#1336) and
 * never reordered by an allocation. Each row's event
 * and resource are a chip or a dashed placeholder; a chip's × removes or
 * unlinks, and a cell's chevron opens the shared Chooser, every section of it
 * the app's fit's answer. A bin's chip drags onto a free row's event cell
 * (A47). Every figure and word is e3-ui's; every size the `allocationBuilder`
 * recipe's.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { Box, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowDown, faChevronDown, faChevronUp, faCircleExclamation, faGripVertical, faInbox, faLink, faLinkSlash, faTriangleExclamation, faXmark } from "@fortawesome/free-solid-svg-icons";
import { variant, type SortedMap, type option } from "@elaraai/east";
import { SliceEditPopover, useDragEventChip, useDropCell, useTrackedEvaluation, type DragEventValue, type DragPayload, type Formatters } from "@elaraai/east-ui-components";
import { Chooser, VirtualRows, formatDatePattern, type ChooserSection } from "@elaraai/east-ui-components/internal";
import { GroupHeading, useGroupCollapse } from "../shared/schedule/group-heading.js";
import { MoveGhost } from "../shared/schedule/move-ghost.js";
import { linkedQuantity, type AllocationCommands } from "./actions.js";
import { eventChoices, resourceChoices, type ChoiceWords } from "./choices.js";
import { gripCoord, gripOf, gripOfPayload, laneCoord, resourceCellCoord, type AllocationDrag, type Grip, type Target } from "./drag.js";
import type { AllocationFit } from "./fit.js";
import { bandLine, narrowBands, tableBands, tableRows, type TableBand, type TableRow } from "./table-rows.js";
import { NarrowedEmpty } from "./narrowed.js";
import type { TimelineFollow } from "./timeline.js";
import {
    allocationWords, partsOf, type AllocationDomain, type AllocationStyles, type AllocationValue, type Bin, type Context, type Day, type FitAsk, type Load,
    type ResourceLine, type Selection, type Slot,
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
    /** The lanes and the resources the narrowing shows, by key; `none` for every one (#1336). */
    visibleLanes: option<Set<string>>;
    visibleResources: option<Set<string>>;
    /** Clears the narrowing, where nothing shows; `undefined` with no narrowing. */
    clearFilters: (() => void) | undefined;
}

/** A row's cell a Chooser is open on. */
interface Open { row: string; side: "event" | "resource" }

/** One flattened line of the virtualised Table: a band's head, or a row. */
type Line = { kind: "band"; band: TableBand } | { kind: "row"; band: TableBand; row: TableRow };

/** A drop cell's veto and caption: the board's one verdict, as the Timeline's are (§10). */
function dropOptions(drag: AllocationDrag, target: Target) {
    const gripOfEvent = (candidate: DragEventValue): Grip | undefined => candidate.type === "move" ? gripOf(candidate.value.from) : undefined;
    return {
        veto: (candidate: DragEventValue) => { const grip = gripOfEvent(candidate); return grip !== undefined && drag.verdict(grip, target).allowed; },
        options: {
            accepts: (payload: DragPayload) => gripOfPayload(payload) !== undefined,
            caption: (_coord: unknown, payload: DragPayload) => {
                const grip = gripOfPayload(payload);
                if (grip === undefined) return undefined;
                const verdict = drag.verdict(grip, target);
                return { text: verdict.caption, warn: verdict.warn };
            },
        },
    };
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
    const unit = context.unit;
    // A row a hidden lane holds, or whose every resource is hidden, goes; a band the narrowing empties goes with it.
    const { visibleLanes, visibleResources } = props;
    const bands = useMemo(() => narrowBands(tableBands(tableRows(slots, plan), plan, day), plan, visibleLanes, visibleResources),
        [slots, plan, day, visibleLanes, visibleResources]);
    const rows = useMemo(() => bands.flatMap(band => band.rows), [bands]);
    const { collapsed, toggle } = useGroupCollapse(`${drag.surface}.table`);
    const lines = useMemo((): Line[] => bands.flatMap(band => [{ kind: "band" as const, band },
        ...(collapsed.includes(band.key) ? [] : band.rows.map(row => ({ kind: "row" as const, band, row })))]), [bands, collapsed]);
    const sizes = useMemo(() => lines.map(l => l.kind === "band" ? BAND_H : ROW_H), [lines]);
    const getItemKey = useCallback((index: number) => { const l = lines[index]!; return l.kind === "band" ? `band:${l.band.key}` : l.row.key; }, [lines]);
    // The app's columns shown in the Table, each bin's text and tone, through its callbacks (§6).
    const shown = useMemo(() => value.columns.filter(c => c.table), [value.columns]);
    const readColumns = useCallback(() => {
        const out = new Map<string, { text: string; warn: boolean }[]>();
        for (const [id, bin] of plan.bins) {
            if (bin.event.type !== "some") continue;
            const bytes = domain.encodeValues(bin.values);
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
    const vars = { "--allocation-columns": shown.length, "--allocation-event-span": 2 + shown.length } as CSSProperties;

    // Selecting follows the selection (A12): its row scrolls into view a third from the top.
    const pane = useRef<HTMLDivElement | null>(null);
    const selectionRef = useRef(props.selection);
    selectionRef.current = props.selection;
    useLayoutEffect(() => {
        const el = pane.current, selection = selectionRef.current;
        if (props.follow.nonce === 0 || el === null || selection === undefined) return;
        const index = lines.findIndex(l => l.kind === "row" && selects(selection, l.row, plan) === "row");
        if (index < 0) return;
        const y = sizes.slice(0, index).reduce((a, b) => a + b, 0), view = el.clientHeight - ROW_H;
        if (y < el.scrollTop || y + ROW_H > el.scrollTop + view) el.scrollTop = Math.max(0, Math.round((y - view / 3) / ROW_H) * ROW_H);
        // The follow request is the trigger.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.follow.nonce]);

    const choiceWords: ChoiceWords = useMemo(() => ({
        quantity: v => words.quantity(v, unit), number: v => words.quantity(v, ""), lane: key => value.lanes.find(l => l.key === key)?.label ?? key,
    }), [words, unit, value.lanes]);
    const head = <Box css={styles.tableHead} data-columns={shown.length === 0 ? "none" : undefined} data-allocation-table-head="">
        <span>Time</span><span>Lane</span><span>Event</span><Box as="span" data-align="end">Quantity</Box>
        {shown.map(c => <span key={c.key}>{c.label}</span>)}<span>Resource</span><span>Load</span><span>Status</span>
    </Box>;
    return <Box css={styles.table} style={vars} data-allocation-table="" data-allocation-drag={drag.grip?.kind}>
        {lines.length === 0 ? <>{head}<NarrowedEmpty styles={styles} clear={props.clearFilters} /></> : <VirtualRows fillParent height={undefined} maxHeight={undefined} rootCss={styles.tablePane} minWidth="900px" scrollElRef={pane}
            headerZIndex={4} header={head} count={lines.length} getItemKey={getItemKey} sizes={sizes} measureRows={false}
            renderRow={index => {
                const line = lines[index]!;
                if (line.kind === "band") {
                    const folded = collapsed.includes(line.band.key);
                    return <GroupHeading scope="allocation" group={{ key: line.band.key, label: line.band.label }} styles={styles} collapsed={folded} toggle={toggle}>
                        <Box as="span" css={styles.bandCount} data-allocation-band-count="">{line.band.rows.length}</Box>
                        <Box as="span" css={styles.groupMeta}>{bandLine(line.band, words.quantity(Math.round(line.band.quantity), unit), folded)}</Box>
                    </GroupHeading>;
                }
                return <Row props={props} row={line.row} columns={cells?.get(line.row.bin ?? "")} shown={shown.length} lines={resourceLines}
                    open={open?.row === line.row.key ? open.side : undefined} setOpen={setOpen} words={choiceWords} />;
            }} />}
    </Box>;
}

/** How a selection marks a row (A44): as its own, or as one of the selected resource's. */
function selects(selection: Selection | undefined, row: TableRow, plan: Day): "row" | "resource" | undefined {
    if (selection === undefined) return undefined;
    if (selection.type === "bin") return row.bin === selection.id ? "row" : undefined;
    if (selection.type === "slot") return row.kind === "free" && row.lane === selection.lane && row.slotAt.getTime() === selection.at ? "row" : undefined;
    const bin = row.bin === undefined ? undefined : plan.bins.get(row.bin);
    return bin?.parts.has(selection.key) === true ? "resource" : undefined;
}

interface RowProps {
    props: TableProps; row: TableRow; columns: readonly { text: string; warn: boolean }[] | undefined; shown: number;
    lines: ReadonlyMap<string, ResourceLine>; open: "event" | "resource" | undefined; setOpen: (open: Open | undefined) => void; words: ChoiceWords;
}

/**
 * A row (A43): the drag hooks here — its event chip's handle, its event and
 * resource cells' targets — outside its body, so pointer motion repaints
 * nothing in it (A35).
 */
function Row(args: RowProps) {
    const { props, row } = args;
    const { drag, plan, context, styles } = props;
    const bin = row.bin === undefined ? undefined : plan.bins.get(row.bin);
    const words = allocationWords();
    const code = bin?.event.type === "some" ? context.events.get(bin.event.value)?.label ?? bin.event.value : undefined;
    const label = useMemo(() => code === undefined || bin === undefined ? "" : `${code} · ${words.quantity(bin.quantity, context.unit)}`, [code, bin, words, context.unit]);
    const ghost = useMemo(() => <MoveGhost styles={styles} label={label} />, [styles, label]);
    const chipAt = useMemo(() => drag.enabled && row.kind === "bin" && row.bin !== undefined ? gripCoord(drag.surface, { kind: "body", bin: row.bin }) : null, [drag.enabled, drag.surface, row.kind, row.bin]);
    const chip = useDragEventChip(chipAt, ghost, false, label);
    // A free row's event cell takes a bin to its slot; a reserved row's, a bin into the reservation (A37, A38).
    const takes = row.kind !== "bin";
    const event = dropOptions(drag, { kind: "lane", lane: row.lane, at: row.slotAt, card: row.kind === "reserved" ? row.bin : undefined, table: true });
    const eventDrop = useDropCell(drag.enabled && takes ? laneCoord(drag.surface, row.lane, row.slotAt, row.kind === "reserved" ? row.bin : undefined, true) : null, false, event.veto, undefined, event.options);
    const resource = dropOptions(drag, { kind: "cell", row: row.key });
    const resourceDrop = useDropCell(drag.enabled ? resourceCellCoord(drag.surface, row.key) : null, false, resource.veto, undefined, resource.options);
    return <RowBody {...args} bin={bin} code={code} chip={chip} eventDrop={eventDrop} resourceDrop={resourceDrop} />;
}

/** A row's body: its cells, from the drafts, the loads and the app's columns. */
const RowBody = memo(function RowBody({ props, row, columns, shown, lines, open, setOpen, words, bin, code, chip, eventDrop, resourceDrop }: RowProps & {
    bin: Bin | undefined; code: string | undefined; chip: ReturnType<typeof useDragEventChip>;
    eventDrop: (el: HTMLElement | null) => void; resourceDrop: (el: HTMLElement | null) => void;
}) {
    const { styles, context, plan, held, commands, drag, editable } = props;
    const board = allocationWords();
    const unit = context.unit;
    const parts = bin === undefined ? [] : partsOf(bin);
    const resource = parts[0] === undefined ? undefined : context.resources.get(parts[0].key);
    const line = resource === undefined ? undefined : lines.get(resource.key);
    const load = resource === undefined ? undefined : props.loads.get(resource.key);
    const committed = row.bin === undefined ? undefined : held?.bins.get(row.bin);
    const draft = bin !== undefined && (committed === undefined || !props.sameBin(committed, bin));
    const marked = selects(props.selection, row, plan);
    const time = formatDatePattern("HH:mm", row.at);
    const lane = words.lane(row.lane);
    const meta = bin?.event.type === "some" ? context.events.get(bin.event.value)?.meta : undefined;
    // Its status (A43): what it holds, and whether its resource needs a look.
    const status = row.kind === "free" ? "Free" : row.kind === "bin" && parts.length === 0 ? "Not linked"
        : line !== undefined && (line.over || line.overlap) ? "Check" : draft ? "Draft" : row.kind === "reserved" ? "Reserved" : "Committed";
    const select = () => props.select(row.bin !== undefined ? { type: "bin", id: row.bin } : { type: "slot", lane: row.lane, at: row.slotAt.getTime() });
    const loadText = resource !== undefined && load !== undefined ? board.load(load.fill, resource, unit) : undefined;
    const into = line?.overlap === true && line.next.type === "some" && load?.hold.type === "some"
        ? (load.hold.value.to.getTime() - line.next.value.start.getTime()) / 86_400_000 : undefined;
    // A chip's chevron, and a placeholder whole, open its cell's Chooser.
    const chevron = (label: string) => (isOpen: boolean) => <chakra.button type="button" css={styles.tableChipButton} aria-label={label} title={label} aria-haspopup="listbox"
        onPointerDown={event => event.stopPropagation()}><FontAwesomeIcon icon={isOpen ? faChevronUp : faChevronDown} /></chakra.button>;
    const placeholder = (side: "event" | "resource") => (isOpen: boolean) => <Placeholder props={props} side={side} reserved={row.kind === "reserved"} open={isOpen} button />;
    const chooser = (side: "event" | "resource", trigger: (isOpen: boolean) => ReactElement) => editable
        ? <ChoiceCell props={props} row={row} side={side} open={open === side} setOpen={setOpen} words={words} trigger={trigger} /> : null;
    const eventLabel = row.kind === "bin" ? `Replace ${code} with another event` : "Choose an event";
    const resourceLabel = resource !== undefined ? "Change the resource" : row.kind === "bin" ? "Choose a resource" : "Reserve a resource";
    return <Box css={styles.tableRow} role="row" data-allocation-row={row.key} data-kind={row.kind} data-columns={shown === 0 ? "none" : undefined}
        data-selected={marked !== undefined ? "" : undefined} data-draft={draft ? "" : undefined} onClick={select}>
        <Box as="span" css={styles.tableTime} data-holds={bin !== undefined ? "" : undefined}>{time}</Box>
        <Box as="span" css={styles.tableLane}>{lane}</Box>
        {row.kind === "bin" && bin !== undefined ? <>
            <Box css={styles.tableCell} data-allocation-cell-side="event">
                <Box {...chip} css={styles.tableChip} data-scope="allocation" data-allocation-chip="event" data-draft={draft ? "" : undefined} data-draggable={chip !== undefined ? "" : undefined}
                    title={`${code}${meta?.type === "some" ? ` · ${meta.value}` : ""} · ${board.quantity(bin.quantity, unit)} · drag onto an empty row to move it`}
                    onPointerDown={event => { if (row.bin !== undefined) drag.arm({ kind: "body", bin: row.bin }); chip?.onPointerDown?.(event); }}>
                    {chip !== undefined && <Box as="span" css={styles.tableChipIcon} data-icon-role="grip"><FontAwesomeIcon icon={faGripVertical} /></Box>}
                    <Box as="span" css={styles.tableChipCode}>{code}</Box>
                    {meta?.type === "some" && <Box as="span" css={styles.tableChipMeta}>{meta.value}</Box>}
                    {chooser("event", chevron(eventLabel))}
                    {editable && <chakra.button type="button" css={styles.tableChipButton} data-allocation-chip-remove=""
                        aria-label={committed !== undefined ? `Remove ${code} from the plan · it moves to Events` : `Return ${code} to Events`}
                        title={committed !== undefined ? `Remove ${code} from the plan · it moves to Events` : `Return ${code} to Events`}
                        onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); if (row.bin !== undefined) commands.remove(row.bin); }}>
                        <FontAwesomeIcon icon={faXmark} />
                    </chakra.button>}
                </Box>
            </Box>
            <Box as="span" css={styles.tableUnits}>{board.quantity(bin.quantity, unit)}</Box>
            {Array.from({ length: shown }, (_, i) => { const cell = columns?.[i]; return <Box as="span" key={i} css={styles.tableValue} data-tone={cell?.warn === true ? "warning" : undefined}>{cell?.text}</Box>; })}
        </> : <Box ref={eventDrop} css={[styles.tableCell, styles.tableSpan]} data-allocation-cell-side="event">
            {chooser("event", placeholder("event")) ?? <Placeholder props={props} side="event" reserved={row.kind === "reserved"} open={false} button={false} />}
        </Box>}
        {resource !== undefined && row.bin !== undefined ? <>
            <Box ref={resourceDrop} css={styles.tableCell} data-allocation-cell-side="resource">
                <Box css={styles.tableChip} data-allocation-chip="resource" data-draft={draft ? "" : undefined} title={`${resource.label}${resource.meta.type === "some" ? ` · ${resource.meta.value}` : ""}`}>
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
                {line?.overlap === true && !line.over && <Box as="span" css={styles.cardMark} data-mark="overlap"><FontAwesomeIcon icon={faTriangleExclamation} aria-label="Overlaps the next job" /></Box>}
                {line?.over === true && <Box as="span" css={styles.cardMark} data-mark="over"><FontAwesomeIcon icon={faCircleExclamation} aria-label="Over max" /></Box>}
                {line?.under === true && !line.over && <Box as="span" css={styles.cardMark} data-mark="under"><FontAwesomeIcon icon={faArrowDown} aria-label="Under minimum" /></Box>}
            </Box>
        </> : <Box ref={resourceDrop} css={[styles.tableCell, styles.tableResourceSpan]} data-allocation-cell-side="resource">
            {chooser("resource", placeholder("resource")) ?? <Placeholder props={props} side="resource" reserved={false} open={false} button={false} />}
        </Box>}
        <Box as="span" css={styles.tableStatus} data-status={status}><Box as="span" css={styles.tableStatusDot} />{status}</Box>
    </Box>;
});

/**
 * A dashed placeholder (A45): `no event` (`no event · reserved`) or `no
 * resource`; editable, it is its cell's Chooser's button, the chevron at its
 * end. During a drag it says what a drop does.
 */
function Placeholder({ props, side, reserved, open, button, ...trigger }: { props: TableProps; side: "event" | "resource"; reserved: boolean; open: boolean; button: boolean }) {
    const { styles } = props;
    const idle = side === "event" ? reserved ? "no event · reserved" : "no event" : "no resource";
    const title = side === "event" ? "Choose an event, or drag one here from Events" : "Choose a resource, or drag one here from Resources";
    const inside = <>
        <Box as="span" css={styles.tableChipIcon} data-icon-role="idle"><FontAwesomeIcon icon={side === "event" ? faInbox : faLinkSlash} /></Box>
        <Box as="span" css={styles.tableChipIcon} data-icon-role="refused"><FontAwesomeIcon icon={faXmark} /></Box>
        <Box as="span" css={styles.tablePlaceholderText} data-say="idle">{idle}</Box>
        <Box as="span" css={styles.tablePlaceholderText} data-say="drop">drop to move here</Box>
        <Box as="span" css={styles.tablePlaceholderText} data-say="refused">doesn’t fit</Box>
        {button && <Box as="span" css={styles.tableChipIcon} data-icon-role="chevron"><FontAwesomeIcon icon={open ? faChevronUp : faChevronDown} /></Box>}
    </>;
    return button
        ? <chakra.button type="button" {...trigger} css={styles.tablePlaceholder} data-allocation-placeholder={side} data-open={open ? "" : undefined} title={title} aria-label={title} aria-haspopup="listbox">{inside}</chakra.button>
        : <Box css={styles.tablePlaceholder} data-allocation-placeholder={side} title={title}>{inside}</Box>;
}

/**
 * A cell's chevron and its Chooser (A48, A49): the question the cell asks the
 * fit, its answer's sections, and what a choice does.
 */
function ChoiceCell({ props, row, side, open, setOpen, words, trigger }: {
    props: TableProps; row: TableRow; side: "event" | "resource"; open: boolean; setOpen: (open: Open | undefined) => void; words: ChoiceWords;
    trigger: (open: boolean) => ReactElement;
}) {
    const { plan, context, day, fit, commands } = props;
    const bin = row.bin === undefined ? undefined : plan.bins.get(row.bin);
    const current = bin === undefined ? undefined : partsOf(bin)[0]?.key;
    // The question (F1): an event cell takes its row's resource, of the day without its bin; a resource cell places its bin,
    // or a reservation in its free slot.
    const question = useMemo((): { ask: FitAsk; of: Day | undefined } | undefined => {
        if (side === "event") {
            if (current === undefined || row.bin === undefined) return undefined;
            return { ask: variant("take", { resource: current }), of: props.without(row.bin) };
        }
        if (row.bin === undefined) return { ask: variant("place", { subject: variant("bin", RESERVE_PROBE), quantity: 0 }), of: props.reserving(row.lane, row.slotAt) };
        const quantity = bin === undefined ? 0 : bin.event.type === "none" ? 0 : linkedQuantity(bin, current)?.quantity ?? bin.quantity;
        return { ask: variant("place", { subject: variant("bin", row.bin), quantity }), of: undefined };
        // The question stands for the row's cell and the drafts.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [side, row.bin, row.lane, row.slotAt, current, plan]);
    const { ask } = fit;
    useEffect(() => { if (open && question !== undefined) ask(question.ask, question.of); }, [open, question, ask]);
    const answer = question === undefined ? undefined : fit.answer(question.ask, question.of);
    const sections: ChooserSection[] = !open ? [] : side === "event"
        ? eventChoices({ plan, context, day, words, bin: row.bin, resource: current, answer })
        : resourceChoices({ context, words, binRow: row.kind === "bin", current, answer, shown: props.visibleResources });
    const close = () => setOpen(undefined);
    const choose = (key: string) => {
        close();
        if (side === "event") {
            if (bin?.event.type === "some" && key === bin.event.value) return;
            if (row.kind === "bin" && row.bin !== undefined) commands.replace(row.bin, key);
            else if (row.kind === "reserved" && row.bin !== undefined) commands.fillWith(row.bin, key);
            else commands.book(key, row.lane, row.slotAt, undefined);
            return;
        }
        if (key === current) return;
        if (row.bin !== undefined) commands.link(row.bin, key, current);
        else commands.reserve(row.lane, row.slotAt, key);
    };
    return <SliceEditPopover trigger={trigger(open)} open={open} onOpenChange={next => setOpen(next ? { row: row.key, side } : undefined)} flush
        label={`${side === "event" ? "Event" : "Resource"} · ${words.lane(row.lane)} ${formatDatePattern("HH:mm", row.at)}`}
        initialFocusEl={() => document.querySelector<HTMLElement>(`[data-allocation-choices="${row.key}|${side}"] input`)}>
        <Box data-allocation-choices={`${row.key}|${side}`}>
            {open && <Chooser sections={sections} placeholder={side === "event" ? "Find an event" : "Find a resource"} onChoose={choose} />}
        </Box>
    </SliceEditPopover>;
}
