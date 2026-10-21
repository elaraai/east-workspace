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
 * the value with `downloadDataset`, as the preview's Download does. The value
 * is the counts e3 itself holds (#1377): read whole while it is edited, a page
 * at a time otherwise, a key searched for found by e3.
 */

import { describe, test, expect, afterEach, onTestFinished, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient } from "@tanstack/react-query";
import { datasetGet, type RequestOptions } from "@elaraai/e3-api-client";
import { system, type ValueTreePaging } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/bind/data/data";
import { e3Harness, settle } from "../e3-web-mount.test-utils.js";
import { E3Provider } from "../platform/e3-config.js";
import { downloadDataset } from "../hooks/useDatasetValue.js";
import { DatasetPreview, formatSize, type DatasetPreviewProps } from "./DatasetPreview.js";

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

const h = e3Harness({ "bind/data/data": ex }, { measure: false });

/** The counts' dotted path, as a preview names it: `a`, `b` and `c`, as deployed. */
const COUNTS = "inputs.preview_counts";

/** The requests' options: their token, and the harness's fetch they go through. */
const options = (): RequestOptions => ({ token: null, fetch: h.e3.fetch });

/** The preview of the counts: inline when `editable`, a read-only collection otherwise paging. */
function renderPreview(props: Partial<DatasetPreviewProps>) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const requestOptions = options();
    const tree = (more: Partial<DatasetPreviewProps>) => (
        <ChakraProvider value={system}>
            <E3Provider config={{ apiUrl: h.e3.apiUrl, repo: h.e3.repo, workspace: h.workspace, fetch: h.e3.fetch }} queryClient={client}>
                <DatasetPreview apiUrl={h.e3.apiUrl} repo={h.e3.repo} workspace={h.workspace} path={COUNTS} pollInterval={60_000}
                    requestOptions={requestOptions} {...more} />
            </E3Provider>
        </ChakraProvider>
    );
    const view = render(tree(props));
    return { rerenderWith: (more: Partial<DatasetPreviewProps>) => view.rerender(tree(more)) };
}

afterEach(() => {
    shown.rendered = false;
    shown.value = undefined;
    shown.scrollToRow = undefined;
    shown.paging = undefined;
});

describe("a value shown inline (#1120)", () => {
    test("draws its band unless toolbar={false}", async () => {
        const { rerenderWith } = renderPreview({ editable: true });
        await vi.waitFor(() => expect(shown.rendered).toBe(true));
        expect(screen.getByText("Download")).toBeTruthy();
        expect(screen.getByPlaceholderText("Search Records")).toBeTruthy();
        expect(screen.getByText(/^3 entries · /)).toBeTruthy();

        rerenderWith({ editable: true, toolbar: false });
        expect(screen.queryByText("Download")).toBe(null);
        expect(screen.queryByPlaceholderText("Search Records")).toBe(null);
        expect(screen.queryByText(/^3 entries · /)).toBe(null);
    });

    test("scrolls to a controlled search's first match, drawing no search box of its own", async () => {
        const { rerenderWith } = renderPreview({ editable: true, search: "b" });
        await vi.waitFor(() => expect(shown.scrollToRow).toBe(1));
        expect(screen.queryByPlaceholderText("Search Records")).toBe(null);
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
        await userEvent.type(await screen.findByPlaceholderText("Search Records"), "b");
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
        expect(screen.getByPlaceholderText("Search Records")).toBeTruthy();

        rerenderWith({ toolbar: false });
        expect(screen.queryByText("Download")).toBe(null);
        expect(screen.queryByPlaceholderText("Search Records")).toBe(null);
        expect(screen.queryByText(/^3 entries · /)).toBe(null);
    });

    test("finds a controlled search on the server and scrolls to its first match, drawing no search box of its own", async () => {
        const { hash } = await datasetGet(h.e3.apiUrl, h.e3.repo, h.workspace, ex.previewCountsInput.path, h.e3.direct);
        const { rerenderWith } = renderPreview({});
        await vi.waitFor(() => expect(shown.paging).toBeDefined());
        expect(shown.paging?.scrollToRow).toBe(undefined);

        rerenderWith({ search: "c" });
        await vi.waitFor(() => expect(shown.paging?.scrollToRow).toBe(2));
        // e3 found it, pinned to the value the preview shows.
        expect(h.requests("find", COUNTS).map((request) => [request.query.get("prefix"), request.query.get("hash")])).toEqual([["c", hash]]);
        expect(screen.queryByPlaceholderText("Search Records")).toBe(null);

        rerenderWith({ search: "" });
        await vi.waitFor(() => expect(shown.paging?.scrollToRow).toBe(undefined));
    });

    test("tells onSearchChange the text of its own search box", async () => {
        const onSearchChange = vi.fn();
        renderPreview({ onSearchChange });
        await userEvent.type(await screen.findByPlaceholderText("Search Records"), "c");
        await vi.waitFor(() => expect(onSearchChange).toHaveBeenLastCalledWith("c"));
        await settle();
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
        const names = captureDownloads();
        // The fetch a host gives: each request it carries, by the dataset it reads.
        const carried: string[] = [];
        const given: RequestOptions = {
            token: null,
            fetch: (input, init) => { carried.push(new URL(input instanceof Request ? input.url : String(input)).pathname); return h.e3.fetch(input, init); },
        };
        await downloadDataset(h.e3.apiUrl, h.e3.repo, h.workspace, "tasks.preview_report.output", given);
        expect(names).toEqual(["tasks_preview_report_output.beast2"]);
        expect(h.requests("read").map((request) => request.dataset)).toEqual(["tasks.preview_report.output"]);
        expect(carried).toEqual([`/api/repos/${h.e3.repo}/workspaces/${h.workspace}/datasets/tasks/preview_report/output`]);
    });

    test("is what the preview's Download does", async () => {
        const names = captureDownloads();
        renderPreview({ editable: true });
        fireEvent.click(await screen.findByText("Download"));
        await vi.waitFor(() => expect(names).toEqual(["inputs_preview_counts.beast2"]));
    });

    test("is exported from the package, with formatSize", async () => {
        const pkg = await import("../index.js");
        expect(pkg.downloadDataset).toBe(downloadDataset);
        expect(pkg.formatSize).toBe(formatSize);
    });
});
