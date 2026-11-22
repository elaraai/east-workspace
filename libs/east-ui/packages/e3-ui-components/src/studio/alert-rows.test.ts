/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * An alert's rows (#1674) — Now, in its editor, and what a firing kept, under
 * its banner's Show rows: the rows of its visual that meet its condition, as
 * the Table shows them — each column under its field's name, as the
 * condition's rows say it, and its numbers as the visual's own tables print
 * them, never every digit of a float: a value in its own format, else its
 * field's — a currency's amounts grouped, a share a percent to two decimals,
 * closer than a tile says it — and a records table's column in its field's.
 * Over the visual tests' orders, each alert's program asked in memory as e3
 * asks it.
 */

import { describe, expect, it } from "vitest";
import { ArrayType, StructType, decodeBeast2, encodeBeast2For, fromEastTypeValue } from "@elaraai/east";
import { Studio } from "@elaraai/e3-ui";
import { formatters, type TableRootValue } from "@elaraai/east-ui-components";
import { queryWords } from "../query/model/words.js";
import { alertRowsStage } from "../query/visual/alert.js";
import { LISTED_ORDERS, ORDERS_SOURCE, alertAnswered, condition, visualOf } from "../query/visual/visual.test-utils.js";
import { alertRowsTable } from "./alert-rows.js";
import { studioMessages } from "./messages-en.js";

const v = Studio.visual;
const f = formatters("en-AU");
const words = queryWords(f);

/** An alert's check over the orders, answered: the rows that meet its condition, as an Array of one struct, and their fields. */
async function checked(content: ReturnType<typeof v.of>, where: string) {
    const { answer, fields } = await alertAnswered(content, condition(where));
    if (answer.kind !== "answered") throw new Error("no answer");
    return { type: ArrayType(StructType([...answer.columns])), value: answer.rows, fields };
}

/** An alert's Now over the orders — as the surface lists them, or not listed: its table, from its check's answer. */
async function nowOf(content: ReturnType<typeof v.of>, where: string, listed: typeof LISTED_ORDERS | undefined): Promise<TableRootValue> {
    const { type, value, fields } = await checked(content, where);
    return alertRowsTable({ type, value }, visualOf(content), listed, fields, words, studioMessages);
}

/** A table's columns: each one's header. */
const heads = (table: TableRootValue) => table.columns.map((column) => (column.header.type === "some" ? column.header.value : undefined));

/** A table's rows as it prints them: each cell's text, a number through its column's format. */
function printed(table: TableRootValue): string[][] {
    if (table.rows.type !== "inline") throw new Error("not inline");
    return table.rows.value.map((row) => table.columns.map((column) => {
        const cell = row.cells.get(column.key);
        if (cell === undefined) throw new Error(`no cell ${column.key}`);
        if (cell.type === "String") return cell.value;
        if (cell.type !== "Float" && cell.type !== "Integer") return cell.type;
        if (column.format.type === "some") return f.value(Number(cell.value), column.format.value);
        // No format: every digit of a float, a whole number as it is.
        return cell.type === "Integer" ? f.bare(cell.value) : f.float(cell.value);
    }));
}

describe("an alert's rows", () => {
    /** Revenue by region, with each region's average margin: South Australia's 170 at 0.15000000000000002. */
    const combo = v.of("orders", v.combo({ x: v.group("region"), columns: [v.left(v.sum("revenue"))], lines: [v.right(v.mean("margin"))] }));

    it("heads each column by its field's name, as the condition's rows say it, and prints a value as its field's format says — an amount grouped, a share a percent — never every digit of a float", async () => {
        const table = await nowOf(combo, ".mean_margin != null and .mean_margin < 0.19", LISTED_ORDERS);
        expect(heads(table)).toEqual(["region", "revenue", "mean margin"]);
        // South Australia's alone: its 100 and 70, and the mean of 0.2 and 0.1 — a float's 0.15000000000000002.
        expect(printed(table)).toEqual([["SA", "170", "15%"]]);
    });

    it("says a share to two decimals, closer than a tile's whole percents: a row under 19% reads 18.65%, not 19%", async () => {
        const table = await nowOf(combo, ".mean_margin != null and .mean_margin < 0.19", LISTED_ORDERS);
        const margin = table.columns.find((column) => column.key === "mean_margin")!.format;
        expect(margin.type === "some" ? f.value(0.18653846153846154, margin.value) : undefined).toBe("18.65%");
    });

    it("prints a value of no format — a count, a ratio of plain fields — grouped, to two decimals at most", async () => {
        // Revenue per unit by region: South Australia's 170 over 5 units, Victoria's 30 over 5.
        const ratio = v.of("orders", v.bar({ x: v.group("region"), values: [v.count(), v.ratio("units", "revenue")] }));
        const table = await nowOf(ratio, ".count >= 1", LISTED_ORDERS);
        expect(heads(table)).toEqual(["region", "count", "units per revenue"]);
        // New South Wales' 1 unit over 50, South Australia's 5 over 170, Victoria's 5 over 30, Western Australia's 1 over 20.
        expect(printed(table)).toEqual([["NSW", "1", "0.02"], ["SA", "2", "0.03"], ["VIC", "1", "0.17"], ["WA", "1", "0.05"]]);
    });

    it("prints a records table's column in its field's format, and one of no format as its table does: exactly", async () => {
        const records = v.of("orders", v.records({ columns: ["customer", "revenue", "margin", "units"], sort: "revenue", descending: true }));
        const table = await nowOf(records, ".revenue >= 70", LISTED_ORDERS);
        expect(heads(table)).toEqual(["customer", "revenue", "margin", "units"]);
        expect(printed(table)).toEqual([["Northwind", "100", "20%", "3"], ["Summit", "70", "10%", "2"]]);
        // Units, a field of no format: none, so the Table prints it as it is.
        expect(table.columns.find((column) => column.key === "units")!.format.type).toBe("none");
    });

    it("with no source listed, prints every value as it is: a float's every digit", async () => {
        const table = await nowOf(combo, ".revenue > 100", undefined);
        expect(table.columns.map((column) => column.format.type)).toEqual(["none", "none", "none"]);
        expect(printed(table)).toEqual([["SA", "170.0", "0.15000000000000002"]]);
    });

    it("prints what a firing kept as Now prints it: its rows decoded from their bytes, their fields the visual's rows' own; with its visual gone from the page, as they are", async () => {
        const { type, value } = await checked(combo, ".mean_margin != null and .mean_margin < 0.19");
        // As a firing keeps its rows (`alertFiring`): self-describing bytes.
        const kept = decodeBeast2(encodeBeast2For(type)(value as never));
        const rows = { type: fromEastTypeValue(kept.type), value: kept.value };
        // The fields a banner reads: the visual's rows', with no condition to print.
        const stage = alertRowsStage(visualOf(combo), ORDERS_SOURCE);
        if ("kind" in stage) throw new Error("no rows");
        expect(printed(alertRowsTable(rows, visualOf(combo), LISTED_ORDERS, stage.fields, words, studioMessages))).toEqual([["SA", "170", "15%"]]);
        expect(printed(alertRowsTable(rows, undefined, LISTED_ORDERS, [], words, studioMessages))).toEqual([["SA", "170.0", "0.15000000000000002"]]);
    });
});
