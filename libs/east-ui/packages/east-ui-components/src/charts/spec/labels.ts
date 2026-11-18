/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A chart's label text: how an axis's tick and title text resolve over the
 * chrome (#315, #327), how wide a mono label draws, which ticks of an axis
 * keep their labels so no two overlap, and the chart rules' margins that
 * hold them (`guidelines/charts.md`; #1671).
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

/** The least room between two labels along an axis, in px. */
const LABEL_GAP = 8;

/** The chart rules' grid margins (`guidelines/charts.md`): what a frame given none takes. */
export const RULE_MARGIN: Margin = { top: 24, right: 24, bottom: 28, left: 44 };

/** The room an axis after the plot takes: the chart rules' left margin, mirrored. */
export const RIGHT_AXIS_ROOM = 44;

/** The legend's block over the plot: its 13px line and the 12px under it. */
export const LEGEND_HEIGHT = 25;

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
 * @returns The ticks that keep their labels, in the order given
 *
 * @remarks
 * - Ticks a steady step apart — a band's categories, a date axis's points, a
 *   scale's own ticks — keep every one where they fit; else the first, the
 *   last and those evenly between, as far apart as the widest label needs.
 * - Ticks at uneven positions — a numeric axis pinned to its points — keep
 *   each one, from the start, that clears the one kept before it.
 */
export function ticksThatFit<V>(ticks: readonly { readonly value: V; readonly at: number; readonly from: number; readonly to: number }[]): V[] {
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
            if (tick.from < edge + LABEL_GAP) continue;
            kept.add(tick.value);
            edge = tick.to;
        }
        return ticks.filter(tick => kept.has(tick.value)).map(tick => tick.value);
    }
    // The most ticks, evenly spread from the first to the last, whose labels clear one another.
    const last = ticks.length - 1;
    for (let spans = last; spans >= 1; spans--) {
        const kept = Array.from({ length: spans + 1 }, (_, i) => ticks[Math.round((i * last) / spans)]!);
        if (kept.every((tick, i) => i === 0 || tick.from >= kept[i - 1]!.to + LABEL_GAP)) return kept.map(tick => tick.value);
    }
    return [ticks[0]!.value];
}
