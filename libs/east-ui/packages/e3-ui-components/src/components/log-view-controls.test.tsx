/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A host draws a task's log view's controls in its own header (#1209):
 * `toolbar={false}` draws no band and the log fills the view edge to edge; the
 * host controls the stream and the search and hears the matches; and it steps
 * through the matches and copies the log through the handle it makes with
 * `usePreviewControls`.
 */

import { useEffect } from "react";
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "@elaraai/east-ui-components";
import { TaskLogs, type TaskLogsProps } from "./TaskLogs.js";
import { logControlsOf, usePreviewControls, type PreviewControls } from "./preview-controls.js";
import type { LogMatches } from "./VirtualizedLogViewer.js";

/** Each stream's log, as the task's log reads it. */
const logs = vi.hoisted(() => ({ stdout: "", stderr: "" }));
vi.mock("../hooks/useTaskLogsHook.js", () => ({
    useTaskLogs: (_url: string, _repo: string, _workspace: string, _task: string, stream: "stdout" | "stderr") => ({ data: { data: logs[stream] } }),
}));

// jsdom has no `CSS.escape`, and the tabs find their triggers through it —
// every browser has one. A stand-in escaping whatever an id may hold.
const cssApi = ((globalThis as { CSS?: { escape?: (s: string) => string } }).CSS ??= {});
cssApi.escape ??= (s: string) => s.replace(/[^\w-]/g, (c) => `\\${c}`);

/** The tabs' indicator and the virtualizer observe sizes; jsdom has no ResizeObserver. */
class ResizeObserverStub {
    observe(): void { /* noop */ }
    unobserve(): void { /* noop */ }
    disconnect(): void { /* noop */ }
}

/** The handle the host made, as its last render left it. */
const host = vi.hoisted(() => ({ controls: undefined as PreviewControls | undefined }));

const originalOffsetH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
const originalOffsetW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");

beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    // The virtualizer sizes the log's viewport by its offset size, which jsdom
    // reports as zero, leaving no line in range: room for every line here.
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 400 });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 600 });
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    if (originalOffsetH !== undefined) Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetH);
    if (originalOffsetW !== undefined) Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalOffsetW);
    logs.stdout = "";
    logs.stderr = "";
    host.controls = undefined;
});

/** A host giving the log view the log half of its handle. */
function Host(props: Partial<TaskLogsProps>) {
    const controls = usePreviewControls();
    useEffect(() => { host.controls = controls; }, [controls]);
    return <TaskLogs apiUrl="http://e3.test" repo="default" workspace="w" task="report" controlsRef={logControlsOf(controls)} {...props} />;
}

function renderLogs(props: Partial<TaskLogsProps> = {}) {
    const tree = (more: Partial<TaskLogsProps>) => <ChakraProvider value={system}><Host {...more} /></ChakraProvider>;
    const view = render(tree(props));
    return { ...view, rerenderWith: (more: Partial<TaskLogsProps>) => view.rerender(tree(more)) };
}

/** The clipboard, which jsdom has none of: `writeText` as the test gives it. */
function stubClipboard(writeText: (text: string) => Promise<void>): void {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
}

describe("the log view's band (#1209)", () => {
    test("is drawn unless toolbar={false}, where neither the view nor its log is drawn as a card", () => {
        logs.stdout = "one\ntwo";
        const { container, rerenderWith } = renderLogs();
        expect(screen.getByRole("tab", { name: "stdout" })).toBeTruthy();
        expect(screen.getByPlaceholderText("Search...")).toBeTruthy();
        expect(screen.getByLabelText("Copy logs")).toBeTruthy();
        expect(container.querySelectorAll("[data-bare]").length).toBe(0);

        rerenderWith({ toolbar: false });
        expect(screen.queryByRole("tab")).toBe(null);
        expect(screen.queryByPlaceholderText("Search...")).toBe(null);
        expect(screen.queryByLabelText("Copy logs")).toBe(null);
        // The view, and the log within it, each bare.
        const [view, log] = [...container.querySelectorAll("[data-bare]")];
        expect([view!.contains(log!), log!.textContent]).toEqual([true, "1one2two"]);
    });

    test("bare, the log has none of the card's inset, corners or border", () => {
        const recipe = system.getSlotRecipe("logViewer") as { base: Record<string, Record<string, unknown>> };
        expect(recipe.base["root"]!["&[data-bare]"]).toEqual({ padding: "0" });
        expect(recipe.base["surface"]!["&[data-bare]"]).toEqual({ borderRadius: "0", borderWidth: "0" });
        // With its band, the view is an inset card: its band's corners and its
        // log's rounded, the log bordered by its surface.
        expect([
            recipe.base["root"]!["padding"],
            recipe.base["band"]!["borderTopRadius"],
            recipe.base["surface"]!["borderBottomRadius"],
            recipe.base["surface"]!["layerStyle"],
        ]).toEqual(["{spacing.4}", "{radii.md}", "{radii.md}", "surface.log.dark"]);
    });
});

describe("the log's search (#1209)", () => {
    test("a search the host controls marks its matches in any case, the view drawing no box, count or chevrons, and the host is told the matches", () => {
        logs.stdout = "Error one\nfine\nerror two ERROR";
        const onMatchesChange = vi.fn<(matches: LogMatches) => void>();
        const { container, rerenderWith } = renderLogs({ search: "error", onMatchesChange });
        expect(screen.queryByPlaceholderText("Search...")).toBe(null);
        expect(screen.queryByLabelText("Next match")).toBe(null);
        expect(screen.queryByLabelText("Previous match")).toBe(null);
        expect(screen.getAllByText(/^error$/i).map((mark) => mark.textContent)).toEqual(["Error", "error", "ERROR"]);
        expect(container.querySelector("[data-current]")!.textContent).toBe("Error");
        expect(onMatchesChange).toHaveBeenLastCalledWith({ current: 0, count: 3 });
        // The band's Copy stays: the host draws only what it controls.
        expect(screen.getByLabelText("Copy logs")).toBeTruthy();

        rerenderWith({ search: "two", onMatchesChange });
        expect(onMatchesChange).toHaveBeenLastCalledWith({ current: 0, count: 1 });
        rerenderWith({ search: "", onMatchesChange });
        expect(onMatchesChange).toHaveBeenLastCalledWith({ current: 0, count: 0 });
        expect(container.querySelector("[data-current]")).toBe(null);
    });

    test("tells the host of the matches once each time they change, through the function it passed last", () => {
        logs.stdout = "a b a";
        const first = vi.fn<(matches: LogMatches) => void>();
        const second = vi.fn<(matches: LogMatches) => void>();
        const { rerenderWith } = renderLogs({ search: "a", onMatchesChange: first });
        expect(first.mock.calls).toEqual([[{ current: 0, count: 2 }]]);
        // A new function on each render tells nothing new itself.
        rerenderWith({ search: "a", onMatchesChange: second });
        rerenderWith({ search: "a", onMatchesChange: second });
        expect([first.mock.calls.length, second.mock.calls.length]).toEqual([1, 0]);
        rerenderWith({ search: "b", onMatchesChange: second });
        expect([first.mock.calls.length, second.mock.calls]).toEqual([1, [[{ current: 0, count: 1 }]]]);
    });

    test("its own box tells the host its text, and Escape clears it", () => {
        logs.stdout = "alpha\nbeta";
        const onSearchChange = vi.fn<(search: string) => void>();
        renderLogs({ onSearchChange });
        const box = screen.getByPlaceholderText("Search...");
        fireEvent.change(box, { target: { value: "be" } });
        expect(onSearchChange).toHaveBeenLastCalledWith("be");
        expect(screen.getByText("1/1")).toBeTruthy();
        fireEvent.keyDown(box, { key: "Escape" });
        expect(onSearchChange).toHaveBeenLastCalledWith("");
        expect(screen.queryByText("1/1")).toBe(null);
    });

    test("matches a stretch of text once where matches would overlap, as a find does, the line reading as it is", () => {
        logs.stdout = "aaaa";
        const onMatchesChange = vi.fn<(matches: LogMatches) => void>();
        const { container } = renderLogs({ toolbar: false, search: "aa", onMatchesChange });
        expect(onMatchesChange).toHaveBeenLastCalledWith({ current: 0, count: 2 });
        const log = container.querySelectorAll("[data-bare]")[1]!;
        expect(log.textContent).toBe("1aaaa");
    });
});

describe("the host's controls (#1209)", () => {
    test("step through the log's matches, round from the last to the first and back, as its chevrons do", () => {
        logs.stdout = "Error one\nfine\nerror two ERROR";
        const onMatchesChange = vi.fn<(matches: LogMatches) => void>();
        const { container } = renderLogs({ toolbar: false, search: "error", onMatchesChange });
        const shown = () => container.querySelector("[data-current]")!.textContent;
        act(() => host.controls!.nextMatch());
        expect([onMatchesChange.mock.lastCall![0], shown()]).toEqual([{ current: 1, count: 3 }, "error"]);
        act(() => host.controls!.nextMatch());
        expect(shown()).toBe("ERROR");
        act(() => host.controls!.nextMatch());
        expect([onMatchesChange.mock.lastCall![0], shown()]).toEqual([{ current: 0, count: 3 }, "Error"]);
        act(() => host.controls!.previousMatch());
        expect([onMatchesChange.mock.lastCall![0], shown()]).toEqual([{ current: 2, count: 3 }, "ERROR"]);
    });

    test("copy the log shown, as its Copy does, answering whether the clipboard took it", async () => {
        logs.stdout = "out line";
        logs.stderr = "err line";
        const writeText = vi.fn(async (_text: string): Promise<void> => {});
        stubClipboard(writeText);
        renderLogs({ toolbar: false, stream: "stderr" });
        await expect(host.controls!.copyLog()).resolves.toBe(true);
        expect(writeText).toHaveBeenLastCalledWith("err line");

        writeText.mockRejectedValueOnce(new Error("refused"));
        await expect(host.controls!.copyLog()).resolves.toBe(false);
    });

    test("do nothing while no log or tree is shown, and copy no log", async () => {
        const writeText = vi.fn(async (_text: string): Promise<void> => {});
        stubClipboard(writeText);
        const { unmount } = renderLogs();
        const controls = host.controls!;
        unmount();
        controls.nextMatch();
        controls.previousMatch();
        controls.collapseAll();
        controls.expandAll();
        await expect(controls.copyLog()).resolves.toBe(false);
        expect(writeText).not.toHaveBeenCalled();
    });

    test("are one handle for the life of the host", () => {
        const { rerenderWith } = renderLogs();
        const first = host.controls;
        rerenderWith({ toolbar: false });
        expect(host.controls).toBe(first);
    });
});

describe("the log's stream (#1209)", () => {
    test("a stream the host controls is the one shown, and a click on a tab tells the host rather than switching", async () => {
        logs.stdout = "out line";
        logs.stderr = "err line";
        const onStreamChange = vi.fn<(stream: "stdout" | "stderr") => void>();
        const { rerenderWith } = renderLogs({ stream: "stderr", onStreamChange });
        expect(screen.getByText("err line")).toBeTruthy();
        // A tab selects on the pointer's whole press, which a bare click event is not.
        await userEvent.click(screen.getByRole("tab", { name: "stdout" }));
        expect(onStreamChange).toHaveBeenLastCalledWith("stdout");
        expect([screen.queryByText("err line") !== null, screen.queryByText("out line")]).toEqual([true, null]);

        rerenderWith({ stream: "stdout", onStreamChange });
        expect(screen.getByText("out line")).toBeTruthy();
    });

    test("a stream the host does not control switches at a click, and the host is told", async () => {
        logs.stdout = "out line";
        logs.stderr = "err line";
        const onStreamChange = vi.fn<(stream: "stdout" | "stderr") => void>();
        renderLogs({ onStreamChange });
        expect(screen.getByText("out line")).toBeTruthy();
        await userEvent.click(screen.getByRole("tab", { name: "stderr" }));
        expect(onStreamChange).toHaveBeenLastCalledWith("stderr");
        expect(screen.getByText("err line")).toBeTruthy();
    });

    test("the match shown stays within the matches of another stream that has fewer, and the chevrons step on from it", () => {
        logs.stdout = "x x x";
        logs.stderr = "x x";
        const onMatchesChange = vi.fn<(matches: LogMatches) => void>();
        const { container, rerenderWith } = renderLogs({ toolbar: false, stream: "stdout", search: "x", onMatchesChange });
        const toLast = () => {
            act(() => host.controls!.nextMatch());
            act(() => host.controls!.nextMatch());
            expect(onMatchesChange).toHaveBeenLastCalledWith({ current: 2, count: 3 });
        };
        toLast();
        rerenderWith({ toolbar: false, stream: "stderr", search: "x", onMatchesChange });
        expect(onMatchesChange).toHaveBeenLastCalledWith({ current: 1, count: 2 });
        expect(container.querySelectorAll("[data-current]").length).toBe(1);
        act(() => host.controls!.previousMatch());
        expect(onMatchesChange).toHaveBeenLastCalledWith({ current: 0, count: 2 });

        rerenderWith({ toolbar: false, stream: "stdout", search: "x", onMatchesChange });
        toLast();
        rerenderWith({ toolbar: false, stream: "stderr", search: "x", onMatchesChange });
        act(() => host.controls!.nextMatch());
        expect(onMatchesChange).toHaveBeenLastCalledWith({ current: 0, count: 2 });
    });
});
