/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A host draws a data task's controls in its own header (#1120): it controls
 * the Output/Logs tab with `view` and `onViewChange`, hides the preview's band
 * with `toolbar={false}`, and controls the output's key search with `search`
 * and `onSearchChange`, which reach the output's preview. The log is given the
 * band's `toolbar` too, and the host's stream, search and matches, and the
 * host's handle reaches both the output and the log (#1209). TaskPreview passes
 * each to the data task's preview.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, renderHook, cleanup, screen, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { variant, type ValueTypeOf } from "@elaraai/east";
import { taskGet } from "@elaraai/e3-api-client";
import type { TaskDetailsType } from "@elaraai/e3-types";
import { system } from "@elaraai/east-ui-components";
import { DataTaskPreview } from "./DataTaskPreview.js";
import { TaskPreview, type TaskPreviewProps } from "./TaskPreview.js";
import type { DatasetPreviewProps } from "./DatasetPreview.js";
import type { TaskLogsProps } from "./TaskLogs.js";
import { logControlsOf, usePreviewControls, type PreviewControls } from "./preview-controls.js";

vi.mock("@elaraai/e3-api-client", async (importOriginal) => ({
    ...await importOriginal<typeof import("@elaraai/e3-api-client")>(),
    taskGet: vi.fn(),
}));

/** What the output's preview and the log were last given. */
const seen = vi.hoisted(() => ({
    output: undefined as DatasetPreviewProps | undefined,
    logs: undefined as TaskLogsProps | undefined,
}));
vi.mock("./DatasetPreview.js", async (importOriginal) => ({
    ...await importOriginal<typeof import("./DatasetPreview.js")>(),
    DatasetPreview: (props: DatasetPreviewProps) => { seen.output = props; return <div>the output</div>; },
}));
vi.mock("./TaskLogs.js", () => ({ TaskLogs: (props: TaskLogsProps) => { seen.logs = props; return <div>the logs</div>; } }));

// jsdom has no `CSS.escape`, and the switch's radio group finds its items
// through it — every browser has one. A stand-in escaping whatever an id may
// hold.
const cssApi = ((globalThis as { CSS?: { escape?: (s: string) => string } }).CSS ??= {});
cssApi.escape ??= (s: string) => s.replace(/[^\w-]/g, (c) => `\\${c}`);

/** The switch's indicator observes sizes; jsdom has no ResizeObserver. */
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
    vi.mocked(taskGet).mockReset();
    seen.output = undefined;
    seen.logs = undefined;
});

/** A handle, as a host makes one. */
function makeControls(): PreviewControls {
    return renderHook(() => usePreviewControls()).result.current;
}

const API = "http://e3.test";

/** A data task, `report`, whose output is `.tasks.report.output`. */
const DETAILS: ValueTypeOf<typeof TaskDetailsType> = {
    name: "report",
    hash: "2".repeat(64),
    body: variant("east", { program: "3".repeat(64) }),
    runner: variant("east_node", { platforms: [], decode: variant("lazy", null) }),
    inputs: [],
    output: { path: [variant("field", "tasks"), variant("field", "report"), variant("field", "output")], kind: variant("value", null) },
    role: variant("data", null),
};

function renderIn(children: React.ReactNode) {
    vi.mocked(taskGet).mockResolvedValue(DETAILS as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (node: React.ReactNode) => (
        <ChakraProvider value={system}>
            <QueryClientProvider client={client}>{node}</QueryClientProvider>
        </ChakraProvider>
    );
    const view = render(tree(children));
    return { ...view, rerenderIn: (node: React.ReactNode) => view.rerender(tree(node)) };
}

describe("DataTaskPreview's tab (#1120)", () => {
    test("shows the tab a host controls, and tells it of a switch rather than making it", async () => {
        const onViewChange = vi.fn();
        const preview = (view: "output" | "logs") =>
            <DataTaskPreview apiUrl={API} repo="default" workspace="w" task="report" view={view} onViewChange={onViewChange} />;
        const { rerenderIn } = renderIn(preview("logs"));
        expect(await screen.findByText("the logs")).not.toBe(null);

        fireEvent.click(screen.getByTitle("Output"));
        await vi.waitFor(() => expect(onViewChange).toHaveBeenCalledWith("output"));
        expect(screen.getByText("the logs")).toBeTruthy();
        expect(screen.queryByText("the output")).toBe(null);

        rerenderIn(preview("output"));
        expect(await screen.findByText("the output")).not.toBe(null);
    });

    test("switches itself when the host does not control it, and tells the host", async () => {
        const onViewChange = vi.fn();
        renderIn(<DataTaskPreview apiUrl={API} repo="default" workspace="w" task="report" onViewChange={onViewChange} />);
        expect(await screen.findByText("the output")).not.toBe(null);

        fireEvent.click(screen.getByTitle("Logs"));
        expect(await screen.findByText("the logs")).not.toBe(null);
        expect(onViewChange).toHaveBeenCalledWith("logs");
    });
});

describe("DataTaskPreview's band (#1120)", () => {
    test("is drawn unless the host draws its controls", async () => {
        renderIn(<DataTaskPreview apiUrl={API} repo="default" workspace="w" task="report" />);
        expect(await screen.findByText("the output")).not.toBe(null);
        expect(screen.getByTitle("Logs")).toBeTruthy();
        expect(seen.output?.toolbar).toBe(true);
    });

    test("toolbar={false} draws no switch, and the output's preview no band; the search reaches it", async () => {
        const onSearchChange = vi.fn();
        renderIn(<DataTaskPreview apiUrl={API} repo="default" workspace="w" task="report"
            toolbar={false} search="k01" onSearchChange={onSearchChange} />);
        expect(await screen.findByText("the output")).not.toBe(null);
        expect(screen.queryByTitle("Logs")).toBe(null);
        expect(screen.queryByTitle("Output")).toBe(null);
        expect(seen.output?.toolbar).toBe(false);
        expect(seen.output?.search).toBe("k01");
        expect(seen.output?.onSearchChange).toBe(onSearchChange);
    });
});

describe("DataTaskPreview's log (#1209)", () => {
    test("draws its band unless the host draws its controls", async () => {
        renderIn(<DataTaskPreview apiUrl={API} repo="default" workspace="w" task="report" view="logs" />);
        expect(await screen.findByText("the logs")).not.toBe(null);
        expect(seen.logs?.toolbar).toBe(true);
    });

    test("is given toolbar={false}, the host's stream, search and matches, and the log's half of its handle", async () => {
        const controls = makeControls();
        const onLogStreamChange = vi.fn();
        const onLogSearchChange = vi.fn();
        const onLogMatchesChange = vi.fn();
        renderIn(<DataTaskPreview apiUrl={API} repo="default" workspace="w" task="report" view="logs" toolbar={false}
            logStream="stderr" onLogStreamChange={onLogStreamChange} logSearch="err" onLogSearchChange={onLogSearchChange}
            onLogMatchesChange={onLogMatchesChange} controls={controls} />);
        expect(await screen.findByText("the logs")).not.toBe(null);
        expect([seen.logs?.toolbar, seen.logs?.stream, seen.logs?.search]).toEqual([false, "stderr", "err"]);
        expect(seen.logs?.onStreamChange).toBe(onLogStreamChange);
        expect(seen.logs?.onSearchChange).toBe(onLogSearchChange);
        expect(seen.logs?.onMatchesChange).toBe(onLogMatchesChange);
        expect(seen.logs?.controlsRef).toBe(logControlsOf(controls));
    });

    test("the output's preview is given the host's handle too", async () => {
        const controls = makeControls();
        renderIn(<DataTaskPreview apiUrl={API} repo="default" workspace="w" task="report" controls={controls} />);
        expect(await screen.findByText("the output")).not.toBe(null);
        expect(seen.output?.controls).toBe(controls);
    });
});

describe("TaskPreview (#1120)", () => {
    test("passes a data task's controls to its preview, each change alone reaching it", async () => {
        const onViewChange = vi.fn();
        const first = vi.fn();
        const second = vi.fn();
        const preview = (controls: { view: "output" | "logs"; toolbar: boolean; search: string; onSearchChange: (s: string) => void }) => (
            <TaskPreview apiUrl={API} repo="default" workspace="w" task="report" bare onViewChange={onViewChange} {...controls} />
        );
        const controls = { view: "output" as const, toolbar: false, search: "k01", onSearchChange: first };
        const { rerenderIn } = renderIn(preview(controls));
        expect(await screen.findByText("the output")).not.toBe(null);
        expect(screen.queryByTitle("Output")).toBe(null);
        expect(seen.output?.toolbar).toBe(false);
        expect(seen.output?.search).toBe("k01");
        expect(seen.output?.onSearchChange).toBe(first);

        rerenderIn(preview({ ...controls, search: "k02" }));
        await vi.waitFor(() => expect(seen.output?.search).toBe("k02"));
        rerenderIn(preview({ ...controls, search: "k02", onSearchChange: second }));
        await vi.waitFor(() => expect(seen.output?.onSearchChange).toBe(second));
        rerenderIn(preview({ ...controls, search: "k02", onSearchChange: second, toolbar: true }));
        expect(await screen.findByTitle("Logs")).not.toBe(null);
        rerenderIn(preview({ ...controls, search: "k02", onSearchChange: second, toolbar: true, view: "logs" }));
        expect(await screen.findByText("the logs")).not.toBe(null);
    });

    test("tells the host of a switch in a data task's preview", async () => {
        const onViewChange = vi.fn();
        renderIn(<TaskPreview apiUrl={API} repo="default" workspace="w" task="report" view="logs" onViewChange={onViewChange} />);
        expect(await screen.findByText("the logs")).not.toBe(null);
        fireEvent.click(screen.getByTitle("Output"));
        await vi.waitFor(() => expect(onViewChange).toHaveBeenCalledWith("output"));
    });
});

describe("TaskPreview (#1209)", () => {
    test("passes a data task's log controls and the host's handle to its preview, each change alone reaching it", async () => {
        type Log = Required<Pick<TaskPreviewProps, "logStream" | "onLogStreamChange" | "logSearch" | "onLogSearchChange" | "onLogMatchesChange" | "controls">>;
        const preview = (log: Log) => (
            <TaskPreview apiUrl={API} repo="default" workspace="w" task="report" bare view="logs" toolbar={false} {...log} />
        );
        const log: Log = {
            logStream: "stdout", onLogStreamChange: vi.fn(), logSearch: "a", onLogSearchChange: vi.fn(),
            onLogMatchesChange: vi.fn(), controls: makeControls(),
        };
        const { rerenderIn } = renderIn(preview(log));
        expect(await screen.findByText("the logs")).not.toBe(null);
        expect([seen.logs?.stream, seen.logs?.search, seen.logs?.toolbar]).toEqual(["stdout", "a", false]);

        const next = { ...log };
        next.logStream = "stderr";
        rerenderIn(preview({ ...next }));
        await vi.waitFor(() => expect(seen.logs?.stream).toBe("stderr"));
        next.logSearch = "b";
        rerenderIn(preview({ ...next }));
        await vi.waitFor(() => expect(seen.logs?.search).toBe("b"));
        next.onLogStreamChange = vi.fn();
        rerenderIn(preview({ ...next }));
        await vi.waitFor(() => expect(seen.logs?.onStreamChange).toBe(next.onLogStreamChange));
        next.onLogSearchChange = vi.fn();
        rerenderIn(preview({ ...next }));
        await vi.waitFor(() => expect(seen.logs?.onSearchChange).toBe(next.onLogSearchChange));
        next.onLogMatchesChange = vi.fn();
        rerenderIn(preview({ ...next }));
        await vi.waitFor(() => expect(seen.logs?.onMatchesChange).toBe(next.onLogMatchesChange));
        next.controls = makeControls();
        rerenderIn(preview({ ...next }));
        await vi.waitFor(() => expect(seen.logs?.controlsRef).toBe(logControlsOf(next.controls)));
    });
});
