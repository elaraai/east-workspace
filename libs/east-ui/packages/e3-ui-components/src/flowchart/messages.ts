/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's words (#1501–#1505, `Flowchart Records Spec.md`) — its
 * canvas's gestures: "+ LANE", a lane's ×, the "+ STATE" ghost and each
 * gesture's name in the history; its footer's counts, the changes waiting on
 * Save and its last save; its loading line, in a kind's noun; its library
 * pane's — the pane, the Steps, Transitions and Lanes tabs, each tab's empty
 * state and what the rail leaves it; its drops': where a card lands, what it
 * sets its fields on, why it is refused, and a drop's name in the history; its
 * inspector's: the pane and its tabs, what it shows, each field's label, its
 * parts' heads, chips, gestures, counts and hints, why a key is refused, and
 * each issue's words; and the rail's: what it counts each kind and each list
 * of cards in, what a row it hides or dims says of the choices that do, and
 * the banner over a source whose narrowing could not be read — beside the
 * editing session's own (`EditingMessages`), which its history item and
 * banners speak, as the Schematic's and the Sheet's tables carry them. A host
 * translates the flowchart where it translates the session.
 *
 * The table is made from the Flowchart's nouns (`flowchartMessagesOf`, #1516):
 * each kind's noun — its own `name`, `State` unless the app gives one — and
 * the app's words for a transition's kinds, `Planned` and `Observed` unless
 * its `vocabulary` gives others; so every word the table says of a kind is the
 * app's. `flowchartMessages` is the table in the Flowchart's own words.
 *
 * @packageDocumentation
 */

import { StringType, printFor } from "@elaraai/east";
import { editingMessages, type EditingMessages, type EditingWords } from "@elaraai/east-ui-components";
import { pagedLoadingMessages, type PagedLoadingMessages } from "../shared/loading.js";
import { hiddenByText, joinedWords, kindPlural, lowerWord, type HiddenWords } from "../shared/schedule/words.js";
import type { FlowchartBinsRefusalWord } from "./details.js";
import type { FlowchartGesture } from "./edits.js";
import type { FlowchartIssueWord } from "./issues.js";
import type { FlowchartSort } from "./read.js";

/** A count as a message takes it: the number, for its plural, and the number as the locale prints it. */
export interface FlowchartCount {
    /** The number. */
    readonly n: number;
    /** The number, printed in the app's locale. */
    readonly count: string;
}

/** A tab of the library pane: the Steps, Transitions or Lanes tab — a kind's cards — or one of the author's. */
export type FlowchartLibraryTabWord = "states" | "transitions" | "lanes" | "tab";

/**
 * What a library card lands on: a state's card a lane; a transition's card a
 * transition; a lane's card the gap between two lanes; an author's card a
 * state, a transition, a lane's header or a decision's diamond, as its drop's
 * type names.
 */
export type FlowchartLandsWord = "lane" | "state" | "transition" | "header" | "gap" | "decision";

/**
 * Where a dropped card lands: a state after the state above it, at the start
 * of a lane holding states, or in a lane holding none — the lane `undefined`
 * where the flowchart has no lanes; a lane before the lane it lands before, or
 * at the end of the lanes.
 */
export type FlowchartDropPlaceWord =
    | { readonly place: "after"; readonly lane: string | undefined; readonly after: string }
    | { readonly place: "start" | "in"; readonly lane: string | undefined }
    | { readonly place: "before"; readonly lane: string }
    | { readonly place: "end" };

/** What a dropped card sets its fields on, as its words name it: a state by its key, a transition by its ends, a lane by its name, a decision by its label. */
export type FlowchartDropWhatWord =
    | { readonly what: "state"; readonly key: string }
    | { readonly what: "transition"; readonly from: string; readonly to: string }
    | { readonly what: "header"; readonly lane: string }
    | { readonly what: "decision"; readonly label: string };

/**
 * Why a drop is refused: not onto what the card lands on; or its kind's
 * record takes no edit — read only, or its session busy — the kind as one of
 * its rows is called, `state`.
 */
export type FlowchartDropRefusalWord =
    | { readonly why: "onto"; readonly lands: FlowchartLandsWord }
    | { readonly why: "readOnly" | "busy"; readonly kind: string };

/**
 * What the inspector shows, in its head and on its rail: one row, by its
 * kind's name and its own — `State · SCN`; several states — `3 states`, the
 * kind's name as a sentence says it; or nothing selected, the flowchart.
 */
export type FlowchartInspectWord =
    | { readonly what: "row"; readonly kind: string; readonly name: string }
    | { readonly what: "several"; readonly n: number; readonly count: string; readonly name: string }
    | { readonly what: "flowchart" };

/** A field the inspector's own forms show, by its name: a row's key and label, a transition's ends, its evidence's, and the lane several states move to. */
export type FlowchartFieldWord = "key" | "label" | "from" | "to" | "volume" | "count" | "measured" | "moveTo";

/** A part's head in the inspector's Details: a state's transitions, those a decision governs, a transition's evidence, and a state's transitions' groups. */
export type FlowchartPartWord = "transitions" | "governs" | "evidence" | "in" | "out" | "inPlace";

/** A row's chip in the inspector's head: drafted since e3 held it, new, a key no state is keyed by, a transition naming one. */
export type FlowchartChipWord = "pending" | "new" | "noRow" | "unresolved";

/**
 * The words the Flowchart's table is made from (#1516): each kind's noun, its own `name` as a heading writes it, and the
 * app's words for a transition's kinds.
 */
export interface FlowchartNouns {
    /** What a state is called — `State`, or the states kind's `name`. */
    readonly state: string;
    /** What a transition is called — `Transition`, or the transitions kind's `name`. */
    readonly transition: string;
    /** What a lane is called — `Lane`, or the lanes kind's `name`. */
    readonly lane: string;
    /** What a decision is called — `Decision`, or the decisions kind's `name`. */
    readonly decision: string;
    /** A transition as it was designed — `Planned`, or the app's word in `vocabulary`. */
    readonly planned: string;
    /** A transition as it was seen to run — `Observed`, or the app's word in `vocabulary`. */
    readonly observed: string;
}

/** The Flowchart's nouns where nothing names them. */
export const DEFAULT_FLOWCHART_NOUNS: FlowchartNouns = {
    state: "State", transition: "Transition", lane: "Lane", decision: "Decision", planned: "Planned", observed: "Observed",
};

/** The Flowchart's message table: its own words, the rail's, the loading line's, and the editing session's. */
export interface FlowchartMessages extends EditingMessages, HiddenWords, PagedLoadingMessages {
    /** A new lane's label, by its number — `Lane 3`. */
    newLane: (p: FlowchartCount) => string;
    /** "+ LANE": the word under its plus. */
    laneWord: () => string;
    /** "+ LANE"'s accessible name, and its tooltip. */
    addLane: () => string;
    /** A phone's lane pager (`lane-pager.tsx`): its readout's word and what it counts — `Lanes 1–2 of 3`. */
    lanePager: (p: { range: string; total: string }) => string;
    /** The pager's ‹ and ›. */
    laneStep: (p: { more: boolean }) => string;
    /** The "+ STATE" ghost: the word beside its plus. */
    stateWord: () => string;
    /** A lane's ×: its accessible name, and its tooltip while it can delete — `Delete lane Sort`. */
    deleteLane: (p: { label: string }) => string;
    /** Why a lane's × is off: the states it holds — `Move its 3 states first`; `name`, what one is called, `state` unless given. */
    laneHoldsStates: (p: { n: number; count: string; name?: string | undefined }) => string;
    /** A lane's label field, where it is renamed in place. */
    laneLabelField: () => string;
    /** The "+ STATE" ghost's key field: its accessible name. */
    stateKeyField: () => string;
    /** Its placeholder. */
    stateKeyPlaceholder: () => string;
    /** Why its key is refused: a state holds it already — `A state is keyed "SCN" already`. */
    stateKeyTaken: (p: { key: string }) => string;
    /** The ghost's label field: its accessible name. */
    stateLabelField: () => string;
    /** Its placeholder. */
    stateLabelPlaceholder: () => string;
    /** A gesture's name in the history, and its Save's — `Move states`. */
    editLabel: (p: { gesture: FlowchartGesture }) => string;
    /** The band of the states naming no lane, in a flowchart that has lanes. */
    noLaneBand: () => string;
    /** A state no row stands for, which a transition names: its card's line. */
    noStateRow: () => string;
    /** The toolbar's Find: its accessible name and its placeholder. */
    findLabel: () => string;
    /** What Find says with nothing matching. */
    findNoMatches: () => string;
    /** The toolbar's orientation control. */
    orientationLabel: () => string;
    /** The toolbar's view menu. */
    viewLabel: () => string;
    /** The footer's transitions, after their count — `transitions`. */
    footerLinks: (p: { n: number }) => string;
    /** Their split — `8 planned · 2 observed · 1 unresolved`, the unresolved only when some are. */
    footerSplit: (p: { planned: string; observed: string; unresolved?: string | undefined }) => string;
    /** The changes waiting on Save — `3 pending`. */
    footerPending: (p: FlowchartCount) => string;
    /** When the records were last saved — `Saved 14:02`. */
    footerSaved: (p: { when: string }) => string;
    /** The library pane's name: its rail's label and its toggle's words. */
    libraryPane: () => string;
    /** A kind's tab's name, when its author gives none — `Steps`, `Transitions`, `Lanes`. */
    libraryTab: (p: { tab: Exclude<FlowchartLibraryTabWord, "tab"> }) => string;
    /** A tab's empty state: its title — `No cards`, `Nothing in Owners`; `name` is the tab's. */
    libraryEmpty: (p: { tab: FlowchartLibraryTabWord; name: string }) => string;
    /** The line under it. */
    libraryEmptyHint: (p: { tab: FlowchartLibraryTabWord; name: string }) => string;
    /** A tab the rail leaves no card: its title. */
    libraryNarrowed: (p: { tab: FlowchartLibraryTabWord; name: string }) => string;
    /** The line under it. */
    libraryNarrowedHint: (p: { tab: FlowchartLibraryTabWord; name: string }) => string;
    /** What a tab's search box counts its cards as — `card`, `cards`. */
    libraryNoun: (p: { tab: FlowchartLibraryTabWord; n: number }) => string;
    /** What a tab's cards are grouped by: its grouping control's words. */
    libraryGroupBy: () => string;
    /** Where a dropped card lands, as the ghost says it — `after CH* in Sort`, `at the start of Sort`, `before Load`. */
    dropPlace: (p: FlowchartDropPlaceWord) => string;
    /** The same place, as a screen reader hears where a drag rests and as a drop's history names it — `Sort, after CH*`, `the gap before Load`. */
    dropPlaceName: (p: FlowchartDropPlaceWord) => string;
    /** What a dropped card sets its fields on, named — `CH*`, `CH* → LDD`, `lane Sort`, `decision route`. */
    dropWhat: (p: FlowchartDropWhatWord) => string;
    /** What the ghost says over what a card sets its fields on — `onto CH* → LDD`. */
    dropOnto: (p: { what: string }) => string;
    /** Why a drop is refused where it rests — red on the ghost — and, for a card's ⏎, in the footer — `Drop onto a transition`. */
    dropRefused: (p: FlowchartDropRefusalWord) => string;
    /** The canvas, as a screen reader hears it where a drop is refused. */
    dropCanvas: () => string;
    /** A drop's name in the history, and its Save's — `Drop Held on Sort, after CH*`. */
    dropLabel: (p: { card: string; onto: string }) => string;
    /** The inspector pane's name: its rail's label and its toggle's words. */
    inspectorPane: () => string;
    /** The inspector's tabs: `Details`, `Issues`. */
    inspectorTab: (p: { tab: "details" | "issues" }) => string;
    /** What the inspector shows, in its head and on its rail — `State · SCN`, `3 states`, `Flowchart`. */
    inspectorWhat: (p: FlowchartInspectWord) => string;
    /** A field's label in the inspector's own forms — `Key`, `From`; `Move to lane`, by what a lane is called. */
    inspectorField: (p: { field: Exclude<FlowchartFieldWord, "moveTo"> } | { field: "moveTo"; name: string }) => string;
    /** The line under a new row's key field. */
    inspectorKeyHelp: () => string;
    /** A row in a select of the inspector's — `SCN · Scan`. */
    inspectorChoice: (p: { key: string; label: string }) => string;
    /** A part's head in Details — `Transitions · 3`, `In · 2`, `Evidence`; `name` is the transitions kind's. */
    inspectorSection: (p: { section: FlowchartPartWord; n: number; count: string; name: string }) => string;
    /** A transition's line under its ends in a list — `observed · route · 1.2k/day`, `unresolved`. */
    inspectorLinkKind: (p: { kind: "planned" | "observed" | "unresolved"; decision: string | undefined; badge: string | undefined }) => string;
    /** A row's chip in its head — `Pending`, `New`, `No state row`, `Unresolved`. */
    inspectorChip: (p: { state: FlowchartChipWord }) => string;
    /** A gesture's button in Details — `Duplicate`, `Delete`. */
    inspectorAction: (p: { action: "duplicate" | "delete" }) => string;
    /** Why a key typed in the inspector is refused, in the footer — `Every state needs a key`, `A lane is keyed "ld" already`; `name` as a sentence says it. */
    inspectorKeyRefused: (p: { name: string; key: string; why: "empty" | "taken" }) => string;
    /** How many states a lane holds — `Holds 3 states`; `name` as a sentence says it. */
    inspectorLaneStates: (p: { n: number; count: string; name: string }) => string;
    /** A key no state is keyed by, which transitions name — `Named by 2 transitions, and e3 holds no state keyed "GONE"`. */
    inspectorNoRow: (p: { n: number; count: string; key: string; state: string; transition: string }) => string;
    /** What one of the flowchart's counts counts, by its kind's name — `Lanes`, `States`. */
    inspectorCount: (p: { name: string; n: number }) => string;
    /** The flowchart's transitions, split — `8 planned · 2 observed · 1 unresolved`. */
    inspectorSplit: (p: { planned: string; observed: string; unresolved: string }) => string;
    /** A record's last save, and who made it — `States saved 14:02 by planner`. */
    inspectorSaved: (p: { name: string; when: string; by: string | undefined }) => string;
    /** One of the three hints nothing selected shows, as the flowchart edits or not. */
    inspectorHint: (p: { n: 1 | 2 | 3; edits: boolean }) => string;
    /** The hint in a phone's pane, nothing selected (ruled 3 Nov 2026): a tap, and no several selected or renamed in place there. */
    inspectorHintTouch: () => string;
    /** The Issues tab with none: its title, and the line under it. */
    inspectorNoIssues: (p: { part: "title" | "hint" }) => string;
    /** A transition's decision when it has none, first in its select. */
    noDecision: () => string;
    /** Where an issue is, over its words — `State · SCN`; the flowchart's own, its name alone. */
    issueWhere: (p: { kind: string | undefined; name: string }) => string;
    /** An issue — `SCN → GONE names GONE, and e3 holds no state of that key`. */
    issueText: (p: FlowchartIssueWord) => string;
    /** A transition's kind, as the legend says it — `Planned`, `Observed`. */
    kindLabel: (p: { kind: "planned" | "observed" }) => string;
    /** The legend's decision — `Decision trigger`. */
    legendDecision: () => string;
    /** The legend's in-place transition — `In-place transition`. */
    legendInPlace: () => string;
    /** What the rail counts a kind's rows in, and its banner names it by where its source has no label of its own — `states`. */
    kindNoun: (p: { sort: FlowchartSort; n: number }) => string;
    /** What the rail counts a kind's list of cards in — `state cards`. */
    cardsNoun: (p: { tab: Exclude<FlowchartLibraryTabWord, "tab"> }) => string;
    /** A row the rail's narrowing draws dimmed, before e3 has said which choices dim it — `dimmed by the rail`. */
    dimmedByFilters: () => string;
    /** Once it has: the choices that dim it, and those a pick clears with them. */
    dimmedBy: (p: { readonly filters: readonly string[]; readonly also: readonly string[] }) => string;
    /** A new row's key e3 holds already — `A state is keyed "SCN" already`. */
    keyHeld: (p: { sort: FlowchartSort; key: string }) => string;
    /** While e3 is asked for it — `Checking the key "SCN"`. */
    keyChecking: (p: { sort: FlowchartSort; key: string }) => string;
    /** A pick of a hidden row whose rail choices could not be cleared. */
    hiddenUncleared: () => string;
    /** The banner over a source of the rail whose narrowing could not be read — `Owners results unavailable`; `name` is the source's label, or what it is counted in. */
    sourceUnavailable: (p: { name: string }) => string;
    /** Why: its results moved while they were read. */
    sourceChanged: (p: { name: string }) => string;
    /** Why: its results could not be read. */
    sourceFailed: (p: { name: string }) => string;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** A kind's name, one or several of it — `state`, `states`. */
const counted = (n: number, name: string): string => (n === 1 ? name : kindPlural(name));

/** A key as a sentence quotes it: East's printing of the string. */
const quoted = printFor(StringType);

/** A name as a sentence starts with it. */
const capital = (name: string): string => `${name.charAt(0).toUpperCase()}${name.slice(1)}`;

/** A noun with its article, as a sentence takes it — `a state`, `an order`. */
const aNoun = (noun: string): string => `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;

/** Each field's label in the inspector's own forms. */
const FIELDS: { readonly [F in Exclude<FlowchartFieldWord, "moveTo">]: string } = {
    key: "Key", label: "Label", from: "From", to: "To", volume: "Volume", count: "Count", measured: "Measured",
};

/** A state's transitions' groups. */
const GROUPS = { in: "In", out: "Out", inPlace: "In place" } as const;

/** Why a histogram's bins, as the app binds them, are refused — `The bins of Time in state do not ascend: 5, then 5`. */
function binsRefused(read: string, refusal: FlowchartBinsRefusalWord): string {
    switch (refusal.why) {
        case "empty": return `The bins of ${read} hold no edge`;
        case "number": return `The bins of ${read} hold ${refusal.edge}, which no bin starts at`;
        case "order": return `The bins of ${read} do not ascend: ${refusal.before}, then ${refusal.after}`;
    }
}

/**
 * The English table, in the Flowchart's nouns (#1516): each kind's own `name`, and the app's words for a transition's
 * kinds.
 *
 * @param nouns - The nouns, each as a heading writes it
 * @returns The table
 */
export function flowchartMessagesOf(nouns: FlowchartNouns): FlowchartMessages {
    // Each noun as running text says it — and several of it, as English makes the plural.
    const state = lowerWord(nouns.state), states = kindPlural(state), transition = lowerWord(nouns.transition), transitions = kindPlural(transition);
    const lane = lowerWord(nouns.lane), lanes = kindPlural(lane), decision = lowerWord(nouns.decision);
    const planned = lowerWord(nouns.planned), observed = lowerWord(nouns.observed);
    /** A transition's kind, as running text says it. */
    const kindWord = (kind: "planned" | "observed" | "unresolved"): string => (kind === "planned" ? planned : kind === "observed" ? observed : kind);

    /** Each gesture's name. */
    const EDIT_LABELS: { readonly [G in FlowchartGesture]: string } = {
        addLane: `Add ${lane}`,
        renameLane: `Rename ${lane}`,
        deleteLane: `Delete ${lane}`,
        addState: `Add ${state}`,
        renameState: `Rename ${state}`,
        moveStates: `Move ${states}`,
        deleteStates: `Delete ${states}`,
        duplicateState: `Duplicate ${state}`,
        connect: `Connect ${states}`,
        editLink: `Edit ${transition}`,
        deleteLink: `Delete ${transition}`,
        deleteDecision: `Delete ${decision}`,
        dropCard: "Drop card",
        form: "Edit fields",
        details: "Edit details",
        rekey: "Change key",
    };

    /** The three hints nothing selected shows, where the flowchart edits. */
    const HINTS = {
        1: `Click ${aNoun(state)}, ${aNoun(transition)}, ${aNoun(decision)} or ${aNoun(lane)}'s header to see its details here.`,
        2: `Shift-click ${states} to select several, and move or delete them together.`,
        3: `Double-click ${aNoun(state)} or ${aNoun(lane)}'s header to rename it where it stands.`,
    } as const;

    /** The three hints, where it edits nothing. */
    const READ_HINTS = {
        1: HINTS[1],
        2: `Shift-click ${states} to select several, and see how many there are.`,
        3: `Find picks ${aNoun(state)} by its key or label, even one the rail hides.`,
    } as const;

    /** One row of each kind, as a sentence names it. */
    const ONE: { readonly [S in FlowchartSort]: string } = { states: state, transitions: transition, lanes: lane, decisions: decision };

    /** What a card lands on, as a refusal names it. */
    const LANDS: { readonly [L in FlowchartLandsWord]: string } = {
        lane: `onto ${aNoun(lane)}`, state: `onto ${aNoun(state)}`, transition: `onto ${aNoun(transition)}`,
        header: `onto ${aNoun(lane)}'s header`, gap: `between the ${lanes}`, decision: `onto ${aNoun(decision)}`,
    };

    /** Each kind's tab, when its author names none: the states' cards are the Steps, the others' each its kind's plural. */
    const TABS: { readonly [T in Exclude<FlowchartLibraryTabWord, "tab">]: string } = {
        states: "Steps", transitions: kindPlural(nouns.transition), lanes: kindPlural(nouns.lane),
    };

    /** Each kind's tab, empty: what it has no card to drag onto. */
    const EMPTY_HINTS: { readonly [T in Exclude<FlowchartLibraryTabWord, "tab">]: string } = {
        states: `No ${state} card to drag onto ${aNoun(lane)}.`,
        transitions: `No ${transition} card to drag onto ${aNoun(transition)}.`,
        lanes: `No ${lane} card to drag between the ${lanes}.`,
    };

    /** Each chip's words. */
    const CHIPS: { readonly [C in FlowchartChipWord]: string } = { pending: "Pending", new: "New", noRow: `No ${state} row`, unresolved: "Unresolved" };

    return {
        ...editingMessages,
        ...pagedLoadingMessages,
        // A kind read again as the rail moves: the canvas updates in place, and the line says so.
        lineFiltering: ({ noun }) => [`Updating ${noun}…`],
        lineShort: ({ kind }) => (kind === "filtering" ? "Updating…" : pagedLoadingMessages.lineShort({ kind })),
        newLane: ({ count }) => `${nouns.lane} ${count}`,
        laneWord: () => nouns.lane,
        addLane: () => `Add ${lane}`,
        lanePager: ({ range, total }) => `${kindPlural(nouns.lane)} ${range} of ${total}`,
        laneStep: ({ more }) => (more ? `Next ${lane}` : `Previous ${lane}`),
        stateWord: () => state,
        deleteLane: ({ label }) => `Delete ${lane} ${label}`,
        laneHoldsStates: ({ n, count, name }) => `Move its ${count} ${counted(n, name ?? state)} first`,
        laneLabelField: () => `${nouns.lane} label`,
        stateKeyField: () => `${nouns.state} key`,
        stateKeyPlaceholder: () => "KEY",
        stateKeyTaken: ({ key }) => `${capital(aNoun(state))} is keyed ${quoted(key)} already`,
        stateLabelField: () => `${nouns.state} label`,
        stateLabelPlaceholder: () => "Label",
        editLabel: ({ gesture }) => EDIT_LABELS[gesture],
        noLaneBand: () => `No ${lane}`,
        noStateRow: () => `No ${state} row`,
        findLabel: () => `Find ${state}`,
        findNoMatches: () => "No matches",
        orientationLabel: () => "Orientation",
        viewLabel: () => "View",
        footerLinks: ({ n }) => plural(n, transition, transitions),
        footerSplit: ({ planned: p, observed: o, unresolved }) =>
            `${p} ${planned} · ${o} ${observed}${unresolved === undefined ? "" : ` · ${unresolved} unresolved`}`,
        footerPending: ({ count }) => `${count} pending`,
        footerSaved: ({ when }) => `Saved ${when}`,
        libraryPane: () => "Library",
        libraryTab: ({ tab }) => TABS[tab],
        libraryEmpty: ({ tab, name }) => (tab === "tab" ? `Nothing in ${name}` : "No cards"),
        libraryEmptyHint: ({ tab, name }) => (tab === "tab" ? `${name} lists nothing yet.` : EMPTY_HINTS[tab]),
        libraryNarrowed: ({ name }) => `The rail hides every card in ${name}`,
        libraryNarrowedHint: () => "Change or clear the rail's choices to see more cards.",
        libraryNoun: ({ n }) => plural(n, "card", "cards"),
        libraryGroupBy: () => "Group",
        dropPlace: (p) => {
            switch (p.place) {
                case "after": return p.lane === undefined ? `after ${p.after}` : `after ${p.after} in ${p.lane}`;
                case "start": return p.lane === undefined ? "at the start" : `at the start of ${p.lane}`;
                case "in": return p.lane === undefined ? "at the start" : `in ${p.lane}`;
                case "before": return `before ${p.lane}`;
                case "end": return `at the end of the ${lanes}`;
            }
        },
        dropPlaceName: (p) => {
            switch (p.place) {
                case "after": return p.lane === undefined ? `the row after ${p.after}` : `${p.lane}, after ${p.after}`;
                case "start": return p.lane === undefined ? "the start" : `the start of ${p.lane}`;
                case "in": return p.lane ?? "the start";
                case "before": return `the gap before ${p.lane}`;
                case "end": return `the end of the ${lanes}`;
            }
        },
        dropWhat: (p) => {
            switch (p.what) {
                case "state": return p.key;
                case "transition": return `${p.from} → ${p.to}`;
                case "header": return `${lane} ${p.lane}`;
                case "decision": return `${decision} ${p.label}`;
            }
        },
        dropOnto: ({ what }) => `onto ${what}`,
        dropRefused: (p) => (p.why === "onto" ? `Drop ${LANDS[p.lands]}`
            : p.why === "readOnly" ? `${capital(kindPlural(p.kind))} are read only` : `${capital(kindPlural(p.kind))} take no edit now`),
        dropCanvas: () => "the canvas",
        dropLabel: ({ card, onto }) => `Drop ${card} on ${onto}`,
        inspectorPane: () => "Inspector",
        inspectorTab: ({ tab }) => (tab === "details" ? "Details" : "Issues"),
        inspectorWhat: (p) => {
            switch (p.what) {
                case "row": return `${p.kind} · ${p.name}`;
                case "several": return `${p.count} ${counted(p.n, p.name)}`;
                case "flowchart": return "Flowchart";
            }
        },
        inspectorField: (p) => (p.field === "moveTo" ? `Move to ${p.name}` : FIELDS[p.field]),
        inspectorKeyHelp: () => "A new row's key can change until it is saved; what names it follows the change.",
        inspectorChoice: ({ key, label }) => `${key} · ${label}`,
        inspectorSection: ({ section, count, name }) => {
            switch (section) {
                case "transitions": return `${kindPlural(name)} · ${count}`;
                case "governs": return `${kindPlural(name)} it governs · ${count}`;
                case "evidence": return "Evidence";
                default: return `${GROUPS[section]} · ${count}`;
            }
        },
        inspectorLinkKind: ({ kind, decision: named, badge }) => [kindWord(kind), named, badge].filter((part) => part !== undefined).join(" · "),
        inspectorChip: ({ state: chip }) => CHIPS[chip],
        inspectorAction: ({ action }) => (action === "duplicate" ? "Duplicate" : "Delete"),
        inspectorKeyRefused: ({ name, key, why }) => (why === "empty" ? `Every ${name} needs a key` : `${capital(aNoun(name))} is keyed ${quoted(key)} already`),
        inspectorLaneStates: ({ n, count, name }) => (n === 0 ? `Holds no ${name}` : `Holds ${count} ${counted(n, name)}`),
        inspectorNoRow: ({ n, count, key, state: one, transition: link }) => `Named by ${count} ${counted(n, link)}, and e3 holds no ${one} keyed ${quoted(key)}`,
        inspectorCount: ({ name, n }) => counted(n, name),
        inspectorSplit: ({ planned: p, observed: o, unresolved }) => `${p} ${planned} · ${o} ${observed} · ${unresolved} unresolved`,
        inspectorSaved: ({ name, when, by }) => `${kindPlural(name)} saved ${when}${by === undefined ? "" : ` by ${by}`}`,
        inspectorHint: ({ n, edits }) => (edits ? HINTS[n] : READ_HINTS[n]),
        inspectorHintTouch: () => `Tap ${aNoun(state)}, ${aNoun(transition)}, ${aNoun(decision)} or ${aNoun(lane)}'s header to see its details here.`,
        inspectorNoIssues: ({ part }) => (part === "title" ? "No issues" : `Every end, ${lane} and ${decision} resolves, and nothing waits on Save.`),
        noDecision: () => `No ${decision}`,
        issueWhere: ({ kind, name }) => (kind === undefined ? name : `${kind} · ${name}`),
        issueText: (p) => {
            switch (p.issue) {
                case "end": return p.missing.length === 1
                    ? `${p.link} names ${p.missing[0]}, and e3 holds no ${state} of that key`
                    : `${p.link} names ${joinedWords(p.missing, "and")}, and e3 holds no ${state} of either key`;
                case "lane": return p.lane === undefined ? `${p.state} names no ${lane}` : `${p.state} names the ${lane} ${p.lane}, which the flowchart has none of`;
                case "decision": return `${p.link} names the ${decision} ${p.decision}, which the flowchart has none of`;
                case "counts": return `${p.read} of ${p.name} has counts no bin holds`;
                case "bins": return binsRefused(p.read, p.refusal);
                case "waiting": return `${p.name} has an unsaved change the rail hides: Save writes it with the rest`;
                case "ready": return p.message;
                case "save": return p.message;
            }
        },
        kindLabel: ({ kind }) => (kind === "planned" ? nouns.planned : nouns.observed),
        legendDecision: () => `${nouns.decision} trigger`,
        legendInPlace: () => `In-place ${transition}`,
        kindNoun: ({ sort, n }) => (n === 1 ? ONE[sort] : kindPlural(ONE[sort])),
        cardsNoun: ({ tab }) => `${ONE[tab]} cards`,
        hiddenByFilters: () => "hidden by the rail",
        hiddenBy: ({ filters, also }) => hiddenByText(filters, also),
        dimmedByFilters: () => "dimmed by the rail",
        dimmedBy: ({ filters, also }) => hiddenByText(filters, also, "dimmed"),
        keyHeld: ({ sort, key }) => `${capital(aNoun(ONE[sort]))} is keyed ${quoted(key)} already`,
        keyChecking: ({ key }) => `Checking the key ${quoted(key)}`,
        hiddenUncleared: () => "The rail's choices hiding it could not be cleared",
        sourceUnavailable: ({ name }) => `${capital(name)} results unavailable`,
        sourceChanged: ({ name }) => `${capital(name)} results changed; retry the narrowing.`,
        sourceFailed: ({ name }) => `Could not load ${name} results`,
    };
}

/** The English table, in the Flowchart's own words. */
export const flowchartMessages: FlowchartMessages = flowchartMessagesOf(DEFAULT_FLOWCHART_NOUNS);

/** The words a flowchart speaks: its message table, and its locale's formatters. */
export interface FlowchartWords extends EditingWords {
    /** The message table in effect. */
    m: FlowchartMessages;
}
