/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * A visual's tile (#1670): it asks its programs through the query builder's
 * calls and draws each of its states — waiting, a well empty, a field
 * missing, a source with no date to compare periods by, its source's error
 * with a Retry, a source the page cannot query, no rows — and its answer; two
 * tiles with one program make one call, and so do two pages over the same
 * sources, one inside the other; an answer outlives its calls' identity.
 */

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    ArrayType, DateTimeType, FloatType, IntegerType, StringType, StructType, none, parseJq, some, toEastTypeValue, variant, type JqNode, type ValueTypeOf,
} from "@elaraai/east";
import { Studio, type StudioCellType, type StudioSourceType } from "@elaraai/e3-ui/internal";
import { StateRuntime, UIStore, system } from "@elaraai/east-ui-components";
import { utcAt as at } from "../plan/plan.test-utils.js";
import { QueryCallProvider, QuerySourceStatusProvider, type QueryCall } from "../query/hooks.js";
import { createInMemoryQueryCall, createInMemorySourceStatus } from "../query/in-memory-call.js";
import { VisualAnswersProvider } from "../query/visual/answers.js";
import { StudioLayout } from "./page.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
});

beforeEach(() => { StateRuntime.initializeStore(new UIStore()); });
afterEach(() => { cleanup(); });

const Row =StructType({ ordered_at: DateTimeType, region: StringType, revenue: FloatType, units: IntegerType });
const PATH = [variant("field", "inputs"), variant("field", "orders")];
const ORDERS: ValueTypeOf<typeof Row>[] = [
    { ordered_at: at("2026-07-03T10:00:00"), region: "SA", revenue: 100, units: 4n },
    { ordered_at: at("2026-07-20T10:00:00"), region: "NSW", revenue: 50, units: 1n },
    { ordered_at: at("2026-08-02T10:00:00"), region: "SA", revenue: 60, units: 2n },
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

/** What a page draws in: the theme, and — given a call — its calls, its sources' status read in memory. */
function host(children: ReactNode, call?: QueryCall) {
    return (
        <ChakraProvider value={system}>
            {call === undefined ? children : (
                <QueryCallProvider call={call}>
                    <QuerySourceStatusProvider status={createInMemorySourceStatus(DATASETS)}>{children}</QuerySourceStatusProvider>
                </QueryCallProvider>
            )}
        </ChakraProvider>
    );
}

/** A page of placements over the sources — the orders unless given — its calls the given one's. */
function page(cells: ValueTypeOf<typeof StudioCellType>[], call?: QueryCall, sources: ValueTypeOf<typeof StudioSourceType>[] = [SOURCE]) {
    return render(host(<StudioLayout cells={cells} components={[]} sources={sources} storageKey="tile" />, call));
}

/** The in-memory call, counting its calls. */
function counting(): { call: QueryCall; calls: () => number } {
    let n = 0;
    const inMemory = createInMemoryQueryCall(DATASETS);
    return { call: (request, options) => { n += 1; return inMemory(request, options); }, calls: () => n };
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
        const { call, calls } = counting();
        const content = v.of("orders", v.bar({ x: v.group("region"), values: [v.count()] }));
        page([cell("c1", content), cell("c2", content)], call);
        expect(await screen.findAllByText("2 groups from 3 rows")).toHaveLength(2);
        expect(calls()).toBe(1);
    });

    test("offers Retry when its call failed, and asks again", async () => {
        let tries = 0;
        const inMemory = createInMemoryQueryCall(DATASETS);
        // e3 unreachable once, then back.
        const flaky: QueryCall = (request, options) => {
            tries += 1;
            return tries === 1 ? Promise.reject(new TypeError("fetch failed")) : inMemory(request, options);
        };
        page([cell("c1", v.of("orders", v.bar({ x: v.group("region"), values: [v.count()] })))], flaky);
        expect(await screen.findByText("Orders could not be read")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(await screen.findByText("2 groups from 3 rows")).toBeTruthy();
        expect(tries).toBe(2);
    });

    test("says a source with no date range has no date to compare periods by", () => {
        page([cell("c1", v.of("orders", v.kpi({ value: v.sum("revenue", { period: "previous" }) })))], createInMemoryQueryCall(DATASETS), [{ ...SOURCE, range: none }]);
        expect(screen.getByText("Orders has no date to compare periods by")).toBeTruthy();
    });

    test("a source the page cannot query fails only the visuals that read it, with no Retry", async () => {
        const lines: ValueTypeOf<typeof StudioSourceType> = {
            ...SOURCE, key: "lines", name: "Lines",
            binding: { name: "lines", source: variant("paged", "not-bound"), type: toEastTypeValue(ArrayType(Row)) },
        };
        page([
            cell("c1", v.of("orders", v.bar({ x: v.group("region"), values: [v.count()] }))),
            cell("c2", v.of("lines", v.bar({ x: v.group("region"), values: [v.count()] }))),
        ], createInMemoryQueryCall(DATASETS), [SOURCE, lines]);
        expect(await screen.findByText("2 groups from 3 rows")).toBeTruthy();
        expect(await screen.findByText("Lines could not be read")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    });

    test("a page inside another over the same sources asks through it: what one has answered, the other draws", async () => {
        const { call, calls } = counting();
        const content = v.of("orders", v.bar({ x: v.group("region"), values: [v.count()] }));
        // A builder's canvas, and its preview beside it.
        render(host(
            <VisualAnswersProvider sources={[SOURCE]}>
                <StudioLayout cells={[cell("c1", content)]} components={[]} sources={[SOURCE]} storageKey="canvas" />
                <StudioLayout cells={[cell("c1", content)]} components={[]} sources={[SOURCE]} storageKey="preview" />
            </VisualAnswersProvider>,
            call,
        ));
        expect(await screen.findAllByText("2 groups from 3 rows")).toHaveLength(2);
        expect(calls()).toBe(1);
    });

    test("keeps its answer when the host's calls change identity — a token refreshed — and asks nothing again", async () => {
        const first = counting();
        const content = v.of("orders", v.bar({ x: v.group("region"), values: [v.count()] }));
        const layout = <StudioLayout cells={[cell("c1", content)]} components={[]} sources={[SOURCE]} storageKey="tile" />;
        const { rerender } = render(host(layout, first.call));
        expect(await screen.findByText("2 groups from 3 rows")).toBeTruthy();
        const second = counting();
        rerender(host(layout, second.call));
        // Still drawn as it was: no answer dropped, so no wait.
        expect(screen.getByText("2 groups from 3 rows")).toBeTruthy();
        expect([first.calls(), second.calls()]).toEqual([1, 0]);
    });
});
