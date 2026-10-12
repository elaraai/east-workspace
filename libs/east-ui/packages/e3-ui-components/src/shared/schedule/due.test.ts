/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * When a builder's backlog events are due, and how long a template or a
 * backlog event takes (#1195): the week a moment is in, from Monday 00:00
 * UTC; the group a due date falls in, counted from now's week; and a
 * duration in whole minutes, a month 30 days.
 */

import { describe, expect, test } from "vitest";
import { variant } from "@elaraai/east";
import { DUE_GROUPS, dueGroupOf, durationMinutes, weekStartUTC } from "./due.js";

const at = (iso: string) => new Date(iso);

describe("the week a moment is in", () => {
    test("begins on its Monday at 00:00 UTC, a Sunday's included, whatever the hour", () => {
        expect(weekStartUTC(at("2026-10-14T09:00:00Z"))).toEqual(at("2026-10-12T00:00:00Z"));
        expect(weekStartUTC(at("2026-10-12T00:00:00Z"))).toEqual(at("2026-10-12T00:00:00Z"));
        expect(weekStartUTC(at("2026-10-18T23:59:59Z"))).toEqual(at("2026-10-12T00:00:00Z"));
        expect(weekStartUTC(at("2026-10-19T00:00:00Z"))).toEqual(at("2026-10-19T00:00:00Z"));
        // Across a month and a year.
        expect(weekStartUTC(at("2026-11-01T12:00:00Z"))).toEqual(at("2026-10-26T00:00:00Z"));
        expect(weekStartUTC(at("2027-01-01T00:00:00Z"))).toEqual(at("2026-12-28T00:00:00Z"));
    });
});

describe("the group a due date falls in (PB28)", () => {
    const now = at("2026-10-14T09:00:00Z");

    test("this week's to its Sunday's last instant, overdue included; next week's; later; and no date", () => {
        expect(dueGroupOf(at("2026-10-16T00:00:00Z"), now)).toBe("thisWeek");
        expect(dueGroupOf(at("2026-10-18T23:59:59Z"), now)).toBe("thisWeek");
        expect(dueGroupOf(at("2026-10-01T00:00:00Z"), now)).toBe("thisWeek");
        expect(dueGroupOf(at("2026-10-19T00:00:00Z"), now)).toBe("nextWeek");
        expect(dueGroupOf(at("2026-10-25T23:59:59Z"), now)).toBe("nextWeek");
        expect(dueGroupOf(at("2026-10-26T00:00:00Z"), now)).toBe("later");
        expect(dueGroupOf(undefined, now)).toBe("none");
    });

    test("counted from the week now is in, not from now: a Monday's now and a Sunday's count alike", () => {
        const due = at("2026-10-19T08:00:00Z");
        expect(dueGroupOf(due, at("2026-10-12T00:00:00Z"))).toBe("nextWeek");
        expect(dueGroupOf(due, at("2026-10-18T23:00:00Z"))).toBe("nextWeek");
        expect(dueGroupOf(due, at("2026-10-19T00:00:00Z"))).toBe("thisWeek");
    });

    test("the groups, in the order the tab lists them", () => {
        expect(DUE_GROUPS).toEqual(["thisWeek", "nextWeek", "later", "none"]);
    });
});

describe("a duration in whole minutes", () => {
    test("each unit, a month 30 days, rounded half up", () => {
        expect(durationMinutes(variant("minutes", 45))).toBe(45);
        expect(durationMinutes(variant("hours", 6.25))).toBe(375);
        expect(durationMinutes(variant("days", 1))).toBe(1_440);
        expect(durationMinutes(variant("weeks", 2))).toBe(20_160);
        expect(durationMinutes(variant("months", 1))).toBe(43_200);
        expect(durationMinutes(variant("minutes", 2.5))).toBe(3);
        expect(durationMinutes(variant("minutes", 2.4))).toBe(2);
    });
});
