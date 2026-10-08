/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Every word the Plan says itself (#820) — ONE typed message table. The
 * canvas's own chrome (the toolbar, the footer, the diagnostics, the bands,
 * the narrow layout's tabs and cards), the words it gives a reader for what
 * it shows only by shape or colour, and what its live region announces all
 * come from here. What the AUTHOR wrote — a row's label,
 * a footer item, a series title — is data, and never passes through it.
 *
 * Each message is a function of named parameters, so a translation can put
 * them where its grammar wants them and choose its own plural forms. Numbers
 * and dates arrive already formatted for the canvas's locale (`words.ts`);
 * `n` is the raw count beside a formatted `count`, for plural rules.
 *
 * English is the default. A host overrides any subset for a subtree with
 * {@link PlanMessagesProvider}; the locale numbers and dates format in comes
 * from react-aria's `I18nProvider` above the app (the browser's otherwise).
 *
 * @packageDocumentation
 */

import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import { editingMessages, type EditingMessages } from "@elaraai/east-ui-components";
import { timeMessages, type TimeMessages } from "../shared/time/scale.js";

/** A lifecycle state as the words name it — `EventStateType`, with the
 *  proposal arms spelled out. */
export type PlanStateWord =
    "estimated" | "added" | "recommended" | "removed" | "confirmed" | "in-progress" | "actual" | "rejected";

/** The grains, as a message receives them. */
export type PlanGrainWord = "group" | "resource";

/** An axis kind, as a message receives it (#631). */
export type PlanAxisWord = "time" | "number" | "ordinal";

/** A part of the canvas that can fail to render on its own (#811). A row is
 *  named to a reader by its label, and in `data-plan-error` by its key. */
export type PlanPart =
    | { kind: "row"; key: string; label: string }
    | { kind: "group"; label: string }
    | { kind: "expandRender" }
    | { kind: "expandGutter" }
    | { kind: "linksLayer" }
    | { kind: "popover" }
    | { kind: "hoverCard" };

/** The unit a horizon caption counts in — a time resolution, or a number axis's step. */
export type PlanHorizonUnit = "hour" | "day" | "week" | "month" | "quarter" | "year" | "step";

/** A chart layer kind, as the chart's summary names it. */
export type PlanChartLayerWord = "line" | "area" | "column" | "scatter" | "band";

/** An event mark's kind, as its name says it. */
export type PlanMarkWord = "milestone" | "decision" | "exception";

/** A links-focus family tag (R1). */
export type PlanFocusTagWord = "UPSTREAM" | "DOWNSTREAM" | "LINKED";

/** A tab of the library pane (#1195): the templates, the backlog, the series, or one of the author's own. */
export type PlanLibraryTabWord = "events" | "backlog" | "series" | "tab";

/** When a backlog event is due, as the Backlog tab groups it (PB28). */
export type PlanDueWord = "thisWeek" | "nextWeek" | "later" | "none";

/** A section of the inspector pane (#1197). */
export type PlanInspectorSection = "fields" | "bulk" | "window" | "measures";

/** A fact the inspector pane shows of an event or a row (#1197). */
export type PlanInspectorFact = "resource" | "start" | "end" | "at" | "lane" | "state" | "quantity" | "group" | "events" | "hours" | "quantities";

/** What the inspector pane counts when nothing is selected (#1197, PB41). */
export type PlanInspectorStat = "events" | "hours" | "backlog";

/**
 * The Plan's message table.
 *
 * @remarks
 * Parameters named `count`, `from`, `to`, `total`, `index` and `percent` are
 * numbers already formatted for the locale (a `percent` with its sign); `n`
 * is the raw number beside them, for plural rules. Dates (`date`, `at`,
 * `bucket`, `span`) are words the locale formatted.
 *
 * It carries the editing session's messages too ({@link EditingMessages},
 * #880: the history bar and the draft issues), so a host translates the
 * canvas's history bar where it translates the canvas; and the time scale's
 * ({@link TimeMessages}, #1148: its ruler's week and quarter ticks and their
 * words), which the scale the Plan shares with the Calendar speaks.
 */
export interface PlanMessages extends EditingMessages, TimeMessages {
    // ── The frame ──────────────────────────────────────────────────────────
    /** The treegrid's accessible name. */
    gridLabel: () => string;
    /** No window: a time or number axis that states none, with no bound slice
     *  range to supply one (#822 — the rows never do). */
    noWindow: () => string;
    /** No window: an ordinal axis with no values. */
    noWindowOrdinal: () => string;
    /** A part of the canvas, named — what its render-failure line says failed. */
    partName: (p: { part: PlanPart }) => string;
    /** A part's render-failure line. */
    partFailed: (p: { part: string; message: string }) => string;
    /** A row whose instants ride another arm than the axis (#811). */
    axisMismatch: (p: { found: PlanAxisWord; expected: PlanAxisWord }) => string;
    /** A row repeating the id of an earlier row on the canvas (#822) — `id` is
     *  the id's canonical text. */
    duplicateRow: (p: { id: string }) => string;

    // ── The toolbar ────────────────────────────────────────────────────────
    /** The grain segment's accessible name. */
    grainLabel: () => string;
    /** A grain's name — the grain segment and the ruler caption. */
    grainName: (p: { grain: PlanGrainWord }) => string;
    /** The resolution segment's (and its one-chip menu's) accessible name. */
    resolutionLabel: () => string;
    /** A time resolution's name — its segment and its one-chip menu. */
    resolutionName: (p: { resolution: string }) => string;
    /** The slice summary line — `6 of 36 rows · 2 filters` (#949: a plain
     *  summary; every narrowing the slice holds counts as a filter). */
    summary: (p: { result: string; total: string; n: number; active: string }) => string;
    /** The summary line shortened to its count — `6 of 36` — what a toolbar
     *  short of room keeps of it (#952). */
    summaryShort: (p: { result: string; total: string }) => string;
    /** The badge on narrowing chrome that sees only the loaded prefix. */
    scopeBadge: () => string;
    /** The key search's icon — what a toolbar short of room folds its box
     *  to — and the head of the popover it opens the box in (#1193). */
    keySearch: () => string;
    /** The overlaps chip (#1198, PB52) — `3 overlaps`: the pairs of events
     *  that overlap in the window. */
    overlaps: (p: { n: number; count: string }) => string;
    /** The chip shortened to its count — `3` — what a toolbar short of room keeps of it. */
    overlapsShort: (p: { n: number; count: string }) => string;
    /** The chip's accessible name: its count, and what a click on it does. */
    overlapsLabel: (p: { n: number; count: string }) => string;

    // ── Diagnostics (#811) ─────────────────────────────────────────────────
    /** Rows drawn as diagnostic rows. */
    rowsSkipped: (p: { n: number; count: string }) => string;
    /** The same chip's accessible name, where it seeks to the first. */
    rowsSkippedSeek: (p: { n: number; count: string }) => string;
    /** A source that could not report its size. */
    sourceUnavailable: (p: { reason: string }) => string;
    /** A key search that failed. */
    searchFailed: (p: { reason: string }) => string;
    /** An axis the grid had to truncate. */
    truncated: (p: { n: number; count: string }) => string;

    // ── The transport line (#567 D9) ───────────────────────────────────────
    /** A resident prefix — `1,200 loaded of 8,431`. */
    transportLoaded: (p: { loaded: string; total: string | undefined }) => string;
    /** A resident run in the middle — `elements 39,801–41,000 of 50,000`. */
    transportRange: (p: { from: string; to: string; total: string | undefined }) => string;
    /** The line while a window is in flight. */
    transportLoading: (p: { line: string }) => string;

    // ── The footer's counts (#1193) ────────────────────────────────────────
    /** The event kinds' events in the window — `64 events`. */
    footerEvents: (p: { n: number; count: string }) => string;
    /** The event kinds' unscheduled events — `9 in backlog`. */
    footerBacklog: (p: { n: number; count: string }) => string;
    /** The changes waiting on Save — `4 pending`. */
    footerPending: (p: { n: number; count: string }) => string;
    /** When an event kind's record was last saved — `saved 14:02`: `when` is its time today, else its date and time. */
    footerSaved: (p: { when: string }) => string;

    // ── The library pane (#1195) ───────────────────────────────────────────
    /** The library pane's name. */
    libraryPane: () => string;
    /** A library tab — the author names their own tabs. */
    libraryTab: (p: { tab: Exclude<PlanLibraryTabWord, "tab"> }) => string;
    /** A library tab's empty state: its title — `No templates`, `Backlog clear`, `Nothing in Customers` (PB30); `name` is an author's tab's. */
    libraryEmpty: (p: { tab: PlanLibraryTabWord; name: string }) => string;
    /** The line under it. */
    libraryEmptyHint: (p: { tab: PlanLibraryTabWord; name: string }) => string;
    /** What a library tab's search box counts its cards as — `template`, `templates`. */
    libraryNoun: (p: { tab: PlanLibraryTabWord; n: number }) => string;
    /** What a library tab's cards are grouped by: its grouping control's words. */
    libraryGroupBy: (p: { tab: PlanLibraryTabWord }) => string;
    /** A template card's head: its kind's name, then the template's `group` (PB27) — `Print job · Jobs`. */
    templateGroup: (p: { kind: string; group: string | undefined }) => string;
    /** A template card's line — `Print job · 6 h · presses`: its kind's name, how long it runs (an instant kind's runs none), and the resource kinds it is placed on. */
    templateLine: (p: { kind: string; duration: string | undefined; resources: readonly string[] }) => string;
    /** A backlog card's line — `6 h · Press A · due Fri 16`: how long it takes, the resource it is on (`undefined`, on none), and when it is due. */
    backlogLine: (p: { duration: string; resource: string | undefined; due: string | undefined }) => string;
    /** When a backlog event is due — `due Fri 16`: `weekday` and `day` are its day's, formatted. */
    backlogDue: (p: { weekday: string; day: string }) => string;
    /** A backlog group, by when its events are due (PB28) — `Due this week`. */
    dueGroup: (p: { due: PlanDueWord }) => string;
    /** How long something takes — `6 h`, `2 h 15 m`, `45 m`: `hours` and `minutes` formatted, each `undefined` when it is none. */
    duration: (p: { hours: string | undefined; minutes: string | undefined }) => string;

    // ── The inspector pane (#1197) ─────────────────────────────────────────
    /** The inspector pane's name. */
    inspectorPane: () => string;
    /** Several events selected — `3 events`: the head of their list, and the collapsed pane's line. */
    inspectorEvents: (p: { n: number; count: string }) => string;
    /** How many of the events selected are of one kind — `Print job ×2`: `kind` is its name. */
    inspectorKindCount: (p: { kind: string; n: number; count: string }) => string;
    /** When an event runs — `Mon, Oct 5 · 06:00–14:00`; across days, `Mon, Oct 5, 22:00 – Tue, Oct 6, 06:00`
     *  (`endDay` its last day); an instant's, `Wed, Oct 7 · 12:00` (`to` undefined). Days and times are formatted. */
    inspectorWhen: (p: { day: string; from: string; endDay: string | undefined; to: string | undefined }) => string;
    /** An event with no time: in its kind's backlog. */
    inspectorUnscheduled: () => string;
    /** A section's head. */
    inspectorSection: (p: { section: PlanInspectorSection }) => string;
    /** A fact's label. */
    inspectorFact: (p: { fact: PlanInspectorFact }) => string;
    /** An event on no resource — and an event kind's row of them. */
    inspectorUnassigned: () => string;
    /** A row that is no resource's: the eyebrow over its name. */
    inspectorRow: () => string;
    /** One of the gestures on what is selected. */
    inspectorAction: (p: { action: "duplicate" | "delete" }) => string;
    /** A step of the bulk edit's shift in time — `−1 d`, `+1 h`. */
    inspectorShift: (p: { by: -1 | 1; unit: "day" | "hour" }) => string;
    /** The bulk edit's shift in time: its steps' group's name. */
    inspectorShiftLabel: () => string;
    /** A row's measures at the bucket a click on its plot named — `At Tue, Oct 20`: `bucket` in the axis's words. */
    inspectorAt: (p: { bucket: string }) => string;
    /** A row's measures before a click on its plot has named a bucket. */
    inspectorNoBucket: () => string;
    /** A measure with no value at the bucket. */
    inspectorNoValue: () => string;
    /** What a count says it counts when nothing is selected. */
    inspectorStat: (p: { stat: PlanInspectorStat; n: number }) => string;
    /** A hint when nothing is selected — three of them. */
    inspectorHint: (p: { n: 1 | 2 | 3 }) => string;
    /** One event's overlaps banner (#1198, PB53) — `Overlaps 2 events on Press B2`: `on` is its resource's name. */
    inspectorOverlaps: (p: { n: number; count: string; on: string }) => string;
    /** A row's overlaps banner (PB40) — `2 overlaps`: the pairs on the row's resource in the window. */
    inspectorRowOverlaps: (p: { n: number; count: string }) => string;
    /** One pair in a row's banner — `Market posters · Loyalty cards`: its events' titles. */
    inspectorOverlapPair: (p: { first: string; second: string }) => string;

    // ── The horizon, the ruler, the axis in words ──────────────────────────
    /** The horizon strip's caption — `HORIZON · 26 WK`. */
    horizon: (p: { n: number; count: string; unit: PlanHorizonUnit }) => string;
    /** The ruler's now chip. */
    now: () => string;

    // ── Row focus (R1 / R2) ────────────────────────────────────────────────
    /** The focus band's way back. */
    allRows: () => string;
    /** The links focus caption — `Links · H1-P03 · 4 upstream · 6 downstream`
     *  (the band sets it in capitals); `label` is the focused row's gutter label. */
    focusLinks: (p: { label: string; upstream: string | undefined; downstream: string | undefined }) => string;
    /** The expand focus caption — `label` is the focused row's gutter label. */
    focusExpanded: (p: { label: string }) => string;
    /** A row's family Tag under a links focus — `Upstream`, `Downstream`, `Linked`. */
    focusTag: (p: { tag: PlanFocusTagWord }) => string;
    /** The links-focus control's accessible name. */
    linksControl: () => string;
    /** The expand control's accessible name. */
    expandControl: () => string;

    // ── Rows and bands ─────────────────────────────────────────────────────
    /** A group's derived member count — `8 rows`, or `~8 rows` while it covers only
     *  the loaded windows (a top-level section on a paged canvas still
     *  loading — the one parent whose members span windows, #822). */
    groupMeta: (p: { n: number; count: string; partial: boolean }) => string;
    /** What a links focus's gap band stands for — `12 hidden rows`. */
    hiddenRows: (p: { n: number; count: string; what: "row" | "group" }) => string;
    /** An unloaded run whose window is in flight. */
    bandLoading: (p: { from: string; to: string }) => string;
    /** An unloaded run above the resident rows. */
    bandEarlier: (p: { n: number; count: string }) => string;
    /** An unloaded run below the resident rows. */
    bandLater: (p: { n: number; count: string }) => string;
    /** A window whose read failed. */
    windowFailed: (p: { from: string; to: string; reason: string }) => string;
    /** A failed window's retry button. */
    retry: () => string;
    /** A run bar's churn counter — `moved ×3`. */
    moved: (p: { n: number; count: string }) => string;
    /** A rollup band's caption — `×2 · 208 k sheets`. Always exact: a span parent
     *  rolls up one entry's subtree, which a window holds whole (#822). */
    rollupCaption: (p: { count: string | undefined; quantity: string | undefined }) => string;
    /** A quantity's caption — `96 k sheets` (#824): `value` is already formatted,
     *  through the quantity's own format; `unit` is the author's, when declared. */
    quantity: (p: { value: string; unit: string | undefined }) => string;
    /** Totals in several units, read together — a rollup band's `208 k sheets · 12 h`. */
    quantities: (p: { parts: readonly string[] }) => string;
    /** The resting chip of a proposed bucket tile. */
    planChip: () => string;
    /** A bucket cell's `+n` chip (#1267) — `+2`: the cell's tiles it has no room for. */
    tileMore: (p: { n: number; count: string }) => string;
    /** The chip's accessible name — `2 more events, Week of Jul 13, 2026, AM`: its cell's bucket and lane in words. */
    tileMoreLabel: (p: { n: number; count: string; bucket: string; lane: string | undefined }) => string;

    // ── Moves (#825) ───────────────────────────────────────────────────────
    /** How a keyboard reader moves an element — the description of every one that moves. */
    moveHelp: () => string;
    /** An element picked up with the keyboard — `target` its row's name, `span` where it is, in words. */
    movePickedUp: (p: { item: string; target: string; span: string }) => string;
    /** Where a carried element would land now. */
    moveOver: (p: { item: string; target: string; span: string }) => string;
    /** Where the canvas's `canDrop` refuses a carried element — and why, when the event kinds' drag says (#1196). */
    moveRefused: (p: { item: string; target: string; span: string; reason?: string | undefined }) => string;
    /** A carried element dropped. */
    moveDropped: (p: { item: string; target: string; span: string }) => string;
    /** A carried element whose move could not be written — nothing changed. */
    moveFailed: (p: { item: string }) => string;
    /** A carry cancelled — the element stays where it was. */
    moveCancelled: (p: { item: string }) => string;

    // ── The event kinds' drag and drop (#1196) ─────────────────────────────
    /**
     * What the ghost says a drop does — `Brochure run · Press A1 · Mon, Oct 12,
     * 2026`: what lands (a template's name, an event's title, or `3 events`),
     * where (a resource's name, or `Unassigned`), and the day it starts, its
     * time after it when it has one (`· 06:00`).
     */
    dropCaption: (p: { what: string; where: string; day: string; time: string | undefined }) => string;
    /** Why an event can't land on a row: its kind is placed on other resource kinds — `Needs presses`, their names lowercased; none, on no resource. */
    dropNeeds: (p: { resources: readonly string[] }) => string;
    /** Why an event can't change now: its kind's record is not read yet, or a Save of it is under way — `kind` its name. */
    dropBusy: (p: { kind: string }) => string;
    /** Why a drop the kind's own write refuses can't land. */
    dropRefused: () => string;
    /** An author's card over an event of its patch's kind — `Harbour Arts Society → Spring catalogue`. */
    dropCardOnEvent: (p: { card: string; event: string }) => string;
    /** An author's card anywhere but an event — `Drop a customer onto an event`: `fields` the fields its patch sets. */
    dropCardNeedsEvent: (p: { fields: readonly string[] }) => string;
    /** An author's card over an event of another kind — `Stops take no customer`: `kind` that kind's name, `fields` the fields the patch sets. */
    dropKindTakesNo: (p: { kind: string; fields: readonly string[] }) => string;
    /** An event over the Backlog tab, which unschedules it — `Spring catalogue → Backlog`. */
    dropUnschedule: (p: { what: string }) => string;
    /** An event over the Backlog tab whose kind has no backlog — its times are no Options: `Stops have no backlog`. */
    dropNoBacklog: (p: { kind: string }) => string;

    // ── The narrow layout (§10) ────────────────────────────────────────────
    /** The Groups tab. */
    tabGroups: () => string;
    /** The Rows tab. */
    tabRows: () => string;
    /** The Measures tab. */
    tabMeasures: () => string;
    /** A tab's count — `~` over a partial prefix. */
    tabCount: (p: { n: number; count: string; partial: boolean }) => string;
    /** The card and section for rows in no group. */
    otherRows: () => string;
    /** Back to the group list. */
    backToGroups: () => string;
    /** Back to every row. */
    backToAllRows: () => string;
    /** An empty row list. */
    noRows: () => string;
    /** More groups to show — `3 more groups · 24 rows`. */
    moreGroups: (p: { n: number; count: string; members: string | undefined }) => string;
    /** More rows to show. */
    moreRows: (p: { n: number; count: string }) => string;
    /** More measures to show. */
    moreMeasures: (p: { n: number; count: string }) => string;

    // ── Words for what the canvas shows by look (#819) ─────────────────────
    /** A lifecycle state. */
    state: (p: { state: PlanStateWord }) => string;
    /** A status tone — `warning`. */
    tone: (p: { tone: string }) => string;
    /** A status dot's accessible name — `Status: warning`. */
    status: (p: { tone: string }) => string;
    /** A span in words — `Jun 29, 2026 – Jul 27, 2026`. */
    span: (p: { from: string; to: string }) => string;
    /** A run bar's churn, in words. */
    movedTimes: (p: { n: number; count: string }) => string;
    /** A run bar's accessible name. */
    runName: (p: { label: string; span: string; state: string; quantity: string | undefined; moved: string | undefined; status: string | undefined }) => string;
    /** A span row's decision diamond's accessible name. */
    decisionName: (p: { at: string; applied: boolean }) => string;
    /** A bucket tile's accessible name. */
    tileName: (p: { label: string | undefined; bucket: string; lane: string | undefined; state: string; tone: string | undefined }) => string;
    /** A cards chip's accessible name. */
    chipName: (p: { label: string; span: string; state: string }) => string;
    /** An event mark's accessible name. */
    markName: (p: { label: string | undefined; kind: PlanMarkWord; applied: boolean; at: string }) => string;
    /** A heat cell's value — `91, at or above the warning threshold`. */
    heatValue: (p: { value: string; warn: boolean }) => string;
    /** A cell or bucket with no value. */
    noData: () => string;
    /** A weight bar's value — `60% booked, planned`. */
    weightValue: (p: { percent: string; planned: boolean }) => string;
    /** One segment of a composition — `booked 60%`: its fill tag, and its
     *  share (the author's in-bar label, else the share as a percent). */
    segmentPart: (p: { fill: string; share: string }) => string;
    /** Parts read out together — a composition's segments, a table cell's
     *  parts: `booked 60%, slack 25%`. */
    list: (p: { parts: readonly string[] }) => string;
    /** A table part with no value (the muted em-dash). */
    noValue: () => string;
    /** A range of two values — a band's `lo–hi`. */
    valueRange: (p: { from: string; to: string }) => string;
    /** A bucket-quantised element's accessible name — `Week of Jun 29, 2026: 72`. */
    cellName: (p: { bucket: string; value: string }) => string;
    /** A tone-strip block's value — `101, beyond threshold`. */
    toneValue: (p: { value: string; warn: boolean }) => string;
    /** A chart layer's name in the chart's summary — `line`, or `columns 2`
     *  when the chart has more than one of its kind. */
    chartLayer: (p: { kind: PlanChartLayerWord; index: string | undefined }) => string;
    /** A chart layer's values. */
    chartLayerValues: (p: { layer: string; min: string; max: string; last: string; n: number; breaches: string }) => string;
    /** A chart layer with no value in the window. */
    chartLayerEmpty: (p: { layer: string }) => string;
    /** A chart row's accessible name. */
    chartSummary: (p: { parts: readonly string[] }) => string;
    /** A chart row with no data layers. */
    chartNoData: () => string;

    // ── The live region (#819) ─────────────────────────────────────────────
    /** A row was selected. */
    announceSelected: (p: { label: string }) => string;
    /** The events selected on the canvas changed (#1197) — `3 events selected`; `n` 0 when the last left. */
    announceEvents: (p: { n: number; count: string }) => string;
    /** A section closed. */
    announceCollapsed: (p: { label: string }) => string;
    /** A section opened. */
    announceExpanded: (p: { label: string }) => string;
    /** A chart row changed height. */
    announceChart: (p: { label: string; expanded: boolean }) => string;
    /** A links focus opened. */
    announceLinked: (p: { label: string }) => string;
    /** An expand focus opened. */
    announceOpened: (p: { label: string }) => string;
    /** A row focus closed. */
    announceAllRows: () => string;
    /** The selection was cleared. */
    announceCleared: () => string;
    /** The grain changed. */
    announceGrain: (p: { grain: PlanGrainWord }) => string;
    /** The resolution changed. */
    announceResolution: (p: { resolution: string }) => string;
    /** A paged source's window landed — `Loaded elements 201–400 of 5,000`. */
    announceLanded: (p: { from: string; to: string; total: string | undefined }) => string;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

const HORIZON_UNIT: Record<PlanHorizonUnit, string> = {
    hour: "HR", day: "D", week: "WK", month: "MO", quarter: "Q", year: "YR", step: "STEPS",
};

const STATE_WORD: Record<PlanStateWord, string> = {
    estimated: "estimated",
    added: "proposed",
    recommended: "recommended",
    removed: "proposed removal",
    confirmed: "confirmed",
    "in-progress": "in progress",
    actual: "actual",
    rejected: "rejected",
};

/** A segment fill as the category its colour encodes. */
const FILL_WORD: Record<string, string> = {
    brand: "booked",
    success: "positive",
    warning: "caution",
    danger: "at risk",
    info: "info",
    neutral: "neutral",
    slack: "slack",
    free: "free",
};

const LAYER_WORD: Record<PlanChartLayerWord, string> = {
    line: "line", area: "area", column: "columns", scatter: "points", band: "range",
};

/** A family row's Tag (`Plan links.html`, #1258). */
const FOCUS_TAG: Record<PlanFocusTagWord, string> = {
    UPSTREAM: "Upstream", DOWNSTREAM: "Downstream", LINKED: "Linked",
};

/** The parts of a list that are there, comma-joined. */
const listed = (parts: ReadonlyArray<string | undefined>): string =>
    parts.filter((p): p is string => p !== undefined && p !== "").join(", ");

/** Words joined as English reads a list — `a`, `a or b`, `a, b or c` (`and` in place of `or` when asked). */
const joined = (words: readonly string[], last: "or" | "and"): string =>
    words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} ${last} ${words[words.length - 1]}`;

/** The fields a card's patch sets, as a noun — `customer`, `customer and stock` (an underscore a space); a patch that sets none, `card`. */
const fieldNoun = (fields: readonly string[]): string =>
    fields.length === 0 ? "card" : joined(fields.map((f) => f.replace(/_/g, " ")), "and");

/** A noun with its article — `a customer`, `an address`. */
const withArticle = (noun: string): string => `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;

/** A kind's name in the plural, as English makes one — `Stop` → `Stops`, `Delivery` → `Deliveries`; a name that ends in `s` stays. */
const pluralName = (name: string): string => {
    if (/s$/i.test(name)) return name;
    if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
    if (/(x|z|ch|sh)$/i.test(name)) return `${name}es`;
    return `${name}s`;
};

/**
 * The Plan's English messages — the default table.
 */
export const planMessages: PlanMessages = {
    ...editingMessages,
    ...timeMessages,
    gridLabel: () => "Plan",
    noWindow: () => "NO WINDOW — declare an axis window, or bind a slice whose range supplies it",
    noWindowOrdinal: () => "NO WINDOW — an ordinal axis needs at least one declared value",
    partName: ({ part }) => {
        switch (part.kind) {
            case "row": return `row ${part.label}`;
            case "group": return `group ${part.label}`;
            case "expandRender": return "expand render";
            case "expandGutter": return "expand gutter";
            case "linksLayer": return "links layer";
            case "popover": return "popover";
            case "hoverCard": return "hover card";
        }
    },
    partFailed: ({ part, message }) => `${part} could not render — ${message}`,
    axisMismatch: ({ found, expected }) => `AXIS MISMATCH — this row carries ${found} instants; the axis is ${expected}`,
    duplicateRow: ({ id }) => `DUPLICATE ID — an earlier row already has ${id}`,

    grainLabel: () => "Grain",
    grainName: ({ grain }) => grain.toUpperCase(),
    resolutionLabel: () => "Resolution",
    resolutionName: ({ resolution }) => resolution.toUpperCase(),
    summary: ({ result, total, n, active }) =>
        `${result} of ${total} rows${n > 0 ? ` · ${active} ${plural(n, "filter", "filters")}` : ""}`,
    summaryShort: ({ result, total }) => `${result} of ${total}`,
    scopeBadge: () => "loaded rows only",
    keySearch: () => "Search keys",
    overlaps: ({ n, count }) => `${count} ${plural(n, "overlap", "overlaps")}`,
    overlapsShort: ({ count }) => count,
    overlapsLabel: ({ n, count }) => `${count} ${plural(n, "overlap", "overlaps")} — select the first pair`,

    rowsSkipped: ({ n, count }) => `${count} ${plural(n, "row", "rows")} skipped`,
    rowsSkippedSeek: ({ n, count }) => `${count} ${plural(n, "row", "rows")} skipped — show the first`,
    sourceUnavailable: ({ reason }) => `source unavailable — ${reason}`,
    searchFailed: ({ reason }) => `search failed — ${reason}`,
    truncated: ({ count }) => `showing the first ${count} buckets — zoom in`,

    transportLoaded: ({ loaded, total }) => (total !== undefined ? `${loaded} loaded of ${total}` : `${loaded} loaded`),
    transportRange: ({ from, to, total }) => (total !== undefined ? `elements ${from}–${to} of ${total}` : `elements ${from}–${to}`),
    transportLoading: ({ line }) => `${line} · Loading…`,

    footerEvents: ({ n, count }) => `${count} ${plural(n, "event", "events")}`,
    footerBacklog: ({ count }) => `${count} in backlog`,
    footerPending: ({ count }) => `${count} pending`,
    footerSaved: ({ when }) => `saved ${when}`,

    libraryPane: () => "Library",
    libraryTab: ({ tab }) => (tab === "events" ? "Events" : tab === "backlog" ? "Backlog" : "Series"),
    libraryEmpty: ({ tab, name }) => (tab === "events" ? "No templates" : tab === "backlog" ? "Backlog clear"
        : tab === "series" ? "No series" : `Nothing in ${name}`),
    libraryEmptyHint: ({ tab, name }) => (tab === "events" ? "No event kind declares a template to drag in."
        : tab === "backlog" ? "Every event is scheduled."
            : tab === "series" ? "This plan shows nothing to hide."
                : `${name} lists nothing yet.`),
    libraryNoun: ({ tab, n }) => (tab === "events" ? plural(n, "template", "templates")
        : tab === "backlog" ? plural(n, "event", "events")
            : tab === "series" ? plural(n, "series", "series") : plural(n, "card", "cards")),
    libraryGroupBy: ({ tab }) => (tab === "events" ? "Kind" : tab === "backlog" ? "Due" : "Group"),
    templateGroup: ({ kind, group }) => (group !== undefined && group !== "" ? `${kind} · ${group}` : kind),
    templateLine: ({ kind, duration, resources }) =>
        [kind, duration, resources.length > 0 ? resources.join("/") : undefined]
            .filter((p): p is string => p !== undefined && p !== "").join(" · "),
    backlogLine: ({ duration, resource, due }) => [duration, resource ?? "Unassigned", due]
        .filter((p): p is string => p !== undefined && p !== "").join(" · "),
    backlogDue: ({ weekday, day }) => `due ${weekday} ${day}`,
    dueGroup: ({ due }) => (due === "thisWeek" ? "Due this week" : due === "nextWeek" ? "Due next week" : due === "later" ? "Later" : "No date"),
    duration: ({ hours, minutes }) => (hours === undefined ? `${minutes ?? "0"} m` : minutes === undefined ? `${hours} h` : `${hours} h ${minutes} m`),

    inspectorPane: () => "Inspector",
    inspectorEvents: ({ n, count }) => `${count} ${plural(n, "event", "events")}`,
    inspectorKindCount: ({ kind, count }) => `${kind} ×${count}`,
    inspectorWhen: ({ day, from, endDay, to }) => (to === undefined ? `${day} · ${from}`
        : endDay === undefined ? `${day} · ${from}–${to}` : `${day}, ${from} – ${endDay}, ${to}`),
    inspectorUnscheduled: () => "Not scheduled — in the backlog",
    inspectorSection: ({ section }) => ({
        fields: "Fields", bulk: "Edit all", window: "In the window", measures: "Measures",
    })[section],
    inspectorFact: ({ fact }) => ({
        resource: "Resource", start: "Start", end: "End", at: "At", lane: "Lane", state: "State", quantity: "Quantity",
        group: "Group", events: "Events", hours: "Hours", quantities: "Quantity",
    })[fact],
    inspectorUnassigned: () => "Unassigned",
    inspectorRow: () => "Row",
    inspectorAction: ({ action }) => (action === "duplicate" ? "Duplicate" : "Delete"),
    inspectorShift: ({ by, unit }) => `${by < 0 ? "−" : "+"}1 ${unit === "day" ? "d" : "h"}`,
    inspectorShiftLabel: () => "Shift",
    inspectorAt: ({ bucket }) => `At ${bucket}`,
    inspectorNoBucket: () => "Click the row's plot to read its measures at that bucket.",
    inspectorNoValue: () => "—",
    inspectorStat: ({ stat, n }) => ({
        events: plural(n, "Event", "Events"), hours: "Hours", backlog: "In backlog",
    })[stat],
    inspectorHint: ({ n }) => (n === 1 ? "Click an event to see it here — Shift, ⌘ or Ctrl adds another."
        : n === 2 ? "Click a row's plot to see the row and its measures at that bucket."
            : "Esc clears what is selected."),
    inspectorOverlaps: ({ n, count, on }) => `Overlaps ${count} ${plural(n, "event", "events")} on ${on}`,
    inspectorRowOverlaps: ({ n, count }) => `${count} ${plural(n, "overlap", "overlaps")}`,
    inspectorOverlapPair: ({ first, second }) => `${first} · ${second}`,

    horizon: ({ count, unit }) => `HORIZON · ${count} ${HORIZON_UNIT[unit]}`,
    now: () => "NOW",

    allRows: () => "← All rows",
    focusLinks: ({ label, upstream, downstream }) =>
        `Links · ${label}${upstream !== undefined && downstream !== undefined ? ` · ${upstream} upstream · ${downstream} downstream` : ""}`,
    focusExpanded: ({ label }) => `EXPANDED · ${label}`,
    focusTag: ({ tag }) => FOCUS_TAG[tag],
    linksControl: () => "Focus linked rows",
    expandControl: () => "Expand row",

    groupMeta: ({ n, count, partial }) => `${partial ? "~" : ""}${count} ${plural(n, "row", "rows")}`,
    hiddenRows: ({ n, count, what }) => `${count} hidden ${what}${n === 1 ? "" : "s"}`,
    bandLoading: ({ from, to }) => `Loading elements ${from}–${to}`,
    bandEarlier: ({ count }) => `${count} earlier elements — scroll to load`,
    bandLater: ({ count }) => `${count} more elements — scroll to load`,
    windowFailed: ({ from, to, reason }) => `Elements ${from}–${to} could not be read — ${reason}`,
    retry: () => "Retry",
    moved: ({ count }) => `moved ×${count}`,
    rollupCaption: ({ count, quantity }) =>
        [count !== undefined ? `×${count}` : undefined, quantity]
            .filter((p): p is string => p !== undefined && p !== "").join(" · "),
    quantity: ({ value, unit }) => (unit !== undefined && unit !== "" ? `${value} ${unit}` : value),
    quantities: ({ parts }) => parts.join(" · "),
    planChip: () => "plan",
    tileMore: ({ count }) => `+${count}`,
    tileMoreLabel: ({ n, count, bucket, lane }) => listed([`${count} more ${plural(n, "event", "events")}`, bucket, lane]),

    moveHelp: () =>
        "Press Space to pick it up. The arrow keys then move it — Shift with left or right moves its end, Alt its start — " +
        "Space drops it, and Escape cancels.",
    movePickedUp: ({ item, target, span }) => `Picked up ${item}: ${target}, ${span}`,
    moveOver: ({ item, target, span }) => `${item}: ${target}, ${span}`,
    moveRefused: ({ item, target, span, reason }) => `${item} cannot be dropped on ${target}, ${span}${reason !== undefined && reason !== "" ? ` — ${reason}` : ""}`,
    moveDropped: ({ item, target, span }) => `Dropped ${item} on ${target}, ${span}`,
    moveFailed: ({ item }) => `${item} could not be moved`,
    moveCancelled: ({ item }) => `${item} was not moved`,

    dropCaption: ({ what, where, day, time }) => `${what} · ${where} · ${time === undefined ? day : `${day} · ${time}`}`,
    dropNeeds: ({ resources }) => (resources.length === 0 ? "Goes on no resource" : `Needs ${joined(resources, "or")}`),
    dropBusy: ({ kind }) => `${kind} can't change now`,
    dropRefused: () => "Can't go here",
    dropCardOnEvent: ({ card, event }) => `${card} → ${event}`,
    dropCardNeedsEvent: ({ fields }) => `Drop ${withArticle(fieldNoun(fields))} onto an event`,
    dropKindTakesNo: ({ kind, fields }) => `${pluralName(kind)} take no ${fieldNoun(fields)}`,
    dropUnschedule: ({ what }) => `${what} → Backlog`,
    dropNoBacklog: ({ kind }) => `${pluralName(kind)} have no backlog`,

    tabGroups: () => "Groups",
    tabRows: () => "Rows",
    tabMeasures: () => "Measures",
    tabCount: ({ count, partial }) => `${partial ? "~" : ""}${count}`,
    otherRows: () => "Other rows",
    backToGroups: () => "← Groups",
    backToAllRows: () => "← All rows",
    noRows: () => "No rows",
    moreGroups: ({ n, count, members }) =>
        `${count} more ${plural(n, "group", "groups")}${members !== undefined ? ` · ${members}` : ""}`,
    moreRows: ({ n, count }) => `${count} more ${plural(n, "row", "rows")}`,
    moreMeasures: ({ n, count }) => `${count} more ${plural(n, "measure", "measures")}`,

    state: ({ state }) => STATE_WORD[state],
    tone: ({ tone }) => tone,
    status: ({ tone }) => `Status: ${tone}`,
    span: ({ from, to }) => `${from} – ${to}`,
    movedTimes: ({ n, count }) => `moved ${count} ${plural(n, "time", "times")}`,
    runName: ({ label, span, state, quantity, moved, status }) => listed([label, span, state, quantity, moved, status]),
    decisionName: ({ at, applied }) => `Decision, ${at}, ${applied ? "applied" : "pending"}`,
    tileName: ({ label, bucket, lane, state, tone }) => listed([label ?? "Event", bucket, lane, state, tone]),
    chipName: ({ label, span, state }) => listed([label, span, state]),
    markName: ({ label, kind, applied, at }) => {
        const what = kind === "decision" ? `decision, ${applied ? "applied" : "pending"}` : kind;
        return label !== undefined
            ? listed([label, what, at])
            : listed([what.charAt(0).toUpperCase() + what.slice(1), at]);
    },
    heatValue: ({ value, warn }) => (warn ? `${value}, at or above the warning threshold` : value),
    noData: () => "no data",
    weightValue: ({ percent, planned }) => `${percent} booked${planned ? ", planned" : ""}`,
    segmentPart: ({ fill, share }) => `${FILL_WORD[fill] ?? fill} ${share}`,
    list: ({ parts }) => parts.join(", "),
    noValue: () => "no value",
    valueRange: ({ from, to }) => `${from}–${to}`,
    cellName: ({ bucket, value }) => `${bucket}: ${value}`,
    toneValue: ({ value, warn }) => (warn ? `${value}, beyond threshold` : value),
    chartLayer: ({ kind, index }) => (index !== undefined ? `${LAYER_WORD[kind]} ${index}` : LAYER_WORD[kind]),
    chartLayerValues: ({ layer, min, max, last, n, breaches }) =>
        `${layer} min ${min}, max ${max}, last ${last}${n > 0 ? `, ${breaches} beyond threshold` : ""}`,
    chartLayerEmpty: ({ layer }) => `${layer} no data in the window`,
    chartSummary: ({ parts }) => `Chart: ${parts.join("; ")}`,
    chartNoData: () => "Chart: no data",

    announceSelected: ({ label }) => `Selected ${label}`,
    announceEvents: ({ n, count }) => (n === 0 ? "No event selected" : `${count} ${plural(n, "event", "events")} selected`),
    announceCollapsed: ({ label }) => `${label} collapsed`,
    announceExpanded: ({ label }) => `${label} expanded`,
    announceChart: ({ label, expanded }) => `${label} chart ${expanded ? "expanded" : "collapsed"}`,
    announceLinked: ({ label }) => `Showing rows linked to ${label}`,
    announceOpened: ({ label }) => `${label} opened in place`,
    announceAllRows: () => "Showing all rows",
    announceCleared: () => "Selection cleared",
    announceGrain: ({ grain }) => `Grain: ${grain}`,
    announceResolution: ({ resolution }) => `Resolution: ${resolution}`,
    announceLanded: ({ from, to, total }) =>
        (total !== undefined ? `Loaded elements ${from}–${to} of ${total}` : `Loaded elements ${from}–${to}`),
};

const PlanMessagesContext = createContext<PlanMessages>(planMessages);

/**
 * The message table in effect — {@link planMessages} with every
 * {@link PlanMessagesProvider} above overriding it.
 *
 * @returns The table
 */
export function usePlanMessages(): PlanMessages {
    return useContext(PlanMessagesContext);
}

/** Props of {@link PlanMessagesProvider}. */
export interface PlanMessagesProviderProps {
    /** The messages to override — any subset; the rest come from the table above. */
    messages: Partial<PlanMessages>;
    /** The subtree the overrides apply to. */
    children?: ReactNode;
}

/**
 * Override the Plan's words for a subtree — a translation, or a house style.
 * Providers nest: each overrides the table the one above it resolved.
 *
 * @remarks
 * The overrides are read by identity: define them once (module scope, or a
 * memo), as below. A new object on every render hands every canvas beneath
 * a new table, and each re-derives all of its words.
 *
 * @param props - The overrides and the subtree
 * @returns The provider
 *
 * @example
 * ```tsx
 * const GERMAN: Partial<PlanMessages> = {
 *     allRows: () => "← Alle Zeilen",
 *     tabRows: () => "Zeilen",
 *     groupMeta: ({ count, partial }) => `${partial ? "~" : ""}${count} Zeilen`,
 * };
 *
 * <I18nProvider locale="de-DE">
 *     <PlanMessagesProvider messages={GERMAN}>
 *         <EastChakraComponent value={plan} />
 *     </PlanMessagesProvider>
 * </I18nProvider>
 * ```
 */
export function PlanMessagesProvider({ messages, children }: PlanMessagesProviderProps) {
    const parent = usePlanMessages();
    const value = useMemo(() => ({ ...parent, ...messages }), [parent, messages]);
    return createElement(PlanMessagesContext.Provider, { value }, children);
}
