/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A run's result as a Table (#938, `Query Editor Spec.md` §4.11): its rows and
 * columns, the words a cell shows for a nested or a missing value, and the
 * value the production Table renderer shows. Every result is a real one: the
 * shared fixture's, checked as a run checks it (`prepareQuery`) and evaluated
 * by East's own query engine.
 */

import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    ArrayType, DateTimeType, FloatType, IntegerType, NullType, OptionType, StringType, StructType, VariantType,
    evaluateJq, fromEastTypeValue, isTypeEqual, isValueOf, none, printFor, some, toEastTypeValue, variant,
    type EastType, type ValueTypeOf, type option,
} from "@elaraai/east";
import { Table } from "@elaraai/east-ui/internal";
import { EastChakraTable, I18nProvider, formatters, system, type TableRootValue } from "@elaraai/east-ui-components";
import { FIXTURE_VALUE, OrdersType, ROOT } from "./query.test-utils.js";
import { prepareQuery } from "./one-shot.js";
import { queryWords } from "./model/words.js";
import { cellText, resultRows, resultTable, type DecodedResult } from "./results-table.js";

beforeEach(() => { localStorage.clear(); });
afterEach(cleanup);

// ── Fixtures, at module scope ───────────────────────────────────────────────

/** The words, in English: the message table, and the en-US formatters. */
const words = queryWords(formatters("en-US"));
const f = words.formatters;
const printInteger = printFor(IntegerType);
const printDateTime = printFor(DateTimeType);

/** The builder's default query (`Query Editor Spec.md` §4.7). */
const DEFAULT_PROGRAM = [
    ".customers as $customers",
    "| .orders",
    "| map(select(.status.type == \"shipped\") | select(.total >= 100 and (.status.value.date | year) == 2026))",
    "| map(. + {name: $customers[.customer_id].name, region: $customers[.customer_id].region})",
    "| map({order: .id, customer: .name, region, total, shipped: .status.value.date})",
    "| sort_by(-.total)",
    "| .[:10]",
].join("\n");

/** The shared fixture's order (`libs/east/test/query.fixture.ts`), to read the results' values by; checked against the fixture's own type below. */
const LineType = StructType({ price: FloatType, qty: IntegerType, sku: StringType });
const StatusType = VariantType({ cancelled: StructType({ reason: StringType }), pending: NullType, shipped: StructType({ date: DateTimeType }) });
const OrderType = StructType({ customer_id: StringType, discount: OptionType(FloatType), id: IntegerType, lines: ArrayType(LineType), status: StatusType, total: FloatType });
type Order = ValueTypeOf<typeof OrderType>;

/** The default query's row: the order, its customer's name and region, its total and when it shipped. */
const ShippedOrderType = StructType({ order: IntegerType, customer: OptionType(StringType), region: OptionType(StringType), total: FloatType, shipped: DateTimeType });
type ShippedOrder = ValueTypeOf<typeof ShippedOrderType>;

/** A record's first line, as `map({id, first: .lines[0]})` gives it. */
const FirstLineType = StructType({ id: IntegerType, first: OptionType(LineType) });
type FirstLine = ValueTypeOf<typeof FirstLineType>;

/**
 * A program's result as a run gives it: its type as the run decodes its
 * answer — the element for a query giving one value, an option for none or
 * one, an array for many — and its value, evaluated over the shared fixture.
 */
function run(program: string): DecodedResult {
    const prepared = prepareQuery(program, ROOT);
    if (!("prepared" in prepared)) throw new Error(`${program} does not check`);
    const { query, checked } = prepared.prepared;
    const { element_type, multiplicity } = query.value;
    const element = fromEastTypeValue(element_type);
    const type: EastType = multiplicity.type === "one" ? element : multiplicity.type === "maybe" ? OptionType(element) : ArrayType(element);
    return { type, value: evaluateJq(checked, FIXTURE_VALUE, { root: true }) };
}

/** A result's value, read at the type a test expects, once the result's type is shown to be it. */
function valueAt<T>(result: DecodedResult, type: EastType): T {
    if (!isTypeEqual(result.type, type)) throw new Error("the result is not of the type the test reads it at");
    return result.value as T;
}

/** The Table's rows, inline. */
function tableRows(table: TableRootValue): ValueTypeOf<typeof Table.Types.Row>[] {
    if (table.rows.type !== "inline") throw new Error(`expected the Table's rows inline, got its ${table.rows.type} arm`);
    return table.rows.value;
}

/** Each Table row's cell in a column. */
function columnCells(table: TableRootValue, key: string): (ValueTypeOf<typeof Table.Types.Cell> | undefined)[] {
    return tableRows(table).map(row => row.cells.get(key));
}

/**
 * Renders a Table value through the production renderer, in English. jsdom
 * lays nothing out, so a virtualised table mounts no rows there: the render
 * turns virtualisation off to mount every row — the cells are what it checks.
 */
function renderTable(table: TableRootValue) {
    return render(
        <ChakraProvider value={system}>
            <I18nProvider locale="en-US">
                <EastChakraTable value={{ ...table, virtualization: some(false) }} storageKey="results-table" />
            </I18nProvider>
        </ChakraProvider>,
    );
}

/** The header's labels, in column order. */
function headers(container: HTMLElement): string[] {
    return [...container.querySelectorAll("thead th")].map(th => th.textContent ?? "");
}

/** Each body row's cell texts, in column order. */
function bodyRows(container: HTMLElement): string[][] {
    return [...container.querySelectorAll("tbody tr")].map(tr => [...tr.querySelectorAll("td")].map(td => td.textContent ?? ""));
}

/** Whether each body row's cell in a column sets its text as a number: right-aligned, in tabular mono. */
function numericCells(container: HTMLElement, column: number): boolean[] {
    return [...container.querySelectorAll("tbody tr")].map(tr => {
        const td = tr.querySelectorAll("td")[column];
        return td !== undefined && td.querySelector("[data-numeric]") !== null;
    });
}

/** A status as the Table words it: its case, then its payload. */
function statusWords(status: Order["status"]): string {
    switch (status.type) {
        case "shipped": return `shipped · ${f.dateTime(status.value.date)}`;
        case "pending": return "pending";
        case "cancelled": return `cancelled · ${status.value.reason}`;
    }
}

// ── Rows and columns ────────────────────────────────────────────────────────

describe("a result's rows and columns (#938)", () => {
    test("the fixture's orders are the type the tests read them at", () => {
        expect(isTypeEqual(ArrayType(OrderType), OrdersType)).toBe(true);
    });

    test("rows of records: one row per record, one column per field, in declared order", () => {
        const result = run(".orders[:3]");
        const { columns, rows } = resultRows(result);
        expect(columns.map(c => [c.key, c.field])).toEqual([
            ["customer_id", "customer_id"], ["discount", "discount"], ["id", "id"], ["lines", "lines"], ["status", "status"], ["total", "total"],
        ]);
        expect(rows).toEqual(valueAt<Order[]>(result, ArrayType(OrderType)));
    });

    test("one value: one `value` column, which reads no field, and one row", () => {
        const { columns, rows } = resultRows(run(".orders | length"));
        expect(columns).toEqual([{ key: "value", type: IntegerType, field: undefined }]);
        expect(rows).toEqual([{ value: 40n }]);
    });

    test("a record, here the option a query giving none or one gives: one row, its fields the columns", () => {
        const result = run("first(.orders[])");
        const first = valueAt<option<Order>>(result, OptionType(OrderType));
        if (first.type !== "some") throw new Error("the fixture has orders");
        const { columns, rows } = resultRows(result);
        expect(columns.map(c => c.key)).toEqual(["customer_id", "discount", "id", "lines", "status", "total"]);
        expect(rows).toEqual([first.value]);
    });

    test("an option with nothing: no rows, and the columns its payload would give", () => {
        const result = run("first(.orders[] | select(.id == 0))");
        expect(valueAt<option<Order>>(result, OptionType(OrderType)).type).toBe("none");
        const { columns, rows } = resultRows(result);
        expect(columns.map(c => c.key)).toEqual(["customer_id", "discount", "id", "lines", "status", "total"]);
        expect(rows).toEqual([]);
    });

    test("an array of other values: one row per value, in the `value` column", () => {
        const result = run(".orders | map(.total)");
        const totals = valueAt<number[]>(result, ArrayType(FloatType));
        const { columns, rows } = resultRows(result);
        expect(columns).toEqual([{ key: "value", type: FloatType, field: undefined }]);
        expect(rows).toEqual(totals.map(value => ({ value })));
    });
});

// ── A cell's words ──────────────────────────────────────────────────────────

describe("a cell's words (#938)", () => {
    const result = run(".orders");
    const orders = valueAt<Order[]>(result, ArrayType(OrderType));
    const table = resultTable(result, words);

    test("a list is its size and its items, named after its field: 1 line, 3 lines", () => {
        expect(columnCells(table, "lines")).toEqual(orders.map(o => variant("String", o.lines.length === 1 ? "1 line" : `${o.lines.length} lines`)));
        // The fixture's orders have one line and several.
        expect(new Set(orders.map(o => o.lines.length === 1))).toEqual(new Set([true, false]));
    });

    test("a case is its name, then its payload: a shipped order's date, a cancelled one's reason; a pending one is its name", () => {
        expect(columnCells(table, "status")).toEqual(orders.map(o => variant("String", statusWords(o.status))));
        expect(new Set(orders.map(o => o.status.type))).toEqual(new Set(["shipped", "pending", "cancelled"]));
    });

    test("a missing value is \"—\"; a present one is the value itself, under its own tag", () => {
        expect(columnCells(table, "discount")).toEqual(orders.map(o => (o.discount.type === "some" ? variant("Float", o.discount.value) : variant("String", "—"))));
        expect(new Set(orders.map(o => o.discount.type))).toEqual(new Set(["some", "none"]));
    });

    test("a primitive is a cell of its own: the id an Integer, the total a Float", () => {
        expect(columnCells(table, "id")).toEqual(orders.map(o => variant("Integer", o.id)));
        expect(columnCells(table, "total")).toEqual(orders.map(o => variant("Float", o.total)));
    });

    test("a record is its first fields' texts, a number in the viewer's language", () => {
        const firsts = run(".orders[:3] | map({id, first: .lines[0]})");
        const values = valueAt<FirstLine[]>(firsts, ArrayType(FirstLineType));
        expect(columnCells(resultTable(firsts, words), "first")).toEqual(values.map(v => {
            if (v.first.type !== "some") throw new Error("every order has a line");
            const line = v.first.value;
            return variant("String", `${f.float(line.price)} · ${f.number(line.qty)} · ${line.sku}`);
        }));
        expect(columnCells(resultTable(firsts, words), "first")[0]).toEqual(variant("String", "8.9 · 10 · HNG-220"));
    });

    test("a lookup table is its size in entries", () => {
        expect(columnCells(resultTable(run(".customers"), words), "value")).toEqual([variant("String", "8 entries")]);
    });

    test("the Table words a cell exactly as cellText does", () => {
        const { columns, rows } = resultRows(result);
        const shown = tableRows(table);
        let worded = 0;
        rows.forEach((row, i) => {
            for (const column of columns) {
                const text = cellText(column.type, (row as Readonly<Record<string, unknown>>)[column.key], words, column.field);
                if (text === undefined) continue;
                worded += 1;
                expect(shown[i]!.cells.get(column.key)).toEqual(variant("String", text));
            }
        });
        // Every order's lines and status, and each missing discount.
        expect(worded).toBe(orders.length * 2 + orders.filter(o => o.discount.type === "none").length);
    });

    test("cellText gives no words for a primitive, under its options too, and the missing word for a missing one", () => {
        expect(cellText(FloatType, orders[0]!.total, words, "total")).toBeUndefined();
        const discounts = orders.map(o => o.discount);
        expect(discounts.map(d => cellText(OptionType(FloatType), d, words, "discount"))).toEqual(discounts.map(d => (d.type === "some" ? undefined : "—")));
    });
});

// ── The Table ───────────────────────────────────────────────────────────────

describe("the Table's value (#938)", () => {
    test("is an East value of the Table's type, for every shape of result", () => {
        for (const program of [DEFAULT_PROGRAM, ".orders[:3]", ".orders | length", "first(.orders[])", "first(.orders[] | select(.id == 0))", ".orders | map(.total)", ".customers"]) {
            expect(isValueOf(resultTable(run(program), words), Table.Types.Root)).toBe(true);
        }
    });

    test("its rows are inline and flat; it is virtualised under a sticky header and fills its box", () => {
        const table = resultTable(run(DEFAULT_PROGRAM), words);
        expect(tableRows(table).map(row => [row.depth, row.collapsed])).toEqual(Array.from({ length: 10 }, () => [0n, false]));
        expect(table.virtualization).toEqual(some(true));
        if (table.style.type !== "some") throw new Error("the Table declares its style");
        expect([table.style.value.height, table.style.value.stickyHeader]).toEqual([some("fill"), some(true)]);
    });

    test("its columns are headed as a person reads a field's name, and declare no format, so every digit prints", () => {
        const table = resultTable(run(".orders[:3]"), words);
        expect(table.columns.map(c => c.header)).toEqual(["customer ID", "discount", "ID", "lines", "status", "total"].map(h => some(h)));
        expect(table.columns.map(c => [c.format, c.render, c.aggregate])).toEqual(table.columns.map(() => [none, none, none]));
        // A column's cells are its present values' kind: a missing discount's "—" sits among numbers.
        expect(table.columns.map(c => c.valueType)).toEqual([StringType, FloatType, IntegerType, StringType, StringType, FloatType].map(t => toEastTypeValue(t)));
    });
});

// ── Through the production renderer ─────────────────────────────────────────

describe("a result through the production Table renderer (#938)", () => {
    test("the default query: ten orders under their headers; an ID as written, a total exact, a date as East prints it", () => {
        const result = run(DEFAULT_PROGRAM);
        const shipped = valueAt<ShippedOrder[]>(result, ArrayType(ShippedOrderType));
        const { container } = renderTable(resultTable(result, words));
        expect(headers(container)).toEqual(["order", "customer", "region", "total", "shipped"]);
        const name = (o: option<string>): string => (o.type === "some" ? o.value : "—");
        expect(bodyRows(container)).toEqual(shipped.map(o => [printInteger(o.order), name(o.customer), name(o.region), f.float(o.total), printDateTime(o.shipped)]));
        // The fixture's top shipped order of 2026: its id never grouped ("1,035"), its total to the cent.
        expect(bodyRows(container)[0]).toEqual(["1035", "Northgate Supply", "QLD", "2381.61", "2026-06-01T14:00:00.000"]);
    });

    test("numbers sit right-aligned in tabular mono; text does not", () => {
        const { container } = renderTable(resultTable(run(DEFAULT_PROGRAM), words));
        const all = (column: number, numeric: boolean) => expect(numericCells(container, column)).toEqual(Array.from({ length: 10 }, () => numeric));
        all(0, true);
        all(1, false);
        all(2, false);
        all(3, true);
    });

    test("nested and missing: a list by its size, a case with its date, a missing discount \"—\" among the numbers", () => {
        const result = run(".orders[:3]");
        const orders = valueAt<Order[]>(result, ArrayType(OrderType));
        const { container } = renderTable(resultTable(result, words));
        expect(headers(container)).toEqual(["customer ID", "discount", "ID", "lines", "status", "total"]);
        expect(bodyRows(container)).toEqual(orders.map(o => [
            o.customer_id,
            o.discount.type === "some" ? f.float(o.discount.value) : "—",
            printInteger(o.id),
            o.lines.length === 1 ? "1 line" : `${o.lines.length} lines`,
            statusWords(o.status),
            f.float(o.total),
        ]));
        // The fixture's first three orders: one line and several, a discount and none, each shipped.
        expect(bodyRows(container).map(row => [row[1], row[3]])).toEqual([["0.1", "1 line"], ["—", "3 lines"], ["—", "2 lines"]]);
        expect(bodyRows(container).map(row => row[4]!.startsWith("shipped · "))).toEqual([true, true, true]);
        // The missing discount sits with the numbers, right-aligned in tabular mono.
        expect(numericCells(container, 1)).toEqual([true, true, true]);
    });

    test("one value: one `value` column, one row", () => {
        const { container } = renderTable(resultTable(run(".orders | length"), words));
        expect(headers(container)).toEqual(["value"]);
        expect(bodyRows(container)).toEqual([["40"]]);
    });

    test("a record: one row", () => {
        const result = run("first(.orders[])");
        const first = valueAt<option<Order>>(result, OptionType(OrderType));
        if (first.type !== "some") throw new Error("the fixture has orders");
        const { container } = renderTable(resultTable(result, words));
        expect(headers(container)).toEqual(["customer ID", "discount", "ID", "lines", "status", "total"]);
        expect(bodyRows(container)).toHaveLength(1);
        expect(bodyRows(container)[0]![2]).toBe(printInteger(first.value.id));
    });

    test("an option with nothing: the headers, and no rows", () => {
        const { container } = renderTable(resultTable(run("first(.orders[] | select(.id == 0))"), words));
        expect(headers(container)).toEqual(["customer ID", "discount", "ID", "lines", "status", "total"]);
        expect(bodyRows(container)).toEqual([]);
    });

    test("an array of numbers: the `value` column, a row each", () => {
        const result = run(".orders | map(.total)");
        const totals = valueAt<number[]>(result, ArrayType(FloatType));
        const { container } = renderTable(resultTable(result, words));
        expect(headers(container)).toEqual(["value"]);
        expect(bodyRows(container)).toEqual(totals.map(total => [f.float(total)]));
        expect(numericCells(container, 0)).toEqual(totals.map(() => true));
    });
});
