/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Plan's modules load east-ui-components' entry,
 * which needs one as it loads (#1177).
 */

/**
 * What the canvas's elements select by (#1197): an element's key that reads
 * back as a `Schedule.Types.EventRef` of one of the Plan's event kinds is an
 * event's, and selects its event; any other key selects its row.
 */

import { describe, test, expect } from "vitest";
import { printFor, variant } from "@elaraai/east";
import { ScheduleEventRefType } from "@elaraai/e3-ui/internal";
import type { PlanElementRefValue } from "../context.js";
import type { PlanRowId } from "../model.js";
import { elementKeyOf, selectableOf } from "./element-select.js";

const printRef = printFor(ScheduleEventRefType);

describe("what the canvas's elements select by (#1197)", () => {
    test("an element keyed by an event of one of the Plan's kinds is an event's; one of another kind, or keyed otherwise, is not", () => {
        const selectable = selectableOf(["job", "shift"]);
        expect(selectable(printRef({ kind: "job", key: "J-1001" }))).toBe(true);
        expect(selectable(printRef({ kind: "shift", key: "SH-01" }))).toBe(true);
        // A kind the Plan has not: an event no kind of its own draws.
        expect(selectable(printRef({ kind: "stop", key: "S-01" }))).toBe(false);
        // A series' own run, keyed as its author keyed it.
        expect(selectable("order")).toBe(false);
        expect(selectable("")).toBe(false);
        // Read once, answered the same again.
        expect(selectable(printRef({ kind: "job", key: "J-1001" }))).toBe(true);
    });

    test("a Plan of no event kinds selects no element's event", () => {
        expect(selectableOf(undefined)(printRef({ kind: "job", key: "J-1001" }))).toBe(false);
        expect(selectableOf([])(printRef({ kind: "job", key: "J-1001" }))).toBe(false);
    });

    test("an element ref's own key: a run's, an event's, a chip's or a mark's — a cell's and a link's none", () => {
        const row = variant("entry", { series: "presses.span", path: ["a1"] }) as PlanRowId;
        expect(elementKeyOf(variant("run", { row, run: "r1" }) as PlanElementRefValue)).toBe("r1");
        expect(elementKeyOf(variant("event", { row, event: "e1" }) as PlanElementRefValue)).toBe("e1");
        expect(elementKeyOf(variant("chip", { row, chip: "c1" }) as PlanElementRefValue)).toBe("c1");
        expect(elementKeyOf(variant("mark", { row, mark: "m1" }) as PlanElementRefValue)).toBe("m1");
        expect(elementKeyOf(variant("cell", { row, at: variant("time", new Date("2026-10-05T00:00:00Z")) }) as PlanElementRefValue)).toBeUndefined();
    });
});
