/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The narrow layout (`Allocation Spec.md` §9.12, A78, #1333): below 480px of
 * main, the Timeline is a card per resource the narrowing shows — its load
 * line, its bins today with Unlink, Move, `Split…` and Back to Arrivals, and
 * `Book an arrival…` — and the Table a card per row in its time bands, with
 * `Book…`, `Reserve…`, `Allocate…`, a whole bin's `Split…`, `Unlink` and `Back
 * to Arrivals`, in the board's nouns. A choice is the Table's Chooser in its
 * anchored popover, asking the fit what its cell asks; Unlink and Back to
 * Arrivals act at once, each a
 * draft the history undoes, and Move takes a bin's part to another resource
 * (ruled 19 Oct). `Split…` is the Inspector's popover (`split.tsx`, #1362).
 * Every action is one of the board's commands. Nothing here registers a drag source, a drop
 * target or a handle; the cards' looks are the shared agenda part's, as the
 * Roster's and the Calendar's are. A day not read yet draws each resource's
 * card — its name and what is known of it without the day's read — or each
 * band's head and one placeholder card in it, its contents placeholders once
 * the reveal says so (#1398, CL2); a day whose read failed says so once, in
 * the first card in view (CL11).
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Button, chakra } from "@chakra-ui/react";
import { variant, type SortedMap, type option } from "@elaraai/east";
import { LoadingFailedLine, PlaceholderShape, VirtualRows, formatDatePattern, useRowsTop } from "@elaraai/east-ui-components/internal";
import type { PeriodRead } from "../shared/loading.js";
import { GroupHeading, useGroupCollapse } from "../shared/schedule/group-heading.js";
import { remainderOf, splitOf } from "./actions.js";
import { useBinFocusTarget } from "./bin-focus.js";
import { arrivalChoices, type ChoiceWords } from "./choices.js";
import { binCode, matesOf, type InspectorWords, type Mate } from "./inspector-model.js";
import { NarrowedEmpty } from "./narrowed.js";
import type { AllocationOptimised } from "./optimise.js";
import { SplitPopover } from "./split.js";
import { a, one, useNouns } from "./nouns.js";
import { ChoiceCell, ChooserPopover, openKey, type ChoiceScene, type Open } from "./table.js";
import { bandLine, narrowBands, rowStatus, tableBands, tableRows, type TableBand, type TableRow } from "./table-rows.js";
import type { TimelineFollow } from "./timeline.js";
import {
    allocationWords, compareFloat, focusOf, partsOf, type AllocationStyles, type AllocationValue, type Bin, type Day, type FitAsk, type Load, type ResourceLine, type Selection, type Slot,
} from "./model.js";

/** The cards' props: what a cell's Chooser reads, and the board's drafts, figures, selection and commands. */
export interface CardsProps extends ChoiceScene {
    value: AllocationValue;
    styles: AllocationStyles;
    /** The day as the record holds it: what a draft differs from. */
    held: Day | undefined;
    sameBin: (a: Bin, b: Bin) => boolean;
    loads: SortedMap<string, Load>;
    /** Each resource's line on the day (A19). */
    lines: ReadonlyMap<string, ResourceLine>;
    slots: readonly Slot[];
    /** Which layout the cards stand for. */
    layout: "timeline" | "table";
    /** The board's drag surface: the Table's bands keep their folds by it, the cards' with them. */
    surface: string;
    selection: Selection | undefined;
    /** An explicit inspection: what a card's head selects. */
    select: (next: Selection | undefined) => void;
    /** Selecting follows the selection (A12): its card scrolls into view. */
    follow: TimelineFollow;
    /** Whether the day takes edits: with none, the cards have no actions. */
    editable: boolean;
    /** The lanes the narrowing shows, by key; `none` for every one. */
    visibleLanes: option<Set<string>>;
    /** Clears the narrowing, where nothing shows; `undefined` with no narrowing. */
    clearFilters: (() => void) | undefined;
    /** Books an arrival onto a resource at the day's first free slot (A36), as a drop on its row does. */
    bookOnto: (arrival: string, resource: string) => void;
    /**
     * What the cards draw of the day's read (#1398): the day as read; a day not read yet — the day without its bins handed
     * in as `plan`, each card's contents placeholders once the reveal says so; or one whose read failed — the failure said
     * once, in the first card in view.
     */
    read: PeriodRead;
    /** What the runs of the app's optimiser left on the day's bins (#1409): each bin's operation, drawn on its card, and its provenance on hover. */
    optimised?: AllocationOptimised | undefined;
    /** Whether a run's highlight is on (#1409): a band's count flashes where the run changed its rows. */
    lit?: boolean | undefined;
}

/** The failure said once, in the first card in view (#1398, CL11): the day's words and its Retry. */
function ReadFailure({ read }: { read: Extract<PeriodRead, { state: "failed" }> }) {
    return <LoadingFailedLine message={read.message} retry={{ onRetry: read.retry }} />;
}

/**
 * The first card in view among a list's lines that `holds`, else the last one above it: where a failed day says so once
 * (#1398).
 *
 * @param count - The list's lines
 * @param holds - Whether a line is one that may say it
 * @param top - The line at the top of the view; `undefined` before the lines are placed
 * @returns The line's index; `undefined` with none that holds
 */
function firstInView(count: number, holds: (index: number) => boolean, top: number | undefined): number | undefined {
    const from = Math.max(0, top ?? 0);
    for (let i = from; i < count; i++) if (holds(i)) return i;
    for (let i = Math.min(from, count) - 1; i >= 0; i--) if (holds(i)) return i;
    return undefined;
}

/** Every resource's card may say a failed day's failure. */
const ANY_CARD = () => true;

/** What a card's Chooser has open: its row's cell (`Open`), or a resource card's `Book an arrival…`. */
type CardsOpen = Open | undefined;

/** The cards' words: a Chooser's and the inspector's, from the board's figures. */
interface CardWords { choice: ChoiceWords; inspector: InspectorWords }

/**
 * The narrow layout (see the module docs).
 *
 * @param props - See {@link CardsProps}
 * @returns A card per resource (the Timeline's), or per row (the Table's)
 */
export function AllocationCards(props: CardsProps) {
    const { value, context } = props;
    const nouns = useNouns();
    const unit = context.unit;
    const words = useMemo((): CardWords => {
        const board = allocationWords();
        const lane = (key: string) => value.lanes.find(l => l.key === key)?.label ?? key;
        return {
            choice: { quantity: v => board.quantity(v, unit), number: v => board.quantity(v, ""), lane },
            inspector: { nouns, quantity: v => board.quantity(v, unit), number: v => board.quantity(v, ""), lane, load: (fill, row) => board.load(fill, row, unit) },
        };
    }, [value.lanes, unit, nouns]);
    return props.layout === "timeline" ? <ResourceCards props={props} words={words} /> : <RowCards props={props} words={words} />;
}

/** The Timeline's cards (A78): a card per resource the narrowing shows, in the resources' key order, as its rows are (A18). */
function ResourceCards({ props, words }: { props: CardsProps; words: CardWords }) {
    const { context, visibleResources, plan, styles } = props;
    const keys = useMemo(() => [...context.resources.keys()].filter(key => visibleResources.type === "none" || visibleResources.value.has(key)),
        [context.resources, visibleResources]);
    // Every bin's row, as the Table names it: what a bin's Move asks of.
    const rows = useMemo(() => new Map(tableRows(props.slots, plan).map(row => [row.key, row] as const)), [props.slots, plan]);
    const [open, setOpen] = useState<CardsOpen>();
    const getItemKey = useCallback((index: number) => keys[index]!, [keys]);
    // Selecting follows the selection (A12): the selected resource's card, or the card of the selected bin's resource.
    const focus = focusOf(props.selection, plan);
    const followed = focus === undefined ? -1 : keys.indexOf(focus);
    // The narrowing's empty state only under a narrowing (#1398, CL13).
    if (keys.length === 0) return <Box css={styles.cards} data-allocation-cards="timeline">{visibleResources.type === "some" && <NarrowedEmpty styles={styles} clear={props.clearFilters} />}</Box>;
    return <Box css={styles.cards} data-allocation-cards="timeline">
        <VirtualRows fillParent height={undefined} maxHeight={undefined} rootCss={styles.agenda} count={keys.length} getItemKey={getItemKey}
            estimateSize={() => 152} overscan={2} scrollToIndex={followed < 0 ? undefined : followed} scrollNonce={props.follow.nonce} scrollAlign="auto"
            renderRow={index => <Box css={styles.agendaItem}><ResourceCard props={props} words={words} resource={keys[index]!} rows={rows} open={open} setOpen={setOpen}
                index={index} count={keys.length} /></Box>} />
    </Box>;
}

/**
 * A resource's card: its name and its load line, one button that selects it; its bins today; and `Book an arrival…`.
 * A day not read yet: its name and what its line knows without the day's read, a placeholder where its bins go; a day
 * whose read failed, the failure in the first card in view (#1398).
 */
function ResourceCard({ props, words, resource, rows, open, setOpen, index, count }: {
    props: CardsProps; words: CardWords; resource: string; rows: ReadonlyMap<string, TableRow>; open: CardsOpen; setOpen: (open: CardsOpen) => void;
    /** Its place in the list: what keys its placeholder's width. */
    index: number;
    /** The cards in the list: the first in view of a failed day says so, which the card reads itself (CL9). */
    count: number;
}) {
    const { context, styles, plan, held, selection, read } = props;
    const failing = useRowsTop(top => read.state === "failed" && index === firstInView(count, ANY_CARD, top));
    const row = context.resources.get(resource)!;
    const line = props.lines.get(resource);
    const mates = matesOf(plan, held, resource, context, words.inspector);
    const selected = selection?.type === "resource" && selection.key === resource;
    return <Box css={styles.agendaCard} data-allocation-resource-card={resource} data-selected={selected ? "" : undefined} data-allocation-unread={read.state === "held" ? undefined : ""}>
        <chakra.button type="button" css={styles.agendaCardHead} aria-pressed={selected} onClick={() => props.select({ type: "resource", key: resource })}>
            <Box css={styles.agendaCardTitle}>{row.label}</Box>
            {line !== undefined && <Box css={styles.agendaLine} data-allocation-card-line="" data-tone={line.over ? "danger" : line.overlap || line.under ? "warning" : undefined}>{line.text}</Box>}
        </chakra.button>
        {/* A day not read yet: a placeholder where its bins go, unseen until the frame's reveal says so; failed, its place kept, blank. */}
        {read.state !== "held" ? failing && read.state === "failed" ? <ReadFailure read={read} />
            : <Box css={styles.agendaLine} data-blank={read.state === "failed" ? "" : undefined}><PlaceholderShape kind="text" index={index} /></Box>
            : mates.length === 0 ? <Box css={styles.agendaLine}>no bins today</Box>
                : mates.map(mate => <ResourceBin key={mate.id} props={props} words={words} resource={resource} mate={mate} row={rows.get(`bin:${mate.id}`)} open={open} setOpen={setOpen} />)}
        {props.editable && <Box css={styles.agendaActions}><BookOnto props={props} words={words} resource={resource} open={open} setOpen={setOpen} /></Box>}
    </Box>;
}

/**
 * A bin on a resource's card: its time, lane, code and what it puts there, one
 * button that selects it; then Unlink (its part there), Move (that part, to
 * another resource), `Split…` (what is left unallocated, or with nothing left
 * some of its part there, onto another resource) and Back to Arrivals — a
 * reservation's Move and Remove.
 */
function ResourceBin({ props, words, resource, mate, row, open, setOpen }: {
    props: CardsProps; words: CardWords; resource: string; mate: Mate; row: TableRow | undefined; open: CardsOpen; setOpen: (open: CardsOpen) => void;
}) {
    const { plan, held, context, styles, commands } = props;
    const nouns = useNouns();
    const bin = plan.bins.get(mate.id)!;
    const committed = held?.bins.get(mate.id);
    const draft = committed === undefined || !props.sameBin(committed, bin);
    const selected = props.selection?.type === "bin" && props.selection.id === mate.id;
    const reserved = bin.arrival.type === "none";
    const name = context.resources.get(resource)?.label ?? resource;
    // Its head takes the keyboard a pick in Search Records gives the bin (#1398).
    const given = useBinFocusTarget<HTMLButtonElement>(mate.id);
    const move = row === undefined ? null : <ChoiceCell props={props} row={row} side="resource" part={resource} words={words.choice}
        open={open?.row === row.key && openKey(open.side, open.part) === openKey("resource", resource)} setOpen={setOpen}
        trigger={() => <Button size="xs" variant="outline" title={reserved ? `Move the reservation to another ${one(nouns.resource)}` : `Move the ${mate.quantity} on ${name} to another ${one(nouns.resource)}`}>Move</Button>} />;
    const split = reserved || splitOf(bin, resource) === undefined ? null : <SplitPopover id={mate.id} bin={bin} from={resource} context={context} plan={plan} commands={commands}
        fit={props.fit} words={words.inspector} shown={props.visibleResources} trigger={label => <Button size="xs" variant="outline" title={label} data-allocation-split-open="">Split…</Button>} />;
    // What a run of the optimiser did to the bin (#1409, R7, R17), while it is still the run's draft: its mark, and its provenance on hover.
    const op = draft ? props.optimised?.ops.get(mate.id) : undefined;
    return <Box css={styles.agendaBin} data-allocation-card-bin={mate.id} data-draft={draft ? "" : undefined} data-selected={selected ? "" : undefined}
        data-op={op?.op} data-fill={op === undefined ? undefined : "own"} title={op?.provenance}>
        <chakra.button ref={given} type="button" css={styles.agendaBinHead} title={mate.tip} aria-pressed={selected} onClick={() => props.select({ type: "bin", id: mate.id })}>
            <span>{mate.time} · {mate.lane}</span><span>{mate.code}</span><span>{mate.quantity}</span>
        </chakra.button>
        {props.editable && <Box css={styles.agendaActions}>
            {reserved ? <>
                {move}
                <Button size="xs" variant="outline" title="Remove the reservation · the slot becomes free" onClick={() => commands.remove(mate.id)}>Remove</Button>
            </> : <>
                <Button size="xs" variant="outline" title={`Unlink ${mate.code} from ${name}`} onClick={() => commands.unlink(mate.id, resource)}>Unlink</Button>
                {move}
                {split}
                <Button size="xs" variant="outline" onClick={() => commands.remove(mate.id)}
                    title={committed !== undefined ? `Remove ${mate.code} from the plan · it moves to ${nouns.arrival.other}` : `Return ${mate.code} to ${nouns.arrival.other}`}>
                    Back to {nouns.arrival.other}
                </Button>
            </>}
        </Box>}
    </Box>;
}

/**
 * A resource card's `Book an arrival…` (A78): the arrivals the plan has not
 * booked, each as the fit takes it on the resource — its fits, then those
 * that don't fit, then the arrivals already on the board — and a choice books
 * it there at the day's first free slot, as a drop on its row does (A36).
 */
function BookOnto({ props, words, resource, open, setOpen }: { props: CardsProps; words: CardWords; resource: string; open: CardsOpen; setOpen: (open: CardsOpen) => void }) {
    const { fit, context } = props;
    const nouns = useNouns();
    const id = `resource:${resource}`;
    const isOpen = open?.row === id;
    // The question (F1): the resource taken, of the day as drafted — a verdict for each arrival not booked.
    const ask = useMemo((): FitAsk => variant("take", { resource }), [resource]);
    const { ask: asking } = fit;
    useEffect(() => { if (isOpen) asking(ask); }, [isOpen, ask, asking]);
    const answer = fit.answer(ask);
    const sections = !isOpen ? [] : arrivalChoices({ plan: props.plan, context, day: props.day, words: words.choice, bin: undefined, resource, answer, shown: props.visibleArrivals });
    const name = context.resources.get(resource)?.label ?? resource;
    return <ChooserPopover id={`${id}|book`} label={`Book ${a(nouns.arrival)} · ${name}`} open={isOpen} onOpenChange={next => setOpen(next ? { row: id, side: "arrival" } : undefined)}
        trigger={<Button size="xs" variant="outline">Book {a(nouns.arrival)}…</Button>} sections={sections} placeholder={`Find ${a(nouns.arrival)}`}
        onChoose={key => { setOpen(undefined); props.bookOnto(key, resource); }} />;
}

/** One line of the Table's cards: a band's head, a row's card, or a band's placeholder card while the day is not read (#1398). */
type Line = { kind: "band"; band: TableBand } | { kind: "row"; row: TableRow } | { kind: "unread"; band: TableBand };

/**
 * The Table's cards (A78): a card per row the narrowing shows, in the Table's bands, folded as the Table's are. A day not
 * read yet: each band's head, and one placeholder card in each that holds a slot (#1398).
 */
function RowCards({ props, words }: { props: CardsProps; words: CardWords }) {
    const { value, plan, styles, context, read } = props;
    const { visibleLanes, visibleResources, visibleArrivals } = props;
    const bands = useMemo(() => narrowBands(tableBands(tableRows(props.slots, plan), plan, props.day, value.table.bands), plan, visibleLanes, visibleResources, visibleArrivals),
        [props.slots, plan, props.day, value.table.bands, visibleLanes, visibleResources, visibleArrivals]);
    const { collapsed, toggle } = useGroupCollapse(`${props.surface}.table`);
    const unread = read.state !== "held";
    const lines = useMemo((): Line[] => bands.flatMap(band => [{ kind: "band" as const, band },
        ...(collapsed.includes(band.key) ? [] : unread ? band.rows.length === 0 ? [] : [{ kind: "unread" as const, band }]
            : band.rows.map(row => ({ kind: "row" as const, row })))]), [bands, collapsed, unread]);
    const [open, setOpen] = useState<CardsOpen>();
    const getItemKey = useCallback((index: number) => {
        const l = lines[index]!;
        return l.kind === "band" ? `band:${l.band.key}` : l.kind === "unread" ? `unread:${l.band.key}` : l.row.key;
    }, [lines]);
    const board = allocationWords();
    // Selecting follows the selection (A12): the selected bin's or slot's card.
    const { selection } = props;
    const followed = selection === undefined ? -1 : lines.findIndex(l => l.kind === "row" && ownRow(selection, l.row));
    // The narrowing's empty state only under a narrowing (#1398, CL13).
    const narrowed = visibleLanes.type === "some" || visibleResources.type === "some" || visibleArrivals.type === "some";
    if (lines.length === 0) return <Box css={styles.cards} data-allocation-cards="table">{narrowed && <NarrowedEmpty styles={styles} clear={props.clearFilters} />}</Box>;
    return <Box css={styles.cards} data-allocation-cards="table">
        <VirtualRows fillParent height={undefined} maxHeight={undefined} rootCss={styles.agenda} count={lines.length} getItemKey={getItemKey}
            estimateSize={index => lines[index]!.kind === "band" ? 46 : 132} overscan={2} scrollToIndex={followed < 0 ? undefined : followed}
            scrollNonce={props.follow.nonce} scrollAlign="auto" renderRow={index => {
                const line = lines[index]!;
                if (line.kind === "band") {
                    const folded = collapsed.includes(line.band.key);
                    // A day not read yet: its band's count a placeholder, its line said once its rows land.
                    return <Box css={styles.agendaItem}><GroupHeading scope="allocation" group={{ key: line.band.key, label: line.band.label }} styles={styles} collapsed={folded} toggle={toggle}>
                        {unread ? read.state === "pending" && <PlaceholderShape kind="count" index={index} /> : <>
                            <Box as="span" css={styles.bandCount} data-allocation-band-count=""
                                data-opn={props.lit === true && line.band.rows.some(r => r.bin !== undefined && props.optimised?.ops.has(r.bin) === true) ? "" : undefined}>{line.band.rows.length}</Box>
                            <Box as="span" css={styles.groupMeta}>{bandLine(line.band, board.quantity(Math.round(line.band.quantity), context.unit), folded)}</Box>
                        </>}
                    </GroupHeading></Box>;
                }
                if (line.kind === "unread") return <Box css={styles.agendaItem}><UnreadRowCard styles={styles} band={line.band} index={index} lines={lines} read={read} /></Box>;
                return <Box css={styles.agendaItem}><RowCard props={props} words={words} row={line.row} open={open} setOpen={setOpen} /></Box>;
            }} />
    </Box>;
}

/**
 * A band's placeholder card of a day not read, or whose read failed (#1398, CL2, CL11): its title, its line and its status
 * placeholders, unseen until the frame's reveal says so, or blank where the day failed — but in the first such card in
 * view, which says so once. It reads which line is at the top of the view itself (CL9).
 */
function UnreadRowCard({ styles, band, index, lines, read }: { styles: AllocationStyles; band: TableBand; index: number; lines: readonly Line[]; read: PeriodRead }) {
    const failing = useRowsTop(top => read.state === "failed" && index === firstInView(lines.length, i => lines[i]!.kind === "unread", top));
    return <Box css={styles.agendaCard} data-allocation-row-card={`unread:${band.key}`} data-allocation-unread=""
        data-blank={read.state === "failed" ? "" : undefined} aria-hidden={failing ? undefined : true}>
        {failing && read.state === "failed" ? <ReadFailure read={read} /> : <Box css={styles.agendaCardHead}>
            <Box css={styles.agendaCardTitle}><PlaceholderShape kind="label" index={index} /></Box>
            <Box css={styles.agendaLine}><PlaceholderShape kind="text" index={index + 1} /></Box>
            <Box css={styles.agendaStatus}><PlaceholderShape kind="enum" index={index} /></Box>
        </Box>}
    </Box>;
}

/** Whether a selection is a row's own (A44): its bin, or its free slot. */
function ownRow(selection: Selection, row: TableRow): boolean {
    if (selection.type === "bin") return row.bin === selection.id;
    return selection.type === "slot" && row.kind === "free" && row.lane === selection.lane && row.slotAt.getTime() === selection.at;
}

/**
 * A row's card: its lane and time, what it holds and its status, one button
 * that selects it; and its actions — a free slot's `Book…` and `Reserve…`, a
 * bin's `Allocate…`, `Split…` while it is wholly on its resources (with some
 * of it unallocated, `Allocate…` places that), `Unlink` and `Back to Arrivals`,
 * a reservation's `Book…`, `Reserve…` and `Remove` — each its cell's command.
 */
function RowCard({ props, words, row, open, setOpen }: { props: CardsProps; words: CardWords; row: TableRow; open: CardsOpen; setOpen: (open: CardsOpen) => void }) {
    const { plan, held, context, styles, commands } = props;
    const nouns = useNouns();
    const board = allocationWords();
    const unit = context.unit;
    const bin = row.bin === undefined ? undefined : plan.bins.get(row.bin);
    const committed = row.bin === undefined ? undefined : held?.bins.get(row.bin);
    const draft = bin !== undefined && (committed === undefined || !props.sameBin(committed, bin));
    const parts = bin === undefined ? [] : partsOf(bin);
    const remainder = bin === undefined ? 0 : remainderOf(bin);
    // A split or partly allocated bin: some of it is on a resource, and some is not (A70).
    const unallocated = parts.length > 0 && compareFloat(remainder, 0) > 0;
    const check = parts.some(part => { const l = props.lines.get(part.key); return l !== undefined && (l.over || l.overlap); });
    const status = rowStatus(row.kind, parts.length > 0, check, draft);
    const selected = props.selection !== undefined && ownRow(props.selection, row);
    // A bin's card's head takes the keyboard a pick in Search Records gives the bin (#1398).
    const given = useBinFocusTarget<HTMLButtonElement>(row.bin);
    const lane = words.choice.lane(row.lane), time = formatDatePattern("HH:mm", row.at);
    const nameOf = (key: string) => context.resources.get(key)?.label ?? key;
    const code = bin === undefined ? undefined : binCode(context, bin);
    // What it holds: a bin's arrival and quantity, and where its parts are and what they leave (A70); a reservation's resource; nothing.
    const holds = bin === undefined ? `no ${one(nouns.arrival)} · no ${one(nouns.resource)}`
        : bin.arrival.type === "none" ? `Reserved on ${parts[0] === undefined ? "nothing" : nameOf(parts[0].key)} · no ${one(nouns.arrival)} yet`
            : `${code} · ${board.quantity(bin.quantity, unit)}`;
    const where = bin === undefined || bin.arrival.type === "none" ? undefined
        : parts.length === 0 ? "not linked" : parts.map(part => `${nameOf(part.key)} ${board.quantity(part.quantity, unit)}`).join(" · ");
    const chooser = (side: "arrival" | "resource", label: string, part?: string | null, title?: string) => <ChoiceCell props={props} row={row} side={side} part={part} words={words.choice}
        open={open?.row === row.key && openKey(open.side, open.part) === openKey(side, part)} setOpen={setOpen}
        trigger={() => <Button size="xs" variant="outline" title={title}>{label}</Button>} />;
    // What a run of the optimiser did to the row's bin (#1409, R7, R17), while it is still the run's draft: its mark, and its provenance on hover.
    const op = row.bin === undefined || !draft ? undefined : props.optimised?.ops.get(row.bin);
    return <Box css={styles.agendaCard} data-allocation-row-card={row.key} data-kind={row.kind} data-draft={draft ? "" : undefined} data-selected={selected ? "" : undefined}
        data-op={op?.op} data-fill={op === undefined ? undefined : "own"} title={op?.provenance}>
        <chakra.button ref={given} type="button" css={styles.agendaCardHead} aria-pressed={selected}
            onClick={() => props.select(row.bin !== undefined ? { type: "bin", id: row.bin } : { type: "slot", lane: row.lane, at: row.slotAt.getTime() })}>
            <Box css={styles.agendaCardTitle}>{lane} · {time}</Box>
            <Box css={styles.agendaLine}>{holds}</Box>
            {where !== undefined && <Box css={styles.agendaLine} data-tone={parts.length === 0 ? "warning" : undefined}>{where}</Box>}
            {unallocated && <Box css={styles.agendaLine} data-tone="warning">{board.quantity(remainder, unit)} unallocated</Box>}
            <Box as="span" css={styles.agendaStatus} data-status={status}><Box as="span" css={styles.tableStatusDot} />{status}</Box>
        </chakra.button>
        {props.editable && <Box css={styles.agendaActions}>
            {row.kind !== "bin" && chooser("arrival", "Book…", undefined, row.kind === "reserved" ? `Book ${a(nouns.arrival)} into the reservation` : `Book ${a(nouns.arrival)} into ${lane} ${time}`)}
            {row.kind !== "bin" && chooser("resource", "Reserve…", undefined, row.kind === "reserved" ? `Move the reservation to another ${one(nouns.resource)}` : `Reserve ${a(nouns.resource)}`)}
            {row.kind === "reserved" && row.bin !== undefined
                && <Button size="xs" variant="outline" title="Remove the reservation · the slot becomes free" onClick={() => commands.remove(row.bin!)}>Remove</Button>}
            {row.kind === "bin" && row.bin !== undefined && <>
                {/* What it links: the remainder of a split or partly allocated bin (A71), else its one part, as its row's chevron does. */}
                {chooser("resource", "Allocate…", unallocated ? null : undefined,
                    parts.length === 0 ? `Choose ${a(nouns.resource)}` : unallocated ? `Choose ${a(nouns.resource)} for the ${board.quantity(remainder, unit)} unallocated` : `Change the ${one(nouns.resource)}`)}
                {bin !== undefined && parts.length > 0 && !unallocated && <SplitPopover id={row.bin} bin={bin} context={context} plan={plan} commands={commands} fit={props.fit}
                    words={words.inspector} shown={props.visibleResources} trigger={label => <Button size="xs" variant="outline" title={label} data-allocation-split-open="">Split…</Button>} />}
                {parts.length > 0 && <Button size="xs" variant="outline" title={`Unlink ${code} from ${parts.map(part => nameOf(part.key)).join(" and ")}`}
                    onClick={() => commands.unlink(row.bin!)}>Unlink</Button>}
                <Button size="xs" variant="outline" onClick={() => commands.remove(row.bin!)}
                    title={committed !== undefined ? `Remove ${code} from the plan · it moves to ${nouns.arrival.other}` : `Return ${code} to ${nouns.arrival.other}`}>
                    Back to {nouns.arrival.other}
                </Button>
            </>}
        </Box>}
    </Box>;
}
