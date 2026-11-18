/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * The Configure tab drawn from a kind's declaration alone (#1672, EDT-2): the
 * test declares the kinds itself — a chart of two kinds, its line first,
 * renamed, its axis relabelled and a stack of its own — and the tab draws its
 * segments, its wells and its options from them, with no code of its own; an
 * option set is the placement's content written whole, one request.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    ArrayType, DateTimeType, FloatType, StringType, StructType, decodeBeast2For, equalFor, none, some, toEastTypeValue, variant, type ValueTypeOf,
} from "@elaraai/east";
import { SnapGrid } from "@elaraai/east-ui/internal";
import { Studio, StudioCellType, StudioContentType, StudioSourceType, studioEditors, type StudioViewEditor } from "@elaraai/e3-ui/internal";
import { StateRuntime, UIStore, system } from "@elaraai/east-ui-components";
import { StudioConfigure } from "./configure.js";
import { studioEast } from "./studio-east.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
});

beforeEach(() => { StateRuntime.initializeStore(new UIStore()); });
afterEach(() => { cleanup(); });

type Request = ValueTypeOf<typeof SnapGrid.Types.Request>;
const v = Studio.visual;
const stringEqual = equalFor(StringType);
const decodeContent = decodeBeast2For(StudioContentType);

const Row = StructType({ ordered_at: DateTimeType, region: StringType, revenue: FloatType });
const SOURCE: ValueTypeOf<typeof StudioSourceType> = {
    key: "orders", name: "Orders", icon: "receipt", description: none,
    binding: { name: "orders", source: variant("value", [variant("field", "inputs"), variant("field", "orders")]), type: toEastTypeValue(ArrayType(Row)) },
    fields: [
        { id: "ordered_at", label: "Ordered", kind: variant("date", null), format: none },
        { id: "region", label: "Region", kind: variant("text", null), format: none },
        { id: "revenue", label: "Revenue", kind: variant("number", null), format: none },
    ],
    range: none,
};

/** The shipped chart's declaration, and two of its kinds'. */
const CHART = studioEditors.find((view) => stringEqual(view.view, "chart"))!;
const COLUMN = CHART.kinds.find((kind) => stringEqual(kind.kind.type, "column"))!;
const LINE = CHART.kinds.find((kind) => stringEqual(kind.kind.type, "line"))!;

/** The test's own declarations: a chart of two kinds, its line first — called a trend, its axis Over time, with the column's stack. */
const EDITORS: StudioViewEditor[] = [{
    ...CHART,
    kinds: [
        {
            ...LINE,
            label: "Trend",
            wells: LINE.wells.map((held) => (stringEqual(held.field, "x") ? { ...held, label: "Over time" } : held)),
            options: COLUMN.options,
        },
        COLUMN,
    ],
}];

/** A line of the revenue by month, placed and saved. */
const LINE_VISUAL = v.of("orders", v.line({ x: v.group("ordered_at", { bucket: "month" }), values: [v.sum("revenue")] }));
const CELL: ValueTypeOf<typeof StudioCellType> = { key: "c1", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content: LINE_VISUAL };

/** The tab over the line, the test's declarations its kinds', and the requests it makes. */
function mount() {
    const east = studioEast();
    const requests: Request[] = [];
    const selection = east.inspectorSelection([], east.sourceNames([SOURCE]), [CELL], some("c1"));
    const value = { selection, sources: [SOURCE], editors: EDITORS, onRequest: (request: Request) => { requests.push(request); return null; } };
    const { container } = render(
        <ChakraProvider value={system}>
            <StudioConfigure value={value} saved={CELL.content} pages={[]} placements={[{ cell: CELL, name: "The line" }]} dnd={{ wells: "test.wells", fields: "test.fields" }} />
        </ChakraProvider>,
    );
    return { container, requests };
}

describe("The Configure tab, drawn from a kind's declaration (#1672, EDT-2)", () => {
    test("a kind the test declares gets its editor: its view's segments, its kinds' names, its wells' labels and its options, as declared", () => {
        const { container } = mount();
        const strip = (name: string) => [...container.querySelectorAll(`[data-seg-strip="${name}"] button`)]
            .map((b) => `${b.getAttribute("aria-label") ?? b.textContent}${b.getAttribute("aria-pressed") === "true" ? " (on)" : ""}`);
        // One view, and two kinds: their names, as they are three or fewer.
        expect(strip("views")).toEqual(["Chart (on)"]);
        expect(strip("kinds")).toEqual(["Trend (on)", "Column"]);
        expect([...container.querySelectorAll("[data-well]")].map((well) => well.querySelector("span")?.textContent)).toEqual(["Over time", "Values", "Split by"]);
        expect(strip("stack")).toEqual(["Clustered (on)", "Stacked", "Percent"]);
    });

    test("an option the declaration gives is set as any other: the placement's content written whole, in one request", async () => {
        const { container, requests } = mount();
        await act(async () => { fireEvent.click(within(container.querySelector<HTMLElement>('[data-seg-strip="stack"]')!).getByRole("button", { name: "Stacked" })); });
        expect(requests).toHaveLength(1);
        const change = requests[0]!.change;
        if (change.type !== "field") throw new Error("expected a field request");
        expect([requests[0]!.key, change.value.name]).toEqual(["c1", "content"]);
        expect(decodeContent(change.value.value)).toEqual(v.of("orders", v.line({
            x: v.group("ordered_at", { bucket: "month" }), values: [v.sum("revenue")], stack: "stacked",
        })));
    });
});
