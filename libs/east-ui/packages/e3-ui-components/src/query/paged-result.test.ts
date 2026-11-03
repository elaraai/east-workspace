/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A result too large for one answer, read a page at a time (#1113), apart
 * from e3: a collection opened as a result — an Array's or a Set's rows, a
 * Dict none; its windows from the pages that landed, across pages, asking for
 * those that have not and reading nothing then, and saying why a page could
 * not be read; and the Table's paged row source over them, each window's rows
 * the Table's own, cell for cell.
 */

import { describe, test, expect } from "vitest";
import {
    ArrayType, DictType, IntegerType, SetType, SortedSet, StringType, StructType,
    compareFor, encodeBeast2For, none, some, toEastTypeValue, variant, type EastType, type EastTypeValue,
} from "@elaraai/east";
import type { RemoteCollection } from "@elaraai/e3-api-client";
import { formatters } from "@elaraai/east-ui-components";
import { queryWords } from "./model/words.js";
import { RESULT_PAGE_ROWS, pagedResultOf, resultWindows, type PagedResult, type PagedResultPages } from "./paged-result.js";
import { pagedResultTable, resultTable } from "./results-table.js";

const words = queryWords(formatters("en-US"));

const Row = StructType({ id: IntegerType, name: StringType });
const Rows = ArrayType(Row);

/** 2,500 rows: two whole pages and half of a third. */
const ROWS = Array.from({ length: 2_500 }, (_, i) => ({ id: BigInt(i), name: `row ${i}` }));

/** A collection held in memory, as e3-api-client's `collectionOpen` answers one: each window beast2 at its type. */
function remote(type: EastType, value: readonly unknown[], hash = "f00d"): RemoteCollection {
    const typeValue = toEastTypeValue(type) as EastTypeValue;
    return {
        hash,
        type: typeValue,
        totalElements: value.length,
        page: async ({ offset, limit }) => {
            const rows = value.slice(offset, offset + limit);
            const window = type.type === "Set" ? new SortedSet(rows, compareFor((type as { key: EastType }).key)) : rows;
            return { data: encodeBeast2For(type)(window as never), offset, count: rows.length };
        },
    };
}

/** The pages a result's reads hold — some landed — and the pages asked for. */
function pagesOf(landed: readonly number[], value: readonly unknown[] = ROWS, failure?: string): PagedResultPages & { readonly asked: number[][] } {
    const asked: number[][] = [];
    return {
        pages: new Map(landed.map((p) => [p, value.slice(p * RESULT_PAGE_ROWS, (p + 1) * RESULT_PAGE_ROWS)])),
        failure,
        need: (first, last) => { asked.push([first, last]); },
        keep: () => {},
        asked,
    };
}

/** The result over the rows, as the run opens it. */
function result(): PagedResult {
    const paged = pagedResultOf(remote(Rows, ROWS));
    if (paged === undefined) throw new Error("an Array opens as a result");
    return paged;
}

describe("a result read a page at a time (#1113)", () => {
    test("an Array's or a Set's collection opens as a result — its type, its rows, a page decoded — and a Dict's does not", async () => {
        const paged = result();
        expect([paged.hash, paged.total, paged.type]).toEqual(["f00d", 2_500, Rows]);
        expect(await paged.page(1_998, 4)).toEqual(ROWS.slice(1_998, 2_002));
        const names = ["a", "b", "c"];
        expect([...(await pagedResultOf(remote(SetType(StringType), names))!.page(1, 5)) as Set<string>]).toEqual(["b", "c"]);
        expect(pagedResultOf(remote(DictType(StringType, IntegerType), []))).toBeUndefined();
    });

    test("a window from the pages that landed, across pages, fewer at the end; one whose pages have not landed asks for them and reads nothing", () => {
        const paged = result();
        const all = resultWindows(paged, pagesOf([0, 1, 2]));
        expect(all.rows(990, 20)).toEqual(ROWS.slice(990, 1_010));
        expect(all.rows(2_450, 200)).toEqual(ROWS.slice(2_450));
        expect(all.rows(2_500, 200)).toEqual([]);
        const some = pagesOf([0]);
        expect(resultWindows(paged, some).rows(900, 200)).toBeUndefined();
        expect(some.asked).toEqual([[0, 1]]);
    });

    test("a window of a result whose page could not be read says why", () => {
        expect(() => resultWindows(result(), pagesOf([0], ROWS, "the segment was not there")).rows(0, 10)).toThrow("the segment was not there");
    });

    test("as the Table's value: a paged row source — its id the hash, its total every row, each window the Table's own rows; none while a page is read", () => {
        const paged = result();
        const table = pagedResultTable(paged.type, resultWindows(paged, pagesOf([1])), words);
        if (table.rows.type !== "paged") throw new Error("expected the paged arm");
        const source = table.rows.value;
        expect([source.id, source.total(), source.seek]).toEqual(["f00d", some(2_500n), none]);
        const inline = resultTable({ type: Rows, value: ROWS.slice(1_200, 1_210) }, words);
        if (inline.rows.type !== "inline") throw new Error("expected the inline arm");
        expect(source.page(1_200n, 10n)).toEqual(some(inline.rows.value));
        expect(table.columns).toEqual(inline.columns);
        expect(source.page(0n, 200n)).toEqual(none);
        expect(variant("Integer", 1_200n)).toEqual(inline.rows.value[0]!.cells.get("id"));
    });
});
