/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * A visual's tile (#1670): it asks its programs through the query builder's
 * calls and draws each of its states — waiting, a well empty, a field
 * missing, its source's error, no rows — and its answer; two tiles with one
 * program make one call.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    ArrayType, DateTimeType, FloatType, IntegerType, StringType, StructType, none, parseJq, some, toEastTypeValue, variant, type JqNode, type ValueTypeOf,
} from "@elaraai/east";
import { Studio, type StudioCellType, type StudioSourceType } from "@elaraai/e3-ui/internal";
import { StateRuntime, UIStore, system } from "@elaraai/east-ui-components";
import { QueryCallProvider, QuerySourceStatusProvider, type QueryCall } from "../query/hooks.js";
import { createInMemoryQueryCall, createInMemorySourceStatus } from "../query/in-memory-call.js";
import { StudioLayout } from "./page.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
});

beforeEach(() => { StateRuntime.initializeStore(new UIStore()); });
afterEach(() => { cleanup(); });

const Row = StructType({ ordered_at: DateTimeType, region: StringType, revenue: FloatType, units: IntegerType });
const PATH = [variant("field", "inputs"), variant("field", "orders")];
const ORDERS: ValueTypeOf<typeof Row>[] = [
    { ordered_at: new Date("2026-07-03T10:00:00Z"), region: "SA", revenue: 100, units: 4n },
    { ordered_at: new Date("2026-07-20T10:00:00Z"), region: "NSW", revenue: 50, units: 1n },
    { ordered_at: new Date("2026-08-02T10:00:00Z"), region: "SA", revenue: 60, units: 2n },
];
const DATASETS = [{ path: PATH, type: ArrayType(Row), value: ORDERS }];
const SOURCE: ValueTypeOf<typeof StudioSourceType> = {
    key: "orders", name: "Orders", icon: "receipt", description: none,
    binding: { name: "orders", source: variant("value", PATH), type: toEastTypeValue(ArrayType(Row)) },
    fields: [], range: some("ordered_at"), search: [], split: [],
};

const v = Studio.visual;
/** A placement holding content. */
function cell(key: string, content: ValueTypeOf<typeof StudioCellType>["content"]): ValueTypeOf<typeof StudioCellType> {
    return { key, row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content };
}
/** A jq condition. */
function condition(text: string): JqNode {
    const parsed = parseJq(text);
    if (parsed.program.type === "none") throw new Error(text);
    return parsed.program.value;
}

/** A page of placements over the orders, its calls the given one's, its sources' status read in memory. */
function page(cells: ValueTypeOf<typeof StudioCellType>[], call?: QueryCall) {
    const layout = <StudioLayout cells={cells} components={[]} sources={[SOURCE]} storageKey="tile" />;
    return render(
        <ChakraProvider value={system}>
            {call === undefined ? layout : (
                <QueryCallProvider call={call}>
                    <QuerySourceStatusProvider status={createInMemorySourceStatus(DATASETS)}>{layout}</QuerySourceStatusProvider>
                </QueryCallProvider>
            )}
        </ChakraProvider>,
    );
}

describe("a visual's tile", () => {
    test("asks its program and says what it answered", async () => {
        page([cell("c1", v.of("orders", v.column({ x: v.group("region"), values: [v.sum("revenue")] })))], createInMemoryQueryCall(DATASETS));
        expect(await screen.findByText("2 groups from 3 rows")).toBeTruthy();
        expect(screen.getByText("Column chart · Orders")).toBeTruthy();
    });

    test("waits on the shared loading clock: its placeholder shows once the wait passes the delay", async () => {
        const never: QueryCall = () => new Promise(() => {});
        const { container } = page([cell("c1", v.of("orders", v.kpi({ value: v.count() })))], never);
        expect(container.querySelector("[data-studio-visual=waiting]")).toBeNull();
        await waitFor(() => expect(container.querySelector("[data-studio-visual=waiting]")).not.toBeNull(), { timeout: 2_000 });
    });

    test("lists the wells it needs filled", () => {
        page([cell("c1", v.of("orders", v.column({ x: v.group("region"), values: [] })))], createInMemoryQueryCall(DATASETS));
        expect(screen.getByText("Add fields to draw it")).toBeTruthy();
        expect(screen.getByText("A number in Values")).toBeTruthy();
    });

    test("names a field its source does not have", () => {
        page([cell("c1", v.of("orders", v.kpi({ value: v.sum("net_revenue") })))], createInMemoryQueryCall(DATASETS));
        expect(screen.getByText("Orders has no field net_revenue")).toBeTruthy();
    });

    test("says no data when it reads no rows, never a zero", async () => {
        page([cell("c1", v.of("orders", v.kpi({ value: v.sum("revenue") }), { where: condition(`.region == "WA"`) }))], createInMemoryQueryCall(DATASETS));
        expect(await screen.findByText("no data")).toBeTruthy();
        expect(screen.getByText("No rows of Orders match.")).toBeTruthy();
    });

    test("shows its source's error when there is no server to ask", async () => {
        page([cell("c1", v.of("orders", v.kpi({ value: v.count() })))]);
        expect(await screen.findByText("Orders could not be read")).toBeTruthy();
    });

    test("two tiles with one program make one call", async () => {
        let calls = 0;
        const inMemory = createInMemoryQueryCall(DATASETS);
        const counting: QueryCall = (request, options) => { calls += 1; return inMemory(request, options); };
        const content = v.of("orders", v.bar({ x: v.group("region"), values: [v.count()] }));
        page([cell("c1", content), cell("c2", content)], counting);
        expect(await screen.findAllByText("2 groups from 3 rows")).toHaveLength(2);
        expect(calls).toBe(1);
    });
});
