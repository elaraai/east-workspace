/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's words (#1246–#1250) — its Flows tab's, its "+ New flow"
 * popover's, its empty state's and its banner's; its gestures' — "+ LANE", a
 * lane's ×, the "+ STATE" ghost, each gesture's name in the history, the
 * issue two of one key raise — its footer's changes waiting on Save, its
 * library pane's — the pane's name, a template tab's name when its author
 * gives none, each data tab's empty state, its search's noun and its grouping
 * — its drops' (#1249): where a card lands, what it sets its fields on, why
 * it is refused, and a drop's name in the history — and its inspector's
 * (#1250): the pane and its tabs, what it shows in its head and on its rail,
 * each field's label and help line, its sections, chips, gestures, counts and
 * hints, why an edit is refused, and each issue's words — beside the editing
 * session's own (`EditingMessages`), which its history item and banners
 * speak, as the Sheet's and the query builder's tables carry them. A host
 * translates the flowchart where it translates the session.
 *
 * @packageDocumentation
 */

import { StringType, printFor } from "@elaraai/east";
import { editingMessages, type EditingMessages, type EditingWords } from "@elaraai/east-ui-components";
import type { FlowKeyKind, FlowchartEdit } from "./edits.js";
import type { FlowchartIssueWord } from "./issues.js";

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

/** What the inspector shows (#1250): in its head, on its rail, and where an issue is. */
export type FlowchartInspectWord =
    | { readonly what: "state"; readonly key: string }
    | { readonly what: "transition"; readonly from: string; readonly to: string }
    | { readonly what: "decision"; readonly letter: string }
    | { readonly what: "lane"; readonly label: string }
    | { readonly what: "states"; readonly n: number; readonly count: string }
    | { readonly what: "flow" };

/** A field the inspector's form shows (#1250), by its name: a state's, a transition's, a decision's, a lane's, the flow's, a transition's evidence's, and the several states' lane. */
export type FlowchartFieldWord =
    | "key" | "label" | "lane" | "members" | "notes"
    | "from" | "to" | "kind" | "trigger"
    | "letter" | "owner" | "queue" | "outcomes"
    | "name" | "description"
    | "volume" | "count" | "measured"
    | "moveTo";

/** A field's line under it (#1250): what a new key, a new name, or a change of it does. */
export type FlowchartHelpWord = "stateKey" | "laneKey" | "decisionKey" | "linkKey" | "flowName" | "moveTo";

/** Why an inspector's edit is refused (#1250), in the footer: a key or a name left empty, or a name the flowchart holds already. */
export type FlowchartRefusedWord =
    | { readonly why: "emptyKey"; readonly what: FlowKeyKind }
    | { readonly why: "emptyName" }
    | { readonly why: "nameTaken"; readonly name: string };

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
    /** The inspector pane's name: its rail's label and its toggle's words (#1250). */
    inspectorPane: () => string;
    /** The inspector's tabs (FB35): `Details`, `Issues`. */
    inspectorTab: (p: { tab: "details" | "issues" }) => string;
    /** What the inspector shows, in its head and on its rail — `State · SRT`, `Transition · SRT → LDD`, `Decision · R`, `Lane · Sort`, `3 states`, `Flow`. */
    inspectorWhat: (p: FlowchartInspectWord) => string;
    /** A field's label in the inspector's form — `Key`, `Lane`, `Decision`. */
    inspectorField: (p: { field: FlowchartFieldWord }) => string;
    /** A field's line under it — `A new key moves its states with it.` */
    inspectorHelp: (p: { help: FlowchartHelpWord }) => string;
    /** A transition's kind, in its select: `Planned`, `Observed`. */
    kindLabel: (p: { kind: "planned" | "observed" }) => string;
    /** A transition's decision when it has none, first in its select. */
    noDecision: () => string;
    /** A section's head in Details — `Transitions · 3`, `Evidence`. */
    inspectorSection: (p: { section: "transitions" | "governs" | "evidence"; n: number; count: string }) => string;
    /** A transition's line under its ends in a list — `observed · route`, `unresolved`. */
    inspectorLinkKind: (p: { kind: "planned" | "observed" | "unresolved"; decision: string | undefined }) => string;
    /** A row's chip in its head: drafted since the record held it, new, a flow drafted as deleted, a state no row stands for. */
    inspectorChip: (p: { state: "pending" | "new" | "deleted" | "noRow" }) => string;
    /** A gesture's button in Details — `Duplicate`, `Delete`. */
    inspectorAction: (p: { action: "duplicate" | "delete" }) => string;
    /** How many states a lane holds — `Holds 3 states`. */
    inspectorLaneStates: (p: { n: number; count: string }) => string;
    /** A state no row of the flow stands for — `Named by 2 transitions, and the flow has no state of this key`. */
    inspectorNoRow: (p: { n: number; count: string }) => string;
    /** What one of the open flow's counts counts — `Lanes`, `States`, `Transitions`, `Decisions`. */
    inspectorCount: (p: { what: "lanes" | "states" | "transitions" | "decisions"; n: number }) => string;
    /** The open flow's transitions, split — `8 planned · 2 observed · 1 unresolved`; the counts printed in the app's locale. */
    inspectorSplit: (p: { planned: string; observed: string; unresolved: string }) => string;
    /** A record's last save, and who made it — `Saved 14:02 by planner`; `Not saved yet` with none. */
    inspectorSaved: (p: { when: string | undefined; by: string | undefined }) => string;
    /** One of the three hints nothing selected shows. */
    inspectorHint: (p: { n: 1 | 2 | 3 }) => string;
    /** The Issues tab with none: its title, and the line under it. */
    inspectorNoIssues: (p: { part: "title" | "hint" }) => string;
    /** An issue of the open flow (FB37) — `SCN → GONE names GONE, which the flow has no state of`. */
    issueText: (p: FlowchartIssueWord) => string;
    /** Details with no flow open: its title, and the line under it. */
    inspectorNoFlow: (p: { part: "title" | "hint" }) => string;
    /** A flow drafted as deleted, in main and in Details: its title — `Returns is deleted` — and the line under it. */
    flowDeleted: (p: { part: "title" | "hint"; name: string }) => string;
    /** A duplicated flow's name — `Inbound parcels copy`, `Inbound parcels copy 2`. */
    flowCopy: (p: { name: string; n: number }) => string;
    /** Why an inspector's edit was refused, in the footer — `A state needs a key`, `Returns is already a flow here`. */
    inspectorRefused: (p: FlowchartRefusedWord) => string;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** A key as the issue quotes it: East's printing of the string. */
const quoted = printFor(StringType);

/** Each gesture's name. */
const EDIT_LABELS: { readonly [E in FlowchartEdit]: string } = {
    addLane: "Add lane",
    renameLane: "Rename lane",
    deleteLane: "Delete lane",
    editLane: "Edit lane",
    addState: "Add state",
    editState: "Edit state",
    moveState: "Move state",
    deleteState: "Delete state",
    duplicateState: "Duplicate state",
    moveStates: "Move states",
    deleteStates: "Delete states",
    connect: "Connect states",
    deleteLink: "Delete transition",
    editTransition: "Edit transition",
    deleteDecision: "Delete decision",
    editDecision: "Edit decision",
    renameFlow: "Rename flow",
    describeFlow: "Describe flow",
    duplicateFlow: "Duplicate flow",
    deleteFlow: "Delete flow",
};

/** Each field's label in the inspector's form. */
const FIELDS: { readonly [F in FlowchartFieldWord]: string } = {
    key: "Key", label: "Label", lane: "Lane", members: "Members", notes: "Notes",
    from: "From", to: "To", kind: "Kind", trigger: "Decision",
    letter: "Letter", owner: "Owner", queue: "Queue", outcomes: "Outcomes",
    name: "Name", description: "Description",
    volume: "Volume", count: "Count", measured: "Measured",
    moveTo: "Move to lane",
};

/** Each field's line under it. */
const HELPS: { readonly [H in FlowchartHelpWord]: string } = {
    stateKey: "A new key renames it on its transitions and the decisions' queues.",
    laneKey: "A new key moves its states with it.",
    decisionKey: "A new key renames it on the transitions it governs.",
    linkKey: "Left empty, it goes by its ends.",
    flowName: "A new name renames the flow when it is saved.",
    moveTo: "Every state selected moves to the lane.",
};

/** The three hints nothing selected shows. */
const HINTS = {
    1: "Click a state, a transition, a decision or a lane's header to see its details here.",
    2: "Shift-click states to select several, and move or delete them together.",
    3: "Double-click a state or a lane's header to rename it where it stands.",
} as const;

/** What a row of each kind is called, one of them. */
const ROW: { readonly [K in FlowKeyKind]: string } = { lane: "lane", state: "state", transition: "transition", decision: "decision" };

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
    inspectorPane: () => "Inspector",
    inspectorTab: ({ tab }) => (tab === "details" ? "Details" : "Issues"),
    inspectorWhat: (p) => {
        switch (p.what) {
            case "state": return `State · ${p.key}`;
            case "transition": return `Transition · ${p.from} → ${p.to}`;
            case "decision": return `Decision · ${p.letter}`;
            case "lane": return `Lane · ${p.label}`;
            case "states": return `${p.count} ${plural(p.n, "state", "states")}`;
            case "flow": return "Flow";
        }
    },
    inspectorField: ({ field }) => FIELDS[field],
    inspectorHelp: ({ help }) => HELPS[help],
    kindLabel: ({ kind }) => (kind === "planned" ? "Planned" : "Observed"),
    noDecision: () => "No decision",
    inspectorSection: ({ section, count }) => (section === "evidence" ? "Evidence"
        : section === "transitions" ? `Transitions · ${count}` : `Transitions it governs · ${count}`),
    inspectorLinkKind: ({ kind, decision }) => (decision === undefined ? kind : `${kind} · ${decision}`),
    inspectorChip: ({ state }) => ({ pending: "Pending", new: "New", deleted: "Deleted", noRow: "No state row" })[state],
    inspectorAction: ({ action }) => (action === "duplicate" ? "Duplicate" : "Delete"),
    inspectorLaneStates: ({ n, count }) => (n === 0 ? "Holds no state" : `Holds ${count} ${plural(n, "state", "states")}`),
    inspectorNoRow: ({ n, count }) => `Named by ${count} ${plural(n, "transition", "transitions")}, and the flow has no state of this key`,
    inspectorCount: ({ what, n }) => ({
        lanes: plural(n, "Lane", "Lanes"), states: plural(n, "State", "States"),
        transitions: plural(n, "Transition", "Transitions"), decisions: plural(n, "Decision", "Decisions"),
    })[what],
    inspectorSplit: ({ planned, observed, unresolved }) => `${planned} planned · ${observed} observed · ${unresolved} unresolved`,
    inspectorSaved: ({ when, by }) => (when === undefined ? "Not saved yet" : by === undefined ? `Saved ${when}` : `Saved ${when} by ${by}`),
    inspectorHint: ({ n }) => HINTS[n],
    inspectorNoIssues: ({ part }) => (part === "title" ? "No issues" : "Every transition, state and decision of the flow resolves."),
    issueText: (p) => {
        switch (p.issue) {
            case "duplicate": return `Two ${ROWS[p.what]} are keyed ${quoted(p.key)}`;
            case "lane": return `${p.state} names the lane ${p.lane}, which the flow has none of`;
            case "end": return `${p.from} → ${p.to} names ${p.missing.join(" and ")}, which the flow has no state of`;
            case "queue": return `${p.decision}'s queue names ${p.state}, which the flow has no state of`;
            case "save": return p.message;
        }
    },
    inspectorNoFlow: ({ part }) => (part === "title" ? "No flow is open" : "Open a flow in the Flows tab, or start one."),
    flowDeleted: ({ part, name }) => (part === "title" ? `${name} is deleted` : "Save removes it; Undo brings it back."),
    flowCopy: ({ name, n }) => (n === 1 ? `${name} copy` : `${name} copy ${n}`),
    inspectorRefused: (p) => (p.why === "emptyKey" ? `A ${ROW[p.what]} needs a key`
        : p.why === "emptyName" ? "A flow needs a name" : `${p.name} is already a flow here`),
};

/** The words a flowchart speaks: its message table, and its locale's formatters. */
export interface FlowchartWords extends EditingWords {
    /** The message table in effect. */
    m: FlowchartMessages;
}
