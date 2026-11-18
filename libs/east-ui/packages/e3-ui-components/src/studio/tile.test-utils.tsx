/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the Studio's tile tests draw a page with (#1670, #1673): a source of
 * orders answered in memory, a page of placements over it, and the reader's
 * filters of the page set as its rail sets them — for the tests of a tile,
 * and of a page's clicks.
 *
 * @packageDocumentation
 */

import type { ReactNode } from "react";
import { afterEach, beforeEach } from "vitest";
import { act, cleanup, render, type RenderResult } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    ArrayType, DateTimeType, FloatType, IntegerType, StringType, StructType, none, some, toEastTypeValue, variant, type ValueTypeOf,
} from "@elaraai/east";
import { encodeBeast2For } from "@elaraai/east/internal";
import { StudioFiltersType, studioFiltersKey, type StudioCellType, type StudioKeyType, type StudioSourceType } from "@elaraai/e3-ui/internal";
import { StateRuntime, UIStore, system } from "@elaraai/east-ui-components";
import { utcAt as at } from "../plan/plan.test-utils.js";
import { QueryCallProvider, QuerySourceStatusProvider, type QueryCall } from "../query/hooks.js";
import { createInMemorySourceStatus } from "../query/in-memory-call.js";
import { condition } from "../query/visual/visual.test-utils.js";
import { StudioLayout } from "./page.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
});

beforeEach(() => { StateRuntime.initializeStore(new UIStore()); });
afterEach(() => { cleanup(); });

export const Row = StructType({ ordered_at: DateTimeType, region: StringType, revenue: FloatType, units: IntegerType });
export const PATH = [variant("field", "inputs"), variant("field", "orders")];
export const ORDERS: ValueTypeOf<typeof Row>[] = [
    { ordered_at: at("2026-07-03T10:00:00"), region: "SA", revenue: 100, units: 4n },
    { ordered_at: at("2026-07-20T10:00:00"), region: "NSW", revenue: 50, units: 1n },
    { ordered_at: at("2026-08-02T10:00:00"), region: "SA", revenue: 60, units: 2n },
];
export const DATASETS = [{ path: PATH, type: ArrayType(Row), value: ORDERS }];
export const SOURCE: ValueTypeOf<typeof StudioSourceType> = {
    key: "orders", name: "Orders", icon: "receipt", description: none,
    binding: { name: "orders", source: variant("value", PATH), type: toEastTypeValue(ArrayType(Row)) },
    fields: [], range: some("ordered_at"),
};

/** The page the tiles are of. */
export const PAGE = { project: "Sales desk", page: "Orders" };
const encodeFilters = encodeBeast2For(StudioFiltersType);
/** Sets the reader's filters of the page, as its rail does: in the UI store, under the page's key. */
export async function filterPage(...conditions: string[]) {
    await act(async () => {
        StateRuntime.getStore().write(studioFiltersKey(PAGE), conditions.length === 0 ? undefined : encodeFilters(conditions.map((where) => ({ source: "orders", where: condition(where) }))));
    });
}

/** A placement holding content. */
export function cell(key: string, content: ValueTypeOf<typeof StudioCellType>["content"]): ValueTypeOf<typeof StudioCellType> {
    return { key, row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content };
}

/** What a page draws in: the theme, and — given a call — its calls, its sources' status read in memory. */
export function host(children: ReactNode, call?: QueryCall) {
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

/** A page of placements over the sources — the orders unless given — its calls the given one's, and who it tells a click opens another page. */
export function page(
    cells: ValueTypeOf<typeof StudioCellType>[], call?: QueryCall, sources: ValueTypeOf<typeof StudioSourceType>[] = [SOURCE],
    onOpen?: (page: ValueTypeOf<typeof StudioKeyType>) => void,
): RenderResult {
    return render(host(<StudioLayout cells={cells} components={[]} sources={sources} page={PAGE} storageKey="tile" onOpen={onOpen} />, call));
}

/**
 * Runs a test with every element laid out 1200 × 600: a Table or a Matrix
 * virtualises its rows, drawing those its box has room for, which jsdom lays
 * out at 0.
 */
export async function sized(run: () => Promise<void>) {
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 600 });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 1200 });
    try {
        await run();
    } finally {
        if (height !== undefined) Object.defineProperty(HTMLElement.prototype, "offsetHeight", height);
        if (width !== undefined) Object.defineProperty(HTMLElement.prototype, "offsetWidth", width);
    }
}
