/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's words (#1501–#1505, `Flowchart Records Spec.md`) — its
 * canvas's gestures: "+ LANE", a lane's ×, the "+ STATE" ghost and each
 * gesture's name in the history; its footer's counts, the changes waiting on
 * Save and its last save; its loading line, in a kind's noun; the details'
 * (#1510, R41) — durations from the unit, a bin's edges, a histogram's caption,
 * a count with what it counts, a share under one percent, a tag list's +n, a
 * list's Show n more, and the legend's rows; its library
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
import { withArticle as aNoun } from "../shared/article.js";
import { pagedLoadingMessages, type PagedLoadingMessages } from "../shared/loading.js";
import { hiddenByText, joinedWords, kindPlural, lowerWord, unheldByScopeText, type HiddenWords } from "../shared/schedule/words.js";
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
 * its rows is called, `state`; or its kind adds no row, its keys of a type the
 * form can't type, by the type's name; or the lane it lands in is held under a
 * placeholder, its key still to be typed — by what a lane is called (#1549).
 */
export type FlowchartDropRefusalWord =
    | { readonly why: "onto"; readonly lands: FlowchartLandsWord }
    | { readonly why: "readOnly" | "busy"; readonly kind: string }
    | { readonly why: "untyped"; readonly kind: string; readonly type: string }
    | { readonly why: "placeholder"; readonly kind: string };

/**
 * Why a gesture records nothing (#1549), as the footer says it: the row
 * holding the key a row builds — a transition by its ends' names, any other row
 * by its own; a row named in another's field while its key is still to be
 * typed; a kind adding no row, its keys of a type the form can't type; and a
 * row whose key would move, by its name, while the rows of another kind that
 * may name it — `by` — the rail hides some of, the page's scope holds only some
 * of (#1621), or take no edit now (#1580).
 */
export type FlowchartRefusalWord =
    | { readonly refusal: "taken"; readonly sort: FlowchartSort; readonly name: string }
    | { readonly refusal: "taken"; readonly sort: "transitions"; readonly from: string; readonly to: string }
    | { readonly refusal: "placeholder"; readonly sort: FlowchartSort }
    | { readonly refusal: "untyped"; readonly sort: FlowchartSort; readonly type: string }
    | { readonly refusal: "unheld"; readonly name: string; readonly by: FlowchartSort; readonly why: "filtered" | "scoped" | "busy" };

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

/** A duration's step, as the details print it (R41): `0` alone, then minutes, hours, days and whole weeks. */
export type FlowchartDurationStep = "zero" | "minutes" | "hours" | "days" | "weeks";

/**
 * Where half, or nine in ten, of a histogram's counts fall (R41): within the
 * end of the bin they reach, or — reaching the open last bin — over its edge.
 */
export interface FlowchartMarkWord {
    /** Within a bin's end, or over the last edge. */
    readonly where: "within" | "over";
    /** The edge, as a duration prints it. */
    readonly at: string;
}

/** One of the legend's rows for the lines: planned, observed, a decision's diamond, an in-place transition's badge. */
export type FlowchartLegendLineWord = "planned" | "observed" | "decision" | "inPlace";

/**
 * One of the legend's rows for a read the cards or the labels draw (§4): its
 * label, and what it shows — a figure on each card or under the evidence; a
 * histogram's range, first edge to last, and its scale; a list's top, by share
 * on a card or under the evidence.
 */
export type FlowchartLegendReadWord =
    | { readonly read: "figure"; readonly label: string; readonly on: "card" | "label" }
    | { readonly read: "histogram"; readonly label: string; readonly first: string | undefined; readonly last: string | undefined; readonly scale: "band" | "linear" }
    | { readonly read: "list"; readonly label: string; readonly top: string; readonly on: "card" | "label" };

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
    /** What a read with nothing to show says, on a card, a label or in the inspector — `no data` (R33, R41). */
    detailsNoData: () => string;
    /** What a list or a tag list with no items says — `none` (R41). */
    detailsNone: () => string;
    /** A duration, by its step, its number in the app's locale (R41) — `15m`, `4h`, `2d`, `1w`; `0` alone. */
    detailsDuration: (p: { step: FlowchartDurationStep; n: string }) => string;
    /** The last edge, as an axis names it, its bin open — `1w+`. */
    detailsOpen: (p: { at: string }) => string;
    /** A bin, by its edges — `4h – 8h`; the last, open — `1w or more`. */
    detailsBin: (p: { from: string; to: string | undefined }) => string;
    /** A histogram's caption: where half and nine in ten of its counts fall — `Half within 4h · nine in ten within 2d`. */
    detailsMarks: (p: { half: FlowchartMarkWord; nine: FlowchartMarkWord }) => string;
    /** The bin under the pointer or the focus, as the caption says it — `4h – 8h · 236 parcels · 22%`. */
    detailsBinCaption: (p: { bin: string; count: string; share: string }) => string;
    /** A number with what it counts, the read's own word — `236 parcels`; the number alone where the read names none. */
    detailsCount: (p: { count: string; noun: string | undefined }) => string;
    /** A share above nothing but under the least the locale prints — `<1%`, by its 1%. */
    detailsShareUnder: (p: { least: string }) => string;
    /** The +n that ends a tag list cut short. */
    detailsMore: (p: { count: string }) => string;
    /** Its title: the tags it stands for — `Fragile and Cold chain`. */
    detailsRest: (p: { tags: readonly string[] }) => string;
    /** A list's control past its first 8 items — `Show 3 more`; open, `Show fewer`. */
    detailsShowMore: (p: { n: number; count: string; open: boolean }) => string;
    /** The inspector's read for a row the details hold no row of, saying *no data* (R33) — `Details`. */
    detailsTitle: () => string;
    /** The line over reads the rail's picks weigh, naming them (#1522, R46): the field as the rail labels it, then the picks — `Service · Standard, Priority`. */
    detailsWeighed: (p: { label: string; picks: string }) => string;
    /** What a kind's details are, as the loading line names them — `state details`. */
    detailsNoun: (p: { sort: "states" | "transitions" }) => string;
    /** The legend's title. */
    legendTitle: () => string;
    /** One of the legend's rows for the lines — `Planned`, `Observed`, `Decision trigger`, `In-place transition`. */
    legendLine: (p: { line: FlowchartLegendLineWord }) => string;
    /** One of its rows for a read (§4) — `Parcels · a figure on each card`, `Time in state · 0 to 1w+, a bar a bin`. */
    legendRead: (p: FlowchartLegendReadWord) => string;
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
    /** The zoom's strip's accessible name (R42). */
    zoomLabel: () => string;
    /** Zoom out. */
    zoomOut: () => string;
    /** Zoom in. */
    zoomIn: () => string;
    /** Fit: the whole flowchart in view. */
    fit: () => string;
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
    /** The line under a new row's key of several parts — a struct's fields, a variant's case and its value (#1581). */
    inspectorKeyPartsHelp: () => string;
    /** A key of several parts' Set, which takes it whole (#1581). */
    inspectorKeySet: () => string;
    /** A row in a select of the inspector's — `SCN · Scan`. */
    inspectorChoice: (p: { key: string; label: string }) => string;
    /** A part's head in Details — `Transitions · 3`, `In · 2`, `Evidence`; `name` is the transitions kind's. */
    inspectorSection: (p: { section: FlowchartPartWord; n: number; count: string; name: string }) => string;
    /** A transition's line under its ends in a list — `observed · route`, `unresolved`. */
    inspectorLinkKind: (p: { kind: "planned" | "observed" | "unresolved"; decision: string | undefined }) => string;
    /** A transition's volume beside its ends in a list (R37) — `18,460 parcels`; none measured, `not measured`. */
    inspectorVolume: (p: { volume: string | undefined }) => string;
    /** A row's chip in its head — `Pending`, `New`, `No state row`, `Unresolved`. */
    inspectorChip: (p: { state: FlowchartChipWord }) => string;
    /** A gesture's button in Details — `Duplicate`, `Delete`. */
    inspectorAction: (p: { action: "duplicate" | "delete" }) => string;
    /** Why a key typed in the inspector is refused, in the footer — `Every state needs a key`, `A lane is keyed "ld" already`; `name` as a sentence says it. */
    inspectorKeyRefused: (p: { name: string; key: string; why: "empty" | "taken" }) => string;
    /**
     * Why a kind adds no row (#1549) — on Duplicate's off line, "+ LANE"'s and "+ STATE"'s tooltips, a drop and the
     * footer: `Stations are keyed by Blob, which can't be typed — give the kind `key` to add them`; `name` as a
     * sentence says one of its rows, `type` its key type's name.
     */
    keysUntyped: (p: { name: string; type: string }) => string;
    /** A new row held under a placeholder, its key still to be typed (#1549) — `Type this lane's key: Save waits for it`. */
    keyPlaceholder: (p: { sort: FlowchartSort }) => string;
    /**
     * Why a gesture records nothing (#1549), in the footer — `A move from Mix to Proof is there already`, `Type the new
     * lane's key first`, `Scan isn't changed: the rail hides some transitions that may name it — clear its choices, then
     * try again` (#1580), `Scan isn't changed: this page holds only some transitions, and one it does not may name it —
     * edit it where they are all held` (#1621).
     */
    gestureRefused: (p: FlowchartRefusalWord) => string;
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

/** Why a kind adds no row (#1549): its rows' name as a sentence says one, and its key type's name. */
const keysUntyped = (name: string, type: string): string => `${capital(kindPlural(name))} are keyed by ${type}, which can't be typed — give the kind \`key\` to add them`;

/** Each field's label in the inspector's own forms. */
const FIELDS: { readonly [F in Exclude<FlowchartFieldWord, "moveTo">]: string } = {
    key: "Key", label: "Label", from: "From", to: "To", volume: "Volume", count: "Count", measured: "Measured",
};

/** A state's transitions' groups. */
const GROUPS = { in: "In", out: "Out", inPlace: "In place" } as const;

/** Each duration step's letter, after its number. */
const DURATION_STEPS: { readonly [S in Exclude<FlowchartDurationStep, "zero">]: string } = { minutes: "m", hours: "h", days: "d", weeks: "w" };

/** Where half or nine in ten of the counts fall — `within 4h`, `over 1w`. */
const markText = (mark: FlowchartMarkWord): string => `${mark.where} ${mark.at}`;

/** A legend row's words for a read (§4): its label, and what it shows. */
function legendReadText(p: FlowchartLegendReadWord): string {
    switch (p.read) {
        case "figure": return `${p.label} · ${p.on === "card" ? "a figure on each card" : "a figure under the evidence"}`;
        case "histogram": {
            const range = p.first === undefined ? "" : p.last === undefined ? `${p.first}+, ` : `${p.first} to ${p.last}+, `;
            return `${p.label} · ${range}${p.scale === "linear" ? "to scale" : "a bar a bin"}`;
        }
        case "list": return `${p.label} · top ${p.top}, ${p.on === "card" ? "by share" : "under the evidence"}`;
    }
}

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
    /** The legend's rows for the lines. */
    const LEGEND_LINES: { readonly [L in FlowchartLegendLineWord]: string } = {
        planned: nouns.planned, observed: nouns.observed, decision: `${nouns.decision} trigger`, inPlace: `In-place ${transition}`,
    };

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
        detailsNoData: () => "no data",
        detailsNone: () => "none",
        detailsDuration: ({ step, n }) => (step === "zero" ? "0" : `${n}${DURATION_STEPS[step]}`),
        detailsOpen: ({ at }) => `${at}+`,
        detailsBin: ({ from, to }) => (to === undefined ? `${from} or more` : `${from} – ${to}`),
        detailsMarks: ({ half, nine }) => `Half ${markText(half)} · nine in ten ${markText(nine)}`,
        detailsBinCaption: ({ bin, count, share }) => `${bin} · ${count} · ${share}`,
        detailsCount: ({ count, noun }) => (noun === undefined ? count : `${count} ${noun}`),
        detailsShareUnder: ({ least }) => `<${least}`,
        detailsMore: ({ count }) => `+${count}`,
        detailsRest: ({ tags }) => joinedWords(tags, "and"),
        detailsShowMore: ({ count, open }) => (open ? "Show fewer" : `Show ${count} more`),
        detailsTitle: () => "Details",
        detailsWeighed: ({ label, picks }) => `${label} · ${picks}`,
        detailsNoun: ({ sort }) => `${ONE[sort]} details`,
        legendTitle: () => "Legend",
        legendLine: ({ line }) => LEGEND_LINES[line],
        legendRead: (p) => legendReadText(p),
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
        zoomLabel: () => "Zoom",
        zoomOut: () => "Zoom out",
        zoomIn: () => "Zoom in",
        fit: () => "Fit",
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
        dropRefused: (p) => {
            switch (p.why) {
                case "onto": return `Drop ${LANDS[p.lands]}`;
                case "readOnly": return `${capital(kindPlural(p.kind))} are read only`;
                case "busy": return `${capital(kindPlural(p.kind))} take no edit now`;
                case "untyped": return keysUntyped(p.kind, p.type);
                case "placeholder": return `Type the new ${p.kind}'s key first`;
            }
        },
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
        inspectorKeyPartsHelp: () => "Type each part, then Set key: the row takes the key whole, and Save waits until it does.",
        inspectorKeySet: () => "Set key",
        inspectorChoice: ({ key, label }) => `${key} · ${label}`,
        inspectorSection: ({ section, count, name }) => {
            switch (section) {
                case "transitions": return `${kindPlural(name)} · ${count}`;
                case "governs": return `${kindPlural(name)} it governs · ${count}`;
                case "evidence": return "Evidence";
                default: return `${GROUPS[section]} · ${count}`;
            }
        },
        inspectorLinkKind: ({ kind, decision: named }) => (named === undefined ? kindWord(kind) : `${kindWord(kind)} · ${named}`),
        inspectorVolume: ({ volume }) => volume ?? "not measured",
        inspectorChip: ({ state: chip }) => CHIPS[chip],
        inspectorAction: ({ action }) => (action === "duplicate" ? "Duplicate" : "Delete"),
        inspectorKeyRefused: ({ name, key, why }) => (why === "empty" ? `Every ${name} needs a key` : `${capital(aNoun(name))} is keyed ${quoted(key)} already`),
        keysUntyped: ({ name, type }) => keysUntyped(name, type),
        keyPlaceholder: ({ sort }) => `Type this ${ONE[sort]}'s key: Save waits for it`,
        gestureRefused: (p) => {
            switch (p.refusal) {
                case "taken": return "from" in p
                    ? `${capital(aNoun(transition))} from ${p.from} to ${p.to} is there already`
                    : `${capital(aNoun(ONE[p.sort]))} ${p.name} is there already`;
                case "placeholder": return `Type the new ${ONE[p.sort]}'s key first`;
                case "untyped": return keysUntyped(ONE[p.sort], p.type);
                case "unheld": switch (p.why) {
                    case "filtered": return `${p.name} isn't changed: the rail hides some ${kindPlural(ONE[p.by])} that may name it — clear its choices, then try again`;
                    // A page's scope (#1621) is no choice of the viewer's: nothing on the rail clears it.
                    case "scoped": return `${p.name} isn't changed: ${unheldByScopeText(kindPlural(ONE[p.by]))}`;
                    case "busy": return `${p.name} isn't changed: ${kindPlural(ONE[p.by])} that may name it take no edit now — try again in a moment`;
                }
            }
        },
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
                case "weighed": return `${p.kind} details read another record than the rail's ${p.source}, so its picks don't add them up: each draws its row's own`;
                case "waiting": return `${p.name} has an unsaved change the rail hides: Save writes it with the rest`;
                case "ready": return p.message;
                case "bounds": return `${p.field}: ${p.bound}`;
                case "save": return p.message;
            }
        },
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
