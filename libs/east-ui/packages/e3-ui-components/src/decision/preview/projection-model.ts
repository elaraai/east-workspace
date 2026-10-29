/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a projection target's preview draws (`Decision Queue Spec.md` P8,
 * P24, P25): each option's series — the target's `points` over the option's
 * own row — as a line on one plot, from zero to a nice top over the highest
 * point; one tick up the side at the largest round value under it, and the
 * limit, a dashed rule over a wash below it; the first and the last x and the
 * round steps between them along the bottom; and each line's label at the top
 * of its first rise, or over its last run where it never rises. The chosen
 * option's line is drawn last, glowing, unless it is the option that changes
 * nothing. Pure: the preview reads the options' rows, and this works out what
 * they draw.
 *
 * @packageDocumentation
 */

import { FloatType, compareFor } from "@elaraai/east";

const compareNumber = compareFor(FloatType);

/** One point of a series. */
export interface ProjectionPoint {
    readonly x: number;
    readonly y: number;
}

/** One option's series, as the preview reads it. */
export interface ProjectionLineInput {
    /** The option's key. */
    readonly key: string;
    /** Its label. */
    readonly label: string;
    /** Its series, in order along x. */
    readonly points: readonly ProjectionPoint[];
    /** Whether it is the chosen option. */
    readonly chosen: boolean;
    /** Whether it is the option that changes nothing: as things stand. */
    readonly asis: boolean;
}

/** One line a projection draws. */
export interface ProjectionLine {
    /** The option's key. */
    readonly key: string;
    /** Its label. */
    readonly label: string;
    /** Its points on the plot, in percent: x from its left, y from its top. */
    readonly path: readonly ProjectionPoint[];
    /** Whether it is the chosen option. */
    readonly chosen: boolean;
    /** Whether it is the option that changes nothing. */
    readonly asis: boolean;
    /** Where its label stands, in percent, and whether over its run rather than left of its rise. */
    readonly at: ProjectionPoint;
    readonly run: boolean;
    /** Its lowest value. */
    readonly low: number;
}

/** A tick on an axis: its value and where it stands, in percent. */
export interface ProjectionTick {
    readonly value: number;
    readonly at: number;
}

/** What a projection draws. */
export interface ProjectionModel {
    /** Its lines, the chosen one last. */
    readonly lines: readonly ProjectionLine[];
    /** The plot's top: zero to it. */
    readonly top: number;
    /** The tick up the side. */
    readonly y: ProjectionTick | undefined;
    /** The limit, where the target gives one. */
    readonly limit: ProjectionTick | undefined;
    /** The ticks along the bottom: the first, the round steps between, and the last. */
    readonly x: readonly ProjectionTick[];
}

/**
 * The largest round value — one, two or five of its power of ten — at or under a value.
 *
 * @param value - A positive value
 * @returns The round value
 */
export function roundFloor(value: number): number {
    if (!(value > 0)) return 0;
    const power = 10 ** Math.floor(Math.log10(value));
    return ([5, 2, 1].find(step => step * power <= value * (1 + 1e-9)) ?? 1) * power;
}

/**
 * What a projection target's preview draws (see the module docs).
 *
 * @param lines - Each option's series, in the options' order
 * @param limit - The limit's value, where the target gives one
 * @returns The lines, the plot's top and its ticks
 */
export function projectionPreview(lines: readonly ProjectionLineInput[], limit: number | undefined): ProjectionModel {
    const points = lines.flatMap(line => line.points);
    let minX = Infinity, maxX = -Infinity, maxY = limit ?? 0;
    for (const p of points) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    if (points.length === 0) { minX = 0; maxX = 1; }
    if (!(maxX > minX)) maxX = minX + 1;
    // The top: the highest point, up to the next fifth of its power of ten.
    const step = maxY > 0 ? 10 ** Math.floor(Math.log10(maxY)) / 5 : 1;
    const top = maxY > 0 ? Math.ceil(maxY / step - 1e-9) * step : 1;
    const xAt = (x: number) => ((x - minX) / (maxX - minX)) * 100;
    const yAt = (y: number) => (1 - Math.max(0, y) / top) * 100;
    const drawn = lines.map((line): ProjectionLine => {
        const path = line.points.map(p => ({ x: xAt(p.x), y: yAt(p.y) }));
        // Its label: at the top of its first rise, else over its last run.
        const rise = line.points.findIndex((p, i) => i > 0 && compareNumber(p.y, line.points[i - 1]!.y) > 0);
        const last = path.length - 1;
        const at = rise > 0 ? path[rise]! : last > 0
            ? { x: (path[last - 1]!.x + path[last]!.x) / 2, y: (path[last - 1]!.y + path[last]!.y) / 2 }
            : path[0] ?? { x: 0, y: 100 };
        const low = line.points.reduce((held, p) => Math.min(held, p.y), Infinity);
        return { key: line.key, label: line.label, path, chosen: line.chosen, asis: line.asis, at, run: rise <= 0, low: Number.isFinite(low) ? low : 0 };
    });
    // The bottom's round steps: from the first, a third of the span rounded, while a step short of the last.
    const span = maxX - minX;
    const every = roundFloor(span / 3) || 1;
    const x: ProjectionTick[] = [{ value: minX, at: 0 }];
    for (let value = minX + every; value <= maxX - every + 1e-9; value += every) x.push({ value, at: xAt(value) });
    x.push({ value: maxX, at: 100 });
    const tick = roundFloor(Math.max(0, ...points.map(p => p.y)));
    return {
        lines: [...drawn.filter(line => !line.chosen), ...drawn.filter(line => line.chosen)],
        top,
        y: tick > 0 ? { value: tick, at: yAt(tick) } : undefined,
        limit: limit === undefined ? undefined : { value: limit, at: yAt(limit) },
        x,
    };
}
