/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The canvas's words (#820): one number format for everything the canvas
 * derives (#810), in the locale, and the UTC dates every accessible name and
 * ruler tick is built from.
 */

import { describe, test, expect } from "vitest";
import { formatTick } from "../../typography/numeric/format-tick.js";
import { planMessages } from "./messages.js";
import { PLAN_WORDS, planWords, type PlanWords } from "./words.js";

const de = planWords("de-DE", planMessages);

describe("a derived number (#810)", () => {
    test("prints through the shared numeric formatter's default arm — never a hand-rounded total", () => {
        expect(PLAN_WORDS.number(1234.5)).toBe("1,234.5");
        expect(PLAN_WORDS.number((0.82 + 0.64 + 0.9) / 3)).toBe("0.787");
        expect(PLAN_WORDS.number(146)).toBe("146");
        for (const n of [0, -3.25, 1e6, 0.0004]) {
            expect(PLAN_WORDS.number(n)).toBe(formatTick(n, undefined, false, "en-US"));
            expect(de.number(n)).toBe(formatTick(n, undefined, false, "de-DE"));
        }
    });

    test("in the canvas's locale (#820)", () => {
        expect(de.number(1234.5)).toBe("1.234,5");
        expect(PLAN_WORDS.percent(0.6)).toBe("60%");
        expect(de.percent(0.6)).toMatch(/^60\s%$/u);
    });

    test("a group's member count — `~`-marked while it covers a partial prefix (#567 D9)", () => {
        const meta = (w: PlanWords, n: number, partial: boolean) => w.m.groupMeta({ n, count: w.number(n), partial });
        expect(meta(PLAN_WORDS, 8, false)).toBe("8 rs");
        expect(meta(PLAN_WORDS, 1204, false)).toBe("1,204 rs");
        expect(meta(PLAN_WORDS, 1204, true)).toBe("~1,204 rs");
        expect(meta(de, 1204, true)).toBe("~1.204 rs");
    });
});

describe("dates (#820)", () => {
    test("are the instant's UTC date — the late evening of the 29th is the 29th", () => {
        const late = new Date("2026-06-29T23:30:00Z");
        expect(PLAN_WORDS.date(late)).toBe("Jun 29, 2026");
        expect(PLAN_WORDS.dateTime(late)).toBe("Jun 29, 2026, 23:30");
        expect(de.date(late)).toBe("29. Juni 2026");
    });

    test("times are 24-hour; an invalid date says nothing", () => {
        expect(PLAN_WORDS.time(new Date("2026-06-29T14:05:00Z"))).toBe("14:05");
        expect(PLAN_WORDS.time(new Date("2026-06-29T00:00:00Z"))).toBe("00:00");
        expect(PLAN_WORDS.date(new Date(NaN))).toBe("");
    });
});
