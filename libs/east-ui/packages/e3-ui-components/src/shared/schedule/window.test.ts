/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The one test of a place in time against a half-open window (east-workspace#1622, rule 11), which the Calendar, the
 * Plan and the Roster read a window and hold an optimiser's answer by: a span meets the window where it overlaps it, an
 * instant from its start to before the window's end, and an event with no place counts as inside.
 */

import { describe, expect, test } from "vitest";
import { none, some } from "@elaraai/east";
import { meetsWindow, placedOutside } from "./window.js";

/** A time in March 2028, UTC. */
const at = (day: string) => new Date(`2028-03-${day}Z`);
/** The window: Sun 5 to Sun 12 Mar, the second not in it. */
const FROM = at("05T00:00:00");
const TO = at("12T00:00:00");

describe("meetsWindow", () => {
    test("a span meets the window where it overlaps it, half open: starting before its end, and ending after its start", () => {
        expect([
            // A night shift across the window's start, and one across its end.
            meetsWindow(at("04T22:00:00"), at("05T06:00:00"), FROM, TO),
            meetsWindow(at("11T22:00:00"), at("12T06:00:00"), FROM, TO),
            // Ending as the window starts, and starting as it ends.
            meetsWindow(at("04T22:00:00"), FROM, FROM, TO),
            meetsWindow(TO, at("12T06:00:00"), FROM, TO),
        ]).toEqual([true, true, false, false]);
    });

    test("an instant — no end, one ending where it starts, or one ending before it — meets the window from its start to before its end", () => {
        expect([
            meetsWindow(FROM, undefined, FROM, TO),
            meetsWindow(at("04T23:59:59"), undefined, FROM, TO),
            meetsWindow(TO, undefined, FROM, TO),
            meetsWindow(FROM, FROM, FROM, TO),
            meetsWindow(at("06T00:00:00"), at("05T00:00:00"), FROM, TO),
        ]).toEqual([true, false, false, true, true]);
    });
});

describe("placedOutside", () => {
    test("an event falls outside the window where it meets none of it; one with no place — a backlog row, or one not read — counts as inside", () => {
        const window = { from: FROM, to: TO };
        expect([
            placedOutside({ start: some(at("12T06:00:00")), end: some(at("12T14:00:00")) }, window),
            placedOutside({ start: some(at("04T22:00:00")), end: some(at("05T06:00:00")) }, window),
            placedOutside({ start: some(at("04T12:00:00")), end: none }, window),
            placedOutside({ start: none, end: none }, window),
            placedOutside(undefined, window),
        ]).toEqual([true, false, true, false, false]);
    });
});
