/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What the Plan's footer counts of its event kinds (#1193, PB23): the events
 * in the window, the backlog, and when a kind's record was last saved — read
 * from the kinds' own seams, every kind's drafts in
 * place, and read again when a record they read commits. The inspector shows
 * them too when nothing is selected, with how long the events run (#1197,
 * PB41).
 *
 * The same read finds the overlaps among the window's events (#1198, PB51):
 * two events of a kind that warns of them, on one resource at once — what the
 * toolbar's chip counts, the inspector's banner lists, and each event in a
 * pair wears a warn ring for. A kind whose overlaps are allowed is never in a
 * pair. It reads the backlog the library's Backlog tab lists, too (#1196).
 *
 * The read runs in a component of its own, {@link PlanKindsReader}, beside
 * what the rail hides of the backlog (#1344): a kind narrowed through an
 * interval index lands some fifty-five key searches a window, and each would
 * otherwise render the whole frame. It hands the frame what it read only when
 * that moves.
 *
 * The backlog never blinks (#1398, ruled 25 Oct 2026): its last complete read
 * and what the rail hides of it, counted with it, are held as one, as the
 * Calendar's are. While a narrowing's, a window's or a revision's read of
 * either is in flight they stand in, retained (CL8), and once both have landed
 * they are swapped whole — never a count dropped, never a count shown over
 * another read's cards. Every figure of the backlog is the held read's: the
 * Backlog tab's cards and count, the rail's badge, the footer's and the
 * inspector's.
 *
 * A kind the viewer hides in the Series tab is no part of what the canvas
 * shows: it is in none of the window's figures — its events, their hours,
 * their overlaps — and nothing says so; its backlog is the Backlog tab's
 * still, which lists it.
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { DateTimeType, SortedMap, StringType, compareFor, equalFor, none, some, type ValueTypeOf } from "@elaraai/east";
import { planHideId, type PlanEventDraftsType, type PlanPayloadType } from "@elaraai/e3-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { useBacklogNarrowing, type BacklogNarrowing } from "../../shared/schedule/backlog.js";
import { scheduleWithinCap, type ScheduleCellsRead } from "../../shared/schedule/cells.js";
import { scheduleOverlaps, type ScheduleOverlaps } from "../../shared/schedule/overlaps.js";
import { eventReadRange } from "../root/events.js";
import type { PlanEventPart } from "../root/sources.js";
import type { PlanScale } from "../scale.js";
import { NONE_HIDDEN, hides } from "./hidden.js";

/** One event kind, as the Plan's payload carries it (#1190). */
export type PlanEventKindValue = ValueTypeOf<typeof PlanPayloadType>["events"][number];

/** One event as Plan draws it, as a kind's `planItems` reads it. */
export type PlanEventItemValue = Extract<ReturnType<PlanEventKindValue["planItems"]>, { type: "some" }>["value"][number];

/** The overlaps among the window's events (#1198). */
export type PlanOverlaps = ScheduleOverlaps<PlanEventItemValue>;

/** One unscheduled event, with the kind it is of: a card of the Backlog tab. */
export interface PlanBacklogEntry {
    readonly kind: PlanEventKindValue;
    readonly item: PlanEventItemValue;
}

/** What the footer counts of the event kinds. */
export interface PlanEventCounts {
    /**
     * The events in the window of every kind the viewer shows but those not counted (`uncounted`) — a kind given cells
     * counted exactly, from its source, as the rail counts it, or in memory, its record read whole (#1039); `undefined`
     * where no kind's are counted: every kind shown among `uncounted`, or none shown.
     */
    readonly events: number | undefined;
    /**
     * The kinds shown whose events in the window are not counted (#1039): past the cap, and counted only by the days
     * its events run on — a day index's — which is no number of them. None of their events is read, and none is in
     * `events` or `minutes`.
     */
    readonly uncounted: readonly PlanEventKindValue[];
    /**
     * The kinds shown whose events in the window are counted, but not their hours (#1039): past the cap, counted
     * exactly — through their source, or in memory — and none of their events read, so none of their hours is in
     * `minutes`.
     */
    readonly hoursNotCounted: readonly PlanEventKindValue[];
    /**
     * How long the events read run, in minutes — a month counting 30 days, as a kind counts it; `undefined` where no
     * kind's hours are read, every kind shown past the cap or none shown.
     */
    readonly minutes: number | undefined;
    /**
     * Whether a kind read by its cells counts its hours and its overlaps over the rows drawn (#1039): it reads only the
     * events of the resources around the rows in view, so the inspector says its hours are those in view.
     */
    readonly drawn: boolean;
    /** The unscheduled events — every backlog kind's; `undefined` when no kind has a backlog. */
    readonly backlog: number | undefined;
    /** The newest commit to any kind's record; `undefined` while there is none. */
    readonly saved: Date | undefined;
    /** The overlaps among the events in the window: two events of a kind that warns of them, on one resource at once (#1198, PB51). */
    readonly overlaps: PlanOverlaps;
    /** The unscheduled events, every backlog kind's, in the kinds' order: the Backlog tab's cards (#1196). */
    readonly unscheduled: readonly PlanBacklogEntry[];
}

/** The event kinds' counts as {@link usePlanEventCounts} reads them, and whether a read of them is in flight. */
export interface PlanEventCountsRead {
    /** The counts — the last read's while a read is in flight or failed; `undefined` for a Plan without event kinds, or before the first read answers. */
    readonly counts: PlanEventCounts | undefined;
    /** Whether a read is in flight: `counts` stands in for it meanwhile. */
    readonly reading: boolean;
}

/** One kind's drafts, by entry id, as its seams take them. */
type KindDrafts = Parameters<PlanEventKindValue["planItems"]>[2];

/** Every kind's drafts, by kind then by entry id. */
type EventDrafts = ValueTypeOf<typeof PlanEventDraftsType>;

/** No drafts: what a kind holds none of. */
const NO_DRAFTS: KindDrafts = new SortedMap([], compareFor(StringType));
const NONE_DRAFTED: EventDrafts = new SortedMap([], compareFor(StringType));
const compareDateTime = compareFor(DateTimeType);
const stringEqual = equalFor(StringType);
/** No event kind narrowed through a source of the slice. */
const NO_PARTS: readonly PlanEventPart[] = [];

/** A read whose kinds are still in flight: the counts stand as they were. */
const READING = "reading";

/** A `time` instant's epoch ms; `undefined` for an instant of another arm. */
function timeMs(t: PlanScale["window"]["min"]): number | undefined {
    return t.type === "time" ? t.value.getTime() : undefined;
}

/**
 * The event kinds' counts over the window the canvas shows, every kind's
 * drafts in place (#1194). A kind read by its cells (#1039) never reads the
 * window: its events are counted exactly from its source, as the rail counts
 * them, its hours and its overlaps over the events its cells hold, and its
 * backlog read alone. A kind past the cap draws none, and none of its events
 * is read: it is counted exactly — through its source, or in memory, its record
 * read whole — but not its hours (`hoursNotCounted`), and one counted through
 * its day index, whose count is the days its events run on, no number of them,
 * is not counted at all (`uncounted`). Every other kind — each is counted
 * before it is read — is read over the window only once its count over the
 * range the canvas reads — the count the cells' reader decides by — is within
 * the cap; past it the last counts stand until the reader gives it no cells,
 * so no event of a range past the cap is read. A kind the viewer hides is in
 * no figure of the window, and its window is not read for them; its backlog
 * and its last save are counted still.
 *
 * @param kinds - The Plan's event kinds; `undefined` or none for a Plan without them
 * @param scale - The shared scale: the window the events are counted over
 * @param drafts - Every kind's drafts, by kind then by entry id — the same object while they hold; none for a Plan whose kinds hold none
 * @param cells - The kinds' cells and counts, when the reader decides a kind: what it draws from, its drafts as the seams take them, which counted kinds are read over the window, and which are past the cap
 * @param parts - Each event kind narrowed through its source of the slice: what a kind given cells is counted through
 * @param hidden - The ids the viewer hides in the Series tab: a kind hidden there is in no figure of the window
 * @returns The counts — the last read's while a read is in flight or fails; `undefined` for a Plan without event kinds, or before the first read answers — and whether a read is in flight
 */
export function usePlanEventCounts(
    kinds: readonly PlanEventKindValue[] | undefined, scale: PlanScale | undefined, drafts: EventDrafts = NONE_DRAFTED,
    cells?: ScheduleCellsRead | undefined, parts: readonly PlanEventPart[] = NO_PARTS, hidden: readonly string[] = NONE_HIDDEN,
): PlanEventCountsRead {
    const from = scale !== undefined ? timeMs(scale.window.min) : undefined;
    const to = scale !== undefined ? timeMs(scale.window.max) : undefined;
    // The range the canvas reads, the window's and the periods it lays out beyond each edge: what a kind is capped over.
    const range = eventReadRange(scale);
    const readFrom = range?.from.getTime();
    const readTo = range?.to.getTime();
    const active = kinds !== undefined && kinds.length > 0;
    const read = useCallback((): PlanEventCounts | typeof READING | undefined => {
        if (kinds === undefined || kinds.length === 0 || from === undefined || to === undefined || readFrom === undefined || readTo === undefined) return undefined;
        let events = 0;
        let counted = false;
        let minutes = 0;
        let hoursCounted = false;
        let backlog: number | undefined;
        let saved: Date | undefined;
        let drawn = false;
        const unscheduled: PlanBacklogEntry[] = [];
        const uncounted: PlanEventKindValue[] = [];
        const hoursNotCounted: PlanEventKindValue[] = [];
        // Each kind that warns of its overlaps: two of its events are a pair (PB51).
        const warned: (readonly PlanEventItemValue[])[] = [];
        for (const kind of kinds) {
            // Hidden in the Series tab: no part of what the canvas shows, so in no figure of the window.
            const shown = !hides(hidden, planHideId.events(kind.key));
            // A kind given cells: from what they hold, its drafts as the seams take them (#1039).
            const held = cells?.reads.get(kind.key);
            // Every kind is counted before it is read: given no cells, it is read over the window once its count over the
            // range the canvas reads is within the cap — past it, or in flight, the last counts stand.
            if (shown && held === undefined) {
                const within = scheduleWithinCap(kind.count, new Date(readFrom), new Date(readTo));
                if (within.type !== "some" || !within.value) return READING;
            }
            const read = held === undefined ? none : some(held);
            const drafted = (held === undefined ? drafts : cells!.drafts).get(kind.key) ?? NO_DRAFTS;
            if (shown) {
                const items = kind.planItems(new Date(from), new Date(to), drafted, read);
                if (items.type === "none") return READING;
                if (kind.overlaps.type === "warn") warned.push(items.value);
                if (held === undefined) {
                    events += items.value.length;
                    counted = true;
                    for (const item of items.value) minutes += Number(item.minutes);
                    hoursCounted = true;
                } else {
                    const part = parts.find((p) => stringEqual(p.kind.key, kind.key))?.part;
                    // Past the cap (#1039): none of its events is read, so none of its hours — said so, never counted as none.
                    const capped = cells!.capped.has(kind.key);
                    // Read by its cells, before they have landed once: its hours are not known yet, never 0 (#1398, CL13).
                    if (!capped && !cells!.held.has(kind.key)) return READING;
                    if (capped && part === undefined && !kind.countExact) {
                        // Counted through its day index: the days its events run on are no number of them — not counted.
                        uncounted.push(kind);
                    } else {
                        // Its events in the window, exactly: its source's count, as the rail counts it — its record read
                        // whole, counted in memory.
                        const inWindow = part !== undefined ? part.count() : kind.count(new Date(from), new Date(to));
                        if (inWindow.type !== "some") return READING;
                        events += Number(inWindow.value);
                        counted = true;
                        if (capped) {
                            hoursNotCounted.push(kind);
                        } else {
                            // Read by its cells: its hours over the rows drawn.
                            for (const item of items.value) minutes += Number(item.minutes);
                            hoursCounted = true;
                            drawn = true;
                        }
                    }
                }
            }
            if (kind.backlog) {
                const waiting = kind.planUnscheduled(new Date(from), new Date(to), drafted, read);
                if (waiting.type === "none") return READING;
                backlog = (backlog ?? 0) + waiting.value.length;
                for (const item of waiting.value) unscheduled.push({ kind, item });
            }
            const commits = kind.history();
            const newest = commits.type === "some" ? commits.value[0]?.at : undefined;
            if (newest !== undefined && (saved === undefined || compareDateTime(newest, saved) > 0)) saved = newest;
        }
        return {
            events: counted ? events : undefined, uncounted, hoursNotCounted, minutes: hoursCounted ? minutes : undefined, drawn, backlog, saved,
            overlaps: scheduleOverlaps(warned), unscheduled,
        };
    }, [kinds, from, to, readFrom, readTo, drafts, cells, parts, hidden]);
    const { result } = useTrackedEvaluation(read);
    // The last counts read, held while a read is in flight or failed.
    const held = useRef<PlanEventCounts | undefined>(undefined);
    const counts = useMemo(() => {
        if (!active) {
            held.current = undefined;
            return undefined;
        }
        if (!result.ok) {
            console.error("[Plan] the event kinds could not be counted:", result.error);
            return held.current;
        }
        if (result.value === READING || result.value === undefined) return held.current;
        held.current = result.value;
        return result.value;
    }, [active, result]);
    const reading = active && result.ok && result.value === READING;
    return useMemo(() => ({ counts, reading }), [counts, reading]);
}

/** What {@link PlanKindsReader} reads: the counts, and what the rail hides of the backlog — the backlog's held as one. */
export interface PlanKindsRead {
    /**
     * The event kinds' counts over the window; `undefined` before the first read answers. Their backlog — its cards
     * and how many there are — is the held read's, swapped together with what the rail hides of it (`backlog`).
     */
    readonly counts: PlanEventCounts | undefined;
    /** What the rail hides of the backlog (#1344): the held read's, counted with its cards. */
    readonly backlog: BacklogNarrowing<PlanEventPart>;
    /** Whether the backlog stands in for a read in flight (#1398, CL8) — its cards' or its count's: retained. */
    readonly retained: boolean;
}

/**
 * The backlog's last complete read (#1398): its cards, how many there are, and what the rail hides of them, counted
 * then — held as one, so the cards and the count are swapped together.
 */
interface HeldBacklog {
    readonly unscheduled: readonly PlanBacklogEntry[];
    readonly backlog: number | undefined;
    readonly narrowing: BacklogNarrowing<PlanEventPart>;
}

/** Props of {@link PlanKindsReader}. */
export interface PlanKindsReaderProps {
    /** The Plan's event kinds. */
    kinds: readonly PlanEventKindValue[];
    /** The shared scale: the window the events are counted over. */
    scale: PlanScale | undefined;
    /** Every kind's drafts. */
    drafts: EventDrafts | undefined;
    /** Each event kind narrowed through its source of the slice. */
    parts: readonly PlanEventPart[];
    /** The kinds' cells and counts (#1039), when the reader decides a kind. */
    cells: ScheduleCellsRead | undefined;
    /** The ids the viewer hides in the Series tab: a kind hidden there is in no figure of the window. */
    hidden: readonly string[];
    /** Where what it read goes: called only when that moves. */
    onRead: (read: PlanKindsRead) => void;
}

/**
 * The event kinds' counts, and what the rail hides of the backlog, read in a
 * component of its own (see the module docs).
 *
 * @param props - What is read, over what, and where it goes
 * @returns Nothing: it reads
 */
export function PlanKindsReader({ kinds, scale, drafts, parts, cells, hidden, onRead }: PlanKindsReaderProps): null {
    const { counts: read, reading } = usePlanEventCounts(kinds, scale, drafts, cells, parts, hidden);
    const narrowing = useBacklogNarrowing(parts);
    // The backlog never blinks (#1398, ruled 25 Oct 2026): its cards, read with the counts, and what the rail hides of
    // them, held as one — taken as both land: the first read's at once, its count to follow, as the Calendar's are.
    const held = useRef<HeldBacklog | undefined>(undefined);
    const last = held.current;
    if (read !== undefined && !reading && (!narrowing.counting || last === undefined)
        && (last === undefined || last.unscheduled !== read.unscheduled || last.narrowing !== narrowing)) {
        held.current = { unscheduled: read.unscheduled, backlog: read.backlog, narrowing };
    }
    const shown = held.current;
    // A backlog kind read through its source reads its backlog again with its window and its choices: what stands in
    // meanwhile is retained (CL8).
    const rereads = useMemo(() => parts.some(({ kind }) => kind.backlog), [parts]);
    const retained = shown !== undefined && rereads && (reading || narrowing.counting);
    // Every figure of the backlog is the held read's: the tab's, the rail's badge, the footer's and the inspector's.
    const counts = useMemo(() => (read === undefined || shown === undefined || read.unscheduled === shown.unscheduled ? read
        : { ...read, unscheduled: shown.unscheduled, backlog: shown.backlog }), [read, shown]);
    const backlog = shown?.narrowing ?? narrowing;
    const reported = useRef<PlanKindsRead | undefined>(undefined);
    useLayoutEffect(() => {
        const was = reported.current;
        // The same counts, the same narrowing and the same standing, by identity — each holds while what it read holds.
        if (was !== undefined && Object.is(was.counts, counts) && Object.is(was.backlog, backlog) && was.retained === retained) return;
        const next = { counts, backlog, retained };
        reported.current = next;
        onRead(next);
    });
    return null;
}
