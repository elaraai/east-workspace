/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Every word the Plan says itself (#820) — ONE typed message table. The
 * canvas's own chrome (the toolbar, the footer, the diagnostics, the bands,
 * the narrow layout's tabs and cards, the review buttons), the words it gives
 * a reader for what it shows only by shape or colour, and what its live
 * region announces all come from here. What the AUTHOR wrote — a row's label,
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
import { editingMessages, type EditingMessages } from "../../editing/messages.js";

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
 * canvas's history bar where it translates the canvas.
 */
export interface PlanMessages extends EditingMessages {
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
    /** The resolution segment's (and the narrow resolution chip's) accessible name. */
    resolutionLabel: () => string;
    /** A time resolution's name — its segment and the narrow chip. */
    resolutionName: (p: { resolution: string }) => string;
    /** The slice summary line — `6 of 36 · 2 narrowings`. */
    summary: (p: { result: string; total: string; n: number; active: string }) => string;
    /** The badge on narrowing chrome that sees only the loaded prefix. */
    scopeBadge: () => string;
    /** The series library button's text, and its popover's heading. */
    seriesButton: () => string;
    /** The series library button's accessible name. */
    seriesLibrary: () => string;
    /** How many series show — the library popover's count. */
    seriesCount: (p: { shown: string; total: string }) => string;

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

    // ── The horizon, the ruler, the axis in words ──────────────────────────
    /** The horizon strip's caption — `HORIZON · 26 WK`. */
    horizon: (p: { n: number; count: string; unit: PlanHorizonUnit }) => string;
    /** The ruler's now chip. */
    now: () => string;
    /** A week tick — `W27`. */
    rulerWeek: (p: { week: string }) => string;
    /** A quarter tick — `Q3`. */
    rulerQuarter: (p: { quarter: string }) => string;
    /** A week as words — `Week of Jun 29, 2026`. */
    periodWeek: (p: { date: string }) => string;
    /** A quarter as words — `Q3 2026`. */
    periodQuarter: (p: { quarter: string; year: string }) => string;

    // ── Row focus (R1 / R2) ────────────────────────────────────────────────
    /** The focus band's way back. */
    allRows: () => string;
    /** The links focus caption — `LINKS · M-214 · 4 UPSTREAM · 6 DOWNSTREAM`;
     *  `label` is the focused row's gutter label. */
    focusLinks: (p: { label: string; upstream: string | undefined; downstream: string | undefined }) => string;
    /** The expand focus caption — `label` is the focused row's gutter label. */
    focusExpanded: (p: { label: string }) => string;
    /** A row's family tag under a links focus. */
    focusTag: (p: { tag: PlanFocusTagWord }) => string;
    /** The links-focus control's accessible name. */
    linksControl: () => string;
    /** The expand control's accessible name. */
    expandControl: () => string;

    // ── Rows and bands ─────────────────────────────────────────────────────
    /** A group's derived member count — `8 rs`, or `~8 rs` while it covers only
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
    /** A rollup band's caption — `×2 · 208 t`. Always exact: a span parent
     *  rolls up one entry's subtree, which a window holds whole (#822). */
    rollupCaption: (p: { count: string | undefined; quantity: string | undefined }) => string;
    /** A quantity's caption — `96 t` (#824): `value` is already formatted,
     *  through the quantity's own format; `unit` is the author's, when declared. */
    quantity: (p: { value: string; unit: string | undefined }) => string;
    /** Totals in several units, read together — a rollup band's `208 t · 12 h`. */
    quantities: (p: { parts: readonly string[] }) => string;
    /** The resting chip of a proposed bucket tile. */
    planChip: () => string;

    // ── Review ─────────────────────────────────────────────────────────────
    /** A row's approve button. */
    approve: () => string;
    /** A row's reject button. */
    reject: () => string;
    /** The batch foot's approve-all button. */
    approveAll: () => string;
    /** The batch foot's reject-all button. */
    rejectAll: () => string;
    /** The batch foot's approve-all button on a paged canvas, where it covers
     *  the loaded rows (#880) — `Approve 120 loaded`. */
    approveLoaded: (p: { n: number; count: string }) => string;
    /** The batch foot's reject-all button on a paged canvas. */
    rejectLoaded: (p: { n: number; count: string }) => string;

    // ── Moves (#825) ───────────────────────────────────────────────────────
    /** How a keyboard reader moves an element — the description of every one that moves. */
    moveHelp: () => string;
    /** An element picked up with the keyboard — `target` its row's name, `span` where it is, in words. */
    movePickedUp: (p: { item: string; target: string; span: string }) => string;
    /** Where a carried element would land now. */
    moveOver: (p: { item: string; target: string; span: string }) => string;
    /** Where the canvas's `canDrop` refuses a carried element. */
    moveRefused: (p: { item: string; target: string; span: string }) => string;
    /** A carried element dropped. */
    moveDropped: (p: { item: string; target: string; span: string }) => string;
    /** A carried element whose move could not be written — nothing changed. */
    moveFailed: (p: { item: string }) => string;
    /** A carry cancelled — the element stays where it was. */
    moveCancelled: (p: { item: string }) => string;

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
    /** More groups to show — `3 more groups · 24 rs`. */
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

/** The parts of a list that are there, comma-joined. */
const listed = (parts: ReadonlyArray<string | undefined>): string =>
    parts.filter((p): p is string => p !== undefined && p !== "").join(", ");

/**
 * The Plan's English messages — the default table.
 */
export const planMessages: PlanMessages = {
    ...editingMessages,
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
        `${result} of ${total}${n > 0 ? ` · ${active} ${plural(n, "narrowing", "narrowings")}` : ""}`,
    scopeBadge: () => "loaded rows only",
    seriesButton: () => "Series",
    seriesLibrary: () => "Series library",
    seriesCount: ({ shown, total }) => `${shown} of ${total}`,

    rowsSkipped: ({ n, count }) => `${count} ${plural(n, "row", "rows")} skipped`,
    rowsSkippedSeek: ({ n, count }) => `${count} ${plural(n, "row", "rows")} skipped — show the first`,
    sourceUnavailable: ({ reason }) => `source unavailable — ${reason}`,
    searchFailed: ({ reason }) => `search failed — ${reason}`,
    truncated: ({ count }) => `showing the first ${count} buckets — zoom in`,

    transportLoaded: ({ loaded, total }) => (total !== undefined ? `${loaded} loaded of ${total}` : `${loaded} loaded`),
    transportRange: ({ from, to, total }) => (total !== undefined ? `elements ${from}–${to} of ${total}` : `elements ${from}–${to}`),
    transportLoading: ({ line }) => `${line} · Loading…`,

    horizon: ({ count, unit }) => `HORIZON · ${count} ${HORIZON_UNIT[unit]}`,
    now: () => "NOW",
    rulerWeek: ({ week }) => `W${week}`,
    rulerQuarter: ({ quarter }) => `Q${quarter}`,
    periodWeek: ({ date }) => `Week of ${date}`,
    periodQuarter: ({ quarter, year }) => `Q${quarter} ${year}`,

    allRows: () => "← ALL ROWS",
    focusLinks: ({ label, upstream, downstream }) =>
        `LINKS · ${label}${upstream !== undefined && downstream !== undefined ? ` · ${upstream} UPSTREAM · ${downstream} DOWNSTREAM` : ""}`,
    focusExpanded: ({ label }) => `EXPANDED · ${label}`,
    focusTag: ({ tag }) => tag,
    linksControl: () => "Focus linked rows",
    expandControl: () => "Expand row",

    groupMeta: ({ count, partial }) => `${partial ? "~" : ""}${count} rs`,
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

    approve: () => "Approve",
    reject: () => "Reject",
    approveAll: () => "Approve all",
    rejectAll: () => "Reject all",
    approveLoaded: ({ count }) => `Approve ${count} loaded`,
    rejectLoaded: ({ count }) => `Reject ${count} loaded`,

    moveHelp: () =>
        "Press Space to pick it up. The arrow keys then move it — Shift with left or right moves its end, Alt its start — " +
        "Space drops it, and Escape cancels.",
    movePickedUp: ({ item, target, span }) => `Picked up ${item}: ${target}, ${span}`,
    moveOver: ({ item, target, span }) => `${item}: ${target}, ${span}`,
    moveRefused: ({ item, target, span }) => `${item} cannot be dropped on ${target}, ${span}`,
    moveDropped: ({ item, target, span }) => `Dropped ${item} on ${target}, ${span}`,
    moveFailed: ({ item }) => `${item} could not be moved`,
    moveCancelled: ({ item }) => `${item} was not moved`,

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
 *     allRows: () => "← ALLE ZEILEN",
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
