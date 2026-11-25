/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The plan-nested lab's works, as East makes them (#1710): e3-ui's `planNestedAll` generators made denser — every
 * collection a week or a fortnight apart where theirs were weeks apart — so that a works holds some 1,600 items over
 * five years, and a thousand works over a million and a half.
 *
 * @packageDocumentation
 */

import { ArrayType, East, IntegerType, StringType, DictType, variant } from "@elaraai/east";
import { EventStateType } from "@elaraai/east-ui";
import { LabWorks, LabWorksJob, LabWorksPart, WORKS_START, FIRST_WORKS } from "./types.ts";

/** A part's jobs over the weeks: one every four weeks from its first, a day or two long, each keyed by the part and its number. */
export const generatePartJobs = East.function([StringType, IntegerType, IntegerType], DictType(StringType, LabWorksJob), ($, at, first, weeks) => {
    const start = $.const(WORKS_START);
    const confirmed = $.const(variant("confirmed", null), EventStateType);
    return East.Array.range(0n, weeks.subtract(first).add(3n).divide(4n)).toDict(
        (_$2, j) => East.str`${at}-J${j.add(1_001n)}`,
        ($2, j) => {
            const begins = $2.const(start.addWeeks(first.add(j.multiply(4n))).addHours(30n));
            return { product: "part", start: begins, end: begins.addDays(j.remainder(2n).add(1n)), state: confirmed };
        },
    );
});

/** A part at the foot of a works' tree: its jobs over the weeks, from its first, and no parts beneath it. */
export const generateLeafPart = East.function([StringType, IntegerType, IntegerType], LabWorksPart, ($, at, first, weeks) => {
    const jobs = $.const(generatePartJobs);
    return $.const({ name: at, jobs: jobs(at, first, weeks), parts: new Map() }, LabWorksPart);
});

/** A works' top part: its jobs over the weeks, from its first, and two parts beneath it, each a week on from the one before. */
export const generateTopPart = East.function([StringType, IntegerType, IntegerType], LabWorksPart, ($, at, first, weeks) => {
    const jobs = $.const(generatePartJobs);
    const leaf = $.const(generateLeafPart);
    return $.const({
        name: at,
        jobs: jobs(at, first, weeks),
        parts: East.Array.range(0n, 2n).toDict(
            (_$2, k) => East.str`${at}.${k.add(1n)}`,
            (_$2, k) => leaf(East.str`${at}.${k.add(1n)}`, first.add(k.add(1n)).remainder(4n), weeks),
        ),
    }, LabWorksPart);
});

/**
 * Works `n` over a number of weeks from Monday 3 January 2022, each works at its own offset into every cycle so that
 * no two works' items line up: a job a week, one to four days long and every ninth ten days; an alarm a fortnight; its
 * load each week; three crews' hours each week; and three parts, a top part over two, each a job every four weeks. A
 * function of `n` and the weeks alone.
 */
export const generateWorks = East.function([IntegerType, IntegerType], LabWorks, ($, n, weeks) => {
    const start = $.const(WORKS_START);
    const sites = $.const(["north", "south", "east", "west"], ArrayType(StringType));
    const statuses = $.const(["running", "idle", "down"], ArrayType(StringType));
    const products = $.const(["cap", "lid", "tub", "jar"], ArrayType(StringType));
    const confirmed = $.const(variant("confirmed", null), EventStateType);
    const topPart = $.const(generateTopPart);
    const number = $.const(n.add(FIRST_WORKS));
    // Its offset into each week, in days.
    const shift = $.const(n.multiply(3n).remainder(7n));
    return {
        name: East.str`Works ${number}`,
        site: sites.get(n.remainder(4n)),
        status: statuses.get(n.remainder(3n)),
        jobs: East.Array.range(0n, weeks).toDict(
            (_$2, j) => East.str`J-${number}-${j.add(1_001n)}`,
            ($2, j) => {
                const begins = $2.const(start.addDays(j.multiply(7n).add(shift)).addHours(n.remainder(24n)));
                const days = $2.const(j.remainder(9n).equal(8n).ifElse(() => 10n, () => j.remainder(4n).add(1n)));
                return { product: products.get(j.remainder(4n)), start: begins, end: begins.addDays(days), state: confirmed };
            },
        ),
        alarms: East.Array.range(0n, weeks.divide(2n)).toDict(
            (_$2, a) => East.str`A-${number}-${a.add(1_001n)}`,
            (_$2, a) => ({ code: East.str`E${a.remainder(9n).add(1n)}`, at: start.addDays(a.multiply(14n).add(n.multiply(5n).remainder(14n))).addHours(6n) }),
        ),
        load: East.Array.range(0n, weeks).toDict(
            (_$2, m) => start.addWeeks(m),
            (_$2, m) => n.multiply(7n).add(m.multiply(13n)).remainder(100n).toFloat().divide(100.0),
        ),
        crews: East.Array.range(0n, 3n).toDict(
            (_$2, c) => East.str`C-${number}-${c.add(1n)}`,
            (_$2, c) => ({
                name: East.str`Crew ${c.add(1n)}`,
                hours: East.Array.range(0n, weeks).toDict(
                    (_$3, q) => start.addWeeks(q),
                    (_$3, q) => n.add(q).add(c.multiply(5n)).remainder(20n).add(30n).toFloat(),
                ),
            }),
        ),
        parts: East.Array.range(0n, 1n).toDict(
            (_$2, k) => East.str`P${number}.${k.add(1n)}`,
            (_$2, k) => topPart(East.str`P${number}.${k.add(1n)}`, n.remainder(4n), weeks),
        ),
    };
});
