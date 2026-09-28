/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the canvas SAYS (#819) — the text alternative of every element and
 * colour-only cell, and the live region's announcements. Pure: the renderers
 * put these strings on `aria-label`s and visually hidden text, and the
 * canvas's live region reads them out.
 *
 * Every mark on a Plan encodes something by shape, position or colour: a run
 * bar's state is its fill, a heat cell's value its depth, a segment's category
 * its colour, a chart's shape its values. A screen reader gets none of that,
 * so each gets words — the element's own label, where it sits on the axis in
 * words (`scale.instantText` / `scale.bucketText`, never the ruler tick), and
 * the fact its look encodes.
 *
 * The words are the canvas's (#820): every phrase comes from its message
 * table, and every number and date is in its locale.
 *
 * @packageDocumentation
 */

import { type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import type { PlanScale, PlanBucket } from "./scale.js";
import type { PlanEvent, PlanUiState, RowKey } from "./plan-state.js";
import type { PlanWords } from "./words.js";
import type { TickFormatOpt } from "../../format/index.js";
import { quantityText } from "./quantity.js";
import { axisFormatter, breached, readoutLayers, type ChartKindValue } from "./rows/chart-geometry.js";

type RunValue = ValueTypeOf<typeof Plan.Types.Run>;
type ChipValue = ValueTypeOf<typeof Plan.Types.Chip>;
type EventMarkValue = ValueTypeOf<typeof Plan.Types.EventMark>;
type DecisionValue = ValueTypeOf<typeof Plan.Types.DecisionMark>;
type BucketEventValue = ValueTypeOf<typeof Plan.Types.BucketEvent>;
type SegmentValue = ValueTypeOf<typeof Plan.Types.Segment>;

/** An element's lifecycle state (`EventStateType`). */
export type PlanStateValue = RunValue["state"];

/**
 * A lifecycle state in words — what a bar's fill, a tile's chip or a card's
 * outline says by look.
 *
 * @param state - The element's state
 * @param w - The canvas's words
 * @returns The words — `proposed removal`
 */
export function stateText(state: PlanStateValue, w: PlanWords): string {
    return w.m.state({ state: state.type === "proposed" ? state.value.type : state.type });
}

/**
 * A status tone as the accessible name of the dot or icon that shows it.
 *
 * @param tone - The status tag (`warning`, `danger`, …)
 * @param w - The canvas's words
 * @returns `Status: warning`
 */
export function statusText(tone: string, w: PlanWords): string {
    return w.m.status({ tone: w.m.tone({ tone }) });
}

/** `from – to`, in the axis's words. */
function spanText(scale: PlanScale, from: RunValue["start"], to: RunValue["end"], w: PlanWords): string {
    return w.m.span({ from: scale.instantText(from), to: scale.instantText(to) });
}

/**
 * A run bar's accessible name — its label, its span, its state, and what its
 * look adds: the quantity caption (#824), the `moved ×k` counter, the stuck
 * ring's status.
 *
 * @param run - The run
 * @param scale - The shared scale
 * @param w - The canvas's words
 * @returns `B-214, Jun 29, 2026 – Jul 27, 2026, actual, 96 t`
 */
export function runName(run: RunValue, scale: PlanScale, w: PlanWords): string {
    const moved = run.moved.type === "some" ? Number(run.moved.value) : 0;
    return w.m.runName({
        label: run.label,
        span: spanText(scale, run.start, run.end, w),
        state: stateText(run.state, w),
        quantity: run.quantity.type === "some" ? quantityText(run.quantity.value, w) : undefined,
        moved: moved > 0 ? w.m.movedTimes({ n: moved, count: w.number(moved) }) : undefined,
        status: run.status.type === "some" ? w.m.tone({ tone: run.status.value.type }) : undefined,
    });
}

/**
 * A span row's decision diamond — where it sits, and whether it is applied
 * (◆) or pending (◇).
 *
 * @param dec - The decision mark
 * @param scale - The shared scale
 * @param w - The canvas's words
 * @returns `Decision, Jul 13, 2026, applied`
 */
export function decisionName(dec: DecisionValue, scale: PlanScale, w: PlanWords): string {
    return w.m.decisionName({ at: scale.instantText(dec.at), applied: dec.applied });
}

/**
 * A bucket tile's accessible name — its label (or `Event` for the resting
 * ✓ / `plan` chip), its bucket, its lane caption, its state and tone.
 *
 * @param ev - The bucket event
 * @param bucket - The bucket it renders in
 * @param lane - Its lane's caption, when the lane has one
 * @param scale - The shared scale
 * @param w - The canvas's words
 * @returns `Pour, Week of Jul 6, 2026, AM, proposed`
 */
export function tileName(ev: BucketEventValue, bucket: PlanBucket, lane: string | undefined, scale: PlanScale, w: PlanWords): string {
    return w.m.tileName({
        label: ev.label.type === "some" ? ev.label.value : undefined,
        bucket: scale.bucketText(bucket),
        lane,
        state: stateText(ev.state, w),
        tone: ev.tone.type === "some" ? w.m.tone({ tone: ev.tone.value.type }) : undefined,
    });
}

/**
 * A cards chip's accessible name — its label, the buckets it spans, its state.
 *
 * @param chip - The chip
 * @param scale - The shared scale
 * @param w - The canvas's words
 * @returns `D. OKAFOR, Jun 29, 2026 – Jul 13, 2026, confirmed`
 */
export function chipName(chip: ChipValue, scale: PlanScale, w: PlanWords): string {
    return w.m.chipName({ label: chip.label, span: spanText(scale, chip.from, chip.to, w), state: stateText(chip.state, w) });
}

/**
 * An event mark's accessible name — its label, its kind (the glyph's
 * meaning: ● milestone, ◇/◆ decision, ▲ exception) and its instant.
 *
 * @param mark - The event mark
 * @param scale - The shared scale
 * @param w - The canvas's words
 * @returns `KICKOFF, milestone, Jun 29, 2026`
 */
export function markName(mark: EventMarkValue, scale: PlanScale, w: PlanWords): string {
    return w.m.markName({
        label: mark.label.type === "some" ? mark.label.value : undefined,
        kind: mark.kind.type,
        applied: mark.kind.type === "decision" && mark.kind.value.applied,
        at: scale.instantText(mark.at),
    });
}

/**
 * A heat cell's value in words — the depth its colour encodes. The author's
 * printed label wins, then the value; a cell with none is `no data` (the 45°
 * hatch).
 *
 * @param value - The cell's value
 * @param label - The author's printed label
 * @param warn - Whether the value is at or above the row's warning threshold (the ring)
 * @param w - The canvas's words
 * @returns `72` / `no data` / `91, at or above the warning threshold`
 */
export function heatValueText(value: number | undefined, label: string | undefined, warn: boolean, w: PlanWords): string {
    if (value === undefined) return w.m.noData();
    return w.m.heatValue({ value: label ?? w.number(value), warn });
}

/**
 * A weight bar's value in words — the booked fraction its width encodes, and
 * the pale planned treatment.
 *
 * @param fraction - The booked fraction (0–1)
 * @param planned - Whether the bucket is planned
 * @param w - The canvas's words
 * @param format - How the fraction prints — the arm's declared `format` (#824); a percent without one
 * @returns `60% booked, planned`
 */
export function weightValueText(fraction: number, planned: boolean, w: PlanWords, format?: TickFormatOpt): string {
    const clamped = Math.max(0, Math.min(1, fraction));
    return w.m.weightValue({ percent: format !== undefined ? w.value(clamped, format) : w.percent(clamped), planned });
}

/**
 * A segment composition in words — each segment's category (its fill) and
 * its share, the author's in-bar label standing for the share where given.
 *
 * @param segments - The cell's segments, in order
 * @param w - The canvas's words
 * @param format - How a share prints — the arm's declared `format` (#824); a percent without one
 * @returns `booked 60%, slack 25%, free 15%`
 */
export function segmentsText(segments: readonly SegmentValue[], w: PlanWords, format?: TickFormatOpt): string {
    const total = segments.reduce((acc, s) => acc + Math.max(0, s.weight), 0);
    if (segments.length === 0 || total <= 0) return w.m.noData();
    return w.m.list({
        parts: segments.map((s) => {
            const share = Math.max(0, s.weight) / total;
            return w.m.segmentPart({
                fill: s.fill.type,
                share: s.label.type === "some" ? s.label.value
                    : format !== undefined ? w.value(share, format) : w.percent(share),
            });
        }),
    });
}

/**
 * A table cell's parts in words — the numerals it prints, with the muted
 * em-dash of a missing value said as `no value`.
 *
 * @param texts - Each part's printed text, in series order
 * @param w - The canvas's words
 * @returns `1,204, 96%`
 */
export function tablePartsText(texts: readonly string[], w: PlanWords): string {
    return w.m.list({ parts: texts.map((t) => (t === "—" ? w.m.noValue() : t)) });
}

/**
 * A bucket-quantised element's accessible name — the bucket in words, then
 * what the element says about it.
 *
 * @param scale - The shared scale
 * @param bucket - The element's bucket
 * @param value - The element's value in words
 * @param w - The canvas's words
 * @returns `Week of Jul 6, 2026: 72`
 */
export function cellName(scale: PlanScale, bucket: PlanBucket, value: string, w: PlanWords): string {
    return w.m.cellName({ bucket: scale.bucketText(bucket), value });
}

/**
 * A chart row's text alternative — its summary as a `role="img"` label: each
 * data layer's minimum, maximum and last value inside the window, by its
 * axis's format, and how many of its points breach a declared threshold (the
 * warn marks say that by colour alone).
 *
 * @param kind - The chart row
 * @param scale - The shared scale
 * @param w - The canvas's words
 * @returns `Chart: line min 1.2, max 4.5, last 3.1; columns min 0, max 12, last 7, 2 beyond threshold`
 */
export function chartSummary(kind: ChartKindValue, scale: PlanScale, w: PlanWords): string {
    const layers = readoutLayers(kind);
    if (layers.length === 0) return w.m.chartNoData();
    const counts = new Map<string, number>();
    for (const l of layers) counts.set(l.kind, (counts.get(l.kind) ?? 0) + 1);
    const seen = new Map<string, number>();
    const format = {
        left: axisFormatter(kind.left.type === "some" ? kind.left.value : undefined, w.locale),
        right: axisFormatter(kind.right.type === "some" ? kind.right.value : undefined, w.locale),
    };
    const parts = layers.map(({ index, kind: k }) => {
        const n = (seen.get(k) ?? 0) + 1;
        seen.set(k, n);
        const name = w.m.chartLayer({ kind: k, index: (counts.get(k) ?? 0) > 1 ? w.number(n) : undefined });
        const layer = kind.layers[index]!;
        if (layer.type === "band") {
            const fmt = format[layer.value.axis.type];
            let lo = Infinity;
            let hi = -Infinity;
            let last: { t: number; text: string } | undefined;
            for (const p of layer.value.points) {
                if (scale.bucketOf(p.t) < 0 || !Number.isFinite(p.lo) || !Number.isFinite(p.hi)) continue;
                if (p.lo < lo) lo = p.lo;
                if (p.hi > hi) hi = p.hi;
                const at = scale.toNumber(p.t);
                if (last === undefined || at >= last.t) last = { t: at, text: w.m.valueRange({ from: fmt(p.lo), to: fmt(p.hi) }) };
            }
            return last === undefined
                ? w.m.chartLayerEmpty({ layer: name })
                : w.m.chartLayerValues({ layer: name, min: fmt(lo), max: fmt(hi), last: last.text, n: 0, breaches: w.number(0) });
        }
        if (layer.type === "refLine" || layer.type === "refBand" || layer.type === "refDot") return name;
        const fmt = format[layer.value.axis.type];
        const threshold = (layer.type === "line" || layer.type === "column") && layer.value.breach.type === "some"
            ? layer.value.breach.value : undefined;
        let lo = Infinity;
        let hi = -Infinity;
        let breaches = 0;
        let last: { t: number; y: number } | undefined;
        for (const p of layer.value.points) {
            if (scale.bucketOf(p.t) < 0 || !Number.isFinite(p.y)) continue;
            if (p.y < lo) lo = p.y;
            if (p.y > hi) hi = p.y;
            if (breached(p.y, threshold)) breaches += 1;
            const at = scale.toNumber(p.t);
            if (last === undefined || at >= last.t) last = { t: at, y: p.y };
        }
        if (last === undefined) return w.m.chartLayerEmpty({ layer: name });
        return w.m.chartLayerValues({
            layer: name, min: fmt(lo), max: fmt(hi), last: fmt(last.y), n: breaches, breaches: w.number(breaches),
        });
    });
    return w.m.chartSummary({ parts });
}

/**
 * What an interaction changed, as the live region says it (#819) — a
 * selection, a section or chart opening or closing, a row focus coming or
 * going, a grain change. Judged from the UI state before and after the
 * interaction, so an event that moved nothing (re-selecting the selected
 * row, an esc with nothing to clear) says nothing.
 *
 * @param e - The interaction
 * @param before - The UI state before it
 * @param after - The UI state after it
 * @param label - A row's name (its gutter label)
 * @param w - The canvas's words
 * @returns The announcement, or `undefined`
 */
export function announcementOf(
    e: PlanEvent,
    before: PlanUiState,
    after: PlanUiState,
    label: (key: RowKey) => string,
    w: PlanWords,
): string | undefined {
    const focusGone = before.focus !== null && after.focus === null;
    switch (e.t) {
        case "row.select":
            return after.selected !== null && after.selected !== before.selected
                ? w.m.announceSelected({ label: label(after.selected) })
                : undefined;
        case "group.toggle":
            if (after.collapsed === before.collapsed) return undefined;
            return after.collapsed.has(e.key)
                ? w.m.announceCollapsed({ label: label(e.key) })
                : w.m.announceExpanded({ label: label(e.key) });
        case "chart.toggle":
            return w.m.announceChart({ label: label(e.key), expanded: after.chartsExpanded.has(e.key) });
        case "focus.links":
            if (after.focus?.kind === "links" && after.focus.key === e.key) return w.m.announceLinked({ label: label(e.key) });
            return focusGone ? w.m.announceAllRows() : undefined;
        case "focus.expand":
            if (after.focus?.kind === "expand" && after.focus.key === e.key) return w.m.announceOpened({ label: label(e.key) });
            return focusGone ? w.m.announceAllRows() : undefined;
        case "focus.clear":
            return focusGone ? w.m.announceAllRows() : undefined;
        case "grain.set":
            return after.grain !== before.grain ? w.m.announceGrain({ grain: after.grain }) : undefined;
        case "key":
            switch (e.key) {
                case "esc":
                    if (focusGone) return w.m.announceAllRows();
                    return before.selected !== null && after.selected === null ? w.m.announceCleared() : undefined;
                case "g":
                    return after.grain !== before.grain ? w.m.announceGrain({ grain: after.grain }) : undefined;
                case "n": case "[": case "]":
                    return undefined;
            }
            return undefined;
        case "brush.down": case "brush.commit": case "brush.clear": case "brush.up":
        case "resolution.set": case "pan":
            // The window and the resolution are the slice's: the controller
            // says a resolution change from the scale after the write, since
            // the event alone cannot know whether the write took.
            return undefined;
    }
}

/** The span of source elements a paged canvas holds (`PlanPagingSnapshot.resident`). */
export interface PlanResidentSpan {
    /** First resident element (0-based). */
    from: number;
    /** Last resident element (EXCLUSIVE). */
    to: number;
}

/**
 * What a window landing adds, as the live region says it — the elements that
 * became resident, 1-based like the transport line. Eviction (the run
 * shrinking) and an unmoved run say nothing.
 *
 * @param before - The resident span before
 * @param after - The resident span now
 * @param total - The source's element count, once known
 * @param w - The canvas's words
 * @returns `Loaded elements 201–400 of 5,000`, or `undefined` when nothing landed
 */
export function landedText(
    before: PlanResidentSpan | undefined,
    after: PlanResidentSpan | undefined,
    total: number | undefined,
    w: PlanWords,
): string | undefined {
    if (after === undefined || after.to <= after.from) return undefined;
    let from: number;
    let to: number;
    if (before === undefined || after.from >= before.to || after.to <= before.from) {
        // A first landing, or a rebase onto a disjoint run.
        from = after.from;
        to = after.to;
    } else if (after.from < before.from && after.to > before.to) {
        from = after.from;
        to = after.to;
    } else if (after.from < before.from) {
        from = after.from;
        to = before.from;
    } else if (after.to > before.to) {
        from = before.to;
        to = after.to;
    } else {
        return undefined;
    }
    return w.m.announceLanded({
        from: w.number(from + 1),
        to: w.number(to),
        total: total !== undefined ? w.number(total) : undefined,
    });
}
