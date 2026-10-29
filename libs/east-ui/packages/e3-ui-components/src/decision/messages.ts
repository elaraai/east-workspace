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
import type { LaneBreach, LaneVerb } from "./preview/lanes-model.js";

/** What a person decided, as the queue words it: the verdict's case. */
export type DecisionVerdictWord = "applied" | "overridden" | "deferred" | "handedOff";

/** Why a person overrode, as the queue words it: the reason's case. */
export type DecisionReasonWord = "context" | "data" | "priorities" | "other";

/** A person's answer, as the queue words it: the answer's case. */
export type DecisionAnswerWord = "yes" | "no" | "unsure";

/** One clause of a preview's sentence, worded: its names, shifts and days the builder's, `n` how many entries it moves. */
export type PreviewClauseWords =
    | { readonly kind: "move"; readonly from: string; readonly to: string; readonly what: string; readonly n: number; readonly days: string }
    | { readonly kind: "add" | "remove"; readonly who: string; readonly what: string; readonly n: number; readonly days: string }
    | { readonly kind: "reschedule"; readonly who: string; readonly what: string; readonly when: string; readonly toWhat: string; readonly toWhen: string }
    | { readonly kind: "change"; readonly who: string; readonly what: string; readonly when: string };

/**
 * One clause of a lanes preview's sentence, worded: an event's title, the lanes' names and its times the builder's —
 * moved to another lane, along its own, added, taken off or changed — what it overlapped where it was, which the change
 * clears, what it does where it moves or is added — runs there, is held in a resource, or waits — and what it breaks
 * there once the change is made (P15): the entry it overlaps, or the words of the app's check.
 */
export type PreviewEventWords =
    | {
        readonly kind: "move"; readonly what: string; readonly from: string; readonly to: string; readonly verb: LaneVerb; readonly start: string; readonly end: string;
        readonly overlapped: string | undefined; readonly breach?: LaneBreach | undefined;
    }
    | { readonly kind: "reschedule"; readonly what: string; readonly on: string; readonly start: string; readonly end: string; readonly overlapped: string | undefined; readonly breach?: LaneBreach | undefined }
    | { readonly kind: "add"; readonly what: string; readonly on: string; readonly verb: LaneVerb; readonly start: string; readonly end: string; readonly breach?: LaneBreach | undefined }
    | { readonly kind: "remove"; readonly what: string; readonly from: string }
    | { readonly kind: "change"; readonly what: string; readonly on: string };

/**
 * An event the option knocks on, worded for the sentence after the change's own clauses (P16): along its lane, from when
 * it started to when it starts; or onto another lane, and when it starts there.
 */
export type PreviewPushWords =
    | { readonly what: string; readonly was: string; readonly start: string }
    | { readonly what: string; readonly onto: string; readonly start: string };

/**
 * One clause of a Sheet preview's sentence, worded: the columns' heads a change sets on its rows — none, for a change
 * that no longer applies — or the rows it adds or removes, each row by its name, `more` past the rows named.
 */
export type PreviewCellsWords =
    | { readonly kind: "change"; readonly columns: readonly string[]; readonly rows: readonly string[]; readonly more: string | undefined }
    | { readonly kind: "add" | "remove"; readonly rows: readonly string[]; readonly more: string | undefined };

/** How many other cases change an entry, worded: the count, and whether it is one. */
export interface PreviewSharedWords {
    /** The count. */
    readonly n: string;
    /** Whether it is one. */
    readonly one: boolean;
}

/** How many events a map's tile counts, worded: the count, whether it is one, and the events' noun in its number. */
export interface PreviewCountWords {
    /** The count. */
    readonly n: string;
    /** Whether it is one. */
    readonly one: boolean;
    /** The events' noun, singular or plural as the count takes it — `print job`, `print jobs`. */
    readonly noun: string;
}

/** A preview's entry, worded for its title: its shift and day, and how the change marks it. */
export interface PreviewTileWords {
    /** Its shift, or what it is. */
    readonly what: string;
    /** Its day. */
    readonly when: string;
    /** How the change marks it: proposed where it lands, changed in place, moved off, or removed. */
    readonly op: "add" | "chg" | "from" | "del" | undefined;
    /** A moved-off entry's: whom it moves to. */
    readonly to: string | undefined;
    /** Whether the option knocks it on. */
    readonly knock: boolean;
    /** Whether it is locked. */
    readonly locked: boolean;
    /** The rule it breaks once the change is made. */
    readonly breach: string | undefined;
    /** How many other cases change it. */
    readonly shared: PreviewSharedWords | undefined;
}

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
    /** The recommended option's line, before its note — `recommended · lands at 40h of 40`, or `recommended` alone. */
    recommendedLine: (p: { note: string | undefined }) => string;
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
    /**
     * Why Apply is off — its tooltip: for edits the app's check refuses, each issue it names, by its row — `R-14 · Days:
     * over the weekly cap`.
     */
    applyOff: (p: {
        why: "needs" | "blocked" | "handoff" | "stale" | "reading" | "failed" | "malformed" | "unready";
        issues?: readonly { readonly row: string; readonly message: string }[] | undefined;
    }) => string;
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
    /** An edit a changed row's kind refuses, under the row's form — `This edit can't be made`. */
    editRefused: () => string;
    /** A kind's own form that could not be drawn, under the fields drawn in its place. */
    ownFormFailed: () => string;
    /** A changed row whose form could not be drawn: its kind could not read it. */
    formFailed: () => string;
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
    /** Items in running text — `Mon, Wed and Thu`. */
    previewList: (p: { items: readonly string[] }) => string;
    /** One clause of a preview's sentence (P25): what moves where — `H. Aspen's Night shifts on Mon, Wed and Thu move to C. Clover`. */
    previewClause: (p: PreviewClauseWords) => string;
    /**
     * A preview's sentence (P25): its clauses, a map's count ahead of them, the knock-ons the last pushes, the marks it
     * names after them — an entry pinned, an entry other cases change — and the rows the model guessed.
     */
    previewSentence: (p: {
        clauses: readonly string[]; people?: { n: string; of: string } | undefined; pushes?: string | undefined; marks?: readonly string[] | undefined;
        guessed?: { keys: string; n: number } | undefined;
    }) => string;
    /** The knock-ons a change pushes, after its own clauses (P16, P25) — `pushes Exhibition book from 06:00 to 09:00`. */
    previewPushes: (p: { pushes: readonly PreviewPushWords[] }) => string;
    /** An entry the target's `locked` pins, which the change leaves as it stands (P17, P25) — `Market posters is pinned on Press B2`. */
    previewPinned: (p: { what: string; on: string }) => string;
    /** An entry the change touches that other cases' chosen options change too (P18, P25) — `1 other case changes Winter brochure too`. */
    previewAlsoIn: (p: { what: string; n: string; one: boolean }) => string;
    /**
     * The sentence of a preview whose change no longer applies (P21, P25): the rows it touches moved after the model's
     * run, named — the entries it changes, or `whose` shifts it changes — `Stale: the rows changed after this run; the
     * change to Seed catalogue needs a rerun`, `…; the change to R. Wold's shifts needs a rerun`.
     */
    previewStale: (p: { names: string | undefined; whose?: boolean | undefined }) => string;
    /** The sentence of a preview whose option changes nothing, over the rows the recommendation lands on (P4). */
    previewUnchanged: (p: { names: string }) => string;
    /** A person's hours, before → after, or as they stand against their contract — `52 → 40h`, `52→40h`, `52h of 40`. */
    previewHours: (p: { before: string; after: string; same: boolean; contract: string | undefined; compact: boolean }) => string;
    /** An agency's requests in the week — `3 requests`. */
    previewRequests: (p: { n: string; one: boolean }) => string;
    /**
     * A map by people's sentence after its count (P5, P25): how many people the change gains or changes shifts for, and
     * those it leaves fewer — named, else counted — `18 gain or change shifts, R. Wold and G. Ember lose shifts`.
     */
    previewShifts: (p: { gain: { n: string; one: boolean } | undefined; lose: { names: string; one: boolean } | { n: string } | undefined }) => string;
    /** A map's rows past the four it shows (P5) — `+ 16 more people`. */
    previewMorePeople: (p: { n: string }) => string;
    /** A map's count of what changes (P5) — `20 of 36`. */
    previewCount: (p: { n: string; of: string }) => string;
    /** A preview's entry's title (P25): its shift and day, and how the change marks it. */
    previewTile: (p: PreviewTileWords) => string;
    /** The `+N` chip of the other cases changing an entry (P18) — `+2`. */
    previewShared: (p: { n: string }) => string;
    /**
     * One clause of a lanes preview's sentence (P25) — `Loyalty cards leaves Press B2, where it overlapped Market posters,
     * and runs on Press A1 from 11:30 to 14:30`, `LD-2235 leaves Waiting and is held in K-305 from Tue 11 14:15 to Thu 20 00:00`.
     */
    previewEvent: (p: PreviewEventWords) => string;
    /** A lane's booked share of the window, before → after, or as it stands (P24) — `78 → 44%`, `44%`. */
    previewShare: (p: { before: string; after: string; same: boolean }) => string;
    /** A lane's load, before → after, or as it stands (P24), each a quantity as the board words it — `0 → 8 m³`, `8 m³`. */
    previewLoad: (p: { before: string; after: string; same: boolean }) => string;
    /** The Allocation's lane of what waits for a resource: the arrivals no resource holds yet — `Waiting`. */
    previewWaiting: () => string;
    /** A bin booking no arrival, as the board's card names it — `Reserved` — and as the sentence does: `A reservation`. */
    previewReserved: (p: { sentence: boolean }) => string;
    /** A bin's part on a resource, as the board's card names it: its arrival or `Reserved`, and its quantity — `LD-2235 · 8 m³`. */
    previewBin: (p: { code: string; quantity: string }) => string;
    /**
     * A day lane's overlaps, before → after, or as they stand (P24): `n` how many, `free` whether nothing stands on it —
     * `overlap 1 → 0`, `1 overlap`, `no overlap`, `free`.
     */
    previewOverlaps: (p: { before: string; after: string; n: number; same: boolean; free: boolean }) => string;
    /** Where an event stands on a day lane, where the change moves it onto another resource — `Press 2 on Sat 3`. */
    previewWhere: (p: { resource: string; day: string }) => string;
    /** When an entry runs, in its title — `11:30–14:30`. */
    previewSpan: (p: { start: string; end: string }) => string;
    /** The entry an entry overlaps once the change is made, in its title (P15) — `overlaps Market posters`. */
    previewOverlap: (p: { with: string }) => string;
    /** The lane of the events on no resource — `Unassigned`. */
    previewUnassigned: () => string;
    /**
     * A map's sentence (P5, P25): how many of the kinds' resources the change touches — of how many, where every one is in
     * hand — the one it lands the most events on, those it only takes events off, and the rows the model guessed: `10 of
     * 24 presses change; Press C4 takes 4 print jobs, Press A7 and Press C8 lose theirs`.
     */
    previewMap: (p: {
        n: string; one: boolean; of: string | undefined; resources: string;
        most: { name: string; n: string; events: string } | undefined;
        freed: { names: string; one: boolean; events: string } | undefined;
        guessed: { keys: string; n: number } | undefined;
    }) => string;
    /**
     * A map's tile's title (P25): its resource, and the events the change lands there, knocks on there and takes off
     * there — `Press A2 · 2 print jobs change`, `Press A7 · 1 print job moves off`, `Press A1 · no change`.
     */
    previewMapTile: (p: { name: string; takes: PreviewCountWords | undefined; knocks: PreviewCountWords | undefined; loses: PreviewCountWords | undefined; breach: string | undefined }) => string;
    /** A map's tile for the rest of its group (P5): what it says — `+3` — and its title, `3 more kilns`. */
    previewMapMore: (p: { n: string; resources: string; title: boolean }) => string;
    /** The resources of several kinds, as a map's sentence names them — `resources`. */
    previewResources: () => string;
    /** A when strip's tick's title (P12): the event's new time and the event — `06:00 · Loyalty cards moves here`. */
    previewWhen: (p: { time: string; what: string; added: boolean }) => string;
    /** One clause of a Sheet preview's sentence (P25) — `Status and Due change on WO-1005, WO-1007 and WO-1008`, `WO-1010 is added`. */
    previewCells: (p: PreviewCellsWords) => string;
    /** A Sheet preview's cell its change clears, as the Sheet marks a blank — `—`. */
    previewBlank: () => string;
    /**
     * A Sheet preview's cell's title (P25): its column's head and its value — as it stands and as the change leaves it,
     * where the change sets it — and how the change marks it: `Due: — → 13 Mar 28`, `Due: 13 Mar 28 · removed`.
     */
    previewCell: (p: { column: string; was: string; is: string; op: "add" | "chg" | "del" | undefined; knock: boolean }) => string;
    /** A Sheet preview's row's title (P25): its name, how the change marks it, its lock, and the other cases changing it — `WO-1005 · changed`. */
    previewRow: (p: { name: string; op: "add" | "chg" | "del" | undefined; knock: boolean; locked: boolean; shared: PreviewSharedWords | undefined }) => string;
    /** A head's caption over a preview's chart (P7, P10, P11) — `Pay code`, `Change`, `Changed`, `Rows`, `Net`. */
    previewCaption: (p: { caption: "payCode" | "change" | "changed" | "rows" | "net" }) => string;
    /** A record preview's field's caption (P6): its row's name and its own — `coast · List price`. */
    previewFieldName: (p: { row: string; field: string }) => string;
    /**
     * A record preview's field's title (P6, P25): its row's name and its own, as it stands and as the change leaves it,
     * or as it stands where the change leaves it so — `coast · List price · 10.5 → 11`, `coast · Demand / wk · 14,200 · no change`.
     */
    previewField: (p: { row: string; field: string; was: string; is: string; changed: boolean }) => string;
    /** A record preview's sentence (P6, P25): its fields' titles, and the rows the model guessed. */
    previewFields: (p: { fields: readonly string[]; guessed: { keys: string; n: number } | undefined }) => string;
    /** A map by cost's pay code's title (P7, P25): the week's cost in it, before → after — `OT1 · $1.2K → $0.8K a week`. */
    previewCost: (p: { code: string; was: string; now: string }) => string;
    /**
     * A map by cost's sentence (P7, P25): the week's change by pay code, the codes it moves — `Week 10 pay by code: AGENCY
     * −$816, ORD +$924 and OT1 −$378` — or none — `Week 10 pay doesn't change` — and a pay that could not be worked out.
     */
    previewCosts: (p: { week: string; codes: readonly { code: string; change: string }[]; failed: boolean }) => string;
    /** A mix's row's title (P10, P25) — `Harbour · 3,800 → 3,200`, `Station Rd · 1,200 · no change`. */
    previewMeasure: (p: { name: string; was: string; now: string; same: boolean }) => string;
    /** A mix's sentence (P10, P25): the rows it moves — `Harbour goes from 3,800 to 3,200 and Riverside from 1,600 to 1,300`. */
    previewMix: (p: { rows: readonly { name: string; was: string; now: string }[]; guessed: { keys: string; n: number } | undefined }) => string;
    /** A group's title (P11, P25): how many of its rows change, and their net change — `Envelopes · 412 of 980 change · net +8%`. */
    previewGroup: (p: { name: string; n: string; of: string; net: string | undefined }) => string;
    /** Groups' sentence (P11, P25) — `412 in Envelopes (+8%), 298 in Labels (+12%) and 136 in Cards (+6%) change`. */
    previewGroups: (p: { groups: readonly { name: string; n: string; net: string | undefined }[] }) => string;
    /** A zone's count in a zones preview's key (P9) — `25 → 19`, `15`. */
    previewZoneCount: (p: { before: string; after: string; same: boolean }) => string;
    /** A zones preview's tile's title (P9, P25) — `G2 · Round A → Round B`, `Round A depot · B3`, `C1 · Round A · no change`. */
    previewZoneTile: (p: { name: string; zone: string; from: string | undefined; depot: boolean }) => string;
    /**
     * A zones preview's sentence (P9, P25): what moves from which zone to which, of how many, and how each zone's count
     * moves — `6 of 40 move from Round A to Round B: Round A goes from 25 to 19 and Round B from 15 to 21`.
     */
    previewZones: (p: {
        moves: readonly { n: string; one: boolean; from: string; to: string }[]; of: string; counts: readonly { zone: string; before: string; after: string }[];
    }) => string;
    /**
     * A projection's sentence (P8, P25): each option's lowest point, and whether it falls under the limit — `2,000
     * (chosen) stays at 1,840 or above; No order falls to 0, under min`.
     */
    previewProjection: (p: { lines: readonly { label: string; chosen: boolean; low: string; under: boolean }[]; limit: string | undefined }) => string;
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
const MARKS = { add: "added", chg: "changed", del: "removed" } as const;
const CAPTIONS = { payCode: "Pay code", change: "Change", changed: "Changed", rows: "Rows", net: "Net" } as const;

/** Items in running text — `Mon, Wed and Thu`. */
const listOf = (items: readonly string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]!}`);
/** How many other cases change an entry, in its title. */
const sharedText = (shared: PreviewSharedWords | undefined): string | undefined =>
    (shared === undefined ? undefined : `${shared.n} other ${shared.one ? "case changes" : "cases change"} it too`);
/** A title's parts, those it has, in order. */
const parts = (...said: readonly (string | undefined)[]): string => said.filter((part): part is string => part !== undefined).join(" · ");
/** A sentence's tail naming the rows the model guessed (P26), after its head. */
const guessedText = (head: string, guessed: { keys: string; n: number } | undefined): string =>
    (guessed === undefined ? head : `${head}. ${guessed.keys} ${guessed.n === 1 ? "is a low-confidence guess" : "are low-confidence guesses"}`);
/** What an event does where it moves or is added, in a lanes preview's sentence: `runs on Press A1`, `is held in K-305`, `waits`. */
const doesText = (verb: LaneVerb, where: string): string => (verb === "runs" ? `runs on ${where}` : verb === "held" ? `is held in ${where}` : "waits");
/** What an event breaks once the change is made, after its clause (P15): `, where it overlaps Menu cards`, or the check's words. */
const breachText = (breach: LaneBreach | undefined): string => (breach === undefined ? ""
    : breach.kind === "overlap" ? `, where it overlaps ${breach.with}` : `, which the check flags: ${breach.text}`);

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
    recommendedLine: ({ note }) => (note === undefined ? "recommended" : `recommended · ${note}`),
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
    applyOff: ({ why, issues }) => (why === "unready" && issues !== undefined && issues.length > 0
        ? issues.map(issue => `${issue.row} · ${issue.message}`).join("; ") : APPLY_OFF[why]),
    editTitle: ({ override }) => (override ? "Your decision" : "Edit"),
    editMeta: ({ changed, override }) => (override ? "set what happens instead · the model learns from it"
        : changed === undefined ? "drafts on the proposal" : `${changed} changed · drafts on the proposal`),
    resetAll: () => "Reset all",
    keepAsIs: () => "Keep as it is",
    removedRow: ({ name }) => `${name} · removed`,
    resetField: ({ field }) => `Reset ${field} to the proposal`,
    editRefused: () => "This edit can't be made",
    ownFormFailed: () => "Its own form could not be shown: its fields are shown instead",
    formFailed: () => "This row's form could not be shown",
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
    previewList: ({ items }) => listOf(items),
    previewClause: (p) => {
        switch (p.kind) {
            case "move": return p.n === 1 ? `${p.from}'s ${p.what} shift on ${p.days} moves to ${p.to}` : `${p.from}'s ${p.what} shifts on ${p.days} move to ${p.to}`;
            case "add": return p.n === 1 ? `${p.who} takes the ${p.what} shift on ${p.days}` : `${p.who} takes ${p.what} shifts on ${p.days}`;
            case "remove": return p.n === 1 ? `${p.who}'s ${p.what} shift on ${p.days} comes off` : `${p.who}'s ${p.what} shifts on ${p.days} come off`;
            case "reschedule": return `${p.who}'s ${p.what} shift on ${p.when} moves to ${p.toWhat} on ${p.toWhen}`;
            case "change": return `${p.who}'s ${p.what} shift on ${p.when} changes`;
        }
    },
    previewSentence: ({ clauses, people, pushes, marks, guessed }) => {
        const said = [`${clauses.join("; ")}${pushes === undefined ? "" : ` and ${pushes}`}`, ...(marks ?? [])].join("; ");
        return guessedText(people === undefined ? said : `${people.n} of ${people.of} people change: ${said}`, guessed);
    },
    previewPushes: ({ pushes }) => `pushes ${listOf(pushes.map(p => ("onto" in p ? `${p.what} onto ${p.onto} at ${p.start}` : `${p.what} from ${p.was} to ${p.start}`)))}`,
    previewPinned: ({ what, on }) => `${what} is pinned on ${on}`,
    previewAlsoIn: ({ what, n, one }) => `${n} other ${one ? "case changes" : "cases change"} ${what} too`,
    previewStale: ({ names, whose }) => `Stale: the rows changed after this run; the change${names === undefined ? "" : whose === true ? ` to ${names}'s shifts` : ` to ${names}`} needs a rerun`,
    previewUnchanged: ({ names }) => `Nothing changes for ${names}`,
    previewHours: ({ before, after, same, contract, compact }) => (same
        ? contract === undefined ? `${after}h` : `${after}h of ${contract}`
        : compact ? `${before}→${after}h` : `${before} → ${after}h`),
    previewRequests: ({ n, one }) => (one ? `${n} request` : `${n} requests`),
    previewShifts: ({ gain, lose }) => [
        gain === undefined ? undefined : `${gain.n} ${gain.one ? "gains or changes" : "gain or change"} shifts`,
        lose === undefined ? undefined : "names" in lose ? `${lose.names} ${lose.one ? "loses" : "lose"} shifts` : `${lose.n} lose shifts`,
    ].filter((part): part is string => part !== undefined).join(", "),
    previewMorePeople: ({ n }) => `+ ${n} more people`,
    previewCount: ({ n, of }) => `${n} of ${of}`,
    previewTile: ({ what, when, op, to, knock, locked, breach, shared }) => parts(
        `${what} · ${when}`,
        op === "add" ? "proposed" : op === "chg" ? "changed" : op === "from" ? `moves to ${to ?? "another day"}` : op === "del" ? "comes off" : undefined,
        knock ? "knock-on" : undefined,
        locked ? "locked" : undefined,
        breach,
        sharedText(shared),
    ),
    previewShared: ({ n }) => `+${n}`,
    previewEvent: (p) => {
        switch (p.kind) {
            case "move": return `${p.what} leaves ${p.from}${p.overlapped === undefined ? "" : `, where it overlapped ${p.overlapped},`} and ${doesText(p.verb, p.to)} from ${p.start} to ${p.end}${breachText(p.breach)}`;
            case "reschedule": return `${p.what} on ${p.on}${p.overlapped === undefined ? "" : `, where it overlapped ${p.overlapped},`} moves to ${p.start}–${p.end}${breachText(p.breach)}`;
            case "add": return `${p.what} ${doesText(p.verb, p.on)} from ${p.start} to ${p.end}${breachText(p.breach)}`;
            case "remove": return `${p.what} leaves ${p.from}`;
            case "change": return `${p.what} on ${p.on} changes`;
        }
    },
    previewShare: ({ before, after, same }) => (same ? after : `${before} → ${after}`),
    previewLoad: ({ before, after, same }) => (same ? after : `${before} → ${after}`),
    previewWaiting: () => "Waiting",
    previewReserved: ({ sentence }) => (sentence ? "A reservation" : "Reserved"),
    previewBin: ({ code, quantity }) => `${code} · ${quantity}`,
    previewOverlaps: ({ before, after, n, same, free }) => (!same ? `overlap ${before} → ${after}`
        : free ? "free" : n === 0 ? "no overlap" : n === 1 ? `${after} overlap` : `${after} overlaps`),
    previewWhere: ({ resource, day }) => `${resource} on ${day}`,
    previewSpan: ({ start, end }) => `${start}–${end}`,
    previewOverlap: (p) => `overlaps ${p.with}`,
    previewUnassigned: () => "Unassigned",
    previewMap: ({ n, one, of, resources, most, freed, guessed }) => {
        const count = `${n} of ${of ?? "the"} ${resources} ${one ? "changes" : "change"}`;
        const said = [
            most === undefined ? undefined : `${most.name} takes ${most.n} ${most.events}`,
            freed === undefined ? undefined : freed.one ? `${freed.names} loses its ${freed.events}` : `${freed.names} lose theirs`,
        ].filter((part): part is string => part !== undefined);
        return guessedText(said.length === 0 ? count : `${count}; ${said.join(", ")}`, guessed);
    },
    previewMapTile: ({ name, takes, knocks, loses, breach }) => parts(
        name,
        takes === undefined ? undefined : `${takes.n} ${takes.noun} ${takes.one ? "changes" : "change"}`,
        knocks === undefined ? undefined : `${knocks.n} knocked on`,
        loses === undefined ? undefined : `${loses.n} ${loses.noun} ${loses.one ? "moves" : "move"} off`,
        takes === undefined && knocks === undefined && loses === undefined ? "no change" : undefined,
        breach,
    ),
    previewMapMore: ({ n, resources, title }) => (title ? `${n} more ${resources}` : `+${n}`),
    previewResources: () => "resources",
    previewWhen: ({ time, what, added }) => `${time} · ${what} ${added ? "lands" : "moves"} here`,
    previewCells: (p) => {
        const one = p.rows.length === 1 && p.more === undefined;
        const rows = p.more === undefined ? listOf(p.rows) : `${p.rows.join(", ")} and ${p.more} more`;
        switch (p.kind) {
            case "change": return p.columns.length === 0
                ? `${rows} ${one ? "changes" : "change"}`
                : `${listOf(p.columns)} ${p.columns.length === 1 ? "changes" : "change"} on ${rows}`;
            case "add": return `${rows} ${one ? "is" : "are"} added`;
            case "remove": return `${rows} ${one ? "is" : "are"} removed`;
        }
    },
    previewBlank: () => "—",
    previewCell: ({ column, was, is, op, knock }) => parts(
        op === "chg" || knock ? `${column}: ${was} → ${is}` : `${column}: ${op === "del" ? was : is}`,
        op === "add" || op === "del" ? MARKS[op] : undefined,
        knock ? "knock-on" : undefined,
    ),
    previewRow: ({ name, op, knock, locked, shared }) => parts(
        name,
        op === undefined ? undefined : MARKS[op],
        knock ? "knock-on" : undefined,
        locked ? "locked" : undefined,
        sharedText(shared),
    ),
    previewCaption: ({ caption }) => CAPTIONS[caption],
    previewFieldName: ({ row, field }) => `${row} · ${field}`,
    previewField: ({ row, field, was, is, changed }) => (changed ? `${row} · ${field} · ${was} → ${is}` : `${row} · ${field} · ${was} · no change`),
    previewFields: ({ fields, guessed }) => guessedText(fields.join("; "), guessed),
    previewCost: ({ code, was, now }) => `${code} · ${was} → ${now} a week`,
    previewCosts: ({ week, codes, failed }) => `${codes.length === 0 ? `Week ${week} pay doesn't change`
        : `Week ${week} pay by code: ${listOf(codes.map(c => `${c.code} ${c.change}`))}`}${failed ? "; some pay couldn't be worked out" : ""}`,
    previewMeasure: ({ name, was, now, same }) => (same ? `${name} · ${now} · no change` : `${name} · ${was} → ${now}`),
    previewMix: ({ rows, guessed }) => guessedText(rows.length === 0 ? "Nothing changes"
        : listOf(rows.map((row, i) => `${row.name} ${i === 0 ? "goes " : ""}from ${row.was} to ${row.now}`)), guessed),
    previewGroup: ({ name, n, of, net }) => parts(`${name} · ${n} of ${of} change`, net === undefined ? undefined : `net ${net}`),
    previewGroups: ({ groups }) => `${listOf(groups.map(g => `${g.n} in ${g.name}${g.net === undefined ? "" : ` (${g.net})`}`))} change`,
    previewZoneCount: ({ before, after, same }) => (same ? after : `${before} → ${after}`),
    previewZoneTile: ({ name, zone, from, depot }) => (depot ? `${zone} depot · ${name}` : from !== undefined ? `${name} · ${from} → ${zone}` : `${name} · ${zone} · no change`),
    previewZones: ({ moves, of, counts }) => {
        if (moves.length === 0) return "Nothing moves";
        const moved = moves.map((move, i) => `${move.n}${i === 0 ? ` of ${of}` : ""} ${move.one ? "moves" : "move"} from ${move.from} to ${move.to}`).join("; ");
        return counts.length === 0 ? moved : `${moved}: ${listOf(counts.map((count, i) => `${count.zone} ${i === 0 ? "goes " : ""}from ${count.before} to ${count.after}`))}`;
    },
    previewProjection: ({ lines, limit }) => lines.map(line => `${line.label}${line.chosen ? " (chosen)" : ""} ${line.under
        ? `falls to ${line.low}, under ${limit ?? "the limit"}` : `stays at ${line.low} or above`}`).join("; "),
    batchStep: ({ n }) => `Apply ${n} routine cases`,
    verdictStep: ({ verdict, title }) => `${VERDICTS[verdict]}: ${title}`,
};

/** The words the queue speaks: its message table, and its locale's formatters. */
export interface DecisionQueueWords extends Formatters {
    /** The message table in effect. */
    m: DecisionQueueMessages;
}
