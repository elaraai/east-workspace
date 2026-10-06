/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's one shared scale (`Plan Spec.md` §3): pure arithmetic over the
 * axis's own numeric domain, with no DOM, testable in isolation.
 *
 * A scale is built from ONE of the three axis kinds (#631):
 *
 * - `time`: a half-open UTC window `[min, max)` divided by a calendar
 *   resolution (d3-time intervals; ISO weeks, Monday-start);
 * - `number`: a half-open numeric window `[min, max)` divided by a `step`,
 *   bucket edges on whole multiples of the step;
 * - `ordinal`: the declared values, one bucket each, in order.
 *
 * The engine that cuts a domain into buckets, and the time arm, are the time
 * parts the Plan shares with the Calendar (`../shared/time/scale.ts`, #1148);
 * this module adds the number and ordinal arms and the Plan's instants. Every
 * kind is the same thing to the engine, a numeric domain (epoch ms, the value,
 * the ordinal INDEX) with a period function over it, which is what keeps the
 * eight row renderers kind-agnostic: they consume fractions and bucket
 * indices, and only ever hand the scale an instant.
 *
 * Every row receives it through `PlanScaleContext` and positions against it.
 * An instant of ANOTHER arm than the scale's positions nowhere (`NaN` / `-1`
 * / `undefined`); the canvas diagnoses the mismatch by row
 * (`model.axisKindMismatches`) instead of misplacing anything.
 *
 * On an ordinal scale an interval's END names its LAST bucket (inclusive):
 * values are buckets, not edges, so `[PLATES, FINISH]` covers PLATES, PRINT
 * and FINISH, and `endFracOf` is the far edge of the named bucket. On the
 * other two kinds intervals stay half-open, and `endFracOf` is `fracOf`.
 *
 * @packageDocumentation
 */

import { tickFormatter, type TickFormat } from "@elaraai/east-ui-components/internal";
import {
    OVERSCAN_BUCKETS, bucketScale, timeDomain,
    type Scale, type ScaleBucket, type ScaleDomain, type ScalePeriod, type TimeResolution, type TimeWindow,
} from "../shared/time/scale.js";
import { numberInstant, ordinalInstant, timeInstant, type PlanAxisKind, type PlanInstantValue } from "./instant.js";
import { toPlanSlot } from "./slot.js";
import { PLAN_WORDS, type PlanWords } from "./words.js";

/** A concrete bucket resolution: the IR `TimeResolutionType` with `auto` resolved away. */
export type PlanResolution = TimeResolution;

/** A half-open time window `[min, max)`. */
export type PlanWindow = TimeWindow;

const DAY_MS = 86_400_000;

/**
 * Resolve the declared resolution (`auto` → window-derived): ≤ 14 days ⇒
 * `day`, ≤ ~40 weeks ⇒ `week` (the Plan's home unit), else `month`.
 *
 * @param declared - The IR resolution tag (may be `"auto"` or undefined)
 * @param window - The resolved window the buckets span
 * @returns The concrete resolution
 */
export function effectiveResolution(declared: string | undefined, window: PlanWindow): PlanResolution {
    if (declared !== undefined && declared !== "auto") return declared as PlanResolution;
    const span = window.max.getTime() - window.min.getTime();
    if (span <= 14 * DAY_MS) return "day";
    if (span <= 280 * DAY_MS) return "week";
    return "month";
}

/** One bucket of the scale. */
export type PlanBucket = ScaleBucket<PlanInstantValue>;

/**
 * What a scale is built from: the decoded axis arm plus the resolved window
 * (slice range ▸ declared), as plain values.
 *
 * Every arm takes the canvas's `words` (#820): the locale its ruler labels and
 * its words for a reader format in ({@link PLAN_WORDS} when omitted).
 *
 * @property time - A UTC window divided by a calendar resolution; `format` a date-token pattern
 * @property number - A numeric window divided by `step`; `format` the shared value format (`Chart.format.*`)
 * @property ordinal - The declared values, one bucket each
 */
export type PlanScaleSpec =
    | { kind: "time"; window: PlanWindow; resolution: PlanResolution; now?: Date | undefined; format?: string | undefined; words?: PlanWords | undefined }
    | { kind: "number"; window: { min: number; max: number }; step: number; now?: number | undefined; format?: TickFormat | undefined; words?: PlanWords | undefined }
    | { kind: "ordinal"; values: readonly string[]; now?: string | undefined; words?: PlanWords | undefined };

/**
 * The one shared scale every row positions against: the window, the buckets,
 * and the continuous and quantised mappings, over the Plan's instants
 * (`{ time | number | ordinal }`). One of another arm positions nowhere.
 */
export type PlanScale = Scale<PlanInstantValue, PlanAxisKind>;

/** The periods handed out so far, by key: one object per period (see `Scale.period`). */
const PERIODS = new Map<string, ScalePeriod<PlanInstantValue>>();

/** A `time` instant's epoch ms; `NaN` for an instant of another arm. */
const timeMs = (t: PlanInstantValue): number => (t.type === "time" ? t.value.getTime() : NaN);

function numberDomain(spec: Extract<PlanScaleSpec, { kind: "number" }>): ScaleDomain<PlanInstantValue, PlanAxisKind> | undefined {
    const step = spec.step;
    if (!Number.isFinite(step) || !(step > 0)) return undefined;
    // A hair of tolerance so `floor(3 × 0.1)` is 0.3, not 0.2.
    const eps = step * 1e-9;
    const fmt = tickFormatter(spec.format, "linear", (spec.words ?? PLAN_WORDS).locale);
    const offset = (n: number, k: number): number => n + k * step;
    return {
        kind: "number",
        periodKey: `number:${step}`,
        minN: spec.window.min,
        maxN: spec.window.max,
        floor: (n) => Math.floor((n + eps) / step) * step,
        offset,
        // A number axis's bucket is its step: a move takes whole steps.
        shift: offset,
        fineUnit: undefined,
        toN: (t) => (t.type === "number" ? t.value : NaN),
        fromN: (n) => numberInstant(n),
        slot: toPlanSlot,
        label: (n) => fmt(n),
        text: (n) => fmt(n),
        periodText: (n) => fmt(n),
        overscan: OVERSCAN_BUCKETS,
        endInclusive: false,
        bounded: false,
        resolution: undefined,
        now: spec.now,
    };
}

function ordinalDomain(spec: Extract<PlanScaleSpec, { kind: "ordinal" }>): ScaleDomain<PlanInstantValue, PlanAxisKind> | undefined {
    // A repeated value is ONE bucket (its first occurrence), like a repeated
    // row key is one row.
    const values = Array.from(new Set(spec.values));
    if (values.length === 0) return undefined;
    const index = new Map<string, number>(values.map((v, i) => [v, i]));
    const last = values.length - 1;
    const at = (n: number): string => values[Math.max(0, Math.min(last, Math.floor(n + 1e-9)))]!;
    const offset = (n: number, k: number): number => n + k;
    return {
        kind: "ordinal",
        // Every value is its own bucket: an ordinal period is the identity,
        // whatever the list (`periodFloor` below maps a value to itself).
        periodKey: "ordinal",
        minN: 0,
        maxN: values.length,
        floor: (n) => Math.floor(n + 1e-9),
        offset,
        // A move walks the list, a value at a time.
        shift: offset,
        fineUnit: undefined,
        toN: (t) => (t.type === "ordinal" ? (index.get(t.value) ?? NaN) : NaN),
        fromN: (n) => ordinalInstant(at(n)),
        slot: toPlanSlot,
        label: (n) => at(n),
        text: (n) => at(n),
        periodText: (n) => at(n),
        overscan: 0,
        endInclusive: true,
        bounded: true,
        // A value outside the list stays itself, as it does under `floor`.
        periodFloor: (t) => t,
        resolution: undefined,
        now: spec.now !== undefined ? index.get(spec.now) : undefined,
    };
}

/**
 * Build the shared scale for an axis spec.
 *
 * The window widens OUTWARD to whole periods (#949): a 12-week window at MONTH
 * resolution draws whole months (June to September); an aligned window is
 * unchanged, so a 12-week window at WEEK resolution is exactly 12 equal
 * columns, and a `[1, 9)` number window at step 1 eight columns labelled `1` …
 * `8`. An ordinal scale is its list: one bucket per value, labelled by it.
 *
 * @param spec - The axis kind with its resolved window / period / values
 * @returns The scale, or `undefined` for an empty or inverted window, a
 *   non-positive step or an empty list
 */
export function planScale(spec: PlanScaleSpec): PlanScale | undefined {
    const dom: ScaleDomain<PlanInstantValue, PlanAxisKind> | undefined = spec.kind === "time"
        ? timeDomain({ ...spec, words: spec.words ?? PLAN_WORDS }, timeInstant, timeMs)
        : spec.kind === "number" ? numberDomain(spec)
            : ordinalDomain(spec);
    return dom !== undefined ? bucketScale(dom, PERIODS) : undefined;
}
