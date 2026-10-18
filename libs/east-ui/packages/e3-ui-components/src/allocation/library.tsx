/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Library (`Allocation Spec.md` §8, A50–A54, A83, A87, #1330): the start
 * pane's two shared Library tabs, Events and Resources, each with its count and
 * its search. Events are grouped Overdue · Ready around now · Removed from plan
 * · Allocated; Resources by the day's states, Free · Loading · Busy today, the
 * shared Library's groups. Each tab follows the rail (A98, A99, #1339): its
 * source's narrowing shows its cards as it shows the board's rows, its count
 * `10 of 33`; every filter is the rail's, and a tab has none of its own. Each card is the shared compact card with the
 * board's figure, its ready line, its look and its tooltip; under the cards the
 * foot's hint, and the picked card's action. A card drags as a board's grip
 * does (§10), and a click picks it (A9, A10). Collapsed, the rail: the open
 * tab's count, the overdue mark, the label.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, type KeyboardEvent, type PointerEvent } from "react";
import { Box, Button } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faInbox } from "@fortawesome/free-solid-svg-icons";
import { none, some, type SortedMap } from "@elaraai/east";
import { EastChakraLibrary, useFormatters, type BuilderFrameDock, type LibraryCardExtras, type LibraryGroupMark, type LibraryItemValue } from "@elaraai/east-ui-components";
import { formatDatePattern } from "@elaraai/east-ui-components/internal";
import { scheduleLibrary, scheduleLibraryCard } from "../shared/schedule/library.js";
import { sourceTab, type SourceShown } from "../shared/schedule/source-tab.js";
import type { AllocationCommands } from "./actions.js";
import { eventCardKey, libraryGripOf, type AllocationDrag, type LibraryGrip, type Target, type Verdict } from "./drag.js";
import {
    allocationWords, compareDate, compareString, partsOf, type AllocationStyles, type AllocationValue, type Bin, type Context, type Day, type Load, type ResourceLine,
    type Selection, type TimeStep,
} from "./model.js";
import { a, one, other, type Nouns } from "./nouns.js";

/** A day, in milliseconds. */
const DAY_MS = 86_400_000;

/** What the viewer picked in the Library (A9, A10): a card to book or reserve, or an event whose bins it highlights. */
export type Pick = LibraryGrip | { kind: "bins"; event: string };

/** The Events groups, in order (A51). */
export const EVENT_GROUPS = ["Overdue", "Ready around now", "Removed from plan", "Allocated"] as const;
/** The Resources groups: the day's states, in order (A52). */
export const RESOURCE_GROUPS = { free: "Free today", loading: "Loading today", busy: "Busy today" } as const;

/** A duration's unit as a card writes it: `8 d`. */
const UNIT = { minutes: "min", hours: "h", days: "d", weeks: "wk", months: "mo" } as const;

/**
 * A hold as a card writes it.
 *
 * @param step - The hold
 * @returns `8 d`, `12 h`
 */
export function holdText(step: TimeStep): string {
    return allocationWords().quantity(step.value, UNIT[step.type]);
}

/** One Events card (A51): what it shows, and what a click or a drag does with it. */
export interface EventCard {
    /** Its key in the Events list: `event:LD-2231`, or `removed:3113`. */
    key: string;
    group: (typeof EVENT_GROUPS)[number];
    /** The event's key. */
    event: string;
    /** A card that drags: an event to book, or a removed bin to book again. */
    grip: Extract<LibraryGrip, { kind: "event" | "removed" }> | undefined;
    /** An Allocated card's bins, in time order. */
    bins: string[];
    /** An Allocated card whose every bin is a draft: its × returns it (A51). */
    draft: boolean;
    label: string;
    /** Its quantity: `21 m³`. */
    figure: string;
    /** Its meta and its hold: `BRK · R2 · spec MC12 · 8 d`. */
    sub: string;
    /** Its ready line, in warn when it is overdue or a bin of it is not linked. */
    ready: { text: string; tone?: "warning" | undefined } | undefined;
    /** Its tooltip (A83). */
    tip: string;
    /** What the search finds it by. */
    search: string;
}

/** What the Library's cards are written from. */
export interface LibraryWords {
    nouns: Nouns;
    layout: "timeline" | "table";
    /** A lane's label. */
    lane: (key: string) => string;
    /** A quantity with the board's unit, and without. */
    quantity: (value: number) => string;
    number: (value: number) => string;
}

/** A bin's place, as a card says it: `B-1 06:15 on K-203`, `K-203 + 1` for a split bin, `· not linked` with none. */
function whereOf(context: Context, words: LibraryWords, bin: Bin): string {
    const parts = partsOf(bin);
    const first = parts[0] === undefined ? undefined : context.resources.get(parts[0].key)?.label ?? parts[0].key;
    return `${words.lane(bin.lane)} ${formatDatePattern("HH:mm", bin.at)}${first === undefined ? " · not linked" : ` on ${first}${parts.length > 1 ? ` + ${parts.length - 1}` : ""}`}`;
}

/** A card's second line: its meta, then its hold. */
const subOf = (meta: AllocationValue["events"][number]["meta"] | undefined, hold: TimeStep) =>
    [meta?.type === "some" ? meta.value : "", holdText(hold)].filter(part => part !== "").join(" · ");

/**
 * The Events cards (A51), in their groups' order: the events still to book —
 * Overdue (due before the plan day), then Ready around now — each with its
 * ready line; the day's committed bins the drafts removed (Removed from plan,
 * `was B-1 06:15 on K-203`); and the events the day books (Allocated, `in B-1
 * 06:15 on K-203` or `2 bins · …`), the draft bookings first, then by their
 * first bin's time.
 *
 * @param args - The day as drafted and as the record holds it, and the words
 * @returns The cards, in order
 */
export function eventCards(args: { context: Context; day: Date; plan: Day; held: Day | undefined; words: LibraryWords }): EventCard[] {
    const { context, day, plan, held, words } = args;
    const { lane, resource } = words.nouns;
    const onto = words.layout === "table" ? "a free row" : `${a(lane)} hour or ${a(resource)}`;
    const booked = new Map<string, string[]>();
    for (const [id, bin] of plan.bins) {
        if (bin.event.type !== "some") continue;
        booked.set(bin.event.value, [...(booked.get(bin.event.value) ?? []), id]);
    }
    // The day's committed bins with an event that the drafts removed.
    const removed = [...(held?.bins ?? [])].filter(([id, bin]) => bin.event.type === "some" && !plan.bins.has(id));
    const removedEvents = new Set(removed.map(([, bin]) => bin.event.type === "some" ? bin.event.value : ""));
    const overdue = (key: string) => { const due = context.events.get(key)?.due; return due?.type === "some" && compareDate(due.value, day) < 0; };
    const readyOf = (key: string): EventCard["ready"] => {
        const event = context.events.get(key)!;
        const due = event.due.type === "some" ? event.due.value : undefined;
        if (due !== undefined && compareDate(due, day) < 0) return { text: `was due ${formatDatePattern("ddd D", due)} · overdue`, tone: "warning" };
        const window = event.window.type === "some" ? event.window.value : undefined;
        const parts = [due === undefined ? "" : `due ${formatDatePattern("ddd D", due)}`,
            window === undefined ? "" : `window ${formatDatePattern("ddd", window.from)}–${formatDatePattern("ddd", new Date(window.to.getTime() - 1))}`].filter(p => p !== "");
        return parts.length === 0 ? undefined : { text: parts.join(" · ") };
    };
    const toBook = [...context.events.keys()].filter(key => !booked.has(key) && !removedEvents.has(key));
    const cards: EventCard[] = [];
    for (const late of [true, false]) {
        for (const key of toBook.filter(k => overdue(k) === late)) {
            const event = context.events.get(key)!;
            cards.push({ key: eventCardKey({ kind: "event", event: key }), group: late ? "Overdue" : "Ready around now", event: key, grip: { kind: "event", event: key },
                bins: [], draft: false, label: event.label, figure: words.quantity(event.quantity), sub: subOf(event.meta, event.hold), ready: readyOf(key),
                tip: `Click to see where ${event.label} fits · drag it onto ${onto}`, search: `${event.label} ${event.meta.type === "some" ? event.meta.value : ""}` });
        }
    }
    for (const [id, bin] of removed) {
        const key = bin.event.type === "some" ? bin.event.value : "";
        const event = context.events.get(key);
        const label = event?.label ?? key;
        cards.push({ key: eventCardKey({ kind: "removed", bin: id }), group: "Removed from plan", event: key, grip: { kind: "removed", bin: id }, bins: [id], draft: false,
            label, figure: words.quantity(bin.quantity), sub: subOf(event?.meta, bin.hold), ready: { text: `was ${whereOf(context, words, bin)}` },
            tip: `Click to see where it fits · drag ${label} back onto ${a(lane)} hour or ${a(resource)}`, search: `${label} ${event?.meta.type === "some" ? event.meta.value : ""}` });
    }
    const allocated = [...booked].map(([key, ids]) => {
        const bins = ids.map(id => ({ id, bin: plan.bins.get(id)! })).sort((x, y) => compareDate(x.bin.at, y.bin.at) || compareString(x.id, y.id));
        return { key, bins, draft: bins.every(b => held?.bins.has(b.id) !== true) };
    }).sort((x, y) => Number(y.draft) - Number(x.draft) || (x.draft ? 0 : compareDate(x.bins[0]!.bin.at, y.bins[0]!.bin.at)) || compareString(x.key, y.key));
    for (const { key, bins, draft } of allocated) {
        const event = context.events.get(key);
        const label = event?.label ?? key;
        const where = bins.map(b => whereOf(context, words, b.bin));
        const unlinked = bins.some(b => b.bin.parts.size === 0);
        cards.push({ key: eventCardKey({ kind: "event", event: key }), group: "Allocated", event: key, grip: undefined, bins: bins.map(b => b.id), draft,
            label, figure: words.quantity(bins.reduce((n, b) => n + b.bin.quantity, 0)), sub: subOf(event?.meta, bins[0]!.bin.hold),
            ready: { text: bins.length > 1 ? `${bins.length} bins · ${where.join(" · ")}` : `in ${where[0]}`, ...(unlinked ? { tone: "warning" as const } : {}) },
            tip: draft ? "Allocated · click to show its bin" : `In the plan · click to highlight ${bins.length > 1 ? `its ${bins.length} bins` : "its bin"}`,
            search: `${label} ${event?.meta.type === "some" ? event.meta.value : ""}` });
    }
    return cards;
}

/** One Resources card (A52). */
export interface ResourceCard {
    key: string;
    group: (typeof RESOURCE_GROUPS)[keyof typeof RESOURCE_GROUPS];
    label: string;
    /** What it takes: `20–40 m³`. */
    figure: string;
    /** Its meta, or its group. */
    sub: string;
    /** Its line today, over max in danger, held into its next job in warn. */
    line: { text: string; tone?: "warning" | "danger" | undefined };
    tip: string;
    search: string;
}

/**
 * The Resources cards (A52), grouped by the day's states — free, then loading
 * (by their first bin's time), then busy — each its line: `31 m³ today · to Tue
 * 18` with `· 4 m³ over` or `· 1 d into next job`, `busy until Fri 14`, `free ·
 * next job Wed 19`, `free · no next job`.
 *
 * @param args - Every resource, its load and its line, the drafts, and the words
 * @returns The cards, in order
 */
export function resourceCards(args: {
    resources: AllocationValue["resources"]; plan: Day; loads: SortedMap<string, Load>; lines: ReadonlyMap<string, ResourceLine>; words: LibraryWords;
}): ResourceCard[] {
    const { resources, plan, loads, lines, words } = args;
    const { lane, resource: noun } = words.nouns;
    const onto = words.layout === "table" ? `a row’s ${one(noun)} cell` : `a bin or an empty ${one(lane)} hour`;
    // Each resource's first bin today: the loading ones' order.
    const first = new Map<string, Date>();
    for (const [, bin] of plan.bins) {
        for (const key of bin.parts.keys()) { const was = first.get(key); if (was === undefined || compareDate(bin.at, was) < 0) first.set(key, bin.at); }
    }
    const cardOf = (resource: AllocationValue["resources"][number]): ResourceCard => {
        const load = loads.get(resource.key)!, line = lines.get(resource.key)!;
        const hold = load.hold.type === "some" ? load.hold.value : undefined;
        let text: string, tone: ResourceCard["line"]["tone"];
        if (load.state.type === "loading") {
            const over = line.over ? ` · ${words.quantity(Math.round(load.fill - resource.max))} over` : "";
            const into = !line.over && line.overlap && line.next.type === "some" && hold !== undefined
                ? ` · ${words.number((hold.to.getTime() - line.next.value.start.getTime()) / DAY_MS)} d into next job` : "";
            text = `${words.quantity(Math.round(load.fill))} today${hold === undefined ? "" : ` · to ${formatDatePattern("ddd D", new Date(hold.to.getTime() - 1))}`}${over}${into}`;
            tone = line.over ? "danger" : line.overlap ? "warning" : undefined;
        } else if (load.state.type === "busy") text = line.text;
        else text = line.next.type === "some" ? `free · next job ${formatDatePattern("ddd D", line.next.value.start)}` : "free · no next job";
        const meta = resource.meta.type === "some" ? resource.meta.value : resource.group.type === "some" ? resource.group.value : "";
        return { key: resource.key, group: RESOURCE_GROUPS[load.state.type], label: resource.label, figure: `${words.number(resource.min)}–${words.quantity(resource.max)}`,
            sub: meta, line: { text, ...(tone === undefined ? {} : { tone }) }, tip: `Click to highlight its bins · drag ${resource.label} onto ${onto}`,
            search: `${resource.label} ${meta} ${resource.group.type === "some" ? resource.group.value : ""}` };
    };
    const state = (r: AllocationValue["resources"][number]) => loads.get(r.key)!.state.type;
    const loading = resources.filter(r => state(r) === "loading")
        .map((r, i) => ({ r, i })).sort((x, y) => compareDate(first.get(x.r.key) ?? new Date(0), first.get(y.r.key) ?? new Date(0)) || x.i - y.i).map(x => x.r);
    return [...resources.filter(r => state(r) === "free"), ...loading, ...resources.filter(r => state(r) === "busy")].map(cardOf);
}

/** The Library's args. */
export interface LibraryArgs {
    value: AllocationValue;
    context: Context;
    day: Date;
    plan: Day;
    held: Day | undefined;
    loads: SortedMap<string, Load>;
    lines: ReadonlyMap<string, ResourceLine>;
    styles: AllocationStyles;
    layout: "timeline" | "table";
    narrow: boolean;
    drag: AllocationDrag;
    commands: AllocationCommands;
    selection: Selection | undefined;
    pick: Pick | undefined;
    /** A click on a card to book (A9): it picks it, or unpicks it. */
    onEvent: (grip: Extract<LibraryGrip, { kind: "event" | "removed" }>) => void;
    /** A click on a resource's card (A9): it picks it for the selected free slot, or selects it. */
    onResource: (resource: string) => void;
    /** A click on an Allocated card (A10): its first bin selected, every bin of it highlighted. */
    onAllocated: (event: string, bins: readonly string[]) => void;
    /** The picked card's action ran its verdict: what it refused, if anything. */
    onVerdict: (verdict: Verdict) => void;
    /** The open tab, the host's: Find a fit opens Resources (A74). */
    tab: string;
    onTab: (tab: string) => void;
    /** What the rail shows of each tab's source: the events' and the resources'. */
    shown: { events: SourceShown; resources: SourceShown };
}

/** The picked card's action (A53, A87): its note, and its button. */
interface Action { note: string; tone?: "warning" | undefined; button?: { label: string; disabled: boolean; target: Target; grip: LibraryGrip } | undefined }

/**
 * The start pane (see the module docs).
 *
 * @param args - See {@link LibraryArgs}
 * @returns The pane, or `undefined` when the board has no Library
 */
export function useAllocationLibrary(args: LibraryArgs): BuilderFrameDock | undefined {
    const { value, context, day, plan, held, loads, lines, styles, layout, narrow, drag, commands, selection, pick, nouns } = { ...args, nouns: args.value.labels };
    const board = allocationWords();
    const unit = context.unit;
    const words = useMemo((): LibraryWords => ({
        nouns, layout, lane: key => value.lanes.find(l => l.key === key)?.label ?? key, quantity: v => board.quantity(v, unit), number: v => board.quantity(v, ""),
    }), [nouns, layout, value.lanes, board, unit]);
    const events = useMemo(() => eventCards({ context, day, plan, held, words }), [context, day, plan, held, words]);
    const resources = useMemo(() => resourceCards({ resources: value.resources, plan, loads, lines, words }), [value.resources, plan, loads, lines, words]);
    // What each tab's source shows (A98, A99): an event's cards in every group while its source shows it, a resource's while its source does;
    // each tab's count, what it says when its source empties it, with that source's Clear filters, and its busy pane.
    const { shown } = args;
    const format = useFormatters();
    const eventTab = useMemo(() => sourceTab({ cards: events, keyOf: card => card.event, shown: shown.events, noun: other(nouns.event), words: format }),
        [events, shown.events, nouns.event, format]);
    const resourceTab = useMemo(() => sourceTab({ cards: resources, keyOf: card => card.key, shown: shown.resources, noun: other(nouns.resource), words: format }),
        [resources, shown.resources, nouns.resource, format]);
    const shownEvents = eventTab.cards, shownResources = resourceTab.cards;
    const editable = commands.canEdit();
    const draggable = drag.enabled && !narrow;
    const selectedEvent = selection?.type === "bin" ? plan.bins.get(selection.id)?.event : undefined;

    // The cards: the shared face, with the board's figure, ready line, look, tooltip and × beside it.
    const eventItems = useMemo(() => shownEvents.map((card): LibraryItemValue => {
        const placed = card.grip !== undefined
            ? pick !== undefined && pick.kind === card.grip.kind && eventCardKey(card.grip) === (pick.kind === "event" || pick.kind === "removed" ? eventCardKey(pick) : "")
            : (pick?.kind === "bins" && pick.event === card.event) || (selectedEvent?.type === "some" && selectedEvent.value === card.event);
        return scheduleLibraryCard({ key: card.key, label: card.label, sublabel: card.sub === "" ? none : some(card.sub), icon: none, status: none, trailing: none,
            draggable: draggable && card.grip !== undefined, filtered: false, placed, search: some(card.search), groups: new Map([["group", card.group]]) });
    }), [shownEvents, pick, selectedEvent, draggable]);
    const resourceItems = useMemo(() => shownResources.map((card): LibraryItemValue => scheduleLibraryCard({
        key: card.key, label: card.label, sublabel: card.sub === "" ? none : some(card.sub), icon: none, status: none, trailing: none, draggable, filtered: false,
        placed: (selection?.type === "resource" && selection.key === card.key) || (pick?.kind === "resource" && pick.resource === card.key),
        search: some(card.search), groups: new Map([["group", card.group]]),
    })), [shownResources, selection, pick, draggable]);
    const unbook = commands.unbook;
    const eventExtras = useMemo(() => {
        const byKey = new Map(events.map((card): [string, LibraryCardExtras] => [card.key, {
            title: card.tip, figure: card.figure, ...(card.ready === undefined ? {} : { note: card.ready }),
            ...(card.group === "Removed from plan" ? { look: "dashed" as const } : card.group === "Allocated" ? { look: "sunken" as const } : {}),
            ...(card.draft && editable ? { remove: { label: `Return ${card.label} to the list`, onRemove: () => unbook(card.event) } } : {}),
        }]));
        return (item: LibraryItemValue) => byKey.get(item.key);
    }, [events, editable, unbook]);
    const resourceExtras = useMemo(() => {
        const byKey = new Map(resources.map((card): [string, LibraryCardExtras] => [card.key, { title: card.tip, figure: card.figure, note: card.line }]));
        return (item: LibraryItemValue) => byKey.get(item.key);
    }, [resources]);
    const overdueMark = useCallback((label: string): LibraryGroupMark | undefined => label === "Overdue" ? { icon: "triangle-exclamation", label: "Overdue", tone: "warning" } : undefined, []);

    // A card's click (A9, A10).
    const { onEvent, onResource, onAllocated } = args;
    const eventClick = useCallback((key: string): null => {
        const card = events.find(c => c.key === key);
        if (card === undefined) return null;
        if (card.grip !== undefined) onEvent(card.grip); else onAllocated(card.event, card.bins);
        return null;
    }, [events, onEvent, onAllocated]);
    const resourceClick = useCallback((key: string): null => { onResource(key); return null; }, [onResource]);

    // A card's pointer-down or its pick-up key arms its grip: the fit is asked before the drag needs it (A23).
    const arm = (library: string) => (event: PointerEvent | KeyboardEvent) => {
        if (!draggable || ("key" in event && event.key !== " " && event.key !== "Enter")) return;
        const key = (event.target as Element).closest?.("[data-library-item]")?.getAttribute("data-library-item");
        const grip = key === null || key === undefined ? undefined : libraryGripOf(drag.libraries, { library, key });
        if (grip !== undefined) drag.arm(grip);
    };

    // The picked card's action (A53, A87): its question asked, its verdict peeked while the pane renders.
    const action = useMemo((): Action | undefined => {
        if (!editable) return undefined;
        const slot = (laneKey: string, at: Date) => `${words.lane(laneKey)} ${formatDatePattern("HH:mm", at)}`;
        if (pick?.kind === "event" || pick?.kind === "removed") {
            const card = events.find(c => c.grip !== undefined && eventCardKey(c.grip) === eventCardKey(pick));
            if (card === undefined) return undefined;
            if (selection?.type === "slot") {
                const at = new Date(selection.at);
                return { note: `${card.label} · ${card.figure} · then choose its ${one(nouns.resource)}`,
                    button: { label: `Book into ${slot(selection.lane, at)}`, disabled: false, grip: pick, target: { kind: "lane", lane: selection.lane, at, card: undefined } } };
            }
            const reservation = selection?.type === "bin" ? plan.bins.get(selection.id) : undefined;
            if (selection?.type === "bin" && reservation !== undefined && reservation.event.type === "none") {
                const target: Target = { kind: "lane", lane: reservation.lane, at: reservation.at, card: selection.id };
                const resource = [...reservation.parts.keys()][0];
                const name = resource === undefined ? "" : context.resources.get(resource)?.label ?? resource;
                const verdict = drag.peek(pick, target);
                const button = { label: `Book into ${slot(reservation.lane, reservation.at)}`, grip: pick, target };
                if (verdict.pending) return { note: "checking fits…", button: { ...button, disabled: true } };
                if (!verdict.allowed) return { note: `Doesn’t fit ${name}: ${verdict.reason ?? verdict.caption}`, tone: "warning", button: { ...button, disabled: true } };
                return { note: resource === undefined ? `${card.label} · ${card.figure}` : `Reserved on ${name}${verdict.reason === undefined ? "" : ` · ${verdict.reason}`}`, button: { ...button, disabled: false } };
            }
            return { note: layout === "table" ? `Click a highlighted ${one(nouns.event)} cell to book ${card.label} there, or select a free slot first.`
                : `Click a free ${one(nouns.lane)} hour or a ranked ${one(nouns.resource)} to book ${card.label} there, or select a free slot first.` };
        }
        if (pick?.kind === "resource" && selection?.type === "slot") {
            const at = new Date(selection.at);
            const target: Target = { kind: "lane", lane: selection.lane, at, card: undefined };
            const name = context.resources.get(pick.resource)?.label ?? pick.resource;
            const verdict = drag.peek(pick, target);
            const button = { label: `Reserve ${slot(selection.lane, at)} on ${name}`, grip: pick, target };
            if (verdict.pending) return { note: "checking fits…", button: { ...button, disabled: true } };
            if (!verdict.allowed) return { note: `Can’t: ${verdict.reason ?? verdict.caption}`, tone: "warning", button: { ...button, disabled: true } };
            return { note: verdict.reason ?? "", button: { ...button, disabled: false } };
        }
        return undefined;
        // The verdict stands for the pick, the selection, these drafts and the fit's answers.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editable, pick, selection, events, plan, layout, nouns, words, context, drag.peek]);
    // Its question, asked once the pane has rendered.
    const asking = action?.button;
    const { verdict } = drag;
    useEffect(() => { if (asking !== undefined) verdict(asking.grip, asking.target); },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [asking?.label, asking?.grip, plan]);
    const { onVerdict } = args;
    const runAction = () => { if (asking === undefined || asking.disabled) return; onVerdict(drag.verdict(asking.grip, asking.target)); };

    if (value.library.length === 0) return undefined;
    // The foot's hint, the tab's and the layout's (A53).
    const hint = (tab: "events" | "resources") => narrow ? `Select ${a(nouns.event)}, then Book`
        : tab === "events" ? (layout === "table" ? `Drag onto a row’s ${one(nouns.event)} cell` : `Drag onto ${a(nouns.lane)} hour or ${a(nouns.resource)}`)
            : (layout === "table" ? `Drag onto a row’s ${one(nouns.resource)} cell` : `Drag onto a bin or an empty ${one(nouns.lane)} hour`);
    const feet = (tab: "events" | "resources") => <>
        <Box css={[styles.paneFoot, styles.paneHint]} data-allocation-library-hint="">{hint(tab)}</Box>
        {action !== undefined && <Box css={[styles.paneFoot, styles.paneAction]} data-allocation-library-action="">
            <Box as="span" css={styles.paneHint} data-tone={action.tone}>{action.note}</Box>
            {action.button !== undefined && <Button size="xs" variant="outline" disabled={action.button.disabled} onClick={runAction}>
                <FontAwesomeIcon icon={faInbox} />{action.button.label}
            </Button>}
        </Box>}
    </>;
    const tabs = value.library.map(tab => {
        if (tab.type === "events") {
            const library = scheduleLibrary({ id: drag.libraries.events, items: eventItems, groupOptions: [{ key: "group", label: "Group" }],
                noun: some({ singular: one(nouns.event), plural: other(nouns.event) }), onCardClick: some(eventClick) }, true);
            return { key: "events", label: nouns.event.other, count: eventTab.count,
                body: <Box css={styles.pane} data-allocation-library="events" {...eventTab.pane}
                onPointerDownCapture={arm(drag.libraries.events)} onKeyDownCapture={arm(drag.libraries.events)}>
                <EastChakraLibrary value={library} storageKey={drag.libraries.events} extras={eventExtras} groupMark={overdueMark}
                    search={`Find ${a(nouns.event)} or site`} empty={eventTab.empty} narrowing={eventTab.narrowing}
                    noMatch={{ title: `No ${other(nouns.event)} match`, description: `Clear the search to see all ${shownEvents.length} ${other(nouns.event)}.` }} />
                {feet("events")}
            </Box> };
        }
        const library = scheduleLibrary({ id: drag.libraries.resources, items: resourceItems, groupOptions: [{ key: "group", label: "Group" }],
            noun: some({ singular: one(nouns.resource), plural: other(nouns.resource) }), onCardClick: some(resourceClick) }, true);
        return { key: "resources", label: nouns.resource.other, count: resourceTab.count,
            body: <Box css={styles.pane} data-allocation-library="resources" {...resourceTab.pane}
            onPointerDownCapture={arm(drag.libraries.resources)} onKeyDownCapture={arm(drag.libraries.resources)}>
            {/* Grouped by the day's states; every filter is the rail's (ruled 18 Oct): the tab has its search, and no filter of its own. */}
            <EastChakraLibrary value={library} storageKey={drag.libraries.resources} extras={resourceExtras} search={`Find ${a(nouns.resource)} or group`} empty={resourceTab.empty}
                narrowing={resourceTab.narrowing}
                noMatch={{ title: `No ${other(nouns.resource)} match`, description: `Clear the search to see all ${shownResources.length} ${other(nouns.resource)}.` }} />
            {feet("resources")}
        </Box> };
    });
    const open = args.tab === "resources" && tabs.some(t => t.key === "resources") ? "resources" : tabs[0]!.key;
    const late = shownEvents.some(card => card.group === "Overdue");
    return {
        label: "Library", icon: "layer-group", size: "264px", tabs, tab: open, onTabChange: args.onTab, persist: "local",
        badge: open === "resources" ? shownResources.length : shownEvents.length,
        ...(open === "events" && late ? { mark: { icon: "triangle-exclamation", label: `Overdue ${one(nouns.event)}`, tone: "warning" as const } } : {}),
    };
}
