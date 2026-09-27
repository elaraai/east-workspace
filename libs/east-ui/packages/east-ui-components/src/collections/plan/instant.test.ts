/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Plan's instants are East values: two are alike when East calls them
 * equal, and an instant's key spells its value as East prints it and reads
 * back with East's parser — every instant round-trips, `-0.0` and `NaN`
 * included. Instants are decoded from East's own encoding, as the canvas
 * holds them.
 */

import { describe, test, expect } from "vitest";
import { decodeBeast2For, encodeBeast2For } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { equalInstants, instantKey, instantOfKey, numberInstant, ordinalInstant, timeInstant, type PlanInstantValue } from "./instant.js";

/** An instant as the canvas holds it: decoded from East's own encoding. */
const stored = (t: PlanInstantValue): PlanInstantValue =>
    decodeBeast2For(Plan.Types.Instant)(encodeBeast2For(Plan.Types.Instant)(t));

describe("equalInstants", () => {
    test("the same arm and value are alike — two Dates of one instant too", () => {
        const at = new Date(Date.UTC(2026, 0, 5, 9));
        expect(equalInstants(stored(timeInstant(at)), timeInstant(new Date(at)))).toBe(true);
        expect(equalInstants(stored(numberInstant(3)), numberInstant(3))).toBe(true);
        expect(equalInstants(stored(ordinalInstant("P1")), ordinalInstant("P1"))).toBe(true);
    });

    test("as East compares: a NaN is alike to a NaN, -0.0 is not 0.0, and two arms never are", () => {
        expect(equalInstants(stored(numberInstant(NaN)), numberInstant(NaN))).toBe(true);
        expect(equalInstants(numberInstant(-0), numberInstant(0))).toBe(false);
        expect(equalInstants(numberInstant(0), ordinalInstant("0"))).toBe(false);
    });
});

describe("instantKey / instantOfKey", () => {
    test("a key spells the value as East prints it", () => {
        expect(instantKey(timeInstant(new Date(Date.UTC(2026, 0, 5))))).toBe("time:2026-01-05T00:00:00.000");
        expect(instantKey(numberInstant(3))).toBe("number:3.0");
        expect(instantKey(ordinalInstant("P1"))).toBe("ordinal:P1");
    });

    test("every instant reads back from its key as the same East value", () => {
        const instants = [
            timeInstant(new Date(Date.UTC(2026, 0, 5, 9, 30, 0, 125))),
            numberInstant(-0), numberInstant(NaN), numberInstant(1e21), numberInstant(0.1 + 0.2),
            ordinalInstant("P:1"),
        ];
        for (const t of instants) {
            const back = instantOfKey(instantKey(stored(t)));
            expect(back !== undefined && equalInstants(back, t), instantKey(t)).toBe(true);
        }
    });

    test("a string no instant produces names none", () => {
        expect(instantOfKey("time:2026-01-05")).toBeUndefined();
        expect(instantOfKey("number:")).toBeUndefined();
        expect(instantOfKey("span:1")).toBeUndefined();
        expect(instantOfKey("plain")).toBeUndefined();
    });
});
