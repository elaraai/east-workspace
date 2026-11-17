/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The inspector pane (#1197, `Plan Builder Spec.md` §8, §9.8, PB38–PB41,
 * PB60): the Plan's end pane, when it is given one (`inspector`), showing
 * what is selected on the canvas — and, collapsed, a rail with its icon and
 * what is selected.
 *
 * - **one event** (PB38): its kind's icon and name, its title, when it runs
 *   and its status; the overlaps banner when it overlaps another (#1198,
 *   PB53), a line per event it overlaps whose click selects that event; the
 *   banner of its refusals holding Save while the app's `ready` refuses it
 *   (#1525), as the Calendar's inspector has it, each field one names ringed
 *   in its form, the app's words for it under it (ruled 13 Nov 2026) — a field
 *   its state or its lane reads saying them under its fact — the one the
 *   warning button's issue or warning names taking the keyboard as the form
 *   draws it, or, a field the form draws no control of, its fact taking it;
 *   its resource, its start and end or its instant, its lane and its state;
 *   its kind's fields through `FieldForm`, the fields its state and its lane
 *   read left to their own lines, its quantity a field like any other, the
 *   bound a hint gives it that it breaks said under it in the tone the form
 *   says one in: a row as stored warns, a changed one's, holding Save, is an
 *   error (#1585, #1680's review) — or, when the kind has its own inspector,
 *   what that returns for the event in place of the form (PB60), its quantity
 *   then a fact of its own, its bound on a line under it; then
 *   Duplicate and Delete. An event its kind's `locked` holds where it is
 *   (#1541, U9) says so in a banner under a lock, its form read only and its
 *   gestures off;
 * - **several events** (PB39): how many, each kind's count, the list, and the
 *   bulk edit — the state, the resource and a shift in time — over those not
 *   locked, with how many are locked, which every gesture leaves as they are;
 * - **a link** of a link kind (#1541, U10), selected with no event: its
 *   kind's icon and name, the two events it joins by their titles, what it
 *   moves, its kind's form over its row — each edit a draft of the link's
 *   record, one step of the Plan's history — and Delete; several links, how
 *   many, each by the events it joins, and Delete. Events selected with links
 *   show as the events they are, and Delete — the key's or the pane's —
 *   removes the links with them;
 * - **a row** (PB40), on a Plan with or without event kinds (#1541, U5): a
 *   resource's name and lines — its landing row's (#1541) — the group it is
 *   drawn under; the banner of its refusals holding Save while the Plan's
 *   `ready` refuses its entry's drafts, in the session its rows save through,
 *   each naming its field; its overlaps — the pairs on the
 *   resource in the window, each line selecting its pair (#1198) — its events
 *   in the window — how many, how long, how much of each unit — and its
 *   series' rows beneath it at the bucket a click on its plot named; an event
 *   kind's Unassigned row, the kind's events on no resource; any other row,
 *   what it draws at that bucket. A kind past the cap is counted on no row,
 *   and the row says so, never 0; a kind hidden in the Series tab is in no
 *   figure, and nothing says so (#1039). While the cells a resource's kinds
 *   are read by over rows read a page at a time have not landed for it —
 *   scrolled out of the blocks read, or before the first read — its figures
 *   are placeholders, never 0, until they land (#1398, CL13);
 * - **nothing** (PB41): the window's counts — the hours those of the kinds
 *   read, the kinds whose events or hours are not counted named in one line
 *   (#1039) — and three hints, or two on a Plan with no event kinds.
 *
 * Each event is read as the kinds' editing reads it (`read`, its kind's own
 * `planEvent`), its kind's drafts in place, tracked, so a commit to its record
 * reads it again, and an event no longer there is left out — a kind read a
 * window at a time (#1199) looking for it among the rows the canvas holds,
 * then reading it by its key, and a kind read by its cells (#1039) among the
 * rows they hold, read again as they move. The read runs in a component of its own
 * ({@link PlanSelectionReader}), which hands the frame the events only when
 * they move: a kind narrowed through its source of the slice lands its key
 * searches one by one, and each would otherwise render the whole frame
 * (#1344). A resource is named by its landing row on the canvas (#1541), its
 * key standing in for one the canvas does not hold — over rows read a page at
 * a time, one not read. The bulk edit offers the resources of the series the
 * selected kinds land on, as the canvas holds them — those the rail shows —
 * and those the selected events are on; over rows read a page at a time,
 * which the canvas never holds whole, the events' own alone.
 *
 * Its edits (#1194, PB42, PB60) are steps of the Plan's one history, each one
 * transaction: a field of the kind's form, written through the kind's own
 * `write`, tinted while the drafts hold it otherwise than the record does; the
 * kind's own inspector's `update`, the edited event whole; Duplicate, a copy
 * of each event under a new key, the copies then selected; Delete; and the
 * bulk edit — the state, the resource, a shift of a day or an hour — over every
 * event selected that takes it, across kinds. They sit in one fieldset, off
 * while the canvas takes no write — a run of the app's optimiser out (#1409,
 * R2), or what it shows standing in, retained (#1398, CL8) — or a selected
 * kind takes no gesture — a write of its with no answer, its drafts out of
 * date — and each gesture asks the same again as it lands, so a control of a
 * kind's own inspector the fieldset does not reach writes nothing meanwhile.
 * A field's edit, or a bulk choice, that records nothing — off meanwhile, its
 * kind's own `write` turning it down, or nothing changed — draws its form
 * again, showing what the event holds, or what the events share, with no
 * words, as the Schematic's and the Flowchart's do for a refusal they have no
 * words for (#1585): a box never keeps a value its event does not hold.
 *
 * It keeps the keyboard (#1398): a control that goes with the view it was
 * pressed in — Duplicate, which selects the copies, an overlap's line, which
 * selects what it names — leaves the focus on the heading of the view drawn in
 * its place (`../../shared/focus-home.ts`), never on the page's body; Nothing
 * selected, which has no heading, is its own home. Delete hands the keyboard
 * to the canvas's row instead, as its selection's command does.
 *
 * Styles are the `planInspector` recipe's, the form's `fieldForm`'s and the
 * buttons the shared `button`'s; the pane — its collapse control and its rail
 * — is the Dock's.
 *
 * @packageDocumentation
 */

import { ScheduleInspectorHead } from "../../shared/schedule/inspector-head.js";
import { FOCUS_HOME_PROPS, useFocusHome } from "../../shared/focus-home.js";
import { memo, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Box, chakra, useRecipe, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import {
    BlobType, NullType, OptionType, SortedMap, StringType, VariantType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue,
    none, parseFor, printFor, some, toEastTypeValue, variant, type StructType, type ValueTypeOf, type option,
} from "@elaraai/east";
import { EventStateType } from "@elaraai/east-ui";
import type { FieldSpecValue } from "@elaraai/east-ui/internal";
import { PlanEventItemType, ScheduleResourceRefType, planHideId, type PlanEventDraftsType, type planKeys } from "@elaraai/e3-ui/internal";
import { parseEventRef, printEventRef } from "../../shared/schedule/event-ref.js";
import {
    BannerView, EastChakraComponent, FieldForm, fieldBreachIssue, fieldBreachText, fieldBreaches, fieldFormMessages, getSomeorUndefined, useDataStable, useTrackedEvaluation,
    type BuilderFrameDock, type FieldOption,
} from "@elaraai/east-ui-components";
import { FrameDrawer, PlaceholderShape } from "@elaraai/east-ui-components/internal";
import { breachTone } from "../../shared/bounds.js";
import { heldRowOf } from "../../shared/schedule/editing.js";
import { useFieldAsk } from "../../shared/schedule/field-ask.js";
import { fieldChange, fieldWrite, rowCodec } from "../../shared/schedule/records.js";
import { removePlanEvents, type PlanEventChange, type PlanEventEditing } from "../edit/events.js";
import { kindLinkOf, linkEndTitle, linkStepLabel, type PlanLinkKindValue, type PlanLinkRolesValue } from "../links/kinds.js";
import type { PlanToolsChrome } from "../links/connect.js";
import type { PlanLinkSource } from "../edit/event-drag.js";
import { scheduleEventKey } from "../../shared/schedule/overlaps.js";
import { entryRefusals, refusalsText, refusedFields } from "../../shared/schedule/refusals.js";
import { stateText } from "../a11y.js";
import type { PlanSnapshot } from "../controller/index.js";
import { usePlanSelector } from "../controller/react.js";
import type { PlanInstantValue } from "../instant.js";
import type { PlanStateWord } from "../messages.js";
import { rowKeyOf, type PlanRowValue } from "../model.js";
import type { RowKey } from "../plan-state.js";
import { quantityText, totalsByUnit, totalsText, type PlanQuantityValue } from "../quantity.js";
import { scheduleCellId, scheduleWithinCap, type ScheduleCellsRead } from "../../shared/schedule/cells.js";
import type { PlanChrome } from "../root/chrome.js";
import { eventReadRange } from "../root/events.js";
import { landingResourceOf, landingRowId, landingSeriesTargetOf, landingTargetOf, resourceKeyOf, type PlanLandingTarget } from "../root/landings.js";
import type { PlanScale } from "../scale.js";
import type { PlanWords } from "../words.js";
import type { PlanEventCounts } from "./counts.js";
import { hides } from "./hidden.js";
import type { PlanValue } from "./index.js";
import { resourcesNamed, useNamedResource, usePlanResourceNames, type PlanResourceNames } from "./names.js";

/** The names a Plan keeps its viewer's state under. */
type PlanKeys = ReturnType<typeof planKeys>;
/** One event kind, as the payload carries it. */
type PlanEventKindValue = PlanValue["events"][number];
/** One event read by its key: as Plan draws it, and its row. */
type PlanEventReadValue = Extract<ReturnType<PlanEventKindValue["planEvent"]>, { type: "some" }>["value"];
/** One event as Plan draws it. */
type PlanEventItemValue = PlanEventReadValue["item"];
type Styles = Record<string, SystemStyleObject>;

/** The inspector open: the Calendar's 320px (§8), as the Sheet's is. */
const INSPECTOR_SIZE = "320px";

/** Every kind's drafts, by kind then by entry id (#1194). */
type EventDrafts = ValueTypeOf<typeof PlanEventDraftsType>;

/** No drafts: what a kind holds none of. */
const NO_DRAFTS: Parameters<PlanEventKindValue["planEvent"]>[1] = new SortedMap([], compareFor(StringType));
/** No kind holds a draft. */
const NONE_DRAFTED: EventDrafts = new SortedMap([], compareFor(StringType));
/** No range: a canvas with no time window, beside which a windowed kind reads an event by its key alone. */
const NO_RANGE = new Date(0);

/** A Plan whose kinds take no edit — none here, as every kind is a record with its patch door — writes nothing. */
const NO_EDIT = (): void => {};

/** A read whose kinds are still in flight: what the pane shows stands as it was. */
const READING = "reading";

/** No event selected. */
const NO_EVENTS: readonly InspectedEvent[] = [];

/** The lifecycle states a bulk edit sets, in the order the axis reads them. */
const STATES: readonly PlanStateWord[] = ["estimated", "added", "recommended", "removed", "confirmed", "in-progress", "actual", "rejected"];

/** The bulk edit's choice of a state: a case per state. */
const STATE_CHOICE = VariantType(Object.fromEntries(STATES.map((state) => [state, NullType])));

const stringEqual = equalFor(StringType);
const blobEqual = equalFor(BlobType);
const itemEqual = equalFor(PlanEventItemType);
const resourceEqual = equalFor(OptionType(ScheduleResourceRefType));
const printResource = printFor(ScheduleResourceRefType);
const parseResource = parseFor(ScheduleResourceRefType);
const encodeState = encodeBeast2For(EventStateType);

/** A lifecycle state's word, its proposal's flavour spelled out — what the bulk edit chooses among. */
function stateWordOf(state: ValueTypeOf<typeof EventStateType>): PlanStateWord {
    return (state.type === "proposed" ? state.value.type : state.type) as PlanStateWord;
}

/** A lifecycle state by its word: a proposal's flavour inside `proposed`. */
function stateOfWord(word: PlanStateWord): ValueTypeOf<typeof EventStateType> {
    return word === "added" || word === "recommended" || word === "removed"
        ? variant("proposed", variant(word, null))
        : variant(word, null) as ValueTypeOf<typeof EventStateType>;
}

/**
 * Whether the selected events take a gesture now: what the edits' fieldset is on for, and what each of its gestures
 * asks again as it lands.
 *
 * @param events - The selected events
 * @param editing - The event kinds' editing
 * @param canvas - Whether the canvas takes a write now (`PlanChrome.writable`): no run of the optimiser out, nothing standing in
 * @returns Whether the canvas takes a write, and every selected event's kind takes a gesture
 */
function writableFor(events: readonly InspectedEvent[], editing: PlanEventEditing | undefined, canvas: boolean): boolean {
    return canvas && editing !== undefined && events.length > 0 && events.every((event) => editing.available(event.kind.key));
}

/** One selected event, read: its element's key, its kind, and the event as Plan draws it, with its row. */
export interface PlanInspectedEvent {
    /** Its element's key: its event, as East prints a `Schedule.Types.EventRef`. */
    readonly key: string;
    /** Its kind. */
    readonly kind: PlanEventKindValue;
    /** The event as Plan draws it. */
    readonly item: PlanEventItemValue;
    /** Its row, as bytes at its record's entry type. */
    readonly row: Uint8Array;
}

/** One selected event, read. */
type InspectedEvent = PlanInspectedEvent;

/** No event selected: what the pane holds before the selection's first read. */
export const NO_INSPECTED: readonly PlanInspectedEvent[] = NO_EVENTS;

/** One selected link of a link kind (#1541, U10), read: its kind, its row with its drafts in place, and what it joins. */
export interface PlanInspectedLink {
    /** Its key on the canvas: its kind's slot and its row's key, as East prints a reference. */
    readonly key: string;
    /** Its link kind. */
    readonly kind: PlanLinkKindValue;
    /** Its row's key's text. */
    readonly id: string;
    /** Its row, as bytes at its record's row type, its drafts in place. */
    readonly row: Uint8Array;
    /** The event it runs from, by its title — by its key's text where the page holds no such event. */
    readonly from: string;
    /** The event it runs to, named likewise. */
    readonly to: string;
    /** What it moves; none for a link with no quantity. */
    readonly quantity: PlanLinkRolesValue["quantity"];
}

/** No link selected: what the pane holds before the selection's first read, and on a Plan with no link kind. */
export const NO_INSPECTED_LINKS: readonly PlanInspectedLink[] = [];

/** What is selected on the canvas: the row, the bucket a click on it named, and the events. */
export interface PlanInspectorSelection {
    readonly row: RowKey | null;
    readonly at: PlanInstantValue | null;
    readonly elements: readonly string[];
}

/** What is selected on the canvas. */
type PlanSelection = PlanInspectorSelection;

/** Nothing selected — the pane's selection while it shows none. */
const NOTHING: PlanSelection = { row: null, at: null, elements: [] };

const selectSelection = (s: PlanSnapshot): PlanSelection => ({ row: s.store.ui.selected, at: s.store.ui.selectedAt, elements: s.store.ui.elements });
const selectNothing = (): PlanSelection => NOTHING;
// The store keeps each part's identity while it holds.
const sameSelection = (a: PlanSelection, b: PlanSelection): boolean =>
    Object.is(a.row, b.row) && Object.is(a.at, b.at) && Object.is(a.elements, b.elements);

/**
 * What is selected on the canvas, as the inspector shows it: the controller's
 * selection while the Plan has its pane, nothing otherwise.
 *
 * @param shown - Whether the Plan is given its inspector pane
 * @returns The selection — the same object while it holds
 */
export function usePlanInspectorSelection(shown: boolean): PlanInspectorSelection {
    return usePlanSelector(shown ? selectSelection : selectNothing, sameSelection);
}

/** Props of {@link usePlanInspector}. */
export interface PlanInspectorProps {
    /** Whether the Plan is given its inspector pane (`inspector`). */
    shown: boolean;
    /** The event kinds: each selected event is read through its kind. */
    kinds: PlanValue["events"];
    /** The series the event kinds land on (#1541): what a row stands for, and its name. */
    landings: PlanValue["landings"];
    /** The canvas's chrome facts: its scale, its words, and what it reads of its rows; `undefined` with no window. */
    chrome: PlanChrome | undefined;
    /** The event kinds' counts over the window: what the pane shows when nothing is selected. */
    counts: PlanEventCounts | undefined;
    /** The names the Plan keeps its viewer's state under. */
    keys: PlanKeys;
    /** The Plan's words. */
    words: PlanWords;
    /** What is selected on the canvas ({@link usePlanInspectorSelection}). */
    selection: PlanInspectorSelection;
    /** The selected events, read ({@link PlanSelectionReader}). */
    events: readonly PlanInspectedEvent[];
    /** The selected links of the link kinds, read beside them (#1541, U10). */
    links: readonly PlanInspectedLink[];
    /** The ids the viewer hides in the Series tab: a kind hidden there is in no figure of a row's. */
    hidden: readonly string[];
}

/**
 * The selected events, read through their kinds, their drafts in place —
 * tracked, so a commit to a kind's record reads them again; an event no
 * longer there is left out. An event of a kind the cells' reader gives cells
 * (#1039) is read from the rows they hold, which no tracked read listens to:
 * it is read again as they move — the cells a commit reads again.
 *
 * @param kinds - The event kinds
 * @param elements - The selected events, by their elements' keys
 * @param drafts - Every kind's drafts (#1194) — the same object while they hold
 * @param editing - The kinds' editing, which reads an event where the canvas reads its rows (#1199); none without a window
 * @param cellRows - The rows the cells' reader holds of each kind it gives cells — the same object while they hold; none before it hands any on
 * @returns The events, in the order they were selected — the last read's while a read is in flight or has failed
 */
function useSelectedEvents(
    kinds: PlanValue["events"], elements: readonly string[], drafts: EventDrafts, editing: PlanEventEditing | undefined,
    cellRows: ScheduleCellsRead["held"] | undefined,
): readonly InspectedEvent[] {
    const bySlot = useMemo(() => new Map(kinds.map((kind) => [kind.key, kind] as const)), [kinds]);
    const readEvent = editing?.read;
    const read = useCallback((): readonly InspectedEvent[] => {
        const out: InspectedEvent[] = [];
        for (const key of elements) {
            const ref = parseEventRef(key);
            if (!ref.success) continue;
            const kind = bySlot.get(ref.value.kind);
            if (kind === undefined) continue;
            // The editing reads the latest drafts — these, which re-run the read as they move — and the latest rows the
            // cells hold, the kind's here.
            const got = readEvent !== undefined ? readEvent(kind.key, ref.value.key)
                : getSomeorUndefined(kind.planEvent(ref.value.key, drafts.get(ref.value.kind) ?? NO_DRAFTS, NO_RANGE, NO_RANGE,
                    heldRowOf(cellRows, ref.value.kind, ref.value.key)));
            if (got !== undefined) out.push({ key, kind, item: got.item, row: got.row });
        }
        return out;
    }, [bySlot, elements, drafts, readEvent, cellRows]);
    const { result } = useTrackedEvaluation(read);
    const held = useRef<readonly InspectedEvent[]>(NO_EVENTS);
    return useMemo(() => {
        if (!result.ok) {
            console.error("[Plan] the selected events could not be read:", result.error);
            return held.current;
        }
        // The same events as the last read — each read is a new array — hold the last: nothing the pane shows moved.
        if (sameEvents(held.current, result.value)) return held.current;
        held.current = result.value;
        return result.value;
    }, [result]);
}

/** Whether two reads of the selected events read the same: each event's key, kind, drawing and row. */
function sameEvents(a: readonly InspectedEvent[], b: readonly InspectedEvent[]): boolean {
    return a.length === b.length && a.every((event, i) => {
        const other = b[i]!;
        return stringEqual(event.key, other.key) && Object.is(event.kind, other.kind) && itemEqual(event.item, other.item) && blobEqual(event.row, other.row);
    });
}

/**
 * The selected links of the link kinds (#1541, U10), each read as the page
 * holds its row — its drafts in place — and through its kind: tracked, so a
 * commit to a link's record, or to an event it joins, reads them again. A
 * link its drafts removed is left out.
 *
 * @param linkKinds - The link kinds
 * @param elements - What is selected, by its elements' keys
 * @param editing - The Plan's editing, which holds each link kind's session; none without a window
 * @returns The links, in the order they were selected — the last read's while a read has failed
 */
function useSelectedLinks(linkKinds: readonly PlanLinkKindValue[], elements: readonly string[], editing: PlanEventEditing | undefined): readonly PlanInspectedLink[] {
    const read = useCallback((): readonly PlanInspectedLink[] => {
        if (linkKinds.length === 0 || editing === undefined) return NO_INSPECTED_LINKS;
        const out: PlanInspectedLink[] = [];
        for (const key of elements) {
            const named = kindLinkOf(linkKinds, key);
            if (named === undefined) continue;
            const { kind, id } = named;
            // Its row as the page holds it: its session's version, else its record's. None for one its drafts removed.
            const held = editing.row(kind.key, id);
            if (held === undefined || held.type !== "some") continue;
            const row = rowCodec(kind.rowType).encode(held.value);
            const roles = kind.read(row, id);
            out.push({ key, kind, id, row, from: linkEndTitle(editing, roles.from), to: linkEndTitle(editing, roles.to), quantity: roles.quantity });
        }
        return out.length === 0 ? NO_INSPECTED_LINKS : out;
    }, [linkKinds, elements, editing]);
    const { result } = useTrackedEvaluation(read);
    const held = useRef<readonly PlanInspectedLink[]>(NO_INSPECTED_LINKS);
    return useMemo(() => {
        if (!result.ok) {
            console.error("[Plan] the selected links could not be read:", result.error);
            return held.current;
        }
        // The same links as the last read — each read is a new array — hold the last: nothing the pane shows moved.
        if (sameLinks(held.current, result.value)) return held.current;
        held.current = result.value;
        return result.value;
    }, [result]);
}

/** Whether two reads of the selected links read the same: each link's key, kind, row and the names of what it joins. */
function sameLinks(a: readonly PlanInspectedLink[], b: readonly PlanInspectedLink[]): boolean {
    return a.length === b.length && a.every((link, i) => {
        const other = b[i]!;
        return stringEqual(link.key, other.key) && Object.is(link.kind, other.kind) && blobEqual(link.row, other.row)
            && stringEqual(link.from, other.from) && stringEqual(link.to, other.to);
    });
}

/** Props of {@link PlanSelectionReader}. */
export interface PlanSelectionReaderProps {
    /** The event kinds: each selected event is read through its kind. */
    kinds: PlanValue["events"];
    /** The selected events, by their elements' keys. */
    elements: readonly string[];
    /** Every kind's drafts; none for a Plan whose kinds hold none. */
    drafts: EventDrafts | undefined;
    /** The kinds' editing, which reads an event where the canvas reads its rows; none without a window. */
    editing: PlanEventEditing | undefined;
    /** The rows the cells' reader holds of each kind it gives cells (#1039): an event of such a kind is read again as they move. */
    held: ScheduleCellsRead["held"] | undefined;
    /** Where the events go: called only when they move. */
    onRead: (events: readonly PlanInspectedEvent[]) => void;
    /** The link kinds (#1541, U10): each selected link is read through its kind. */
    linkKinds: readonly PlanLinkKindValue[];
    /** Where the selected links go: called only when they move. */
    onLinks: (links: readonly PlanInspectedLink[]) => void;
}

/**
 * The selected events, read in a component of its own (see the module docs):
 * a read that lands re-runs it alone, and it hands the frame the events only
 * when what it read moves.
 *
 * @param props - What is read, and where it goes
 * @returns Nothing: it reads
 */
export function PlanSelectionReader({ kinds, elements, drafts, editing, held, onRead, linkKinds, onLinks }: PlanSelectionReaderProps): null {
    const events = useSelectedEvents(kinds, elements, drafts ?? NONE_DRAFTED, editing, held);
    const links = useSelectedLinks(linkKinds, elements, editing);
    const reported = useRef<readonly InspectedEvent[]>(NO_EVENTS);
    const reportedLinks = useRef<readonly PlanInspectedLink[]>(NO_INSPECTED_LINKS);
    useLayoutEffect(() => {
        // The same events, by identity: the read holds its last while what it read holds.
        if (!Object.is(reported.current, events)) {
            reported.current = events;
            onRead(events);
        }
        if (!Object.is(reportedLinks.current, links)) {
            reportedLinks.current = links;
            onLinks(links);
        }
    });
    return null;
}

/**
 * The inspector pane, as `BuilderFrame` draws it — see the module docs.
 *
 * @param props - Whether it is given, the kinds, the series they land on, the canvas's facts, the counts, the keys, the words, what is selected, the selected events and the ids the viewer hides
 * @returns The pane — 320px wide, its collapsed state kept per viewer, its rail saying what is selected — or `undefined`, no pane, when the Plan is given no inspector
 */
export function usePlanInspector({
    shown, kinds, landings, chrome, counts, keys, words, selection, events, links, hidden,
}: PlanInspectorProps): BuilderFrameDock | undefined {
    const { m } = words;
    // No `inspector`: no pane (#1197).
    if (!shown) return undefined;
    const row = selection.row !== null ? chrome?.inspect.row(selection.row) : undefined;
    // The rail's line: what is selected.
    const detail = events.length === 1 ? events[0]!.item.title
        : events.length > 1 ? m.inspectorEvents({ n: events.length, count: words.number(events.length) })
            // Links alone (#1541, U10): one by the events it joins, several by their count.
            : links.length === 1 ? m.linkEnds({ from: links[0]!.from, to: links[0]!.to })
                : links.length > 1 ? m.inspectorLinks({ n: links.length, count: words.number(links.length) })
                    : row?.gutter.label;
    return {
        label: m.inspectorPane(),
        icon: "sliders",
        size: INSPECTOR_SIZE,
        persist: "local",
        detail,
        body: (
            <PlanInspectorBody selection={selection} events={events} links={links} kinds={kinds} landings={landings} chrome={chrome}
                counts={counts} keys={keys} words={words} hidden={hidden} />
        ),
    };
}

/** Props of the pane's body and its views. */
interface BodyProps {
    selection: PlanSelection;
    events: readonly InspectedEvent[];
    /** The selected links of the link kinds (#1541, U10). */
    links: readonly PlanInspectedLink[];
    kinds: PlanValue["events"];
    /** The series the event kinds land on (#1541). */
    landings: PlanValue["landings"];
    chrome: PlanChrome | undefined;
    counts: PlanEventCounts | undefined;
    keys: PlanKeys;
    words: PlanWords;
    /** The ids the viewer hides in the Series tab. */
    hidden: readonly string[];
}

/**
 * The pane's body: one event, several, a row, or nothing — in a region that keeps the keyboard as a control goes with its
 * view, on the heading of the view drawn in its place (see the module docs).
 */
const PlanInspectorBody = memo(function PlanInspectorBody(props: BodyProps) {
    const styles = useSlotRecipe({ key: "planInspector" })() as Styles;
    const home = useFocusHome();
    return (
        <Box ref={home.ref} css={styles.home} onFocus={home.onFocus} onBlur={home.onBlur} data-inspector-home="">
            {bodyView(props, styles)}
        </Box>
    );
});

/** What the body shows: one event, several, a link or several, a row, or nothing. */
function bodyView(props: BodyProps, styles: Styles): ReactNode {
    const { selection, events, links, chrome } = props;
    // Each event its own view: what one showed never lands on the next.
    if (events.length === 1) return <OneEvent key={events[0]!.key} {...props} styles={styles} event={events[0]!} />;
    if (events.length > 1) return <SeveralEvents {...props} styles={styles} />;
    // Links with no event (#1541, U10): each link its own view too.
    if (links.length === 1) return <OneLink key={links[0]!.key} {...props} styles={styles} link={links[0]!} />;
    if (links.length > 1) return <SeveralLinks {...props} styles={styles} />;
    if (selection.row !== null && chrome !== undefined) {
        const row = chrome.inspect.row(selection.row);
        if (row !== undefined) return <RowView key={row.key} {...props} styles={styles} chrome={chrome} rowKey={row.key} at={selection.at} />;
    }
    return <NothingSelected styles={styles} counts={props.counts} words={props.words} events={props.kinds.length > 0} />;
}

// ============================================================================
// Words
// ============================================================================

/**
 * When an event runs, as its head says it — its day and times, an instant's
 * one time, or that it waits in the backlog.
 *
 * @param item - The event
 * @param instant - Whether its kind's events are each one instant
 * @param w - The Plan's words
 * @returns `Mon, Oct 5, 2026 · 06:00–14:00`
 */
function whenText(item: PlanEventItemValue, instant: boolean, w: PlanWords): string {
    const start = getSomeorUndefined(item.start);
    const end = getSomeorUndefined(item.end);
    if (start === undefined || end === undefined) return w.m.inspectorUnscheduled();
    if (instant) return w.m.inspectorWhen({ day: w.weekdayDate(start), from: w.time(start), endDay: undefined, to: undefined });
    return spanText(start, end, w);
}

/**
 * A span as the inspector says it — its day and times, its end's day too
 * when it ends on another.
 *
 * @param start - When it starts
 * @param end - When it ends
 * @param w - The Plan's words
 * @returns `Tue, Oct 20, 2026 · 10:00–12:00`
 */
function spanText(start: Date, end: Date, w: PlanWords): string {
    const day = w.weekdayDate(start);
    const endDay = w.weekdayDate(end);
    return w.m.inspectorWhen({ day, from: w.time(start), endDay: stringEqual(endDay, day) ? undefined : endDay, to: w.time(end) });
}

// ============================================================================
// Overlaps (#1198, PB53)
// ============================================================================

/** The glyph an overlaps banner leads with. */
const OVERLAP_ICON = { prefix: "fas", name: "triangle-exclamation" } as const;

/** The glyph a locked event's banner leads with (#1541, U9). */
const LOCK_ICON = { prefix: "fas", name: "lock" } as const;

/** One line of an overlaps banner: the events it selects, when, and what. */
interface OverlapLine {
    /** The events a click selects, by their elements' keys. */
    readonly keys: readonly string[];
    /** When: the event's span, or the pair's overlap. */
    readonly when: string;
    /** What: the event's title, or the pair's. */
    readonly title: string;
}

/**
 * An overlaps banner — the shared `Banner` in its guard tone, as the
 * Calendar's inspector draws it (§8): its title, and a line per event or pair,
 * each a button that selects what it names and brings it into view.
 */
function OverlapsBanner({ styles, title, lines, onSelect }: {
    styles: Styles; title: string; lines: readonly OverlapLine[]; onSelect: (keys: readonly string[]) => void;
}) {
    return (
        <Box css={styles.overlaps} data-inspector-overlaps="">
            <BannerView status="guard" icon={OVERLAP_ICON} title={title} description={(
                <Box as="ul" css={styles.overlapList}>
                    {lines.map((line) => {
                        const at = line.keys.join(" ");
                        return (
                            <Box as="li" key={at} css={styles.overlapLine}>
                                <chakra.button type="button" css={styles.overlapItem} data-inspector-overlap={at} onClick={() => onSelect(line.keys)}>
                                    <Box as="span" css={styles.overlapWhen}>{line.when}</Box>
                                    <Box as="span" css={styles.overlapTitle}>{line.title}</Box>
                                </chakra.button>
                            </Box>
                        );
                    })}
                </Box>
            )} />
        </Box>
    );
}

/**
 * A resource by its name: its landing row's label on the canvas (#1541), else
 * its row's read by its key (#1199) — over rows read a page at a time, one the
 * canvas does not hold — else, until that read lands, its key.
 *
 * @param ref - The resource an event is on, if any
 * @param names - The names the view's resources are known by ({@link usePlanResourceNames})
 * @param w - The Plan's words
 * @returns Its name, or `Unassigned`
 */
function resourceText(ref: PlanEventItemValue["resource"], names: PlanResourceNames, w: PlanWords): string {
    const at = getSomeorUndefined(ref);
    if (at === undefined) return w.m.inspectorUnassigned();
    return names(at) ?? at.key;
}

/**
 * The group strip a row is drawn under: its nearest parent that is a group's
 * row, by its name — what a resources series laid beneath a `Plan.series.group`
 * is grouped by (#1541).
 *
 * @param row - The row
 * @param inspect - What the pane reads of the canvas's rows
 * @returns The group's name; `undefined` for a row under none
 */
function groupOf(row: PlanRowValue, inspect: PlanChrome["inspect"]): string | undefined {
    for (let up = row.parent; up.type === "some";) {
        const parent = inspect.row(up.value);
        if (parent === undefined) return undefined;
        if (parent.kind.type === "group") return parent.gutter.label;
        up = parent.parent;
    }
    return undefined;
}

/** How long minutes run, in hours to one place — `26.5`. */
function hoursText(minutes: number, w: PlanWords): string {
    return w.number(Math.round(minutes / 6) / 10);
}

// ============================================================================
// The edits (#1194, PB42, PB60)
// ============================================================================

/** No key a gesture has made yet. */
const NONE_MINTED: ReadonlySet<string> = new Set();

/** What a new event's form is tinted against: nothing — every field it has is a change. */
const NEW_EVENT: Readonly<Record<string, unknown>> = {};

/** Whether two field paths are one. */
function samePath(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((step, i) => stringEqual(step, b[i]!));
}

/** A gesture's label in the history, over one event or several — canonical English, as every history's labels are. */
function labelOf(verb: string, events: readonly InspectedEvent[]): string {
    return events.length === 1 ? `${verb} ${events[0]!.item.title}` : `${verb} ${events.length} events`;
}

/**
 * Whether every event can be duplicated: its kind's keys are ones a new key
 * is made of (String or Integer).
 */
function canDuplicate(events: readonly InspectedEvent[], editing: PlanEventEditing | undefined): boolean {
    return editing !== undefined && events.every((event) => editing.mint(event.kind.key, event.item.key, NONE_MINTED) !== undefined);
}

/**
 * Duplicate: a copy of each event under a new key, its row as drafted — one
 * transaction — and the copies then selected, on the row given.
 *
 * @param events - The events
 * @param editing - The event kinds' editing
 * @param chrome - The canvas's facts: what selects the copies
 * @param row - The row the copies are selected on: the selection's
 */
function duplicateEvents(events: readonly InspectedEvent[], editing: PlanEventEditing | undefined, chrome: PlanChrome | undefined, row: RowKey | null): void {
    if (editing === undefined) return;
    const minted = new Set<string>();
    const changes: PlanEventChange[] = [];
    const copies: string[] = [];
    for (const event of events) {
        const id = editing.mint(event.kind.key, event.item.key, minted);
        if (id === undefined) continue;
        minted.add(id);
        // A copy is a new event: absent before it, read nowhere (#1199).
        changes.push({ kind: event.kind.key, id, row: event.row, created: true });
        copies.push(printEventRef({ kind: event.kind.key, key: id }));
    }
    if (editing.record(changes, "insert", labelOf("Duplicate", events))) chrome?.selectEvents(copies, row ?? undefined);
}

/**
 * Delete: each event, as one transaction — and each link of a link kind selected with them (#1541, U10), as the Delete
 * key takes the whole selection. What stays selected is what stayed: an event its kind's lock holds where it is
 * (#1541, U9).
 *
 * @param events - The events to remove
 * @param editing - The event kinds' editing
 * @param chrome - The canvas's selection commands
 * @param links - The links selected with them; none unless given
 * @param kept - The selected events left where they are: the locked ones, which the pane goes on showing
 */
function deleteEvents(events: readonly InspectedEvent[], editing: PlanEventEditing | undefined, chrome: PlanChrome | undefined,
    links: readonly PlanInspectedLink[] = NO_INSPECTED_LINKS, kept: readonly InspectedEvent[] = []): void {
    const keys = [...events.map((event) => event.key), ...links.map((link) => link.key)];
    const label = links.length === 0 ? labelOf("Delete", events) : linkStepLabel("Delete", links.map((link) => link.kind), events.length);
    const stayed = removePlanEvents(keys, editing, label);
    if (stayed !== undefined) chrome?.selectEvents([...kept.map((event) => event.key), ...stayed]);
}

// ============================================================================
// One event (PB38, PB60)
// ============================================================================

/** Props of {@link OneEvent}. */
interface OneEventProps extends BodyProps {
    styles: Styles;
    event: InspectedEvent;
}

/**
 * One fact: its label and its value. A fact a field of the event's row is drawn as — its state, its lane, and its
 * quantity where no form draws it, none of which a control edits here — takes the keyboard where an issue gone to asks
 * for that field (`focusable`): by script, out of the tab order, named by its label and its value.
 */
function Fact({ styles, label, value, fact, focusable = false }: { styles: Styles; label: string; value: ReactNode; fact: string; focusable?: boolean }) {
    const id = useId();
    return (
        <>
            <Box as="dt" id={`${id}-label`} css={styles.factLabel}>{label}</Box>
            <Box as="dd" id={`${id}-value`} css={styles.factValue} data-fact={fact}
                {...(focusable ? { tabIndex: -1, "aria-labelledby": `${id}-label ${id}-value` } : {})}>{value}</Box>
        </>
    );
}

/**
 * Gives the keyboard to a fact an issue gone to asks for, as the form gives it to a field it draws: at once where it
 * shows, else once it does — the browser gives it to nothing hidden, and a change of an element around the fact (the
 * pane unfolded) is when it may show — and brings it into view.
 *
 * @param fact - The fact's value
 * @returns What stops the wait, while it waits; `undefined` once the fact has the keyboard
 */
function takeFactWhenShown(fact: HTMLElement): (() => void) | undefined {
    const take = (): boolean => {
        if (typeof fact.checkVisibility === "function" && !fact.checkVisibility()) return false;
        fact.focus({ preventScroll: true });
        fact.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        return true;
    };
    if (take()) return undefined;
    const observer = new MutationObserver((records) => {
        if (records.some((record) => record.target.contains(fact)) && take()) observer.disconnect();
    });
    observer.observe(fact.ownerDocument.documentElement, { attributes: true, subtree: true });
    return () => observer.disconnect();
}

/**
 * The fact a field is drawn as among an event's facts, where a role reads it.
 *
 * @param roles - The fields its kind's roles read
 * @param field - The field, by its form's key
 * @returns Its fact; `undefined` for a field no role reads, which its form draws
 */
function roleFactOf(roles: PlanEventKindValue["roles"], field: string): "quantity" | "state" | "lane" | undefined {
    const reads = (role: option<string>) => role.type === "some" && stringEqual(role.value, field);
    return reads(roles.quantity) ? "quantity" : reads(roles.state) ? "state" : reads(roles.lane) ? "lane" : undefined;
}

/** One event: its head, its overlaps, its facts, its fields or its kind's own inspector, and its gestures. */
function OneEvent({ event, keys, words, styles, counts, chrome, selection, links }: OneEventProps) {
    const { m } = words;
    const button = useRecipe({ key: "button" });
    const { kind } = event;
    const item = event.item;
    const roles = kind.roles;
    // Its resource, by name: read by its key where the canvas does not hold its row (#1199, #1541).
    const names = usePlanResourceNames(chrome?.inspect, useNamedResource(getSomeorUndefined(item.resource)));
    // Its edits (#1194): steps of the Plan's one history, on while the canvas takes a write and its kind a gesture.
    const editing = chrome?.events;
    // A locked event takes none (#1541, U9): its form is read only, and Duplicate — whose copy its kind's rule would
    // hold too — and Delete are off.
    const writable = writableFor([event], editing, chrome?.writable === true) && !item.locked;
    // What its gestures ask as they land — this render's — so the kind's own inspector, handed `update`, is not made
    // again as the edits turn off and on.
    const writes = useRef(writable);
    writes.current = writable;
    // The event as a link's start (#1541, U10): what Connect to… draws from.
    const source = useMemo((): PlanLinkSource => ({ key: event.key, rowKey: selection.row ?? undefined }), [event.key, selection.row]);
    // What it overlaps (#1198, PB53): its kind's events on its resource at once — a line each, which selects it.
    const peers = counts?.overlaps.peers.get(event.key) ?? [];
    const start = getSomeorUndefined(item.start);
    const end = getSomeorUndefined(item.end);
    const lane = getSomeorUndefined(item.lane);
    const quantity = getSomeorUndefined(item.quantity);
    const status = getSomeorUndefined(item.status);

    // Its row, held by its data: a read that brings the same row again draws nothing new.
    const row = useDataStable(event.row, blobEqual);
    const rowType = useMemo(() => fromEastTypeValue(kind.editing.entryType) as StructType, [kind.editing.entryType]);
    const value = useMemo(() => decodeBeast2For(rowType)(row), [rowType, row]);
    // The kind's form, but the fields its state and its lane read: each has its own line here. Its quantity is a number
    // typed like any other, so the form draws it, its bounds said under it (#1680's review).
    const specs = useMemo(() => {
        const roleFields = [roles.state, roles.lane].flatMap((field) => (field.type === "some" ? [field.value] : []));
        return kind.fields.filter((spec) => !roleFields.some((field) => stringEqual(field, spec.path[0]!)));
    }, [kind.fields, roles]);
    // The bound its quantity breaks, of those a hint gives its field in the kind's form (#1585): said on a line of its own
    // under it, as the form's help line says one.
    const quantityBreach = useMemo(() => {
        const field = getSomeorUndefined(roles.quantity);
        return field === undefined ? undefined : fieldBreaches(kind.fields.filter((spec) => samePath(spec.path, [field])), value)[0];
    }, [kind.fields, roles.quantity, value]);
    const fieldStyles = useSlotRecipe({ key: "field" })() as Styles;
    // What its record holds (PB42): what a drafted field is tinted against — a new event's every field, against
    // nothing. An event its drafts do not hold stands as its record holds it (#1199: a kind read a window at a time
    // holds no snapshot to read it from).
    const drafted = editing?.draftsOf(kind.key).has(item.key) === true;
    const held = editing?.held(kind.key, item.key) ?? (drafted ? NEW_EVENT : value);
    // Its refusals holding Save (#1525): the app's `ready` refusing it while it stands, each field one names ringed, the
    // app's words for it under it.
    const refusals = entryRefusals(editing?.sessions ?? [], kind.key, item.key);
    const refused = refusedFields(refusals);
    // What they say of a field a role reads, under its fact, which is where the Plan draws it — less the bound its
    // quantity breaks, which its fact's own line says: a readiness raises a breach as an issue in the bound's words.
    const factIssue = (role: option<string>, bound?: (typeof quantityBreach)): ReactNode => {
        if (role.type !== "some") return null;
        const bounds = bound === undefined ? [] : [fieldBreachIssue(bound, { entry: item.key }).message, fieldBreachText(bound, { ...words, m: fieldFormMessages })];
        const said = (refused.get(role.value) ?? []).filter((line) => !bounds.some((text) => stringEqual(text, line)));
        return said.length === 0 ? null : <Box css={fieldStyles.helperText} data-field-issue="" data-fact-issue="">{said.join(" · ")}</Box>;
    };
    // A bound its row breaks (#1585), said in the tone its Save stands in: a row as stored warns, holding no Save; a
    // changed one's is refused, holding Save — an error.
    const breaches = breachTone(refusals);
    const focus = useFieldAsk(kind.key, item.key);
    // The form's draws: one more each time an edit records nothing, so its fields show what the row holds again.
    const [redraws, setRedraws] = useState(0);
    // A field edited (PB42): one transaction, written through the kind's own `write`, its value as bytes at the field's type.
    // One that records nothing — the edits off meanwhile, the write turning it down, nothing changed — draws the form
    // again, with nothing to say (#1585).
    const onField = useCallback((path: readonly string[], next: unknown) => {
        // The form's edit as its kind writes it: the one rule every builder's inspector shares (`fieldChange`).
        const change = specs.some((s) => samePath(s.path, path)) ? fieldChange(kind, item.key, path, next) : undefined;
        if (editing === undefined || change === undefined) return;
        if (!writes.current || !editing.record([change], "typed", labelOf("Edit", [event]))) {
            setRedraws((n) => n + 1);
        }
    }, [editing, specs, kind, item.key, event]);
    // The kind's own inspector's `update` (PB60): the edited event, whole, one transaction — none while the edits are off,
    // whatever control of the kind's own the fieldset does not reach.
    const update = useCallback((edited: Uint8Array): null => {
        if (writes.current) editing?.record([{ kind: kind.key, id: item.key, row: edited }], "typed", labelOf("Edit", [event]));
        return null;
    }, [editing, kind.key, item.key, event]);
    // The kind's own inspector (PB60): what it returns for the event, in place of the form.
    const author = getSomeorUndefined(kind.inspector);
    const own = useMemo(() => {
        if (author === undefined) return undefined;
        try {
            return author(row, update);
        } catch (err) {
            console.error(`[Plan] ${kind.name}'s own inspector failed; its form shows instead:`, err);
            return undefined;
        }
    }, [author, row, kind.name, update]);
    // Its quantity in the form, which draws its field: its fact is then no line of its own, and the form says its bound.
    const quantityField = getSomeorUndefined(roles.quantity);
    const quantityInForm = own === undefined && quantityField !== undefined && specs.some((spec) => samePath(spec.path, [quantityField]));
    // A field asked of it that the form draws no control of takes the keyboard on its fact, its line in Details.
    const asked = focus === undefined ? undefined : roleFactOf(roles, focus);
    const askedFact = asked === "quantity" && quantityInForm ? undefined : asked;
    const facts = useRef<HTMLDivElement | null>(null);
    const taking = useRef<(() => void) | undefined>(undefined);
    useEffect(() => {
        if (askedFact === undefined) return;
        taking.current?.();
        const fact = facts.current?.querySelector<HTMLElement>(`[data-fact="${askedFact}"]`);
        taking.current = fact === null || fact === undefined ? undefined : takeFactWhenShown(fact);
    }, [askedFact]);
    useEffect(() => () => taking.current?.(), []);

    return (
        <Box css={styles.root} data-plan-inspector="event">
            <ScheduleInspectorHead styles={styles} kind={kind} title={item.title} when={whenText(item, kind.instant, words)} status={status} home />
            {/* Under the head, as the Calendar's inspector has it (§8) — and out
                of the edits' fieldset, so its lines select while that is disabled. */}
            {peers.length > 0 && chrome !== undefined && (
                <OverlapsBanner styles={styles}
                    title={m.inspectorOverlaps({ n: peers.length, count: words.number(peers.length), on: resourceText(item.resource, names, words) })}
                    lines={peers.map((peer) => ({ keys: [scheduleEventKey(peer)], when: whenText(peer, kind.instant, words), title: peer.title }))}
                    onSelect={chrome.selectEvents} />
            )}
            {/* That it is locked (#1541, U9): why its form is read only and its gestures off. */}
            {item.locked && (
                <Box css={styles.locked} data-inspector-locked="">
                    <BannerView status="neutral" icon={LOCK_ICON} title={m.inspectorLocked()} description={m.inspectorLockedDetail()} />
                </Box>
            )}
            {/* Over its form, as the Calendar's inspector shows an event's: each refusal's field by its form's label. */}
            {refusals.length > 0 && (
                <Box css={styles.refusals} data-inspector-refusals="">
                    <BannerView status="warning" title={m.inspectorRefusals()} description={refusalsText(refusals, kind.fields)} />
                </Box>
            )}
            <Box as="dl" ref={facts} css={styles.facts} data-inspector-facts="">
                <Fact styles={styles} fact="resource" label={m.inspectorFact({ fact: "resource" })} value={resourceText(item.resource, names, words)} />
                {start !== undefined && end !== undefined && (kind.instant
                    ? <Fact styles={styles} fact="at" label={m.inspectorFact({ fact: "at" })} value={words.dateTime(start)} />
                    : (
                        <>
                            <Fact styles={styles} fact="start" label={m.inspectorFact({ fact: "start" })} value={words.dateTime(start)} />
                            <Fact styles={styles} fact="end" label={m.inspectorFact({ fact: "end" })} value={words.dateTime(end)} />
                        </>
                    ))}
                {lane !== undefined && <Fact styles={styles} fact="lane" label={m.inspectorFact({ fact: "lane" })} value={<>{lane}{factIssue(roles.lane)}</>} focusable />}
                {roles.state.type === "some" && <Fact styles={styles} fact="state" label={m.inspectorFact({ fact: "state" })} value={<>{stateText(item.state, words)}{factIssue(roles.state)}</>} focusable />}
                {quantity !== undefined && !quantityInForm && <Fact styles={styles} fact="quantity" label={m.inspectorFact({ fact: "quantity" })} focusable value={<>
                    {quantityText(quantity, words)}
                    {/* A line of its own, in the form's help line's style and the tone its Save stands in. */}
                    {quantityBreach !== undefined && (
                        <Box css={fieldStyles.helperText} data-breach={breaches} data-fact-breach="">{fieldBreachText(quantityBreach, { ...words, m: fieldFormMessages })}</Box>
                    )}
                    {factIssue(roles.quantity, quantityBreach)}
                </>} />}
            </Box>
            <chakra.fieldset css={styles.edits} disabled={!writable} data-inspector-edits="">
                {own !== undefined ? (
                    <Box css={styles.fields} data-inspector-fields="custom">
                        <Box css={styles.custom}>
                            <EastChakraComponent value={own} storageKey={`${keys.frame}.inspector.${kind.key}`} />
                        </Box>
                    </Box>
                ) : specs.length > 0 && (
                    <Box css={styles.fields} data-inspector-fields="form">
                        <FieldForm key={redraws} specs={specs} value={value} baseline={held} issues={refused} focus={focus} breaches={breaches}
                            onChange={editing !== undefined ? onField : NO_EDIT} />
                    </Box>
                )}
                {/* Connect to… (#1541, U10): the keyboard's way to draw a link from the event. */}
                {chrome?.tools !== undefined && editing !== undefined && (
                    <ConnectTo styles={styles} words={words} tools={chrome.tools} from={source}
                        kind={kind.key} events={chrome.inspect.events} editing={editing} writes={writes} />
                )}
                <Box css={styles.actions} data-inspector-actions="">
                    <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} disabled={!canDuplicate([event], editing)}
                        data-inspector-action="duplicate" onClick={() => { if (writes.current) duplicateEvents([event], editing, chrome, selection.row); }}>
                        {m.inspectorAction({ action: "duplicate" })}
                    </chakra.button>
                    <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} data-inspector-action="delete"
                        onClick={() => { if (writes.current) deleteEvents([event], editing, chrome, links); }}>
                        {m.inspectorAction({ action: "delete" })}
                    </chakra.button>
                </Box>
            </chakra.fieldset>
        </Box>
    );
}

// ============================================================================
// Connect to… (#1541, U10)
// ============================================================================

/** The form Connect to… is: the link kind it draws, by its slot, and the event it runs to, by its element's key. */
const CONNECT_KIND = "kind";
const CONNECT_TO = "to";

/** Props of {@link ConnectTo}. */
interface ConnectToProps {
    styles: Styles;
    words: PlanWords;
    /** The tools' chrome: the editable link kinds, the kind Connect draws, and what draws a link. */
    tools: PlanToolsChrome;
    /** The selected event: its element's key, and the row it is on. */
    from: PlanLinkSource;
    /** Its kind's slot. */
    kind: string;
    /** The events the canvas draws of the kinds given. */
    events: PlanChrome["inspect"]["events"];
    /** The Plan's editing: what an event is named by. */
    editing: PlanEventEditing;
    /** Whether the pane takes an edit now. */
    writes: { readonly current: boolean };
}

/**
 * An event's Connect to… (#1541, U10): the keyboard's way to draw a link — a chooser over the events the canvas
 * draws that a link of the kind may run to from it, and, while several link kinds may run from it, the kind, which
 * the toolbar's Connect menu follows. A choice draws the link, one step, as a Connect drag from the event onto the
 * one chosen does, and the chooser is clear again for the next; refused — its kind's end, or the Plan's `canConnect`
 * — the field says why, and nothing is drawn. No link kind running from the event's kind, there is none.
 */
function ConnectTo({ styles, words, tools, from, kind: slot, events, editing, writes }: ConnectToProps) {
    const m = words.m;
    // The chooser is drawn again, clear, once a link is drawn.
    const [drawn, setDrawn] = useState(0);
    // The link kinds that may run from the event: its kind among their start's slots.
    const choices = useMemo(() => tools.kinds.filter((kind) => kind.ends.from.some((end) => stringEqual(end, slot))), [tools.kinds, slot]);
    const kind = choices.find((choice) => tools.held.link !== undefined && stringEqual(choice.key, tools.held.link)) ?? choices[0];
    const specs = useMemo((): FieldSpecValue[] => {
        const reference = (path: string, label: string): FieldSpecValue => ({
            path: [path], label, help: none, group: none, type: toEastTypeValue(OptionType(StringType)), optional: true,
            editor: variant("reference", { of: path }),
        });
        return [
            ...(choices.length > 1 ? [reference(CONNECT_KIND, m.inspectorConnectField({ field: "kind" }))] : []),
            reference(CONNECT_TO, m.inspectorConnectField({ field: "to" })),
        ];
    }, [choices.length, m]);
    const to = kind?.ends.to;
    const options = useMemo(() => ({
        [CONNECT_KIND]: choices.map((choice): FieldOption => ({ key: choice.key, label: choice.name })),
        // The events its end may hold, but the event itself: a link joins two.
        [CONNECT_TO]: to === undefined ? [] : events(to).filter((key) => !stringEqual(key, from.key)).flatMap((key): FieldOption[] => {
            const ref = parseEventRef(key);
            return ref.success ? [{ key, label: linkEndTitle(editing, ref.value) }] : [];
        }),
    }), [choices, to, events, from.key, editing]);
    const value = useMemo(() => ({ [CONNECT_KIND]: kind === undefined ? none : some(kind.key), [CONNECT_TO]: none }), [kind]);
    const onChange = useCallback((path: readonly string[], next: unknown): string | void => {
        if (kind === undefined || !writes.current) return undefined;
        const chosen = getSomeorUndefined(next as option<string>);
        if (stringEqual(path[0]!, CONNECT_KIND)) {
            if (chosen !== undefined) tools.pick({ tool: tools.held.tool, link: chosen });
            return undefined;
        }
        if (chosen === undefined) return undefined;
        const refusal = tools.refusal(kind, from, chosen);
        if (refusal !== undefined) return refusal;
        if (tools.draw(kind, from, chosen)) setDrawn((n) => n + 1);
        return undefined;
    }, [kind, tools, from, writes]);
    if (kind === undefined) return null;
    return (
        <Box css={styles.fields} data-inspector-fields="connect" role="group" aria-label={m.inspectorConnect({ kind: kind.name })}>
            <FieldForm key={drawn} specs={specs} value={value} options={options} onChange={onChange} />
        </Box>
    );
}

// ============================================================================
// Several events (PB39)
// ============================================================================

/** Props of {@link SeveralEvents}. */
interface SeveralProps extends BodyProps {
    styles: Styles;
}

/** Several events: how many, each kind's count, the list, and the bulk edit. */
function SeveralEvents({ events: selected, kinds, landings, words, styles, chrome, selection, links }: SeveralProps) {
    const { m } = words;
    const button = useRecipe({ key: "button" });
    // The events a gesture reaches (#1541, U9): those not locked. A locked one is listed and counted with the rest, and
    // every gesture — the bulk edit, a shift, Duplicate, Delete — leaves it as it is.
    const events = useMemo(() => selected.filter((event) => !event.item.locked), [selected]);
    const locked = selected.length - events.length;
    // The resources the events are on, by name: each read by its key where the canvas does not hold its row (#1199, #1541).
    const named = useMemo(() => resourcesNamed(events.map((e) => getSomeorUndefined(e.item.resource))), [events]);
    const names = usePlanResourceNames(chrome?.inspect, named);
    // Its edits (#1194): steps of the Plan's one history, on while the canvas takes a write and every selected kind a gesture.
    const editing = chrome?.events;
    const writable = writableFor(events, editing, chrome?.writable === true);
    // Each kind's count, in the kinds' order: of every event selected.
    const counted = kinds
        .map((kind) => ({ kind, n: selected.filter((e) => stringEqual(e.kind.key, kind.key)).length }))
        .filter(({ n }) => n > 0);
    // The kinds the bulk edit reaches: those with an event not locked.
    const selectedKinds = counted.map(({ kind }) => kind).filter((kind) => events.some((e) => stringEqual(e.kind.key, kind.key)));
    // The bulk edit's state and resource, as the form draws a choice and a reference: each an
    // Option — Not set where the events differ — its spec's type the Option, as the form reads one.
    const specs = useMemo((): FieldSpecValue[] => {
        const out: FieldSpecValue[] = [];
        if (selectedKinds.some((kind) => kind.roles.state.type === "some")) {
            out.push({
                path: ["state"], label: m.inspectorFact({ fact: "state" }), help: none, group: none,
                type: toEastTypeValue(OptionType(STATE_CHOICE)), optional: true,
                editor: variant("select", STATES.map((state) => ({ case: state, label: m.state({ state }) }))),
            });
        }
        if (selectedKinds.some((kind) => kind.takes.length > 0)) {
            out.push({
                path: ["resource"], label: m.inspectorFact({ fact: "resource" }), help: none, group: none,
                type: toEastTypeValue(OptionType(StringType)), optional: true, editor: variant("reference", { of: "resource" }),
            });
        }
        return out;
    }, [selectedKinds, m]);
    // The resources of the series the selected kinds land on (#1541), as the canvas holds them — the rows the rail shows,
    // each by its landing row's name — then those the selected events are on, each by its row's name, else its key. Over
    // rows read a page at a time the canvas never holds a series whole: the events' own alone.
    const options = useMemo(() => {
        const slots = selectedKinds.flatMap((kind) => kind.takes);
        const out: FieldOption[] = [];
        const listed = new Set<string>();
        const add = (kind: string, key: string, label: string): void => {
            const option = printResource({ kind, key });
            if (listed.has(option)) return;
            listed.add(option);
            out.push({ key: option, label });
        };
        for (const landing of landings) {
            if (!slots.some((slot) => stringEqual(slot, landing.key))) continue;
            for (const row of chrome?.inspect.resources(landing.key) ?? []) {
                const key = resourceKeyOf(row.id);
                if (key !== undefined) add(landing.key, key, row.gutter.label);
            }
        }
        for (const e of events) {
            const at = getSomeorUndefined(e.item.resource);
            if (at !== undefined) add(at.kind, at.key, resourceText(e.item.resource, names, words));
        }
        return { resource: out };
    }, [selectedKinds, landings, chrome, events, names, words]);
    // The form's value: the state, and the resource, every selected event that has one shares — Not set where they differ.
    const shared = useMemo(() => {
        const states = events.filter((e) => e.kind.roles.state.type === "some").map((e) => stateWordOf(e.item.state));
        const refs = events.filter((e) => e.kind.takes.length > 0).map((e) => e.item.resource);
        const first = refs[0];
        return {
            state: states.length > 0 && states.every((word) => stringEqual(word, states[0]!)) ? some(variant(states[0]!, null)) : none,
            resource: first !== undefined && first.type === "some" && refs.every((ref) => resourceEqual(ref, first)) ? some(printResource(first.value)) : none,
        };
    }, [events]);
    // The bulk form's draws: one more each time a choice records nothing, so its fields show what the events share again.
    const [redraws, setRedraws] = useState(0);
    // The bulk edit (PB39): over every selected event that takes it, across kinds, one transaction. A choice that records
    // nothing — the edits off meanwhile, Not set, the kinds' own writes turning it down — draws the form again, with
    // nothing to say (#1585).
    const onBulk = useCallback((path: readonly string[], next: unknown) => {
        const recorded = (): boolean => {
            if (editing === undefined || !writable) return false;
            if (samePath(path, ["state"])) {
                // A state chosen: written into each event whose kind reads one, at its state field.
                const chosen = getSomeorUndefined(next as option<ValueTypeOf<typeof STATE_CHOICE>>);
                if (chosen === undefined) return false;
                const value = encodeState(stateOfWord(chosen.type as PlanStateWord));
                const changes = events.flatMap((e): PlanEventChange[] => {
                    const field = e.kind.roles.state;
                    return field.type === "some" ? [{ kind: e.kind.key, id: e.item.key, gesture: variant("field", { path: [field.value], value }) }] : [];
                });
                return editing.record(changes, "typed", labelOf("Set the state of", events));
            }
            if (samePath(path, ["resource"])) {
                // A resource chosen, or none: each scheduled event whose kind is placed on its kind, moved onto it, its times kept.
                const chosen = getSomeorUndefined(next as option<string>);
                const read = chosen === undefined ? undefined : parseResource(chosen);
                if (read !== undefined && !read.success) return false;
                const ref = read === undefined ? none : some(read.value);
                const changes = events.flatMap((e): PlanEventChange[] => {
                    const start = getSomeorUndefined(e.item.start);
                    const end = getSomeorUndefined(e.item.end);
                    if (start === undefined || end === undefined) return [];
                    if (ref.type === "some" && !e.kind.takes.some((slot) => stringEqual(slot, ref.value.kind))) return [];
                    return [{ kind: e.kind.key, id: e.item.key, gesture: variant("place", { start, end, resource: ref }) }];
                });
                return editing.record(changes, "move", labelOf("Move", events));
            }
            return false;
        };
        if (!recorded()) setRedraws((n) => n + 1);
    }, [editing, events, writable]);
    // A shift in time (PB39): every scheduled event a day or an hour either way, on its resource, one transaction.
    const shift = (by: -1 | 1, unit: "day" | "hour") => {
        if (editing === undefined || !writable) return;
        const ms = by * (unit === "day" ? 86_400_000 : 3_600_000);
        const changes = events.flatMap((e): PlanEventChange[] => {
            const start = getSomeorUndefined(e.item.start);
            const end = getSomeorUndefined(e.item.end);
            if (start === undefined || end === undefined) return [];
            const place = { start: new Date(start.getTime() + ms), end: new Date(end.getTime() + ms), resource: e.item.resource };
            return [{ kind: e.kind.key, id: e.item.key, gesture: variant("place", place) }];
        });
        editing.record(changes, "move", labelOf("Shift", events));
    };
    return (
        <Box css={styles.root} data-plan-inspector="events">
            <Box css={styles.head} {...FOCUS_HOME_PROPS}>
                <Box css={styles.summary} data-inspector-several="">{m.inspectorEvents({ n: selected.length, count: words.number(selected.length) })}</Box>
                <Box css={styles.marks}>
                    {counted.map(({ kind, n }) => (
                        <Box as="span" key={kind.key} css={styles.chip} data-inspector-kind-count={kind.key}>
                            {m.inspectorKindCount({ kind: kind.name, n, count: words.number(n) })}
                        </Box>
                    ))}
                </Box>
            </Box>
            <Box as="ul" css={styles.list} data-inspector-list="">
                {selected.map((event) => (
                    <Box as="li" key={event.key} css={styles.listItem} data-inspector-event={event.key} data-locked={event.item.locked ? "" : undefined}>
                        <FontAwesomeIcon icon={["fas", (event.item.locked ? LOCK_ICON.name : event.kind.icon) as IconName]} />
                        <Box css={styles.listText}>
                            <Box as="span" css={styles.listTitle}>{event.item.title}</Box>
                            <Box as="span" css={styles.listWhen}>{whenText(event.item, event.kind.instant, words)}</Box>
                        </Box>
                    </Box>
                ))}
            </Box>
            {/* How many are locked (#1541, U9), which no gesture below reaches. */}
            {locked > 0 && (
                <Box css={styles.locked} data-inspector-locked="">
                    <BannerView status="neutral" icon={LOCK_ICON} title={m.inspectorLockedCount({ n: locked, count: words.number(locked) })} />
                </Box>
            )}
            <chakra.fieldset css={styles.edits} disabled={!writable} data-inspector-edits="">
                <Box css={styles.bulk} data-inspector-bulk="">
                    <Box css={styles.sectionHead}>{m.inspectorSection({ section: "bulk" })}</Box>
                    {specs.length > 0 && <FieldForm key={redraws} specs={specs} value={shared} options={options} onChange={onBulk} />}
                    <Box css={styles.shift} role="group" aria-label={m.inspectorShiftLabel()} data-inspector-shift="">
                        {([[-1, "day"], [-1, "hour"], [1, "hour"], [1, "day"]] as const).map(([by, unit]) => (
                            <chakra.button key={`${by}${unit}`} type="button" css={button({ variant: "outline", size: "xs" })}
                                data-inspector-action={`shift:${by}${unit}`} onClick={() => shift(by, unit)}>
                                {m.inspectorShift({ by, unit })}
                            </chakra.button>
                        ))}
                    </Box>
                </Box>
                <Box css={styles.actions} data-inspector-actions="">
                    <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} disabled={!canDuplicate(events, editing)}
                        data-inspector-action="duplicate" onClick={() => { if (writable) duplicateEvents(events, editing, chrome, selection.row); }}>
                        {m.inspectorAction({ action: "duplicate" })}
                    </chakra.button>
                    <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} data-inspector-action="delete"
                        onClick={() => { if (writable) deleteEvents(events, editing, chrome, links, selected.filter((event) => event.item.locked)); }}>
                        {m.inspectorAction({ action: "delete" })}
                    </chakra.button>
                </Box>
            </chakra.fieldset>
        </Box>
    );
}

// ============================================================================
// A link kind's link (#1541, U10)
// ============================================================================

/** Removes the selected links, as one step of the history, and leaves nothing selected. */
function deleteLinks(links: readonly PlanInspectedLink[], editing: PlanEventEditing | undefined, chrome: PlanChrome | undefined): void {
    if (removePlanEvents(links.map((link) => link.key), editing, linkStepLabel("Delete", links.map((link) => link.kind)))) chrome?.selectEvents([]);
}

/** Whether the canvas takes a write, and every selected link's kind is bound with its patch door and takes a gesture now. */
function linksWritable(links: readonly PlanInspectedLink[], editing: PlanEventEditing | undefined, canvas: boolean): boolean {
    return canvas && editing !== undefined && links.length > 0 && links.every((link) => link.kind.editable && editing.available(link.kind.key));
}

/** Props of {@link OneLink}. */
interface OneLinkProps extends BodyProps {
    link: PlanInspectedLink;
    styles: Styles;
}

/**
 * One link of a link kind: its kind and the events it joins, what it moves,
 * its kind's form over its row, and Delete.
 */
function OneLink({ link, words, styles, chrome }: OneLinkProps) {
    const { m } = words;
    const button = useRecipe({ key: "button" });
    const { kind } = link;
    // Its edits: steps of the Plan's one history, on while the canvas takes a write and its kind's record a gesture.
    const editing = chrome?.events;
    const writable = linksWritable([link], editing, chrome?.writable === true);
    const writes = useRef(writable);
    writes.current = writable;
    const quantity = getSomeorUndefined(link.quantity);
    // Its row, held by its data: a read that brings the same row again draws nothing new.
    const row = useDataStable(link.row, blobEqual);
    const value = useMemo(() => rowCodec(kind.rowType).decode(row), [kind.rowType, row]);
    // What its record holds: what a drafted field is tinted against — a new link's every field, against nothing.
    const drafted = editing?.draftsOf(kind.key).has(link.id) === true;
    const held = editing?.held(kind.key, link.id) ?? (drafted ? NEW_EVENT : value);
    // Its refusals holding Save: its record's session's, each field one names ringed, its words under it.
    const refusals = entryRefusals(editing?.sessions ?? [], kind.key, link.id);
    const refused = refusedFields(refusals);
    const breaches = breachTone(refusals);
    const focus = useFieldAsk(kind.key, link.id);
    // The form's draws: one more each time an edit records nothing, so its fields show what the row holds again.
    const [redraws, setRedraws] = useState(0);
    // A field edited: one step, written through its record's `set` over the row as the step finds it.
    const onField = useCallback((path: readonly string[], next: unknown) => {
        const write = fieldWrite(kind.fields, kind.rowType, path, next);
        if (editing === undefined || write === undefined) return;
        const rewrite = (at: Uint8Array) => getSomeorUndefined(kind.set(at, [write]));
        if (!writes.current || !editing.record([{ kind: kind.key, id: link.id, rewrite }], "typed", linkStepLabel("Edit", [kind]))) setRedraws((n) => n + 1);
    }, [editing, kind, link.id]);
    return (
        <Box css={styles.root} data-plan-inspector="link">
            <ScheduleInspectorHead styles={styles} kind={kind} title={m.linkEnds({ from: link.from, to: link.to })} when={null} home />
            {refusals.length > 0 && (
                <Box css={styles.refusals} data-inspector-refusals="">
                    <BannerView status="warning" title={m.inspectorRefusals()} description={refusalsText(refusals, kind.fields)} />
                </Box>
            )}
            <Box as="dl" css={styles.facts} data-inspector-facts="">
                <Fact styles={styles} fact="from" label={m.inspectorFact({ fact: "from" })} value={link.from} />
                <Fact styles={styles} fact="to" label={m.inspectorFact({ fact: "to" })} value={link.to} />
                {quantity !== undefined && <Fact styles={styles} fact="quantity" label={m.inspectorFact({ fact: "quantity" })} value={quantityText(quantity, words)} />}
            </Box>
            <chakra.fieldset css={styles.edits} disabled={!writable} data-inspector-edits="">
                {kind.fields.length > 0 && (
                    <Box css={styles.fields} data-inspector-fields="form">
                        <FieldForm key={redraws} specs={kind.fields} value={value} baseline={held} issues={refused} focus={focus} breaches={breaches}
                            onChange={editing !== undefined ? onField : NO_EDIT} />
                    </Box>
                )}
                <Box css={styles.actions} data-inspector-actions="">
                    <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} data-inspector-action="delete"
                        onClick={() => { if (writes.current) deleteLinks([link], editing, chrome); }}>
                        {m.inspectorAction({ action: "delete" })}
                    </chakra.button>
                </Box>
            </chakra.fieldset>
        </Box>
    );
}

/** Props of {@link SeveralLinks}. */
interface SeveralLinksProps extends BodyProps {
    styles: Styles;
}

/** Several links of the link kinds: how many, each by the events it joins, and Delete. */
function SeveralLinks({ links, words, styles, chrome }: SeveralLinksProps) {
    const { m } = words;
    const button = useRecipe({ key: "button" });
    const editing = chrome?.events;
    const writable = linksWritable(links, editing, chrome?.writable === true);
    const writes = useRef(writable);
    writes.current = writable;
    return (
        <Box css={styles.root} data-plan-inspector="links">
            <Box css={styles.head} {...FOCUS_HOME_PROPS}>
                <Box css={styles.summary} data-inspector-several="">{m.inspectorLinks({ n: links.length, count: words.number(links.length) })}</Box>
            </Box>
            <Box as="ul" css={styles.list} data-inspector-list="">
                {links.map((link) => (
                    <Box as="li" key={link.key} css={styles.listItem} data-inspector-link={link.key}>
                        <FontAwesomeIcon icon={["fas", link.kind.icon as IconName]} />
                        <Box css={styles.listText}>
                            <Box as="span" css={styles.listTitle}>{m.linkEnds({ from: link.from, to: link.to })}</Box>
                            <Box as="span" css={styles.listWhen}>{link.kind.name}</Box>
                        </Box>
                    </Box>
                ))}
            </Box>
            <chakra.fieldset css={styles.edits} disabled={!writable} data-inspector-edits="">
                <Box css={styles.actions} data-inspector-actions="">
                    <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} data-inspector-action="delete"
                        onClick={() => { if (writes.current) deleteLinks(links, editing, chrome); }}>
                        {m.inspectorAction({ action: "delete" })}
                    </chakra.button>
                </Box>
            </chakra.fieldset>
        </Box>
    );
}

// ============================================================================
// A row (PB40)
// ============================================================================

/**
 * What a row stands for (`../root/landings.ts`): a resource — its landing row,
 * the row beside it for a further way its kinds draw, or a row of its series
 * beneath it — an event kind's events on none, or neither.
 */
type RowTarget = PlanLandingTarget | { readonly kind: "row" };

/**
 * What a row's events are on: the resource, by the rule every part of the canvas reads it by (`landingResourceOf`) —
 * its own, or, for a row a step beneath one (#1541, U1), the one it stands beneath — and there the child's key its
 * events name; for an Unassigned row, none.
 *
 * @param target - What the row stands for
 * @returns The resource, as an event names it, and the child's key beneath it; `undefined` for a resource's row whose
 *   path names no resource, which has no events
 */
function rowEventsOn(target: RowTarget):
    { readonly on: ValueTypeOf<OptionType<typeof ScheduleResourceRefType>> | undefined; readonly beneath: string | undefined } | undefined {
    if (target.kind !== "resource") return { on: undefined, beneath: undefined };
    const at = landingResourceOf(target);
    return at === undefined ? undefined : { on: some(at.ref), beneath: at.beneath };
}

/** Whether an event is on the row a step beneath its resource its child's key names: none beneath, every one is. */
function onChild(item: { readonly child: option<string> }, beneath: string | undefined): boolean {
    if (beneath === undefined) return true;
    const child = getSomeorUndefined(item.child);
    return child !== undefined && stringEqual(child, beneath);
}

/** No kind named. */
const NO_NAMES: readonly string[] = [];

/** No form: a row's refusals name each field by its name spelled out (#1541, U5). */
const NO_SPECS: readonly FieldSpecValue[] = [];

/** A row's events in the window: how many, how long, and their quantities — and the kinds counted none of. */
interface WindowFacts {
    /** Whether any kind on the row is counted: the figures below are theirs. */
    readonly counted: boolean;
    readonly events: number;
    readonly minutes: number;
    readonly quantities: readonly PlanQuantityValue[];
    /** The kinds on the row past the cap (#1039): none of their events is read, so the row counts none of them, and says so. */
    readonly uncounted: readonly PlanEventKindValue[];
}

/** A `time` instant's Date; `undefined` for an instant of another arm. */
function timeOf(t: PlanScale["window"]["min"]): Date | undefined {
    return t.type === "time" ? t.value : undefined;
}

/** A row's facts on their way (#1398, CL13): the cells its kinds are read by have not landed for its resource. */
const ROW_LOADING = "loading";

/**
 * The events in the window a row stands for — a resource's, or an event
 * kind's on no resource — read through the kinds, their drafts in place,
 * tracked. A kind the cells' reader gives cells (#1039) reads them from what
 * its cells hold — every event of a row on screen — never over the window,
 * and while the reader holds none for the row's resource — scrolled out of the
 * blocks read, or before the first read lands — the row's facts are on their
 * way, never 0, until its cells land. A kind past the cap, none of whose
 * events is read, is counted on no row: the row says it is not counted, never
 * 0. A kind hidden in the Series tab is no part of what the canvas shows: in
 * no figure, and nothing says so. Every other kind — each is counted before it
 * is read — is read over the window only once its count over the range the
 * canvas reads is within the cap.
 *
 * @param target - What the row stands for
 * @param kinds - The event kinds
 * @param scale - The shared scale: its window
 * @param drafts - Every kind's drafts (#1194) — the same object while they hold
 * @param cells - The kinds' cells and counts, when the reader decides a kind
 * @param hidden - The ids the viewer hides in the Series tab
 * @returns The facts, or {@link ROW_LOADING} while its cells are on their way; `undefined` for a row that stands for no events, and before the first read answers
 */
function useWindowFacts(
    target: RowTarget, kinds: PlanValue["events"], scale: PlanScale, drafts: EventDrafts, cells: ScheduleCellsRead | undefined, hidden: readonly string[],
): WindowFacts | typeof ROW_LOADING | undefined {
    const from = timeOf(scale.window.min);
    const to = timeOf(scale.window.max);
    // The range the canvas reads: what a kind is capped over.
    const range = eventReadRange(scale);
    const readFrom = range?.from.getTime();
    const readTo = range?.to.getTime();
    const read = useCallback((): WindowFacts | typeof READING | typeof ROW_LOADING | undefined => {
        if (target.kind === "row" || from === undefined || to === undefined || readFrom === undefined || readTo === undefined) return undefined;
        const at = rowEventsOn(target);
        if (at === undefined) return undefined;
        const { on, beneath } = at;
        let counted = false;
        let events = 0;
        let minutes = 0;
        const quantities: PlanQuantityValue[] = [];
        const uncounted: PlanEventKindValue[] = [];
        for (const kind of kinds) {
            // The row's kinds: those on its resource — beneath one, those whose `child` names its series (#1541, U1).
            const lands = target.kind !== "resource" ? stringEqual(kind.key, target.event.key)
                : beneath !== undefined ? target.landing.kinds.some((slot) => stringEqual(slot, kind.key))
                    : kind.takes.some((slot) => stringEqual(slot, target.landing.key));
            if (!lands) continue;
            // Hidden in the Series tab: no part of what the canvas shows — in no figure, and nothing says so.
            if (hides(hidden, planHideId.events(kind.key))) continue;
            // Past the cap: none of its events is read, so the row counts none of them — not counted, never 0.
            if (cells?.capped.has(kind.key) === true) {
                uncounted.push(kind);
                continue;
            }
            const held = cells?.reads.get(kind.key);
            // Read by its cells, which the reader holds none of for this resource — scrolled out of the blocks read, or
            // not landed yet: its figures are on their way, never 0 (#1398, CL13).
            if (held !== undefined && !cells!.windowed.has(kind.key) && on !== undefined && on.type === "some" && cells!.drawn !== undefined
                && !cells!.drawn.has(scheduleCellId(on.value.kind, on.value.key))) return ROW_LOADING;
            // Every kind is counted before it is read: given no cells, it is read over the window once it is within the cap.
            if (held === undefined) {
                const within = scheduleWithinCap(kind.count, new Date(readFrom), new Date(readTo));
                if (within.type !== "some" || !within.value) return READING;
            }
            const kindDrafts = (held === undefined ? drafts : cells!.drafts).get(kind.key) ?? NO_DRAFTS;
            const items = kind.planItems(from, to, kindDrafts, held === undefined ? none : some(held));
            if (items.type === "none") return READING;
            counted = true;
            for (const item of items.value) {
                if (on !== undefined ? !resourceEqual(item.resource, on) || !onChild(item, beneath) : item.resource.type !== "none") continue;
                events += 1;
                minutes += Number(item.minutes);
                const quantity = getSomeorUndefined(item.quantity);
                if (quantity !== undefined) quantities.push(quantity);
            }
        }
        return { counted, events, minutes, quantities, uncounted };
    }, [target, kinds, from, to, readFrom, readTo, drafts, cells, hidden]);
    const { result } = useTrackedEvaluation(read);
    // The last facts read — or that they are on their way — held while a read is in flight or failed.
    const held = useRef<WindowFacts | typeof ROW_LOADING | undefined>(undefined);
    return useMemo(() => {
        if (!result.ok) {
            console.error("[Plan] the row's events could not be read:", result.error);
            return held.current;
        }
        if (result.value === READING) return held.current;
        held.current = result.value;
        return result.value;
    }, [result]);
}

/** Props of {@link RowView}. */
interface RowProps extends BodyProps {
    styles: Styles;
    chrome: PlanChrome;
    rowKey: RowKey;
    at: PlanInstantValue | null;
}

/** A row: a resource's name, lines and group, its overlaps, its events in the window and its series' rows at a bucket — or an Unassigned row's events, or what any other row draws at a bucket. */
function RowView({ rowKey, at, kinds, landings, chrome, counts, words, styles, hidden }: RowProps) {
    const { m } = words;
    const { inspect, scale } = chrome;
    const row = inspect.row(rowKey)!;
    const target = useMemo((): RowTarget => landingTargetOf(row.id, landings, kinds) ?? landingSeriesTargetOf(row.id, landings) ?? { kind: "row" },
        [row.id, landings, kinds]);
    const facts = useWindowFacts(target, kinds, scale, chrome.events?.drafts ?? NONE_DRAFTED, chrome.cells, hidden);
    // Its overlaps (#1198, PB40): the pairs on its resource in the window — beneath one, on its row (#1541, U1) — a line each,
    // which selects the pair.
    const eventsOn = rowEventsOn(target);
    const on = eventsOn?.on;
    const pairs = on === undefined ? [] : (counts?.overlaps.pairs ?? []).filter((pair) => resourceEqual(pair.first.resource, on) && onChild(pair.first, eventsOn?.beneath));
    // Its resource (#1541): its landing row — the row itself, or the one beside it for a further way its kinds draw — its
    // lines the row's sub and value, its group the group strip it is drawn under.
    const resource = target.kind === "resource" ? inspect.row(rowKeyOf(landingRowId(target.landing.key, target.path))) : undefined;
    const group = resource !== undefined ? groupOf(resource, inspect) : undefined;
    const lines = resource !== undefined
        ? [getSomeorUndefined(resource.gutter.sub), getSomeorUndefined(resource.gutter.value)].filter((line): line is string => line !== undefined) : [];
    const bucketIndex = at !== null ? scale.bucketOf(at) : -1;
    const bucket = bucketIndex >= 0 ? scale.buckets[bucketIndex] : undefined;
    // The rows of a resource's series beneath it, at its path; any other row's own value.
    const measures = target.kind === "resource"
        ? target.landing.series.flatMap((series) => {
            const key = rowKeyOf(variant("entry", { series, path: [...target.path] }) as typeof row.id);
            const measured = inspect.row(key);
            return measured === undefined ? [] : [{ key: series, label: measured.gutter.label, rowKey: key }];
        })
        : target.kind === "row" ? [{ key: row.key, label: row.gutter.label, rowKey: row.key }] : [];
    const title = target.kind === "resource" ? resource?.gutter.label ?? target.key
        : target.kind === "unassigned" ? m.inspectorUnassigned() : row.gutter.label;
    const eyebrow = target.kind === "resource" ? target.landing.name : target.kind === "unassigned" ? target.event.name : m.inspectorRow();
    // Its refusals holding Save (#1541, U5): what the session the rows save through refuses of the entry the row came from
    // while the Plan's `ready` refuses its drafts, each naming its field — a resource's read off its landing row, one of
    // `data`'s own, so each of its rows shows them. A row that is none of `data`'s own has none.
    const refusals = inspect.refusals(resource?.key ?? rowKey);
    return (
        <Box css={styles.root} data-plan-inspector="row">
            <Box css={styles.head} {...FOCUS_HOME_PROPS}>
                <Box css={styles.eyebrow} data-inspector-kind="">{eyebrow}</Box>
                <Box css={styles.name} data-inspector-title="">{title}</Box>
                {lines.map((line, i) => <Box key={i} css={styles.when} data-inspector-line="">{line}</Box>)}
                {group !== undefined && (
                    <Box css={styles.marks}>
                        <Box as="span" css={styles.chip} data-inspector-group="">{group}</Box>
                    </Box>
                )}
            </Box>
            {/* Under its head, as an event's are over its form: its rows have no form, so each field is named spelled out. */}
            {refusals.length > 0 && (
                <Box css={styles.refusals} data-inspector-refusals="">
                    <BannerView status="warning" title={m.inspectorRefusals()} description={refusalsText(refusals, NO_SPECS)} />
                </Box>
            )}
            {pairs.length > 0 && (
                <OverlapsBanner styles={styles}
                    title={m.inspectorRowOverlaps({ n: pairs.length, count: words.number(pairs.length) })}
                    lines={pairs.map((pair) => ({
                        keys: [scheduleEventKey(pair.first), scheduleEventKey(pair.second)],
                        when: spanText(pair.from, pair.to, words),
                        title: m.inspectorOverlapPair({ first: pair.first.title, second: pair.second.title }),
                    }))}
                    onSelect={chrome.selectEvents} />
            )}
            {facts === ROW_LOADING ? (
                // Its cells on their way (#1398, CL13): each figure a placeholder in its place, never 0, until they land.
                <Box as="dl" css={styles.facts} data-inspector-window="" aria-busy="true">
                    <Fact styles={styles} fact="events" label={m.inspectorFact({ fact: "events" })} value={<PlaceholderShape kind="number" index={0} />} />
                    <Fact styles={styles} fact="hours" label={m.inspectorFact({ fact: "hours" })} value={<PlaceholderShape kind="number" index={1} />} />
                </Box>
            ) : facts !== undefined && facts.counted && (
                <Box as="dl" css={styles.facts} data-inspector-window="">
                    <Fact styles={styles} fact="events" label={m.inspectorFact({ fact: "events" })} value={words.number(facts.events)} />
                    <Fact styles={styles} fact="hours" label={m.inspectorFact({ fact: "hours" })} value={hoursText(facts.minutes, words)} />
                    {facts.quantities.length > 0 && (
                        <Fact styles={styles} fact="quantities" label={m.inspectorFact({ fact: "quantities" })} value={totalsText(totalsByUnit(facts.quantities), words)} />
                    )}
                </Box>
            )}
            {/* The kinds the row counts none of (#1039): past the cap, none of their events read — said so, never 0. */}
            {facts !== undefined && facts !== ROW_LOADING && facts.uncounted.length > 0 && (
                <Box css={styles.hint} data-inspector-not-counted="">{m.inspectorNotCounted({ kinds: facts.uncounted.map((kind) => kind.name), hours: NO_NAMES })}</Box>
            )}
            {measures.length > 0 && (
                <Box css={styles.measures} data-inspector-measures="">
                    <Box css={styles.sectionHead}>{bucket !== undefined ? m.inspectorAt({ bucket: scale.bucketText(bucket) }) : m.inspectorSection({ section: "measures" })}</Box>
                    {bucket === undefined || at === null
                        ? <Box css={styles.hint} data-inspector-no-bucket="">{m.inspectorNoBucket()}</Box>
                        : (
                            <Box as="dl" css={styles.facts} data-inspector-at="">
                                {measures.map((measure) => (
                                    <Fact key={measure.key} styles={styles} fact={`measure:${measure.key}`} label={measure.label}
                                        value={inspect.valueAt(measure.rowKey, at) ?? m.inspectorNoValue()} />
                                ))}
                            </Box>
                        )}
                </Box>
            )}
        </Box>
    );
}

// ============================================================================
// Nothing selected (PB41)
// ============================================================================

/**
 * Nothing selected: the window's counts, and three hints — two on a Plan with no event kinds, which has no event to
 * click (#1541, U5).
 */
function NothingSelected({ styles, counts, words, events }: { styles: Styles; counts: PlanEventCounts | undefined; words: PlanWords; events: boolean }) {
    const { m } = words;
    const touch = useContext(FrameDrawer);
    const stats = counts === undefined ? [] : [
        // A kind whose events are not counted (#1039) is in no count: where no kind's are, there is none.
        ...(counts.events !== undefined ? [{ stat: "events" as const, n: counts.events, text: words.number(counts.events) }] : []),
        // The hours of the kinds read — where no kind's are, none; a kind read by its cells counts its hours over the rows
        // drawn (#1039), and the stat says so.
        ...(counts.minutes !== undefined
            ? [{ stat: counts.drawn ? "hoursInView" as const : "hours" as const, n: counts.minutes, text: hoursText(counts.minutes, words) }] : []),
        ...(counts.backlog !== undefined ? [{ stat: "backlog" as const, n: counts.backlog, text: words.number(counts.backlog) }] : []),
    ];
    return (
        // No heading: the view is its own home, where the keyboard lands as the control it was on goes (#1398).
        <Box css={styles.root} data-plan-inspector="none" {...FOCUS_HOME_PROPS}>
            {stats.length > 0 && (
                <Box css={styles.stats} data-inspector-counts="">
                    {stats.map(({ stat, n, text }) => (
                        <Box key={stat} css={styles.stat} data-count={stat}>
                            <Box as="span" css={styles.statValue}>{text}</Box>
                            <Box as="span" css={styles.statLabel}>{m.inspectorStat({ stat, n })}</Box>
                        </Box>
                    ))}
                </Box>
            )}
            {/* The kinds whose events in the window are not counted, and those whose hours are not (#1039): said so in one
                line, never 0. */}
            {counts !== undefined && (counts.uncounted.length > 0 || counts.hoursNotCounted.length > 0) && (
                <Box css={styles.hint} data-inspector-not-counted="">
                    {m.inspectorNotCounted({ kinds: counts.uncounted.map((kind) => kind.name), hours: counts.hoursNotCounted.map((kind) => kind.name) })}
                </Box>
            )}
            <Box as="ul" css={styles.hints}>
                {touch ? <Box as="li" css={styles.hint}>{m.inspectorHintTouch()}</Box>
                    : ([1, 2, 3] as const).filter((n) => events || n !== 1).map((n) => <Box as="li" key={n} css={styles.hint}>{m.inspectorHint({ n })}</Box>)}
            </Box>
        </Box>
    );
}
