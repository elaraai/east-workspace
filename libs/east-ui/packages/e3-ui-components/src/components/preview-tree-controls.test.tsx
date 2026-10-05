/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A host draws a dataset preview's Collapse all and Expand all in its own
 * header (#1209): `toolbar={false}` hides the tree's own, and the host's act on
 * the tree through the handle it makes with `usePreviewControls`, whether the
 * value is shown inline or a page at a time.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient } from "@tanstack/react-query";
import {
    DictType, IntegerType, SortedMap, StringType, StructType, compareFor, encodeBeast2For, none, some, toEastTypeValue,
    type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { datasetGet, datasetGetPage, datasetGetStatus, type DatasetPage } from "@elaraai/e3-api-client";
import { system } from "@elaraai/east-ui-components";
import { E3Provider } from "../platform/e3-config.js";
import { DatasetPreview, type DatasetPreviewProps } from "./DatasetPreview.js";
import { usePreviewControls } from "./preview-controls.js";

vi.mock("@elaraai/e3-api-client", async (importOriginal) => ({
    ...await importOriginal<typeof import("@elaraai/e3-api-client")>(),
    datasetGetStatus: vi.fn(),
    datasetGet: vi.fn(),
    datasetGetPage: vi.fn(),
}));

// jsdom has no `CSS.escape`, and the key search's combobox finds its items
// through it — every browser has one. A stand-in escaping whatever an id may
// hold.
const cssApi = ((globalThis as { CSS?: { escape?: (s: string) => string } }).CSS ??= {});
cssApi.escape ??= (s: string) => s.replace(/[^\w-]/g, (c) => `\\${c}`);

/** The key search's positioner observes sizes; jsdom has no ResizeObserver. */
class ResizeObserverStub {
    observe(): void { /* noop */ }
    unobserve(): void { /* noop */ }
    disconnect(): void { /* noop */ }
}

const originalOffsetH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
const originalOffsetW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");

beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    // The tree sizes its viewport by its offset size, which jsdom reports as
    // zero, leaving no row in range: room for every row here.
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 600 });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 600 });
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    if (originalOffsetH !== undefined) Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetH);
    if (originalOffsetW !== undefined) Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalOffsetW);
    // The tree keeps what is open per path, in the page's storage.
    localStorage.clear();
    vi.mocked(datasetGetStatus).mockReset();
    vi.mocked(datasetGet).mockReset();
    vi.mocked(datasetGetPage).mockReset();
});

const API = "http://e3.test";
const HASH = "1".repeat(64);

/** A value nested three deep: one level opens by default, so `Deep` starts hidden. */
const NestedType = StructType({ outer: StructType({ inner: StructType({ deep: IntegerType }) }) });
const NESTED: ValueTypeOf<typeof NestedType> = { outer: { inner: { deep: 7n } } };

/** A collection, paged when read-only: each row's `Inner` starts collapsed. */
const RowType = StructType({ inner: StructType({ deep: IntegerType }) });
const RowsType = DictType(StringType, RowType);
const ROWS = new SortedMap<string, ValueTypeOf<typeof RowType>>(
    [["a", { inner: { deep: 1n } }], ["b", { inner: { deep: 2n } }]],
    compareFor(StringType),
);

/** Serves the dataset holding `bytes` of `type`, whole and as one page of `elements`. */
function serve(type: EastType, bytes: Uint8Array, elements: number): void {
    vi.mocked(datasetGetStatus).mockResolvedValue({
        path: ".value", type: toEastTypeValue(type), refType: "value",
        hash: some(HASH), size: some(BigInt(bytes.length)), segments: none, rows: none,
    } as never);
    vi.mocked(datasetGet).mockResolvedValue({ data: bytes, hash: HASH } as never);
    vi.mocked(datasetGetPage).mockResolvedValue({
        data: bytes, totalElements: elements, totalBytes: bytes.length, totalExact: true, segmentCount: 1, offset: 0, count: elements, hash: HASH,
    } satisfies DatasetPage);
}

/** A host drawing Collapse all and Expand all of its own over the preview,
 *  giving the preview its handle unless `unhanded`. */
function Host({ unhanded = false, ...props }: Partial<DatasetPreviewProps> & { unhanded?: boolean }) {
    const controls = usePreviewControls();
    return (
        <>
            <button type="button" onClick={controls.collapseAll}>Host collapse</button>
            <button type="button" onClick={controls.expandAll}>Host expand</button>
            <DatasetPreview apiUrl={API} repo="default" workspace="w" path="value" pollInterval={60_000}
                {...(!unhanded && { controls })} {...props} />
        </>
    );
}

function renderHost(props: Partial<DatasetPreviewProps> & { unhanded?: boolean }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (more: Partial<DatasetPreviewProps>) => (
        <ChakraProvider value={system}>
            <E3Provider config={{ apiUrl: API, workspace: "w" }} queryClient={client}>
                <Host {...more} />
            </E3Provider>
        </ChakraProvider>
    );
    const view = render(tree(props));
    return { rerenderWith: (more: Partial<DatasetPreviewProps> & { unhanded?: boolean }) => view.rerender(tree(more)) };
}

describe("a value shown inline (#1209)", () => {
    test("its tree draws Collapse all and Expand all unless toolbar={false}, and the host's own act on it", async () => {
        serve(NestedType, encodeBeast2For(NestedType)(NESTED), 1);
        const { rerenderWith } = renderHost({ editable: true });
        expect(await screen.findByText("Inner")).toBeTruthy();
        expect(screen.getByText("Collapse all")).toBeTruthy();

        rerenderWith({ editable: true, toolbar: false });
        expect(screen.queryByText("Collapse all")).toBe(null);
        expect(screen.queryByText("Expand all")).toBe(null);
        expect(screen.queryByText("Deep")).toBe(null);
        fireEvent.click(screen.getByText("Host expand"));
        expect(await screen.findByText("Deep")).toBeTruthy();
        fireEvent.click(screen.getByText("Host collapse"));
        expect(screen.queryByText("Inner")).toBe(null);
        expect(screen.getByText("Outer")).toBeTruthy();
    });
});

describe("a value shown a page at a time (#1209)", () => {
    test("its tree draws Collapse all and Expand all unless toolbar={false}, and the host's own act on it", async () => {
        serve(RowsType, encodeBeast2For(RowsType)(ROWS), 2);
        const { rerenderWith } = renderHost({});
        expect((await screen.findAllByText("Inner")).length).toBe(2);
        expect(screen.getByText("Collapse all")).toBeTruthy();

        rerenderWith({ toolbar: false });
        expect(screen.queryByText("Collapse all")).toBe(null);
        expect(screen.queryByText("Expand all")).toBe(null);
        expect(screen.queryAllByText("Deep")).toEqual([]);
        fireEvent.click(screen.getByText("Host expand"));
        expect((await screen.findAllByText("Deep")).length).toBe(2);
        fireEvent.click(screen.getByText("Host collapse"));
        expect(screen.queryAllByText("Inner")).toEqual([]);
        expect(screen.getAllByText(/^[ab]$/).map((row) => row.textContent)).toEqual(["a", "b"]);
    });

    test("a handle the host gives once the value is drawn reaches its tree", async () => {
        serve(RowsType, encodeBeast2For(RowsType)(ROWS), 2);
        const { rerenderWith } = renderHost({ toolbar: false, unhanded: true });
        expect((await screen.findAllByText("Inner")).length).toBe(2);
        fireEvent.click(screen.getByText("Host expand"));
        expect(screen.queryAllByText("Deep")).toEqual([]);

        rerenderWith({ toolbar: false });
        fireEvent.click(screen.getByText("Host expand"));
        expect((await screen.findAllByText("Deep")).length).toBe(2);
    });
});
