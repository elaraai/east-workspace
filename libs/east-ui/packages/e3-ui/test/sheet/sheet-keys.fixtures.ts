/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A workshop's jobs and crew keyed by number (#1549): the fixture the Sheet's
 * and the Record's DOM tests over Integer keys read, on no page of the
 * showcase. A new row's key is one past the largest — 11 here, by the keys'
 * numbers, never their texts, whose largest is "9", a key taken.
 *
 * - **Jobs** (`numberedJobs`) 9 and 10, each a task and its quantity.
 * - **Crew** (`numberedCrew`) 2, 9 and 10, each a name, whether they are
 *   inducted, and their forklift level.
 *
 * Each record takes its patch door, so a Save commits through it as an app's
 * does.
 *
 * @packageDocumentation
 */

import { BooleanType, DictType, IntegerType, SortedMap, StringType, StructType, compareFor } from "@elaraai/east";
import e3 from "@elaraai/e3";

const compareNumber = compareFor(IntegerType);

/** A job: its task and its quantity. */
export const NumberedJob = StructType({ task: StringType, qty: IntegerType });

/** The workshop's jobs, by number: 9 and 10. */
export const numberedJobs = e3.record("sheet_numbered_jobs", DictType(IntegerType, NumberedJob), {
    initial: new SortedMap([
        [9n, { task: "Assembly", qty: 1n }],
        [10n, { task: "Spray finish", qty: 2n }],
    ], compareNumber),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** A crew member: their name, whether they are inducted, and their forklift level. */
export const NumberedMember = StructType({ name: StringType, inducted: BooleanType, forklift: StringType });

/** The workshop's crew, by number: 2, 9 and 10. */
export const numberedCrew = e3.record("record_numbered_crew", DictType(IntegerType, NumberedMember), {
    initial: new SortedMap([
        [2n, { name: "A. Morgan", inducted: true, forklift: "2" }],
        [9n, { name: "B. Ellis", inducted: false, forklift: "0" }],
        [10n, { name: "C. Patel", inducted: true, forklift: "1" }],
    ], compareNumber),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});
