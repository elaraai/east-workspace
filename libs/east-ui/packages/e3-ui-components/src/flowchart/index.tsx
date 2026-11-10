/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraFlowchart` — the Flowchart (#1500–#1505, `Flowchart Records
 * Spec.md`): one flowchart over the app's records, laid out in `BuilderFrame`
 * wherever it is used. There is no other flowchart: no canvas without the
 * frame, and no toolbar but its one.
 *
 * It registers itself against the `Flowchart` extension (`Flowchart.Component`)
 * as the module loads. Its payload carries four records of the app's — its
 * states and transitions, each read through its source of the rail, and its
 * lanes and decisions, small records read whole — and the canvas's options.
 * Every word it says is its message table's, made from its nouns — each
 * kind's own `name`, and the app's words for a transition's kinds (#1516). The
 * frame places its parts in its regions, over one shared state — the rows
 * read with the drafts in place, the model drawn from them, the editing, the
 * orientation and what is selected:
 *
 * - **the reads** (`read.ts`): every kind read page by page until done, the
 *   states and transitions through their sources of the rail; as the rail
 *   moves, a kind is read again and what the canvas drew stands in, retained —
 *   readable and selectable, no record taking an edit until the new rows land;
 *   and a read that fails is said once on the canvas, in a box at its top-left
 *   with Retry, as the footer's loading line says it (R5). Under `narrowed:
 *   "dim"` every row is read and what the rail leaves out is drawn dimmed, its
 *   keys the source's shown keys (`FollowSources`);
 * - **the details** (`details.ts`): a state's and a transition's details read
 *   as their kind is — whole, or by the keys of the rows drawn, every key in
 *   one request — in a reader of their own, counted into the flowchart's bins;
 *   what no bin holds, and the bins the app binds refused, listed in Issues;
 * - **the editing** (`editing.ts`): one history over a session per record that
 *   writes; every gesture on the canvas, every drop and every edit the
 *   inspector makes is one step of it (`edits.ts`). Its history item ends the
 *   toolbar — ⌘Z undoing and ⇧⌘Z or ⌘Y redoing from anywhere in the frame but
 *   a field being typed into, each key going no further than the Flowchart
 *   (`takeKey`) — and each session's banners sit under it;
 * - **the toolbar** (`toolbar.tsx`): Find — ⌘F or Ctrl+F from anywhere in the
 *   frame — which finds a state the rail hides too, and picks it by clearing
 *   just the choices hiding it (the shared hidden pick, `HideSources`), LR · TD,
 *   the zoom — Zoom out, Zoom in and Fit, through the canvas's handle, the
 *   canvas telling it where the zoom stands (R42) — and the freshness chip, and
 *   at the row's end the rail;
 * - **the library** (`library.tsx`), the start pane: the Steps, Transitions
 *   and Lanes tabs and the author's own, their cards dropped onto the canvas
 *   (`use-drop.ts`);
 * - **the inspector** (`inspector.tsx`), the end pane: what is selected, and
 *   the flowchart's issues — each one selecting what it names, an unsaved
 *   change the rail hides by the same hidden pick. The toolbar's issue gone to
 *   asks its row's Details for the field it names, which takes the keyboard
 *   there, the inspector opened where it is collapsed (#1585);
 * - **the footer** (`footer.tsx`): the counts, the changes waiting on Save,
 *   the last save, each Save's notice, a refused gesture's words, and the
 *   loading line — `Loading states…`, `Updating states…`, or a failed read
 *   with Retry — shown on the frame's one reveal clock (`LoadingReveal`).
 *
 * Below 480px of main, measured by the canvas's element, nothing drags (R17):
 * the library's cards are not dragged — a card's ⏎ drops it — and the canvas
 * neither moves a state nor connects one, by touch or by mouse; the inspector
 * carries a state's lane and a transition's ends.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Box, Button, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { ArrayType, StringType, equalFor, equivalentFor, none, type PatchPath } from "@elaraai/east";
import { EditingBatchReadinessType } from "@elaraai/east-ui/internal";
import { Flowchart, flowchartKeys } from "@elaraai/e3-ui/internal";
import {
    BannerView, BuilderFrame, SessionBanners, fieldBreachText, fieldBreaches, fieldFormMessages, focusKeySearch, getSomeorUndefined, historyShortcut,
    historyToolbarItem, implementUIComponent, takeKey, typedInto, useContainerBelow, useDataStable, useFormatters,
    type EditIssue, type FieldBreach, type HistoryAction, type Origin,
} from "@elaraai/east-ui-components";
import { LoadingReveal, loadingLineText, type LoadingLineValue } from "@elaraai/east-ui-components/internal";
import { isBounded } from "../shared/bounds.js";
import { pagedLoadingLine } from "../shared/loading.js";
import { FieldAskProvider, useFieldAsks } from "../shared/schedule/field-ask.js";
import { FollowSources, type FollowedSources } from "../shared/schedule/follow-sources.js";
import type { SourceHiding } from "../shared/schedule/hidden.js";
import { HideSources, useHiddenPick, type HiddenPicks, type HiddenSource } from "../shared/schedule/hidden-pick.js";
import { draftedRow, rowCodec } from "../shared/schedule/records.js";
import { sourcePart, type KeyVisibilityWords } from "../shared/schedule/visibility.js";
import { NARROW_WIDTH } from "../shared/schedule/window.js";
import { kindPlural } from "../shared/schedule/words.js";
import type { ZoomRange } from "../shared/schedule/zoom.js";
import { FlowchartCanvasView, type FlowchartCanvasEdit, type FlowchartCanvasFailure, type FlowchartCanvasHandle, type FlowchartReveal } from "./canvas.js";
import { FlowchartDetailsReader, NO_DETAILS, askDetailsAgain, detailsKindsOf, flowchartDetailsModel, useDrawnKeys, type FlowchartDetailsData } from "./details.js";
import { draftedRows, type FlowchartDimmed } from "./drafted.js";
import type { FlowchartDropContext } from "./drop.js";
import { kindOf, useFlowchartEditing, type FlowchartKeyCheckWords } from "./editing.js";
import {
    EDIT_ORIGIN, addLane, addState, connect, deleteDecision, deleteLane, deleteLink, deleteStates, followBuiltKeys, moveStates, renameLane, renameState,
    type FlowchartGesture, type FlowchartHolding, type FlowchartRefusal, type GestureEdits,
} from "./edits.js";
import { useFlowchartFind, type FindableState, type FoundState } from "./find.js";
import { FlowchartFooter, useLastSaves, type FlowchartNotice } from "./footer.js";
import { flowchartInspectorPane } from "./inspector.js";
import {
    conflictValueName, flowchartIssues, selectionOf, sessionIssues, type FlowchartBreach, type FlowchartBreachWords, type FlowchartIssueArgs, type FlowchartKeyFields,
} from "./issues.js";
import { useFlowchartLibrary } from "./library.js";
import { DEFAULT_FLOWCHART_NOUNS, flowchartMessagesOf, type FlowchartNouns, type FlowchartRefusalWord, type FlowchartWords } from "./messages.js";
import { buildModel, flowchartKindKeys, type FlowchartValue } from "./model.js";
import { useViewerOrientation } from "./orientation.js";
import { FLOWCHART_SORTS, FlowchartDataReader, INITIAL_FLOWCHART_DATA, SOURCE_SORTS, type FlowchartData, type FlowchartSort } from "./read.js";
import { selectionHeld, type FlowchartSelection } from "./selection.js";
import { followedSources, sourceNouns } from "./sources.js";
import { useFlowchartToolbarItems } from "./toolbar.js";
import { useFlowchartDrop } from "./use-drop.js";

export type { FlowchartValue } from "./model.js";

type Styles = Record<string, SystemStyleObject>;

const payloadEqual = equivalentFor(Flowchart.Types.Payload);
const stringEqual = equalFor(StringType);
const readinessesEqual = equalFor(ArrayType(EditingBatchReadinessType));

/** Where the zoom stands until the canvas is measured (R42): at the cards' own size, which is Fit — both ends. */
const OPENS_ZOOMED: ZoomRange = { atFit: true, atLimit: true };

/** Props of {@link EastChakraFlowchart}. */
export interface EastChakraFlowchartProps {
    /** The payload, decoded. */
    readonly value: FlowchartValue;
    /** The structural storage key: the editing's sessions are kept under it and the Flowchart's `name`. */
    readonly storageKey: string;
}

/** A session's kind as the Flowchart names its kinds: `undefined` for none of them. */
function sortOf(kind: string): FlowchartSort | undefined {
    return FLOWCHART_SORTS.find((sort) => stringEqual(sort, kind));
}

/**
 * The nouns the Flowchart's words are made from (#1516): each kind's own
 * `name` — its default where the Flowchart has no such kind — and the app's
 * words for a transition's kinds, its `vocabulary`.
 *
 * @param value - The payload
 * @returns The nouns, each as a heading writes it
 */
function flowchartNouns(value: FlowchartValue): FlowchartNouns {
    return {
        state: value.states.name,
        transition: kindOf(value, "transitions")?.name ?? DEFAULT_FLOWCHART_NOUNS.transition,
        lane: kindOf(value, "lanes")?.name ?? DEFAULT_FLOWCHART_NOUNS.lane,
        decision: kindOf(value, "decisions")?.name ?? DEFAULT_FLOWCHART_NOUNS.decision,
        planned: value.vocabulary.planned,
        observed: value.vocabulary.observed,
    };
}

/**
 * Renders the Flowchart: its records read, and its frame over them — see the
 * module docs.
 *
 * @param props - The payload, and the storage key
 * @returns The Flowchart
 */
export const EastChakraFlowchart = memo(function EastChakraFlowchart({ value, storageKey }: EastChakraFlowchartProps) {
    const [data, setData] = useState<FlowchartData>(INITIAL_FLOWCHART_DATA);
    // A Retry reads every kind again: each source of the rail a kind is read through asked anew — its pages, a failed
    // one among them, which it holds until then — as the Schematic's Retry asks its kind's, the details' paged reads
    // asked again at once (R34), and the read's attempt moves.
    const [attempt, setAttempt] = useState(0);
    const slice = value.slice;
    const readAgain = useCallback(() => {
        const chrome = getSomeorUndefined(slice);
        for (const sort of SOURCE_SORTS) sourcePart(chrome, sort)?.retry();
        askDetailsAgain(detailsKindsOf(value));
        setAttempt((n) => n + 1);
    }, [slice, value]);
    return (
        <>
            <FlowchartDataReader value={value} attempt={attempt} onData={setData} />
            <FlowchartFollows value={value} data={data} attempt={attempt} readAgain={readAgain} storageKey={storageKey} />
        </>
    );
}, (prev, next) => payloadEqual(prev.value, next.value) && prev.storageKey === next.storageKey);

/** Props of {@link FlowchartFollows}. */
interface FlowchartFollowsProps {
    /** The payload, decoded. */
    readonly value: FlowchartValue;
    /** What the reader has read. */
    readonly data: FlowchartData;
    /** The read's attempt: a Retry moves it, and the details are read again with the records. */
    readonly attempt: number;
    /** Reads every kind again: the loading line's Retry. */
    readonly readAgain: () => void;
    /** The structural storage key. */
    readonly storageKey: string;
}

/**
 * The sources of the rail the Flowchart follows — each library tab's, and,
 * under `narrowed: "dim"`, the states' and the transitions' — each counted in
 * its noun; and the states and the transitions read through their sources,
 * each one's hidden pick (`HideSources`), which Find and Issues pick by.
 *
 * @param props - The payload, what is read, its Retry and the storage key
 * @returns The frame, once every source is read
 */
function FlowchartFollows(props: FlowchartFollowsProps) {
    const { value } = props;
    const formatters = useFormatters();
    // Its words, made from its nouns (#1516): each kind's own name, and the app's words for a transition's kinds.
    const words = useMemo((): FlowchartWords => ({ ...formatters, m: flowchartMessagesOf(flowchartNouns(value)) }), [formatters, value]);
    const chrome = useMemo(() => getSomeorUndefined(value.slice), [value.slice]);
    const sources = useMemo(() => followedSources(value), [value]);
    const nouns = useMemo(() => sourceNouns(value, words.m, words.locale), [value, words]);
    // What a source's failed narrowing says, in the Flowchart's words.
    const said = useCallback((name: string): KeyVisibilityWords => ({ changed: words.m.sourceChanged({ name }), failed: words.m.sourceFailed({ name }) }), [words]);
    // The states and the transitions, each read through its source of the rail: each one's hidden pick, which asks e3 of
    // a row at its kind's key type (#1549).
    const hidden = useMemo(() => SOURCE_SORTS.flatMap((sort): HiddenSource[] => {
        const kind = kindOf(value, sort);
        const part = kind === undefined ? undefined : sourcePart(chrome, sort);
        return kind === undefined || part === undefined ? [] : [{ key: sort, part, keyType: kind.keyType }];
    }), [value, chrome]);
    return (
        <FollowSources chrome={chrome} narrowed={value.shown} sources={sources} nouns={nouns} said={said}>
            {(followed) => (
                <HideSources name="Flowchart" sources={hidden}>
                    {(picks) => <FlowchartFrame {...props} words={words} nouns={nouns} followed={followed} picks={picks} />}
                </HideSources>
            )}
        </FollowSources>
    );
}

/** Props of {@link FlowchartFrame}. */
interface FlowchartFrameProps extends FlowchartFollowsProps {
    /** The Flowchart's words, in the app's locale. */
    readonly words: FlowchartWords;
    /** What the rail counts each source in, by its name. */
    readonly nouns: ReadonlyMap<string, string>;
    /** What each source the Flowchart follows shows. */
    readonly followed: FollowedSources;
    /** Each source's hidden pick, by its kind. */
    readonly picks: HiddenPicks;
}

/**
 * A refusal in the footer's words (#1549): the row holding the key a row
 * builds, or the row whose key would move (#1580), named as the canvas names it
 * — a transition by its ends' states, a state by its label, else its key, a
 * lane by its label.
 *
 * @param refusal - Why the gesture records nothing
 * @param holding - What the Flowchart holds: the row named, among those drawn, hidden and waiting
 * @returns Its words
 */
function refusalWord(refusal: FlowchartRefusal, holding: FlowchartHolding): FlowchartRefusalWord {
    if (refusal.refusal === "placeholder" || refusal.refusal === "untyped") return refusal;
    const { model, rows } = holding;
    const key = refusal.key;
    const waiting = holding.waiting.find((row) => row.sort === refusal.sort && stringEqual(row.key, key));
    const stateName = (state: string): string => model.nodesByKey.get(state)?.label ?? state;
    const labelled = (label: string | undefined): string => (label === undefined || label.length === 0 ? key : label);
    const nameOf = (): string => {
        switch (refusal.sort) {
            case "states": return labelled(rows.states.find((row) => stringEqual(row.key, key))?.roles.label ?? (waiting?.sort === "states" ? waiting.roles.label : undefined));
            case "lanes": return labelled(model.lanes.find((lane) => lane.band === "lane" && stringEqual(lane.key, key))?.label ?? (waiting?.sort === "lanes" ? waiting.roles.label : undefined));
            case "decisions": return model.triggers.get(key)?.label ?? key;
            case "transitions": return key;
        }
    };
    if (refusal.refusal === "unheld") return { refusal: "unheld", name: nameOf(), by: refusal.by, why: refusal.why };
    if (refusal.sort !== "transitions") return { refusal: "taken", sort: refusal.sort, name: nameOf() };
    const roles = [...rows.transitions, ...holding.hidden].find((row) => stringEqual(row.key, key))?.roles
        ?? (waiting?.sort === "transitions" ? waiting.roles : undefined);
    return roles === undefined ? { refusal: "taken", sort: "transitions", name: key }
        : { refusal: "taken", sort: "transitions", from: stateName(roles.from), to: stateName(roles.to) };
}

/**
 * What is selected, after a gesture moved rows under the keys their fields
 * build (#1549): a moved row's selection under its new key.
 *
 * @param selection - What was selected
 * @param moved - The rows moved
 * @returns The selection that follows them; `undefined` where none moved
 */
function followMoves(selection: FlowchartSelection | null, moved: GestureEdits["moved"]): FlowchartSelection | undefined {
    if (selection === null || moved === undefined || moved.length === 0) return undefined;
    const to = (sort: FlowchartSort, key: string) => moved.find((move) => move.sort === sort && stringEqual(move.key, key))?.to;
    switch (selection.kind) {
        case "states": {
            const keys = selection.keys.map((key) => to("states", key) ?? key);
            return keys.some((key, i) => !stringEqual(key, selection.keys[i]!)) ? { kind: "states", keys } : undefined;
        }
        case "state": { const key = to("states", selection.key); return key === undefined ? undefined : { kind: "state", key }; }
        case "link": { const key = to("transitions", selection.key); return key === undefined ? undefined : { kind: "link", key }; }
        case "lane": { const key = to("lanes", selection.key); return key === undefined ? undefined : { kind: "lane", key }; }
        case "trigger": return undefined;
    }
}

/** What the frame's gestures read as they are made, the latest render's: what is held, what is selected, and how a drop lands. */
interface Latest {
    readonly holding: FlowchartHolding;
    readonly selection: FlowchartSelection | null;
    readonly context: FlowchartDropContext;
}

/**
 * The frame: the rows read with the drafts in place, the model drawn from
 * them, and every part over them — see the module docs.
 *
 * @param props - The payload, what is read, the words, and the rail's sources and picks
 * @returns The frame
 */
function FlowchartFrame({ value, data, attempt, readAgain, storageKey, words, nouns, followed, picks }: FlowchartFrameProps) {
    const recipe = useSlotRecipe({ key: "flowchart" });
    const styles = useMemo(() => recipe() as Styles, [recipe]);
    const m = words.m;
    const name = getSomeorUndefined(value.name);
    const keys = useMemo(() => flowchartKeys(name), [name]);
    // Each kind's keys (#1549): each key's text, read back at its record's key type, and their order by it.
    const rowKeys = useMemo(() => flowchartKindKeys(value), [value]);
    const chrome = useMemo(() => getSomeorUndefined(value.slice), [value.slice]);
    const kindName = useCallback((sort: FlowchartSort): string => kindOf(value, sort)?.name ?? sort, [value]);

    // ── What stands in while a new narrowing is read ─────────────────────
    // Under `dim`, a kind's shown keys resolving keeps the canvas's last rows; a failed one keeps them too.
    const narrowingBusy = SOURCE_SORTS.some((sort) => {
        const one = followed.get(sort);
        return one !== undefined && one.shown.busy && one.error === undefined;
    });
    const stale = data.ready && (data.filtering || narrowingBusy);
    const retained = stale || SOURCE_SORTS.some((sort) => followed.get(sort)?.error !== undefined);

    // ── The editing: one history over a session per record that writes ─
    // Each kind read through its source that writes: its Save's notice counts what leaves the source's narrowing.
    const recordSlices = useMemo(() => SOURCE_SORTS.flatMap((sort) => {
        const part = kindOf(value, sort)?.editable === true ? sourcePart(chrome, sort) : undefined;
        return part === undefined ? [] : [part];
    }), [value, chrome]);
    const keyWords = useMemo((): FlowchartKeyCheckWords => ({ held: m.keyHeld, checking: m.keyChecking, placeholder: m.keyPlaceholder }), [m]);
    const editing = useFlowchartEditing(value, `${storageKey}.${name ?? "flowchart"}`, recordSlices, data.held, keyWords, retained);
    const history = editing.history;
    const sessions = editing.schedule.sessions;

    // ── The rows, the drafts in place, and the model drawn from them ────
    // Under `dim`, what the rail leaves out of a kind read through its source is drawn dimmed: the keys it shows.
    const dimmed = useMemo((): FlowchartDimmed => {
        if (value.narrowed.type !== "dim") return {};
        const of = (sort: FlowchartSort) => {
            const shown = followed.get(sort)?.shown.keys;
            return shown?.type === "some" ? (key: string) => !shown.value.has(key) : undefined;
        };
        return { states: of("states"), transitions: of("transitions") };
    }, [value.narrowed, followed]);
    const drafted = useMemo(() => draftedRows(data.held, data.hiddenWith, editing.drafts, rowKeys, dimmed),
        [data.held, data.hiddenWith, editing.drafts, rowKeys, dimmed]);
    const model = useMemo(() => buildModel(drafted.rows, words), [drafted.rows, words]);

    // ── The details: read by the rows drawn, in a reader of their own, and counted into the flowchart's bins ──
    const [details, setDetails] = useState<FlowchartDetailsData>(NO_DETAILS);
    const detailsKinds = useMemo(() => detailsKindsOf(value), [value]);
    const drawn = useDrawnKeys(model);
    const detailsModel = useMemo(() => flowchartDetailsModel(detailsKinds, details, drawn, words), [detailsKinds, details, drawn, words]);

    // ── What is selected, and where the canvas looks ──────────────────
    const [selected, setSelected] = useState<FlowchartSelection | null>(null);
    const selection = useMemo(() => selectionHeld(selected, model), [selected, model]);
    const [reveal, setReveal] = useState<FlowchartReveal | null>(null);
    const revealSelection = useCallback((next: FlowchartSelection | null, scroll = true) => {
        setSelected(next);
        if (next !== null) setReveal((was) => ({ selection: next, seq: (was?.seq ?? 0) + 1, scroll }));
    }, []);
    // A gesture refused, a pick that could not clear the rail's choices: the footer's line says why.
    const [notice, setNotice] = useState<string | undefined>(undefined);

    // ── The gestures: each one step of the history ─────────────────────
    const holding = useMemo((): FlowchartHolding => ({
        model, rows: drafted.rows, hidden: drafted.hidden, waiting: drafted.waiting,
        can: (sort) => editing.editable(sort) && editing.available(sort),
        taken: (sort, key) => editing.taken(sort, key),
        stands: (sort, key) => editing.stands(sort, key),
        mintTransition: (minted) => editing.mintTransition(minted),
        unqueues: editing.unqueues, wholeLaneOrders: editing.wholeLaneOrders,
        newKey: (sort, made, madeUp, minted) => editing.newKey(sort, made, madeUp, minted),
        moves: (edits) => editing.moves(edits),
        // A state or a transition the rail narrows reads only its narrowing, under `"hide"`; under `"dim"` it reads every
        // row, and a lane or a decision is read whole (#1580).
        unheld: (sort) => {
            if (!editing.editable(sort)) return undefined;
            const narrows = (sort === "states" || sort === "transitions") && value.narrowed.type !== "dim";
            if (narrows && (sourcePart(chrome, sort)?.read().where.size ?? 0) > 0) return "filtered";
            return editing.available(sort) ? undefined : "busy";
        },
        created: (sort, key) => editing.drafts[sort].get(key)?.created === true,
    }), [model, drafted, editing, value.narrowed, chrome]);
    const context = useMemo((): FlowchartDropContext => ({
        model,
        editable: (sort) => editing.editable(sort),
        available: (sort) => editing.available(sort),
        kindName: (sort) => kindName(sort).toLocaleLowerCase(words.locale),
        untyped: (sort) => editing.untyped(sort),
    }), [model, editing, kindName, words.locale]);
    // The latest render's, as a gesture reads them when it is made: set once the render commits, never as it renders.
    const latest = useRef<Latest>({ holding, selection, context });
    useLayoutEffect(() => { latest.current = { holding, selection, context }; });
    const record = editing.record;
    // Every gesture's one way into the history, a drop's too: every row whose kind builds its key from it following its
    // fields (#1549); a refusal said in the footer, its words handed back; and what is selected following a row the
    // gesture moves.
    const recordGesture = useCallback((made: GestureEdits, origin: Origin, label: string):
        { readonly done: GestureEdits } | { readonly said: string } | undefined => {
        const { holding: now, selection: picked } = latest.current;
        const followed = followBuiltKeys(now, made);
        if (followed.refused !== undefined) {
            const said = m.gestureRefused(refusalWord(followed.refused, now));
            setNotice(said);
            return { said };
        }
        if (followed.edits.length > 0 && !record(followed.edits, origin, label)) return undefined;
        setNotice(undefined);
        const follows = followMoves(picked, followed.moved);
        if (follows !== undefined) setSelected(follows);
        return { done: followed };
    }, [record, m]);
    const commit = useCallback((made: GestureEdits, origin: Origin, label: string): GestureEdits | undefined => {
        const got = recordGesture(made, origin, label);
        return got === undefined || "said" in got ? undefined : got.done;
    }, [recordGesture]);
    const act = useCallback((gesture: FlowchartGesture, build: (holding: FlowchartHolding) => GestureEdits | undefined): GestureEdits | undefined => {
        const made = build(latest.current.holding);
        return made === undefined ? undefined : commit(made, EDIT_ORIGIN[gesture], m.editLabel({ gesture }));
    }, [commit, m]);
    // A form's edit in the inspector, as every gesture's: refused, why, which Details says under the field too.
    const edit = useCallback((gesture: FlowchartGesture, build: (holding: FlowchartHolding) => GestureEdits | undefined): boolean | string => {
        const made = build(latest.current.holding);
        const got = made === undefined ? undefined : recordGesture(made, EDIT_ORIGIN[gesture], m.editLabel({ gesture }));
        return got === undefined ? false : "said" in got ? got.said : true;
    }, [recordGesture, m]);
    const edits = editing.edits;
    const editable = editing.editable;
    const untyped = editing.untyped;
    const number = words.number;
    // Why "+ LANE", "+ STATE" and a kind's library cards add nothing, of a kind edited at all: its keys can't be typed, and
    // it builds none (#1549).
    const keysOff = useMemo(() => {
        const why = (sort: "states" | "lanes"): string | undefined => {
            const type = editable(sort) ? untyped(sort) : undefined;
            return type === undefined ? undefined : m.keysUntyped({ name: kindName(sort).toLocaleLowerCase(words.locale), type });
        };
        return { states: why("states"), lanes: why("lanes") };
    }, [editable, untyped, m, kindName, words.locale]);
    const canvasEdit = useMemo((): FlowchartCanvasEdit | undefined => {
        if (!edits) return undefined;
        const lanes = editable("lanes"), states = editable("states"), transitions = editable("transitions"), decisions = editable("decisions");
        // The "+ STATE" editor types a new state's key where the states are keyed by String and build none.
        const typed = states && rowKeys.states.text && !editing.builds("states");
        return {
            off: keysOff,
            addLane: lanes ? () => { act("addLane", (h) => addLane(h, (n) => m.newLane({ n, count: number(n) }))); } : undefined,
            renameLane: lanes ? (key, label) => { act("renameLane", (h) => renameLane(h, key, label)); } : undefined,
            deleteLane: lanes ? (key) => { act("deleteLane", (h) => deleteLane(h, key)); } : undefined,
            addState: states ? (band, key, label) => {
                const made = act("addState", (h) => addState(h, band, typed ? key : undefined, label));
                const added = made?.key ?? key;
                if (made !== undefined && added !== undefined) revealSelection({ kind: "state", key: added }, false);
                return made !== undefined;
            } : undefined,
            stateKeyTaken: typed ? (key) => editing.taken("states", key) : undefined,
            renameState: states ? (key, label) => { act("renameState", (h) => renameState(h, key, label)); } : undefined,
            moveStates: states ? (keys, band, at) => { act("moveStates", (h) => moveStates(h, keys, band, at)); } : undefined,
            deleteStates: states ? (keys) => { act("deleteStates", (h) => deleteStates(h, keys)); } : undefined,
            connect: transitions ? (from, to) => {
                const made = act("connect", (h) => connect(h, from, to));
                if (made?.key !== undefined) revealSelection({ kind: "link", key: made.key }, false);
            } : undefined,
            deleteLink: transitions ? (key) => { act("deleteLink", (h) => deleteLink(h, key)); } : undefined,
            deleteDecision: decisions ? (key) => { act("deleteDecision", (h) => deleteDecision(h, key)); } : undefined,
        };
    }, [edits, editable, editing, act, m, number, revealSelection, keysOff, rowKeys]);

    // ── The narrow layout: below 480px of main, measured by the canvas's element, which fills it ──
    const mainRef = useRef<HTMLDivElement | null>(null);
    const onCanvasElement = useCallback((element: HTMLDivElement | null) => { mainRef.current = element; }, []);
    const narrow = useContainerBelow(mainRef, NARROW_WIDTH);
    // Before the first read settles — the frame's cold load — the canvas draws nothing, never the empty records' band
    // row and its "+ LANE" (`read.ts`): it is given no gesture, so a flowchart with nothing read is blank. Below 480px of
    // main nothing drags (R17): the canvas moves no state and connects none, whatever the pointer — the inspector
    // carries a state's lane and a transition's ends.
    const canvasEdits = useMemo((): FlowchartCanvasEdit | undefined => {
        if (!data.ready || canvasEdit === undefined) return undefined;
        return narrow ? { ...canvasEdit, moveStates: undefined, connect: undefined } : canvasEdit;
    }, [data.ready, canvasEdit, narrow]);

    // ── The drops: a library card onto the canvas, as one step of the history ──
    const drop = useFlowchartDrop({
        value, keys, words,
        context: () => latest.current.context,
        holding: () => latest.current.holding,
        record: (made, label) => commit(made, EDIT_ORIGIN.dropCard, label),
        selection: () => latest.current.selection,
        select: revealSelection,
        notice: setNotice,
        drags: !narrow,
    });

    // ── The hidden pick: Find's and Issues', clearing just the choices hiding a row, then selecting it once drawn ──
    const pick = useHiddenPick<FlowchartSelection>({
        onError: (said) => setNotice(said),
        uncleared: m.hiddenUncleared(),
        landing: {
            drawn: (at) => !stale && selectionHeld(at, model) !== null,
            selects: (at) => revealSelection(at),
        },
    });
    const onFound = useCallback((found: FoundState) => {
        setNotice(undefined);
        const at: FlowchartSelection = { kind: "state", key: found.key };
        pick.pick(found.hidden, at, () => { revealSelection(at); });
    }, [pick, revealSelection]);
    const goToWaiting = useCallback((at: FlowchartSelection, hidden: readonly SourceHiding[] | undefined) => {
        pick.pick(hidden, at, () => { revealSelection(at); });
    }, [pick, revealSelection]);

    // ── Find: the states drawn, and those the rail hides through the states' source ──
    const statesPart = useMemo(() => sourcePart(chrome, "states"), [chrome]);
    const codec = useMemo(() => rowCodec(value.states.rowType), [value.states.rowType]);
    const findable = useMemo(() => model.nodes.filter((node) => !node.ghost)
        .map((node): FindableState => ({ key: node.key, label: node.label, dimmed: node.dimmed })), [model.nodes]);
    const finder = useFlowchartFind({
        part: statesPart, read: value.states.read, codec, keys: rowKeys.states, drawn: findable, stored: data.held.states, pick: picks.get("states"),
        dim: value.narrowed.type === "dim", words, onPick: onFound,
    });
    const find = useMemo(() => (finder === undefined ? undefined : pick.search(finder)), [finder, pick]);

    // ── The history item, and a conflict's Go to ───────────────────────
    // A row named as the canvas names it: a state by its key, a transition by its ends, a lane and a decision by their labels.
    const rowName = useCallback((kind: string, key: string): string => {
        switch (sortOf(kind)) {
            case "transitions": {
                const roles = drafted.rows.transitions.find((row) => stringEqual(row.key, key))?.roles;
                return roles === undefined ? key : `${roles.from} → ${roles.to}`;
            }
            case "lanes": return model.lanes.find((lane) => stringEqual(lane.key, key))?.label ?? key;
            case "decisions": return model.triggers.get(key)?.label ?? key;
            default: return key;
        }
    }, [drafted.rows.transitions, model]);
    const partOf = useCallback((issue: EditIssue) => {
        const key = history.sourceOf(issue);
        return key === undefined ? undefined : sessions.find((part) => stringEqual(part.key, key));
    }, [history, sessions]);
    // The field an issue gone to names, asked of its row's Details: it takes the keyboard there, the inspector opened where
    // it is collapsed (`../shared/schedule/field-ask.tsx`, #1585) — a conflict's Go to, which names its path, asks none.
    const { asks: fieldAsks, request: askField } = useFieldAsks();
    const onIssue = useCallback((issue: EditIssue, at?: PatchPath) => {
        const sort = sortOf(partOf(issue)?.kind ?? "");
        if (sort === undefined) return;
        askField(sort, issue.entry, at === undefined ? issue.field : none);
        revealSelection(selectionOf(sort, issue.entry));
    }, [partOf, revealSelection, askField]);
    const where = useCallback((issue: EditIssue) => {
        const part = partOf(issue);
        return part === undefined ? issue.entry : rowName(part.kind, issue.entry);
    }, [partOf, rowName]);
    // A conflict's value as the canvas names that row — a state's lane by the lane's label, a transition's ends by their
    // states' and its decision by the decision's — never a key (#1503).
    const transitionKind = getSomeorUndefined(value.transitions);
    const keyFields = useMemo((): FlowchartKeyFields => ({
        lane: getSomeorUndefined(value.states.laneField),
        ends: transitionKind === undefined ? undefined : [transitionKind.fromField, transitionKind.toField],
        decision: transitionKind === undefined ? undefined : getSomeorUndefined(transitionKind.decisionField),
    }), [value.states, transitionKind]);
    const conflictValue = useCallback((issue: EditIssue, path: PatchPath, held: unknown) => {
        const sort = sortOf(partOf(issue)?.kind ?? "");
        return sort === undefined ? undefined : conflictValueName(sort, path, held, keyFields, model);
    }, [partOf, keyFields, model]);
    // The history's acts: a field typed into lets go first, committing what it holds — the history's buttons take no
    // focus from it. Anything else keeps the focus, a button of the canvas's or the canvas itself, so the next key — a
    // Redo after an Undo — reaches the frame too, never the page.
    const onAction = useCallback((action: HistoryAction) => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && typedInto(active)) active.blur();
        history.act(action);
    }, [history]);
    const historyItem = edits ? historyToolbarItem({ session: history, words, editing: false, showError: false, onIssue, where, conflictValue, onAction }) : undefined;

    // ── The toolbar ─────────────────────────────────────────────────────
    const toolbarRef = useRef<HTMLDivElement>(null);
    const [orientation, setOrientation] = useViewerOrientation(keys.orientation, getSomeorUndefined(value.canvas.orientation)?.type ?? "LR");
    const freshnessValue = getSomeorUndefined(value.canvas.freshness);
    const freshness = useMemo(
        () => (freshnessValue === undefined ? undefined : { label: freshnessValue.label, date: getSomeorUndefined(freshnessValue.date) }),
        [freshnessValue]);
    const railNouns = useMemo(() => Object.fromEntries(nouns), [nouns]);
    // The zoom (R42): the toolbar's strip zooms the canvas through its handle, and the canvas tells it where the zoom
    // stands — until it is measured, at the cards' own size and at Fit, both off.
    const canvasRef = useRef<FlowchartCanvasHandle>(null);
    const [zoomRange, setZoomRange] = useState<ZoomRange>(OPENS_ZOOMED);
    const zoomBy = useCallback((factor: number) => canvasRef.current?.zoomBy(factor), []);
    const fit = useCallback(() => canvasRef.current?.fit(), []);
    const items = useFlowchartToolbarItems({
        styles, find, orientation, onOrientation: setOrientation, freshness, words, history: historyItem, chrome, nouns: railNouns,
        zoom: zoomRange, onZoom: zoomBy, onFit: fit,
    });
    // ⌘F, or Ctrl+F, anywhere in the frame: Find; ⌘Z, ⇧⌘Z and ⌘Y the history's, but in a field typed into, whose own
    // they are; and the canvas's keys. Each key acted on goes no further than the Flowchart.
    const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if (event.defaultPrevented) return;
        if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
            if (focusKeySearch(toolbarRef.current)) takeKey(event);
            return;
        }
        const action = historyShortcut(event);
        if (action !== undefined && edits && !typedInto(event.target)) {
            takeKey(event);
            onAction(action);
            return;
        }
        canvasRef.current?.key(event);
    }, [edits, onAction]);

    // ── The issues, and the panes ──────────────────────────────────────
    const decisionsGiven = getSomeorUndefined(value.decisions) !== undefined;
    const historyVersion = editing.version;
    // Each session's readiness, held by what it says, as the Sheet holds its own: the history checks each session again
    // as what its checks read lands — the key check's answer from e3 (D3) — and that moves no version of it.
    const readiness = useDataStable(sessions.map((part) => part.session.readiness), readinessesEqual);
    // Each kind's form's numbers held to bounds (#1585), and its rows' codec: what each row drawn is checked against, in
    // the form's own words.
    const bounded = useMemo(() => FLOWCHART_SORTS.flatMap((sort) => {
        const kind = kindOf(value, sort);
        const specs = kind?.fields.filter(isBounded) ?? [];
        return kind === undefined || specs.length === 0 ? [] : [{ sort, specs, codec: rowCodec(kind.rowType) }];
    }), [value]);
    const breachWords = useCallback((sort: FlowchartSort, breach: FieldBreach): FlowchartBreachWords => ({
        field: bounded.find((one) => one.sort === sort)?.specs.find((spec) => stringEqual(spec.path.join("."), breach.key))?.label ?? breach.key,
        bound: fieldBreachText(breach, { ...words, m: fieldFormMessages }),
    }), [bounded, words]);
    // Each stored row decoded once: a read keeps a row's bytes the same object while it holds the row.
    const decodedRows = useRef(new WeakMap<Uint8Array, unknown>());
    // The rows drawn whose numbers their fields' bounds don't hold, the drafts in place: each warns, but a changed row's,
    // which its session's readiness lists among what holds Save — and a state's, stored or changed, wears the warn ring.
    const breaches = useMemo((): { readonly warned: FlowchartBreach[]; readonly states: ReadonlySet<string> } => {
        const warned: FlowchartBreach[] = [];
        const states = new Set<string>();
        for (const { sort, specs, codec } of bounded) {
            const session = sessions.find((part) => stringEqual(part.kind, sort))?.session;
            const said = session === undefined || session.readiness.type === "ready" ? [] : session.readiness.value;
            const stored: ReadonlyMap<string, { readonly row: Uint8Array }> | undefined = data.held[sort];
            const rows = sort === "lanes" ? drafted.rows.lanes ?? [] : drafted.rows[sort];
            for (const { key, dimmed } of rows) {
                // What the narrowing draws as context raises none: no path selects it.
                if (dimmed) continue;
                const entry = session?.entries.get(key);
                let held: unknown;
                if (entry !== undefined) {
                    held = draftedRow(entry)?.row;
                } else {
                    const bytes = stored?.get(key)?.row;
                    if (bytes === undefined) continue;
                    held = decodedRows.current.get(bytes);
                    if (held === undefined) {
                        held = codec.decode(bytes);
                        decodedRows.current.set(bytes, held);
                    }
                }
                if (held === undefined) continue;
                const found = fieldBreaches(specs, held);
                if (sort === "states" && found.length > 0) states.add(key);
                for (const breach of found) {
                    if (said.some((issue) => stringEqual(issue.entry, key) && issue.field.type === "some" && stringEqual(issue.field.value, breach.key))) continue;
                    warned.push({ sort, key, ...breachWords(sort, breach) });
                }
            }
        }
        return { warned, states };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the sessions are mutable: the history's version and their readiness say they moved
    }, [bounded, drafted.rows, data.held, sessions, breachWords, historyVersion, readiness]);
    const issueArgs = useMemo((): FlowchartIssueArgs => ({
        model, transitions: drafted.rows.transitions, waiting: drafted.waiting, hiddenWith: data.hiddenWith, stored: data.held.states, decisions: decisionsGiven,
        details: detailsModel.findings, breaches: breaches.warned,
    }), [model, drafted, data.hiddenWith, data.held.states, decisionsGiven, detailsModel.findings, breaches]);
    const issues = useMemo(() => [...sessionIssues(sessions, issueArgs, kindName, breachWords), ...flowchartIssues(issueArgs)],
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the sessions are mutable: the history's version and their readiness say they moved
        [sessions, issueArgs, kindName, breachWords, historyVersion, readiness]);
    // The states a Save's conflict names: the canvas marks them.
    const conflicted = useMemo(() => {
        const out = new Set<string>();
        for (const part of sessions) if (sortOf(part.kind) === "states") for (const key of part.session.conflicts.keys()) out.add(key);
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the sessions are mutable: the history's version says they moved
    }, [sessions, historyVersion]);
    const saves = useLastSaves(value, words);
    const start = useFlowchartLibrary({ value, keys, words, enter: drop.enter, followed, narrow, off: keysOff });
    const end = flowchartInspectorPane({
        value, model, rows: drafted.rows, held: data.held, selection, editing, act, edit, refuse: setNotice, reveal: revealSelection,
        issues, picks, goToWaiting, saves, details: detailsModel, storageKey: keys.frame, words,
    });

    // ── The banners: each session's, and each source the rail could not read ──
    const followedFailures = [...followed.values()].filter((source) => source.error !== undefined);
    const banners = sessions.length === 0 && followedFailures.length === 0 ? undefined : (
        <>
            {sessions.map((part) => {
                const sort = sortOf(part.kind);
                return (
                    <SessionBanners key={part.key} session={part.session} words={words} name={sort === undefined ? part.kind : kindName(sort)}
                        where={(issue) => rowName(part.kind, issue.entry)} onAction={(action) => history.actOn(part.key, action)} />
                );
            })}
            {followedFailures.map((source) => (
                <Box key={source.name} data-flowchart-banner="source">
                    <BannerView status="error" title={m.sourceUnavailable({ name: source.name })} description={source.error}
                        actions={<Button size="xs" variant="outline" onClick={source.retry}>{m.retry()}</Button>} />
                </Box>
            ))}
        </>
    );

    // ── The footer: each Save's notice, and the loading line ────────────
    const locale = words.locale;
    const notices = useMemo(() => SOURCE_SORTS.flatMap((sort): FlowchartNotice[] => {
        const kind = kindOf(value, sort);
        const part = kind?.editable === true ? sourcePart(chrome, sort) : undefined;
        if (kind === undefined || part === undefined) return [];
        const one = kind.name.toLocaleLowerCase(locale);
        return [{ sort, slice: part, singular: one, plural: kindPlural(one) }];
    }), [value, chrome, locale]);
    // What the line says: a failed read first, with Retry — the rows', then the details' — then the read in flight — a
    // kind's first, or its new narrowing's, then the details' (R34).
    const line = useMemo((): LoadingLineValue | undefined => {
        const noun = (sort: FlowchartSort) => m.kindNoun({ sort, n: 2 });
        const detailsOf = [["states", detailsModel.states], ["transitions", detailsModel.transitions]] as const;
        if (data.error !== undefined) return pagedLoadingLine({ kind: "failed", from: undefined, to: undefined, reason: data.error }, noun("states"), m, number, readAgain);
        for (const [sort, reason] of data.failures) return pagedLoadingLine({ kind: "failed", from: undefined, to: undefined, reason }, noun(sort), m, number, readAgain);
        for (const [sort, kind] of detailsOf) {
            if (kind?.error !== undefined) return pagedLoadingLine({ kind: "failed", from: undefined, to: undefined, reason: kind.error }, m.detailsNoun({ sort }), m, number, readAgain);
        }
        if (data.reading !== undefined) {
            return pagedLoadingLine(data.reading.filtering ? { kind: "filtering" } : { kind: "loading", from: undefined, to: undefined }, noun(data.reading.sort), m, number, readAgain);
        }
        if (narrowingBusy) return pagedLoadingLine({ kind: "filtering" }, noun("states"), m, number, readAgain);
        for (const [sort, kind] of detailsOf) {
            if (kind?.reading === true) return pagedLoadingLine({ kind: "loading", from: undefined, to: undefined }, m.detailsNoun({ sort }), m, number, readAgain);
        }
        return undefined;
    }, [data.error, data.failures, data.reading, narrowingBusy, detailsModel.states, detailsModel.transitions, m, number, readAgain]);
    // A failed read, said once on the canvas at its top-left as the line says it, with the line's Retry (R5).
    const failure = useMemo((): FlowchartCanvasFailure | undefined =>
        (line?.kind === "failed" ? { message: loadingLineText(line.text), retry: line.onRetry } : undefined), [line]);

    return (
        <FieldAskProvider value={fieldAsks}><Box css={styles.root} data-flowchart-root="" data-flowchart-layout={narrow ? "narrow" : "wide"}>
            <FlowchartDetailsReader kinds={detailsKinds} drawn={drawn} attempt={attempt} onDetails={setDetails} />
            {/* The frame's one reveal clock: the footer's line shows a read in flight after 150 ms, held 300 ms once shown. */}
            <LoadingReveal waiting={line?.kind === "loading"}>
                <BuilderFrame
                    storageKey={keys.frame}
                    loading={!data.ready && data.error === undefined}
                    busy={data.loading || narrowingBusy}
                    toolbar={items}
                    toolbarRef={toolbarRef}
                    banners={banners}
                    start={start}
                    end={end}
                    footer={<FlowchartFooter styles={styles} counts={model.counts} pending={edits ? history.pending : undefined} saved={saves.newest?.when}
                        message={notice} words={words} notices={notices} line={line} />}
                    onKeyDown={onKeyDown}
                >
                    <FlowchartCanvasView ref={canvasRef} canvas={value.canvas} model={model} details={detailsModel} orientation={orientation} reveal={reveal} conflicted={conflicted}
                        bounded={breaches.states}
                        edit={canvasEdits} drop={drop.canvas} selection={selection} onSelect={setSelected} words={words} storageKey={storageKey}
                        onElement={onCanvasElement} failure={failure} onZoomRange={setZoomRange} />
                </BuilderFrame>
            </LoadingReveal>
        </Box></FieldAskProvider>
    );
}

// =============================================================================
// Side-effect — register the renderer for the Flowchart extension on module load.
// =============================================================================

implementUIComponent(Flowchart.Component, EastChakraFlowchart);
