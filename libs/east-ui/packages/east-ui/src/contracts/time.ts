/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Shared time vocabulary — the calendar-unit resolution of a bucketed time
 * axis and the snap step of a time-axis drag. Cross-cutting contracts used by
 * the Slice platform (`Slice.Range`'s resolution segment), the Plan canvas
 * axis, and time-axis drag/duration snapping.
 *
 * Lifted from the Planner (`PlannerResolutionType`) and Gantt
 * (`TimeStepType`) IR so the vocabulary survives those components — the
 * historical names remain as re-export aliases at their original import
 * paths.
 *
 * @packageDocumentation
 */

import {
    FloatType,
    NullType,
    VariantType,
} from "@elaraai/east";

// ============================================================================
// Time resolution — the calendar unit of a bucketed axis column
// ============================================================================

/**
 * The calendar unit of each bucket on a bucketed time axis — the resolution a
 * shared time scale divides its window by (`n = window ÷ resolution`).
 *
 * @remarks
 * On surfaces with a pinned window, resolution sets bucket *identity*: the
 * column set, event placement, and drag slot keys — not just header labels.
 * `auto` (or an absent resolution) lets the consumer infer the unit from the
 * axis extent (the Planner rule: a pinned range spanning ≤ 14 days derives one
 * column per day, anything else one column per month; `hour` is never chosen
 * automatically). The fixed arms force the unit regardless of extent.
 *
 * Windows are half-open calendar ranges `[min, max)` — a 12-week window at
 * `week` resolution is exactly 12 columns.
 *
 * @property auto - Infer from the pinned range span (≤ 14 days ⇒ day, else month)
 * @property hour - One bucket per hour
 * @property day - One bucket per day
 * @property week - One bucket per week
 * @property month - One bucket per calendar month
 * @property quarter - One bucket per calendar quarter
 * @property year - One bucket per calendar year
 */
export const TimeResolutionType = VariantType({
    auto:    NullType,
    hour:    NullType,
    day:     NullType,
    week:    NullType,
    month:   NullType,
    quarter: NullType,
    year:    NullType,
});
export type TimeResolutionType = typeof TimeResolutionType;

/** String-literal shorthand for {@link TimeResolutionType}. */
export type TimeResolutionLiteral = "auto" | "hour" | "day" | "week" | "month" | "quarter" | "year";

// ============================================================================
// Time step — drag / duration snapping
// ============================================================================

/**
 * Time step variant type for drag/duration snapping on a time axis.
 *
 * @remarks
 * Each variant contains a float value representing the step size in that
 * unit. Used by time-axis surfaces to snap event-body drags and edge
 * (duration) drags to a calendar grid.
 *
 * @property minutes - Step size in minutes (e.g. 15 for 15-minute intervals)
 * @property hours - Step size in hours (e.g. 1 for hourly)
 * @property days - Step size in days (e.g. 1 for daily, 0.5 for half-day)
 * @property weeks - Step size in weeks (e.g. 1 for weekly)
 * @property months - Step size in months (e.g. 1 for monthly)
 */
export const TimeStepType = VariantType({
    minutes: FloatType,
    hours: FloatType,
    days: FloatType,
    weeks: FloatType,
    months: FloatType,
});
export type TimeStepType = typeof TimeStepType;
