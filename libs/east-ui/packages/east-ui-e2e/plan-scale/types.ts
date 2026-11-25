/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The plan-scale lab's records (#1710): a print works' presses and the jobs on them — the types its package declares and
 * its generator writes, and the span the jobs fill.
 *
 * @packageDocumentation
 */

import { BooleanType, DateTimeType, DictType, FloatType, IntegerType, NullType, OptionType, SetType, StringType, StructType, VariantType } from "@elaraai/east";
import { EventStateType } from "@elaraai/east-ui";

/**
 * A press: its name and hall, its model and how it stands, the sheets it prints an hour, its colour units, when it
 * was last serviced, whether it perfects, and the shifts it runs — each a field the rail narrows the presses by.
 */
export const LabPress = StructType({
    name: StringType,
    hall: StringType,
    model: StringType,
    status: StringType,
    sheets_per_hour: FloatType,
    colours: IntegerType,
    serviced: DateTimeType,
    perfecting: BooleanType,
    shifts: SetType(StringType),
});

/** The presses record: the presses by their keys. */
export const LabPresses = DictType(StringType, LabPress);

/**
 * A print job: when it runs and on which press — none of the three while it waits in the backlog — the lifecycle it
 * wears, its sheets, and the customer's details.
 */
export const LabJob = StructType({
    title: StringType,
    start: OptionType(DateTimeType),
    end: OptionType(DateTimeType),
    press: OptionType(StringType),
    state: EventStateType,
    sheets: FloatType,
    customer: StringType,
    stock: VariantType({ coated: NullType, uncoated: NullType, board: NullType }),
    due: OptionType(DateTimeType),
});

/** The jobs record: the jobs by their keys, `J-` and an eight-figure number, so key order is number order. */
export const LabJobs = DictType(StringType, LabJob);

/** How many presses the works runs: forty halls of a hundred. */
export const LAB_PRESSES = 4_000n;

/** How many presses a hall holds. */
export const LAB_HALL_PRESSES = 100n;

/** The first press's number: every press key is `P-` and five figures, so key order is number order. */
export const LAB_FIRST_PRESS = 10_001n;

/** The span the jobs fill: five years, the first day of 2022 to the last of 2026. */
export const LAB_FROM = new Date("2022-01-01T00:00:00Z");
export const LAB_TO = new Date("2027-01-01T00:00:00Z");

/** The Plan's now: the jobs before it are done, the ones across it running, the ones after it planned. */
export const LAB_NOW = new Date("2026-11-25T09:00:00Z");
