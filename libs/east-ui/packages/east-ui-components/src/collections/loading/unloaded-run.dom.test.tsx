/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * `UnloadedRun` in the DOM (#1398, CL2, CL4, CL11, CL12): rows at the pitch,
 * only where the run meets the view and positioned from it, one element a
 * visible row whatever the run's size; the host's own row and cell styles; a
 * shape per kind of content once filled, the Sheet's real numbers at once; a
 * grouped run's bands; a failed run's one line with its Retry; every
 * placeholder `aria-hidden`. Laid out as the Sheet's rows are (a gutter with
 * the number, then the columns) and as the Plan's (a label column, then a
 * plot washed under its grid and its now line) — the two parts it replaces.
 * In a frame it follows the view itself (`rows-scroll.ts`): drawn as it
 * mounts, and again only as a row comes into the view or leaves it; under a
 * builder's reveal its shapes wait for the reveal's word (CL4).
 */

import { Profiler } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../../theme/index.js";
import { RowTopContext, RowsScrollContext, createRowsScroll, type RowsScroll } from "../rows-scroll.js";
import { LoadingReveal } from "./reveal.js";
import { UnloadedRun, type UnloadedRunProps } from "./unloaded-run.js";
import type { RunCell } from "./unloaded-run.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** The Sheet's row: its gutter's number, then a reference, a job, a status, a due date and a quantity. */
const SHEET_CELLS: readonly RunCell[] = [
    { kind: "rowNumber", css: { borderRightWidth: "1px" } },
    { kind: "text" }, { kind: "text" }, { kind: "enum" }, { kind: "date", align: "end" }, { kind: "number" },
];

/** The Plan's row: its label column's two lines, then its plot, washed under the host's grid and now line. */
const PLAN_CELLS: readonly RunCell[] = [
    { kind: "label2" },
    { kind: "wash", overlay: <i data-host-grid="" /> },
];

/** Renders a run. */
function mount(props: Partial<UnloadedRunProps> = {}) {
    return render(
        <ChakraProvider value={system}>
            <UnloadedRun height={16_667 * 36} pitch={36} view={{ top: 0, bottom: 700 }} columns="52px 120px 1fr 104px 80px 88px"
                cells={SHEET_CELLS} filled first={0} rowNumber={(i) => String(i + 1)} {...props} />
        </ChakraProvider>,
    );
}

const run = () => document.querySelector<HTMLElement>("[data-unloaded-run]")!;
const rows = () => [...document.querySelectorAll<HTMLElement>("[data-run-row]")];
const shapes = (row: HTMLElement) => [...row.querySelectorAll("[data-shape]")].map((el) => el.getAttribute("data-shape"));

describe("UnloadedRun (CL2)", () => {
    test("draws only the rows the view meets, at the pitch, from the scroll offset — one element a row however long the run", () => {
        mount({ view: { top: 8300 * 36, bottom: 8300 * 36 + 700 }, first: 0 });
        expect(run().style.height).toBe(`${16_667 * 36}px`);
        const drawn = rows();
        expect(drawn.length).toBe(20);
        // Each row where its index puts it, at the pitch: positioned, never sticky.
        drawn.forEach((row, i) => {
            expect(row.style.top).toBe(`${(8300 + i) * 36}px`);
            expect(row.style.height).toBe("36px");
            expect(row.style.position).not.toBe("sticky");
        });
        // A run a thousand times longer draws the same rows.
        cleanup();
        mount({ height: 16_667_000 * 36, view: { top: 8300 * 36, bottom: 8300 * 36 + 700 } });
        expect(rows().length).toBe(20);
    });

    test("after a jump above or below, the rows are the view's", () => {
        const view = mount({ view: { top: 0, bottom: 700 } });
        expect(rows()[0]!.getAttribute("data-run-index")).toBe("0");
        view.rerender(<ChakraProvider value={system}><UnloadedRun height={16_667 * 36} pitch={36} view={{ top: 12_000 * 36, bottom: 12_000 * 36 + 700 }}
            columns="52px 1fr" cells={SHEET_CELLS} filled first={0} rowNumber={(i) => String(i + 1)} /></ChakraProvider>);
        expect(rows()[0]!.getAttribute("data-run-index")).toBe("12000");
    });

    test("the Sheet's flat rows keep their real numbers, as the host numbers its rows, and each cell its kind's shape on the host's tracks", () => {
        mount({ view: { top: 0, bottom: 72 }, first: 8300, rowNumber: (i) => String(i + 1) });
        const [first, second] = rows();
        expect(first!.style.gridTemplateColumns).toBe("52px 120px 1fr 104px 80px 88px");
        expect(first!.querySelector("[data-shape=rowNumber]")!.textContent).toBe("8301");
        expect(second!.querySelector("[data-shape=rowNumber]")!.textContent).toBe("8302");
        expect(shapes(first!)).toEqual(["rowNumber", "text", "text", "enum", "date", "number"]);
        // Each cell aligned by its column: a quantity at the end, a due date where the host says.
        const cells = [...first!.querySelectorAll("[data-run-cell]")].map((cell) => cell.getAttribute("data-align"));
        expect(cells).toEqual(["start", "start", "start", "start", "end", "end"]);
    });

    test("a text bar's width is keyed to its row, so it holds as the run scrolls", () => {
        const view = mount({ view: { top: 0, bottom: 108 } });
        const width = (index: number) => document.querySelector<HTMLElement>(`[data-run-index="${index}"] [data-shape=text]`)!.style.width;
        const before = [width(1), width(2)];
        view.rerender(<ChakraProvider value={system}><UnloadedRun height={16_667 * 36} pitch={36} view={{ top: 36, bottom: 144 }}
            columns="52px 1fr" cells={SHEET_CELLS} filled first={0} rowNumber={(i) => String(i + 1)} /></ChakraProvider>);
        expect([width(1), width(2)]).toEqual(before);
    });

    test("geometry draws at once — the rows, the host's cells and the real numbers — and the shapes only once filled (CL4)", () => {
        const view = mount({ filled: false, view: { top: 0, bottom: 36 } });
        expect(rows().length).toBe(1);
        expect(shapes(rows()[0]!)).toEqual(["rowNumber"]);
        view.rerender(<ChakraProvider value={system}><UnloadedRun height={16_667 * 36} pitch={36} view={{ top: 0, bottom: 36 }}
            columns="52px 1fr" cells={SHEET_CELLS} filled first={0} rowNumber={(i) => String(i + 1)} /></ChakraProvider>);
        expect(shapes(rows()[0]!)).toEqual(["rowNumber", "text", "text", "enum", "date", "number"]);
    });

    test("every placeholder row is aria-hidden (CL12)", () => {
        mount();
        expect(rows().every((row) => row.getAttribute("aria-hidden") === "true")).toBe(true);
        // Outside a host's grid the run is no cell of one.
        expect(run().hasAttribute("role")).toBe(false);
    });

    test("held as one row of the host's grid, the run is that row's one cell across it, saying nothing; failed, its line is the cell (CL12)", () => {
        const view = mount({ cell: { colIndex: 1, colSpan: 6 } });
        expect([run().getAttribute("role"), run().getAttribute("aria-colindex"), run().getAttribute("aria-colspan")]).toEqual(["gridcell", "1", "6"]);
        expect(run().querySelectorAll('[role="gridcell"]')).toHaveLength(0);
        view.rerender(<ChakraProvider value={system}><UnloadedRun height={16_667 * 36} pitch={36} view={{ top: 0, bottom: 700 }} columns="52px 1fr"
            cells={SHEET_CELLS} filled first={0} rowNumber={(i) => String(i + 1)} cell={{ colIndex: 1, colSpan: 6 }}
            failed={{ message: "Couldn't read rows 1–16,667", retry: { onRetry: () => undefined }, from: 1 }} /></ChakraProvider>);
        // The line is the one cell, from the first column after the gutter to the grid's end; the run itself is none.
        expect(run().hasAttribute("role")).toBe(false);
        const cells = [...run().querySelectorAll('[role="gridcell"]')];
        expect(cells.map((c) => [c.getAttribute("aria-colindex"), c.getAttribute("aria-colspan"), c.textContent])).toEqual([["2", "5", "Couldn't read rows 1–16,667Retry"]]);
    });

    test("laid out as the Plan's rows: the label column's two bars, the plot washed under the host's grid and now line", () => {
        mount({ height: 2778 * 42, pitch: 42, columns: "128px 1fr", cells: PLAN_CELLS, rowNumber: undefined, view: { top: 0, bottom: 84 } });
        const drawn = rows();
        expect(drawn.length).toBe(2);
        expect(drawn.map((row) => row.style.height)).toEqual(["42px", "42px"]);
        expect(shapes(drawn[0]!)).toEqual(["label2", "wash"]);
        // The host's grid draws over the wash in every row, as its real rows draw it.
        expect(drawn.every((row) => row.querySelector("[data-loading-wash] + [data-host-grid]") !== null)).toBe(true);
    });

    test("a plot's grid and now line draw at once; the wash under them waits for the fill", () => {
        mount({ height: 2778 * 42, pitch: 42, columns: "128px 1fr", cells: PLAN_CELLS, rowNumber: undefined, view: { top: 0, bottom: 42 }, filled: false });
        expect([rows()[0]!.querySelector("[data-host-grid]") !== null, rows()[0]!.querySelector("[data-loading-wash]")]).toEqual([true, null]);
    });

    test("a grouped run repeats its band — its chevron real, its key and count placeholders — and its lines at the pitch", () => {
        mount({ height: 10 * (42 + 2 * 36), pitch: 36, group: { band: 42, lines: 2 }, rowNumber: undefined, view: { top: 0, bottom: 200 } });
        const drawn = rows();
        expect(drawn.map((row) => [row.hasAttribute("data-run-band"), row.style.top, row.style.height])).toEqual([
            [true, "0px", "42px"], [false, "42px", "36px"], [false, "78px", "36px"],
            [true, "114px", "42px"], [false, "156px", "36px"], [false, "192px", "36px"],
        ]);
        expect(drawn[0]!.querySelector("svg")).not.toBeNull();
        expect(shapes(drawn[0]!)).toEqual(["aggregate", "count"]);
        // A grouped line's number is not known yet: a short bar.
        expect(drawn[1]!.querySelector("[data-shape=rowNumber]")!.textContent).toBe("");
    });

    test("a failed run says so once, in its first row in view: the reason and Retry across its cells, its heads kept; its other rows bare (CL11)", () => {
        const onRetry = vi.fn();
        mount({
            first: 8300, rowNumber: (i) => String(i + 1), view: { top: 36, bottom: 180 },
            failed: { message: "Couldn't read rows 8,301–8,500", retry: { onRetry }, from: 1 },
        });
        const drawn = rows();
        const said = drawn.filter((row) => row.querySelector("[data-loading-failed]") !== null);
        expect(said).toHaveLength(1);
        expect(said[0]).toBe(drawn[0]);
        // The line spans the cells after the gutter, whose number stays.
        const span = said[0]!.querySelector<HTMLElement>("[data-run-failed]")!;
        expect([span.style.gridColumn, said[0]!.querySelector("[data-shape=rowNumber]")!.textContent]).toEqual(["2 / -1", "8302"]);
        expect(said[0]!.getAttribute("aria-hidden")).toBeNull();
        // The run's other rows: their numbers and rules, nothing else, and no failure text.
        for (const row of drawn.slice(1)) {
            expect(shapes(row)).toEqual(["rowNumber"]);
            expect(row.textContent).not.toContain("Couldn't read");
        }
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    test("a failed run whose rows have no cell past their heads still says so once, in the last cell (CL11)", () => {
        mount({
            columns: "52px", cells: [{ kind: "rowNumber" }], view: { top: 0, bottom: 108 },
            failed: { message: "Couldn't read rows 1–16,667", retry: { onRetry: () => undefined }, from: 1 },
        });
        const said = rows().filter((row) => row.querySelector("[data-loading-failed]") !== null);
        expect(said).toEqual([rows()[0]]);
        expect(said[0]!.querySelector("[data-loading-failed-message]")!.textContent).toBe("Couldn't read rows 1–16,667");
    });

    test("a run out of view draws no row", () => {
        mount({ height: 3600, view: { top: 5000, bottom: 5700 } });
        expect(rows()).toEqual([]);
    });
});

/** A frame's rows' scroll under the test's hand: the view it reports, moved with a word to its listeners — a frame that positions no row. */
function frameScroll(top: number, bottom: number) {
    let at = { top, bottom };
    const listeners = new Set<() => void>();
    const scroll: RowsScroll = {
        view: () => at,
        viewAt: () => undefined,
        top: () => undefined,
        listen: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    };
    return {
        scroll,
        move(nextTop: number, nextBottom: number) {
            act(() => {
                at = { top: nextTop, bottom: nextBottom };
                for (const cb of listeners) cb();
            });
        },
        listening: () => listeners.size,
    };
}

describe("a run that follows the view of its frame (CL2)", () => {
    test("drawn as it mounts with the rows the view meets, a row either side; again only as a row comes into the view or leaves it", () => {
        const frame = frameScroll(8300 * 36, 8300 * 36 + 700);
        let commits = 0;
        const view = render(
            <ChakraProvider value={system}>
                <RowsScrollContext.Provider value={frame.scroll}>
                    <Profiler id="run" onRender={() => { commits += 1; }}>
                        <UnloadedRun height={16_667 * 36} pitch={36} columns="52px 1fr" cells={SHEET_CELLS} first={0} rowNumber={(i) => String(i + 1)} />
                    </Profiler>
                </RowsScrollContext.Provider>
            </ChakraProvider>,
        );
        expect(frame.listening()).toBe(1);
        // 8,300 to 8,319 in view — the 700px view meets twenty rows — and one row either side.
        expect(rows().map((row) => row.getAttribute("data-run-index"))).toEqual(Array.from({ length: 22 }, (_unused, i) => String(8299 + i)));
        const drawn = commits;
        // A scroll inside a row draws nothing again.
        frame.move(8300 * 36 + 20, 8300 * 36 + 720);
        expect(commits).toBe(drawn);
        // A scroll that brings a row in draws it.
        frame.move(8301 * 36 + 20, 8301 * 36 + 720);
        expect(commits).toBe(drawn + 1);
        expect(rows()[0]!.getAttribute("data-run-index")).toBe("8300");
        view.unmount();
        expect(frame.listening()).toBe(0);
    });

    test("placed by its virtual frame, it reads its part in view as it renders: drawn there in the commit that mounts or moves it, never in another after it", () => {
        // The frame's view, in its rows' coordinates: 8,300 rows down, 700px tall; the run where the frame placed it.
        let offset = 8300 * 36;
        const listeners = new Set<() => void>();
        const scroll: RowsScroll = {
            view: () => { throw new Error("a run its frame places reads no layout"); },
            viewAt: (top) => ({ top: offset - top, bottom: offset + 700 - top }),
            top: () => undefined,
            listen: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
        };
        const commits: string[] = [];
        const tree = (top: number) => (
            <ChakraProvider value={system}>
                <RowsScrollContext.Provider value={scroll}>
                    <RowTopContext.Provider value={top}>
                        <Profiler id="run" onRender={(_id, phase) => { commits.push(phase); }}>
                            <UnloadedRun height={16_667 * 36} pitch={36} columns="52px 1fr" cells={SHEET_CELLS} first={0} rowNumber={(i) => String(i + 1)} />
                        </Profiler>
                    </RowTopContext.Provider>
                </RowsScrollContext.Provider>
            </ChakraProvider>
        );
        const view = render(tree(0));
        // Mounted with the rows the view meets, a row either side, in its first commit.
        expect(commits).toEqual(["mount"]);
        expect(rows()[0]!.getAttribute("data-run-index")).toBe("8299");
        // The frame moves it 200 rows down — a window landing above it: drawn there, in that one commit.
        commits.length = 0;
        view.rerender(tree(200 * 36));
        expect(commits).toEqual(["update"]);
        expect(rows()[0]!.getAttribute("data-run-index")).toBe("8099");
        // A word from the frame with nothing moved draws nothing; a scroll a row on draws it once.
        act(() => { for (const cb of listeners) cb(); });
        expect(commits).toEqual(["update"]);
        offset += 36;
        act(() => { for (const cb of listeners) cb(); });
        expect(commits).toEqual(["update", "update"]);
        expect(rows()[0]!.getAttribute("data-run-index")).toBe("8100");
    });

    test("a failed run says so in its first row in view, never in the row a scroll left above it", () => {
        const frame = frameScroll(100 * 36 + 10, 100 * 36 + 300);
        render(
            <ChakraProvider value={system}>
                <RowsScrollContext.Provider value={frame.scroll}>
                    <UnloadedRun height={1000 * 36} pitch={36} columns="52px 1fr" cells={SHEET_CELLS} first={0} rowNumber={(i) => String(i + 1)}
                        failed={{ message: "Couldn't read rows 1–1,000", retry: { onRetry: () => undefined }, from: 1 }} />
                </RowsScrollContext.Provider>
            </ChakraProvider>,
        );
        // Row 99, the one above the view, is drawn; the line is row 100's, the first the view meets.
        expect(rows()[0]!.getAttribute("data-run-index")).toBe("99");
        const said = rows().filter((row) => row.querySelector("[data-loading-failed]") !== null);
        expect(said.map((row) => row.getAttribute("data-run-index"))).toEqual(["100"]);
    });

    test("under a builder's reveal its shapes wait for the reveal's word; its rows and real numbers draw at once (CL4)", () => {
        vi.useFakeTimers();
        try {
            const frame = frameScroll(0, 36);
            render(
                <ChakraProvider value={system}>
                    <LoadingReveal waiting>
                        <RowsScrollContext.Provider value={frame.scroll}>
                            <UnloadedRun height={100 * 36} pitch={36} columns="52px 1fr" cells={SHEET_CELLS} first={0} rowNumber={(i) => String(i + 1)} />
                        </RowsScrollContext.Provider>
                    </LoadingReveal>
                </ChakraProvider>,
            );
            expect([run().hasAttribute("data-filled"), shapes(rows()[0]!)]).toEqual([false, ["rowNumber"]]);
            act(() => { vi.advanceTimersByTime(150); });
            expect([run().hasAttribute("data-filled"), shapes(rows()[0]!)]).toEqual([true, ["rowNumber", "text", "text", "enum", "date", "number"]]);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("what scrolls a frame's rows (rows-scroll)", () => {
    /** An element at a client box. */
    function boxed(el: HTMLElement, top: number, height: number) {
        vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ x: 0, y: top, top, left: 0, right: 400, bottom: top + height, width: 400, height, toJSON() {} } as DOMRect);
        return el;
    }

    test("what of a row the view shows: under the pinned header's inset, from the row's own top; a word to its listeners on a scroll and on every placing", () => {
        const scroll = createRowsScroll();
        const scroller = boxed(document.createElement("div"), 100, 500);
        const row = boxed(document.createElement("div"), -2000, 50_000);
        let heard = 0;
        const stop = scroll.listen(() => { heard += 1; });
        scroll.place(scroller, 24);
        expect(heard).toBe(1);
        expect(scroll.view(row)).toEqual({ top: 100 + 24 + 2000, bottom: 100 + 500 + 2000 });
        scroller.dispatchEvent(new Event("scroll"));
        expect(heard).toBe(2);
        stop();
        scroller.dispatchEvent(new Event("scroll"));
        expect(heard).toBe(2);
        scroll.place(null, 0);
    });
});
