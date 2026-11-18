/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Plan's modules load east-ui-components' entry,
 * which needs one as it loads (#1177).
 *
 * The row an event stands on, as a drop's candidate names it (#1541, U7):
 * worked out from the event's resource, with no canvas.
 */

import { describe, test, expect } from "vitest";
import { none, some, variant } from "@elaraai/east";
import { rowKeyOf } from "../model.js";
import { entry } from "../row-id.test-utils.js";
import { eventRowId, type PlanLandingValue } from "./landings.js";

/** A landing series its kinds draw bars and marks on: the canvas's own entries, or rows beneath a group's. */
const landing = (key: string, top: boolean): PlanLandingValue =>
    ({ key, name: key, draws: [variant("span", null), variant("marks", null)], kinds: ["job", "stop"], series: [], top, under: none }) as PlanLandingValue;
const LANDINGS = [landing("presses", true), landing("crews", false)];
/** An event kind that draws marks, by what a candidate's row reads of it. */
const STOPS = { key: "stop", draw: variant("marks", null) } as Parameters<typeof eventRowId>[0];
const key = (id: ReturnType<typeof eventRowId>) => (id === undefined ? undefined : rowKeyOf(id));

describe("the row an event stands on, as a candidate names it (#1541, U7)", () => {
    test("its resource's own landing row as the canvas holds it, whichever row beside it the kind draws on", () => {
        const held = entry("presses", "hall-a", "a1");
        expect(key(eventRowId(STOPS, some({ kind: "presses", key: "a1" }), held, LANDINGS))).toBe(rowKeyOf(held));
    });

    test("a resource of the canvas's own entries the canvas does not hold is named by its key: the same row, in view or not", () => {
        expect(key(eventRowId(STOPS, some({ kind: "presses", key: "a9" }), undefined, LANDINGS))).toBe(rowKeyOf(entry("presses", "a9")));
    });

    test("a resource beneath a row the canvas has not read has no row to name: its place among the rows is not known", () => {
        expect(eventRowId(STOPS, some({ kind: "crews", key: "c1" }), undefined, LANDINGS)).toBeUndefined();
        // Nor one of a series no kind lands on.
        expect(eventRowId(STOPS, some({ kind: "vans", key: "v1" }), undefined, LANDINGS)).toBeUndefined();
    });

    test("an event on no resource stands on its kind's Unassigned row", () => {
        expect(key(eventRowId(STOPS, none, undefined, LANDINGS))).toBe(rowKeyOf(entry("stop.unassigned", "marks")));
    });
});
