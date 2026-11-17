/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The event kinds' drag and drop (#1196, `Plan Builder Spec.md` §9.7, §10,
 * PB31–PB37, PB63): where a drag of the event kinds' — a template, a backlog
 * event, an element on the canvas, an author's card — lands, what its ghost
 * says there, and the one step of the Plan's history its drop records.
 *
 * - **Where.** An event kind's row stands for a resource — a landing row of a
 *   resources series or a kinds case, the record's own row (#1541), or the row
 *   beside it for a further way its kinds draw (`<landing>.<draw>`), at the
 *   resource's path (`../root/landings.ts`) — or for a kind's events on none,
 *   its Unassigned row (`<kind>.unassigned`). A
 *   template or a backlog card lands at the bucket under the pointer, an
 *   element where its row's landing put it (`store.ts`), and an author's card
 *   on the event under the pointer.
 * - **The verdict**, asked where the drag rests and again of the drop: the
 *   kind takes a gesture now; it lands on the row's series (or, on its own
 *   Unassigned row, takes none); the row draws that kind; its own `write` takes the gesture;
 *   and the Plan's `canDrop` lets land what the drop would do (`Plan.Types.Candidate`, #1541 U7). The
 *   first refusal is what the ghost says, in red: `Needs presses`, or
 *   `canDrop`'s message. Allowed, the ghost says what lands where:
 *   `Brochure run · Press A1 · Mon, Oct 12, 2026`.
 * - **The gestures**, each one step of the Plan's one history through the
 *   recorder (`events.ts`): a template's drop `create`s an event of its kind
 *   under a new key (`mint`) — from the template's `at` on a day or longer —
 *   for the template's duration, and selects it; a backlog card's drop
 *   `place`s its event there for its own duration; an element's move or
 *   resize `place`s its event, writing the resource field across rows — a
 *   selected element moving the selection with it, by the same units, the
 *   events on its resource onto the row's; an element dropped on the Backlog
 *   tab is `unplace`d, where its kind's times are Options; and an author's
 *   card dropped on an event of its patch's kind sets each field the patch
 *   sets (`field`), in one step.
 *
 * Its answers read the latest kinds, drafts and selection, and are kept per
 * question until any of them moves: a drag resting over a bucket asks the
 * kind's `write` and `canDrop` once. An event is read as the kinds' editing
 * reads it ({@link PlanEventEditing.read}) — for a kind read a window at a
 * time (#1199), among the rows the canvas holds, where the event dragged is
 * drawn — and a resource is named by its landing row on the canvas: the row
 * the drag rests on, or the one beside it, which the same window holds.
 *
 * @packageDocumentation
 */

import { useMemo, useRef } from "react";
import { DateTimeType, OptionType, StringType, equalFor, none, some, variant, type ValueTypeOf, type option } from "@elaraai/east";
import { ScheduleResourceRefType, type PlanPayloadType, type planKeys } from "@elaraai/e3-ui/internal";
import { parseEventRef, printEventRef } from "../../shared/schedule/event-ref.js";
import { getSomeorUndefined, type DragEventValue, type Origin } from "@elaraai/east-ui-components";
import { durationMinutes } from "../../shared/schedule/due.js";
import { moveSpan } from "../../shared/time/drag.js";
import { backlogLibrary, eventsLibrary, tabLibrary } from "../frame/library.js";
import { instantKey, timeInstant } from "../instant.js";
import { rowKeyOf, type PlanRowId, type PlanRowValue } from "../model.js";
import type { RowKey } from "../plan-state.js";
import { kindRowId, landingRowId, landingTargetOf, type PlanLandingValue } from "../root/landings.js";
import type { PlanRowMove } from "../rows/SpanRow.js";
import type { PlanScale } from "../scale.js";
import { fromPlanSlot } from "../slot.js";
import type { PlanWords } from "../words.js";
import type { PlanEventChange, PlanEventEditing, PlanEventGestureValue, PlanEventReadValue } from "./events.js";
import type { PlanEditStore, PlanMovable, PlanProposal, PlanSpan } from "./store.js";
import { originOf, unmoved, type PlanMoveRequest } from "./use-carry.js";
import { eventCandidate, type PlanCandidatePlace, type PlanCandidateValue, type PlanVeto } from "./candidate.js";
import type { ConnectVetoOf } from "../../shared/links/veto.js";
import { connectLink, linkStepLabel, type PlanLinkKindValue } from "../links/kinds.js";

type PlanPayloadValue = ValueTypeOf<typeof PlanPayloadType>;
/** One event kind, as the payload carries it. */
type PlanEventKindValue = PlanPayloadValue["events"][number];
/** One of the library's tabs, as the payload carries it. */
type PlanLibraryTabValue = PlanPayloadValue["library"][number];
/** An author's tab. */
type PlanAuthorTabValue = Extract<PlanLibraryTabValue, { type: "tab" }>["value"];
/** The resource an event is on, if it is. */
type PlanResourceOption = option<ValueTypeOf<typeof ScheduleResourceRefType>>;
/** The names a Plan keeps its viewer's state under. */
type PlanKeys = ReturnType<typeof planKeys>;

/** The item type an event kind's element carries: a row takes it by the event's kind, never by an item type, and no printed type reads so. */
export const PLAN_EVENT_ITEMS = "#event";

/** What a row of the event kinds' stands for. */
export type PlanEventTarget =
    /** A resource: the series it is a row of, its key's text, the row's path to it, and the way the row draws. */
    | { readonly kind: "resource"; readonly slot: string; readonly key: string; readonly path: readonly string[]; readonly draw: string }
    /** An event kind's events on no resource: its slot, and the way the row draws. */
    | { readonly kind: "unassigned"; readonly event: string; readonly draw: string };

/** The event kinds' verdict over a drop where a drag rests. */
export interface PlanEventVerdict {
    /** Whether it lands. */
    readonly allowed: boolean;
    /** What the ghost says: what lands where, or — refused — why not; `undefined`, nothing. */
    readonly caption: string | undefined;
    /** The extent it lands at, or lands on — what the row's landing band spans. */
    readonly span: PlanSpan | undefined;
}

/**
 * What Connect draws while its tool is held (#1541, U10): the link kind its menu chose, and the Plan's veto over a
 * connection, asked by the kind's slot and the two events' keys on the canvas.
 */
export interface PlanConnecting {
    /** The link kind Connect draws. */
    readonly kind: PlanLinkKindValue;
    /** The Plan's `canConnect`, as its routes ask it: its words refusing a pair, or `undefined` allowing it. */
    readonly veto: ConnectVetoOf;
}

/** The event kinds' drag and drop, as the canvas's rows, its drop target and its carry ask it — see the module docs. */
export interface PlanEventDrop {
    /** The libraries whose cards the event kinds take: the Events tab's, the Backlog tab's, and each author's tab's with a `drop` or a `create`. */
    readonly libraries: readonly string[];
    /** The Backlog tab's library: where an element returns to be unscheduled. */
    readonly backlog: string;
    /**
     * Whether Connect is held (#1541, U10): an element's drag draws a link to the event under the pointer, in place of
     * moving it, and no element is resized.
     */
    readonly connecting: boolean;
    /**
     * What a row stands for.
     *
     * @param row - The row
     * @returns Its resource, or its kind's events on none; `undefined` for a row no event kind draws on
     */
    target(row: PlanRowValue): PlanEventTarget | undefined;
    /**
     * How a row's elements move: an event kind's row's, by their events.
     *
     * @param row - The row
     * @returns Its elements' moves — a bar's and a chip's with their ends; `undefined` for no event kind's row
     */
    rowMove(row: PlanRowValue): PlanRowMove | undefined;
    /**
     * Whether an element is an event kind's.
     *
     * @param movable - The element
     */
    isEvent(movable: PlanMovable): boolean;
    /**
     * Whether a row draws an element's kind — its resource's row of the way the
     * kind draws, or the kind's own Unassigned row: where the keyboard carries it.
     *
     * @param row - The row
     * @param movable - The element
     */
    drawsKind(row: PlanRowValue, movable: PlanMovable): boolean;
    /**
     * Whether a row of the event kinds' takes a card of a library at all.
     *
     * @param library - The card's library
     */
    takesCard(library: string): boolean;
    /**
     * Whether a card of a library lands on the event under the pointer, rather than at a bucket: an author's card with a `drop`.
     *
     * @param library - The card's library
     */
    landsOnEvent(library: string): boolean;
    /**
     * A row's resource by name, as the ghost and the announcements say it.
     *
     * @param row - The row
     * @returns Its resource's name, or `Unassigned`; `undefined` for no event kind's row
     */
    where(row: PlanRowValue): string | undefined;
    /**
     * The verdict over a card where the drag rests on a row.
     *
     * @param row - The row
     * @param from - The card: its library and its key
     * @param slot - The bucket under the pointer, as the drag grammar spells it (`""`, none)
     * @param event - The element under the pointer, by its key, when there is one
     * @returns The verdict
     */
    card(row: PlanRowValue, from: { readonly library: string; readonly key: string }, slot: string, event: string | undefined): PlanEventVerdict;
    /**
     * The verdict over an element landing on a row.
     *
     * @param row - The row
     * @param movable - The element
     * @param to - Where its row's landing put it; `undefined` before it has rested on the row, which then answers by the kinds alone
     * @returns The verdict
     */
    element(row: PlanRowValue, movable: PlanMovable, to: PlanProposal | undefined): PlanEventVerdict;
    /**
     * The verdict over the link Connect would draw from an element to the event under the pointer (#1541, U10).
     *
     * @param movable - The element the drag runs from
     * @param event - The element under the pointer, by its key, when there is one
     * @returns The verdict: nothing said over no event, or over the event it runs from; the link's kind and its two
     *   events where it lands; else why not — its kind's end, or the Plan's `canConnect`
     */
    connect(movable: PlanMovable, event: string | undefined): PlanEventVerdict;
    /**
     * The verdict over an element returned to a library: unscheduled, on the Backlog tab.
     *
     * @param event - The return, a `remove` to its `source`
     * @param library - The library it is dropped on
     * @returns The verdict
     */
    returning(event: DragEventValue, library: string): PlanEventVerdict;
    /**
     * A card dropped on a row — a template's `create`, a backlog event's `place`, or an author's card's fields.
     *
     * @param event - The drop, an `add`
     * @returns Whether it was recorded
     */
    dropCard(event: DragEventValue): boolean;
    /**
     * An element moved or resized: its event placed, and a selection with it.
     *
     * @param request - The move
     * @returns Whether it was recorded
     */
    moveElement(request: PlanMoveRequest): boolean;
    /**
     * An element dropped on a library: unscheduled, on the Backlog tab.
     *
     * @param event - The return, a `remove` to its `source`
     * @param library - The library it was dropped on
     * @returns Whether it was recorded
     */
    returnElement(event: DragEventValue, library: string): boolean;
    /**
     * Connect's drop (#1541, U10): the link drawn from an element to the event it was dropped on, a draft of its
     * kind's session, and selected.
     *
     * @param movable - The element the drag ran from
     * @param event - The element it was dropped on, by its key, when there is one
     * @returns Whether it was recorded
     */
    connectElement(movable: PlanMovable, event: string | undefined): boolean;
}

/** What {@link usePlanEventDrag} reads — the latest render's. */
export interface PlanEventDragArgs {
    /** The event kinds; none, no drag of theirs. */
    kinds: readonly PlanEventKindValue[];
    /** The series the event kinds land on (#1541): what a row stands for, and each by name. */
    landings: readonly PlanLandingValue[];
    /** The library's tabs: the author's tabs' cards and the kinds their patches land on. */
    tabs: readonly PlanLibraryTabValue[];
    /** The names the Plan keeps its viewer's state under: the libraries the cards drag from. */
    keys: PlanKeys;
    /** The event kinds' editing: their drafts, the new keys, and the recorder. */
    editing: PlanEventEditing;
    /** The Plan's veto over what a drop would do (#1541, U7), when it has a check. */
    veto: PlanVeto | undefined;
    /** What Connect draws while its tool is held (#1541, U10); `undefined` while Select is. */
    connect: PlanConnecting | undefined;
    /** A resource's landing row on the canvas, where it holds it: the row a candidate names for an event that keeps its resource. */
    resource: (ref: { readonly kind: string; readonly key: string }) => PlanRowValue | undefined;
    /** The shared scale: a time scale beside event kinds. */
    scale: PlanScale | undefined;
    /** The canvas's words. */
    words: PlanWords;
    /** The moves in flight. */
    store: PlanEditStore;
    /** A row on the canvas, by its key. */
    rowOf: (key: RowKey) => PlanRowValue | undefined;
    /** The events selected on the canvas, by their elements' keys. */
    selected: () => readonly string[];
    /** Selects events, on the row given — a template's new event. */
    select: (keys: readonly string[], row: RowKey | undefined) => void;
}

/** How a gesture is recorded, once its verdict lets it land. */
interface PlanEventGesture {
    readonly verdict: PlanEventVerdict;
    /** Each event it changes. */
    readonly changes: readonly PlanEventChange[];
    /** Its origin in the history. */
    readonly origin: Origin;
    /** Its label in the history — canonical English, as every history's labels are. */
    readonly label: string;
    /** The events it selects once recorded, and the row they are on. */
    readonly selects: { readonly keys: readonly string[]; readonly row: RowKey | undefined } | undefined;
}

/** An element moved, as a candidate says it. */
const MOVE = variant("move", null) as PlanCandidateValue["gesture"];
/** The resolutions a template's `at` applies at: a whole day, or longer. */
const WHOLE_DAYS: readonly string[] = ["day", "week", "month", "quarter", "year"];
/** A bar's and a chip's moves: their ends resize. */
const SPAN_MOVE: PlanRowMove = { items: PLAN_EVENT_ITEMS, resize: true };
/** A tile's and a mark's moves: one instant, no end. */
const POINT_MOVE: PlanRowMove = { items: PLAN_EVENT_ITEMS, resize: false };
/** No key a gesture has made yet. */
const NONE_MINTED: ReadonlySet<string> = new Set();
/** A `create` writes no existing entry. */
const NO_ENTRY = new Uint8Array(0);
/** No verdict at all: the drag is not the event kinds'. */
const NOT_OURS: PlanEventVerdict = { allowed: false, caption: undefined, span: undefined };
/** A landing the kinds take before the drag has rested on its row. */
const TAKEN_QUIETLY: PlanEventVerdict = { allowed: true, caption: undefined, span: undefined };
const MINUTE_MS = 60_000;

const stringEqual = equalFor(StringType);
const dateEqual = equalFor(DateTimeType);
const resourceEqual = equalFor(OptionType(ScheduleResourceRefType));

/** A gesture the event kinds refuse, saying why. */
function refused(caption: string | undefined, span?: PlanSpan): PlanEventGesture {
    return { verdict: { allowed: false, caption, span }, changes: [], origin: "drop", label: "", selects: undefined };
}

/** An element's key as the event it is: its kind's slot and its key's text. */
function refOf(key: string): { readonly kind: string; readonly key: string } | undefined {
    const read = parseEventRef(key);
    return read.success ? read.value : undefined;
}

/** A time instant's Date; `undefined` for an instant of another arm. */
function dateOf(t: PlanSpan["start"]): Date | undefined {
    return t.type === "time" ? t.value : undefined;
}

/**
 * The event kinds with an element drawn on rows of theirs: where an author's
 * card whose patch lands on one of them has an event to land on (#1196, PB63).
 *
 * @param rows - The rows on the canvas
 * @param drop - The event kinds' drag and drop: which rows are theirs
 * @returns The kinds' slots
 */
export function drawnKinds(rows: readonly PlanRowValue[], drop: PlanEventDrop): ReadonlySet<string> {
    const out = new Set<string>();
    for (const row of rows) {
        if (drop.target(row) === undefined) continue;
        const kind = row.kind;
        const keys = kind.type === "span" ? kind.value.runs.map((run) => run.key)
            : kind.type === "cards" ? kind.value.chips.map((chip) => chip.key)
                : kind.type === "buckets" ? kind.value.events.map((tile) => tile.key)
                    : kind.type === "events" ? kind.value.marks.map((mark) => mark.key) : [];
        for (const key of keys) {
            const ref = refOf(key);
            if (ref !== undefined) out.add(ref.kind);
        }
    }
    return out;
}

/**
 * The event kinds' drag and drop over the latest kinds, drafts and selection —
 * see the module docs.
 *
 * @param args - What it reads, the latest render's
 * @returns Its answers and its gestures, the same object while the libraries hold; `undefined` for a Plan without event kinds
 */
export function usePlanEventDrag(args: PlanEventDragArgs): PlanEventDrop | undefined {
    const latest = useRef(args);
    latest.current = args;
    const { keys, tabs } = args;
    const active = args.kinds.length > 0;
    // Connect held: the rows' elements are drawn again as its sources, with no end to resize.
    const connecting = args.connect !== undefined;
    // The libraries the kinds take cards from: the Events and Backlog tabs', and each author's tab whose cards land on
    // an event (`drop`) or make one (`create`, #1541 U1).
    const libraries = useMemo(() => [
        eventsLibrary(keys), backlogLibrary(keys),
        ...tabs.flatMap((tab) => (tab.type === "tab" && (tab.value.drop.type === "some" || tab.value.create.type === "some") ? [tabLibrary(keys, tab.value)] : [])),
    ], [keys, tabs]);
    // Each answer, kept until what it read moves.
    const held = useRef<{ read: readonly unknown[]; gestures: Map<string, PlanEventGesture> }>({ read: [], gestures: new Map() });
    // What a row stands for, kept by the row's own object.
    const targets = useRef(new WeakMap<PlanRowValue, PlanEventTarget | null>());

    return useMemo((): PlanEventDrop | undefined => {
        if (!active) return undefined;
        const events = libraries[0]!;
        const backlog = libraries[1]!;

        /** The answers kept for what the latest render reads — none, once any of it moved. */
        const kept = (): Map<string, PlanEventGesture> => {
            const a = latest.current;
            const read = [a.kinds, a.landings, a.tabs, a.editing.drafts, a.editing.version, a.veto, a.scale, a.words, a.selected(), a.connect];
            const was = held.current;
            if (was.read.length !== read.length || read.some((r, i) => !Object.is(r, was.read[i]))) {
                held.current = { read, gestures: new Map() };
            }
            return held.current.gestures;
        };
        const ask = (key: string, plan: () => PlanEventGesture): PlanEventGesture => {
            const gestures = kept();
            let gesture = gestures.get(key);
            if (gesture === undefined) {
                gesture = plan();
                gestures.set(key, gesture);
            }
            return gesture;
        };

        const kindOf = (slot: string): PlanEventKindValue | undefined => latest.current.kinds.find((k) => stringEqual(k.key, slot));
        /** An author's tab whose cards land on an event, by its library. */
        const authorTab = (library: string): PlanAuthorTabValue | undefined => {
            const a = latest.current;
            for (const tab of a.tabs) {
                if (tab.type === "tab" && (tab.value.drop.type === "some" || tab.value.create.type === "some")
                    && stringEqual(tabLibrary(a.keys, tab.value), library)) return tab.value;
            }
            return undefined;
        };
        /** An event as Plan draws it, and its row, its kind's drafts in place — as the kinds' editing reads it. */
        const readEvent = (kind: PlanEventKindValue, id: string): PlanEventReadValue | undefined => {
            try {
                return latest.current.editing.read(kind.key, id);
            } catch (err) {
                console.error(`[Plan] ${kind.name}'s event ${id} could not be read:`, err);
                return undefined;
            }
        };

        const targetOf = (row: PlanRowValue): PlanEventTarget | undefined => {
            const cached = targets.current.get(row);
            if (cached !== undefined) return cached ?? undefined;
            const a = latest.current;
            const at = landingTargetOf(row.id, a.landings, a.kinds);
            const found: PlanEventTarget | undefined = at === undefined ? undefined
                : at.kind === "resource" ? { kind: "resource", slot: at.landing.key, key: at.key, path: at.path, draw: at.draw }
                    : { kind: "unassigned", event: at.event.key, draw: at.draw };
            targets.current.set(row, found ?? null);
            return found;
        };

        /** The resource a row stands for, as an event names it. */
        const resourceOf = (target: PlanEventTarget): PlanResourceOption =>
            (target.kind === "resource" ? some({ kind: target.slot, key: target.key }) : none);
        /**
         * A row's resource by name: its landing row's label — the row the drag rests on, or the one beside it, in the
         * window that holds both (#1541) — else its key; an Unassigned row's, `Unassigned`.
         */
        const whereName = (target: PlanEventTarget): string => {
            const a = latest.current;
            if (target.kind === "unassigned") return a.words.m.inspectorUnassigned();
            return a.rowOf(rowKeyOf(landingRowId(target.slot, target.path)))?.gutter.label ?? target.key;
        };
        /** Whether a kind is placed on what a row stands for. */
        const onResource = (kind: PlanEventKindValue, target: PlanEventTarget): boolean => (target.kind === "resource"
            ? kind.takes.some((slot) => stringEqual(slot, target.slot))
            : stringEqual(kind.key, target.event));
        /** A drop must stay on the sub-row that actually draws its kind. */
        const takes = (kind: PlanEventKindValue, target: PlanEventTarget): boolean =>
            onResource(kind, target) && stringEqual(target.draw, kind.draw.type);
        /** Explain the missing resource or the compatible sub-row, before anything is drafted. */
        const needs = (kind: PlanEventKindValue, target?: PlanEventTarget): string => {
            const a = latest.current;
            if (target !== undefined && onResource(kind, target)) return a.words.m.dropNeedsRow({ kind: kind.name });
            const names = kind.takes.map((slot) => (a.landings.find((l) => stringEqual(l.key, slot))?.name ?? slot).toLocaleLowerCase(a.words.locale));
            return a.words.m.dropNeeds({ resources: names });
        };
        /** The day an event starts, and its time when it has one — or the canvas reads hours. */
        const whenOf = (start: Date): { day: string; time: string | undefined } => {
            const a = latest.current;
            const timed = a.scale?.resolution === "hour" || start.getUTCHours() !== 0 || start.getUTCMinutes() !== 0;
            return { day: a.words.weekdayDate(start), time: timed ? a.words.time(start) : undefined };
        };
        /** The row a kind's event on what a row stands for draws on, when the canvas has it. */
        const rowFor = (kind: PlanEventKindValue, target: PlanEventTarget): RowKey | undefined => {
            const a = latest.current;
            const landing = target.kind === "resource" ? a.landings.find((l) => stringEqual(l.key, target.slot)) : undefined;
            const id = target.kind === "unassigned" ? kindRowId(kind, { kind: "unassigned", event: kind, draw: target.draw })
                : landing === undefined ? undefined
                    : kindRowId(kind, { kind: "resource", landing, key: target.key, path: target.path, draw: target.draw });
            const key = id === undefined ? undefined : rowKeyOf(id);
            return key !== undefined && a.rowOf(key) !== undefined ? key : undefined;
        };

        /**
         * Why an event its kind's `locked` holds where it is takes no gesture (#1541, U9): what the ghost says of a
         * drop that would move it, change it or take it off the canvas.
         *
         * @returns Its refusal's words; `undefined` for an event that is not locked
         */
        const lockOf = (read: PlanEventReadValue): string | undefined =>
            (read.item.locked ? latest.current.words.m.dropLocked({ event: read.item.title }) : undefined);

        /**
         * Whether one event of a kind lands as a gesture writes it: the kind
         * takes a gesture now, its own `write` takes this one, and the Plan's
         * `canDrop` lets it land.
         *
         * @returns `undefined` when it lands; else why not
         */
        const judge = (kind: PlanEventKindValue, change: { id: string; entry: Uint8Array; gesture: PlanEventGestureValue },
            candidate: PlanCandidateValue, onNone = false): string | undefined => {
            const a = latest.current;
            const m = a.words.m;
            if (!a.editing.available(kind.key)) return m.dropBusy({ kind: kind.name });
            let written: ReturnType<PlanEventKindValue["write"]>[number] | undefined;
            try {
                written = kind.write([change])[0];
            } catch (err) {
                console.error(`[Plan] ${kind.name}'s write of a drop failed:`, err);
                return m.dropRefused();
            }
            if (written === undefined || written.type !== "some") {
                // Its write refuses the resource: on none, a kind whose field holds one.
                return onNone ? needs(kind) : m.dropRefused();
            }
            // The Plan's one check, of what the drop would do (#1541, U7): its refusal is what the ghost says.
            return a.veto?.refusal(candidate);
        };

        /**
         * Where an event of a kind would land on what a row stands for, as a candidate says it: the resource's own
         * row — its landing row, whichever row beside it the kind draws on — or the kind's Unassigned row, and its times.
         */
        const landsOn = (kind: PlanEventKindValue, target: PlanEventTarget, start: Date, end: Date): PlanCandidatePlace => ({
            row: target.kind === "resource" ? landingRowId(target.slot, target.path) : kindRowId(kind, { kind: "unassigned", event: kind, draw: target.draw }),
            start: timeInstant(start), end: timeInstant(end),
        });
        /** A card landing: nothing of it an alt-drag copy. */
        const ADD = variant("add", { duplicate: false }) as PlanCandidateValue["gesture"];

        /** The bucket a slot names, its start a Date. */
        const bucketStart = (slot: string): Date | undefined => {
            const at = slot === "" ? undefined : fromPlanSlot("time", slot);
            return at !== undefined ? dateOf(at) : undefined;
        };

        /**
         * A new event of a kind, made at a bucket from a template (PB32) — one of the kind's own, or the one a library
         * tab's card makes it from (#1541, U1): from its `at` on a whole day, for its duration, under a key made from
         * `keyFrom`, the kind's own `write` making its row.
         */
        const planMade = (kind: PlanEventKindValue, target: PlanEventTarget, at: Date, template: PlanEventKindValue["templates"][number],
            keyFrom: string, from: PlanCandidateValue["from"]): PlanEventGesture => {
            const a = latest.current;
            const m = a.words.m;
            const where = whereName(target);
            const clock = getSomeorUndefined(template.at);
            const start = clock !== undefined && WHOLE_DAYS.includes(a.scale?.resolution ?? "")
                ? new Date(at.getTime() + (Number(clock.hour) * 60 + Number(clock.minute)) * MINUTE_MS)
                : at;
            const end = kind.instant ? start : new Date(start.getTime() + durationMinutes(template.duration) * MINUTE_MS);
            const span = { start: timeInstant(start), end: timeInstant(end) };
            const id = a.editing.mint(kind.key, keyFrom, NONE_MINTED);
            if (id === undefined) return refused(m.dropRefused(), span);
            const gesture = variant("create", { template: template.key, start, end, resource: resourceOf(target) }) as PlanEventGestureValue;
            const why = judge(kind, { id, entry: NO_ENTRY, gesture },
                eventCandidate(ADD, kind.key, from, landsOn(kind, target, start, end)), target.kind === "unassigned");
            if (why !== undefined) return refused(why, span);
            return {
                verdict: { allowed: true, caption: m.dropCaption({ what: template.name, where, ...whenOf(start) }), span },
                changes: [{ kind: kind.key, id, gesture }],
                origin: "drop",
                label: `Drop ${template.name} on ${where}`,
                selects: { keys: [printEventRef({ kind: kind.key, key: id })], row: rowFor(kind, target) },
            };
        };

        // ── A card where the drag rests ───────────────────────────────────────
        const planCard = (row: PlanRowValue, from: { readonly library: string; readonly key: string }, slot: string, event: string | undefined): PlanEventGesture => {
            const a = latest.current;
            const m = a.words.m;
            const target = targetOf(row);
            if (target === undefined) return refused(undefined);
            // An author's card: over an event of its patch's kind it sets what the patch sets (PB63); anywhere else, a
            // tab with `create` makes an event of its kind there, as a template does (#1541, U1).
            const tab = authorTab(from.library);
            if (tab !== undefined) {
                const card = tab.cards.find((c) => stringEqual(c.key, from.key));
                if (card === undefined) return refused(undefined);
                const ref = event !== undefined ? refOf(event) : undefined;
                const kind = ref !== undefined ? kindOf(ref.kind) : undefined;
                const create = getSomeorUndefined(tab.create);
                const patches = tab.drop.type === "some" && kind !== undefined && stringEqual(kind.key, tab.drop.value);
                if (create !== undefined && !patches) {
                    const makes = kindOf(create.kind);
                    const made = create.makes.find((one) => stringEqual(one.card, from.key));
                    const at = bucketStart(slot);
                    if (makes === undefined || made === undefined || at === undefined) return refused(undefined);
                    if (!takes(makes, target)) return refused(needs(makes, target));
                    // Its key is made from the card's own, never from the key its kind knows its template by.
                    return planMade(makes, target, at, made.template, card.key, variant("card", { library: from.library, key: from.key }));
                }
                if (tab.drop.type !== "some") return refused(undefined);
                const fields = card.sets.map((set) => set.path[set.path.length - 1] ?? "");
                if (ref === undefined || kind === undefined) return refused(m.dropCardNeedsEvent({ fields }));
                if (!stringEqual(kind.key, tab.drop.value)) return refused(m.dropKindTakesNo({ kind: kind.name, fields }));
                const read = readEvent(kind, ref.key);
                if (read === undefined) return refused(m.dropCardNeedsEvent({ fields }));
                const start = getSomeorUndefined(read.item.start);
                const end = getSomeorUndefined(read.item.end);
                const span = start !== undefined && end !== undefined ? { start: timeInstant(start), end: timeInstant(end) } : undefined;
                if (!a.editing.available(kind.key)) return refused(m.dropBusy({ kind: kind.name }), span);
                // A locked event takes no card (#1541, U9).
                const held = lockOf(read);
                if (held !== undefined) return refused(held, span);
                // What it would do: the card lands on the event, where the event stands.
                const said = a.veto?.refusal(eventCandidate(ADD, kind.key, variant("card", { library: from.library, key: from.key }), {
                    row: row.id, start: span?.start, end: span?.end,
                }, { kind: kind.key, key: ref.key }));
                if (said !== undefined) return refused(said, span);
                return {
                    verdict: { allowed: true, caption: m.dropCardOnEvent({ card: card.label, event: read.item.title }), span },
                    changes: card.sets.map((set): PlanEventChange => ({ kind: kind.key, id: ref.key, gesture: variant("field", { path: [...set.path], value: set.value }) })),
                    origin: "drop",
                    label: `Set ${card.label} on ${read.item.title}`,
                    selects: undefined,
                };
            }
            const isTemplate = stringEqual(from.library, events);
            if (!isTemplate && !stringEqual(from.library, backlog)) return refused(undefined);
            const ref = refOf(from.key);
            const kind = ref !== undefined ? kindOf(ref.kind) : undefined;
            if (ref === undefined || kind === undefined) return refused(undefined);
            const at = bucketStart(slot);
            if (at === undefined) return refused(undefined);
            if (!takes(kind, target)) return refused(needs(kind, target));
            if (isTemplate) {
                // A template (PB32): a new event at the bucket — from its `at` on a whole day — for its duration.
                const template = kind.templates.find((t) => stringEqual(t.key, ref.key));
                if (template === undefined) return refused(undefined);
                return planMade(kind, target, at, template, template.key, variant("template", template.key));
            }
            const where = whereName(target);
            const resource = resourceOf(target);
            // A backlog event (PB33): scheduled at the bucket, for its own duration.
            const read = readEvent(kind, ref.key);
            if (read === undefined) return refused(undefined);
            const start = at;
            const end = kind.instant ? start : new Date(start.getTime() + Number(read.item.minutes) * MINUTE_MS);
            const span = { start: timeInstant(start), end: timeInstant(end) };
            const gesture = variant("place", { start, end, resource }) as PlanEventGestureValue;
            // A locked event stays in the backlog (#1541, U9).
            const held = lockOf(read);
            if (held !== undefined) return refused(held, span);
            const why = judge(kind, { id: ref.key, entry: read.row, gesture },
                eventCandidate(ADD, kind.key, variant("backlog", { kind: kind.key, key: ref.key }), landsOn(kind, target, start, end)), target.kind === "unassigned");
            if (why !== undefined) return refused(why, span);
            return {
                verdict: { allowed: true, caption: m.dropCaption({ what: read.item.title, where, ...whenOf(start) }), span },
                changes: [{ kind: kind.key, id: ref.key, gesture }],
                origin: "drop",
                label: `Schedule ${read.item.title} on ${where}`,
                selects: { keys: [printEventRef({ kind: kind.key, key: ref.key })], row: rowFor(kind, target) },
            };
        };

        // ── An element where its row's landing put it ─────────────────────────
        const planElement = (row: PlanRowValue, movable: PlanMovable, to: PlanProposal): PlanEventGesture => {
            const a = latest.current;
            const m = a.words.m;
            const scale = a.scale;
            const target = targetOf(row);
            const ref = refOf(movable.key);
            const kind = ref !== undefined ? kindOf(ref.kind) : undefined;
            if (target === undefined || ref === undefined || kind === undefined || scale === undefined) return refused(undefined);
            if (!takes(kind, target)) return refused(needs(kind, target), to.span);
            const origin = originOf(movable, to);
            const units = to.units ?? 0;
            const fine = to.fine ?? false;
            const across = to.rowKey !== movable.rowKey;
            /**
             * One event placed by the gesture: its times moved, and its resource the row's when it moves across onto
             * it — and whether that moves it at all.
             */
            const placeOf = (k: PlanEventKindValue, id: string, read: PlanEventReadValue, exact: PlanSpan | undefined, follows: boolean) => {
                const start0 = getSomeorUndefined(read.item.start);
                const end0 = getSomeorUndefined(read.item.end);
                if (start0 === undefined || end0 === undefined) return undefined;
                const span = exact ?? moveSpan(scale, { start: timeInstant(start0), end: timeInstant(end0) }, units, fine);
                const start = dateOf(span.start);
                const end = dateOf(span.end);
                if (start === undefined || end === undefined) return undefined;
                const resource = follows ? resourceOf(target) : read.item.resource;
                const gesture = variant("place", { start, end, resource }) as PlanEventGestureValue;
                const moved = !dateEqual(start, start0) || !dateEqual(end, end0) || !resourceEqual(resource, read.item.resource);
                // The row it would be on: the row's resource where it follows the drag onto it, else its own resource's
                // landing row, where the canvas holds it — or, on none, its kind's Unassigned row.
                const kept = getSomeorUndefined(read.item.resource);
                const at: PlanRowId | undefined = follows ? landsOn(k, target, start, end).row
                    : kept !== undefined ? a.resource(kept)?.id
                        : kindRowId(k, { kind: "unassigned", event: k, draw: k.draw.type });
                return { kind: k, id, read, start, end, resource, gesture, moved, row: at };
            };
            const read = readEvent(kind, ref.key);
            if (read === undefined) return refused(undefined, to.span);
            // The element is its event's extent — a bar, a chip, an instant kind's tile or mark — and lands as the row
            // put it; any other's tile or mark moves its event's own times by the units the element moved.
            const exact = movable.kind === "run" || movable.kind === "chip" || kind.instant;
            // The element grabbed lands on the row the drag rests on: its own, or the one it is carried across to.
            const own = placeOf(kind, ref.key, read, exact ? to.span : undefined, true);
            if (own === undefined) return refused(undefined, to.span);
            const placed = [own];
            // A selected element moves the selection (PB34): the others by the same units, those on its resource onto the row's.
            const selected = a.selected();
            if (origin.kind === "move" && (units !== 0 || across) && selected.length > 1 && selected.includes(movable.key)) {
                for (const key of selected) {
                    if (stringEqual(key, movable.key)) continue;
                    const other = refOf(key);
                    const otherKind = other !== undefined ? kindOf(other.kind) : undefined;
                    const otherRead = other !== undefined && otherKind !== undefined ? readEvent(otherKind, other.key) : undefined;
                    if (other === undefined || otherKind === undefined || otherRead === undefined) continue;
                    const follows = across && resourceEqual(otherRead.item.resource, read.item.resource);
                    const one = placeOf(otherKind, other.key, otherRead, undefined, follows);
                    if (one !== undefined) placed.push(one);
                }
            }
            // What the gesture changes: an event it leaves where it was — another selected one on a resource of its own,
            // carried across, or the grabbed one let go where it stands — is none of it. Nothing changed, it lands as
            // nothing: the ghost says where the element stands, and the drop records no step.
            const changed = placed.filter((one) => one.moved);
            // One part refused refuses the whole: a selection moves together, or not at all — a locked one among it
            // holding the rest where they are (#1541, U9).
            for (const one of changed) {
                const held = lockOf(one.read);
                if (held !== undefined) return refused(held, to.span);
                const why = judge(one.kind, { id: one.id, entry: one.read.row, gesture: one.gesture }, eventCandidate(
                    origin.kind === "resize" ? variant("resize", variant(origin.edge, null)) as PlanCandidateValue["gesture"] : MOVE,
                    one.kind.key, variant("event", { kind: one.kind.key, key: one.id }),
                    { row: one.row, start: timeInstant(one.start), end: timeInstant(one.end) }), one.resource.type === "none");
                if (why !== undefined) return refused(why, to.span);
            }
            const what = changed.length > 1 ? m.inspectorEvents({ n: changed.length, count: a.words.number(changed.length) }) : movable.label;
            const where = whereName(target);
            const label = changed.length > 1 ? `Move ${changed.length} events`
                : origin.kind === "resize" ? `Resize ${movable.label}`
                    : across ? `Move ${movable.label} to ${where}` : `Move ${movable.label}`;
            return {
                verdict: { allowed: true, caption: m.dropCaption({ what, where, ...whenOf(own.start) }), span: to.span },
                changes: changed.map((one): PlanEventChange => ({ kind: one.kind.key, id: one.id, gesture: one.gesture })),
                origin: origin.kind,
                label,
                selects: undefined,
            };
        };

        // ── An element returned to a library ──────────────────────────────────
        const planReturn = (event: DragEventValue, library: string): PlanEventGesture => {
            const a = latest.current;
            const m = a.words.m;
            if (event.type !== "remove" || !stringEqual(library, backlog)) return refused(undefined);
            const key = getSomeorUndefined(event.value.from.event);
            const ref = key !== undefined ? refOf(key) : undefined;
            const kind = ref !== undefined ? kindOf(ref.kind) : undefined;
            if (ref === undefined || kind === undefined) return refused(undefined);
            // Its times go to none (PB36): a kind whose times are Options alone has a backlog.
            if (!kind.backlog) return refused(m.dropNoBacklog({ kind: kind.name }));
            const read = readEvent(kind, ref.key);
            if (read === undefined) return refused(undefined);
            // A locked event stays on the canvas (#1541, U9).
            const held = lockOf(read);
            if (held !== undefined) return refused(held);
            const gesture = variant("unplace", null) as PlanEventGestureValue;
            // Taken off the canvas, back to the Backlog tab: it lands on no row, at no time.
            const why = judge(kind, { id: ref.key, entry: read.row, gesture },
                eventCandidate(variant("remove", variant("source", null)), kind.key, variant("event", { kind: kind.key, key: ref.key })));
            if (why !== undefined) return refused(why);
            return {
                verdict: { allowed: true, caption: m.dropUnschedule({ what: read.item.title }), span: undefined },
                changes: [{ kind: kind.key, id: ref.key, gesture }],
                origin: "move",
                label: `Unschedule ${read.item.title}`,
                selects: undefined,
            };
        };

        const cardGesture = (row: PlanRowValue, from: { readonly library: string; readonly key: string }, slot: string, event: string | undefined) =>
            ask(`card|${row.key}|${from.library}|${from.key}|${slot}|${event ?? ""}`, () => planCard(row, from, slot, event));
        const elementGesture = (row: PlanRowValue, movable: PlanMovable, to: PlanProposal) =>
            ask(`element|${row.key}|${movable.rowKey}|${movable.key}|${to.rowKey}|${instantKey(to.span.start)}|${instantKey(to.span.end)}|${to.units ?? ""}|${to.fine === true}`,
                () => planElement(row, movable, to));
        const returnGesture = (event: DragEventValue, library: string) => {
            const key = event.type === "remove" ? getSomeorUndefined(event.value.from.event) ?? "" : "";
            return ask(`return|${library}|${key}`, () => planReturn(event, library));
        };
        /** An event's title, as the ghost names it: its key's text for one the page does not hold. */
        const titleOf = (ref: { readonly kind: string; readonly key: string }): string => {
            const kind = kindOf(ref.kind);
            return (kind === undefined ? undefined : readEvent(kind, ref.key)?.item.title) ?? ref.key;
        };
        /** An event's extent on the axis: what the row's landing band spans where a link would end at it. */
        const extentOf = (ref: { readonly kind: string; readonly key: string }): PlanSpan | undefined => {
            const kind = kindOf(ref.kind);
            const read = kind === undefined ? undefined : readEvent(kind, ref.key);
            const start = read === undefined ? undefined : getSomeorUndefined(read.item.start);
            const end = read === undefined ? undefined : getSomeorUndefined(read.item.end);
            return start !== undefined && end !== undefined ? { start: timeInstant(start), end: timeInstant(end) } : undefined;
        };
        /** The link Connect would draw from an element to the event under the pointer (#1541, U10). */
        const planConnect = (movable: PlanMovable, event: string | undefined): PlanEventGesture => {
            const a = latest.current;
            const from = refOf(movable.key);
            const to = event === undefined ? undefined : refOf(event);
            // No event under the pointer to end at, or the one it runs from: nowhere to land, and nothing to say.
            if (a.connect === undefined || event === undefined || from === undefined || to === undefined || stringEqual(event, movable.key)) return refused(undefined);
            const { kind, veto } = a.connect;
            const m = a.words.m;
            // Where it would end: the event under the pointer, which the row's landing band spans, refused or not.
            const span = extentOf(to);
            const made = connectLink(kind, { from, to }, (slot) => a.editing.mint(slot, "", NONE_MINTED), (slot, id) => a.editing.row(slot, id)?.type === "some");
            if ("refused" in made) {
                return refused(made.refused === "start" ? m.linkEndRefused({ kind: kind.name, end: "start", item: titleOf(from) })
                    : made.refused === "end" ? m.linkEndRefused({ kind: kind.name, end: "end", item: titleOf(to) })
                        : made.refused === "held" ? m.linkHeld({ kind: kind.name }) : m.linkUnkeyed({ kind: kind.name }), span);
            }
            const said = veto(kind.key, movable.key, event);
            if (said !== undefined) return refused(said, span);
            return {
                verdict: { allowed: true, caption: m.linkDrawn({ kind: kind.name, from: titleOf(from), to: titleOf(to) }), span },
                changes: [made.change], origin: "insert", label: linkStepLabel("Connect", [kind]),
                selects: { keys: [made.key], row: movable.rowKey },
            };
        };
        const connectGesture = (movable: PlanMovable, event: string | undefined) =>
            ask(`connect|${movable.rowKey}|${movable.key}|${event ?? ""}`, () => planConnect(movable, event));
        /** Record a gesture the kinds let land as one step, and select what it selects. */
        const record = (gesture: PlanEventGesture): boolean => {
            const a = latest.current;
            if (!gesture.verdict.allowed || gesture.changes.length === 0) return false;
            if (!a.editing.record(gesture.changes, gesture.origin, gesture.label)) return false;
            if (gesture.selects !== undefined) a.select(gesture.selects.keys, gesture.selects.row);
            return true;
        };

        return {
            libraries,
            backlog,
            connecting,
            target: targetOf,
            rowMove: (row) => {
                const target = targetOf(row);
                if (target === undefined) return undefined;
                // Connect held, an element is picked up whole: no end is resized.
                return !connecting && (stringEqual(target.draw, "span") || stringEqual(target.draw, "cards")) ? SPAN_MOVE : POINT_MOVE;
            },
            isEvent: (movable) => stringEqual(movable.items, PLAN_EVENT_ITEMS),
            drawsKind: (row, movable) => {
                const target = targetOf(row);
                const ref = refOf(movable.key);
                const kind = ref !== undefined ? kindOf(ref.kind) : undefined;
                return target !== undefined && kind !== undefined && takes(kind, target);
            },
            takesCard: (library) => libraries.some((l) => stringEqual(l, library)),
            // An author's card with a `drop`: one of a tab with `create` alone lands at a bucket, as a template does.
            landsOnEvent: (library) => authorTab(library)?.drop.type === "some",
            where: (row) => {
                const target = targetOf(row);
                return target !== undefined ? whereName(target) : undefined;
            },
            card: (row, from, slot, event) => cardGesture(row, from, slot, event).verdict,
            element: (row, movable, to) => {
                if (to === undefined) {
                    // Before the drag rests on the row, the kinds alone answer: a destination it may take.
                    const target = targetOf(row);
                    const ref = refOf(movable.key);
                    const kind = ref !== undefined ? kindOf(ref.kind) : undefined;
                    return target !== undefined && kind !== undefined && takes(kind, target) ? TAKEN_QUIETLY : NOT_OURS;
                }
                return elementGesture(row, movable, to).verdict;
            },
            connect: (movable, event) => connectGesture(movable, event).verdict,
            returning: (event, library) => returnGesture(event, library).verdict,
            dropCard: (event) => {
                if (event.type !== "add") return false;
                const { from, into } = event.value;
                const row = latest.current.rowOf(into.row);
                return row !== undefined && record(cardGesture(row, from, into.slot, getSomeorUndefined(into.event)));
            },
            moveElement: (request) => {
                const movable = request.element;
                const row = latest.current.rowOf(request.to);
                if (movable === undefined || !stringEqual(movable.items, PLAN_EVENT_ITEMS) || row === undefined) return false;
                const to: PlanProposal = { rowKey: request.to, span: request.span, units: request.units, fine: request.fine };
                return !unmoved(movable, to) && record(elementGesture(row, movable, to));
            },
            returnElement: (event, library) => record(returnGesture(event, library)),
            connectElement: (movable, event) => record(connectGesture(movable, event)),
        };
    }, [active, libraries, connecting]);
}
