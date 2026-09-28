/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Paged-preview page retention: loaded pages hold fully materialized
 * ValueTree rows (measured ~10-20MB of heap per 500-row window on
 * GB-scale wide-row datasets), so retention must stay bounded around the
 * current window — unbounded accumulation OOMs the extension webview, and
 * re-flattening every retained page on each arrival is what made
 * scrolling degrade over time.
 *
 * And the served page size (#829): the server trims pages of wide rows to a
 * byte budget, so the preview addresses pages by what it SERVES — addressed by
 * the requested size, every page after a trimmed one would start past the
 * trimmed page's end and the rows in between would never load.
 */

import { describe, test, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor, act } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ArrayType, IntegerType, encodeBeast2For, toEastTypeValue } from "@elaraai/east";
import type { DatasetPage, DatasetPageWindow } from "@elaraai/e3-api-client";
import { I18nProvider, type ValueTreePaging } from "@elaraai/east-ui-components";

const mocks = vi.hoisted(() => ({
    /** The page fetch — each test decides how its server trims. */
    getPage: vi.fn(),
    /** The paging contract the preview last handed the tree. */
    paging: undefined as ValueTreePaging | undefined,
}));

vi.mock("@elaraai/e3-api-client", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@elaraai/e3-api-client")>()),
    datasetGetPage: mocks.getPage,
}));

// The tree is the preview's consumer: capture the paging contract it is
// handed, and drive `onNeedRows` the way its scroll handler does.
vi.mock("@elaraai/east-ui-components", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@elaraai/east-ui-components")>()),
    EastChakraValueTree: (props: { paging?: ValueTreePaging }) => {
        mocks.paging = props.paging;
        return null;
    },
}));

import { PagedDatasetPreview, pruneRetainedPages, servedPageSize } from "./PagedDatasetPreview.js";

afterEach(() => {
    cleanup();
    mocks.getPage.mockReset();
    mocks.paging = undefined;
});

function pagesOf(...keys: number[]): ReadonlyMap<number, string> {
    return new Map(keys.map((k) => [k, `page-${k}`]));
}

describe("pruneRetainedPages", () => {
    test("returns the same reference while under the cap (no re-render churn)", () => {
        const pages = pagesOf(0, 1, 2);
        expect(pruneRetainedPages(pages, 1, 2, 8)).toBe(pages);
    });

    test("keeps the current window and the nearest pages, dropping the farthest", () => {
        const pages = pagesOf(0, 1, 2, 3, 10, 11, 12, 40, 41, 42);
        const kept = pruneRetainedPages(pages, 10, 12, 6);
        // Window pages (distance 0) always survive; then nearest by distance
        // — pages 1..3 (distance 7..9) beat pages 40..42 (distance 28..30).
        expect([...kept.keys()]).toEqual([1, 2, 3, 10, 11, 12]);
        expect(kept.get(10)).toBe("page-10");
    });

    test("a far jump retains the destination window and evicts the origin", () => {
        const pages = pagesOf(0, 1, 2, 3, 4, 5, 6, 7);
        const kept = pruneRetainedPages(pages, 1000, 1001, 4);
        // No loaded page is in the window yet (the jump just landed) — the
        // nearest-to-window pages are kept until the destination loads.
        expect(kept.size).toBe(4);
        expect([...kept.keys()]).toEqual([4, 5, 6, 7]);
    });
});

describe("servedPageSize (#829)", () => {
    test("a full page keeps the requested size", () => {
        expect(servedPageSize(500, { offset: 0, count: 500, totalElements: 1_000 })).toBe(500);
    });

    test("a page trimmed while the dataset has more sets the size", () => {
        expect(servedPageSize(500, { offset: 0, count: 137, totalElements: 1_000 })).toBe(137);
    });

    test("a short FINAL page is the data ending, not a trim", () => {
        expect(servedPageSize(500, { offset: 900, count: 100, totalElements: 1_000 })).toBe(500);
    });
});

/** A server holding `total` integers that serves at most `trimTo(window)` per page. */
function serve(total: number, trimTo: (window: DatasetPageWindow) => number) {
    mocks.getPage.mockImplementation(async (
        _url: string, _repo: string, _ws: string, _path: unknown, window: DatasetPageWindow,
    ): Promise<DatasetPage> => {
        const offset = "offset" in window ? window.offset : 0;
        const limit = "limit" in window ? window.limit : 0;
        const count = Math.max(0, Math.min(limit, trimTo(window), total - offset));
        const values = Array.from({ length: count }, (_, i) => BigInt(offset + i));
        return {
            data: encodeBeast2For(ArrayType(IntegerType))(values),
            totalElements: total, totalBytes: total * 8, totalExact: true,
            segmentCount: 1, offset, count, hash: "h",
        };
    });
}

function renderPreview(locale?: string) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const preview = (
        <PagedDatasetPreview
            apiUrl="http://e3" repo="r" workspace="ws" path="inputs.rows"
            type={toEastTypeValue(ArrayType(IntegerType))} hash="h" sizeBytes={8_000}
            onDownload={() => {}}
        />
    );
    return render(
        <QueryClientProvider client={client}>
            <ChakraProvider value={defaultSystem}>
                {locale === undefined ? preview : <I18nProvider locale={locale}>{preview}</I18nProvider>}
            </ChakraProvider>
        </QueryClientProvider>,
    );
}

/** The row indices a landed page holds (its rows' `index` steps). */
function indicesOf(paging: ValueTreePaging | undefined, page: number): number[] {
    const rows = paging?.pages.get(page) ?? [];
    return rows.map((r) => Number((r.step as { value: bigint }).value));
}

describe("PagedDatasetPreview — the served page size (#829)", () => {
    test("a trimmed first page sets the size the tree and every later request use", async () => {
        serve(1_000, () => 150);
        renderPreview();
        await waitFor(() => expect(mocks.paging?.pageSize).toBe(150));
        // Page 0 keeps its place: [0, 150) is exactly what it holds.
        expect(indicesOf(mocks.paging, 0)).toHaveLength(150);

        // The tree asks for the next rows; they are addressed at 150, so row
        // 150 is the first one asked for — nothing between 150 and 499 is lost.
        act(() => { mocks.paging!.onNeedRows(150, 300); });
        await waitFor(() => expect(mocks.paging?.pages.has(1)).toBe(true));
        expect(mocks.getPage).toHaveBeenLastCalledWith(
            "http://e3", "r", "ws", expect.anything(), { offset: 150, limit: 150, hash: "h" }, expect.anything());
        const page1 = indicesOf(mocks.paging, 1);
        expect(page1[0]).toBe(150);
        expect(page1[page1.length - 1]).toBe(299);
    });

    test("a later page served shorter re-learns, drops the pages, and re-asks at the new size", async () => {
        // A server that trims inconsistently: 150 on the first page, 100 after.
        serve(1_000, (w) => ("offset" in w && w.offset === 0 ? 150 : 100));
        renderPreview();
        await waitFor(() => expect(mocks.paging?.pageSize).toBe(150));

        act(() => { mocks.paging!.onNeedRows(150, 300); });
        await waitFor(() => expect(mocks.paging?.pageSize).toBe(100));
        // Pages addressed at 150 no longer line up — all of them go.
        expect(mocks.paging?.pages.size).toBe(0);

        act(() => { mocks.paging!.onNeedRows(100, 200); });
        await waitFor(() => expect(mocks.paging?.pages.has(1)).toBe(true));
        expect(mocks.getPage).toHaveBeenLastCalledWith(
            "http://e3", "r", "ws", expect.anything(), { offset: 100, limit: 100, hash: "h" }, expect.anything());
        expect(indicesOf(mocks.paging, 1)[0]).toBe(100);
    });

    test("an untrimmed dataset keeps the requested size", async () => {
        serve(1_000, (w) => ("limit" in w ? w.limit : 0));
        renderPreview();
        await waitFor(() => expect(mocks.paging).toBeDefined());
        expect(mocks.paging!.pageSize).toBe(500);
        expect(indicesOf(mocks.paging, 0)).toHaveLength(500);
    });
});

describe("PagedDatasetPreview — the totals line, in the app's locale (#850)", () => {
    test("a German viewer reads the element count and the size in German", async () => {
        // 1,000,000 elements of 8 bytes: 8,000,000 bytes, 7.63 MB.
        serve(1_000_000, (w) => ("limit" in w ? w.limit : 0));
        const { container } = renderPreview("de-DE");
        await waitFor(() => expect(container.textContent).toContain("1.000.000 items · 7,63 MB"));
    });

    test("English is unchanged", async () => {
        serve(1_000_000, (w) => ("limit" in w ? w.limit : 0));
        const { container } = renderPreview("en-US");
        await waitFor(() => expect(container.textContent).toContain("1,000,000 items · 7.63 MB"));
    });
});
