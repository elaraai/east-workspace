/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Counting a query's rows (#933): the program a run uses when the builder
 * wants each shape line's count — the query, with the number of rows bound
 * after each stage whose shape is rows, and the counts and a bounded result
 * as its output — so one run gives every count (`Query Editor Spec.md` §4.11).
 *
 * @packageDocumentation
 */

import { ArrayType, IntegerType, isValueOf, printJq, type EastType, type ValueTypeOf } from "@elaraai/east";
import { IDENTITY, arrayNode, commaAll, integerLiteral, objectNode, sliceTo, variable } from "./jq.js";
import { SEP, layOutSteps } from "./print.js";
import type { StepQuery } from "./values.js";

/** The id a count of the data source's rows is given, beside the steps' ids. */
export const SOURCE_COUNT = "$source";

/** How many rows a counting run returns, by default. */
export const DEFAULT_MAX_ROWS = 1000;

/** The counts a counting program gives: one per counted stage. */
const CountsType = ArrayType(IntegerType);

/** A counting program, and what its counts count. */
export interface CountingProgram {
    /** The program's text. */
    readonly text: string;
    /** What each count is of, in order: {@link SOURCE_COUNT}, or a step's id. */
    readonly counted: readonly string[];
}

/**
 * The program that runs a query and counts each stage's rows.
 *
 * @param query - the query
 * @param root - the root's type: a struct of the data sources
 * @param options - `maxRows`, how many rows of a rows result to return (1 000 by default)
 * @returns the program, and what its counts are of
 *
 * @remarks
 * After the data source and each step whose shape is rows, the program binds
 * `length as $nK`; it ends `{counts: [$n0, …], result: …}`, the result
 * `.[:maxRows]` when the query gives rows and `.` otherwise. It checks against
 * the root as the query does.
 */
export function countingProgram(query: StepQuery, root: EastType, options: { maxRows?: number } = {}): CountingProgram {
    const layout = layOutSteps(query, root);
    const after = new Map(layout.steps.map(s => [s.step.value.id, s.after]));
    const lines: string[] = [];
    const counted: string[] = [];
    for (const segment of layout.segments) {
        lines.push(segment.text);
        if (!segment.last) continue;
        const shape = segment.stepId === undefined ? layout.source : after.get(segment.stepId);
        if (shape?.kind !== "rows") continue;
        lines.push(`length as $n${counted.length}`);
        counted.push(segment.stepId ?? SOURCE_COUNT);
    }
    const counts = arrayNode(counted.length === 0 ? undefined : commaAll(counted.map((_, i) => variable(`n${i}`))));
    const result = layout.final.kind === "rows" ? sliceTo(IDENTITY, integerLiteral(BigInt(options.maxRows ?? DEFAULT_MAX_ROWS))) : IDENTITY;
    lines.push(printJq(objectNode([{ key: "counts", value: counts }, { key: "result", value: result }])).text);
    return { text: lines.join(SEP), counted };
}

/**
 * Reads a counting run's output.
 *
 * @param output - what the counting program gave: its counts and its result
 * @param counted - what each count is of, as {@link countingProgram} gave it
 * @returns each count, by {@link SOURCE_COUNT} or step id, and the result
 * @throws {Error} When the counts are not one whole number per counted stage.
 */
export function readCounts<T>(
    output: { readonly counts: ValueTypeOf<typeof CountsType>; readonly result: T },
    counted: readonly string[],
): { counts: ReadonlyMap<string, number>; value: T } {
    if (!isValueOf(output.counts, CountsType) || output.counts.length !== counted.length) {
        throw new Error(`readCounts: expected ${counted.length} counts, one per counted stage`);
    }
    return {
        counts: new Map(counted.map((id, i) => [id, Number(output.counts[i]!)])),
        value: output.result,
    };
}
