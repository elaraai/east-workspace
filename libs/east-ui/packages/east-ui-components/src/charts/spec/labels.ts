/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A chart's label text: how an axis's tick and title text resolve over the
 * chrome (#315, #327), how wide a mono label draws, which ticks of an axis
 * keep their labels so no two overlap, what a legend's entries take on its
 * line (#1692), and the chart rules' margins that hold them
 * (`guidelines/charts.md`; #1671).
 *
 * @packageDocumentation
 */

import type { CSSProperties } from "react";
import type { ValueTypeOf } from "@elaraai/east";
import { getSomeorUndefined } from "../../utils";
import { T, type ChartStyle, type Margin } from "./context.js";

/** A mono tick glyph's advance, as a fraction of its font size. */
const MONO_ADVANCE = 0.6;

/** The room a left or right tick label needs beyond its glyphs: its offset
 *  from the axis (the tick length and the label's own inset), and an inset
 *  from the frame's edge. */
export const LEFT_LABEL_ROOM = 15;

/** The least room between two labels side by side along an axis, in px. */
const LABEL_GAP = 8;

/**
 * The least room between two labels one over another down an axis beside the plot, in px. Each stands on a line of its
 * own ({@link labelLine}), which holds its own leading: two lines 2 apart read as two lines, where two words 2 apart
 * on one line read as one.
 */
export const LINE_GAP = 2;

/** The chart rules' grid margins (`guidelines/charts.md`): what a frame given none takes. */
export const RULE_MARGIN: Margin = { top: 24, right: 24, bottom: 28, left: 44 };

/** The room an axis after the plot takes: the chart rules' left margin, mirrored. */
export const RIGHT_AXIS_ROOM = 44;

/** The legend's block over the plot: its 13px line and the 12px under it. */
export const LEGEND_HEIGHT = 25;

/** A legend entry's words' size, px: mono 10.5 (`chartLegend`). */
export const LEGEND_PX = 10.5;

/** What a legend entry takes beside its words, px: its 14px swatch and the 6 after it (`chartLegend`). */
export const LEGEND_SWATCH = 20;

/** The room between two legend entries, px (`chartLegend`). */
export const LEGEND_GAP = 16;

/** A label's line, px: the 1.2 of its size a browser lays a mono face on, at whole pixels. */
export function labelLine(px: number): number {
    return Math.ceil(px * 1.2);
}

/** The least of a chart's width its plot keeps (#1692): a third; its axes' labels and margins the rest. */
const PLOT_SHARE = 1 / 3;

/**
 * The least a chart's plot keeps of its width, px (#1692): a third, in whole pixels.
 *
 * @param width - The chart's width, px
 * @returns The plot's least width, px
 */
export function plotLeast(width: number): number {
    return Math.ceil(width * PLOT_SHARE);
}

/** The size an axis's labels step down to where the plot would keep less than its share (#1692): the chart rules' own 10px. */
export const SMALL_LABEL = "10px";

/** What a side keeps past the plot where nothing labels it: a mark at the plot's end, whole. */
export const PLOT_EDGE = 8;

/** A side's margin: what its labels need — their glyphs and their room — and the least the chart rules keep there. */
export interface SideMargin {
    readonly need: number;
    readonly floor: number;
}

/**
 * A chart's left and right margins at its width (the chart rules; #1692):
 * each side the more of what its labels need and the chart rules' own
 * margin, while the plot keeps its share of the chart's width. Where they
 * would leave it less, they give way — the right's room past its labels
 * first, then the left's; then, where the left holds a band's names and
 * `names` says how far they may give, those names, cut — down to what leaves
 * the plot its share.
 *
 * @param width - The chart's width, px
 * @param left - The left side's need and floor
 * @param right - The right side's need and floor
 * @param names - The least the left keeps where its band's names may be cut; `undefined` where they may not
 * @returns The margins, px
 */
export function marginsThatFit(width: number, left: SideMargin, right: SideMargin, names: number | undefined): { readonly left: number; readonly right: number } {
    let l = Math.max(left.need, left.floor);
    let r = Math.max(right.need, right.floor);
    let over = l + r - (width - plotLeast(width));
    // Takes up to `by` of what the margins are over.
    const give = (by: number): number => {
        const took = Math.max(0, Math.min(over, by));
        over -= took;
        return took;
    };
    r -= give(r - right.need);
    l -= give(l - left.need);
    if (names !== undefined) l -= give(l - names);
    return { left: l, right: r };
}

/**
 * A label in the room it has (#1692): whole where it fits, else its first
 * letters and an ellipsis — a band's name beside a plot too narrow for it,
 * its whole in the plot's tooltip.
 *
 * @param text - The label
 * @param room - The room it has, px; `undefined` for as much as it needs
 * @param px - Its size, px
 * @returns The label as it draws
 */
export function cutLabel(text: string, room: number | undefined, px: number): string {
    if (room === undefined || labelWidth(text, px) <= room) return text;
    return `${text.slice(0, Math.max(1, Math.floor(room / Math.ceil(px * MONO_ADVANCE)) - 1))}…`;
}

/** How far a label stands clear of what it labels: a bar's end, a rule's line and the plot's start. */
export const MARK_LABEL_GAP = 6;

/** Shared font-weight tags → CSS weights (the `FontWeightType` arms). */
const FONT_WEIGHTS: Record<string, number> = { light: 300, normal: 400, medium: 500, semibold: 600, bold: 700 };

/** Axis text typography override value (#315) — the `tickStyle` / `titleStyle` of an axis. */
type AxisTextStyleValue = ValueTypeOf<typeof T.AxisTextStyle>;

/**
 * Resolve an axis-text override (#315) over the spec chrome — font size /
 * family / weight / colour / letter spacing onto SVG text style props. Absent
 * fields keep the chrome (mono `labelSize` `fg.muted`); `defaultWeight` is the
 * chrome weight for the run (600 for axis captions, inherit for ticks).
 */
function axisTextCss(
    style: ChartStyle,
    s: AxisTextStyleValue | undefined,
    defaults?: { weight?: number; family?: string; color?: string },
): CSSProperties {
    const family = s ? getSomeorUndefined(s.fontFamily)?.type : undefined;
    const color = s ? getSomeorUndefined(s.color) : undefined;
    const weightTag = s ? getSomeorUndefined(s.fontWeight)?.type : undefined;
    const css: CSSProperties = {
        fontFamily: family !== undefined ? style.fontFor(family) : (defaults?.family ?? style.font),
        fontSize: (s ? getSomeorUndefined(s.fontSize) : undefined) ?? style.labelSize,
        fill: color !== undefined ? style.color(color) : (defaults?.color ?? style.labelColor),
    };
    const weight = weightTag !== undefined ? FONT_WEIGHTS[weightTag] : defaults?.weight;
    if (weight !== undefined) css.fontWeight = weight;
    const spacing = s ? getSomeorUndefined(s.letterSpacing) : undefined;
    if (spacing !== undefined) css.letterSpacing = spacing;
    return css;
}

/** Axis-TITLE defaults (#327): titles use the sans/UI font at a real medium (500)
 *  weight in full-contrast `fg.default` — not the mono `600`/`fg.muted` tick
 *  chrome, which synthesised faux-bold and read faint. Overrides still win. */
export function titleTextCss(style: ChartStyle, s: AxisTextStyleValue | undefined): CSSProperties {
    return axisTextCss(style, s, { weight: 500, family: style.titleFont, color: style.titleColor });
}

/** Tick defaults: the mono chrome at weight 500, its numerals tabular, so an
 *  axis's values stand in columns (the chart rules; #1671, TIL-5). Overrides
 *  still win. */
export function tickTextCss(style: ChartStyle, s: AxisTextStyleValue | undefined): CSSProperties {
    return { ...axisTextCss(style, s, { weight: 500 }), fontVariantNumeric: "tabular-nums" };
}

/** A tick label's font size in px, as its style resolves — the chrome's when it names no px size. */
export function tickPx(style: ChartStyle, s: AxisTextStyleValue | undefined): number {
    const size = /^(\d+(?:\.\d+)?)px$/.exec(String(axisTextCss(style, s).fontSize));
    return size ? Number(size[1]) : 11;
}

/** How wide a mono label draws, in px: its glyphs at their advance, which a
 *  browser draws on whole pixels (a 0.6em advance is 7px at 11px, not 6.6). */
export function labelWidth(text: string, px: number): number {
    return text.length * Math.ceil(px * MONO_ADVANCE);
}

/**
 * The ticks of an axis that keep their labels, so that no two labels overlap
 * whatever their length (the chart rules; #1671).
 *
 * @param ticks - The ticks, each with its position along the axis and its label's extent about it, in px
 * @param gap - The least room between two labels, px: side by side 8, unless given; one over another, {@link LINE_GAP}
 * @returns The ticks that keep their labels, in the order given
 *
 * @remarks
 * - Ticks a steady step apart — a band's categories, a date axis's points, a
 *   scale's own ticks — keep every one where they fit; else the first, the
 *   last and those evenly between, as far apart as the widest label needs.
 * - Ticks at uneven positions — a numeric axis pinned to its points — keep
 *   each one, from the start, that clears the one kept before it.
 */
export function ticksThatFit<V>(ticks: readonly { readonly value: V; readonly at: number; readonly from: number; readonly to: number }[], gap: number = LABEL_GAP): V[] {
    if (ticks.length < 2) return ticks.map(tick => tick.value);
    const steps = ticks.slice(1).map((tick, i) => tick.at - ticks[i]!.at);
    const step = steps[0]!;
    const steady = step > 0 && steps.every(s => Math.abs(s - step) < 0.5);
    if (!steady) {
        // By position: each label that starts clear of the last one kept.
        const along = [...ticks].sort((a, b) => a.at - b.at);
        const kept = new Set<V>();
        let edge = -Infinity;
        for (const tick of along) {
            if (tick.from < edge + gap) continue;
            kept.add(tick.value);
            edge = tick.to;
        }
        return ticks.filter(tick => kept.has(tick.value)).map(tick => tick.value);
    }
    // The most ticks, evenly spread from the first to the last, whose labels clear one another.
    const last = ticks.length - 1;
    for (let spans = last; spans >= 1; spans--) {
        const kept = Array.from({ length: spans + 1 }, (_, i) => ticks[Math.round((i * last) / spans)]!);
        if (kept.every((tick, i) => i === 0 || tick.from >= kept[i - 1]!.to + gap)) return kept.map(tick => tick.value);
    }
    return [ticks[0]!.value];
}
