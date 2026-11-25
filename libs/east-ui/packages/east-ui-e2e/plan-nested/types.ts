/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The plan-nested lab's records (#1710): works whose rows nest every collection a Plan reads a cell at a time — each
 * works' jobs and alarms, its load, its crews and their hours, and a tree of parts — as e3-ui's `planNestedAll` has
 * them, over five years.
 *
 * @packageDocumentation
 */

import { DateTimeType, DictType, FloatType, RecursiveType, StringType, StructType } from "@elaraai/east";
import { EventStateType } from "@elaraai/east-ui";

/** A works' job: what it makes, when it runs, and its state. */
export const LabWorksJob = StructType({ product: StringType, start: DateTimeType, end: DateTimeType, state: EventStateType });

/** A works' alarm, raised at an instant. */
export const LabWorksAlarm = StructType({ code: StringType, at: DateTimeType });

/** A crew of a works: its name, and its hours each week, by the week's Monday. */
export const LabWorksCrew = StructType({ name: StringType, hours: DictType(DateTimeType, FloatType) });

/** A part of a works: its jobs, and the parts beneath it. */
export const LabWorksPart = RecursiveType((self) => StructType({ name: StringType, jobs: DictType(StringType, LabWorksJob), parts: DictType(StringType, self) }));

/**
 * A works: where it stands and how it is; its jobs and its alarms; its load each week; its crews, each one's hours each
 * week, the works' child rows; and its parts, a tree of child rows, each part's jobs filed under every part above it
 * too.
 */
export const LabWorks = StructType({
    name: StringType, site: StringType, status: StringType,
    jobs: DictType(StringType, LabWorksJob), alarms: DictType(StringType, LabWorksAlarm), load: DictType(DateTimeType, FloatType),
    crews: DictType(StringType, LabWorksCrew), parts: DictType(StringType, LabWorksPart),
});

/** The works record: the works by their keys, `W-` and a five-figure number, so key order is number order. */
export const LabWorksByKey = DictType(StringType, LabWorks);

/** Monday 3 January 2022, where the works' first week starts. */
export const WORKS_START = new Date(Date.UTC(2022, 0, 3));

/** The weeks the works' collections run over: five years, to the end of 2026. */
export const WORKS_WEEKS = 261n;

/** The first works' number. */
export const FIRST_WORKS = 10_001n;
