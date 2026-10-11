/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Queries for e3's ordinary maintained centred interval index. */
import { DateTimeType, IntegerType, OptionType, none, parseFor, printFor, some, variant, type option, type ValueTypeOf } from "@elaraai/east";
import type { SeekQueryType } from "../../contracts/source.js";
import type { RecordSliceChoiceType, RecordSliceIndexType } from "./record-types.js";

type Interval = Extract<ValueTypeOf<RecordSliceIndexType>["interval"], { type: "some" }>["value"];
const leaf = 3n * (1n << 53n);
const integerText = printFor(IntegerType);

/**
 * Each exact prefix has one start range and at most 54 carry-in ranges.
 * Their event identities are disjoint: each interval lives at one ancestor;
 * which side the lower bound lies on selects its start or end ordering.
 * Counts therefore sum original events, without reading or deduplicating rows.
 * @param prefix - Exact choices of every leading field.
 * @param choice - Half-open overlap range, exact start values, or all starts.
 * @param interval - The generated index's interval metadata.
 * @returns Disjoint ordinary key searches understood by every record backend.
 */
export function intervalQueries(prefix: readonly string[], choice: ValueTypeOf<RecordSliceChoiceType> | undefined, interval: Interval): ValueTypeOf<SeekQueryType>[] {
    const starts = [...prefix, integerText(0n)];
    if (choice === undefined) return [variant("fields", { values: starts, prefix: none })];
    if (choice.type === "values") return [...new Set(choice.value)].map(value => variant("fields", { values: [...starts, value], prefix: none }));
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
