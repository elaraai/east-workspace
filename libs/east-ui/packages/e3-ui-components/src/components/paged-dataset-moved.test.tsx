/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A paged preview whose dataset moves on — another session writes a new value
 * — follows it. A page pinned to the old value is refused with a 409, which is
 * no failure: the preview fetches the status again and reads the new value. A
 * page of the old value still in flight when the new one arrives never lands
 * among the new value's pages. On e3 itself (#1377): its rows written by
 * another session, its refusal e3's, the old page's answer held on its way
 * back.
 */

import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient } from "@tanstack/react-query";
import { system } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/bind/data/data";
import { writeDataset } from "../e3-web.test-utils.js";
import { act, e3Harness, settle } from "../e3-web-mount.test-utils.js";
import { E3Provider } from "../platform/e3-config.js";
import { DatasetPreview } from "./DatasetPreview.js";

const h = e3Harness({ "bind/data/data": ex }, { measure: false });

/** The rows' dotted path, as a preview names it. */
const ROWS = "inputs.preview_rows";
/** `n` rows: the integers from 0. */
const rows = (n: number) => Array.from({ length: n }, (_, i) => BigInt(i));
/** Whether a request reads a page of the rows. */
const isPage = (request: { kind: string; dataset: string | undefined }) => request.kind === "page" && request.dataset === ROWS;

function renderPreview() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <ChakraProvider value={system}>
            <E3Provider config={{ apiUrl: h.e3.apiUrl, repo: h.e3.repo, workspace: h.workspace, fetch: h.e3.fetch }} queryClient={client}>
                <DatasetPreview apiUrl={h.e3.apiUrl} repo={h.e3.repo} workspace={h.workspace} path={ROWS} pollInterval={60_000}
                    requestOptions={{ token: null, fetch: h.e3.fetch }} />
            </E3Provider>
        </ChakraProvider>,
    );
    return client;
}

describe("a paged preview whose dataset moves on", () => {
    test("a page refused as stale fetches the status again and reads the new value, showing no failure", async () => {
        await h.write(ex.previewRowsInput, rows(5));
        // The first page is held on its way to e3 while another session writes three rows in the five's place.
        const first = h.e3.hold(isPage);
        renderPreview();
        await first.holding;
        await writeDataset(h.e3, h.workspace, ex.previewRowsInput, rows(3));
        await act(async () => { first.release(); });
        expect(await screen.findByText(/^3 items/)).not.toBe(null);
        expect(screen.queryByText("Paged load failed")).toBe(null);
        // The status before the page, and again after e3 refused the page pinned to the five.
        expect(h.requests("dataset-status", ROWS)).toHaveLength(2);
    });

    test("a page of the old value still in flight when the new one arrives never lands", async () => {
        await h.write(ex.previewRowsInput, rows(5));
        // e3 answers each page, and each answer is slow on its way back.
        const answers = h.e3.holdAnswers(isPage);
        const client = renderPreview();
        // The five's first page, answered.
        await answers.holding;
        // The dataset moves on while that answer is on its way, and the preview hears of it: the three's first
        // page is answered too.
        await writeDataset(h.e3, h.workspace, ex.previewRowsInput, rows(3));
        await act(async () => { await client.invalidateQueries({ queryKey: ["datasetStatus", h.e3.apiUrl, h.e3.repo, h.workspace, ROWS] }); });
        await settle();
        expect(answers.held).toBe(2);
        // The three's answer overtakes the five's: it lands first, then the five's.
        await act(async () => { answers.releaseLast(); });
        expect(await screen.findByText(/^3 items/)).not.toBe(null);
        await act(async () => { answers.release(); });
        await settle();
        expect(screen.queryByText(/^5 items/)).toBe(null);
        expect(screen.queryByText(/^3 items/)).not.toBe(null);
    });
});
