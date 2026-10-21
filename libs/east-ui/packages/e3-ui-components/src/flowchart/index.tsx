/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraFlowchart` — the Flowchart (#1243–#1250, `Flowchart Builder
 * Spec.md` §7, §7.1, §8, §9.4–§9.9): the one flowchart, laid out in
 * `BuilderFrame` wherever it is used. There is no other flowchart: no canvas
 * without the frame, and no toolbar but its one.
 *
 * It registers itself against the `Flowchart` extension (`Flowchart.Component`)
 * as the module loads. Its payload carries where the flows come from — a
 * record of flows by name, or the host's flows or flow — and the canvas's
 * options: the flowchart reads the flows (a record's where it renders, and
 * again when it moves), opens one, and the frame places its parts in its
 * regions, over one shared state — the open flow's model, its session, the
 * orientation and what is selected:
 *
 * - **the open flow**, over many flows (FB12, `open-flow.ts`): the one the
 *   viewer opened last, kept in the UI store under the flowchart's `name`,
 *   while the flowchart holds it — in its flows, as a new flow, or as one
 *   whose drafts are on their way to Save; else `flow`; else the first by
 *   name; else none, and main says so in the shared empty state. While `flow`
 *   names a flow the flowchart doesn't hold, and the viewer has opened none in
 *   its place, a banner above main names it and the flow shown (FB42). A flow
 *   renamed (#1250) stays open under its name until its Save is acknowledged,
 *   then opens under its new one;
 * - **its session** (FB14, FB15, FB17–FB24, `session.ts`): one editing session
 *   per flow, so each flow keeps its drafts while another is open — over a
 *   record, and over the host's flows or flow given `onApply`; over neither,
 *   or read only, the flowchart edits nothing. Every gesture on the canvas,
 *   and every edit the inspector makes, is one transaction of the open flow's
 *   session (`edits.ts`); its history item ends the toolbar — ⌘Z undoing and
 *   ⇧⌘Z or ⌘Y redoing from anywhere in the frame but a field being typed into
 *   — and its banners sit under it. Save sends the open flow's drafts as one
 *   commit: the payload's `apply`, through the record's patch mutation or the
 *   host's `onApply`;
 * - **what is selected** (#1250, `selection.ts`): the frame's, per open flow
 *   — a state, a transition, a decision, a lane by its header, or several
 *   states — as the open flow holds it: the canvas marks it, the inspector
 *   shows it, a card's ⏎ drops on it (FB34), and the history item's issue
 *   selects what it names;
 * - **LR · TD** (FB43, `orientation.ts`): the viewer's, kept in the UI store
 *   under the flowchart's `name`; the payload's `orientation` until they pick;
 * - **the toolbar** — the flowchart's items (`useFlowchartToolbarItems`,
 *   `toolbar.tsx`) on the frame's one folding row, in §7.1's order: find
 *   state, LR · TD and the freshness chip, and at the row's end the rail over
 *   its `Slice.bindRecords` (#1346) and, where it edits, the history item.
 *   The canvas draws no eyebrow;
 * - **main** — the canvas (`canvas.tsx`), filling main and scrolling both
 *   ways inside it; a flow its drafts delete says so there, in the shared
 *   empty state;
 * - **the footer** — today's counts (`footer.tsx`): over many flows the open
 *   flow's name first — the one its drafts give it; where it edits, the
 *   changes waiting on Save; over a record its last save; and why a card's ⏎
 *   or an inspector's edit was refused;
 * - **the panes** — the library in the start pane when the payload's
 *   `library` lists a tab (`library.tsx`, #1248), and the inspector in the
 *   end pane (`inspector.tsx`, #1250), on by default — none for
 *   `inspector={false}`. The library's tabs are the ones `library` lists, in
 *   its order, each with its count: the Flows tab (`flows.tsx`), which lists
 *   every flow by name and starts new ones, and the state and transition
 *   templates and the author's tabs, each a `Library` of its own rows' cards.
 *   The inspector's tabs are Details — what is selected, through its form —
 *   and Issues — the open flow's (`issues.ts`), each selecting what it names.
 *   The panes' open tab and collapsed state persist under the flowchart's
 *   `name` (`flowchartKeys(name).frame`);
 * - **the narrowing** (#1346): one `Slice.bindRecords`, the payload's `slice`
 *   and each source's narrowed keys (`narrowed`). Over a record its `flows`
 *   source pages, the Flows tab lists what the rail narrows the record to,
 *   counts it (`Flows 40 of 2,048`), says so with the rail's Clear filters
 *   when the rail leaves it none, and finds a flow within it by its own
 *   search; the open flow is read by its name whatever the narrowing, keeps
 *   its drafts, and a Save that takes flows out of the narrowing says so in
 *   the footer. Each other source is followed (`FollowSources`, one component
 *   a source): the templates list or the author's tab that names it shows
 *   the cards it shows, by their keys, and a source whose narrowing could not
 *   be read says so in a banner, with Retry;
 * - **the drops** (#1249, `use-drop.ts`): the library's cards land on the
 *   canvas, the flowchart's drop target — a state template on a lane, a
 *   transition template on a transition, an author's card on what its drop's
 *   type names — each one `drop` transaction of the open flow's session, a
 *   state it adds selected; ⏎ on a card, and on a touch screen a tap on the
 *   selected card, drops it on the canvas's selection, and where that is
 *   refused the footer says why.
 *
 * The flowchart fills the box it is given and draws no border: a host gives it
 * a box of its own height.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Box, Button, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { StringType, compareFor, equalFor, equivalentFor, none, type ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType, RecordSlicesChromeType } from "@elaraai/east-ui/internal";
import { Flowchart, flowchartKeys } from "@elaraai/e3-ui/internal";
import {
    BannerView,
    BuilderFrame,
    EmptyStateView,
    SessionBanners,
    getSomeorUndefined,
    historyShortcut,
    historyToolbarItem,
    implementUIComponent,
    typedInto,
    useDataStable,
    useFormatters,
    useTrackedEvaluation,
    type EditIssue,
    type HistoryAction,
} from "@elaraai/east-ui-components";
import { awaitTracked, narrowedCount } from "@elaraai/east-ui-components/internal";
import { FollowSources, type FollowedSources } from "../shared/schedule/follow-sources.js";
import { sourcePart, type KeyVisibilityWords } from "../shared/schedule/visibility.js";
import { buildModel, type FlowchartCanvasValue, type FlowchartFlowValue, type FlowchartValue } from "./model.js";
import { FlowchartCanvasView, type FlowchartCanvasEdit, type FlowchartReveal } from "./canvas.js";
import * as flowEdits from "./edits.js";
import { useFindState } from "./find.js";
import { FlowchartFooter, useLastSave } from "./footer.js";
import { FlowsCountReader, FlowsTab, PagedFlowsTab, NoFlows, type FlowCard, type FlowsCount, type NewFlowProps } from "./flows.js";
import { inspectorPane, type FlowchartInspectorEdit } from "./inspector.js";
import { flowIssues, issueTarget, saveIssues } from "./issues.js";
import { useFlowchartLibrary } from "./library.js";
import { flowchartMessages, type FlowchartRefusedWord, type FlowchartWords } from "./messages.js";
import { missingFlow, openFlowName, useOpenedFlow } from "./open-flow.js";
import { useViewerOrientation } from "./orientation.js";
import { selectionHeld, type FlowchartSelection } from "./selection.js";
import {
    ONE_FLOW, draftedEntry, newFlows, recordFlowDelete, recordFlowEdit, recordFlowRename, recordNewFlow, useFlowSession, useKeptSessions,
    type FlowApply, type FlowRow,
} from "./session.js";
import { followedSources, sourceNouns } from "./sources.js";
import { readFlowWindow, type FlowchartPagedRecord } from "./window.js";
import { useFlowchartToolbarItems } from "./toolbar.js";
import { useFlowchartDrop } from "./use-drop.js";

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

/** The flows by name, decoded. */
type FlowsValue = ValueTypeOf<typeof Flowchart.Types.Flows>;

/** The flows a payload's source holds: many by name, or one. */
type FlowsHeld =
    | { readonly many: true; readonly flows: FlowsValue; readonly loading?: boolean; readonly pendingName?: string | undefined }
    | { readonly many: false; readonly flow: FlowchartFlowValue };

/** The rail, decoded: one over the flowchart's `Slice.bindRecords` (#1346). */
type FlowchartChrome = ValueTypeOf<typeof RecordSlicesChromeType>;

/** A source's part of the rail, decoded. */
type FlowchartPart = ValueTypeOf<typeof RecordSliceBindType>;

/** A flow with nothing in it: the canvas while a flow is not yet there to draw. */
const NO_FLOW: FlowchartFlowValue = { description: none, lanes: [], states: [], links: [], triggers: [] };

/** A flow being started — by "+ New flow", or duplicated (#1250) — opened at once, recorded once its session has read its base. */
interface NewFlowDraft {
    /** Its name. */
    readonly name: string;
    /** What it starts as: one lane, or the flow it copies. */
    readonly flow: FlowchartFlowValue;
    /** Its transaction's name in the history. */
    readonly label: string;
}

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
        case "record":
        case "paged": return source.value.apply;
        case "data": return getSomeorUndefined(source.value.value.apply);
    }
}

/**
 * The flows a source holds: a record's flows by name, read — a reactive read,
 * which the flowchart's tracked evaluation follows — or, paged through the
 * slice's `flows` source, its first flow and the open one; or the host's
 * flows or flow, as they came.
 *
 * @param source - The payload's source
 * @param selected - The open flow's name, if one is open
 * @param flows - The slice's `flows` source's part, over a paged record
 * @returns The flows by name, or the one flow
 */
function flowsHeld(source: FlowchartValue["source"], selected: string | undefined, flows: FlowchartPart | undefined): FlowsHeld {
    switch (source.type) {
        case "record": return { many: true, flows: source.value.read() };
        case "paged": return readFlowWindow(source.value, selected, flows);
        case "data": return source.value.type === "flows"
            ? { many: true, flows: source.value.value.value }
            : { many: false, flow: source.value.value.value };
    }
}

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
    const [opened] = useOpenedFlow(flowchartKeys(getSomeorUndefined(value.name)).flow);
    const selected = opened ?? getSomeorUndefined(value.open);
    // The rail (#1346), and its `flows` source's part: what pages the Flows tab over a record.
    const chrome = getSomeorUndefined(value.slice);
    const flowsPart = useMemo(() => sourcePart(chrome, "flows"), [chrome]);
    // The flows, read where the flowchart renders, and again when they move.
    const read = useCallback(() => flowsHeld(source, selected, flowsPart), [source, selected, flowsPart]);
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
    return <FlowchartFollows value={value} held={result.value} storageKey={storageKey} chrome={chrome} flowsPart={flowsPart} />;
}, (prev, next) => payloadEqual(prev.value, next.value) && prev.storageKey === next.storageKey);

/** Props of {@link FlowchartFrame}. */
interface FlowchartFrameProps {
    /** The payload, decoded. */
    readonly value: FlowchartValue;
    /** The flows its source holds. */
    readonly held: FlowsHeld;
    /** The structural storage key. */
    readonly storageKey: string;
    /** The rail (#1346); `undefined` with no slice. */
    readonly chrome: FlowchartChrome | undefined;
    /** The slice's `flows` source's part; `undefined` with no `flows` source. */
    readonly flowsPart: FlowchartPart | undefined;
}

/**
 * The frame, once each source its library follows is read (#1346): what each
 * templates list and each author's tab shows of the source it names, and the
 * banners of the ones that could not be read — one component a source, so a
 * payload naming another set of sources keeps each one's hooks in order.
 */
function FlowchartFollows(props: FlowchartFrameProps) {
    const { value } = props;
    const { locale } = useFormatters();
    const sources = useMemo(() => followedSources(value), [value]);
    const nouns = useMemo(() => sourceNouns(value, flowchartMessages, locale), [value, locale]);
    // What a source's failed narrowing says, in the flowchart's words.
    const said = useCallback((name: string): KeyVisibilityWords => ({ changed: flowchartMessages.sourceChanged({ name }), failed: flowchartMessages.sourceFailed({ name }) }), []);
    return (
        <FollowSources chrome={props.chrome} narrowed={value.narrowed} sources={sources} nouns={nouns} said={said}>
            {(followed) => <FlowchartFrame {...props} followed={followed} nouns={nouns} />}
        </FollowSources>
    );
}

/** The frame, its regions holding the flowchart's parts over one shared state. */
function FlowchartFrame({ value, held, storageKey, chrome, flowsPart, followed, nouns }: FlowchartFrameProps & {
    /** What each source the library follows shows. */
    readonly followed: FollowedSources;
    /** What the rail counts each source in, by its name. */
    readonly nouns: ReadonlyMap<string, string>;
}) {
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
    const paged: FlowchartPagedRecord | undefined = value.source.type === "paged" ? value.source.value : undefined;
    // The session's Save, while the flowchart edits: a record's, or the host's onApply over `data`.
    const apply = value.readOnly ? undefined : saveOf(value.source);
    const [opened, openStored] = useOpenedFlow(keys.flow);
    // A flow being started — "+ New flow", or a flow duplicated: open at once, recorded once its session has read its base.
    const [creating, setCreating] = useState<NewFlowDraft | undefined>(undefined);
    const kept = useKeptSessions(storageKey, keys.flow);
    // The new flows the sessions hold, not yet saved, as their drafts stand: by their sessions' names.
    const fresh = useMemo(() => (flows === undefined ? new Map<string, FlowRow>() : newFlows(kept.sessions, (n) => flows.has(n))),
        // The sessions move under their version.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [flows, kept.sessions, kept.version]);
    // Whether a flow's session holds drafts it has not seen through (#1250) — a delete's on its way to Save among them: only the open
    // flow's session reads its Save back, so the flow stays open until the record reads back as the Save left it.
    const drafting = useCallback((n: string): boolean => (kept.sessions.get(n)?.pending ?? 0) > 0,
        // The sessions move under their version.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [kept.sessions, kept.version]);
    // Whether the flowchart holds a flow of a name: in its flows, as a new flow — one its drafts rename among them — committed or
    // not, or as one whose drafts are on their way to Save.
    const holds = useCallback((n: string) => flows !== undefined
        && (flows.has(n) || (held.many && held.pendingName === n) || fresh.has(n) || (creating !== undefined && nameEqual(creating.name, n)) || drafting(n)), [flows, fresh, creating, drafting, held]);
    // A rename sent with Save (#1250): the flow it renames — the one open then, whether the viewer or `flow` opened it — and its new
    // name, followed once the session that sent it has seen the commit through, none of its drafts left. A Save refused or in
    // conflict drops it, and a Save sent again marks it again; a write with no answer keeps it, its drafts locked, for its Retry.
    const [renaming, setRenaming] = useState<{ readonly from: string; readonly to: string } | undefined>(undefined);
    const renamingSession = renaming === undefined ? undefined : kept.sessions.get(renaming.from);
    const renamed = renaming !== undefined && renamingSession !== undefined && renamingSession.pending === 0 ? renaming.to : undefined;
    const openedNow = renamed ?? opened;
    useLayoutEffect(() => {
        if (renamed === undefined) return;
        openStored(renamed);
        setRenaming(undefined);
    }, [renamed, openStored]);
    const renamingStatus = renamingSession?.status;
    useEffect(() => {
        if (renamingStatus === "conflict" || renamingStatus === "rejected") setRenaming(undefined);
    }, [renamingStatus]);
    const asked = getSomeorUndefined(value.open);
    const openName = useMemo(() => (flows === undefined ? undefined
        : openFlowName([...flows.keys(), ...fresh.keys()], holds, openedNow, asked)), [flows, fresh, holds, openedNow, asked]);
    // Keep the initial choice by primary ID: filtering the list must not
    // detach the open flow's session while a Save awaits confirmation.
    useEffect(() => {
        if (paged !== undefined && openName !== undefined && opened !== openName
            && !(held.many && held.loading) && (asked === undefined || holds(asked) || opened !== undefined)) openStored(openName);
    }, [paged, openName, opened, held, asked, holds, openStored]);
    // `flow` names a flow the flowchart doesn't hold, and the viewer opened none in its place: the banner's (FB42).
    const missing = missingFlow(holds, openedNow, asked);
    const heldFlow = flows !== undefined && openName !== undefined ? flows.get(openName) : undefined;

    // ── The open flow's session (FB14, FB15) ────────────────────────────
    // Its entry: the open flow's name over many flows; over the host's one flow, that flow (#1247).
    const entry = held.many ? openName : ONE_FLOW;
    const entryHeld = held.many ? heldFlow : held.flow;
    // A flow as the source holds it, by name: the open flow's, and a rename's new name's (#1250).
    const heldOf = useCallback((n: string): FlowchartFlowValue | undefined => (held.many ? held.flows.get(n) : nameEqual(n, ONE_FLOW) ? held.flow : undefined), [held]);
    const flowSession = useFlowSession({ key: keys.flow, name: entry, heldOf, apply, storageKey, sessions: kept.sessions, words, paged, recordSlice: flowsPart });
    const { session, original, available } = flowSession;
    useEffect(() => {
        if (creating === undefined || openName === undefined || !nameEqual(openName, creating.name) || !available || (held.many && held.loading)) return;
        // A name another write took meanwhile is the record's: it opens as the record holds it.
        if (heldFlow === undefined) recordNewFlow(session, creating.name, creating.flow, creating.label);
        setCreating(undefined);
    }, [creating, openName, heldFlow, available, session, held]);
    // The open flow as its drafts stand, under the name they give it; with none, as its source holds it.
    const pending = session.pending > 0;
    const drafted = flowSession.drafted;
    const shown: FlowRow | undefined = pending
        ? (drafted ?? undefined)
        : entry !== undefined && entryHeld !== undefined ? { name: entry, flow: entryHeld } : (drafted ?? undefined);
    // Its drafts delete it (#1250): main and the inspector say so.
    const deleted = pending && drafted === null;
    const flow = shown?.flow ?? NO_FLOW;
    // Whether a flow is there to edit: one its source or its drafts hold — never a new flow before its session holds it, nor one its drafts delete.
    const hasFlow = shown !== undefined;
    // The name the footer and the inspector give the open flow: the one its drafts give it, over many flows.
    const shownName = held.many ? (shown?.name ?? openName) : undefined;
    // It edits while it has Save and a flow open: its history item, its banners and its keys.
    const edits = apply !== undefined && entry !== undefined;
    // The changes waiting on Save, the footer's (FB10): counted when the drafts move, never on a render that moves nothing — a rename one more.
    const waiting = useMemo(() => {
        if (!edits) return undefined;
        if (!pending) return 0;
        const rename = entryHeld !== undefined && entry !== undefined && drafted !== null && drafted !== undefined && !nameEqual(drafted.name, entry) ? 1 : 0;
        return flowEdits.pendingChanges(entryHeld, drafted?.flow) + rename;
    }, [edits, pending, entryHeld, entry, drafted]);

    // The open flow as its session holds it now — never a render's copy — and the name its drafts give it.
    const currentEntry = useCallback((): FlowRow | undefined => {
        if (entry === undefined) return undefined;
        const now = draftedEntry(session, entry);
        // A delete drafted: no flow to edit.
        if (now === null) return undefined;
        return now ?? (entryHeld === undefined ? undefined : { name: entry, flow: entryHeld });
    }, [entry, session, entryHeld]);
    // One edit, one transaction of the open flow's session, under the name its drafts give it.
    const recordEdit = useCallback((next: FlowchartFlowValue, edit: flowEdits.FlowchartEdit, label?: string): boolean => {
        const at = currentEntry();
        return edits && at !== undefined && recordFlowEdit({ session, original }, at.name, next, flowEdits.EDIT_ORIGIN[edit], label ?? words.m.editLabel({ edit }));
    }, [edits, currentEntry, session, original, words]);

    // ── What is selected (#1250): the frame's, per open flow ────────────────
    const [selected, setSelectedState] = useState<{ readonly flow: string | undefined; readonly selection: FlowchartSelection | null }>({ flow: undefined, selection: null });
    const openNameRef = useRef(openName);
    openNameRef.current = openName;
    const setSelected = useCallback((selection: FlowchartSelection | null) => { setSelectedState({ flow: openNameRef.current, selection }); }, []);
    // Each flow its own selection: another flow opened selects nothing.
    const sameFlow = selected.flow === undefined || openName === undefined ? selected.flow === openName : nameEqual(selected.flow, openName);
    // As the open flow holds it: what an Undo or a gesture took away is not selected.
    const selection = useMemo(() => selectionHeld(sameFlow ? selected.selection : null, flow), [sameFlow, selected.selection, flow]);
    const selectionRef = useRef(selection);
    selectionRef.current = selection;
    // What the frame asks the canvas to select and bring into view: a state find state picked, a drop added, a click in the inspector.
    const [reveal, setReveal] = useState<FlowchartReveal | null>(null);
    const revealSelection = useCallback((next: FlowchartSelection | null, scroll = true) => {
        setSelected(next);
        if (next !== null) setReveal((was) => ({ selection: next, seq: (was?.seq ?? 0) + 1, scroll }));
    }, [setSelected]);

    // ── The gestures (FB17–FB20): each one transaction of the open flow's session ──
    // They show wherever the flowchart edits, and record nothing while the
    // session takes no gesture — a Save in flight, drafts out of date — as
    // the history item's buttons are off then.
    const canvasEdit = useMemo((): FlowchartCanvasEdit | undefined => {
        if (!edits || entry === undefined || !hasFlow) return undefined;
        // Each gesture reads the flow as the session holds it now — never a render's copy — and records the flow it leaves.
        const now = (): FlowchartFlowValue => currentEntry()?.flow ?? NO_FLOW;
        const record = (next: FlowchartFlowValue | undefined, edit: flowEdits.FlowchartEdit): void => {
            if (next !== undefined) recordEdit(next, edit);
        };
        return {
            addLane: () => record(flowEdits.addLane(now(), laneLabel(words)).flow, "addLane"),
            renameLane: (key, label) => record(flowEdits.renameLane(now(), key, label), "renameLane"),
            deleteLane: (key) => record(flowEdits.deleteLane(now(), key), "deleteLane"),
            addState: (lane, key, label) => record(flowEdits.addState(now(), lane, key, label), "addState"),
            editState: (key, next, label) => record(flowEdits.editState(now(), key, next, label), "editState"),
            moveState: (key, lane) => record(flowEdits.moveState(now(), key, lane), "moveState"),
            deleteState: (key) => record(flowEdits.deleteState(now(), key), "deleteState"),
            deleteStates: (stateKeys) => record(flowEdits.deleteStates(now(), stateKeys), "deleteStates"),
            connect: (from, to) => record(flowEdits.connect(now(), from, to).flow, "connect"),
            deleteLink: (key) => record(flowEdits.deleteLink(now(), key), "deleteLink"),
            deleteDecision: (key) => record(flowEdits.deleteDecision(now(), key), "deleteDecision"),
        };
    }, [edits, entry, hasFlow, currentEntry, recordEdit, words]);

    // The open flow's model, the canvas's and the footer's — keyed on the
    // flow's DATA (#809): a closure-only change keeps it.
    const data = useDataStable(flow, flowEqual);
    const model = useMemo(() => buildModel(data, words), [data, words]);
    // LR · TD (FB43): the viewer's, kept under the flowchart's name; the canvas's `orientation` until they pick.
    const [orientation, setOrientation] = useViewerOrientation(keys.orientation, getSomeorUndefined(canvas.orientation)?.type ?? "LR");
    // Find state over the open flow's states: a pick reveals the state on the canvas.
    const onPick = useCallback((key: string) => { revealSelection({ kind: "state", key }); }, [revealSelection]);

    // ── The drops (#1249, FB30–FB34): the library's cards, onto the canvas ──
    // The open flow as its session holds it now — never a render's copy: what a drop plans over.
    const currentFlow = useCallback((): FlowchartFlowValue | undefined => currentEntry()?.flow, [currentEntry]);
    // A drop's flow, one `drop` transaction of the open flow's session.
    const recordDrop = useCallback((next: FlowchartFlowValue, label: string): boolean => {
        const at = currentEntry();
        return edits && at !== undefined && recordFlowEdit({ session, original }, at.name, next, "drop", label);
    }, [edits, currentEntry, session, original]);
    // The state a drop added, selected (FB31) — scrolled into view for a card's ⏎.
    const selectState = useCallback((key: string, scroll: boolean) => { revealSelection({ kind: "state", key }, scroll); }, [revealSelection]);
    // Why a card's ⏎ or an inspector's edit was refused, the footer's line (FB34, #1250): until a drop lands, or another flow opens.
    const [notice, setNotice] = useState<string | undefined>(undefined);
    useEffect(() => { setNotice(undefined); }, [openName]);
    const drop = useFlowchartDrop({
        library: value.library, keys, now: currentFlow, edits, available, record: recordDrop,
        selection: () => selectionRef.current, select: selectState, notice: setNotice, words,
    });
    const findable = useMemo(() => data.states.map((s) => ({ key: s.key, label: getSomeorUndefined(s.label) })), [data]);
    const find = useFindState(findable, openName ?? "", onPick);
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
            case "apply": {
                // A rename sent with this Save is followed once its session has seen it through (#1250).
                const at = currentEntry();
                if (entry !== undefined && at !== undefined && !nameEqual(at.name, entry)) setRenaming({ from: entry, to: at.name });
                void session.apply();
                return;
            }
        }
    }, [session, currentEntry, entry]);
    // An issue on the open flow selects what it names (#1250); another flow's opens it; one of the record's as a whole — or the host's one flow's — names none.
    const onIssue = useCallback((issue: EditIssue) => {
        const at = currentEntry();
        const ours = (at !== undefined && nameEqual(issue.entry, at.name)) || (entry !== undefined && nameEqual(issue.entry, entry));
        if (ours) {
            revealSelection(at === undefined ? null : issueTarget(issue, at.flow));
            return;
        }
        if (held.many && !nameEqual(issue.entry, "")) openStored(issue.entry);
    }, [currentEntry, entry, held.many, openStored, revealSelection]);
    const history = edits ? historyToolbarItem({ session, words, editing: false, onIssue, onAction, showError: false }) : undefined;
    // The history keys from anywhere in the frame (FB21): never a field being typed into, which keeps its own undo.
    const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if (!edits || event.defaultPrevented || typedInto(event.target)) return;
        const action = historyShortcut(event);
        if (action === undefined) return;
        event.preventDefault();
        onAction(action);
    }, [edits, onAction]);
    // The rail (#1346): each source counted in its noun on the rail's summary.
    const railNouns = useMemo(() => Object.fromEntries(nouns), [nouns]);
    const items = useFlowchartToolbarItems({ styles, find, orientation, onOrientation: setOrientation, freshness, words, history, chrome, nouns: railNouns });
    const saved = useLastSave(value.source, words);

    // ── The Flows tab (FB13, FB14) ──────────────────────────────────────
    const cards = useMemo((): FlowCard[] => {
        if (flows === undefined) return [];
        const names = [...new Set([...flows.keys(), ...fresh.keys()])].sort(nameOrder);
        return names.flatMap((n): FlowCard[] => {
            const own = kept.sessions.get(n);
            const drafts = own !== undefined && own.pending > 0;
            const draft = drafts ? draftedEntry(own, n) : undefined;
            const shownFlow = draft?.flow ?? flows.get(n) ?? fresh.get(n)?.flow;
            return shownFlow === undefined ? [] : [{ name: n, label: draft?.name ?? n, flow: shownFlow, pending: drafts }];
        });
        // The sessions move under their version.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [flows, fresh, kept.sessions, kept.version]);
    // Every name the flowchart holds, or a draft gives a flow: what a new flow, a rename and a copy may not take.
    const taken = useMemo(() => new Set([
        ...cards.map((c) => c.name), ...cards.map((c) => c.label),
        ...kept.sessions.all().flatMap(([, own]) => [...own.entries].filter(([, row]) => row.draft !== undefined).map(([id]) => id)),
        ...(creating === undefined ? [] : [creating.name]),
    ]), [cards, creating, kept.sessions]);
    const onCreate = useCallback(async (n: string): Promise<string | undefined> => {
        if (paged !== undefined && (await awaitTracked(() => paged.entry(n))).type === "some") return words.m.flowNameTaken({ name: n });
        setCreating({ name: n, flow: emptyFlow(words), label: words.m.newFlow() });
        openStored(n);
        return undefined;
    }, [openStored, words, paged]);
    const newFlow = useMemo((): NewFlowProps | undefined => (apply === undefined || flows === undefined ? undefined : { taken, onCreate }), [apply, flows, taken, onCreate]);
    // The paged Flows tab's count (#1346): what the rail narrows the record to — `40 of 2,048` — read where it renders nothing.
    const [flowsCount, setFlowsCount] = useState<FlowsCount | undefined>(undefined);
    const flowsTab = useMemo(() => {
        if (flows === undefined) return undefined;
        if (paged === undefined) {
            return {
                count: cards.length, shown: cards.length,
                body: <FlowsTab cards={cards} open={openName} onOpen={openStored} newFlow={newFlow}
                    id={`${keys.library}:flows`} storageKey={`${keys.library}.flows`} styles={styles} words={words} />,
            };
        }
        // A new flow not yet saved shows above the list, whatever the narrowing: it counts among what the tab shows.
        const unsaved = cards.filter(c => fresh.has(c.name));
        return {
            count: flowsCount === undefined ? undefined
                : narrowedCount(words, flowsCount.shown + unsaved.length, flowsCount.total + unsaved.length, flowsCount.narrowing),
            shown: (flowsCount?.shown ?? 0) + unsaved.length,
            body: <PagedFlowsTab source={paged} part={flowsPart} sessions={kept.sessions} fresh={unsaved}
                open={openName} onOpen={openStored} newFlow={newFlow} id={`${keys.library}:flows`}
                storageKey={`${keys.library}.flows`} styles={styles} words={words} />,
        };
    }, [flows, cards, openName, openStored, newFlow, keys.library, styles, words, paged, flowsPart, flowsCount, fresh, kept.sessions]);
    // The library pane: the tabs `library` lists, each data tab a Library of its own rows' cards (#1248) the source it
    // names shows (#1346), each card that drops taking its ⏎ (#1249).
    const start = useFlowchartLibrary({ library: value.library, flows: flowsTab, keys, words, enter: drop.enter, followed });

    // ── The inspector (#1250, FB35–FB38) ────────────────────────────────
    const refuse = useCallback((why: FlowchartRefusedWord) => { setNotice(words.m.inspectorRefused(why)); }, [words]);
    const inspectorEdit = useMemo((): FlowchartInspectorEdit | undefined => {
        if (!edits || entry === undefined || !hasFlow) return undefined;
        return {
            now: () => currentEntry()?.flow,
            record: (next, edit) => recordEdit(next, edit),
            rename: (to) => {
                const at = currentEntry();
                if (at === undefined || !held.many) return false;
                const name = to.trim();
                if (nameEqual(name, "")) { refuse({ why: "emptyName" }); return false; }
                if (nameEqual(name, at.name)) return false;
                // A name the flowchart holds, but the open flow's own under the source.
                if (taken.has(name) && !nameEqual(name, entry)) { refuse({ why: "nameTaken", name }); return false; }
                const commit = () => {
                    const current = currentEntry();
                    if (openNameRef.current !== entry || current?.name !== at.name) return false;
                    return recordFlowRename({ session, original }, at.name, name, current.flow, words.m.editLabel({ edit: "renameFlow" }));
                };
                if (paged === undefined || nameEqual(name, entry)) return commit();
                return awaitTracked(() => paged.entry(name)).then(found => {
                    if (found.type === "some") { refuse({ why: "nameTaken", name }); return false; }
                    return commit();
                }, error => { setNotice(error instanceof Error ? error.message : "Could not check the flow name"); return false; });
            },
            duplicate: () => {
                const at = currentEntry();
                if (at === undefined || !held.many) return;
                const create = async () => {
                    let n = 1;
                    let name = words.m.flowCopy({ name: at.name, n });
                    while (taken.has(name) || (paged !== undefined && (await awaitTracked(() => paged.entry(name))).type === "some")) {
                        name = words.m.flowCopy({ name: at.name, n: ++n });
                    }
                    if (openNameRef.current !== entry) return;
                    setCreating({ name, flow: at.flow, label: words.m.editLabel({ edit: "duplicateFlow" }) });
                    openStored(name);
                };
                void create().catch(error => setNotice(error instanceof Error ? error.message : "Could not duplicate the flow"));
            },
            remove: () => {
                const at = currentEntry();
                if (at === undefined || !held.many) return;
                if (recordFlowDelete({ session, original }, at.name, words.m.editLabel({ edit: "deleteFlow" }))) setSelected(null);
            },
            refuse,
        };
    }, [edits, entry, hasFlow, currentEntry, recordEdit, held.many, refuse, taken, session, original, words, openStored, setSelected, paged]);
    // The open flow's issues, and its Save's conflict or refusal while it stands (FB37).
    const status = session.status;
    const sessionIssues = session.issues;
    const issues = useMemo(() => [
        ...(edits && (status === "conflict" || status === "rejected") ? saveIssues(sessionIssues, flow) : []),
        ...flowIssues(flow),
    ], [edits, status, sessionIssues, flow]);
    const paneValue = getSomeorUndefined(value.inspector);
    const end = paneValue === undefined ? undefined : inspectorPane({
        pane: paneValue, flow: shown?.flow, held: entryHeld, model, name: shownName, heldName: entryHeld === undefined ? undefined : openName,
        deleted, selection, reveal: revealSelection, issues, edit: inspectorEdit, available: edits && available,
        record: value.source.type !== "data", saved, keys, words,
    });

    // The banners: the open flow's session's; each source the library follows whose narrowing could not be read, with Retry
    // (#1346); then a `flow` the flowchart doesn't hold, as the Sheet names an entry its record doesn't (FB42).
    const failed = [...followed.values()].filter((source) => source.error !== undefined);
    const banners = !edits && missing === undefined && failed.length === 0 ? undefined : (
        <>
            {edits && <SessionBanners session={session} words={words} onAction={onAction} />}
            {failed.map((source) => (
                <Box key={source.name} data-flowchart-banner="source">
                    <BannerView status="error" title={words.m.sourceUnavailable({ name: source.name })} description={source.error}
                        actions={<Button size="xs" variant="outline" onClick={source.retry}>{words.m.retry()}</Button>} />
                </Box>
            ))}
            {missing !== undefined && (
                <Box data-flowchart-banner="missing">
                    <BannerView status="neutral" title={words.m.flowMissing({ name: missing, shown: openName })} />
                </Box>
            )}
        </>
    );

    // Main: the open flow's canvas — or, over many flows with none open, the
    // shared empty state; a flow its drafts delete, saying so (#1250).
    const main = held.many && openName === undefined
        ? <NoFlows newFlow={newFlow} styles={styles} words={words} />
        : deleted
            ? (
                <Box css={styles.noFlows} data-flowchart-deleted="">
                    <EmptyStateView icon={{ prefix: "fas", name: "trash-can" }}
                        title={words.m.flowDeleted({ part: "title", name: shownName ?? openName ?? "" })}
                        description={words.m.flowDeleted({ part: "hint", name: shownName ?? openName ?? "" })} />
                </Box>
            )
            : <FlowchartCanvasView canvas={canvas} model={model} orientation={orientation} reveal={reveal}
                edit={canvasEdit} drop={drop.canvas} selection={selection} onSelect={setSelected} words={words} storageKey={storageKey} />;

    return (
        <Box css={styles.root} data-flowchart-root="">
            {paged !== undefined && flowsPart !== undefined && <FlowsCountReader part={flowsPart} onCount={setFlowsCount} />}
            {paged !== undefined && kept.sessions.all().filter(([name, own]) => name !== entry && own.pending > 0).map(([name]) => (
                <PendingFlowSession key={name} name={name} flowKey={keys.flow} paged={paged} apply={apply}
                    storageKey={storageKey} sessions={kept.sessions} words={words} recordSlice={flowsPart} />
            ))}
            <BuilderFrame
                storageKey={keys.frame}
                loading={held.many && held.loading === true}
                toolbar={items}
                banners={banners}
                start={start}
                end={end}
                footer={
                    <FlowchartFooter styles={styles} name={shownName} links={flow.links.length} recordSlice={paged === undefined ? undefined : flowsPart}
                        counts={model.counts} pending={waiting} saved={saved?.when} message={notice} words={words} />
                }
                onKeyDown={onKeyDown}
            >
                {main}
            </BuilderFrame>
        </Box>
    );
}

/** Keep offscreen drafts and in-flight Save confirmations attached to the shared session. */
function PendingFlowSession({ name, flowKey, ...options }: Omit<Parameters<typeof useFlowSession>[0], "key" | "heldOf"> & { flowKey: string }) {
    useFlowSession({ ...options, name, key: flowKey, heldOf: noHeldFlow });
    return null;
}
const noHeldFlow = () => undefined;

// =============================================================================
// Side-effect — register the renderer for the Flowchart extension on module load.
// =============================================================================

implementUIComponent(Flowchart.Component, EastChakraFlowchart);
