/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraFlowchart` — the Flowchart (#1243–#1247, `Flowchart Builder
 * Spec.md` §7, §7.1, §8, §9.4–§9.6): the one flowchart, laid out in
 * `BuilderFrame` wherever it is used. There is no other flowchart: no canvas
 * without the frame, and no toolbar but its one.
 *
 * It registers itself against the `Flowchart` extension (`Flowchart.Component`)
 * as the module loads. Its payload carries where the flows come from — a
 * record of flows by name, or the host's flows or flow — and the canvas's
 * options: the flowchart reads the flows (a record's where it renders, and
 * again when it moves), opens one, and the frame places its parts in its
 * regions, over one shared state — the open flow's model, its session, the
 * orientation and the state find state picked:
 *
 * - **the open flow**, over many flows (FB12, `open-flow.ts`): the one the
 *   viewer opened last, kept in the UI store under the flowchart's `name`,
 *   while the flowchart holds it; else `flow`; else the first by name; else
 *   none, and main says so in the shared empty state. While `flow` names a
 *   flow the flowchart doesn't hold, and the viewer has opened none in its
 *   place, a banner above main names it and the flow shown (FB42);
 * - **its session** (FB14, FB15, FB17–FB24, `session.ts`): one editing session
 *   per flow, so each flow keeps its drafts while another is open — over a
 *   record, and over the host's flows or flow given `onApply`; over neither,
 *   or read only, the flowchart edits nothing. Every gesture on the canvas is
 *   one transaction of the open flow's session (`edits.ts`); its history item
 *   ends the toolbar — ⌘Z undoing and ⇧⌘Z or ⌘Y redoing from anywhere in the
 *   frame but a field being typed into — and its banners sit under it. Save
 *   sends the open flow's drafts as one commit: the payload's `apply`, through
 *   the record's patch mutation or the host's `onApply`;
 * - **LR · TD** (FB43, `orientation.ts`): the viewer's, kept in the UI store
 *   under the flowchart's `name`; the payload's `orientation` until they pick;
 * - **the toolbar** — the flowchart's items (`useFlowchartToolbarItems`,
 *   `toolbar.tsx`) on the frame's one folding row, in §7.1's order: find
 *   state, LR · TD and the freshness chip, and at the row's end the slice's
 *   rail over `data` and the history item over a record. The canvas draws no
 *   eyebrow;
 * - **main** — the canvas (`canvas.tsx`), filling main and scrolling both
 *   ways inside it;
 * - **the footer** — today's counts (`footer.tsx`): over many flows the open
 *   flow's name first; where it edits, the changes waiting on Save; and over a
 *   record its last save;
 * - **the panes** — the library in the start pane when the payload's
 *   `library` lists a tab (`library.tsx`, #1248), and the inspector in the end
 *   pane when it is given `inspector`: optional props, no prop, no pane. The
 *   library's tabs are the ones `library` lists, in its order, each with its
 *   count: the Flows tab (`flows.tsx`), which lists every flow by name and
 *   starts new ones, and the state and transition templates and the author's
 *   tabs, each a `Library` of its own rows' cards; what the inspector holds is
 *   #1250's. The panes' open tab and collapsed state persist under the
 *   flowchart's `name` (`flowchartKeys(name).frame`).
 *
 * The flowchart fills the box it is given and draws no border: a host gives it
 * a box of its own height.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Box, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { StringType, compareFor, equalFor, equivalentFor, none, type ValueTypeOf } from "@elaraai/east";
import type { Slice as SliceInternal } from "@elaraai/east-ui/internal";
import { Flowchart, flowchartKeys } from "@elaraai/e3-ui/internal";
import {
    BannerView,
    BuilderFrame,
    SessionBanners,
    getSomeorUndefined,
    historyShortcut,
    historyToolbarItem,
    implementUIComponent,
    typedInto,
    useDataStable,
    useFormatters,
    useSliceReactivity,
    useTrackedEvaluation,
    type BuilderFrameDock,
    type EditIssue,
    type HistoryAction,
} from "@elaraai/east-ui-components";
import { buildModel, type FlowchartCanvasValue, type FlowchartFlowValue, type FlowchartValue } from "./model.js";
import { FlowchartCanvasView, type FlowchartCanvasEdit, type FlowchartReveal } from "./canvas.js";
import * as flowEdits from "./edits.js";
import { useFindState } from "./find.js";
import { FlowchartFooter, useLastSave } from "./footer.js";
import { FlowsTab, NoFlows, type FlowCard, type NewFlowProps } from "./flows.js";
import { useFlowchartLibrary } from "./library.js";
import { flowchartMessages, type FlowchartWords } from "./messages.js";
import { missingFlow, openFlowName, useOpenedFlow } from "./open-flow.js";
import { useViewerOrientation } from "./orientation.js";
import { ONE_FLOW, draftedFlow, newFlows, recordFlowEdit, recordNewFlow, useFlowSession, useKeptSessions, type FlowApply } from "./session.js";
import { useFlowchartToolbarItems } from "./toolbar.js";

type Styles = Record<string, SystemStyleObject>;

/** The memo's comparison: a changed callback re-renders. */
const payloadEqual = equivalentFor(Flowchart.Types.Payload);
/** The model's gate: only a change of the flow's data rebuilds it. */
const flowEqual = equalFor(Flowchart.Types.Flow);
/** Flows by name, in East's order. */
const nameOrder = compareFor(StringType);
const nameEqual = equalFor(StringType);

export type { FlowchartValue, FlowchartCanvasValue, FlowchartFlowValue };

/** Props of {@link EastChakraFlowchart}. */
export interface EastChakraFlowchartProps {
    /** The payload, decoded. */
    value: FlowchartValue;
    /** The structural storage key. */
    storageKey: string;
}

/** The inspector pane's width open: the design system's 320px (§8). */
const INSPECTOR_SIZE = "320px";

/** The flows by name, decoded. */
type FlowsValue = ValueTypeOf<typeof Flowchart.Types.Flows>;

/** The flows a payload's source holds: many by name, or one. */
type FlowsHeld =
    | { readonly many: true; readonly flows: FlowsValue }
    | { readonly many: false; readonly flow: FlowchartFlowValue };

/** A flow with nothing in it: the canvas while a flow is not yet there to draw. */
const NO_FLOW: FlowchartFlowValue = { description: none, lanes: [], states: [], links: [], triggers: [] };

/**
 * A new lane's label, by its number — `Lane 3` — in the flowchart's words.
 *
 * @param words - The flowchart's words
 * @returns The label for a number
 */
const laneLabel = (words: FlowchartWords) => (n: number): string => words.m.newLane({ n, count: words.number(n) });

/**
 * A new flow (FB14): one lane, nothing else — the lane "+ LANE" adds to a flow
 * with none, `lane-1`.
 *
 * @param words - The flowchart's words: the lane's label
 * @returns The flow
 */
function emptyFlow(words: FlowchartWords): FlowchartFlowValue {
    return flowEdits.addLane(NO_FLOW, laneLabel(words)).flow;
}

/**
 * The session's Save a payload's source carries (#1246, #1247): a record's,
 * or the host's `onApply` over its flows or flow; `undefined` over data the
 * host keeps read only.
 *
 * @param source - The payload's source
 * @returns The Save
 */
function saveOf(source: FlowchartValue["source"]): FlowApply | undefined {
    switch (source.type) {
        case "record": return source.value.apply;
        case "data": return getSomeorUndefined(source.value.value.apply);
    }
}

/**
 * The flows a source holds: a record's flows by name, read — a reactive read,
 * which the flowchart's tracked evaluation follows — or the host's flows or
 * flow, as they came.
 *
 * @param source - The payload's source
 * @returns The flows by name, or the one flow
 */
function flowsHeld(source: FlowchartValue["source"]): FlowsHeld {
    switch (source.type) {
        case "record": return { many: true, flows: source.value.read() };
        case "data": return source.value.type === "flows"
            ? { many: true, flows: source.value.value.value }
            : { many: false, flow: source.value.value.value };
    }
}

/** The inspector pane: the frame's end pane. What it holds is #1250's. */
const INSPECTOR_PANE: BuilderFrameDock = { label: "Inspector", icon: "sliders", size: INSPECTOR_SIZE, persist: "local", body: null };

/**
 * Renders the flowchart: reads its flows from the payload's source, and lays
 * them out in its frame — see the module docs.
 *
 * @param props - The payload and its storage key
 * @returns The flowchart, in its frame
 */
export const EastChakraFlowchart = memo(function EastChakraFlowchart({ value, storageKey }: EastChakraFlowchartProps) {
    const styles = useSlotRecipe({ key: "flowchart" })();
    const source = value.source;
    // The flows, read where the flowchart renders, and again when they move.
    const read = useCallback(() => flowsHeld(source), [source]);
    const { result } = useTrackedEvaluation(read);
    if (!result.ok) {
        const message = result.error instanceof Error ? result.error.message : String(result.error);
        // The frame stays: its main says why, in the canvas's place.
        return (
            <Box css={styles.root} data-flowchart-root="">
                <BuilderFrame storageKey={flowchartKeys(getSomeorUndefined(value.name)).frame}>
                    <BannerView status="error" title={`The flows could not be read: ${message}`} />
                </BuilderFrame>
            </Box>
        );
    }
    return <FlowchartFrame value={value} held={result.value} storageKey={storageKey} />;
}, (prev, next) => payloadEqual(prev.value, next.value) && prev.storageKey === next.storageKey);

/** Props of {@link FlowchartFrame}. */
interface FlowchartFrameProps {
    /** The payload, decoded. */
    readonly value: FlowchartValue;
    /** The flows its source holds. */
    readonly held: FlowsHeld;
    /** The structural storage key. */
    readonly storageKey: string;
}

/** The frame, its regions holding the flowchart's parts over one shared state. */
function FlowchartFrame({ value, held, storageKey }: FlowchartFrameProps) {
    const styles = useSlotRecipe({ key: "flowchart" })() as Styles;
    // The counts, the dates and the badges, in the app's locale (#850), and the flowchart's words.
    const formatters = useFormatters();
    const words = useMemo((): FlowchartWords => ({ ...formatters, m: flowchartMessages }), [formatters]);
    const canvas = value.canvas;
    // Keyed on the name's text: each payload decodes its Option afresh, and the keys must hold while the name does.
    const flowchartName = getSomeorUndefined(value.name);
    const keys = useMemo(() => flowchartKeys(flowchartName), [flowchartName]);

    // ── The flows, and the one open (FB12) ──────────────────────────────
    const flows = held.many ? held.flows : undefined;
    // The session's Save, while the flowchart edits: a record's, or the host's onApply over `data`.
    const apply = value.readOnly ? undefined : saveOf(value.source);
    const [opened, openFlow] = useOpenedFlow(keys.flow);
    // The flow "+ New flow" is starting: open at once, recorded once its session has read its base.
    const [creating, setCreating] = useState<string | undefined>(undefined);
    const kept = useKeptSessions(storageKey, keys.flow);
    // The new flows the sessions hold, not yet saved, as their drafts stand.
    const fresh = useMemo(() => (flows === undefined ? new Map<string, FlowchartFlowValue>() : newFlows(kept.sessions, (n) => flows.has(n))),
        // The sessions move under their version.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [flows, kept.sessions, kept.version]);
    // Whether the flowchart holds a flow of a name: in its flows, or as a new flow, committed or not.
    const holds = useCallback((n: string) => flows !== undefined
        && (flows.has(n) || fresh.has(n) || (creating !== undefined && nameEqual(creating, n))), [flows, fresh, creating]);
    const asked = getSomeorUndefined(value.open);
    const openName = useMemo(() => (flows === undefined ? undefined
        : openFlowName([...flows.keys(), ...fresh.keys()], holds, opened, asked)), [flows, fresh, holds, opened, asked]);
    // `flow` names a flow the flowchart doesn't hold, and the viewer opened none in its place: the banner's (FB42).
    const missing = missingFlow(holds, opened, asked);
    const heldFlow = flows !== undefined && openName !== undefined ? flows.get(openName) : undefined;

    // ── The open flow's session (FB14, FB15) ────────────────────────────
    // Its entry: the open flow's name over many flows; over the host's one flow, that flow (#1247).
    const entry = held.many ? openName : ONE_FLOW;
    const entryHeld = held.many ? heldFlow : held.flow;
    const flowSession = useFlowSession({ key: keys.flow, name: entry, held: entryHeld, apply, storageKey, sessions: kept.sessions, words });
    const { session, original, available } = flowSession;
    useEffect(() => {
        if (creating === undefined || openName === undefined || !nameEqual(openName, creating) || !available) return;
        // A name another write took meanwhile is the record's: it opens as the record holds it.
        if (heldFlow === undefined) recordNewFlow(session, creating, emptyFlow(words), words.m.newFlow());
        setCreating(undefined);
    }, [creating, openName, heldFlow, available, session, words]);
    // The open flow as its drafts stand; with none, as its source holds it.
    const pending = session.pending > 0;
    const shown = pending ? flowSession.drafted : (entryHeld ?? flowSession.drafted);
    const flow = shown ?? NO_FLOW;
    // It edits while it has Save and a flow open: its history item, its banners and its keys.
    const edits = apply !== undefined && entry !== undefined;
    // The changes waiting on Save, the footer's (FB10): counted when the drafts move, never on a render that moves nothing.
    const drafted = flowSession.drafted;
    const waiting = useMemo(() => (!edits ? undefined : pending ? flowEdits.pendingChanges(entryHeld, drafted) : 0),
        [edits, pending, entryHeld, drafted]);

    // ── The gestures (FB17–FB20): each one transaction of the open flow's session ──
    // They show wherever the flowchart edits, and record nothing while the
    // session takes no gesture — a Save in flight, drafts out of date — as
    // the history item's buttons are off then.
    const canvasEdit = useMemo((): FlowchartCanvasEdit | undefined => {
        // Over a flow its source or its drafts hold — never a new flow before its session holds it.
        if (!edits || entry === undefined || shown === undefined) return undefined;
        // Each gesture reads the flow as the session holds it now — never a render's copy — and records the flow it leaves.
        const now = (): FlowchartFlowValue => draftedFlow(session, entry) ?? entryHeld ?? NO_FLOW;
        const record = (next: FlowchartFlowValue | undefined, edit: flowEdits.FlowchartEdit): void => {
            if (next !== undefined) recordFlowEdit({ session, original }, entry, next, flowEdits.EDIT_ORIGIN[edit], words.m.editLabel({ edit }));
        };
        return {
            addLane: () => record(flowEdits.addLane(now(), laneLabel(words)).flow, "addLane"),
            renameLane: (key, label) => record(flowEdits.renameLane(now(), key, label), "renameLane"),
            deleteLane: (key) => record(flowEdits.deleteLane(now(), key), "deleteLane"),
            addState: (lane, key, label) => record(flowEdits.addState(now(), lane, key, label), "addState"),
            editState: (key, next, label) => record(flowEdits.editState(now(), key, next, label), "editState"),
            moveState: (key, lane) => record(flowEdits.moveState(now(), key, lane), "moveState"),
            deleteState: (key) => record(flowEdits.deleteState(now(), key), "deleteState"),
            connect: (from, to) => record(flowEdits.connect(now(), from, to).flow, "connect"),
            deleteLink: (key) => record(flowEdits.deleteLink(now(), key), "deleteLink"),
            deleteDecision: (key) => record(flowEdits.deleteDecision(now(), key), "deleteDecision"),
        };
    }, [edits, entry, entryHeld, shown, session, original, words]);

    // The open flow's model, the canvas's and the footer's — keyed on the
    // flow's DATA (#809): a closure-only change keeps it.
    const data = useDataStable(flow, flowEqual);
    const model = useMemo(() => buildModel(data, words), [data, words]);
    // LR · TD (FB43): the viewer's, kept under the flowchart's name; the canvas's `orientation` until they pick.
    const [orientation, setOrientation] = useViewerOrientation(keys.orientation, getSomeorUndefined(canvas.orientation)?.type ?? "LR");
    // Find state over the open flow's states: a pick reveals the state on the canvas.
    const [reveal, setReveal] = useState<FlowchartReveal | null>(null);
    const onPick = useCallback((key: string) => { setReveal((was) => ({ key, seq: (was?.seq ?? 0) + 1 })); }, []);
    const findable = useMemo(() => data.states.map((s) => ({ key: s.key, label: getSomeorUndefined(s.label) })), [data]);
    const find = useFindState(findable, openName ?? "", onPick);
    // The host's slice over the transitions it builds its flow from (over `data`).
    const sliceChrome = getSomeorUndefined(canvas.slice) as
        | { slice: ValueTypeOf<typeof SliceInternal.Types.Bind>; affordances: ReadonlyArray<{ type: string }> }
        | undefined;
    const slice = sliceChrome?.slice;
    const affordances = useMemo(() => sliceChrome?.affordances.map((a) => a.type) ?? [], [sliceChrome]);
    // The footer's counts read the slice's store: they follow it.
    useSliceReactivity(slice?.key);
    const total = slice !== undefined ? Number(slice.totalCount()) : undefined;
    const narrowed = slice !== undefined ? Number(slice.resultCount() ?? slice.totalCount()) : undefined;
    const freshnessValue = getSomeorUndefined(canvas.freshness);
    const freshness = useMemo(
        () => (freshnessValue === undefined ? undefined : { label: freshnessValue.label, date: getSomeorUndefined(freshnessValue.date) }),
        [freshnessValue]);

    // ── The history item and the banners: the open flow's session (FB15) ──
    const onAction = useCallback((action: HistoryAction) => {
        switch (action) {
            case "undo": session.undo(); return;
            case "redo": session.redo(); return;
            case "discard": session.discard(); return;
            case "refresh": session.refresh(); return;
            case "apply": void session.apply(); return;
        }
    }, [session]);
    // An issue is the flow's it names, which opens; one of the record's as a whole — or the host's one flow's — names none.
    const onIssue = useCallback((issue: EditIssue) => { if (held.many && !nameEqual(issue.entry, "")) openFlow(issue.entry); }, [held.many, openFlow]);
    const history = edits ? historyToolbarItem({ session, words, editing: false, onIssue, onAction, showError: false }) : undefined;
    // The history keys from anywhere in the frame (FB21): never a field being typed into, which keeps its own undo.
    const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if (!edits || event.defaultPrevented || typedInto(event.target)) return;
        const action = historyShortcut(event);
        if (action === undefined) return;
        event.preventDefault();
        onAction(action);
    }, [edits, onAction]);
    const items = useFlowchartToolbarItems({ styles, find, orientation, onOrientation: setOrientation, freshness, slice, affordances, words, history });
    const saved = useLastSave(value.source, words);

    // ── The Flows tab (FB13, FB14) ──────────────────────────────────────
    const cards = useMemo((): FlowCard[] => {
        if (flows === undefined) return [];
        const names = [...new Set([...flows.keys(), ...fresh.keys()])].sort(nameOrder);
        return names.flatMap((n): FlowCard[] => {
            const own = kept.sessions.get(n);
            const drafts = own !== undefined && own.pending > 0;
            const shown = (drafts ? draftedFlow(own, n) : undefined) ?? flows.get(n) ?? fresh.get(n);
            return shown === undefined ? [] : [{ name: n, flow: shown, pending: drafts }];
        });
        // The sessions move under their version.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [flows, fresh, kept.sessions, kept.version]);
    const onCreate = useCallback((n: string) => {
        setCreating(n);
        openFlow(n);
    }, [openFlow]);
    const newFlow = useMemo((): NewFlowProps | undefined => (apply === undefined || flows === undefined ? undefined : {
        taken: new Set(cards.map((c) => c.name)),
        onCreate,
    }), [apply, flows, cards, onCreate]);
    const flowsTab = useMemo(() => (flows === undefined ? undefined : {
        count: words.number(cards.length),
        body: <FlowsTab cards={cards} open={openName} onOpen={openFlow} newFlow={newFlow}
            id={`${keys.library}:flows`} storageKey={`${keys.library}.flows`} styles={styles} words={words} />,
    }), [flows, cards, openName, openFlow, newFlow, keys.library, styles, words]);
    // The library pane: the tabs `library` lists, each data tab a Library of its own rows' cards (#1248).
    const start = useFlowchartLibrary({ library: value.library, flows: flowsTab, keys, words });

    // The banners: the open flow's session's, then a `flow` the flowchart doesn't hold, as the Sheet names an entry its record doesn't (FB42).
    const banners = !edits && missing === undefined ? undefined : (
        <>
            {edits && <SessionBanners session={session} words={words} onAction={onAction} />}
            {missing !== undefined && (
                <Box data-flowchart-banner="missing">
                    <BannerView status="neutral" title={words.m.flowMissing({ name: missing, shown: openName })} />
                </Box>
            )}
        </>
    );

    return (
        <Box css={styles.root} data-flowchart-root="" data-density={getSomeorUndefined(canvas.density)?.type}>
            <BuilderFrame
                storageKey={keys.frame}
                toolbar={items}
                banners={banners}
                start={start}
                end={value.inspector ? INSPECTOR_PANE : undefined}
                footer={
                    <FlowchartFooter styles={styles} name={openName} links={flow.links.length}
                        narrowedFrom={total !== undefined && narrowed !== undefined && narrowed < total ? total : undefined}
                        counts={model.counts} pending={waiting} saved={saved} words={words} />
                }
                onKeyDown={onKeyDown}
            >
                {held.many && openName === undefined
                    ? <NoFlows newFlow={newFlow} styles={styles} words={words} />
                    : <FlowchartCanvasView canvas={canvas} model={model} orientation={orientation} reveal={reveal}
                        edit={canvasEdit} words={words} storageKey={storageKey} />}
            </BuilderFrame>
        </Box>
    );
}

// =============================================================================
// Side-effect — register the renderer for the Flowchart extension on module load.
// =============================================================================

implementUIComponent(Flowchart.Component, EastChakraFlowchart);
