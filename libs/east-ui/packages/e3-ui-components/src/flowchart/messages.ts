/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's words (#1246–#1249) — its Flows tab's, its "+ New flow"
 * popover's, its empty state's and its banner's; its gestures' — "+ LANE", a
 * lane's ×, the "+ STATE" ghost, each gesture's name in the history, the
 * issue two of one key raise — its footer's changes waiting on Save, its
 * library pane's — the pane's name, a template tab's name when its author
 * gives none, each data tab's empty state, its search's noun and its grouping
 * — and its drops' (#1249): where a card lands, what it sets its fields on,
 * why it is refused, and a drop's name in the history — beside the editing
 * session's own (`EditingMessages`), which its history item and banners
 * speak, as the Sheet's and the query builder's tables carry them. A host
 * translates the flowchart where it translates the session.
 *
 * @packageDocumentation
 */

import { StringType, printFor } from "@elaraai/east";
import { editingMessages, type EditingMessages, type EditingWords } from "@elaraai/east-ui-components";
import type { FlowKeyKind, FlowchartEdit } from "./edits.js";

/** A count as a message takes it: the number, for its plural, and the number as the locale prints it. */
export interface FlowchartCount {
    /** The number. */
    readonly n: number;
    /** The number, printed in the app's locale. */
    readonly count: string;
}

/** A tab of the library pane that reads rows of its own (#1248): the state templates, the transition templates, or one of the author's. */
export type FlowchartLibraryTabWord = "states" | "transitions" | "tab";

/** What a library card lands on (#1249): a state template a lane; a transition template a transition; an author's card a state, a transition, a lane's header or a decision's diamond, as its drop's type names. */
export type FlowchartLandsWord = "lane" | "state" | "transition" | "header" | "decision";

/** Where a dropped state lands in its lane (#1249): after the state above it, at the start of a lane holding states, or in a lane holding none. */
export type FlowchartDropPlaceWord =
    | { readonly place: "after"; readonly lane: string; readonly after: string }
    | { readonly place: "start" | "in"; readonly lane: string };

/** What a dropped card sets its fields on, as its words name it (#1249): a state by its key, a transition by its ends, a lane by its name, a decision by its label. */
export type FlowchartDropWhatWord =
    | { readonly what: "state"; readonly key: string }
    | { readonly what: "transition"; readonly from: string; readonly to: string }
    | { readonly what: "header"; readonly lane: string }
    | { readonly what: "decision"; readonly label: string };

/** Why a drop is refused (#1249): not onto what the card lands on; a flowchart that edits nothing; a session taking no gesture now; no flow open. */
export type FlowchartDropRefusalWord =
    | { readonly why: "onto"; readonly lands: FlowchartLandsWord }
    | { readonly why: "readOnly" | "busy" | "noFlow" };

/** The Flowchart's message table: its own words, and the editing session's. */
export interface FlowchartMessages extends EditingMessages {
    /** The Flows tab's name. */
    flowsTab: () => string;
    /** What the Flows tab calls a flow — "Search 3 flows…". */
    flowNoun: (p: { n: number }) => string;
    /** A flow's counts, its card's line when it has no description — `4 lanes · 9 states · 11 transitions`. */
    flowCounts: (p: { lanes: FlowchartCount; states: FlowchartCount; transitions: FlowchartCount }) => string;
    /** The chip on a flow whose drafts are not yet saved. */
    flowPending: () => string;
    /** The empty state's title, over no flow. */
    flowsEmpty: () => string;
    /** The line under it: how a flow starts, when one can be started here. */
    flowsEmptyHint: (p: { canAdd: boolean }) => string;
    /** "+ New flow": its button, the popover's head, and the history's name for it. */
    newFlow: () => string;
    /** The name field's placeholder, and its accessible name. */
    flowName: () => string;
    /** The hint while the name is empty. */
    flowNameMissing: () => string;
    /** The field's error while the flowchart holds the name. */
    flowNameTaken: (p: { name: string }) => string;
    /** The popover's commit. */
    createFlow: () => string;
    /** The popover's cancel. */
    cancel: () => string;
    /** A new lane's label, by its number — `Lane 3`; a new flow's one lane is `Lane 1`. */
    newLane: (p: { n: number; count: string }) => string;
    /** "+ LANE": the word under its plus. */
    laneWord: () => string;
    /** "+ LANE"'s accessible name, and its tooltip. */
    addLane: () => string;
    /** The "+ STATE" ghost: the word beside its plus. */
    stateWord: () => string;
    /** A lane's ×: its accessible name, and its tooltip while it can delete — `Delete lane Sort`. */
    deleteLane: (p: { label: string }) => string;
    /** Why a lane's × is off (FB19): the states it holds — `Move its 3 states first`. */
    laneHoldsStates: (p: { n: number; count: string }) => string;
    /** A gesture's name in the history, and its Save's (FB17) — `Move state`. */
    editLabel: (p: { edit: FlowchartEdit }) => string;
    /** The issue two rows of one kind under one key raise, which holds Save off (FB22) — `Two states are keyed "SCN"`. */
    duplicateKey: (p: { what: FlowKeyKind; key: string }) => string;
    /** The footer's changes waiting on Save (FB10) — `3 pending`. */
    footerPending: (p: { n: number; count: string }) => string;
    /** The library pane's name: its rail's label and its toggle's words (#1248). */
    libraryPane: () => string;
    /** A template tab's name, when its author gives none — `States`, `Transitions` (#1248). */
    libraryTab: (p: { tab: Exclude<FlowchartLibraryTabWord, "tab"> }) => string;
    /** A data tab's empty state: its title — `No templates`, `Nothing in Owners` (FB28); `name` is an author's tab's. */
    libraryEmpty: (p: { tab: FlowchartLibraryTabWord; name: string }) => string;
    /** The line under it. */
    libraryEmptyHint: (p: { tab: FlowchartLibraryTabWord; name: string }) => string;
    /** What a data tab's search box counts its cards as — `template`, `templates`. */
    libraryNoun: (p: { tab: FlowchartLibraryTabWord; n: number }) => string;
    /** What a data tab's cards are grouped by: its grouping control's words. */
    libraryGroupBy: () => string;
    /**
     * The banner while `flow` names a flow the flowchart doesn't hold (FB42):
     * the name asked for, and the flow shown in its place, when there is one —
     * `Gone isn't a flow here — showing Inbound parcels`.
     */
    flowMissing: (p: { name: string; shown: string | undefined }) => string;
    /** Where a dropped state lands, as the ghost says it (#1249, FB31) — `after CH* in Sort`, `at the start of Sort`, `in Load`. */
    dropPlace: (p: FlowchartDropPlaceWord) => string;
    /** The same place, as a screen reader hears where a drag rests — `Sort, after CH*`. */
    dropPlaceName: (p: FlowchartDropPlaceWord) => string;
    /** What a dropped card sets its fields on, named (#1249, FB32, FB33) — `CH*`, `CH* → LDD`, `lane Sort`, `decision route`. */
    dropWhat: (p: FlowchartDropWhatWord) => string;
    /** What the ghost says over what a card sets its fields on — `onto CH* → LDD`. */
    dropOnto: (p: { what: string }) => string;
    /** Why a drop is refused where it rests — red on the ghost — and, for a card's ⏎, in the footer (#1249, FB31–FB34) — `Drop onto a transition`. */
    dropRefused: (p: FlowchartDropRefusalWord) => string;
    /** The canvas, as a screen reader hears it where a drop is refused. */
    dropCanvas: () => string;
    /** A drop's name in the history, and its Save's (#1249) — `Drop Held on Sort, after CH*`. */
    dropLabel: (p: { card: string; onto: string }) => string;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** A key as the issue quotes it: East's printing of the string. */
const quoted = printFor(StringType);

/** Each gesture's name. */
const EDIT_LABELS: { readonly [E in FlowchartEdit]: string } = {
    addLane: "Add lane",
    renameLane: "Rename lane",
    deleteLane: "Delete lane",
    addState: "Add state",
    editState: "Edit state",
    moveState: "Move state",
    deleteState: "Delete state",
    connect: "Connect states",
    deleteLink: "Delete transition",
    deleteDecision: "Delete decision",
};

/** What each kind of row is called, many of them. */
const ROWS: { readonly [K in FlowKeyKind]: string } = { lane: "lanes", state: "states", transition: "transitions", decision: "decisions" };

/** What a card lands on, as a refusal names it. */
const LANDS: { readonly [L in FlowchartLandsWord]: string } = { lane: "a lane", state: "a state", transition: "a transition", header: "a lane's header", decision: "a decision" };

/** Why a drop is refused where the card would land somewhere it can. */
const REFUSED: { readonly [W in Exclude<FlowchartDropRefusalWord["why"], "onto">]: string } = {
    readOnly: "The flowchart is read only",
    busy: "The flow takes no edit now",
    noFlow: "No flow is open",
};

/** The English table. */
export const flowchartMessages: FlowchartMessages = {
    ...editingMessages,
    flowsTab: () => "Flows",
    flowNoun: ({ n }) => plural(n, "flow", "flows"),
    flowCounts: ({ lanes, states, transitions }) => [
        `${lanes.count} ${plural(lanes.n, "lane", "lanes")}`,
        `${states.count} ${plural(states.n, "state", "states")}`,
        `${transitions.count} ${plural(transitions.n, "transition", "transitions")}`,
    ].join(" · "),
    flowPending: () => "Pending",
    flowsEmpty: () => "No flows",
    flowsEmptyHint: ({ canAdd }) => (canAdd ? "Name a flow to start one." : "There is no flow to show."),
    newFlow: () => "New flow",
    flowName: () => "Flow name",
    flowNameMissing: () => "Give the flow a name to create it.",
    flowNameTaken: ({ name }) => `${name} is already a flow here.`,
    createFlow: () => "Create flow",
    cancel: () => "Cancel",
    newLane: ({ count }) => `Lane ${count}`,
    laneWord: () => "Lane",
    addLane: () => "Add lane",
    stateWord: () => "state",
    deleteLane: ({ label }) => `Delete lane ${label}`,
    laneHoldsStates: ({ n, count }) => `Move its ${count} ${plural(n, "state", "states")} first`,
    editLabel: ({ edit }) => EDIT_LABELS[edit],
    duplicateKey: ({ what, key }) => `Two ${ROWS[what]} are keyed ${quoted(key)}`,
    footerPending: ({ count }) => `${count} pending`,
    libraryPane: () => "Library",
    libraryTab: ({ tab }) => (tab === "states" ? "States" : "Transitions"),
    libraryEmpty: ({ tab, name }) => (tab === "tab" ? `Nothing in ${name}` : "No templates"),
    libraryEmptyHint: ({ tab, name }) => (tab === "states" ? "No state template to drag onto a lane."
        : tab === "transitions" ? "No transition template to drag onto a transition."
            : `${name} lists nothing yet.`),
    libraryNoun: ({ tab, n }) => (tab === "tab" ? plural(n, "card", "cards") : plural(n, "template", "templates")),
    libraryGroupBy: () => "Group",
    flowMissing: ({ name, shown }) => (shown === undefined ? `${name} isn't a flow here` : `${name} isn't a flow here — showing ${shown}`),
    dropPlace: (p) => (p.place === "after" ? `after ${p.after} in ${p.lane}` : p.place === "start" ? `at the start of ${p.lane}` : `in ${p.lane}`),
    dropPlaceName: (p) => (p.place === "after" ? `${p.lane}, after ${p.after}` : p.place === "start" ? `the start of ${p.lane}` : p.lane),
    dropWhat: (p) => {
        switch (p.what) {
            case "state": return p.key;
            case "transition": return `${p.from} → ${p.to}`;
            case "header": return `lane ${p.lane}`;
            case "decision": return `decision ${p.label}`;
        }
    },
    dropOnto: ({ what }) => `onto ${what}`,
    dropRefused: (p) => (p.why === "onto" ? `Drop onto ${LANDS[p.lands]}` : REFUSED[p.why]),
    dropCanvas: () => "the canvas",
    dropLabel: ({ card, onto }) => `Drop ${card} on ${onto}`,
};

/** The words a flowchart speaks: its message table, and its locale's formatters. */
export interface FlowchartWords extends EditingWords {
    /** The message table in effect. */
    m: FlowchartMessages;
}
