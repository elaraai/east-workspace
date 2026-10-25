/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Library (`Allocation Spec.md` §8, A50–A54, A83, A87, #1330, #1372): the
 * start pane's two shared Library tabs, Arrivals and Resources, each with its
 * count and its search. Arrivals are grouped Overdue · Ready around now ·
 * Removed from plan · Allocated; Resources by the day's states, Free · Loading · Busy today, the
 * shared Library's groups. Each tab follows the rail (A98, A99, #1339): its
 * source's narrowing shows its cards as it shows the board's rows, its count
 * `10 of 33`; every filter is the rail's, and a tab has none of its own. Each card is the shared compact card with the
 * board's figure, its ready line, its look and its tooltip; under the cards the
 * foot's hint, and the picked card's action. A card drags as a board's grip
 * does (§10), and a click picks it (A9, A10). Collapsed, the rail: the open
 * tab's count, the overdue mark, the label. A Find a fit's result (A74,
 * #1332) is the Resources tab's: the resources the app's fit says take the
 * bin's unallocated quantity, among what the rail shows, best first, each
 * card's line the fit's reason, under a chip that clears it — the tab's, not
 * a filter, so the rail and the board stay as they are (A98).
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, type KeyboardEvent, type PointerEvent } from "react";
import { Box, Button } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faInbox } from "@fortawesome/free-solid-svg-icons";
import { none, some, type SortedMap } from "@elaraai/east";
import {
    EastChakraLibrary, useFormatters, type BuilderFrameDock, type LibraryCardExtras, type LibraryGroupMark, type LibraryItemValue, type LibraryNarrowing,
} from "@elaraai/east-ui-components";
import { SliceFieldChip, formatDatePattern, narrowedCount } from "@elaraai/east-ui-components/internal";
import { scheduleLibrary, scheduleLibraryCard } from "../shared/schedule/library.js";
import { sourceTab, type SourceShown } from "../shared/schedule/source-tab.js";
import type { AllocationCommands } from "./actions.js";
import { arrivalCardKey, libraryGripOf, type AllocationDrag, type LibraryGrip, type Target, type Verdict } from "./drag.js";
import {
    allocationWords, compareDate, compareFloat, compareString, partsOf, type AllocationStyles, type AllocationValue, type Bin, type Context, type Day, type FitResult,
    type Load, type ResourceLine, type Selection, type TimeStep,
} from "./model.js";
import { a, one, other, type Nouns } from "./nouns.js";

/** A day, in milliseconds. */
const DAY_MS = 86_400_000;

/** What the viewer picked in the Library (A9, A10): a card to book or reserve, or an arrival whose bins it highlights. */
export type Pick = LibraryGrip | { kind: "bins"; arrival: string };

/** The Arrivals groups, in order (A51). */
export const ARRIVAL_GROUPS = ["Overdue", "Ready around now", "Removed from plan", "Allocated"] as const;
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

/** One Arrivals card (A51): what it shows, and what a click or a drag does with it. */
export interface ArrivalCard {
    /** Its key in the Arrivals list: `arrival:LD-2231`, or `removed:3113`. */
    key: string;
    group: (typeof ARRIVAL_GROUPS)[number];
    /** The arrival's key. */
    arrival: string;
    /** A card that drags: an arrival to book, or a removed bin to book again. */
    grip: Extract<LibraryGrip, { kind: "arrival" | "removed" }> | undefined;
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
const subOf = (meta: AllocationValue["arrivals"][number]["meta"] | undefined, hold: TimeStep) =>
    [meta?.type === "some" ? meta.value : "", holdText(hold)].filter(part => part !== "").join(" · ");

/**
 * The Arrivals cards (A51), in their groups' order: the arrivals still to
 * book — Overdue (due before the plan day), then Ready around now — each with
 * its ready line; the day's committed bins the drafts removed (Removed from
 * plan, `was B-1 06:15 on K-203`); and the arrivals the day books (Allocated,
 * `in B-1 06:15 on K-203` or `2 bins · …`), the draft bookings first, then by
 * their first bin's time.
 *
 * @param args - The day as drafted and as the record holds it, and the words
 * @returns The cards, in order
 */
export function arrivalCards(args: { context: Context; day: Date; plan: Day; held: Day | undefined; words: LibraryWords }): ArrivalCard[] {
    const { context, day, plan, held, words } = args;
    const { lane, resource } = words.nouns;
    const onto = words.layout === "table" ? "a free row" : `${a(lane)} hour or ${a(resource)}`;
    const booked = new Map<string, string[]>();
    for (const [id, bin] of plan.bins) {
        if (bin.arrival.type !== "some") continue;
        booked.set(bin.arrival.value, [...(booked.get(bin.arrival.value) ?? []), id]);
    }
    // The day's committed bins with an arrival that the drafts removed.
    const removed = [...(held?.bins ?? [])].filter(([id, bin]) => bin.arrival.type === "some" && !plan.bins.has(id));
    const removedArrivals = new Set(removed.map(([, bin]) => bin.arrival.type === "some" ? bin.arrival.value : ""));
    const overdue = (key: string) => { const due = context.arrivals.get(key)?.due; return due?.type === "some" && compareDate(due.value, day) < 0; };
    const readyOf = (key: string): ArrivalCard["ready"] => {
        const arrival = context.arrivals.get(key)!;
        const due = arrival.due.type === "some" ? arrival.due.value : undefined;
        if (due !== undefined && compareDate(due, day) < 0) return { text: `was due ${formatDatePattern("ddd D", due)} · overdue`, tone: "warning" };
        const window = arrival.window.type === "some" ? arrival.window.value : undefined;
        const parts = [due === undefined ? "" : `due ${formatDatePattern("ddd D", due)}`,
            window === undefined ? "" : `window ${formatDatePattern("ddd", window.from)}–${formatDatePattern("ddd", new Date(window.to.getTime() - 1))}`].filter(p => p !== "");
        return parts.length === 0 ? undefined : { text: parts.join(" · ") };
    };
    const toBook = [...context.arrivals.keys()].filter(key => !booked.has(key) && !removedArrivals.has(key));
    const cards: ArrivalCard[] = [];
    for (const late of [true, false]) {
        for (const key of toBook.filter(k => overdue(k) === late)) {
            const arrival = context.arrivals.get(key)!;
            cards.push({ key: arrivalCardKey({ kind: "arrival", arrival: key }), group: late ? "Overdue" : "Ready around now", arrival: key, grip: { kind: "arrival", arrival: key },
                bins: [], draft: false, label: arrival.label, figure: words.quantity(arrival.quantity), sub: subOf(arrival.meta, arrival.hold), ready: readyOf(key),
                tip: `Click to see where ${arrival.label} fits · drag it onto ${onto}`, search: `${arrival.label} ${arrival.meta.type === "some" ? arrival.meta.value : ""}` });
        }
    }
    for (const [id, bin] of removed) {
        const key = bin.arrival.type === "some" ? bin.arrival.value : "";
        const arrival = context.arrivals.get(key);
        const label = arrival?.label ?? key;
        cards.push({ key: arrivalCardKey({ kind: "removed", bin: id }), group: "Removed from plan", arrival: key, grip: { kind: "removed", bin: id }, bins: [id], draft: false,
            label, figure: words.quantity(bin.quantity), sub: subOf(arrival?.meta, bin.hold), ready: { text: `was ${whereOf(context, words, bin)}` },
            tip: `Click to see where it fits · drag ${label} back onto ${a(lane)} hour or ${a(resource)}`, search: `${label} ${arrival?.meta.type === "some" ? arrival.meta.value : ""}` });
    }
    const allocated = [...booked].map(([key, ids]) => {
        const bins = ids.map(id => ({ id, bin: plan.bins.get(id)! })).sort((x, y) => compareDate(x.bin.at, y.bin.at) || compareString(x.id, y.id));
        return { key, bins, draft: bins.every(b => held?.bins.has(b.id) !== true) };
    }).sort((x, y) => Number(y.draft) - Number(x.draft) || (x.draft ? 0 : compareDate(x.bins[0]!.bin.at, y.bins[0]!.bin.at)) || compareString(x.key, y.key));
    for (const { key, bins, draft } of allocated) {
        const arrival = context.arrivals.get(key);
        const label = arrival?.label ?? key;
        const where = bins.map(b => whereOf(context, words, b.bin));
        const unlinked = bins.some(b => b.bin.parts.size === 0);
        cards.push({ key: arrivalCardKey({ kind: "arrival", arrival: key }), group: "Allocated", arrival: key, grip: undefined, bins: bins.map(b => b.id), draft,
            label, figure: words.quantity(bins.reduce((n, b) => n + b.bin.quantity, 0)), sub: subOf(arrival?.meta, bins[0]!.bin.hold),
            ready: { text: bins.length > 1 ? `${bins.length} bins · ${where.join(" · ")}` : `in ${where[0]}`, ...(unlinked ? { tone: "warning" as const } : {}) },
            tip: draft ? "Allocated · click to show its bin" : `In the plan · click to highlight ${bins.length > 1 ? `its ${bins.length} bins` : "its bin"}`,
            search: `${label} ${arrival?.meta.type === "some" ? arrival.meta.value : ""}` });
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

/** A Find a fit's result in the Resources tab (A74): its bin, the chip's words, the fit's answer, and whether that answer is on its way. */
export interface ResourceFind {
    /** The bin it finds a fit for. */
    bin: string;
    /** What it finds a fit for, as the chip says it: `LD-2210 · 4 m³`. */
    label: string;
    /** The fit's answer for the drafts as they are, which the tab shows; `undefined` while it is on its way, or failed. */
    shown: FitResult | undefined;
    /** Whether that answer is on its way: the tab is busy, showing what the rail shows, and no verdict (F2). */
    busy: boolean;
}

/**
 * The resources a fit's answer says fit, best first — its scores, ties kept in
 * the tab's order: the fit ranks, never the board (F4).
 *
 * @param cards - The cards the rail shows, in the tab's order
 * @param answer - The fit's answer
 * @returns The cards that fit, best first
 */
export function foundCards<C extends { key: string }>(cards: readonly C[], answer: FitResult): C[] {
    const scored = cards.flatMap(card => { const verdict = answer.resources.get(card.key); return verdict?.type === "fits" ? [{ card, score: verdict.value.score }] : []; });
    return scored.sort((a, b) => compareFloat(b.score, a.score)).map(fit => fit.card);
}

/** A found card's line (A74): the fit's reason, its warning after it in the warning's tone; its tooltip the whole, which a narrow card cuts. */
function reasonOf(answer: FitResult, card: ResourceCard): LibraryCardExtras | undefined {
    const verdict = answer.resources.get(card.key);
    if (verdict?.type !== "fits") return undefined;
    const { why, warn } = verdict.value;
    const text = warn.type === "some" ? `${why} · ${warn.value}` : why;
    return { title: text, figure: card.figure, note: warn.type === "some" ? { text, tone: "warning" } : { text } };
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
    onArrival: (grip: Extract<LibraryGrip, { kind: "arrival" | "removed" }>) => void;
    /** A click on a resource's card (A9): it picks it for the selected free slot, or selects it. */
    onResource: (resource: string) => void;
    /** A click on an Allocated card (A10): its first bin selected, every bin of it highlighted. */
    onAllocated: (arrival: string, bins: readonly string[]) => void;
    /** The picked card's action ran its verdict: what it refused, if anything. */
    onVerdict: (verdict: Verdict) => void;
    /** The open tab, the host's: Find a fit opens Resources (A74). */
    tab: string;
    onTab: (tab: string) => void;
    /** What the rail shows of each tab's source: the arrivals' and the resources'. */
    shown: { arrivals: SourceShown; resources: SourceShown };
    /** A Find a fit's result, shown in the Resources tab until its chip clears it (A74). */
    find?: ResourceFind | undefined;
    onClearFind?: (() => void) | undefined;
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
    const arrivals = useMemo(() => arrivalCards({ context, day, plan, held, words }), [context, day, plan, held, words]);
    const resources = useMemo(() => resourceCards({ resources: value.resources, plan, loads, lines, words }), [value.resources, plan, loads, lines, words]);
    // What each tab's source shows (A98, A99): an arrival's cards in every group while its source shows it, a resource's while its source does;
    // each tab's count, what it says when its source empties it, with that source's Clear filters, and its busy pane.
    const { shown } = args;
    const format = useFormatters();
    const arrivalTab = useMemo(() => sourceTab({ cards: arrivals, keyOf: card => card.arrival, shown: shown.arrivals, noun: other(nouns.arrival), words: format }),
        [arrivals, shown.arrivals, nouns.arrival, format]);
    const resourceTab = useMemo(() => sourceTab({ cards: resources, keyOf: card => card.key, shown: shown.resources, noun: other(nouns.resource), words: format }),
        [resources, shown.resources, nouns.resource, format]);
    const shownArrivals = arrivalTab.cards, shownResources = resourceTab.cards;
    // A Find a fit's result (A74): the fits among what the rail shows, best first. Until its answer for the drafts as they are
    // lands, the tab shows what the rail shows, busy, and no verdict (F2).
    const find = args.find, answer = find?.shown;
    const found = useMemo(() => answer === undefined ? undefined : foundCards(shownResources, answer), [answer, shownResources]);
    const listedResources = found ?? shownResources;
    const editable = commands.canEdit();
    const draggable = drag.enabled && !narrow;
    const selectedArrival = selection?.type === "bin" ? plan.bins.get(selection.id)?.arrival : undefined;

    // The cards: the shared face, with the board's figure, ready line, look, tooltip and × beside it.
    const arrivalItems = useMemo(() => shownArrivals.map((card): LibraryItemValue => {
        const placed = card.grip !== undefined
            ? pick !== undefined && pick.kind === card.grip.kind && arrivalCardKey(card.grip) === (pick.kind === "arrival" || pick.kind === "removed" ? arrivalCardKey(pick) : "")
            : (pick?.kind === "bins" && pick.arrival === card.arrival) || (selectedArrival?.type === "some" && selectedArrival.value === card.arrival);
        return scheduleLibraryCard({ key: card.key, label: card.label, sublabel: card.sub === "" ? none : some(card.sub), icon: none, status: none, trailing: none,
            draggable: draggable && card.grip !== undefined, filtered: false, placed, search: some(card.search), groups: new Map([["group", card.group]]) });
    }), [shownArrivals, pick, selectedArrival, draggable]);
    const resourceItems = useMemo(() => listedResources.map((card): LibraryItemValue => scheduleLibraryCard({
        key: card.key, label: card.label, sublabel: card.sub === "" ? none : some(card.sub), icon: none, status: none, trailing: none, draggable, filtered: false,
        placed: (selection?.type === "resource" && selection.key === card.key) || (pick?.kind === "resource" && pick.resource === card.key),
        search: some(card.search), groups: new Map([["group", card.group]]),
    })), [listedResources, selection, pick, draggable]);
    const unbook = commands.unbook;
    const arrivalExtras = useMemo(() => {
        const byKey = new Map(arrivals.map((card): [string, LibraryCardExtras] => [card.key, {
            title: card.tip, figure: card.figure, ...(card.ready === undefined ? {} : { note: card.ready }),
            ...(card.group === "Removed from plan" ? { look: "dashed" as const } : card.group === "Allocated" ? { look: "sunken" as const } : {}),
            ...(card.draft && editable ? { remove: { label: `Return ${card.label} to the list`, onRemove: () => unbook(card.arrival) } } : {}),
        }]));
        return (item: LibraryItemValue) => byKey.get(item.key);
    }, [arrivals, editable, unbook]);
    // A found card's line is the fit's reason (A74); every other card's, its line today.
    const resourceExtras = useMemo(() => {
        const byKey = new Map(resources.map((card): [string, LibraryCardExtras] => [card.key,
            (answer === undefined ? undefined : reasonOf(answer, card)) ?? { title: card.tip, figure: card.figure, note: card.line }]));
        return (item: LibraryItemValue) => byKey.get(item.key);
    }, [resources, answer]);
    const overdueMark = useCallback((label: string): LibraryGroupMark | undefined => label === "Overdue" ? { icon: "triangle-exclamation", label: "Overdue", tone: "warning" } : undefined, []);

    // A card's click (A9, A10).
    const { onArrival, onResource, onAllocated } = args;
    const arrivalClick = useCallback((key: string): null => {
        const card = arrivals.find(c => c.key === key);
        if (card === undefined) return null;
        if (card.grip !== undefined) onArrival(card.grip); else onAllocated(card.arrival, card.bins);
        return null;
    }, [arrivals, onArrival, onAllocated]);
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
        if (pick?.kind === "arrival" || pick?.kind === "removed") {
            const card = arrivals.find(c => c.grip !== undefined && arrivalCardKey(c.grip) === arrivalCardKey(pick));
            if (card === undefined) return undefined;
            if (selection?.type === "slot") {
                const at = new Date(selection.at);
                return { note: `${card.label} · ${card.figure} · then choose its ${one(nouns.resource)}`,
                    button: { label: `Book into ${slot(selection.lane, at)}`, disabled: false, grip: pick, target: { kind: "lane", lane: selection.lane, at, card: undefined } } };
            }
            const reservation = selection?.type === "bin" ? plan.bins.get(selection.id) : undefined;
            if (selection?.type === "bin" && reservation !== undefined && reservation.arrival.type === "none") {
                const target: Target = { kind: "lane", lane: reservation.lane, at: reservation.at, card: selection.id };
                const resource = [...reservation.parts.keys()][0];
                const name = resource === undefined ? "" : context.resources.get(resource)?.label ?? resource;
                const verdict = drag.peek(pick, target);
                const button = { label: `Book into ${slot(reservation.lane, reservation.at)}`, grip: pick, target };
                if (verdict.pending) return { note: "checking fits…", button: { ...button, disabled: true } };
                if (!verdict.allowed) return { note: `Doesn’t fit ${name}: ${verdict.reason ?? verdict.caption}`, tone: "warning", button: { ...button, disabled: true } };
                return { note: resource === undefined ? `${card.label} · ${card.figure}` : `Reserved on ${name}${verdict.reason === undefined ? "" : ` · ${verdict.reason}`}`, button: { ...button, disabled: false } };
            }
            return { note: layout === "table" ? `Click a highlighted ${one(nouns.arrival)} cell to book ${card.label} there, or select a free slot first.`
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
    }, [editable, pick, selection, arrivals, plan, layout, nouns, words, context, drag.peek]);
    // Its question, asked once the pane has rendered, and again when the drafts change or the arrivals and resources it reads (F1).
    const asking = action?.button;
    const { verdict } = drag;
    useEffect(() => { if (asking !== undefined) verdict(asking.grip, asking.target); },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [asking?.label, asking?.grip, plan, context]);
    const { onVerdict } = args;
    const runAction = () => { if (asking === undefined || asking.disabled) return; onVerdict(drag.verdict(asking.grip, asking.target)); };

    if (value.library.length === 0) return undefined;
    // The foot's hint, the tab's and the layout's (A53).
    const hint = (tab: "arrivals" | "resources") => narrow ? `Select ${a(nouns.arrival)}, then Book`
        : tab === "arrivals" ? (layout === "table" ? `Drag onto a row’s ${one(nouns.arrival)} cell` : `Drag onto ${a(nouns.lane)} hour or ${a(nouns.resource)}`)
            : (layout === "table" ? `Drag onto a row’s ${one(nouns.resource)} cell` : `Drag onto a bin or an empty ${one(nouns.lane)} hour`);
    // A tab its source reads again holds its cards retained (#1398, CL8): its action waits until it lands.
    const feet = (tab: "arrivals" | "resources") => <>
        <Box css={[styles.paneFoot, styles.paneHint]} data-allocation-library-hint="">{hint(tab)}</Box>
        {action !== undefined && <Box css={[styles.paneFoot, styles.paneAction]} data-allocation-library-action="">
            <Box as="span" css={styles.paneHint} data-tone={action.tone}>{action.note}</Box>
            {action.button !== undefined && <Button size="xs" variant="outline" onClick={runAction}
                disabled={action.button.disabled || (tab === "arrivals" ? arrivalTab : resourceTab).pane["aria-disabled"] === true}>
                <FontAwesomeIcon icon={faInbox} />{action.button.label}
            </Button>}
        </Box>}
    </>;
    const tabs = value.library.map(tab => {
        if (tab.type === "arrivals") {
            const library = scheduleLibrary({ id: drag.libraries.arrivals, items: arrivalItems, groupOptions: [{ key: "group", label: "Group" }],
                noun: some({ singular: one(nouns.arrival), plural: other(nouns.arrival) }), onCardClick: some(arrivalClick) }, true);
            return { key: "arrivals", label: nouns.arrival.other, count: arrivalTab.count,
                body: <Box css={styles.pane} data-allocation-library="arrivals" {...arrivalTab.pane}
                onPointerDownCapture={arm(drag.libraries.arrivals)} onKeyDownCapture={arm(drag.libraries.arrivals)}>
                <EastChakraLibrary value={library} storageKey={drag.libraries.arrivals} extras={arrivalExtras} groupMark={overdueMark}
                    search={`Find ${a(nouns.arrival)} or site`} empty={arrivalTab.empty} narrowing={arrivalTab.narrowing}
                    noMatch={{ title: `No ${other(nouns.arrival)} match`, description: `Clear the search to see all ${shownArrivals.length} ${other(nouns.arrival)}.` }} />
                {feet("arrivals")}
            </Box> };
        }
        const library = scheduleLibrary({ id: drag.libraries.resources, items: resourceItems, groupOptions: [{ key: "group", label: "Group" }],
            noun: some({ singular: one(nouns.resource), plural: other(nouns.resource) }), onCardClick: some(resourceClick) }, true);
        // A find counts its fits of every resource; with none that fit, it says so — its chip, not Clear filters, clears it — unless
        // the rail left the tab nothing, which the rail's Clear filters clears.
        const count = found === undefined ? resourceTab.count : narrowedCount(format, found.length, resources.length, true);
        const narrowing: LibraryNarrowing | undefined = found === undefined || resourceTab.narrowing?.emptied === true ? resourceTab.narrowing
            : { empty: { title: `No ${one(nouns.resource)} has a gap that fits`, description: `Clear the find to see the ${other(nouns.resource)} the rail shows.` }, emptied: found.length === 0 };
        const pane = find?.busy === true ? { ...resourceTab.pane, "aria-busy": true as const } : resourceTab.pane;
        return { key: "resources", label: nouns.resource.other, count,
            body: <Box css={styles.pane} data-allocation-library="resources" {...pane}
            onPointerDownCapture={arm(drag.libraries.resources)} onKeyDownCapture={arm(drag.libraries.resources)}>
            {/* Pressed, the chip clears the find: its name says so, its face what the find is for (A74). */}
            {find !== undefined && args.onClearFind !== undefined && <Box css={styles.paneFoot} data-allocation-find="">
                <SliceFieldChip label={`Find · ${find.label}`} aria-label={`Clear find · ${find.label}`} active removeLabel="Clear find" onRemove={args.onClearFind} onClick={args.onClearFind} />
            </Box>}
            {/* Grouped by the day's states; every filter is the rail's (ruled 18 Oct): the tab has its search, and no filter of its own. */}
            <EastChakraLibrary value={library} storageKey={drag.libraries.resources} extras={resourceExtras} search={`Find ${a(nouns.resource)} or group`} empty={resourceTab.empty}
                narrowing={narrowing}
                noMatch={{ title: `No ${other(nouns.resource)} match`, description: `Clear the search to see all ${listedResources.length} ${other(nouns.resource)}.` }} />
            {feet("resources")}
        </Box> };
    });
    const open = args.tab === "resources" && tabs.some(t => t.key === "resources") ? "resources" : tabs[0]!.key;
    const late = shownArrivals.some(card => card.group === "Overdue");
    return {
        label: "Library", icon: "layer-group", size: "264px", tabs, tab: open, onTabChange: args.onTab, persist: "local",
        badge: open === "resources" ? listedResources.length : shownArrivals.length,
        ...(open === "arrivals" && late ? { mark: { icon: "triangle-exclamation", label: `Overdue ${one(nouns.arrival)}`, tone: "warning" as const } } : {}),
    };
}
