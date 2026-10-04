/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Query.value` (#1138) — the value of the saved queries record a solution
 * ships: each query it writes inline, checked against the data sources it may
 * read when the package is built.
 *
 * @packageDocumentation
 */

import { SortedMap, StringType, StructType, checkJq, compareFor, none, some, type EastType, type ValueTypeOf } from "@elaraai/east";
import type { DatasetDef, TaskDef } from "@elaraai/e3";
import { assertRootField } from "../bind/sources.js";
import type { SavedQueriesType, SavedQueryType } from "./types.js";

/** The most characters a saved query's description holds, as the builder's Save… popover takes it. */
const DESCRIPTION_MAX = 140;

/**
 * A query a solution saves, as it writes one.
 *
 * @property name - Its name, which is its key in the record
 * @property jq - Its program, as jq text
 * @property description - One sentence, at most 140 characters; omitted, the sentence generated from its steps shows instead
 * @property savedAt - When it was saved
 */
export interface SavedQueryInput {
    /** Its name, which is its key in the record. */
    readonly name: string;
    /** Its program, as jq text. */
    readonly jq: string;
    /** One sentence, at most 140 characters; omitted, the sentence generated from its steps shows instead. */
    readonly description?: string;
    /** When it was saved. */
    readonly savedAt: Date;
}

/**
 * The saved queries record's value — every query a solution ships in it, by
 * name — what it declares the record with.
 *
 * @remarks
 * - **The data sources** are named as a query reads them (`orders` for
 *   `.orders`), each a dataset or a task — the dataset or task `Data.bind`
 *   takes, whose path and type it reads. A query opens where each data source
 *   it reads is bound by the same name, at the same path.
 * - **Each query is checked** against the whole root, a struct of the data
 *   sources in the order given, as the builder checks a query it saves: one
 *   that does not check fails the build, with the checker's words. Its root
 *   is the data sources it reads, in that order.
 * - **A saved query keeps its program** as written, and no types: they are
 *   what checking it against its data sources gives.
 *
 * @param sources - The data sources the queries may read: each name, as a query reads it, to its dataset or task
 * @param queries - The queries, each its name, its jq, its description and when it was saved ({@link SavedQueryInput})
 * @returns The saved queries, by name: a value of the record's type, `Query.Types.Saved`
 * @throws {Error} When a data source's name is not a jq identifier; when a
 *   query does not check, naming it and saying why; when two queries have one
 *   name; and when a description holds more than 140 characters
 *
 * @example
 * ```ts
 * import { ArrayType, FloatType, IntegerType, StructType, variant } from "@elaraai/east";
 * import { Query } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * const orders = e3.input("orders", ArrayType(StructType({ id: IntegerType, total: FloatType })), variant("value", []));
 *
 * // The record ships with one query, checked against `orders` when the package builds.
 * export const queries = e3.record("queries", Query.Types.Saved, Query.value({ orders }, [
 *     { name: "Big orders", jq: ".orders | map(select(.total >= 1000))", savedAt: new Date("2026-10-01T09:00:00Z") },
 * ]));
 * export const queriesPatch = e3.mutation.patch(queries);
 * ```
 */
export function savedQueriesValue(
    sources: Readonly<Record<string, DatasetDef | TaskDef>>,
    queries: readonly SavedQueryInput[],
): ValueTypeOf<typeof SavedQueriesType> {
    // A task's data is its output dataset; a dataset is its own.
    const datasets = Object.entries(sources).map(([name, def]) => {
        assertRootField("Query.value", name);
        return { name, dataset: def.kind === "task" ? def.output : def };
    });
    const root = StructType(Object.fromEntries(datasets.map(({ name, dataset }): [string, EastType] => [name, dataset.type])));
    const saved = new SortedMap<string, ValueTypeOf<typeof SavedQueryType>>([], compareFor(StringType));
    for (const query of queries) {
        if (saved.has(query.name)) {
            throw new Error(`Query.value: "${query.name}" is saved twice — a saved query's name is its key in the record`);
        }
        if (query.description !== undefined && query.description.length > DESCRIPTION_MAX) {
            throw new Error(`Query.value: "${query.name}"'s description is ${query.description.length} characters — a description holds at most ${DESCRIPTION_MAX}`);
        }
        const checked = checkJq(query.jq, root, { root: true });
        if (checked.program === null) {
            const problems = checked.diagnostics.filter(d => d.severity.type === "error").map(d => d.message);
            throw new Error(`Query.value: "${query.name}" does not check — ${problems.join(" ")}`);
        }
        saved.set(query.name, {
            name: query.name,
            description: query.description === undefined ? none : some(query.description),
            program: checked.program,
            root: datasets.filter(({ name }) => checked.reads.includes(name)).map(({ name, dataset }) => ({ name, path: dataset.path })),
            saved_at: query.savedAt,
        });
    }
    return saved;
}
