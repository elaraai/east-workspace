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
 * @packageDocumentation
 */

import { type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import type { PlanScale, PlanBucket } from "./scale.js";
import type { PlanEvent, PlanUiState, RowKey } from "./plan-state.js";
import { formatDerived } from "./format.js";
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
 * @returns The words
 */
export function stateText(state: PlanStateValue): string {
    switch (state.type) {
        case "estimated": return "estimated";
        case "proposed":
            switch (state.value.type) {
                case "added": return "proposed";
                case "recommended": return "recommended";
                case "removed": return "proposed removal";
            }
            return "proposed";
        case "confirmed": return "confirmed";
        case "in-progress": return "in progress";
        case "actual": return "actual";
        case "rejected": return "rejected";
    }
}

/**
 * A status tone as the accessible name of the dot or icon that shows it.
 *
 * @param tone - The status tag (`warning`, `danger`, …)
 * @returns `Status: warning`
 */
export function statusText(tone: string): string {
    return `Status: ${tone}`;
}

/** `from – to`, in the axis's words. */
function spanText(scale: PlanScale, from: RunValue["start"], to: RunValue["end"]): string {
    return `${scale.instantText(from)} – ${scale.instantText(to)}`;
}

/**
 * A run bar's accessible name — its label, its span, its state, and what its
 * look adds: the quantity suffix, the `moved ×k` counter, the stuck ring's
 * status.
 *
 * @param run - The run
 * @param scale - The shared scale
 * @returns `B-214, 29 Jun 2026 – 27 Jul 2026, actual, 96 t`
 */
export function runName(run: RunValue, scale: PlanScale): string {
    const parts = [run.label, spanText(scale, run.start, run.end), stateText(run.state)];
    if (run.quantity.type === "some") parts.push(run.quantity.value);
    const moved = run.moved.type === "some" ? Number(run.moved.value) : 0;
    if (moved > 0) parts.push(`moved ${moved} ${moved === 1 ? "time" : "times"}`);
    if (run.status.type === "some") parts.push(run.status.value.type);
    return parts.join(", ");
}

/**
 * A span row's decision diamond — where it sits, and whether it is applied
 * (◆) or pending (◇).
 *
 * @param dec - The decision mark
 * @param scale - The shared scale
 * @returns `Decision, 13 Jul 2026, applied`
 */
export function decisionName(dec: DecisionValue, scale: PlanScale): string {
    return `Decision, ${scale.instantText(dec.at)}, ${dec.applied ? "applied" : "pending"}`;
}

/**
 * A bucket tile's accessible name — its label (or `Event` for the resting
 * ✓ / `plan` chip), its bucket, its lane caption, its state and tone.
 *
 * @param ev - The bucket event
 * @param bucket - The bucket it renders in
 * @param lane - Its lane's caption, when the lane has one
 * @param scale - The shared scale
 * @returns `Pour, Week of 6 Jul 2026, AM, proposed`
 */
export function tileName(ev: BucketEventValue, bucket: PlanBucket, lane: string | undefined, scale: PlanScale): string {
    const parts = [ev.label.type === "some" ? ev.label.value : "Event", scale.bucketText(bucket)];
    if (lane !== undefined) parts.push(lane);
    parts.push(stateText(ev.state));
    if (ev.tone.type === "some") parts.push(ev.tone.value.type);
    return parts.join(", ");
}

/**
 * A cards chip's accessible name — its label, the buckets it spans, its state.
 *
 * @param chip - The chip
 * @param scale - The shared scale
 * @returns `D. OKAFOR, 29 Jun 2026 – 13 Jul 2026, confirmed`
 */
export function chipName(chip: ChipValue, scale: PlanScale): string {
    return [chip.label, spanText(scale, chip.from, chip.to), stateText(chip.state)].join(", ");
}

/**
 * An event mark's accessible name — its label, its kind (the glyph's
 * meaning: ● milestone, ◇/◆ decision, ▲ exception) and its instant.
 *
 * @param mark - The event mark
 * @param scale - The shared scale
 * @returns `KICKOFF, milestone, 29 Jun 2026`
 */
export function markName(mark: EventMarkValue, scale: PlanScale): string {
    const kind = mark.kind.type === "decision"
        ? `decision, ${mark.kind.value.applied ? "applied" : "pending"}`
        : mark.kind.type;
    const parts = mark.label.type === "some" ? [mark.label.value, kind] : [kind.charAt(0).toUpperCase() + kind.slice(1)];
    parts.push(scale.instantText(mark.at));
    return parts.join(", ");
}

/**
 * A heat cell's value in words — the depth its colour encodes. The author's
 * printed label wins, then the value; a cell with none is `no data` (the 45°
 * hatch).
 *
 * @param value - The cell's value
 * @param label - The author's printed label
 * @param warn - Whether the value is at or above the row's warning threshold (the ring)
 * @returns `72` / `no data` / `91, at or above the warning threshold`
 */
export function heatValueText(value: number | undefined, label: string | undefined, warn: boolean): string {
    if (value === undefined) return "no data";
    const text = label ?? formatDerived(value);
    return warn ? `${text}, at or above the warning threshold` : text;
}

/**
 * A weight bar's value in words — the booked fraction its width encodes, and
 * the pale planned treatment.
 *
 * @param fraction - The booked fraction (0–1)
 * @param planned - Whether the bucket is planned
 * @returns `60% booked, planned`
 */
export function weightValueText(fraction: number, planned: boolean): string {
    const pct = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}% booked`;
    return planned ? `${pct}, planned` : pct;
}

/** A segment fill in words — the category its colour encodes. */
const FILL_TEXT: Record<string, string> = {
    brand: "booked",
    success: "positive",
    warning: "caution",
    danger: "at risk",
    info: "info",
    neutral: "neutral",
    slack: "slack",
    free: "free",
};

/**
 * A segment composition in words — each segment's category (its fill) and
 * its share, the author's in-bar label standing for the share where given.
 *
 * @param segments - The cell's segments, in order
 * @returns `booked 60%, slack 25%, free 15%`
 */
export function segmentsText(segments: readonly SegmentValue[]): string {
    const total = segments.reduce((acc, s) => acc + Math.max(0, s.weight), 0);
    if (segments.length === 0 || total <= 0) return "no data";
    return segments.map((s) => {
        const share = s.label.type === "some" ? s.label.value : `${Math.round((Math.max(0, s.weight) / total) * 100)}%`;
        return `${FILL_TEXT[s.fill.type] ?? s.fill.type} ${share}`;
    }).join(", ");
}

/**
 * A table cell's parts in words — the numerals it prints, with the muted
 * em-dash of a missing value said as `no value`.
 *
 * @param texts - Each part's printed text, in series order
 * @returns `1,204, 96%`
 */
export function tablePartsText(texts: readonly string[]): string {
    return texts.map((t) => (t === "—" ? "no value" : t)).join(", ");
}

/**
 * A bucket-quantised element's accessible name — the bucket in words, then
 * what the element says about it.
 *
 * @param scale - The shared scale
 * @param bucket - The element's bucket
 * @param value - The element's value in words
 * @returns `Week of 6 Jul 2026: 72`
 */
export function cellName(scale: PlanScale, bucket: PlanBucket, value: string): string {
    return `${scale.bucketText(bucket)}: ${value}`;
}

/** What a chart layer is called when the canvas has to say it. */
const LAYER_TEXT: Record<string, string> = {
    line: "line", area: "area", column: "columns", scatter: "points", band: "range",
};

/**
 * A chart row's text alternative — its summary as a `role="img"` label: each
 * data layer's minimum, maximum and last value inside the window, by its
 * axis's format, and how many of its points breach a declared threshold (the
 * warn marks say that by colour alone).
 *
 * @param kind - The chart row
 * @param scale - The shared scale
 * @returns `Chart: line min 1.2, max 4.5, last 3.1; columns min 0, max 12, last 7, 2 beyond threshold`
 */
export function chartSummary(kind: ChartKindValue, scale: PlanScale): string {
    const layers = readoutLayers(kind);
    if (layers.length === 0) return "Chart: no data";
    const counts = new Map<string, number>();
    for (const l of layers) counts.set(l.kind, (counts.get(l.kind) ?? 0) + 1);
    const seen = new Map<string, number>();
    const format = {
        left: axisFormatter(kind.left.type === "some" ? kind.left.value : undefined),
        right: axisFormatter(kind.right.type === "some" ? kind.right.value : undefined),
    };
    const parts = layers.map(({ index, kind: k }) => {
        const n = (seen.get(k) ?? 0) + 1;
        seen.set(k, n);
        const name = (counts.get(k) ?? 0) > 1 ? `${LAYER_TEXT[k] ?? k} ${n}` : (LAYER_TEXT[k] ?? k);
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
                if (last === undefined || at >= last.t) last = { t: at, text: `${fmt(p.lo)}–${fmt(p.hi)}` };
            }
            return last === undefined ? `${name} no data in the window`
                : `${name} min ${fmt(lo)}, max ${fmt(hi)}, last ${last.text}`;
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
        if (last === undefined) return `${name} no data in the window`;
        const text = `${name} min ${fmt(lo)}, max ${fmt(hi)}, last ${fmt(last.y)}`;
        return breaches > 0 ? `${text}, ${breaches} beyond threshold` : text;
    });
    return `Chart: ${parts.join("; ")}`;
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
 * @returns The announcement, or `undefined`
 */
export function announcementOf(e: PlanEvent, before: PlanUiState, after: PlanUiState, label: (key: RowKey) => string): string | undefined {
    const focusGone = before.focus !== null && after.focus === null;
    switch (e.t) {
        case "row.select":
            return after.selected !== null && after.selected !== before.selected ? `Selected ${label(after.selected)}` : undefined;
        case "group.toggle":
            return after.collapsed !== before.collapsed
                ? `${label(e.key)} ${after.collapsed.has(e.key) ? "collapsed" : "expanded"}`
                : undefined;
        case "chart.toggle":
            return `${label(e.key)} chart ${after.chartsExpanded.has(e.key) ? "expanded" : "collapsed"}`;
        case "focus.links":
            if (after.focus?.kind === "links" && after.focus.key === e.key) return `Showing rows linked to ${label(e.key)}`;
            return focusGone ? "Showing all rows" : undefined;
        case "focus.expand":
            if (after.focus?.kind === "expand" && after.focus.key === e.key) return `${label(e.key)} opened in place`;
            return focusGone ? "Showing all rows" : undefined;
        case "focus.clear":
            return focusGone ? "Showing all rows" : undefined;
        case "grain.set":
            return after.grain !== before.grain ? `Grain: ${after.grain}` : undefined;
        case "key":
            switch (e.key) {
                case "esc":
                    if (focusGone) return "Showing all rows";
                    return before.selected !== null && after.selected === null ? "Selection cleared" : undefined;
                case "g":
                    return after.grain !== before.grain ? `Grain: ${after.grain}` : undefined;
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
 * @returns `Loaded elements 201–400 of 5,000`, or `undefined` when nothing landed
 */
export function landedText(before: PlanResidentSpan | undefined, after: PlanResidentSpan | undefined, total: number | undefined): string | undefined {
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
    const range = `${(from + 1).toLocaleString()}–${to.toLocaleString()}`;
    return total !== undefined ? `Loaded elements ${range} of ${total.toLocaleString()}` : `Loaded elements ${range}`;
}
