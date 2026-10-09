/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Plan's modules load east-ui-components' entry,
 * which needs one as it loads (#1177).
 *
 * The Plan's moves over its own axes (#825): the shared arithmetic
 * (`shared/time/drag.ts`, `slot.ts`, #1148) on a number axis, a list and a time
 * axis of the Plan's instants. The arithmetic's time cases are the shared
 * module's own tests.
 */

import { describe, it, expect } from "vitest";
import { variant } from "@elaraai/east";
import { moveSpan, resizeSpan, unitsBetween } from "../../shared/time/drag.js";
import { slotOfEnd, slotOfInstant } from "../../shared/time/slot.js";
import { planScale } from "../scale.js";
import type { PlanInstantValue } from "../instant.js";
import { timeAt as t, utcAt } from "../plan.test-utils.js";
import type { PlanSpan } from "./store.js";

const n = (v: number): PlanInstantValue => variant("number", v) as PlanInstantValue;
const o = (v: string): PlanInstantValue => variant("ordinal", v) as PlanInstantValue;
const spanOf = (start: PlanInstantValue, end: PlanInstantValue): PlanSpan => ({ start, end });
const PHASES = ["PREPRESS", "PLATES", "PRINT", "FINISH"];

describe("the units a pointer travelled", () => {
    it("on a number or ordinal axis Shift changes nothing: the bucket is the step", () => {
        const num = planScale({ kind: "number", window: { min: 0, max: 10 }, step: 1 })!;
        expect(unitsBetween(num, 0.05, 0.35, true)).toBe(unitsBetween(num, 0.05, 0.35, false));
        const ord = planScale({ kind: "ordinal", values: PHASES })!;
        expect(unitsBetween(ord, 0.1, 0.9, true)).toBe(3);
    });
});

describe("moving an element", () => {
    it("moves by the step on a number axis, and by position on an ordinal one, never out of the list", () => {
        const num = planScale({ kind: "number", window: { min: 0, max: 20 }, step: 2 })!;
        expect(moveSpan(num, spanOf(n(3), n(7)), 2, false)).toEqual(spanOf(n(7), n(11)));
        const ord = planScale({ kind: "ordinal", values: PHASES })!;
        expect(moveSpan(ord, spanOf(o("PLATES"), o("PRINT")), 1, false)).toEqual(spanOf(o("PRINT"), o("FINISH")));
        // Two further would run FINISH off the list's end: it stops at the edge.
        expect(moveSpan(ord, spanOf(o("PLATES"), o("PRINT")), 2, false)).toEqual(spanOf(o("PRINT"), o("FINISH")));
        expect(moveSpan(ord, spanOf(o("PLATES"), o("PRINT")), -3, false)).toEqual(spanOf(o("PREPRESS"), o("PLATES")));
    });

    it("moves a time instant of the Plan's by the calendar", () => {
        const months = planScale({ kind: "time", window: { min: utcAt("2026-01-01T00:00:00"), max: utcAt("2027-01-01T00:00:00") }, resolution: "month" })!;
        expect(moveSpan(months, spanOf(t("2026-01-31T00:00:00"), t("2026-03-31T00:00:00")), 1, false))
            .toEqual(spanOf(t("2026-02-28T00:00:00"), t("2026-04-30T00:00:00")));
    });

    it("leaves an element on another arm where it is", () => {
        const weeks = planScale({ kind: "time", window: { min: utcAt("2026-06-29T00:00:00"), max: utcAt("2026-09-21T00:00:00") }, resolution: "week" })!;
        expect(moveSpan(weeks, spanOf(n(3), n(5)), 2, false)).toEqual(spanOf(n(3), n(5)));
    });
});

describe("resizing an element", () => {
    it("on an ordinal axis one bucket is start = end, the end naming its last bucket", () => {
        const ord = planScale({ kind: "ordinal", values: PHASES })!;
        expect(resizeSpan(ord, spanOf(o("PLATES"), o("PRINT")), "end", -5, false)).toEqual(spanOf(o("PLATES"), o("PLATES")));
        expect(resizeSpan(ord, spanOf(o("PLATES"), o("PRINT")), "end", 5, false)).toEqual(spanOf(o("PLATES"), o("FINISH")));
    });
});

describe("the drag grammar's slots on the Plan's axes (#631)", () => {
    it("a number axis spells a bucket's start as East prints the Float", () => {
        const num = planScale({ kind: "number", window: { min: 0, max: 10 }, step: 2 })!;
        expect(slotOfInstant(num, n(5))).toBe("4.0");
        expect(slotOfEnd(num, n(6))).toBe("4.0");
    });

    it("a list spells the value, and an end names the bucket it names", () => {
        const ord = planScale({ kind: "ordinal", values: PHASES })!;
        expect(slotOfInstant(ord, o("PRINT"))).toBe("PRINT");
        expect(slotOfEnd(ord, o("PRINT"))).toBe("PRINT");
    });

    it("a time axis spells the instant as East prints a DateTime", () => {
        const weeks = planScale({ kind: "time", window: { min: utcAt("2026-06-29T00:00:00"), max: utcAt("2026-09-21T00:00:00") }, resolution: "week" })!;
        expect(slotOfInstant(weeks, t("2026-07-08T00:00:00"))).toBe("2026-07-06T00:00:00.000");
        expect(slotOfEnd(weeks, t("2026-07-27T00:00:00"))).toBe("2026-07-20T00:00:00.000");
    });
});
