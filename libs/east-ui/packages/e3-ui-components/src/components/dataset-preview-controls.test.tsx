/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A host draws a dataset preview's controls in its own header (#1120):
 * `toolbar={false}` draws no band; a controlled `search` scrolls the value to
 * its first match, inline or paged, the preview drawing no search box of its
 * own; `onSearchChange` hears the preview's own box; and the host downloads
 * the value with `downloadDataset`, as the preview's Download does.
 */

import { describe, test, expect, beforeEach, afterEach, onTestFinished, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient } from "@tanstack/react-query";
import {
    DictType, IntegerType, SortedMap, StringType, compareFor, encodeBeast2For, equalFor, none, some, toEastTypeValue, variant,
} from "@elaraai/east";
import { datasetFindKey, datasetGet, datasetGetPage, datasetGetStatus, type DatasetPage } from "@elaraai/e3-api-client";
import { TreePathType } from "@elaraai/e3-types";
import { system, type ValueTreePaging } from "@elaraai/east-ui-components";
import { E3Provider } from "../platform/e3-config.js";
import { downloadDataset } from "../hooks/useDatasetValue.js";
import { DatasetPreview, formatSize, type DatasetPreviewProps } from "./DatasetPreview.js";

vi.mock("@elaraai/e3-api-client", async (importOriginal) => ({
    ...await importOriginal<typeof import("@elaraai/e3-api-client")>(),
    datasetGetStatus: vi.fn(),
    datasetGet: vi.fn(),
    datasetGetPage: vi.fn(),
    datasetFindKey: vi.fn(),
}));

/** The tree the preview renders, as it last rendered it: the value it was
 *  given, and the row it jumps to, inline or paged. */
const shown = vi.hoisted(() => ({
    rendered: false, value: undefined as unknown, scrollToRow: undefined as number | undefined, paging: undefined as ValueTreePaging | undefined,
}));
vi.mock("@elaraai/east-ui-components", async (importOriginal) => ({
    ...await importOriginal<typeof import("@elaraai/east-ui-components")>(),
    EastChakraValueTree: ({ value, scrollToRow, paging }: { value: unknown; scrollToRow?: number; paging?: ValueTreePaging }) => {
        shown.rendered = true;
        shown.value = value;
        shown.scrollToRow = scrollToRow;
        shown.paging = paging;
        return null;
    },
}));

// jsdom has no `CSS.escape`, and the search box's combobox finds its items
// through it — every browser has one. A stand-in escaping whatever an id may
// hold.
const cssApi = ((globalThis as { CSS?: { escape?: (s: string) => string } }).CSS ??= {});
cssApi.escape ??= (s: string) => s.replace(/[^\w-]/g, (c) => `\\${c}`);

/** The search box's positioner observes sizes; jsdom has no ResizeObserver. */
class ResizeObserverStub {
    observe(): void { /* noop */ }
    unobserve(): void { /* noop */ }
    disconnect(): void { /* noop */ }
}

beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.mocked(datasetGetStatus).mockReset();
    vi.mocked(datasetGet).mockReset();
    vi.mocked(datasetGetPage).mockReset();
    vi.mocked(datasetFindKey).mockReset();
    shown.rendered = false;
    shown.value = undefined;
    shown.scrollToRow = undefined;
    shown.paging = undefined;
});

const API = "http://e3.test";
const HASH = "1".repeat(64);
const CountsType = DictType(StringType, IntegerType);
const COUNTS = new SortedMap<string, bigint>([["a", 1n], ["b", 2n], ["c", 3n]], compareFor(StringType));
const BYTES = encodeBeast2For(CountsType)(COUNTS);

/** A dataset `counts` holding {@link COUNTS}, its value and its pages served. */
function serve(): void {
    vi.mocked(datasetGetStatus).mockResolvedValue({
        path: ".counts", type: toEastTypeValue(CountsType), refType: "value",
        hash: some(HASH), size: some(BigInt(BYTES.length)), segments: none, rows: none,
    } as never);
    vi.mocked(datasetGet).mockResolvedValue({ data: BYTES, hash: HASH } as never);
    vi.mocked(datasetGetPage).mockResolvedValue({
        data: BYTES, totalElements: 3, totalBytes: BYTES.length, totalExact: true, segmentCount: 1, offset: 0, count: 3, hash: HASH,
    } satisfies DatasetPage);
}

/** The preview of `counts`: inline when `editable`, a read-only collection otherwise paging. */
function renderPreview(props: Partial<DatasetPreviewProps>) {
    serve();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (more: Partial<DatasetPreviewProps>) => (
        <ChakraProvider value={system}>
            <E3Provider config={{ apiUrl: API, workspace: "w" }} queryClient={client}>
                <DatasetPreview apiUrl={API} repo="default" workspace="w" path="counts" pollInterval={60_000} {...more} />
            </E3Provider>
        </ChakraProvider>
    );
    const view = render(tree(props));
    return { rerenderWith: (more: Partial<DatasetPreviewProps>) => view.rerender(tree(more)) };
}

describe("a value shown inline (#1120)", () => {
    test("draws its band unless toolbar={false}", async () => {
        const { rerenderWith } = renderPreview({ editable: true });
        await vi.waitFor(() => expect(shown.rendered).toBe(true));
        expect(screen.getByText("Download")).toBeTruthy();
        expect(screen.getByPlaceholderText("Search keys")).toBeTruthy();
        expect(screen.getByText(/^3 entries · /)).toBeTruthy();

        rerenderWith({ editable: true, toolbar: false });
        expect(screen.queryByText("Download")).toBe(null);
        expect(screen.queryByPlaceholderText("Search keys")).toBe(null);
        expect(screen.queryByText(/^3 entries · /)).toBe(null);
    });

    test("scrolls to a controlled search's first match, drawing no search box of its own", async () => {
        const { rerenderWith } = renderPreview({ editable: true, search: "b" });
        await vi.waitFor(() => expect(shown.scrollToRow).toBe(1));
        expect(screen.queryByPlaceholderText("Search keys")).toBe(null);
        // The band's other controls stay.
        expect(screen.getByText("Download")).toBeTruthy();

        rerenderWith({ editable: true, search: "zz" });
        await vi.waitFor(() => expect(shown.scrollToRow).toBe(undefined));
        rerenderWith({ editable: true, search: "c" });
        await vi.waitFor(() => expect(shown.scrollToRow).toBe(2));
        rerenderWith({ editable: true, search: "" });
        await vi.waitFor(() => expect(shown.scrollToRow).toBe(undefined));
    });

    test("tells onSearchChange the text of its own search box", async () => {
        const onSearchChange = vi.fn();
        renderPreview({ editable: true, onSearchChange });
        await userEvent.type(await screen.findByPlaceholderText("Search keys"), "b");
        await vi.waitFor(() => expect(onSearchChange).toHaveBeenLastCalledWith("b"));
        await vi.waitFor(() => expect(shown.scrollToRow).toBe(undefined));
    });

    test("keeps the tree it made while the value stays, as the host's search moves (#1209)", async () => {
        const { rerenderWith } = renderPreview({ editable: true, search: "a" });
        await vi.waitFor(() => expect(shown.scrollToRow).toBe(0));
        const made = shown.value;
        rerenderWith({ editable: true, search: "b" });
        await vi.waitFor(() => expect(shown.scrollToRow).toBe(1));
        expect(shown.value, "the value is not materialized again").toBe(made);
    });
});

describe("a value shown a page at a time (#1120)", () => {
    test("draws its band unless toolbar={false}", async () => {
        const { rerenderWith } = renderPreview({});
        await vi.waitFor(() => expect(shown.paging).toBeDefined());
        expect(screen.getByText("Download")).toBeTruthy();
        expect(screen.getByPlaceholderText("Search keys")).toBeTruthy();

        rerenderWith({ toolbar: false });
        expect(screen.queryByText("Download")).toBe(null);
        expect(screen.queryByPlaceholderText("Search keys")).toBe(null);
        expect(screen.queryByText(/^3 entries · /)).toBe(null);
    });

    test("finds a controlled search on the server and scrolls to its first match, drawing no search box of its own", async () => {
        vi.mocked(datasetFindKey).mockResolvedValue({ found: true, row: 2, count: 1 } as never);
        const { rerenderWith } = renderPreview({});
        await vi.waitFor(() => expect(shown.paging).toBeDefined());
        expect(shown.paging?.scrollToRow).toBe(undefined);

        rerenderWith({ search: "c" });
        await vi.waitFor(() => expect(shown.paging?.scrollToRow).toBe(2));
        expect(vi.mocked(datasetFindKey)).toHaveBeenCalledWith(API, "default", "w", expect.anything(), { prefix: "c", hash: HASH }, expect.anything());
        expect(screen.queryByPlaceholderText("Search keys")).toBe(null);

        rerenderWith({ search: "" });
        await vi.waitFor(() => expect(shown.paging?.scrollToRow).toBe(undefined));
    });

    test("tells onSearchChange the text of its own search box", async () => {
        vi.mocked(datasetFindKey).mockResolvedValue({ found: false, row: 0, count: 0 } as never);
        const onSearchChange = vi.fn();
        renderPreview({ onSearchChange });
        await userEvent.type(await screen.findByPlaceholderText("Search keys"), "c");
        await vi.waitFor(() => expect(onSearchChange).toHaveBeenLastCalledWith("c"));
    });
});

describe("downloadDataset (#1120)", () => {
    /** The file each download hands the browser, by its name. jsdom makes no object URLs: stand-ins, for this test. */
    function captureDownloads(): string[] {
        const names: string[] = [];
        const { createObjectURL, revokeObjectURL } = URL;
        URL.createObjectURL = () => "blob:value";
        URL.revokeObjectURL = () => {};
        onTestFinished(() => {
            URL.createObjectURL = createObjectURL;
            URL.revokeObjectURL = revokeObjectURL;
        });
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
            names.push(this.download);
        });
        return names;
    }

    test("downloads a dataset's value as `<path>.beast2`, through the request options given", async () => {
        serve();
        const names = captureDownloads();
        const given = { token: null, fetch: vi.fn() as unknown as typeof globalThis.fetch };
        await downloadDataset(API, "default", "w", "tasks.report.output", given);
        expect(names).toEqual(["tasks_report_output.beast2"]);
        const [url, repo, workspace, path, options] = vi.mocked(datasetGet).mock.calls[0]!;
        expect([url, repo, workspace]).toEqual([API, "default", "w"]);
        expect(equalFor(TreePathType)(path, [variant("field", "tasks"), variant("field", "report"), variant("field", "output")])).toBe(true);
        expect(options).toBe(given);
    });

    test("is what the preview's Download does", async () => {
        const names = captureDownloads();
        renderPreview({ editable: true });
        fireEvent.click(await screen.findByText("Download"));
        await vi.waitFor(() => expect(names).toEqual(["counts.beast2"]));
    });

    test("is exported from the package, with formatSize", async () => {
        const pkg = await import("../index.js");
        expect(pkg.downloadDataset).toBe(downloadDataset);
        expect(pkg.formatSize).toBe(formatSize);
    });
});
