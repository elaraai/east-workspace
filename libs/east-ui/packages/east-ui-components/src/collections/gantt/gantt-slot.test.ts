/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Regression guard for #358: the Gantt drag-grammar slot text must parse as
 * an East DateTime (`slot.parse(DateTimeType)` is the documented consumer
 * contract) — `toISOString()`'s trailing `Z` does not.
 */

import { describe, test, expect } from "vitest";
import { East, DateTimeType, StringType } from "@elaraai/east";
import { toEastDateTimeSlot } from "./index.js";

describe("Gantt grammar slot text (#358)", () => {
    test("round-trips through East parse(DateTimeType)", () => {
        const parse = East.compile(
            East.function([StringType], DateTimeType, (_$, s) => s.parse(DateTimeType)),
            [],
        );
        for (const d of [
            new Date("2024-01-15T00:00:00.000Z"),
            new Date("2024-06-30T10:30:00.123Z"),
            new Date(0),
        ]) {
            const slot = toEastDateTimeSlot(d);
            expect(slot.endsWith("Z")).toBe(false);
            expect((parse(slot) as Date).getTime()).toBe(d.getTime());
        }
    });
});
