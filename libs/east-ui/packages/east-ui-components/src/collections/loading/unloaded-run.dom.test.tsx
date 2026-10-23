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
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../../theme/index.js";
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

    test("the Sheet's flat rows keep their real numbers, and each cell its kind's shape on the host's tracks", () => {
        mount({ view: { top: 0, bottom: 72 }, first: 8300, rowNumber: (i) => (i + 1).toLocaleString("en-GB") });
        const [first, second] = rows();
        expect(first!.style.gridTemplateColumns).toBe("52px 120px 1fr 104px 80px 88px");
        expect(first!.querySelector("[data-shape=rowNumber]")!.textContent).toBe("8,301");
        expect(second!.querySelector("[data-shape=rowNumber]")!.textContent).toBe("8,302");
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

    test("a run out of view draws no row", () => {
        mount({ height: 3600, view: { top: 5000, bottom: 5700 } });
        expect(rows()).toEqual([]);
    });
});
