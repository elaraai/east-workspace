/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the time parts load east-ui-components' entry (its
 * formatters), which needs one as it loads.
 */

import { describe, it, expect } from "vitest";
import { DateTimeType, parseFor } from "@elaraai/east";
import { timeScale } from "./scale.js";
import { slotOfEnd, slotOfInstant } from "./slot.js";

const readDateTime = parseFor(DateTimeType);

/** An instant written as East prints a DateTime (UTC), read with East's own parser. */
function at(text: string): Date {
    const read = readDateTime(text);
    if (!read.success) throw new Error(read.error);
    return read.value;
}

/** A 12-week window, W27–W38 2026. */
const WEEKS = timeScale({ window: { min: at("2026-06-29T00:00:00"), max: at("2026-09-21T00:00:00") }, resolution: "week" })!;

describe("the drag grammar's slots on a time scale", () => {
    it("names the bucket an instant falls in, as East prints its start", () => {
        expect(slotOfInstant(WEEKS, at("2026-07-08T00:00:00"))).toBe("2026-07-06T00:00:00.000");
    });

    it("names the window's first or last bucket for an instant beyond it", () => {
        expect(slotOfInstant(WEEKS, at("2026-01-01T00:00:00"))).toBe("2026-06-29T00:00:00.000");
        expect(slotOfInstant(WEEKS, at("2027-01-01T00:00:00"))).toBe("2026-09-14T00:00:00.000");
    });

    it("names the bucket an END closes: an end on a bucket edge is the bucket before it", () => {
        expect(slotOfEnd(WEEKS, at("2026-07-27T00:00:00"))).toBe("2026-07-20T00:00:00.000");
        expect(slotOfEnd(WEEKS, at("2026-07-29T00:00:00"))).toBe("2026-07-27T00:00:00.000");
    });

    it("names the window's first or last bucket for an end beyond it", () => {
        expect(slotOfEnd(WEEKS, at("2026-06-01T00:00:00"))).toBe("2026-06-29T00:00:00.000");
        expect(slotOfEnd(WEEKS, at("2027-01-01T00:00:00"))).toBe("2026-09-14T00:00:00.000");
    });
});
