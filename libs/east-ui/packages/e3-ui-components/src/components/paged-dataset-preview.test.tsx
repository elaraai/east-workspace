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
 * And the served page size (#829): e3 trims pages of wide rows to a byte
 * budget, so the preview addresses pages by what it SERVES — addressed by the
 * requested size, every page after a trimmed one would start past the trimmed
 * page's end and the rows in between would never load. Over rows e3 itself
 * holds (#1377), as another session writes them. e3 trims every page of a
 * value to one size, by the value's average row: a later page served shorter
 * is no case e3 makes, and `servedPageSize`'s tests hold what the preview
 * makes of one.
 */

import { describe, test, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ArrayType, IntegerType, StringType, toEastTypeValue, type EastType } from "@elaraai/east";
import { datasetGetPage, type DatasetPage } from "@elaraai/e3-api-client";
import { I18nProvider, type ValueTreePaging } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/bind/data/data";
import type { E3Dataset } from "../e3-web.test-utils.js";
import { act, e3Harness, settle } from "../e3-web-mount.test-utils.js";

const mocks = vi.hoisted(() => ({
    /** The paging contract the preview last handed the tree. */
    paging: undefined as ValueTreePaging | undefined,
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

const h = e3Harness({ "bind/data/data": ex }, { measure: false });

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

/** A dataset's first page as e3 serves it to another session: its value's hash and its totals. */
const firstPage = (dataset: E3Dataset): Promise<DatasetPage> =>
    datasetGetPage(h.e3.apiUrl, h.e3.repo, h.workspace, dataset.path, { offset: 0, limit: 1 }, h.e3.direct);

/** The preview of a dataset of `type` at `path`, as e3 holds it now, in a locale when given. */
async function renderPreview(dataset: E3Dataset, path: string, type: EastType, locale?: string) {
    const { hash, totalBytes } = await firstPage(dataset);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const preview = (
        <PagedDatasetPreview
            apiUrl={h.e3.apiUrl} repo={h.e3.repo} workspace={h.workspace} path={path}
            type={toEastTypeValue(type)} hash={hash} sizeBytes={totalBytes}
            requestOptions={{ token: null, fetch: h.e3.fetch }}
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

/** Each page the preview asked e3 for, as its offset and its limit. */
const asked = (path: string) => h.requests("page", path).map((request) => [Number(request.query.get("offset")), Number(request.query.get("limit"))]);

const LINES = "inputs.preview_lines";
const ROWS = "inputs.preview_rows";

/**
 * Lines e3 cannot compress, which it stores at about their width: each drawn
 * from 64 letters by xorshift, from one seed, so every run writes the same.
 *
 * @param count - How many lines
 * @param width - Each line's characters
 * @returns The lines
 */
function noise(count: number, width: number): string[] {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let state = 0x9e3779b9;
    return Array.from({ length: count }, () => {
        let line = "";
        for (let i = 0; i < width; i++) {
            state = (state ^ (state << 13)) >>> 0;
            state = (state ^ (state >>> 17)) >>> 0;
            state = (state ^ (state << 5)) >>> 0;
            line += letters[state & 63];
        }
        return line;
    });
}

describe("PagedDatasetPreview — the served page size (#829)", () => {
    test("a trimmed first page sets the size the tree and every later request use", async () => {
        // 450 lines of some 15 KB each, stored: e3's byte budget serves fewer than 300 of them a page.
        await h.write(ex.previewLinesInput, noise(450, 20_000));
        await renderPreview(ex.previewLinesInput, LINES, ArrayType(StringType));
        await waitFor(() => expect(mocks.paging?.pageSize).toBeLessThan(500));
        const served = mocks.paging!.pageSize;
        // Page 0 keeps its place: [0, served) is exactly what it holds.
        expect(indicesOf(mocks.paging, 0)).toHaveLength(served);

        // The tree asks for the next rows; they are addressed at the served size, so its first row is the first one
        // asked for — nothing between it and 499 is lost.
        await act(async () => { mocks.paging!.onNeedRows(served, 2 * served); });
        await waitFor(() => expect(mocks.paging?.pages.has(1)).toBe(true));
        expect(asked(LINES).at(-1)).toEqual([served, served]);
        const page1 = indicesOf(mocks.paging, 1);
        expect(page1[0]).toBe(served);
        expect(page1[page1.length - 1]).toBe(Math.min(2 * served, 450) - 1);
    });

    test("an untrimmed dataset keeps the requested size", async () => {
        await h.write(ex.previewRowsInput, Array.from({ length: 1_000 }, (_, i) => BigInt(i)));
        await renderPreview(ex.previewRowsInput, ROWS, ArrayType(IntegerType));
        await waitFor(() => expect(mocks.paging).toBeDefined());
        expect(mocks.paging!.pageSize).toBe(500);
        expect(indicesOf(mocks.paging, 0)).toHaveLength(500);
        expect(asked(ROWS)).toEqual([[0, 500]]);
    });
});

describe("PagedDatasetPreview — the totals line, in the app's locale (#850)", () => {
    /** A million rows, and the totals line a viewer in `locale` reads of them: e3's totals, in their numbers. */
    async function millionRows(locale: string): Promise<string> {
        await h.write(ex.previewRowsInput, Array.from({ length: 1_000_000 }, (_, i) => BigInt(i)));
        const { totalElements, totalBytes } = await firstPage(ex.previewRowsInput);
        const count = new Intl.NumberFormat(locale).format(totalElements);
        const megabytes = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(totalBytes / 1024 / 1024);
        return `${count} items · ${megabytes} MB`;
    }

    test("a German viewer reads the element count and the size in German", async () => {
        const line = await millionRows("de-DE");
        expect(line.startsWith("1.000.000 items · ")).toBe(true);
        const { container } = await renderPreview(ex.previewRowsInput, ROWS, ArrayType(IntegerType), "de-DE");
        await waitFor(() => expect(container.textContent).toContain(line));
        await settle();
    });

    test("English is unchanged", async () => {
        const line = await millionRows("en-US");
        expect(line.startsWith("1,000,000 items · ")).toBe(true);
        const { container } = await renderPreview(ex.previewRowsInput, ROWS, ArrayType(IntegerType), "en-US");
        await waitFor(() => expect(container.textContent).toContain(line));
        await settle();
    });
});
