/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, NullType, DateTimeType, StringType } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { EastError } from "@elaraai/east/internal";

/**
 * Computes the UTC offset in minutes for an IANA timezone at a given instant.
 *
 * Uses Intl.DateTimeFormat to format the datetime in both UTC and the target
 * timezone, then computes the difference. This is reliable across all Node.js
 * versions — it only depends on the date component formatting, not abbreviations.
 */
function computeUtcOffsetMinutes(datetime: Date, zone: string): number {
    const formatParts = (tz: string) => {
        const fmt = new Intl.DateTimeFormat("en-US", {
            timeZone: tz,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        });
        const parts = fmt.formatToParts(datetime);
        const get = (type: string) => parseInt(parts.find(p => p.type === type)!.value);
        return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
    };

    const utc = formatParts("UTC");
    const local = formatParts(zone);

    const utcMs = Date.UTC(utc.year, utc.month - 1, utc.day, utc.hour, utc.minute, utc.second);
    const localMs = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);

    return (localMs - utcMs) / 60000;
}

/**
 * Gets the current Unix timestamp in milliseconds.
 *
 * Returns the number of milliseconds elapsed since the Unix epoch
 * (January 1, 1970 00:00:00 UTC). This is useful for timestamping events,
 * measuring durations, and working with date/time data.
 *
 * This is a platform function for the East language, enabling time access
 * in East programs running on Node.js.
 *
 * @returns The current time as milliseconds since epoch (January 1, 1970 UTC)
 *
 * @example
 * ```ts
 * const getTimestamp = East.function([], IntegerType, $ => {
 *     return Time.now();
 *     // Returns: 1735689600000n (example)
 * });
 * ```
 */
export const time_now = East.platform("time_now", [], IntegerType);

/**
 * Sleeps for the specified number of milliseconds.
 *
 * Pauses execution asynchronously for the given duration. This is a non-blocking
 * sleep that allows other operations to run during the wait period. Useful for
 * rate limiting, delays, and timing control.
 *
 * This is a platform function for the East language, enabling timed delays
 * in East programs running on Node.js.
 *
 * @param ms - The number of milliseconds to sleep (must be non-negative)
 * @returns Null after sleeping completes
 *
 * @throws {EastError} When sleep fails (e.g., negative duration)
 *
 * @example
 * ```ts
 * const delayedTask = East.function([], NullType, $ => {
 *     $(Console.log("Starting..."));
 *     $(Time.sleep(1000n));  // Wait 1 second
 *     $(Console.log("Done!"));
 * });
 * ```
 */
export const time_sleep = East.asyncPlatform("time_sleep", [IntegerType], NullType);

/**
 * Gets the UTC offset in minutes for an IANA timezone at a given UTC datetime.
 *
 * Returns the number of minutes that the given timezone is ahead of (positive)
 * or behind (negative) UTC at the specified instant. This accounts for DST
 * transitions — the same timezone can return different offsets depending on
 * the datetime.
 *
 * The timezone must be a valid IANA timezone name (e.g., "Australia/Sydney",
 * "America/New_York", "Europe/London", "Asia/Tokyo"). See the IANA Time Zone
 * Database for the full list of valid names.
 *
 * @param datetime - A UTC datetime to compute the offset for
 * @param zone - An IANA timezone name (e.g., "Australia/Sydney")
 * @returns UTC offset in minutes (e.g., 660 for Sydney in summer, 600 in winter)
 *
 * @throws {EastError} When the timezone name is not a valid IANA timezone
 *
 * @example
 * ```ts
 * const toSydneyTime = East.function([DateTimeType], DateTimeType, ($, dt) => {
 *     const offset = $.let(Time.getTimezoneOffset(dt, "Australia/Sydney"));
 *     $.return(dt.addMinutes(offset));
 * });
 * ```
 */
export const time_get_timezone_offset = East.platform(
    "time_get_timezone_offset",
    [DateTimeType, StringType],
    IntegerType,
);

/**
 * Node.js implementation of time platform functions.
 *
 * Pass this array to {@link East.compileAsync} to enable time operations.
 */
const TimeImpl: PlatformFunction[] = [
    time_now.implement(() => {
        try {
            return BigInt(Date.now());
        } catch (err: any) {
            throw new EastError(`Failed to get current time: ${err.message}`, {
                location: [{ filename: "time_now", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
    time_sleep.implement(async (ms: bigint) => {
        try {
            await new Promise(resolve => setTimeout(resolve, Number(ms)));
        } catch (err: any) {
            throw new EastError(`Failed to sleep: ${err.message}`, {
                location: [{ filename: "time_sleep", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
    time_get_timezone_offset.implement((datetime: Date, zone: string) => {
        try {
            const offset = computeUtcOffsetMinutes(datetime, zone);
            return BigInt(offset);
        } catch (err: any) {
            if (err instanceof RangeError) {
                throw new EastError(
                    `Invalid IANA timezone: "${zone}". ` +
                    `Use a valid IANA timezone name such as "Australia/Sydney", "America/New_York", or "Europe/London". ` +
                    `See https://en.wikipedia.org/wiki/List_of_tz_database_time_zones for the full list.`,
                    { location: [{ filename: "time_get_timezone_offset", line: 0n, column: 0n }], cause: err },
                );
            }
            if (err instanceof EastError) throw err;
            throw new EastError(`Failed to get timezone offset for "${zone}": ${err.message}`, {
                location: [{ filename: "time_get_timezone_offset", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
];

/**
 * Grouped time platform functions.
 *
 * Provides time, sleep, and timezone operations for East programs.
 *
 * @example
 * ```ts
 * import { East, NullType } from "@elaraai/east";
 * import { Time } from "@elaraai/east-node-std";
 *
 * const timedTask = East.function([], NullType, $ => {
 *     const start = $.let(Time.now());
 *     $(Time.sleep(1000n)); // Sleep for 1 second
 *     const end = $.let(Time.now());
 * });
 *
 * const compiled = await East.compileAsync(timedTask.toIR(), Time.Implementation);
 * await compiled();
 * ```
 */
export const Time = {
    /**
     * Gets the current Unix timestamp in milliseconds.
     *
     * Returns the number of milliseconds elapsed since the Unix epoch
     * (January 1, 1970 00:00:00 UTC). Useful for timestamping and measuring durations.
     *
     * @returns The current time as milliseconds since epoch
     *
     * @example
     * ```ts
     * const getTimestamp = East.function([], IntegerType, $ => {
     *     return Time.now();
     * });
     *
     * const compiled = await East.compileAsync(getTimestamp.toIR(), Time.Implementation);
     * await compiled();  // Returns: 1735689600000n (example timestamp)
     * ```
     */
    now: time_now,

    /**
     * Sleeps for the specified number of milliseconds.
     *
     * Pauses execution asynchronously for the given duration. Non-blocking sleep
     * that allows other operations to run during the wait period.
     *
     * @param ms - The number of milliseconds to sleep (must be non-negative)
     * @returns Null after sleeping completes
     * @throws {EastError} When sleep fails
     *
     * @example
     * ```ts
     * const delayedTask = East.function([], NullType, $ => {
     *     $(Console.log("Starting..."));
     *     $(Time.sleep(1000n));
     *     $(Console.log("Done!"));
     * });
     *
     * const compiled = await East.compileAsync(delayedTask.toIR(), Time.Implementation);
     * await compiled();  // Waits 1 second between log messages
     * ```
     */
    sleep: time_sleep,

    /**
     * Gets the UTC offset in minutes for an IANA timezone at a given UTC datetime.
     *
     * Accounts for DST — the same timezone returns different offsets depending
     * on the datetime. Use the result with `addMinutes` to convert a UTC datetime
     * to local time.
     *
     * @param datetime - A UTC datetime
     * @param zone - An IANA timezone name (e.g., "Australia/Sydney")
     * @returns UTC offset in minutes
     * @throws {EastError} When the timezone name is invalid
     *
     * @example
     * ```ts
     * const toSydneyTime = East.function([DateTimeType], DateTimeType, ($, dt) => {
     *     const offset = $.let(Time.getTimezoneOffset(dt, "Australia/Sydney"));
     *     $.return(dt.addMinutes(offset));
     * });
     * ```
     */
    getTimezoneOffset: time_get_timezone_offset,

    /**
     * Node.js implementation of time platform functions.
     *
     * Pass this to {@link East.compileAsync} to enable time operations.
     */
    Implementation: TimeImpl,
} as const;

// Export for backwards compatibility
export { TimeImpl };
