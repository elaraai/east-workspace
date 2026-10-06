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
 *   diagnostics; at the row's end the summary, the review — its summary with
 *   Reject all, Rerun and Approve all, moved here from the review foot — and
 *   the history item, which leaves its error to the banners. A Plan with none
 *   of them has no toolbar. ⌘Z undoes and ⇧⌘Z or ⌘Y redoes from anywhere in
 *   the frame, never while typing;
 * - **the banners** — the editing session's (`SessionBanners`): an Apply's
 *   conflict, naming its rows; a refusal, with its reasons; a write with no
 *   answer, with Retry; an Apply whose result could not be read back, with
 *   Retry; and the drafts the source moved under, with Discard. Each leaves
 *   when what it reports does;
 * - **main** — the canvas, unchanged: the horizon brush, the ruler and the
 *   now line, the pinned rows, the rows — or, below 480px of main, the
 *   narrow layout's tabs and cards — the links and the overlays;
 * - **the footer** — the event kinds' counts (the events in the window, the
 *   backlog, the events to review, and when a kind's record was last saved),
 *   the changes waiting on Apply, the author's items, and a paged canvas's
 *   transport line;
 * - **the panes** — the library in the start pane when the Plan's `library`
 *   lists a tab (#1195, `library.tsx`), and the inspector in the end pane
 *   (#1197): optional props, no prop, no pane. Their open tab and collapsed
 *   state persist under the Plan's `id` (`planKeys(id).frame`, PB25).
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

import { memo, useCallback, useMemo, useState, type KeyboardEvent } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { equalFor, equivalentFor, type ValueTypeOf } from "@elaraai/east";
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
import { usePlanWords } from "../words.js";
import { usePlanEventCounts } from "./counts.js";
import { NONE_HIDDEN, hiddenOf, rowsHiddenOf } from "./hidden.js";
import { usePlanLibrary, type PlanPickValue } from "./library.js";

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

/** Whether two event-rows props read the same rows. */
function sameEventRows(a: PlanEventRows | undefined, b: PlanEventRows | undefined): boolean {
    if (a === undefined || b === undefined) return a === b;
    return a.count === b.count && eventBlocksEquivalent(a.blocks, b.blocks);
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
}

/**
 * Renders the Plan in its frame — see the module docs.
 *
 * @param props - The root, its storage key, the event kinds and their rows, the resource kinds, and the library's tabs
 * @returns The Plan, in its frame
 */
export const EastChakraPlan = memo(function EastChakraPlan({ value, storageKey, events, kinds, resources, library: given }: EastChakraPlanProps) {
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
    const canvas = usePlanCanvas({ value, storageKey, events, hidden, rowsHidden });
    return <>{canvas.provide(
        <PlanFrame canvas={canvas} root={value} kinds={kinds ?? NO_KINDS} resources={resources ?? NO_RESOURCES} library={library}
            hidden={hidden} onHidden={onHidden} />,
    )}</>;
}, (prev, next) => planRootEqual(prev.value, next.value) && prev.storageKey === next.storageKey
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
    /** The ids this viewer hides in the Series tab. */
    hidden: readonly string[];
    /** Replaces them. */
    onHidden: (next: readonly string[]) => void;
}

/** The frame, its regions holding the canvas and its chrome — inside the canvas's contexts. */
function PlanFrame({ canvas, root, kinds, resources, library, hidden, onHidden }: PlanFrameProps) {
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
    const start = usePlanLibrary({ library, kinds, resources, pick, keys, hidden, onHidden, now, words });
    const items = usePlanToolbarItems(chrome);
    const counts = usePlanEventCounts(kinds, chrome?.scale);
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
    // A Plan with no control to show — no slice, no search, no group to fold, no review, no editing — draws no toolbar.
    const toolbar = items.some((item) => item !== undefined && item !== false) ? items : undefined;
    const banners = chrome !== undefined && history !== undefined && session !== undefined
        ? <SessionBanners session={session} words={chrome.words} onAction={history.onAction} where={chrome.where} />
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
                footer={footer}
                onKeyDown={onKeyDown}
            >
                {main}
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
 * event kinds counted in the footer, and its library in the start pane
 * (#1195).
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
        resources={value.resources} library={value.library} />;
}, (prev, next) => planPayloadEqual(prev.value, next.value) && prev.storageKey === next.storageKey);

implementUIComponent(PlanComponent, EastChakraPlanPayload);
