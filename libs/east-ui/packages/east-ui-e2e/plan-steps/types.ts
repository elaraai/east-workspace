/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The plan-steps lab's records (#1710): a print works' halls, each holding its machines, and the steps on them — one
 * record of every kind of step, each step a row of its own, keyed by a variant of the keys each kind is made under —
 * the types its package declares and its generator writes, and the span the steps fill.
 *
 * @packageDocumentation
 */

import {
    DateTimeType, DictType, FloatType, IntegerType, NullType, StringType, StructType, VariantType,
} from "@elaraai/east";
import { EventStateType } from "@elaraai/east-ui";

/** What a machine is: the kind of row it draws as, and the steps that land on it. */
export const LabMachineKind = VariantType({ press: NullType, crew: NullType, bay: NullType });

/** A machine of a hall: its name, and what it is. */
export const LabMachine = StructType({ name: StringType, what: LabMachineKind });

/** A hall: its name, its site, and its machines by their keys — `P-10001`, `C-1001`, `B-101`. */
export const LabHall = StructType({ name: StringType, site: StringType, machines: DictType(StringType, LabMachine) });

/** The halls record: the halls by their keys, `H10` to `H49`. Nothing dated is stored in it. */
export const LabHalls = DictType(StringType, LabHall);

/**
 * A step's key: a variant of the keys each kind of step is made under — a press's work under its order and its place
 * in it, a crew's shift under the crew and its start, a bay's delivery under the bay and its slot.
 */
export const LabStepId = VariantType({
    job: StructType({ order: StringType, n: IntegerType }),
    shift: StructType({ crew: StringType, date: DateTimeType }),
    drop: StructType({ bay: StringType, slot: DateTimeType }),
});

/** The machine a step is on, by its kind and its key: what places the step on that machine's row. */
export const LabStepOn = VariantType({ press: StringType, crew: StringType, bay: StringType });

/** What a step is, each kind with its own details: a run and its setup on a press, a crew's shift, a bay's delivery. */
export const LabStepKind = VariantType({
    run: StructType({ title: StringType, sheets: FloatType }),
    setup: StructType({ plates: IntegerType }),
    labour: StructType({ people: IntegerType }),
    delivery: StructType({ pallets: FloatType }),
});

/** A step: the hall it is in, the machine it is on, when it runs, the lifecycle it wears, and what it is. */
export const LabStep = StructType({
    hall: StringType,
    on: LabStepOn,
    start: DateTimeType,
    end: DateTimeType,
    state: EventStateType,
    kind: LabStepKind,
});

/** The steps record: every step of every kind, by its key. */
export const LabSteps = DictType(LabStepId, LabStep);

/** How many halls the works has. */
export const LAB_HALLS = 40n;

/** The first hall's number: halls are keyed `H10` to `H49`, so their keys sort as their numbers do. */
export const LAB_FIRST_HALL = 10n;

/** Each hall's presses, crews and bays. */
export const LAB_HALL_PRESSES = 70n;
export const LAB_HALL_CREWS = 20n;
export const LAB_HALL_BAYS = 10n;

/** The first press's, crew's and bay's numbers: every key is its letter and a fixed width, so key order is number order. */
export const LAB_FIRST_PRESS = 10_001n;
export const LAB_FIRST_CREW = 1_001n;
export const LAB_FIRST_BAY = 101n;

/** The span the steps fill: five years, the first day of 2022 to the last of 2026. */
export const LAB_FROM = new Date("2022-01-01T00:00:00Z");
export const LAB_TO = new Date("2027-01-01T00:00:00Z");

/** The Plan's now: the steps before it are done, the ones across it running, the ones after it planned. */
export const LAB_NOW = new Date("2026-11-25T09:00:00Z");
