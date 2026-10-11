/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { expect, test } from "vitest";
import { ArrayType, East, Expr, IntegerType, StringType, StructType, decodeBeast2For, encodeBeast2For, equalFor, none, some, variant } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui";
import { SliceImpl } from "./index.js";

const Row = StructType({ customer: StringType, status: StringType, quantity: IntegerType });
const Rows = ArrayType(Row);
const rows = East.value([
    { customer: "Alpha", status: "held", quantity: 20n },
    { customer: "Beta", status: "late", quantity: 8n },
    { customer: "Cedar", status: "open", quantity: 50n },
], Rows);

test("typed local binding keeps the existing state wire and reads mutations made after binding", () => {
    const fn = East.function([], StructType({ before: Rows, after: Rows, state: Slice.Types.State }), $ => {
        const slice = $.let(Slice.bind("typed.local.live", rows, {
            search: "customer", initial: { status: ["held", "late"] },
            presets: [{ id: "bulk", name: "Bulk orders", where: { quantity: { gte: 10n } }, active: true }],
        }));
        const before = $.const(Slice.rows(slice));
        $(slice.toggleCohort("bulk"));
        const after = $.const(Slice.rows(slice));
        return { before, after, state: slice.read() };
    });
    const result = East.compile(fn, SliceImpl)();
    expect(result.before.map(row => row.customer)).toEqual(["Alpha"]);
    expect(result.after.map(row => row.customer)).toEqual(["Alpha", "Beta"]);
    const state = East.compile(East.function([], Slice.Types.State, _$ => Slice.state({
        filters: [variant("string", { fieldId: "status", op: variant("in", new Set(["held", "late"])) })],
        cohorts: [{ id: "bulk", name: "Bulk orders", filters: [variant("integer", { fieldId: "quantity", op: variant("gte", 10n) })] }],
    })), [])();
    expect(equalFor(Slice.Types.State)(result.state, state)).toBe(true);
    expect("data" in Slice.Types.Bind.fields).toBe(false);
});

test("typed handles round-trip through Beast2 and keep live rows and reified match projections", () => {
    const make = East.function([], undefined, $ => {
        const suffix = $.const("customer");
        return Slice.bind("typed.local.decoded", rows, { search: "customer", match: row => ({ id: row.customer, label: row.customer, meta: some(suffix) }) });
    });
    const type = Expr.type(make).output;
    const value = East.compile(make, SliceImpl)();
    const handle = decodeBeast2For(type, { platform: SliceImpl })(encodeBeast2For(type)(value));
    handle.setSearch(some("Beta"));
    expect(handle.data().map(row => row.customer)).toEqual(["Beta"]);
    expect(handle.matches()).toEqual([{ id: "Beta", label: "Beta", meta: some("customer") }]);
    handle.setSearch(none);
    expect(handle.data()).toHaveLength(3);
    expect(handle.fields().map(field => field.label)).toEqual(["Customer", "Quantity", "Status"]);
    expect(typeof Slice.bindRecord).toBe("function");
});
