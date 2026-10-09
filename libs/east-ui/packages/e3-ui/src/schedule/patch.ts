/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Schedule.patch(R, { … })` (#1195): what a card dropped on an event sets —
 * a patch over an event kind's row type, every field an `Option`, the fields
 * it leaves out `none`. It is built as the Sheet's `Sheet.patch` is. A
 * builder's library tab returns one from its `drop` (`Plan.library.tab`), and
 * the patch's type names the event kind whose events take the drop.
 *
 * @packageDocumentation
 */

import { East, OptionType, StructType, none, some, type EastType, type ExprType, type SubtypeExprOrValue } from "@elaraai/east";

/**
 * The TS type of `Schedule.Types.Patch(R)`: every field of `R` as an `Option`.
 *
 * @typeParam R - The event kind's row type
 */
export type SchedulePatchOf<R extends StructType> = StructType<{ [K in keyof R["fields"]]: OptionType<R["fields"][K]> }>;

/**
 * The literal-record input of `Schedule.patch(R, …)`: every field of `R`
 * optional, each a literal or an expression of the field's type; a field left
 * out is `none`.
 *
 * @typeParam R - The event kind's row type
 */
export type SchedulePatchInput<R extends StructType> = { [K in keyof R["fields"]]?: SubtypeExprOrValue<R["fields"][K]> };

/**
 * `Schedule.Types.Patch(R)`: a patch over an event kind's row type — every
 * field of `R` as an `Option`, `none` leaving the event's field as it is.
 *
 * @typeParam R - The event kind's row type
 * @param rowType - The row type value
 * @returns The patch type
 */
export function SchedulePatchTypeFor<R extends StructType>(rowType: R): SchedulePatchOf<R> {
    const fields: Record<string, EastType> = {};
    for (const [name, type] of Object.entries(rowType.fields as Record<string, EastType>)) fields[name] = OptionType(type);
    return StructType(fields) as unknown as SchedulePatchOf<R>;
}

/**
 * Builds a patch over an event kind's row type — `Schedule.patch(R, { … })`:
 * the fields it sets, every other field `none`. A library card's `drop`
 * returns one, the fields a card dropped on an event sets
 * (`Plan.library.tab`).
 *
 * @typeParam R - The event kind's row type
 * @param rowType - The row type value
 * @param record - The fields to set
 * @returns An expression of `Schedule.Types.Patch(R)`
 *
 * @example
 * ```tsx
 * import { DateTimeType, DictType, OptionType, StringType, StructType } from "@elaraai/east";
 * import { Plan, Record, Schedule } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * const JobType = StructType({
 *     title: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType),
 *     press: OptionType(StringType), customer: StringType,
 * });
 * const CustomerType = StructType({ name: StringType, town: StringType });
 * const customers = e3.record("customers", DictType(StringType, CustomerType), new Map());
 *
 * // Inside a Plan's Reactive body: a card per customer, which sets the job it is dropped on.
 * const customerTab = Plan.library.tab(Record.bind(customers, []).read(), {
 *     name: "Customers", icon: "building", label: (c) => c.name,
 *     drop: (c) => Schedule.patch(JobType, { customer: c.name }),
 * });
 * ```
 */
export function schedulePatch<R extends StructType>(rowType: R, record: SchedulePatchInput<R>): ExprType<SchedulePatchOf<R>> {
    const fields: Record<string, unknown> = {};
    const given = record as Record<string, unknown>;
    for (const name of Object.keys(rowType.fields as Record<string, EastType>)) {
        fields[name] = given[name] !== undefined ? some(given[name] as SubtypeExprOrValue<EastType>) : none;
    }
    return East.value(fields as never, SchedulePatchTypeFor(rowType)) as ExprType<SchedulePatchOf<R>>;
}
