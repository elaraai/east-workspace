/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraPlan` — the Plan (#1193, `Plan Builder Spec.md` §7, §7.1, §8,
 * PB19–PB25): the one Plan, laid out in `BuilderFrame` wherever it is used.
 * There is no other Plan: no canvas without the frame, and no toolbar but its
 * one.
 *
 * The canvas (`usePlanCanvas`, `../canvas.tsx`) hands the frame main and the
 * facts its chrome is drawn from, and the frame places them in its regions:
 *
 * - **the toolbar** — the Plan's items (`usePlanToolbarItems`) on the frame's
 *   one folding row, in §7.1's order: the slice's narrowing, the scope badge,
 *   the key search, the grain, the slice's range, the resolution and the
 *   diagnostics; at the row's end the summary, the overlaps chip and the
 *   history item, which leaves its error to the banners. A Plan with none
 *   of them has no toolbar. ⌘Z undoes and ⇧⌘Z or ⌘Y redoes from anywhere in
 *   the frame, never while typing;
 * - **the history** (#1194) — one history across `data`'s editing session
 *   and each event kind's, a session per kind over its record: the history
 *   item's Undo and Redo step through the gestures in the order they were
 *   made whatever their source, its Discard drops every source's drafts, and
 *   its Save commits each source with a change as its own request;
 * - **the banners** — each session's (`SessionBanners`), an event kind's
 *   titled with its name: a Save's conflict, naming its rows or its events and
 *   who changed the record last; a refusal, with its reasons; a write with no
 *   answer, with Retry, which resends that source's request; a Save whose
 *   result could not be read back, with Retry; and the drafts the source moved
 *   under, with Discard, which drops that source's. Each leaves when what it
 *   reports does;
 * - **main** — the canvas, unchanged: the horizon brush, the ruler and the
 *   now line, the pinned rows, the rows — or, below 480px of main, the
 *   narrow layout's tabs and cards — the links and the overlays;
 * - **the footer** — the event kinds' counts (the events in the window, the
 *   backlog, and when a kind's record was last saved; "…" until their first
 *   read lands, never 0), the changes waiting on Save, the author's items, and
 *   the shared loading line, which says what of a paged source the view waits
 *   for, and a read of the event kinds' rows that failed, in the kinds' words,
 *   with Retry (#1398) — live under the cold-load skeleton, which covers
 *   the rest of the frame at the rows' pitch until the source's first window
 *   lands; after it a read in flight covers nothing, and main is busy. The
 *   line and the runs' placeholders show on the Plan's one reveal clock
 *   (`LoadingReveal`, CL4);
 * - **the overlaps** (#1198, PB51–PB53) — read with the counts: two events of
 *   a kind that warns of them, on one resource at once. Each event in a pair
 *   wears the warn ring on the canvas, the toolbar's chip counts the pairs and
 *   selects the first, and the inspector's banner lists what the selected
 *   event overlaps. They never block Save;
 * - **the panes** — the library in the start pane when the Plan's `library`
 *   lists a tab (#1195, `library.tsx`) — an author's tab's cards dragging onto
 *   the rows that take a card (#1259) or onto an event of their patch's kind,
 *   the templates and the backlog's events onto the event kinds' rows, and an
 *   event back onto the Backlog tab (#1196) — and the inspector in the end pane when
 *   it is given `inspector` — what is selected on the canvas (#1197,
 *   `inspector.tsx`): optional props, no prop, no pane. Their open tab and
 *   collapsed state persist under the Plan's `id` (`planKeys(id).frame`,
 *   PB25).
 *
 * What a viewer hides in the library's Series tab persists under the Plan's
 * `id` too (`planKeys(id).series`, PB29, `hidden.ts`), and only while the
 * library lists that tab, as nothing else could show it again: the event
 * kinds' events leave it out where the seam places them (#1541), and the
 * canvas leaves out the Plan's own `rows` it hides. What it switches of `data`'s picked
 * series is kept under the pick's own key (`pick.<key>`), and goes back into
 * the pick when the Plan mounts: the pick's state lives in the page's store,
 * which a reload empties. An event kind hidden there is in none of
 * the canvas's figures — the footer's counts and the inspector's — and nothing
 * says so (#1039).
 *
 * The narrowing is the Plan's one `Slice.bindRecords` (#1344): the canvas
 * reads its `rows` source — the rows the event kinds land on among them
 * (#1541) — and each event kind's through their parts (`root/sources.ts`);
 * the frame follows the others itself through the shared `FollowSources` —
 * each templates list's, and each an author's tab names. A source whose
 * narrowing could not be read says so in a banner, with Retry, as a window
 * that could not be written does. After a Save, the footer says what left
 * each source's narrowing. What the event kinds read — the footer's counts, the overlaps,
 * the backlog and what the rail hides of it — and the selected events are
 * each read in a component of their own (`PlanKindsReader`,
 * `PlanSelectionReader`), which hand the frame what they read only when it
 * moves: a kind narrowed through an interval index lands some fifty-five key
 * searches a window, and each would otherwise render the whole frame.
 *
 * A declared `style.height` / `maxHeight` is the whole Plan's: the frame
 * takes it, and the canvas fills main. Without one, the frame fills its
 * parent when the parent gives it a height, the canvas filling main, and
 * grows with its canvas when the parent grows with what it holds. The Plan
 * draws no border of its own.
 *
 * @packageDocumentation
 */

import { Fragment, memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Box, Button, useSlotRecipe } from "@chakra-ui/react";
import { StringType, equalFor, equivalentFor, type ValueTypeOf } from "@elaraai/east";
import { FuncBindingType, Plan, PlanComponent, PlanEventSeamType, PlanPayloadType, planKeys } from "@elaraai/e3-ui/internal";
import {
    BannerView, BuilderFrame, SessionBanners, getSomeorUndefined, historyShortcut, implementUIComponent, takeKey, typedInto, useDataStable, usePersistedState,
} from "@elaraai/east-ui-components";
import { LoadingReveal, keptRead } from "@elaraai/east-ui-components/internal";
import { FollowSources, type FollowedSources } from "../../shared/schedule/follow-sources.js";
import type { KeyVisibilityWords } from "../../shared/schedule/visibility.js";
import { usePlanCanvas } from "../canvas.js";
import { usePlanSelector } from "../controller/react.js";
import { removePlanEvents } from "../edit/events.js";
import { kindLinkOf, linkStepLabel } from "../links/kinds.js";
import { lowerWord } from "../../shared/schedule/words.js";
import type { PlanCanvasParts } from "../root/chrome.js";
import type { PlanEventRows } from "../root/events.js";
import { ROWS_SOURCE, planFollowedSources, planNouns, type PlanEventPart } from "../root/sources.js";
import { usePlanToolbarItems } from "../shell/Toolbar.js";
import { PlanFooter, type PlanSaveNotice } from "../shell/Footer.js";
import type { PlanRootValue } from "../model.js";
import { PlanOverlapsContext } from "../rows/element-overlap.js";
import { usePlanWords, useResolvedPlanWords } from "../words.js";
import { PlanVocabularyProvider } from "../messages.js";
import { PlanKindsReader, type PlanBacklogEntry, type PlanKindsRead, type PlanOverlaps } from "./counts.js";
import { NONE_HIDDEN, hiddenOf, hides, rowsHiddenOf } from "./hidden.js";
import {
    NO_INSPECTED, NO_INSPECTED_LINKS, PlanSelectionReader, usePlanInspector, usePlanInspectorSelection, type PlanInspectedEvent, type PlanInspectedLink,
} from "./inspector.js";
import { tabLibrary, usePlanLibrary, type PlanPickValue } from "./library.js";

/** The Plan's payload, decoded — what `<Plan>` returns through the `Plan` carrier (#1191). */
export type PlanValue = ValueTypeOf<typeof PlanPayloadType>;

/** The Plan's event kinds, as its payload carries them (#1190). */
type PlanEventKinds = PlanValue["events"];

/** The series the Plan's event kinds land on, as its payload carries them (#1541). */
type PlanLandings = PlanValue["landings"];

/** The library pane's tabs, as the payload lists them (#1195). */
type PlanLibraryTabs = PlanValue["library"];

/** The Plan's link kinds, as its payload carries them (#1541, U10). */
type PlanLinkKinds = PlanValue["linkKinds"];

type Styles = Record<string, Record<string, unknown>>;

// The memo compares CLOSURES too (#809). A Plan root is function-heavy — the
// resolvers, the element callbacks, a paged source's `page` wrapping its
// series — and `equalFor` calls every pair of functions equal, so a root that
// differed only inside one (a resolver over new data, a series `match` over a
// new threshold) was dropped and the canvas rendered the old closures.
const planRootEqual = equivalentFor(Plan.Types.Root);
/** Whether two seams place the same events: their functions by their IR and what they capture (#809). */
const eventSeamEquivalent = equivalentFor(PlanEventSeamType);
/** Whether two lists of event kinds read the same records, their seams compared by their IR and what they capture. */
const eventKindsEquivalent = equivalentFor(PlanPayloadType.fields.events);
/** The payload's equivalence: its data, and its functions by their IR and what they capture (#809). */
const planPayloadEqual = equivalentFor(PlanPayloadType);
/** Whether two sets of the app's words are one. */
const vocabularyEqual = equalFor(PlanPayloadType.fields.vocabulary);

/** No event kinds: a Plan of `data` and `rows` alone. */
const NO_KINDS: PlanEventKinds = [];

/** No series an event kind lands on. */
const NO_LANDINGS: PlanLandings = [];

/** No library: no pane. */
const NO_LIBRARY: PlanLibraryTabs = [];

/** No link kind: a Plan of the links built in code alone. */
const NO_LINK_KINDS: PlanLinkKinds = [];
/** Whether two lists of link kinds read the same records, their functions compared by their IR and what they capture. */
const linkKindsEquivalent = equivalentFor(PlanPayloadType.fields.linkKinds);

/** Whether two libraries list the same tabs and cards: they hold data alone. */
const libraryEqual = equalFor(PlanPayloadType.fields.library);
/** Whether two lists of the series the event kinds land on are one: they hold data alone. */
const landingsEqual = equalFor(PlanPayloadType.fields.landings);
/** Whether two optimiser bindings are one: the function's name, and the records it lists and reads. */
const optimiseEqual = equalFor(FuncBindingType);

/** No event kind has an event on the canvas. */
const NO_PATCH_KINDS: ReadonlySet<string> = new Set();

/** Whether two event-rows props place the same events on the same rows (#1541). */
function sameEventRows(a: PlanEventRows | undefined, b: PlanEventRows | undefined): boolean {
    if (a === undefined || b === undefined) return a === b;
    return a.paged === b.paged && landingsEqual(a.landings, b.landings) && eventSeamEquivalent(a.seam, b.seam);
}

/** No event in an overlap pair. */
const NO_OVERLAPS: ReadonlySet<string> = new Set();

/** No source of the slice the frame follows. */
const NONE_FOLLOWED: FollowedSources = new Map();

/** No event kind narrowed through a source of the slice. */
const NO_PARTS: readonly PlanEventPart[] = [];

/** No Save notice: a Plan whose slice has no source a Save could move records out of. */
const NO_NOTICES: readonly PlanSaveNotice[] = [];

/** What the event kinds read before their first read answers: no counts, and the rail hides nothing of the backlog. */
const NOTHING_READ: PlanKindsRead = { counts: undefined, backlog: { narrowing: [], hidden: undefined, counting: false, clear: undefined }, retained: false };

/** No unscheduled event: a Plan with no event kinds. */
const NO_UNSCHEDULED: readonly PlanBacklogEntry[] = [];

const stringEqual = equalFor(StringType);

/**
 * Test-only render probe — lets "a landing key search re-renders the event kinds' reader, never the frame" be asserted
 * deterministically (#1344), as the Calendar's is. `undefined` outside tests.
 */
let planFrameRenderProbe: (() => void) | undefined;

/**
 * Install (or clear) the test frame render probe. Test use only.
 *
 * @param fn - Called each time the frame renders; `undefined` clears it
 */
export function setPlanFrameRenderProbe(fn: (() => void) | undefined): void {
    planFrameRenderProbe = fn;
}

/**
 * The events in an overlap pair, by their elements' keys (#1198) — the same
 * set while its members hold, so a read that moved no pair renders no element.
 *
 * @param overlaps - The overlaps among the window's events
 * @returns The keys of every event in a pair
 */
function useOverlapKeys(overlaps: PlanOverlaps | undefined): ReadonlySet<string> {
    const held = useRef(NO_OVERLAPS);
    return useMemo(() => {
        const next = overlaps === undefined || overlaps.peers.size === 0 ? NO_OVERLAPS : new Set(overlaps.peers.keys());
        const prev = held.current;
        if (next.size === prev.size && [...next].every((key) => prev.has(key))) return prev;
        held.current = next;
        return next;
    }, [overlaps]);
}

/** Props of {@link EastChakraPlan}. */
export interface EastChakraPlanProps {
    /** The Plan root value: the canvas whole. */
    value: PlanRootValue;
    /** Storage key prefix for persisting component state. */
    storageKey: string;
    /** Where the event kinds' events land on the root's own rows (#1192, #1541) — a Plan of event kinds' payload carries it. */
    events?: PlanEventRows | undefined;
    /** The event kinds themselves (#1190), which the footer counts and the library lists — a Plan of event kinds' payload carries them. */
    kinds?: PlanEventKinds | undefined;
    /** The series the event kinds land on (#1541), which the library's cards and the inspector name — a Plan of event kinds' payload carries them. */
    landings?: PlanLandings | undefined;
    /** The library pane's tabs (#1195) — the payload carries them; none, no pane. */
    library?: PlanLibraryTabs | undefined;
    /** Whether the Plan has its inspector pane (#1197) — the payload carries it; left out, no pane. */
    inspector?: boolean | undefined;
    /** What each source of the slice the frame follows shows (#1344) — each templates list's and tab's; none, a Plan whose payload follows none. */
    followed?: FollowedSources | undefined;
    /**
     * The app's optimiser (#1409, east-workspace#1622) — the payload carries its binding: what the Elara eye calls by
     * name, and the records it lists in `drafts` and reads; none, no eye.
     */
    optimise?: ValueTypeOf<typeof FuncBindingType> | undefined;
    /** Whether the Plan's Autosave begins on — the payload carries its author's word; left out, off. */
    autosave?: boolean | undefined;
    /** The link kinds (#1541, U10), whose links the canvas draws beside the root's own — the payload carries them; none, a Plan with none. */
    linkKinds?: PlanLinkKinds | undefined;
}

/**
 * Renders the Plan in its frame — see the module docs.
 *
 * @param props - The root, its storage key, the event kinds and where they land, the series they land on, the library's tabs, whether it has its inspector, the event kinds' drop veto, what each source the frame follows shows, and whether its Autosave begins on
 * @returns The Plan, in its frame
 */
export const EastChakraPlan = memo(function EastChakraPlan({
    value, storageKey, events, kinds, landings: givenLandings, library: given, inspector, followed = NONE_FOLLOWED, optimise, autosave, linkKinds,
}: EastChakraPlanProps) {
    const library = useDataStable(given ?? NO_LIBRARY, libraryEqual);
    const id = getSomeorUndefined(value.id);
    const keys = useMemo(() => planKeys(id), [id]);
    // What this viewer hides in the Series tab (PB29), kept under the Plan's
    // id: a Plan without the tab hides none — nothing on it could show them
    // again, and another Plan under the same id may have hidden them.
    const { state: stored, setState: store } = usePersistedState<readonly string[]>(keys.series, NONE_HIDDEN, keptRead.texts);
    const series = useMemo(() => library.find((tab) => tab.type === "series"), [library]);
    const hidden = useMemo(() => (series !== undefined ? hiddenOf(stored) : NONE_HIDDEN), [series, stored]);
    const onHidden = useCallback((next: readonly string[]) => { store(next); }, [store]);
    const rowsHidden = useMemo(
        () => (series !== undefined && series.type === "series" ? rowsHiddenOf(series.value, hidden) : undefined),
        [series, hidden]);
    // An event kind's element selects its event (#1197).
    const eventKinds = useMemo(() => (kinds ?? NO_KINDS).map((kind) => kind.key), [kinds]);
    // The panel's own tabs whose cards land on the rows (#1259): the author's.
    const panel = useMemo(() => library.flatMap((tab) => (tab.type === "tab" ? [tabLibrary(keys, tab.value)] : [])), [library, keys]);
    // The series the event kinds land on (#1541): what an event's resource is named by.
    const landings = givenLandings ?? NO_LANDINGS;
    const canvas = usePlanCanvas({
        value, storageKey, events, hidden, rowsHidden, eventKinds, panel, kinds: kinds ?? NO_KINDS,
        landings, tabs: library, optimise, autosave: autosave === true, linkKinds: linkKinds ?? NO_LINK_KINDS,
    });
    return <>{canvas.provide(
        <PlanFrame canvas={canvas} root={value} kinds={kinds ?? NO_KINDS} landings={landings} library={library}
            inspector={inspector === true} hidden={hidden} onHidden={onHidden} followed={followed} linkKinds={linkKinds ?? NO_LINK_KINDS} />,
    )}</>;
}, (prev, next) => planRootEqual(prev.value, next.value) && prev.storageKey === next.storageKey
    && (prev.followed ?? NONE_FOLLOWED) === (next.followed ?? NONE_FOLLOWED)
    && (prev.inspector === true) === (next.inspector === true)
    && (prev.autosave === true) === (next.autosave === true)
    && (prev.optimise === undefined ? next.optimise === undefined : next.optimise !== undefined && optimiseEqual(prev.optimise, next.optimise))
    && sameEventRows(prev.events, next.events)
    && (prev.kinds === next.kinds || eventKindsEquivalent(prev.kinds ?? NO_KINDS, next.kinds ?? NO_KINDS))
    && (prev.landings === next.landings || landingsEqual(prev.landings ?? NO_LANDINGS, next.landings ?? NO_LANDINGS))
    && (prev.linkKinds === next.linkKinds || linkKindsEquivalent(prev.linkKinds ?? NO_LINK_KINDS, next.linkKinds ?? NO_LINK_KINDS))
    && (prev.library === next.library || libraryEqual(prev.library ?? NO_LIBRARY, next.library ?? NO_LIBRARY)));

/** Props of {@link PlanFrame}. */
interface PlanFrameProps {
    /** What the canvas hands its frame. */
    canvas: PlanCanvasParts;
    /** The Plan root value: its axis's now, and its pick over `data`'s series. */
    root: PlanRootValue;
    /** The Plan's event kinds — none for a Plan of `data` and `rows` alone. */
    kinds: PlanEventKinds;
    /** The series its event kinds land on (#1541). */
    landings: PlanLandings;
    /** The library pane's tabs; none, no pane. */
    library: PlanLibraryTabs;
    /** Whether the Plan has its inspector pane. */
    inspector: boolean;
    /** The ids this viewer hides in the Series tab. */
    hidden: readonly string[];
    /** Replaces them. */
    onHidden: (next: readonly string[]) => void;
    /** What each source of the slice the frame follows shows (#1344). */
    followed: FollowedSources;
    /** The link kinds (#1541, U10): a selected link of one is removed by Delete, as a selected event is. */
    linkKinds: PlanLinkKinds;
}

/**
 * What Delete's step of the history is called: a link kind's links by their own word, any other selection as the
 * events it is.
 *
 * @param keys - The selected elements' keys
 * @param linkKinds - The link kinds
 * @returns The label; `undefined` for a selection of events alone, which names itself
 */
function deleteLabel(keys: readonly string[], linkKinds: PlanLinkKinds): string | undefined {
    const kinds = keys.flatMap((key) => { const named = kindLinkOf(linkKinds, key); return named === undefined ? [] : [named.kind]; });
    if (kinds.length === 0) return undefined;
    return kinds.length === keys.length ? linkStepLabel("Delete", kinds) : `Delete ${keys.length} selected`;
}

/**
 * The canvas's pick over `data`'s series, kept for the viewer while the
 * library lists the Series tab (PB29): the pick's state lives in the page's
 * store, which a reload empties, so what the tab writes into it is kept under
 * the pick's key as well, and goes back into the pick when the Plan mounts —
 * before it paints, so the series open as the viewer left them. An id the pick
 * no longer lists is dropped on the way back; a pick the tab never wrote opens
 * as its program sets it.
 *
 * @param pick - The canvas's own pick, when `data`'s series are picked
 * @param listed - Whether the library lists the Series tab
 * @returns The pick, what the tab writes into it kept
 */
function useKeptPick(pick: PlanPickValue | undefined, listed: boolean): PlanPickValue | undefined {
    const { state: kept, setState: keep } = usePersistedState<readonly string[] | undefined>(`pick.${pick?.key ?? ""}`, undefined, keptRead.texts);
    // Once for each pick: after that the tab writes both.
    const restored = useRef<string | undefined>(undefined);
    useLayoutEffect(() => {
        if (!listed || pick === undefined || (restored.current !== undefined && stringEqual(restored.current, pick.key))) return;
        restored.current = pick.key;
        if (kept === undefined) return;
        const ids = pick.items.map((item) => item.id);
        const back = hiddenOf(kept).filter((id) => hides(ids, id));
        const now = pick.state.read();
        if (back.length !== now.length || back.some((id) => !hides(now, id))) pick.state.write([...back]);
    }, [listed, pick, kept]);
    return useMemo(() => (!listed || pick === undefined ? pick : {
        ...pick,
        state: { ...pick.state, write: (next: string[]) => { keep(next); return pick.state.write(next); } },
    }), [listed, pick, keep]);
}

/** The frame, its regions holding the canvas and its chrome — inside the canvas's contexts. */
function PlanFrame({ canvas, root, kinds, landings, library, inspector, hidden, onHidden, followed, linkKinds }: PlanFrameProps) {
    planFrameRenderProbe?.();
    const { chrome, main, bound, vars } = canvas;
    const recipe = useSlotRecipe({ key: "plan" });
    const styles = useMemo(() => recipe() as unknown as Styles, [recipe]);
    const id = getSomeorUndefined(root.id);
    const keys = useMemo(() => planKeys(id), [id]);
    const words = usePlanWords();
    const { m } = words;
    // The backlog's weeks count from the axis's now, or from the clock when the Plan mounted.
    const [mounted] = useState(() => new Date());
    const now = root.axis.type === "time" ? getSomeorUndefined(root.axis.value.now) ?? mounted : mounted;
    const given = useMemo((): PlanPickValue | undefined => getSomeorUndefined(root.pick), [root.pick]);
    const pick = useKeptPick(given, library.some((tab) => tab.type === "series"));
    // What the event kinds read, counted with every kind's drafts in place (#1194) — the counts, the overlaps, the
    // backlog — and what the rail hides of the backlog (#1344), held with its cards (#1398), reported by a component of
    // its own.
    const [kindsRead, setKindsRead] = useState<PlanKindsRead>(NOTHING_READ);
    const counts = kinds.length > 0 ? kindsRead.counts : undefined;
    const start = usePlanLibrary({
        library, kinds, landings, inspect: chrome?.inspect, pick, keys, hidden, onHidden, now, words, takesCards: chrome?.takesCards === true,
        // A Plan with no event kinds reads no backlog: there is nothing to wait for.
        unscheduled: kinds.length === 0 ? NO_UNSCHEDULED : counts?.unscheduled,
        takesEvents: chrome?.takesEvents === true, patchKinds: chrome?.patchKinds ?? NO_PATCH_KINDS,
        followed, backlogNarrowing: kindsRead.backlog, backlogRetained: kinds.length > 0 && kindsRead.retained, backlogFlash: chrome?.optimise?.backlogFlash,
    });
    // The overlaps (#1198): the toolbar's chip, the warn rings, the inspector's banner.
    const overlaps = counts?.overlaps;
    const items = usePlanToolbarItems(chrome, overlaps);
    const overlapKeys = useOverlapKeys(overlaps);
    // What is selected, and the selected events, read by a component of their own (#1344).
    const selection = usePlanInspectorSelection(inspector);
    const [selected, setSelected] = useState<readonly PlanInspectedEvent[]>(NO_INSPECTED);
    // The selected links of the link kinds (#1541, U10), read beside them.
    const [selectedLinks, setSelectedLinks] = useState<readonly PlanInspectedLink[]>(NO_INSPECTED_LINKS);
    const end = usePlanInspector({ shown: inspector, kinds, landings, chrome, counts, keys, words, selection, events: selected, links: selectedLinks, hidden });
    // The Plan's one history (#1194): the history item reads it as one session.
    const history = chrome?.history;
    const session = history?.session;
    const onAction = history?.onAction;
    const selectedEvents = usePlanSelector(snapshot => snapshot.store.ui.elements);
    const eventEditing = chrome?.events;
    const selectEvents = chrome?.selectEvents;
    // Delete writes only while the canvas takes a write: never while a run of the optimiser is out (R2), nor while what
    // it shows stands in, retained (#1398, CL8).
    const writable = chrome?.writable === true;
    // The frame owns shortcuts even when no inspector is declared or its pane is collapsed; a key it acts on goes no
    // further than the Plan (#1398).
    const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing || typedInto(event.target)) return;
        const action = historyShortcut(event);
        if (action !== undefined && onAction !== undefined) {
            takeKey(event);
            onAction(action);
        } else if (!event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "Delete" || event.key === "Backspace") && writable) {
            // What stays selected is what stayed: an event its kind's lock holds where it is (#1541, U9).
            const stayed = removePlanEvents(selectedEvents, eventEditing, deleteLabel(selectedEvents, linkKinds));
            if (stayed !== undefined) {
                takeKey(event);
                selectEvents?.(stayed);
            }
        }
    }, [onAction, selectedEvents, eventEditing, selectEvents, writable, linkKinds]);
    // A Plan with no control to show — no slice, no search, no group to fold, no overlaps, no editing — draws no toolbar.
    const toolbar = items.some((item) => item !== undefined && item !== false) ? items : undefined;
    // Each session's banners, in the history's order: `data`'s, then each event kind's, named — then each source the
    // frame follows whose narrowing could not be read, with Retry, and a window that could not be written (#1344).
    const bannerNodes: ReactNode[] = [];
    // A run of the optimiser's banner first (#1409).
    if (chrome?.optimise?.banner) bannerNodes.push(<Fragment key="optimise">{chrome.optimise.banner}</Fragment>);
    if (chrome !== undefined && history !== undefined) {
        for (const held of chrome.sessions) {
            bannerNodes.push(<SessionBanners key={held.key} session={held.session} words={chrome.words} onAction={held.onAction}
                where={held.where} name={held.name} />);
        }
    }
    for (const [source, followedSource] of followed) {
        if (followedSource.error === undefined) continue;
        bannerNodes.push(
            <Box key={`source:${source}`} data-plan-banner="source">
                <BannerView status="error" title={m.narrowingUnavailable({ name: followedSource.name })} description={followedSource.error}
                    actions={<Button size="xs" variant="outline" onClick={followedSource.retry}>{m.retry()}</Button>} />
            </Box>,
        );
    }
    if (chrome?.windowError !== undefined) {
        bannerNodes.push(
            <Box key="window" data-plan-banner="window">
                <BannerView status="error" title={m.windowUnavailable({ axis: root.axis.type })} description={chrome.windowError} />
            </Box>,
        );
    }
    // A kind with more events in view than it draws, and no summary to shade them at this resolution (#1039): its rows
    // hatched, and this — how many there are, or that they are not counted where its count is no number of them (a day
    // index's), and the resolution its summary shades at.
    for (const notice of chrome?.cells?.notices ?? []) {
        const kind = notice.name.toLocaleLowerCase(words.locale);
        bannerNodes.push(
            <Box key={`cells:${notice.kind}`} data-plan-banner="cells" data-plan-kind={notice.kind}>
                <BannerView status="info"
                    title={notice.events === undefined ? m.tooManyEventsNotCounted({ kind })
                        : m.tooManyEvents({ kind, n: notice.events, count: words.number(notice.events) })}
                    description={m.tooManyEventsHint({ resolution: notice.resolution === undefined ? undefined : m.resolutionName({ resolution: notice.resolution }).toLocaleLowerCase(words.locale) })} />
            </Box>,
        );
    }
    // A link kind holding more links than are read (#1541, U10): none of them is drawn, and this says how many there are.
    for (const over of chrome?.linksOver ?? []) {
        bannerNodes.push(
            <Box key={`links:${over.kind}`} data-plan-banner="links" data-plan-kind={over.kind}>
                <BannerView status="info" title={m.tooManyLinks({ kind: lowerWord(over.name), n: over.links, count: words.number(over.links) })}
                    description={m.tooManyLinksHint()} />
            </Box>,
        );
    }
    const banners = bannerNodes.length > 0 ? <>{bannerNodes}</> : undefined;
    // After a Save, what left each source's narrowing (#1344): the `rows` source's rows, each event kind's events.
    const rowsPart = chrome?.rowsPart;
    const eventParts = chrome?.eventParts ?? NO_PARTS;
    const notices = useMemo((): readonly PlanSaveNotice[] => {
        const out: PlanSaveNotice[] = [];
        if (rowsPart !== undefined) {
            out.push({ key: ROWS_SOURCE, slice: rowsPart, singular: m.saveNoticeNoun({ kind: undefined, n: 1 }), plural: m.saveNoticeNoun({ kind: undefined, n: 2 }) });
        }
        for (const { kind, part } of eventParts) {
            const name = kind.name.toLocaleLowerCase(words.locale);
            out.push({ key: kind.key, slice: part, singular: m.saveNoticeNoun({ kind: name, n: 1 }), plural: m.saveNoticeNoun({ kind: name, n: 2 }) });
        }
        return out.length === 0 ? NO_NOTICES : out;
    }, [rowsPart, eventParts, m, words.locale]);
    // What the footer's counts say before the event kinds' first read lands (#1398, CL13): "…", never 0.
    const kindsUnread = kinds.length > 0 && kindsRead.counts === undefined;
    const footer = chrome !== undefined
        ? <PlanFooter styles={chrome.styles} items={chrome.footer} transport={chrome.transport} noun={chrome.rowsNoun}
            counts={counts} unread={kindsUnread} pending={session?.pending} notices={notices}
            optimise={chrome.optimise === undefined ? undefined : { line: chrome.optimise.line, legend: chrome.optimise.legend, flash: chrome.optimise.flash }} />
        : undefined;
    // The Plan's one reveal clock (#1398, CL4): the footer's line and the runs' placeholders show once a read the view
    // waits for has passed the delay, and are held once shown — a flip renders them, never the frame.
    const loading = chrome?.transport?.loading;
    const waiting = loading !== undefined && loading.kind !== "failed";
    // The run's landing (#1409) is measured and drawn over the whole frame — the bars and the counts alike.
    const optimiseLanding = chrome?.optimise?.landing;
    return (
        <Box ref={optimiseLanding?.ref} css={optimiseLanding === undefined ? styles.frame : [styles.frame, optimiseLanding.css]} data-plan-frame="" data-plan-bound={bound !== undefined ? "" : undefined}
            style={{ ...vars, height: bound?.height, maxHeight: bound?.maxHeight }} {...optimiseLanding?.attributes}>
            {kinds.length > 0 && (
                <PlanKindsReader kinds={kinds} scale={chrome?.scale} drafts={chrome?.events?.drafts} parts={eventParts} cells={chrome?.cells}
                    hidden={hidden} onRead={setKindsRead} />
            )}
            {inspector && (
                <PlanSelectionReader kinds={kinds} elements={selection.elements} drafts={chrome?.events?.drafts} editing={chrome?.events}
                    held={chrome?.cells?.held} onRead={setSelected} linkKinds={linkKinds} onLinks={setSelectedLinks} />
            )}
            <LoadingReveal waiting={waiting}>
                <BuilderFrame
                    storageKey={keys.frame}
                    toolbar={toolbar}
                    banners={banners}
                    start={start}
                    end={end}
                    footer={footer}
                    // A paged source's cold load is the frame's skeleton at the rows' pitch, its footer live and saying
                    // what is read; after it, a read the view waits for covers nothing, and main is busy (#1398).
                    loading={chrome?.cold}
                    busy={chrome?.busy}
                    loadingPitch={chrome?.pitch}
                    liveFooter
                    onKeyDown={onKeyDown}
                >
                    <PlanOverlapsContext.Provider value={overlapKeys}>{main}</PlanOverlapsContext.Provider>
                </BuilderFrame>
            </LoadingReveal>
        </Box>
    );
}

/** Props of {@link EastChakraPlanPayload}. */
export interface EastChakraPlanPayloadProps {
    /** The payload, decoded. */
    value: PlanValue;
    /** Storage key prefix for persisting component state. */
    storageKey: string;
}

/**
 * Renders a Plan's payload (#1191): its canvas, `plan`, in its frame
 * ({@link EastChakraPlan}), its event kinds' events placed on the canvas's own
 * rows by the payload's seam (#1192, #1541) — over rows read whole, the
 * Unassigned rows after them — its event kinds counted in the footer, its
 * library in the start pane (#1195), its inspector in the end pane (#1197),
 * and each source of its slice the frame follows read through the payload's
 * `narrowed` keys (#1344).
 *
 * @param props - The payload and its storage key
 * @returns The Plan, in its frame
 */
export const EastChakraPlanPayload = memo(function EastChakraPlanPayload({ value, storageKey }: EastChakraPlanPayloadProps) {
    // The app's words (#1516), over whatever table a host gives it: everything below reads them.
    const vocabulary = useDataStable(value.vocabulary, vocabularyEqual);
    return <PlanVocabularyProvider vocabulary={vocabulary}><PlanPayloadFrame value={value} storageKey={storageKey} /></PlanVocabularyProvider>;
}, (prev, next) => planPayloadEqual(prev.value, next.value) && prev.storageKey === next.storageKey);

/** The payload's frame, inside the app's words. */
function PlanPayloadFrame({ value, storageKey }: EastChakraPlanPayloadProps) {
    const events = useMemo(
        (): PlanEventRows | undefined => (value.seam.type === "some"
            ? { seam: value.seam.value, landings: value.landings, paged: value.paged }
            : undefined),
        [value.seam, value.landings, value.paged]);
    // The sources the frame follows itself (#1344), each read once — one component each, so their hooks keep their
    // order — in the Plan's words.
    const { m, locale } = useResolvedPlanWords();
    const chrome = getSomeorUndefined(value.plan.slice);
    const sources = useMemo(() => planFollowedSources(value), [value]);
    const rowsWord = m.saveNoticeNoun({ kind: undefined, n: 2 });
    const nouns = useMemo(() => new Map(Object.entries(planNouns(value.events, value.library, rowsWord, locale))),
        [value.events, value.library, rowsWord, locale]);
    const said = useCallback((name: string): KeyVisibilityWords => ({ changed: m.narrowingChanged({ name }), failed: m.narrowingFailed({ name }) }), [m]);
    return (
        <FollowSources chrome={chrome} narrowed={value.narrowed} sources={sources} nouns={nouns} said={said}>
            {(followed) => (
                <EastChakraPlan value={value.plan} storageKey={storageKey} events={events} kinds={value.events}
                    landings={value.landings} library={value.library} inspector={value.inspector}
                    followed={followed} optimise={getSomeorUndefined(value.optimise)}
                    autosave={value.settings.autosave} linkKinds={value.linkKinds} />
            )}
        </FollowSources>
    );
}

implementUIComponent(PlanComponent, EastChakraPlanPayload);
