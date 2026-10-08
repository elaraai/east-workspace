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
 *   backlog, and when a kind's record was last saved), the changes waiting on
 *   Save, the author's items, and a paged canvas's
 *   transport line;
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
 * kinds' rows leave it out through the `blocks` seam, and the canvas leaves
 * out the Plan's own `rows` it hides.
 *
 * A declared `style.height` / `maxHeight` is the whole Plan's: the frame
 * takes it, and the canvas fills main. Without one, the frame fills its
 * parent when the parent gives it a height, the canvas filling main, and
 * grows with its canvas when the parent grows with what it holds. The Plan
 * draws no border of its own.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { equalFor, equivalentFor, none, type ValueTypeOf } from "@elaraai/east";
import { Plan, PlanComponent, PlanEventBlocksType, PlanPayloadType, planKeys } from "@elaraai/e3-ui/internal";
import {
    BuilderFrame, SessionBanners, getSomeorUndefined, historyShortcut, implementUIComponent, typedInto, useDataStable, usePersistedState,
} from "@elaraai/east-ui-components";
import { usePlanCanvas } from "../canvas.js";
import type { PlanCanvasParts } from "../root/chrome.js";
import type { PlanEventRows } from "../root/events.js";
import { usePlanToolbarItems } from "../shell/Toolbar.js";
import { PlanFooter } from "../shell/Footer.js";
import type { PlanRootValue } from "../model.js";
import { PlanOverlapsContext } from "../rows/element-overlap.js";
import { usePlanWords } from "../words.js";
import { usePlanEventCounts, type PlanOverlaps } from "./counts.js";
import { NONE_HIDDEN, hiddenOf, rowsHiddenOf } from "./hidden.js";
import { usePlanInspector } from "./inspector.js";
import { tabLibrary, usePlanLibrary, type PlanPickValue } from "./library.js";

/** The Plan's payload, decoded — what `<Plan>` returns through the `Plan` carrier (#1191). */
export type PlanValue = ValueTypeOf<typeof PlanPayloadType>;

/** The Plan's event kinds, as its payload carries them (#1190). */
type PlanEventKinds = PlanValue["events"];

/** The Plan's resource kinds, as its payload carries them (#1190). */
type PlanResourceKinds = PlanValue["resources"];

/** The library pane's tabs, as the payload lists them (#1195). */
type PlanLibraryTabs = PlanValue["library"];

type Styles = Record<string, Record<string, unknown>>;

// The memo compares CLOSURES too (#809). A Plan root is function-heavy — the
// resolvers, the element callbacks, a paged source's `page` wrapping its
// series — and `equalFor` calls every pair of functions equal, so a root that
// differed only inside one (a resolver over new data, a series `match` over a
// new threshold) was dropped and the canvas rendered the old closures.
const planRootEqual = equivalentFor(Plan.Types.Root);
/** Whether two event-rows seams read the same rows: their functions by their IR and what they capture (#809). */
const eventBlocksEquivalent = equivalentFor(PlanEventBlocksType);
/** Whether two lists of event kinds read the same records, their seams compared by their IR and what they capture. */
const eventKindsEquivalent = equivalentFor(PlanPayloadType.fields.events);
/** The payload's equivalence: its data, and its functions by their IR and what they capture (#809). */
const planPayloadEqual = equivalentFor(PlanPayloadType);

/** No event kinds: a Plan of `data` and `rows` alone. */
const NO_KINDS: PlanEventKinds = [];

/** No resource kinds. */
const NO_RESOURCES: PlanResourceKinds = [];

/** No library: no pane. */
const NO_LIBRARY: PlanLibraryTabs = [];

/** Whether two libraries list the same tabs and cards: they hold data alone. */
const libraryEqual = equalFor(PlanPayloadType.fields.library);
/** Whether two lists of resource kinds name the same resources. */
const resourcesEqual = equalFor(PlanPayloadType.fields.resources);
/** Whether two drop vetoes are one: by their IR and what they capture (#809). */
const canDropEquivalent = equivalentFor(PlanPayloadType.fields.canDrop);

/** The event kinds' drop veto, when the payload has one. */
type PlanEventCanDrop = PlanValue["canDrop"];

/** No veto: every drop the event kinds take lands. */
const NO_VETO: PlanEventCanDrop = none;

/** No event kind has an event on the canvas. */
const NO_PATCH_KINDS: ReadonlySet<string> = new Set();

/** Whether two event-rows props read the same rows. */
function sameEventRows(a: PlanEventRows | undefined, b: PlanEventRows | undefined): boolean {
    if (a === undefined || b === undefined) return a === b;
    return a.count === b.count && eventBlocksEquivalent(a.blocks, b.blocks);
}

/** No event in an overlap pair. */
const NO_OVERLAPS: ReadonlySet<string> = new Set();

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
    /** The event kinds' rows (#1192), drawn ahead of the root's own — a Plan of event kinds' payload carries them. */
    events?: PlanEventRows | undefined;
    /** The event kinds themselves (#1190), which the footer counts and the library lists — a Plan of event kinds' payload carries them. */
    kinds?: PlanEventKinds | undefined;
    /** The resource kinds (#1190), which the library's cards name — a Plan of event kinds' payload carries them. */
    resources?: PlanResourceKinds | undefined;
    /** The library pane's tabs (#1195) — the payload carries them; none, no pane. */
    library?: PlanLibraryTabs | undefined;
    /** Whether the Plan has its inspector pane (#1197) — the payload carries it; left out, no pane. */
    inspector?: boolean | undefined;
    /** When the event kinds' drafts go (#1194) — the payload's settings carry it: on Save (`batch`, the default), or as each gesture lands. */
    applyMode?: "batch" | "auto" | undefined;
    /** The event kinds' drop veto (#1196) — the payload carries it: where a drop would put an event, to the refusal's message. */
    canDrop?: PlanEventCanDrop | undefined;
}

/**
 * Renders the Plan in its frame — see the module docs.
 *
 * @param props - The root, its storage key, the event kinds and their rows, the resource kinds, the library's tabs, whether it has its inspector, when the event kinds' drafts go, and their drop veto
 * @returns The Plan, in its frame
 */
export const EastChakraPlan = memo(function EastChakraPlan({ value, storageKey, events, kinds, resources, library: given, inspector, applyMode, canDrop }: EastChakraPlanProps) {
    const library = useDataStable(given ?? NO_LIBRARY, libraryEqual);
    const id = getSomeorUndefined(value.id);
    const keys = useMemo(() => planKeys(id), [id]);
    // What this viewer hides in the Series tab (PB29), kept under the Plan's
    // id: a Plan without the tab hides none — nothing on it could show them
    // again, and another Plan under the same id may have hidden them.
    const { state: stored, setState: store } = usePersistedState<readonly string[]>(keys.series, NONE_HIDDEN);
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
    // Each event kind a session over its record, under one history with `data`'s (#1194), its drags on the canvas (#1196).
    const veto = useMemo(() => getSomeorUndefined(canDrop ?? NO_VETO), [canDrop]);
    const canvas = usePlanCanvas({
        value, storageKey, events, hidden, rowsHidden, eventKinds, panel, kinds: kinds ?? NO_KINDS, applyMode,
        resources: resources ?? NO_RESOURCES, tabs: library, canDrop: veto,
    });
    return <>{canvas.provide(
        <PlanFrame canvas={canvas} root={value} kinds={kinds ?? NO_KINDS} resources={resources ?? NO_RESOURCES} library={library}
            inspector={inspector === true} hidden={hidden} onHidden={onHidden} />,
    )}</>;
}, (prev, next) => planRootEqual(prev.value, next.value) && prev.storageKey === next.storageKey
    && (prev.inspector === true) === (next.inspector === true)
    && (prev.applyMode ?? "batch") === (next.applyMode ?? "batch")
    && (Object.is(prev.canDrop, next.canDrop) || canDropEquivalent(prev.canDrop ?? NO_VETO, next.canDrop ?? NO_VETO))
    && sameEventRows(prev.events, next.events)
    && (prev.kinds === next.kinds || eventKindsEquivalent(prev.kinds ?? NO_KINDS, next.kinds ?? NO_KINDS))
    && (prev.resources === next.resources || resourcesEqual(prev.resources ?? NO_RESOURCES, next.resources ?? NO_RESOURCES))
    && (prev.library === next.library || libraryEqual(prev.library ?? NO_LIBRARY, next.library ?? NO_LIBRARY)));

/** Props of {@link PlanFrame}. */
interface PlanFrameProps {
    /** What the canvas hands its frame. */
    canvas: PlanCanvasParts;
    /** The Plan root value: its axis's now, and its pick over `data`'s series. */
    root: PlanRootValue;
    /** The Plan's event kinds — none for a Plan of `data` and `rows` alone. */
    kinds: PlanEventKinds;
    /** Its resource kinds. */
    resources: PlanResourceKinds;
    /** The library pane's tabs; none, no pane. */
    library: PlanLibraryTabs;
    /** Whether the Plan has its inspector pane. */
    inspector: boolean;
    /** The ids this viewer hides in the Series tab. */
    hidden: readonly string[];
    /** Replaces them. */
    onHidden: (next: readonly string[]) => void;
}

/** The frame, its regions holding the canvas and its chrome — inside the canvas's contexts. */
function PlanFrame({ canvas, root, kinds, resources, library, inspector, hidden, onHidden }: PlanFrameProps) {
    const { chrome, main, bound, vars } = canvas;
    const recipe = useSlotRecipe({ key: "plan" });
    const styles = useMemo(() => recipe() as unknown as Styles, [recipe]);
    const id = getSomeorUndefined(root.id);
    const keys = useMemo(() => planKeys(id), [id]);
    const words = usePlanWords();
    // The backlog's weeks count from the axis's now, or from the clock when the Plan mounted.
    const [mounted] = useState(() => new Date());
    const now = root.axis.type === "time" ? getSomeorUndefined(root.axis.value.now) ?? mounted : mounted;
    const pick = useMemo((): PlanPickValue | undefined => getSomeorUndefined(root.pick), [root.pick]);
    const start = usePlanLibrary({
        library, kinds, resources, pick, keys, hidden, onHidden, now, words, takesCards: chrome?.takesCards === true,
        drafts: chrome?.events?.drafts, takesEvents: chrome?.takesEvents === true, patchKinds: chrome?.patchKinds ?? NO_PATCH_KINDS,
    });
    // Counted with every kind's drafts in place (#1194).
    const counts = usePlanEventCounts(kinds, chrome?.scale, chrome?.events?.drafts);
    // The overlaps (#1198): the toolbar's chip, the warn rings, the inspector's banner.
    const overlaps = kinds.length > 0 ? counts?.overlaps : undefined;
    const items = usePlanToolbarItems(chrome, overlaps);
    const overlapKeys = useOverlapKeys(overlaps);
    const end = usePlanInspector({ shown: inspector, kinds, resources, chrome, counts, keys, words });
    // The Plan's one history (#1194): the history item reads it as one session.
    const history = chrome?.history;
    const session = history?.session;
    const onAction = history?.onAction;
    // The history keys from anywhere in the frame: the canvas's own it has answered already.
    const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if (onAction === undefined || event.defaultPrevented || typedInto(event.target)) return;
        const action = historyShortcut(event);
        if (action === undefined) return;
        event.preventDefault();
        onAction(action);
    }, [onAction]);
    // A Plan with no control to show — no slice, no search, no group to fold, no overlaps, no editing — draws no toolbar.
    const toolbar = items.some((item) => item !== undefined && item !== false) ? items : undefined;
    // Each session's banners, in the history's order: `data`'s, then each event kind's, named.
    const banners = chrome !== undefined && history !== undefined && chrome.sessions.length > 0
        ? (
            <>
                {chrome.sessions.map((held) => (
                    <SessionBanners key={held.key} session={held.session} words={chrome.words} onAction={held.onAction}
                        where={held.where} name={held.name} />
                ))}
            </>
        )
        : undefined;
    const footer = chrome !== undefined
        ? <PlanFooter styles={chrome.styles} items={chrome.footer} transport={chrome.transport}
            counts={kinds.length > 0 ? counts : undefined} pending={session?.pending} narrow={chrome.narrow} />
        : undefined;
    return (
        <Box css={styles.frame} data-plan-frame="" data-plan-bound={bound !== undefined ? "" : undefined}
            style={{ ...vars, height: bound?.height, maxHeight: bound?.maxHeight }}>
            <BuilderFrame
                storageKey={keys.frame}
                toolbar={toolbar}
                banners={banners}
                start={start}
                end={end}
                footer={footer}
                onKeyDown={onKeyDown}
            >
                <PlanOverlapsContext.Provider value={overlapKeys}>{main}</PlanOverlapsContext.Provider>
            </BuilderFrame>
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
 * ({@link EastChakraPlan}), with its event kinds' rows ahead of the canvas's
 * own (#1192) — one block per resource kind, then the Unassigned rows' — its
 * event kinds counted in the footer, its library in the start pane (#1195),
 * and its inspector in the end pane (#1197).
 *
 * @param props - The payload and its storage key
 * @returns The Plan, in its frame
 */
export const EastChakraPlanPayload = memo(function EastChakraPlanPayload({ value, storageKey }: EastChakraPlanPayloadProps) {
    const resourceKinds = value.resources.length;
    const events = useMemo(
        (): PlanEventRows | undefined => (value.blocks.type === "some" ? { blocks: value.blocks.value, count: resourceKinds + 1 } : undefined),
        [value.blocks, resourceKinds]);
    return <EastChakraPlan value={value.plan} storageKey={storageKey} events={events} kinds={value.events}
        resources={value.resources} library={value.library} inspector={value.inspector} applyMode={value.settings.applyMode.type}
        canDrop={value.canDrop} />;
}, (prev, next) => planPayloadEqual(prev.value, next.value) && prev.storageKey === next.storageKey);

implementUIComponent(PlanComponent, EastChakraPlanPayload);
