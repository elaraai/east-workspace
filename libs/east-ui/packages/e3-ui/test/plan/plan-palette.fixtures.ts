/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The presses a Plan's own library panel drops its cards on (#1259): a record
 * small enough to read whole, saved through its patch door as a Plan's
 * `record` saves (#1541) — the fixture the panel's drop tests read, on no page
 * of the showcase.
 *
 * @packageDocumentation
 */

import { DateTimeType, DictType, StringType, StructType } from "@elaraai/east";
import * as e3 from "@elaraai/e3";

/** A press's job: when it runs. */
export const Job = StructType({ start: DateTimeType, end: DateTimeType });
/** A press: its name, and its jobs, by id. */
export const Press = StructType({ name: StringType, jobs: DictType(StringType, Job) });

/** Two presses, no job on either: a card dropped from the panel makes the first. */
export const presses = e3.record("palette_presses", DictType(StringType, Press), {
    initial: new Map([
        ["p1", { name: "Press 1", jobs: new Map() }],
        ["p2", { name: "Press 2", jobs: new Map() }],
    ]),
    mutations: (mutation) => ({
        // The presses' patch door: a Plan's Save commits through it.
        patch: mutation.patch(),
    }),
});
