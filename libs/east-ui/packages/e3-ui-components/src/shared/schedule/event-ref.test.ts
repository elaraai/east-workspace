/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, expect, test } from "vitest";
import { equalFor } from "@elaraai/east";
import { ScheduleEventRefType } from "@elaraai/e3-ui/internal";
import { parseEventRef, printEventRef } from "./event-ref.js";

const sameRef = equalFor(ScheduleEventRefType);

describe("an event's key (shared/schedule/event-ref)", () => {
    test("prints an event's kind and key as East prints its reference", () => {
        expect(printEventRef({ kind: "job", key: "J-1001" })).toBe('(kind="job", key="J-1001")');
    });

    test("reads back what it printed, whatever the key holds", () => {
        for (const key of ["J-1001", "", 'a "quoted" key', "with, a comma", '(kind="job", key="x")', "tab\tand\nline", "é — ü"]) {
            const read = parseEventRef(printEventRef({ kind: "job", key }));
            expect(read.success).toBe(true);
            if (read.success) expect(sameRef(read.value, { kind: "job", key })).toBe(true);
        }
    });

    test("two kinds' events of one key have two keys", () => {
        expect(printEventRef({ kind: "job", key: "1" })).not.toBe(printEventRef({ kind: "stop", key: "1" }));
    });

    test("a string that is no reference fails to read", () => {
        for (const text of ["plates", "", "(kind=\"job\")", "J-1001"]) expect(parseEventRef(text).success).toBe(false);
    });
});
