/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A preview whose load fails shows the failure. A failed query has no data,
 * so a preview that asks whether it has data before whether it failed shows
 * "Loading..." for as long as it is mounted. Over e3 itself (#1377): the count
 * and the ui task `preview_view` it deploys, each failure a fault at the
 * harness's fetch.
 */

import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient } from "@tanstack/react-query";
import { system } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/bind/data/data";
import type { E3Request } from "../e3-web.test-utils.js";
import { e3Harness } from "../e3-web-mount.test-utils.js";
import { E3Provider } from "../platform/e3-config.js";
import { ReactiveDatasetProvider } from "../platform/dataset-hooks.js";
import { DatasetPreview } from "./DatasetPreview.js";
import { UITaskPreview } from "./UITaskPreview.js";

const h = e3Harness({ "bind/data/data": ex }, { measure: false });

/** The ui task, binding nothing. */
const VIEW = ex.previewView.name;
/** Its output's dotted path. */
const OUTPUT = `tasks.${VIEW}.output`;
/** The count's dotted path. */
const COUNT = "inputs.count";

/** Fails each request it matches as e3 answers a failure. */
const failing = (match: (request: E3Request) => boolean) => h.e3.fail(match, { status: 500, type: "internal", message: "the server fell over" });

function renderIn(children: React.ReactNode) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <ChakraProvider value={system}>
            <E3Provider config={{ apiUrl: h.e3.apiUrl, repo: h.e3.repo, workspace: h.workspace, fetch: h.e3.fetch }} queryClient={client}>{children}</E3Provider>
        </ChakraProvider>,
    );
}

describe("a preview whose load fails", () => {
    test("DatasetPreview shows the value's failure", async () => {
        failing((request) => request.kind === "read" && request.dataset === COUNT);
        renderIn(<DatasetPreview apiUrl={h.e3.apiUrl} repo={h.e3.repo} workspace={h.workspace} path={COUNT} pollInterval={60_000}
            requestOptions={{ token: null, fetch: h.e3.fetch }} />);
        expect(await screen.findByText("Load failed")).not.toBe(null);
        expect(screen.queryByText("Loading...")).toBe(null);
    });

    test("UITaskPreview shows its output's status failure", async () => {
        failing((request) => request.kind === "dataset-status" && request.dataset === OUTPUT);
        renderIn(<UITaskPreview task={VIEW} />);
        expect(await screen.findByText("Error")).not.toBe(null);
        expect(screen.queryByText("Loading...")).toBe(null);
    });

    test("UITaskPreview shows its output's value failure", async () => {
        failing((request) => request.kind === "read" && request.dataset === OUTPUT);
        renderIn(<UITaskPreview task={VIEW} />);
        expect(await screen.findByText("Load failed")).not.toBe(null);
        expect(screen.queryByText("Loading...")).toBe(null);
    });
});

describe("a UITaskPreview whose config names a workspace", () => {
    test("refuses one other than the workspace its provider serves", async () => {
        // The data bindings read the provider's workspace: rendering the other
        // workspace's task over its data would mix the two.
        renderIn(<ReactiveDatasetProvider><UITaskPreview task={VIEW} config={{ apiUrl: h.e3.apiUrl, workspace: "other", fetch: h.e3.fetch }} /></ReactiveDatasetProvider>);
        expect(await screen.findByText("Workspace mismatch")).not.toBe(null);
    });

    test("renders the provider's own", async () => {
        renderIn(<ReactiveDatasetProvider><UITaskPreview task={VIEW} config={{ apiUrl: h.e3.apiUrl, workspace: h.workspace, fetch: h.e3.fetch }} /></ReactiveDatasetProvider>);
        expect(await screen.findByText("the view")).not.toBe(null);
        expect(screen.queryByText("Workspace mismatch")).toBe(null);
    });
});
