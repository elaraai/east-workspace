/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A host draws a dataset preview's Collapse all and Expand all in its own
 * header (#1209): `toolbar={false}` hides the tree's own, and the host's act on
 * the tree through the handle it makes with `usePreviewControls`, whether the
 * value is shown inline or a page at a time. Over values e3 itself holds
 * (#1377): one nested three deep, shown whole while it is edited, and a
 * collection of two rows, a page at a time.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient } from "@tanstack/react-query";
import { system } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/bind/data/data";
import { e3Harness } from "../e3-web-mount.test-utils.js";
import { E3Provider } from "../platform/e3-config.js";
import { DatasetPreview, type DatasetPreviewProps } from "./DatasetPreview.js";
import { usePreviewControls } from "./preview-controls.js";

const h = e3Harness({ "bind/data/data": ex }, { measure: false });

/** A value nested three deep: one level opens by default, so `Deep` starts hidden. */
const NESTED = "inputs.preview_nested";
/** A collection, paged when read-only: each row's `Inner` starts collapsed. */
const ROWS = "inputs.preview_nested_rows";

const originalOffsetH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
const originalOffsetW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");

beforeEach(() => {
    // The tree sizes its viewport by its offset size, which jsdom reports as
    // zero, leaving no row in range: room for every row here.
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 600 });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 600 });
});

afterEach(() => {
    // The tree keeps what is open per path in the page's storage, which the harness clears.
    if (originalOffsetH !== undefined) Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetH);
    if (originalOffsetW !== undefined) Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalOffsetW);
});

/** A host drawing Collapse all and Expand all of its own over the preview,
 *  giving the preview its handle unless `unhanded`. */
function Host({ unhanded = false, path, ...props }: Partial<DatasetPreviewProps> & { unhanded?: boolean; path: string }) {
    const controls = usePreviewControls();
    return (
        <>
            <button type="button" onClick={controls.collapseAll}>Host collapse</button>
            <button type="button" onClick={controls.expandAll}>Host expand</button>
            <DatasetPreview apiUrl={h.e3.apiUrl} repo={h.e3.repo} workspace={h.workspace} path={path} pollInterval={60_000}
                requestOptions={{ token: null, fetch: h.e3.fetch }} {...(!unhanded && { controls })} {...props} />
        </>
    );
}

function renderHost(props: Partial<DatasetPreviewProps> & { unhanded?: boolean; path: string }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (more: Partial<DatasetPreviewProps> & { unhanded?: boolean; path: string }) => (
        <ChakraProvider value={system}>
            <E3Provider config={{ apiUrl: h.e3.apiUrl, repo: h.e3.repo, workspace: h.workspace, fetch: h.e3.fetch }} queryClient={client}>
                <Host {...more} />
            </E3Provider>
        </ChakraProvider>
    );
    const view = render(tree(props));
    return { rerenderWith: (more: Partial<DatasetPreviewProps> & { unhanded?: boolean; path: string }) => view.rerender(tree(more)) };
}

describe("a value shown inline (#1209)", () => {
    test("its tree draws Collapse all and Expand all unless toolbar={false}, and the host's own act on it", async () => {
        const { rerenderWith } = renderHost({ path: NESTED, editable: true });
        expect(await screen.findByText("Inner")).toBeTruthy();
        expect(screen.getByText("Collapse all")).toBeTruthy();

        rerenderWith({ path: NESTED, editable: true, toolbar: false });
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
        const { rerenderWith } = renderHost({ path: ROWS });
        expect((await screen.findAllByText("Inner")).length).toBe(2);
        expect(screen.getByText("Collapse all")).toBeTruthy();

        rerenderWith({ path: ROWS, toolbar: false });
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
        const { rerenderWith } = renderHost({ path: ROWS, toolbar: false, unhanded: true });
        expect((await screen.findAllByText("Inner")).length).toBe(2);
        fireEvent.click(screen.getByText("Host expand"));
        expect(screen.queryAllByText("Deep")).toEqual([]);

        rerenderWith({ path: ROWS, toolbar: false });
        fireEvent.click(screen.getByText("Host expand"));
        expect((await screen.findAllByText("Deep")).length).toBe(2);
    });
});
