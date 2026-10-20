/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Two edits in an editable preview, the second made before the value the first
 * wrote has loaded, both reach the dataset. Applied to the value on screen, the
 * second edit would write the first away. Over the counts e3 itself holds
 * (#1377), the first write held on its way to e3 while the second edit is made.
 */

import { describe, test, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient } from "@tanstack/react-query";
import { DictType, IntegerType, StringType, decodeBeast2For, variant } from "@elaraai/east";
import { system, type ValueTreeValue } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/bind/data/data";
import { act, e3Harness, settle } from "../e3-web-mount.test-utils.js";
import { E3Provider } from "../platform/e3-config.js";
import { DatasetPreview } from "./DatasetPreview.js";

/** The tree the preview renders, as it last rendered it. */
const shown: { tree?: ValueTreeValue } = {};
vi.mock("@elaraai/east-ui-components", async (importOriginal) => ({
    ...await importOriginal<typeof import("@elaraai/east-ui-components")>(),
    EastChakraValueTree: ({ value }: { value: ValueTreeValue }) => { shown.tree = value; return null; },
}));

const h = e3Harness({ "bind/data/data": ex }, { measure: false });

/** The counts' dotted path, as a preview names it. */
const COUNTS = "inputs.preview_counts";
const decodeCounts = decodeBeast2For(DictType(StringType, IntegerType));

describe("an editable preview", () => {
    test("applies an edit made before the last edit's value has loaded to that value", async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(
            <ChakraProvider value={system}>
                <E3Provider config={{ apiUrl: h.e3.apiUrl, repo: h.e3.repo, workspace: h.workspace, fetch: h.e3.fetch }} queryClient={client}>
                    <DatasetPreview apiUrl={h.e3.apiUrl} repo={h.e3.repo} workspace={h.workspace} path={COUNTS} pollInterval={60_000} editable
                        requestOptions={{ token: null, fetch: h.e3.fetch }} />
                </E3Provider>
            </ChakraProvider>,
        );
        await vi.waitFor(() => expect(shown.tree?.onInsert.type).toBe("some"));

        // The first write is still on its way to e3 when the next edit is made.
        const writes = h.e3.hold((request) => request.kind === "write" && request.dataset === COUNTS);
        const insert = (shown.tree!.onInsert as unknown as { value: (path: unknown[]) => Promise<void> }).value;
        await act(async () => {
            void insert([variant("key", "x")]);
            void insert([variant("key", "y")]);
        });
        await writes.holding;
        await act(async () => { writes.release(); });
        await settle();

        const written = h.requests("write", COUNTS).map((request) => [...decodeCounts(request.body!).keys()]);
        expect(written).toEqual([["a", "b", "c", "x"], ["a", "b", "c", "x", "y"]]);
        expect([...(await h.read(ex.previewCountsInput)).keys()]).toEqual(["a", "b", "c", "x", "y"]);
    });
});
