/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, IntegerType, NullType, example } from "@elaraai/east";
import { Time } from "@elaraai/east-node-std";

export const timeNow = example({
    keywords: ["time", "Time", "now", "timestamp", "current"],
    description: "Get the current timestamp in milliseconds",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const timestamp = $.let(Time.now());
        return timestamp.greater(1577836800000n);
    }),
    inputs: [],
    returns: true,
});

export const timeSleep = example({
    keywords: ["time", "Time", "sleep", "pause", "delay"],
    description: "Pause execution for a specified number of milliseconds",
    fn: East.asyncFunction([], NullType, ($) => {
        $(Time.sleep(10n));
    }),
    inputs: [],
});

export const timeGetTimezoneOffset = example({
    keywords: ["time", "Time", "getTimezoneOffset", "timezone", "offset", "DST"],
    description: "Get the timezone offset in minutes for a date and timezone",
    fn: East.asyncFunction([], IntegerType, ($) => {
        const date = $.let(new Date("2025-07-15T00:00:00Z"));
        const offset = $.let(Time.getTimezoneOffset(date, "Australia/Sydney"));
        return offset;
    }),
    inputs: [],
    returns: 600n,
});
