/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Time answers from web-standard globals as east-node-std does: the clock,
 * a sleep, and a zone's UTC offset from `Intl`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DateTimeType, East, EastError, IntegerType, NullType, StringType, lessEqualFor } from "@elaraai/east";
import { Time } from "@elaraai/east-web-std";

const now = East.function([], IntegerType, _$ => Time.now()).toIR().compile(Time.Implementation);
const sleep = East.asyncFunction([IntegerType], NullType, ($, ms) => { $(Time.sleep(ms)); }).toIR().compile(Time.Implementation);
const offset = East.function([DateTimeType, StringType], IntegerType, ($, at, zone) => Time.getTimezoneOffset(at, zone)).toIR().compile(Time.Implementation);

describe("Time.now", () => {
    it("reads the clock, in milliseconds since the epoch", () => {
        const before = BigInt(Date.now());
        const read = now();
        const after = BigInt(Date.now());
        const atMost = lessEqualFor(IntegerType);
        assert.ok(atMost(before, read) && atMost(read, after), `${read} is not between ${before} and ${after}`);
    });
});

describe("Time.sleep", () => {
    it("resolves once the time has passed", async () => {
        const start = Date.now();
        await sleep(30n);
        // A timer can fire a clock tick early against Date.now; never ten
        assert.ok(Date.now() - start >= 20);
    });
});

describe("Time.getTimezoneOffset", () => {
    it("gives a zone's offset at an instant, with its daylight saving", () => {
        const summer = new Date("2025-01-15T00:00:00Z");
        const winter = new Date("2025-07-15T00:00:00Z");
        assert.equal(offset(summer, "Australia/Sydney"), 660n);
        assert.equal(offset(winter, "Australia/Sydney"), 600n);
        assert.equal(offset(winter, "Australia/Adelaide"), 570n);
        assert.equal(offset(summer, "America/New_York"), -300n);
        assert.equal(offset(winter, "Asia/Kathmandu"), 345n);
        assert.equal(offset(winter, "UTC"), 0n);
    });

    it("fails a name that is not an IANA zone with an EastError", () => {
        assert.throws(
            () => offset(new Date("2025-01-15T00:00:00Z"), "Not/AZone"),
            (error: unknown) => error instanceof EastError && error.message.startsWith(`Invalid IANA timezone: "Not/AZone".`),
        );
    });
});
