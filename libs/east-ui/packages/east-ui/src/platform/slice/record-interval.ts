/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Queries for e3's ordinary maintained centred interval index. */
import { DateTimeType, IntegerType, OptionType, none, parseFor, printFor, some, variant, type option, type ValueTypeOf } from "@elaraai/east";
import type { SeekQueryType } from "../../contracts/source.js";
import type { RecordSliceChoiceType, RecordSliceIndexType } from "./record-types.js";
import type { RecordOnPrinter } from "./record-on.js";

type Interval = Extract<ValueTypeOf<RecordSliceIndexType>["interval"], { type: "some" }>["value"];

/** How an interval index reads a row's time, as a binding's index metadata carries it: its start and end fields. */
export interface IntervalMarker {
    /** The row field an event starts at. */
    readonly from: string;
    /** The row field it ends at. */
    readonly to: string;
}

/**
 * The names of the struct `Data.bindPaged` marks an interval index with in a
 * binding's index metadata — its kind's `interval` case (#1432), as an area
 * index's names its box: its start and end fields, each named with its role
 * (`from=…`, `to=…`). A marker's names are the kind's own, never a row field
 * among the index's.
 *
 * @param marker - The index's start and end fields
 * @returns The marker struct's field names, in order
 */
export function intervalMarkerFields(marker: IntervalMarker): string[] {
    return [`from=${marker.from}`, `to=${marker.to}`];
}

/**
 * Read an interval index's start and end back from its marker's field names
 * ({@link intervalMarkerFields}).
 *
 * @param names - The marker struct's field names
 * @returns The fields, or `undefined` when the names are not an interval marker's
 */
export function readIntervalMarker(names: readonly string[]): IntervalMarker | undefined {
    const roles = new Map<string, string>();
    for (const name of names) {
        const at = name.indexOf("=");
        const role = name.slice(0, Math.max(at, 0));
        if (at <= 0 || (role !== "from" && role !== "to") || roles.has(role)) return undefined;
        roles.set(role, name.slice(at + 1));
    }
    const from = roles.get("from"), to = roles.get("to");
    return from === undefined || to === undefined ? undefined : { from, to };
}
const leaf = 3n * (1n << 53n);
const integerText = printFor(IntegerType);

/**
 * Each exact prefix has one start range and at most 54 carry-in ranges.
 * Their event identities are disjoint: each interval lives at one ancestor;
 * which side the lower bound lies on selects its start or end ordering.
 * Counts therefore sum original events, without reading or deduplicating rows.
 * The key is `{ on, node, at }` (#1432): a search of its own fields names `on`
 * as one literal, a range bounds it flattened, the leading values one by one.
 * @param prefix - Exact choices of every leading field.
 * @param choice - Half-open overlap range, exact start values, or all starts.
 * @param interval - The generated index's interval metadata.
 * @param printOn - The index's `on` printer.
 * @returns Disjoint ordinary key searches understood by every record backend.
 */
export function intervalQueries(prefix: readonly string[], choice: ValueTypeOf<RecordSliceChoiceType> | undefined, interval: Interval,
    printOn: RecordOnPrinter): ValueTypeOf<SeekQueryType>[] {
    const starts = [...prefix, integerText(0n)];
    const atRoot = [printOn(prefix), integerText(0n)];
    if (choice === undefined) return [variant("fields", { values: atRoot, prefix: none })];
    if (choice.type === "values") return [...new Set(choice.value)].map(value => variant("fields", { values: [...atRoot, value], prefix: none }));
    if (choice.type !== "range") throw new Error("Choose a time range for interval overlap");
    const type = interval.optional ? OptionType(DateTimeType) : DateTimeType;
    const parse = parseFor(type);
    const print = printFor(type);
    const lower = parse(choice.value.from);
    const upper = parse(choice.value.to);
    if (!lower.success || !upper.success) throw new Error("Choose valid DateTime range endpoints");
    const unwrap = (value: Date | option<Date>): Date => {
        if (!interval.optional) return value as Date;
        const optional = value as option<Date>;
        if (optional.type === "none") throw new Error("Choose two range endpoints");
        return optional.value;
    };
    const from = unwrap(lower.value);
    const to = unwrap(upper.value);
    if (from.getTime() >= to.getTime()) throw new Error("The range end must be after its start");
    const after = new Date(from.getTime() + 1);
    const afterText = print(interval.optional ? some(after) : after);
    const queries: ValueTypeOf<SeekQueryType>[] = [variant("range", {
        from: [...starts, choice.value.from], to: [...starts, choice.value.to],
    })];
    for (let child = leaf + BigInt(from.getTime()); child > 1n; child /= 2n) {
        const right = child % 2n === 1n;
        const code = 2n * (child / 2n) + (right ? 1n : 0n);
        const node = [...prefix, integerText(code)];
        queries.push(variant("range", right
            ? { from: [...node, afterText], to: [...prefix, integerText(code + 1n)] }
            : { from: node, to: [...node, choice.value.from] }));
    }
    return queries;
}
