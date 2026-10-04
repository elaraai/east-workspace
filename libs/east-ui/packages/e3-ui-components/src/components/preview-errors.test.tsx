/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A preview whose load fails shows the failure. A failed query has no data,
 * so a preview that asks whether it has data before whether it failed shows
 * "Loading..." for as long as it is mounted.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient } from "@tanstack/react-query";
import { IntegerType, encodeBeast2For, none, some, toEastTypeValue, variant } from "@elaraai/east";
import { DatasetStatusDetailType, ResponseType, TaskDetailsType } from "@elaraai/e3-types";
import { system } from "@elaraai/east-ui-components";
import { E3Provider } from "../platform/e3-config.js";
import { ReactiveDatasetProvider } from "../platform/dataset-hooks.js";
import { DatasetPreview } from "./DatasetPreview.js";
import { UITaskPreview } from "./UITaskPreview.js";

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const API = "http://e3.test";

/** A dataset holding an Integer value, as the status route answers it. */
const STATUS = encodeBeast2For(ResponseType(DatasetStatusDetailType))(variant("success", {
    path: ".out",
    type: toEastTypeValue(IntegerType),
    refType: "value",
    hash: some("1".repeat(64)),
    size: some(9n),
    segments: none,
    rows: none,
}));

/** A ui task binding nothing, whose output is `.out`. */
const TASK = encodeBeast2For(ResponseType(TaskDetailsType))(variant("success", {
    name: "view",
    hash: "2".repeat(64),
    body: variant("east", { program: "3".repeat(64) }),
    runner: variant("east_node", { platforms: [], decode: variant("lazy", null) }),
    inputs: [],
    output: { path: [variant("field", "out")], kind: variant("value", null) },
    role: variant("ui", { paths: [], functions: [], records: [], pages: [] }),
}));

const FAILURE = () => new Response(JSON.stringify({ error: { type: "internal", message: "the server fell over" } }), { status: 500 });

/** Serves the task and the status as given, and fails the rest. */
function serve(routes: { task?: boolean; status: boolean }) {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        if (routes.task === true && url.includes("/tasks/view")) return new Response(TASK.slice(), { status: 200 });
        if (url.includes("status=true")) return routes.status ? new Response(STATUS.slice(), { status: 200 }) : FAILURE();
        return FAILURE();
    }));
}

function renderIn(children: React.ReactNode) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <ChakraProvider value={system}>
            <E3Provider config={{ apiUrl: API, workspace: "w" }} queryClient={client}>{children}</E3Provider>
        </ChakraProvider>,
    );
}

describe("a preview whose load fails", () => {
    test("DatasetPreview shows the value's failure", async () => {
        serve({ status: true });
        renderIn(<DatasetPreview apiUrl={API} repo="default" workspace="w" path="out" pollInterval={60_000} />);
        expect(await screen.findByText("Load failed")).not.toBe(null);
        expect(screen.queryByText("Loading...")).toBe(null);
    });

    test("UITaskPreview shows its output's status failure", async () => {
        serve({ task: true, status: false });
        renderIn(<UITaskPreview task="view" />);
        expect(await screen.findByText("Error")).not.toBe(null);
        expect(screen.queryByText("Loading...")).toBe(null);
    });

    test("UITaskPreview shows its output's value failure", async () => {
        serve({ task: true, status: true });
        renderIn(<UITaskPreview task="view" />);
        expect(await screen.findByText("Load failed")).not.toBe(null);
        expect(screen.queryByText("Loading...")).toBe(null);
    });
});

describe("a UITaskPreview whose config names a workspace", () => {
    test("refuses one other than the workspace its provider serves", async () => {
        // The data bindings read the provider's workspace, `w`: rendering the
        // other workspace's task over `w`'s data would mix the two.
        serve({ task: true, status: true });
        renderIn(<ReactiveDatasetProvider><UITaskPreview task="view" config={{ apiUrl: API, workspace: "other" }} /></ReactiveDatasetProvider>);
        expect(await screen.findByText("Workspace mismatch")).not.toBe(null);
    });

    test("renders the provider's own", async () => {
        serve({ task: true, status: true });
        renderIn(<ReactiveDatasetProvider><UITaskPreview task="view" config={{ apiUrl: API, workspace: "w" }} /></ReactiveDatasetProvider>);
        expect(await screen.findByText("Load failed")).not.toBe(null);
        expect(screen.queryByText("Workspace mismatch")).toBe(null);
    });
});
