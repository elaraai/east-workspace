/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Time answers from web-standard globals as east-node-std does: the clock,
 * a sleep, and a zone's UTC offset from `Intl`; and a sleep its host stops
 * fails at once, leaving no timer.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DateTimeType, East, EastError, IntegerType, NullType, StringType, lessEqualFor } from "@elaraai/east";
import { Time, createTimeImpl } from "@elaraai/east-web-std";

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

describe("Time.sleep, stopped by its host", () => {
    /** How many timers this process has pending. */
    const timers = (): number => process.getActiveResourcesInfo().filter(resource => resource === "Timeout").length;

    /** A sleep whose host stops it with a signal. */
    const stoppable = (signal: AbortSignal) =>
        East.asyncFunction([IntegerType], NullType, ($, ms) => { $(Time.sleep(ms)); }).toIR().compile(createTimeImpl(signal));

    /** Whether an error is the sleep's failure, its host having stopped it. */
    const stopped = (error: unknown): boolean => error instanceof EastError && error.message === "Failed to sleep: the program was stopped";

    it("fails a sleep under way once the host's signal aborts, clearing its timer", async () => {
        const controller = new AbortController();
        const before = timers();
        const sleeping = stoppable(controller.signal)(600_000n);
        for (let waited = 0; timers() === before && waited < 5_000; waited += 5) {
            await new Promise(resolve => setImmediate(resolve));
        }
        assert.equal(timers(), before + 1, "its timer is pending");
        controller.abort();
        await assert.rejects(sleeping, stopped);
        assert.equal(timers(), before, "and cleared: nothing keeps the process for ten minutes");
    });

    it("fails a sleep begun once the host's signal has aborted, waiting for nothing", async () => {
        const controller = new AbortController();
        controller.abort();
        const before = timers();
        await assert.rejects(stoppable(controller.signal)(600_000n), stopped);
        assert.equal(timers(), before, "no timer was set");
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
