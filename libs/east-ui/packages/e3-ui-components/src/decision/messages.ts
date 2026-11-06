/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The DecisionQueue's message table (`Decision Queue Spec.md` §10): the
 * editing session's words — the history item's and its banners', every
 * editable collection's (`EditingMessages`) — the footer's loading line over
 * the cases' source (`PagedLoadingMessages`), and the queue's own. The app's
 * words — a case's scope, title and summary, an option's label, a target's
 * name — are the payload's. English is the default; the frame hands it to its
 * parts as its words' `m`, as every builder's does.
 *
 * @packageDocumentation
 */

import { editingMessages, type EditingMessages, type Formatters } from "@elaraai/east-ui-components";
import { pagedLoadingMessages, type PagedLoadingMessages } from "../shared/loading.js";
import type { DecisionSection } from "./layout.js";

/** What a person decided, as the queue words it: the verdict's case. */
export type DecisionVerdictWord = "applied" | "overridden" | "deferred" | "handedOff";

/** Why a person overrode, as the queue words it: the reason's case. */
export type DecisionReasonWord = "context" | "data" | "priorities" | "other";

/** A person's answer, as the queue words it: the answer's case. */
export type DecisionAnswerWord = "yes" | "no" | "unsure";

/** The DecisionQueue's message table: numbers and values arrive formatted. */
export interface DecisionQueueMessages extends EditingMessages, PagedLoadingMessages {
    /** The toolbar's title — `Decisions`. */
    title: () => string;
    /** The cases, in the loading line's noun — `decisions`. */
    noun: () => string;
    /** The past-due count — `2 past due`; its narrow form `2 late`. */
    pastDue: (p: { n: string; narrow: boolean }) => string;
    /** A section's label — `Overdue`, `Due today`, `This week`, `Later`. */
    section: (p: { section: DecisionSection }) => string;
    /** A due case's words past its time — `35m late`, `2h late`, `3d late`. */
    late: (p: { amount: string; unit: "m" | "h" | "d" }) => string;
    /** A case's words before its time — `by 14:00`, `by Fri 13`. */
    by: (p: { when: string }) => string;
    /** The chip beside the summary — `Proposed`, or `Modified` once the viewer has chosen or edited. */
    chip: (p: { modified: boolean }) => string;
    /** A card's status — `Needs answer`, `Blocked`, `Handoff`, `Stale`. */
    status: (p: { status: "needsAnswer" | "blocked" | "handoff" | "stale" }) => string;
    /** The options' label — `Options · 3`. */
    options: (p: { n: string }) => string;
    /** A refused option's line — `refused · over the weekly cap`. */
    refused: (p: { reason: string }) => string;
    /** The change's label — `Change`. */
    change: () => string;
    /** The figures' labels — `If wrong`, `Confidence`. */
    figure: (p: { figure: "ifWrong" | "confidence" }) => string;
    /** A figure with none to show — `no data`. */
    noData: () => string;
    /** The value's sub line — `before your edits`, `proposal +$8k`, `only option`, `+$2k vs next best`. */
    valueSub: (p: { kind: "edited" } | { kind: "proposal"; value: string } | { kind: "only" } | { kind: "next"; difference: string }) => string;
    /** Your call's word — `Needs your answer`, `Blocked`, `Handoff`, `Answered`. */
    call: (p: { state: "needs" | "blocked" | "handoff" | "answered" }) => string;
    /** Your call's help — what the answer does. */
    callHelp: (p: { state: "needs" | "blocked" | "handoff" | "answered" }) => string;
    /** An answer — `Yes`, `No`, `Don't know`. */
    answer: (p: { answer: DecisionAnswerWord }) => string;
    /** The warning box's word — `Warning`. */
    warning: () => string;
    /** The case's recommendation names no option of its own (§12): said in its warning box. */
    malformed: () => string;
    /** Why's toggle — `Why`. */
    why: () => string;
    /** The note's link — `Add a note`. */
    addNote: () => string;
    /** The note's placeholder. */
    notePlaceholder: () => string;
    /** The note's accessible name — `Note`. */
    note: () => string;
    /** The actions' accessible name — `Decide`. */
    actions: () => string;
    /** An action — `Defer`, `Hand off`, `Override…`, `Modify`, `Apply`, `Apply with edits`. */
    action: (p: { action: "defer" | "handOff" | "override" | "modify" | "apply" | "applyEdits" }) => string;
    /** Why Apply is off — its tooltip. */
    applyOff: (p: { why: "needs" | "blocked" | "handoff" | "stale" | "reading" | "failed" | "malformed" | "unready" }) => string;
    /** The Edit panel's title — `Edit`, or `Your decision` under Override. */
    editTitle: (p: { override: boolean }) => string;
    /** The Edit panel's meta — `drafts on the proposal`, `2 changed · drafts on the proposal`, or under Override what it sets. */
    editMeta: (p: { changed: string | undefined; override: boolean }) => string;
    /** Reset all — the Edit panel's. */
    resetAll: () => string;
    /** Keep as it is — a changed row's. */
    keepAsIs: () => string;
    /** A row the change removes, in the Edit panel, which has no form for it — `R-14 · removed`. */
    removedRow: (p: { name: string }) => string;
    /** A changed field's reset — `Reset Days to the proposal`. */
    resetField: (p: { field: string }) => string;
    /** The Override panel's title — `Why override`. */
    whyOverride: () => string;
    /** An override's reason — `Missing context`, `Data is wrong`, `Priorities changed`, `Other`. */
    reason: (p: { reason: DecisionReasonWord }) => string;
    /** The override note's placeholder — Other's, or the optional note's. */
    overridePlaceholder: (p: { other: boolean }) => string;
    /** The override note's accessible name — `Override note`. */
    overrideNote: () => string;
    /** Cancel — the Override panel's. */
    cancel: () => string;
    /** The Override panel's action — `Override case`. */
    overrideCase: () => string;
    /** A receipt's verdict — `Applied`, `Overridden`, `Deferred`, `Handed off`. */
    verdict: (p: { verdict: DecisionVerdictWord }) => string;
    /** A receipt's, and the batch banner's, Undo. */
    undo: () => string;
    /** The batch banner — `Applied` and `3 routine cases`. */
    batch: (p: { n: string }) => { readonly title: string; readonly description: string };
    /** The Routine band's toggle — `Routine`. */
    routine: () => string;
    /** The Routine band's total — `+$3.4k together`. */
    together: (p: { total: string }) => string;
    /** The Routine band's action — `Apply all 3`. */
    applyAll: (p: { n: string }) => string;
    /** The empty state: its title and its two lines. */
    empty: () => { readonly title: string; readonly undo: string; readonly next: string };
    /** Past the cap — `20,000 decisions waiting — narrow the queue to see them`. */
    tooMany: (p: { n: string }) => string;
    /** A failed read of the cases: the banner's title. */
    readFailed: () => string;
    /** A verdict the history could not record, its records read or saved still: the banner's title and line. */
    unrecorded: () => { readonly title: string; readonly description: string };
    /** The verdicts' session, as its banners name it — `Verdicts: Save stopped — …`. */
    verdictsSession: () => string;
    /** A guessed cell's title — `conf 0.69 · a guess`. */
    guess: (p: { confidence: string }) => string;
    /** A batch step's label in the history — `Apply 3 routine cases`. */
    batchStep: (p: { n: string }) => string;
    /** A verdict step's label in the history — `Apply: Move 3 night shifts`. */
    verdictStep: (p: { verdict: DecisionVerdictWord; title: string }) => string;
}

const SECTIONS: Record<DecisionSection, string> = { overdue: "Overdue", today: "Due today", week: "This week", later: "Later" };
const STATUSES = { needsAnswer: "Needs answer", blocked: "Blocked", handoff: "Handoff", stale: "Stale" } as const;
const CALLS = { needs: "Needs your answer", blocked: "Blocked", handoff: "Handoff", answered: "Answered" } as const;
const HELP = {
    needs: "Apply waits for this answer. The model can't see it.",
    blocked: "Your answer contradicts the proposal. Override it or defer the case.",
    handoff: "Nobody here can answer yet. Hand the case on.",
    answered: "Recorded with the verdict.",
} as const;
const ANSWERS = { yes: "Yes", no: "No", unsure: "Don't know" } as const;
const ACTIONS = { defer: "Defer", handOff: "Hand off", override: "Override…", modify: "Modify", apply: "Apply", applyEdits: "Apply with edits" } as const;
const APPLY_OFF = {
    needs: "Answer the question above to apply.",
    blocked: "Blocked by your answer · override or defer.",
    handoff: "Handoff · defer hands the case on.",
    stale: "The rows moved since the proposal · override or defer.",
    reading: "Reading the rows this change touches…",
    failed: "Couldn't read the rows this change touches",
    malformed: "The recommendation names no option of this case · override or defer.",
    unready: "The edits don't pass their checks yet.",
} as const;
const REASONS = { context: "Missing context", data: "Data is wrong", priorities: "Priorities changed", other: "Other" } as const;
const VERDICTS = { applied: "Applied", overridden: "Overridden", deferred: "Deferred", handedOff: "Handed off" } as const;

/** The English table — the default. */
export const decisionQueueMessages: DecisionQueueMessages = {
    ...editingMessages,
    ...pagedLoadingMessages,
    title: () => "Decisions",
    noun: () => "decisions",
    pastDue: ({ n, narrow }) => (narrow ? `${n} late` : `${n} past due`),
    section: ({ section }) => SECTIONS[section],
    late: ({ amount, unit }) => `${amount}${unit} late`,
    by: ({ when }) => `by ${when}`,
    chip: ({ modified }) => (modified ? "Modified" : "Proposed"),
    status: ({ status }) => STATUSES[status],
    options: ({ n }) => `Options · ${n}`,
    refused: ({ reason }) => `refused · ${reason}`,
    change: () => "Change",
    figure: ({ figure }) => (figure === "ifWrong" ? "If wrong" : "Confidence"),
    noData: () => "no data",
    valueSub: (p) => (p.kind === "edited" ? "before your edits" : p.kind === "proposal" ? `proposal ${p.value}` : p.kind === "only" ? "only option" : `${p.difference} vs next best`),
    call: ({ state }) => CALLS[state],
    callHelp: ({ state }) => HELP[state],
    answer: ({ answer }) => ANSWERS[answer],
    warning: () => "Warning",
    malformed: () => "The recommendation names no option of this case: it can be deferred or overridden, not applied.",
    why: () => "Why",
    addNote: () => "Add a note",
    notePlaceholder: () => "What you know that the model can't see",
    note: () => "Note",
    actions: () => "Decide",
    action: ({ action }) => ACTIONS[action],
    applyOff: ({ why }) => APPLY_OFF[why],
    editTitle: ({ override }) => (override ? "Your decision" : "Edit"),
    editMeta: ({ changed, override }) => (override ? "set what happens instead · the model learns from it"
        : changed === undefined ? "drafts on the proposal" : `${changed} changed · drafts on the proposal`),
    resetAll: () => "Reset all",
    keepAsIs: () => "Keep as it is",
    removedRow: ({ name }) => `${name} · removed`,
    resetField: ({ field }) => `Reset ${field} to the proposal`,
    whyOverride: () => "Why override",
    reason: ({ reason }) => REASONS[reason],
    overridePlaceholder: ({ other }) => (other ? "Say what the model got wrong" : "Add a note (optional)"),
    overrideNote: () => "Override note",
    cancel: () => "Cancel",
    overrideCase: () => "Override case",
    verdict: ({ verdict }) => VERDICTS[verdict],
    undo: () => "Undo",
    batch: ({ n }) => ({ title: "Applied", description: `${n} routine cases` }),
    routine: () => "Routine",
    together: ({ total }) => `${total} together`,
    applyAll: ({ n }) => `Apply all ${n}`,
    empty: () => ({ title: "Nothing waiting", undo: "Undo brings the last verdict back", next: "New cases arrive with the next run" }),
    tooMany: ({ n }) => `${n} decisions waiting — narrow the queue to see them`,
    readFailed: () => "Couldn't read decisions",
    unrecorded: () => ({ title: "Verdict not recorded", description: "Its records are being read or saved — try again in a moment." }),
    verdictsSession: () => "Verdicts",
    guess: ({ confidence }) => `conf ${confidence} · a guess`,
    batchStep: ({ n }) => `Apply ${n} routine cases`,
    verdictStep: ({ verdict, title }) => `${VERDICTS[verdict]}: ${title}`,
};

/** The words the queue speaks: its message table, and its locale's formatters. */
export interface DecisionQueueWords extends Formatters {
    /** The message table in effect. */
    m: DecisionQueueMessages;
}
