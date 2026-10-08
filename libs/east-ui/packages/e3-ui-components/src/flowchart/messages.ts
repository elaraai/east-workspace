/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's words (#1246, #1247) — its Flows tab's, its "+ New flow"
 * popover's, its empty state's and its banner's; its gestures' — "+ LANE", a
 * lane's ×, the "+ STATE" ghost, each gesture's name in the history, the
 * issue two of one key raise — and its footer's changes waiting on Save —
 * beside the editing session's own (`EditingMessages`), which its history
 * item and banners speak, as the Sheet's and the query builder's tables carry
 * them. A host translates the flowchart where it translates the session.
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
    /**
     * The banner while `flow` names a flow the flowchart doesn't hold (FB42):
     * the name asked for, and the flow shown in its place, when there is one —
     * `Gone isn't a flow here — showing Inbound parcels`.
     */
    flowMissing: (p: { name: string; shown: string | undefined }) => string;
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
    flowMissing: ({ name, shown }) => (shown === undefined ? `${name} isn't a flow here` : `${name} isn't a flow here — showing ${shown}`),
};

/** The words a flowchart speaks: its message table, and its locale's formatters. */
export interface FlowchartWords extends EditingWords {
    /** The message table in effect. */
    m: FlowchartMessages;
}
