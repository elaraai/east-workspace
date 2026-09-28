/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The drag grammar's slot codecs spell a coordinate as East prints it and read
 * it back with East's parser, so every Float and every instant round-trips to
 * the same East value.
 */

import { describe, test, expect } from "vitest";
import { DateTimeType, FloatType, equalFor } from "@elaraai/east";
import { dateTimeSlot, numberSlot, stringSlot, toEastDateTimeSlot } from "./slot-key.js";

const equalFloats = equalFor(FloatType);
const equalInstants = equalFor(DateTimeType);

describe("numberSlot", () => {
    test("spells a Float as East prints it", () => {
        expect(numberSlot.encode(5)).toBe("5.0");
        expect(numberSlot.encode(-0)).toBe("-0.0");
        expect(numberSlot.encode(0.1 + 0.2)).toBe("0.30000000000000004");
    });

    test("every Float reads back as the same East value — -0.0, NaN and the infinities too", () => {
        for (const n of [5, -0, 0, 0.1 + 0.2, 1e21, 1e-7, NaN, Infinity, -Infinity]) {
            const back = numberSlot.decode(numberSlot.encode(n));
            expect(back !== undefined && equalFloats(back, n), String(n)).toBe(true);
        }
    });

    test("text East does not read as a Float names no coordinate", () => {
        expect(numberSlot.decode("")).toBeUndefined();
        expect(numberSlot.decode("abc")).toBeUndefined();
    });
});

describe("dateTimeSlot", () => {
    const instant = new Date(Date.UTC(2026, 6, 6, 13, 5, 7, 9));

    test("spells an instant as East prints it — the UTC ISO form without a Z", () => {
        expect(toEastDateTimeSlot(instant)).toBe("2026-07-06T13:05:07.009");
        expect(dateTimeSlot.encode(instant)).toBe("2026-07-06T13:05:07.009");
    });

    test("reads its own spelling back as the same instant, and nothing else", () => {
        expect(equalInstants(dateTimeSlot.decode(dateTimeSlot.encode(instant))!, instant)).toBe(true);
        expect(dateTimeSlot.decode("2026-07-06T13:05:07.009Z")).toBeUndefined();
        expect(dateTimeSlot.decode("2026-07-06")).toBeUndefined();
    });
});

describe("stringSlot", () => {
    test("a string coordinate is its own slot", () => {
        expect(stringSlot.encode("wed")).toBe("wed");
        expect(stringSlot.decode("wed")).toBe("wed");
    });
});
