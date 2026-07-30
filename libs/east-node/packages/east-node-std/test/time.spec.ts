/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { describeEast, Assert, Time, NodePlatform } from "@elaraai/east-node-std";
import * as ex from "./time.examples.js";

describeEast("Time platform functions", (test) => {
    Assert.examples(test, { timeNow: ex.timeNow, timeSleep: ex.timeSleep, timeGetTimezoneOffset: ex.timeGetTimezoneOffset });

    test("now returns a timestamp", $ => {
        const timestamp = $.let(Time.now());

        // Should be a reasonable timestamp (after 2020)
        $(Assert.greater(timestamp, 1577836800000n)); // Jan 1, 2020
    });

    test("now returns increasing values", $ => {
        const time1 = $.let(Time.now());
        const time2 = $.let(Time.now());

        // time2 should be >= time1
        $(Assert.greaterEqual(time2, time1));
    });

    test("sleep pauses execution", $ => {
        const start = $.let(Time.now());
        $(Time.sleep(100n)); // Sleep for 100ms
        const end = $.let(Time.now());

        const elapsed = $.let(end.subtract(start));

        // Should have slept most of the requested time. The slack must cover
        // a full Windows timer quantum (~15.6ms) — sleep can wake a tick
        // early relative to the clock reads (measured 88ms for 100ms in CI).
        $(Assert.greaterEqual(elapsed, 80n));
    });

    // getTimezoneOffset tests — DST-aware

    test("getTimezoneOffset returns 660 for Sydney in summer (AEDT)", $ => {
        // Jan 15 2025 is Australian summer (AEDT, UTC+11)
        const summerDate = $.let(new Date("2025-01-15T00:00:00Z"));
        const offset = $.let(Time.getTimezoneOffset(summerDate, "Australia/Sydney"));
        $(Assert.equal(offset, 660n));
    });

    test("getTimezoneOffset returns 600 for Sydney in winter (AEST)", $ => {
        // Jul 15 2025 is Australian winter (AEST, UTC+10)
        const winterDate = $.let(new Date("2025-07-15T00:00:00Z"));
        const offset = $.let(Time.getTimezoneOffset(winterDate, "Australia/Sydney"));
        $(Assert.equal(offset, 600n));
    });

    test("getTimezoneOffset returns 570 for Adelaide in winter (ACST)", $ => {
        const winterDate = $.let(new Date("2025-07-15T00:00:00Z"));
        const offset = $.let(Time.getTimezoneOffset(winterDate, "Australia/Adelaide"));
        $(Assert.equal(offset, 570n));
    });

    test("getTimezoneOffset returns 630 for Adelaide in summer (ACDT)", $ => {
        const summerDate = $.let(new Date("2025-01-15T00:00:00Z"));
        const offset = $.let(Time.getTimezoneOffset(summerDate, "Australia/Adelaide"));
        $(Assert.equal(offset, 630n));
    });

    test("getTimezoneOffset returns 480 for Perth (no DST)", $ => {
        const summerDate = $.let(new Date("2025-01-15T00:00:00Z"));
        const winterDate = $.let(new Date("2025-07-15T00:00:00Z"));
        const summerOffset = $.let(Time.getTimezoneOffset(summerDate, "Australia/Perth"));
        const winterOffset = $.let(Time.getTimezoneOffset(winterDate, "Australia/Perth"));
        $(Assert.equal(summerOffset, 480n));
        $(Assert.equal(winterOffset, 480n));
    });

    test("getTimezoneOffset returns -300 for New York in winter (EST)", $ => {
        const winterDate = $.let(new Date("2025-01-15T00:00:00Z"));
        const offset = $.let(Time.getTimezoneOffset(winterDate, "America/New_York"));
        $(Assert.equal(offset, -300n));
    });

    test("getTimezoneOffset returns -240 for New York in summer (EDT)", $ => {
        const summerDate = $.let(new Date("2025-07-15T00:00:00Z"));
        const offset = $.let(Time.getTimezoneOffset(summerDate, "America/New_York"));
        $(Assert.equal(offset, -240n));
    });

    test("getTimezoneOffset returns -480 for Los Angeles in winter (PST)", $ => {
        const winterDate = $.let(new Date("2025-01-15T00:00:00Z"));
        const offset = $.let(Time.getTimezoneOffset(winterDate, "America/Los_Angeles"));
        $(Assert.equal(offset, -480n));
    });

    test("getTimezoneOffset returns 540 for Tokyo (no DST)", $ => {
        const date = $.let(new Date("2025-06-15T00:00:00Z"));
        const offset = $.let(Time.getTimezoneOffset(date, "Asia/Tokyo"));
        $(Assert.equal(offset, 540n));
    });

    test("getTimezoneOffset returns 0 for London in winter (GMT)", $ => {
        const winterDate = $.let(new Date("2025-01-15T00:00:00Z"));
        const offset = $.let(Time.getTimezoneOffset(winterDate, "Europe/London"));
        $(Assert.equal(offset, 0n));
    });

    test("getTimezoneOffset returns 60 for London in summer (BST)", $ => {
        const summerDate = $.let(new Date("2025-07-15T00:00:00Z"));
        const offset = $.let(Time.getTimezoneOffset(summerDate, "Europe/London"));
        $(Assert.equal(offset, 60n));
    });

    test("getTimezoneOffset returns 330 for Kolkata (IST, no DST)", $ => {
        const date = $.let(new Date("2025-06-15T00:00:00Z"));
        const offset = $.let(Time.getTimezoneOffset(date, "Asia/Kolkata"));
        $(Assert.equal(offset, 330n));
    });

    test("getTimezoneOffset returns 345 for Kathmandu (NPT)", $ => {
        const date = $.let(new Date("2025-06-15T00:00:00Z"));
        const offset = $.let(Time.getTimezoneOffset(date, "Asia/Kathmandu"));
        $(Assert.equal(offset, 345n));
    });

    test("getTimezoneOffset returns 720 for Auckland in winter (NZST)", $ => {
        const winterDate = $.let(new Date("2025-07-15T00:00:00Z"));
        const offset = $.let(Time.getTimezoneOffset(winterDate, "Pacific/Auckland"));
        $(Assert.equal(offset, 720n));
    });

    test("getTimezoneOffset returns 780 for Auckland in summer (NZDT)", $ => {
        const summerDate = $.let(new Date("2025-01-15T00:00:00Z"));
        const offset = $.let(Time.getTimezoneOffset(summerDate, "Pacific/Auckland"));
        $(Assert.equal(offset, 780n));
    });

    test("getTimezoneOffset returns 0 for UTC", $ => {
        const date = $.let(new Date("2025-06-15T00:00:00Z"));
        const offset = $.let(Time.getTimezoneOffset(date, "UTC"));
        $(Assert.equal(offset, 0n));
    });

}, { platformFns: NodePlatform });
