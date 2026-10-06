/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it, expect } from "vitest";
import { DateTimeType, parseFor } from "@elaraai/east";
import { shadeBands, type ShadeBand } from "./shading.js";

const readDateTime = parseFor(DateTimeType);

/** An instant written as East prints a DateTime (UTC), read with East's own parser. */
function at(text: string): Date {
    const read = readDateTime(text);
    if (!read.success) throw new Error(read.error);
    return read.value;
}

/** A band's ends back as instants, so a test reads in dates. */
function spans(window: { min: Date; max: Date }, bands: readonly ShadeBand[]): { from: Date; to: Date; kind: string }[] {
    const min = window.min.getTime();
    const span = window.max.getTime() - min;
    return bands.map((b) => ({
        from: new Date(Math.round(min + b.start * span)),
        to: new Date(Math.round(min + (b.start + b.width) * span)),
        kind: b.kind,
    }));
}

describe("shadeBands", () => {
    // Mon 28 Sep – Mon 5 Oct 2026: one ISO week.
    const week = { min: at("2026-09-28T00:00:00"), max: at("2026-10-05T00:00:00") };

    it("shades a weekend whole, Saturday to Monday as one band", () => {
        expect(spans(week, shadeBands(week, {}))).toEqual([
            { from: at("2026-10-03T00:00:00"), to: at("2026-10-05T00:00:00"), kind: "weekend" },
        ]);
    });

    it("shades the hours outside the working day, a night from one day's close to the next day's open", () => {
        const two = { min: at("2026-09-29T00:00:00"), max: at("2026-10-01T00:00:00") };
        expect(spans(two, shadeBands(two, { hours: { from: 6, to: 22 } }))).toEqual([
            { from: at("2026-09-29T00:00:00"), to: at("2026-09-29T06:00:00"), kind: "offHours" },
            { from: at("2026-09-29T22:00:00"), to: at("2026-09-30T06:00:00"), kind: "offHours" },
            { from: at("2026-09-30T22:00:00"), to: at("2026-10-01T00:00:00"), kind: "offHours" },
        ]);
    });

    it("shades a weekend day whole, and never also for its hours", () => {
        const fri = { min: at("2026-10-02T00:00:00"), max: at("2026-10-05T00:00:00") };
        expect(spans(fri, shadeBands(fri, { hours: { from: 6, to: 22 } }))).toEqual([
            { from: at("2026-10-02T00:00:00"), to: at("2026-10-02T06:00:00"), kind: "offHours" },
            { from: at("2026-10-02T22:00:00"), to: at("2026-10-03T00:00:00"), kind: "offHours" },
            { from: at("2026-10-03T00:00:00"), to: at("2026-10-05T00:00:00"), kind: "weekend" },
        ]);
    });

    it("shades no weekend when weekends are off", () => {
        expect(shadeBands(week, { weekends: false })).toEqual([]);
        const sat = { min: at("2026-10-03T00:00:00"), max: at("2026-10-04T00:00:00") };
        expect(spans(sat, shadeBands(sat, { weekends: false, hours: { from: 8, to: 18 } }))).toEqual([
            { from: at("2026-10-03T00:00:00"), to: at("2026-10-03T08:00:00"), kind: "offHours" },
            { from: at("2026-10-03T18:00:00"), to: at("2026-10-04T00:00:00"), kind: "offHours" },
        ]);
    });

    it("clips its bands to a window that starts and ends mid-day", () => {
        const mid = { min: at("2026-09-29T20:00:00"), max: at("2026-09-30T07:00:00") };
        expect(spans(mid, shadeBands(mid, { hours: { from: 6, to: 22 } }))).toEqual([
            { from: at("2026-09-29T22:00:00"), to: at("2026-09-30T06:00:00"), kind: "offHours" },
        ]);
    });

    it("gives fractions of the window", () => {
        const day = { min: at("2026-09-29T00:00:00"), max: at("2026-09-30T00:00:00") };
        expect(shadeBands(day, { hours: { from: 6, to: 18 } })).toEqual([
            { start: 0, width: 0.25, kind: "offHours" },
            { start: 0.75, width: 0.25, kind: "offHours" },
        ]);
    });

    it("shades nothing for a working day of all 24 hours, or an empty window", () => {
        const day = { min: at("2026-09-29T00:00:00"), max: at("2026-09-30T00:00:00") };
        expect(shadeBands(day, { hours: { from: 0, to: 24 } })).toEqual([]);
        expect(shadeBands({ min: day.min, max: day.min }, { hours: { from: 6, to: 22 } })).toEqual([]);
    });
});
