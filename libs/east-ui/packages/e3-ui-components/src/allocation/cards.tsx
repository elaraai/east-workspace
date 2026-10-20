/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The narrow layout (`Allocation Spec.md` §9.12, A78, #1333): below 480px of
 * main, the Timeline is a card per resource the narrowing shows — its load
 * line, its bins today with Unlink, Move, `Split…` and Back to Events, and
 * `Book an event…` — and the Table a card per row in its time bands, with
 * `Book…`, `Reserve…`, `Allocate…`, a whole bin's `Split…`, `Unlink` and `Back
 * to Events`. A choice is the Table's Chooser in its anchored popover, asking
 * the fit what its cell asks; Unlink and Back to Events act at once, each a
 * draft the history undoes, and Move takes a bin's part to another resource
 * (ruled 19 Oct). `Split…` is the Inspector's popover (`split.tsx`, #1362).
 * Every action is one of the board's commands. Nothing here registers a drag source, a drop
 * target or a handle; the cards' looks are the shared agenda part's, as the
 * Roster's and the Calendar's are.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Button, chakra } from "@chakra-ui/react";
import { variant, type SortedMap, type option } from "@elaraai/east";
import { VirtualRows, formatDatePattern } from "@elaraai/east-ui-components/internal";
import { GroupHeading, useGroupCollapse } from "../shared/schedule/group-heading.js";
import { remainderOf, splitOf } from "./actions.js";
import { eventChoices, type ChoiceWords } from "./choices.js";
import { binCode, matesOf, type InspectorWords, type Mate } from "./inspector-model.js";
import { NarrowedEmpty } from "./narrowed.js";
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
    /** Books an event onto a resource at the day's first free slot (A36), as a drop on its row does. */
    bookOnto: (event: string, resource: string) => void;
}

/** What a card's Chooser has open: its row's cell (`Open`), or a resource card's `Book an event…`. */
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
    if (keys.length === 0) return <Box css={styles.cards} data-allocation-cards="timeline"><NarrowedEmpty styles={styles} clear={props.clearFilters} /></Box>;
    return <Box css={styles.cards} data-allocation-cards="timeline">
        <VirtualRows fillParent height={undefined} maxHeight={undefined} rootCss={styles.agenda} count={keys.length} getItemKey={getItemKey}
            estimateSize={() => 152} overscan={2} scrollToIndex={followed < 0 ? undefined : followed} scrollNonce={props.follow.nonce} scrollAlign="auto"
            renderRow={index => <Box css={styles.agendaItem}><ResourceCard props={props} words={words} resource={keys[index]!} rows={rows} open={open} setOpen={setOpen} /></Box>} />
    </Box>;
}

/** A resource's card: its name and its load line, one button that selects it; its bins today; and `Book an event…`. */
function ResourceCard({ props, words, resource, rows, open, setOpen }: {
    props: CardsProps; words: CardWords; resource: string; rows: ReadonlyMap<string, TableRow>; open: CardsOpen; setOpen: (open: CardsOpen) => void;
}) {
    const { context, styles, plan, held, selection } = props;
    const row = context.resources.get(resource)!;
    const line = props.lines.get(resource);
    const mates = matesOf(plan, held, resource, context, words.inspector);
    const selected = selection?.type === "resource" && selection.key === resource;
    return <Box css={styles.agendaCard} data-allocation-resource-card={resource} data-selected={selected ? "" : undefined}>
        <chakra.button type="button" css={styles.agendaCardHead} aria-pressed={selected} onClick={() => props.select({ type: "resource", key: resource })}>
            <Box css={styles.agendaCardTitle}>{row.label}</Box>
            {line !== undefined && <Box css={styles.agendaLine} data-allocation-card-line="" data-tone={line.over ? "danger" : line.overlap || line.under ? "warning" : undefined}>{line.text}</Box>}
        </chakra.button>
        {mates.length === 0 ? <Box css={styles.agendaLine}>no bins today</Box>
            : mates.map(mate => <ResourceBin key={mate.id} props={props} words={words} resource={resource} mate={mate} row={rows.get(`bin:${mate.id}`)} open={open} setOpen={setOpen} />)}
        {props.editable && <Box css={styles.agendaActions}><BookOnto props={props} words={words} resource={resource} open={open} setOpen={setOpen} /></Box>}
    </Box>;
}

/**
 * A bin on a resource's card: its time, lane, code and what it puts there, one
 * button that selects it; then Unlink (its part there), Move (that part, to
 * another resource), `Split…` (what is left unallocated, or with nothing left
 * some of its part there, onto another resource) and Back to Events — a
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
    const reserved = bin.event.type === "none";
    const name = context.resources.get(resource)?.label ?? resource;
    const move = row === undefined ? null : <ChoiceCell props={props} row={row} side="resource" part={resource} words={words.choice}
        open={open?.row === row.key && openKey(open.side, open.part) === openKey("resource", resource)} setOpen={setOpen}
        trigger={() => <Button size="xs" variant="outline" title={reserved ? `Move the reservation to another ${one(nouns.resource)}` : `Move the ${mate.quantity} on ${name} to another ${one(nouns.resource)}`}>Move</Button>} />;
    const split = reserved || splitOf(bin, resource) === undefined ? null : <SplitPopover id={mate.id} bin={bin} from={resource} context={context} plan={plan} commands={commands}
        fit={props.fit} words={words.inspector} shown={props.visibleResources} trigger={label => <Button size="xs" variant="outline" title={label} data-allocation-split-open="">Split…</Button>} />;
    return <Box css={styles.agendaBin} data-allocation-card-bin={mate.id} data-draft={draft ? "" : undefined} data-selected={selected ? "" : undefined}>
        <chakra.button type="button" css={styles.agendaBinHead} title={mate.tip} aria-pressed={selected} onClick={() => props.select({ type: "bin", id: mate.id })}>
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
                    title={committed !== undefined ? `Remove ${mate.code} from the plan · it moves to ${nouns.event.other}` : `Return ${mate.code} to ${nouns.event.other}`}>
                    Back to {nouns.event.other}
                </Button>
            </>}
        </Box>}
    </Box>;
}

/**
 * A resource card's `Book an event…` (A78): the events the plan has not
 * booked, each as the fit takes it on the resource — its fits, then those
 * that don't fit, then the events already on the board — and a choice books
 * it there at the day's first free slot, as a drop on its row does (A36).
 */
function BookOnto({ props, words, resource, open, setOpen }: { props: CardsProps; words: CardWords; resource: string; open: CardsOpen; setOpen: (open: CardsOpen) => void }) {
    const { fit, context } = props;
    const nouns = useNouns();
    const id = `resource:${resource}`;
    const isOpen = open?.row === id;
    // The question (F1): the resource taken, of the day as drafted — a verdict for each event not booked.
    const ask = useMemo((): FitAsk => variant("take", { resource }), [resource]);
    const { ask: asking } = fit;
    useEffect(() => { if (isOpen) asking(ask); }, [isOpen, ask, asking]);
    const answer = fit.answer(ask);
    const sections = !isOpen ? [] : eventChoices({ plan: props.plan, context, day: props.day, words: words.choice, bin: undefined, resource, answer, shown: props.visibleEvents });
    const name = context.resources.get(resource)?.label ?? resource;
    return <ChooserPopover id={`${id}|book`} label={`Book ${a(nouns.event)} · ${name}`} open={isOpen} onOpenChange={next => setOpen(next ? { row: id, side: "event" } : undefined)}
        trigger={<Button size="xs" variant="outline">Book {a(nouns.event)}…</Button>} sections={sections} placeholder={`Find ${a(nouns.event)}`}
        onChoose={key => { setOpen(undefined); props.bookOnto(key, resource); }} />;
}

/** One line of the Table's cards: a band's head, or a row's card. */
type Line = { kind: "band"; band: TableBand } | { kind: "row"; row: TableRow };

/** The Table's cards (A78): a card per row the narrowing shows, in the Table's bands, folded as the Table's are. */
function RowCards({ props, words }: { props: CardsProps; words: CardWords }) {
    const { value, plan, styles, context } = props;
    const { visibleLanes, visibleResources, visibleEvents } = props;
    const bands = useMemo(() => narrowBands(tableBands(tableRows(props.slots, plan), plan, props.day, value.table.bands), plan, visibleLanes, visibleResources, visibleEvents),
        [props.slots, plan, props.day, value.table.bands, visibleLanes, visibleResources, visibleEvents]);
    const { collapsed, toggle } = useGroupCollapse(`${props.surface}.table`);
    const lines = useMemo((): Line[] => bands.flatMap(band => [{ kind: "band" as const, band },
        ...(collapsed.includes(band.key) ? [] : band.rows.map(row => ({ kind: "row" as const, row })))]), [bands, collapsed]);
    const [open, setOpen] = useState<CardsOpen>();
    const getItemKey = useCallback((index: number) => { const l = lines[index]!; return l.kind === "band" ? `band:${l.band.key}` : l.row.key; }, [lines]);
    const board = allocationWords();
    // Selecting follows the selection (A12): the selected bin's or slot's card.
    const { selection } = props;
    const followed = selection === undefined ? -1 : lines.findIndex(l => l.kind === "row" && ownRow(selection, l.row));
    if (lines.length === 0) return <Box css={styles.cards} data-allocation-cards="table"><NarrowedEmpty styles={styles} clear={props.clearFilters} /></Box>;
    return <Box css={styles.cards} data-allocation-cards="table">
        <VirtualRows fillParent height={undefined} maxHeight={undefined} rootCss={styles.agenda} count={lines.length} getItemKey={getItemKey}
            estimateSize={index => lines[index]!.kind === "band" ? 46 : 132} overscan={2} scrollToIndex={followed < 0 ? undefined : followed}
            scrollNonce={props.follow.nonce} scrollAlign="auto" renderRow={index => {
                const line = lines[index]!;
                if (line.kind === "band") {
                    const folded = collapsed.includes(line.band.key);
                    return <Box css={styles.agendaItem}><GroupHeading scope="allocation" group={{ key: line.band.key, label: line.band.label }} styles={styles} collapsed={folded} toggle={toggle}>
                        <Box as="span" css={styles.bandCount} data-allocation-band-count="">{line.band.rows.length}</Box>
                        <Box as="span" css={styles.groupMeta}>{bandLine(line.band, board.quantity(Math.round(line.band.quantity), context.unit), folded)}</Box>
                    </GroupHeading></Box>;
                }
                return <Box css={styles.agendaItem}><RowCard props={props} words={words} row={line.row} open={open} setOpen={setOpen} /></Box>;
            }} />
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
 * of it unallocated, `Allocate…` places that), `Unlink` and `Back to Events`,
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
    const lane = words.choice.lane(row.lane), time = formatDatePattern("HH:mm", row.at);
    const nameOf = (key: string) => context.resources.get(key)?.label ?? key;
    const code = bin === undefined ? undefined : binCode(context, bin);
    // What it holds: a bin's event and quantity, and where its parts are and what they leave (A70); a reservation's resource; nothing.
    const holds = bin === undefined ? `no ${one(nouns.event)} · no ${one(nouns.resource)}`
        : bin.event.type === "none" ? `Reserved on ${parts[0] === undefined ? "nothing" : nameOf(parts[0].key)} · no ${one(nouns.event)} yet`
            : `${code} · ${board.quantity(bin.quantity, unit)}`;
    const where = bin === undefined || bin.event.type === "none" ? undefined
        : parts.length === 0 ? "not linked" : parts.map(part => `${nameOf(part.key)} ${board.quantity(part.quantity, unit)}`).join(" · ");
    const chooser = (side: "event" | "resource", label: string, part?: string | null, title?: string) => <ChoiceCell props={props} row={row} side={side} part={part} words={words.choice}
        open={open?.row === row.key && openKey(open.side, open.part) === openKey(side, part)} setOpen={setOpen}
        trigger={() => <Button size="xs" variant="outline" title={title}>{label}</Button>} />;
    return <Box css={styles.agendaCard} data-allocation-row-card={row.key} data-kind={row.kind} data-draft={draft ? "" : undefined} data-selected={selected ? "" : undefined}>
        <chakra.button type="button" css={styles.agendaCardHead} aria-pressed={selected}
            onClick={() => props.select(row.bin !== undefined ? { type: "bin", id: row.bin } : { type: "slot", lane: row.lane, at: row.slotAt.getTime() })}>
            <Box css={styles.agendaCardTitle}>{lane} · {time}</Box>
            <Box css={styles.agendaLine}>{holds}</Box>
            {where !== undefined && <Box css={styles.agendaLine} data-tone={parts.length === 0 ? "warning" : undefined}>{where}</Box>}
            {unallocated && <Box css={styles.agendaLine} data-tone="warning">{board.quantity(remainder, unit)} unallocated</Box>}
            <Box as="span" css={styles.agendaStatus} data-status={status}><Box as="span" css={styles.tableStatusDot} />{status}</Box>
        </chakra.button>
        {props.editable && <Box css={styles.agendaActions}>
            {row.kind !== "bin" && chooser("event", "Book…", undefined, row.kind === "reserved" ? `Book ${a(nouns.event)} into the reservation` : `Book ${a(nouns.event)} into ${lane} ${time}`)}
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
                    title={committed !== undefined ? `Remove ${code} from the plan · it moves to ${nouns.event.other}` : `Return ${code} to ${nouns.event.other}`}>
                    Back to {nouns.event.other}
                </Button>
            </>}
        </Box>}
    </Box>;
}
