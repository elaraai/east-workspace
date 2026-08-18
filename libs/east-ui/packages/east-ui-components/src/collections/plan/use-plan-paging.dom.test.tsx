/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The paging driver (#577) — the loop between where the viewport is and which
 * windows are resident.
 *
 * The behaviours that matter to a user are all here: the canvas starts at the
 * top with the rest of the source described by a band, scrolling walks the run
 * forward one window at a time, a jump REBASES instead of loading everything in
 * between, and the run stays bounded no matter how far you go.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";
import { some, none } from "@elaraai/east";
import type { PlanRowValue } from "./model.js";
import type { PlanPagedSourceValue } from "./use-plan-paging.js";
import { usePlanPaging, PLAN_PAGE_SIZE, type PlanViewport } from "./use-plan-paging.js";

afterEach(cleanup);

const ROW_PX = 32;

/** A synchronous source of `windows` windows, `rowsPer` rows each, keyed by
 *  window so the merged order is checkable. Records which windows were asked
 *  for. */
function source(windows: number, rowsPer = 2) {
    const asked: number[] = [];
    const value = {
        id: "driver-test",
        page: (offset: bigint) => {
            const w = Number(offset) / PLAN_PAGE_SIZE;
            asked.push(w);
            const pad = String(w).padStart(4, "0");
            const rows = new Map<string, PlanRowValue>();
            for (let i = 0; i < rowsPer; i++) {
                const key = `w${pad}r${String(i).padStart(3, "0")}`;
                rows.set(key, { key, parent: none } as unknown as PlanRowValue);
            }
            return some(rows);
        },
        total: () => some(BigInt(windows * PLAN_PAGE_SIZE)),
        seek: none,
    } as unknown as PlanPagedSourceValue;
    return { value, asked };
}

let latest: ReturnType<typeof usePlanPaging> | undefined;

function Harness({ src }: { src: PlanPagedSourceValue }) {
    const paging = usePlanPaging(src, { heightOf: (rows) => rows.length * ROW_PX });
    latest = paging;
    return (
        <div>
            <span data-testid="rows">{paging.rows.map((r) => r.key).join(" ")}</span>
            <span data-testid="resident">
                {paging.resident ? `${paging.resident.from}-${paging.resident.to}` : "-"}
            </span>
            <span data-testid="head">{paging.head ? `${paging.head.from}-${paging.head.to}` : "-"}</span>
            <span data-testid="tail">{paging.tail ? `${paging.tail.from}-${paging.tail.to}` : "-"}</span>
        </div>
    );
}

const text = (id: string): string => screen.getByTestId(id).textContent ?? "";
const report = (at: PlanViewport, scrolling = false): void => {
    act(() => { latest?.reportViewport(at, scrolling); });
};

describe("paging driver — first paint", () => {
    test("starts at the top and describes the rest of the source as a tail band", async () => {
        const { value } = source(50);                     // 10,000 elements
        render(<Harness src={value} />);

        // The demand settles at [0, ahead] — window 0 plus its prefetch ring.
        await waitFor(() => expect(text("resident")).toBe("0-600"));
        expect(text("rows").split(" ")).toHaveLength(6);
        expect(text("rows").startsWith("w0000r000")).toBe(true);
        // Nothing above the top, and everything below is one band.
        expect(text("head")).toBe("-");
        expect(text("tail")).toBe("600-9999");
    });

    test("only the demanded windows are ever asked for", async () => {
        const { value, asked } = source(50);
        render(<Harness src={value} />);
        await waitFor(() => expect(text("resident")).toBe("0-600"));
        // Three windows, each asked once — not a walk of the whole source, and
        // not a re-read per evaluation.
        expect([...new Set(asked)].sort((a, b) => a - b)).toEqual([0, 1, 2]);
        expect(asked.length).toBe(3);
    });
});

describe("paging driver — scrolling", () => {
    test("reporting the tail band walks the run forward, one window per commit", async () => {
        const { value } = source(50);
        render(<Harness src={value} />);
        await waitFor(() => expect(text("resident")).toBe("0-600"));

        report({ kind: "band", at: "tail" });
        await waitFor(() => expect(text("resident")).not.toBe("0-600"));
        const after = text("resident");
        // The run extended rather than jumping — the head is still near the top.
        expect(after.startsWith("0-") || after.startsWith("200-")).toBe(true);
    });

    test("nothing is fetched while the gesture is still running", async () => {
        const { value, asked } = source(50);
        render(<Harness src={value} />);
        await waitFor(() => expect(text("resident")).toBe("0-600"));
        const before = asked.length;

        // Mid-drag: the extent must not move under the cursor.
        report({ kind: "band", at: "tail" }, true);
        await new Promise((r) => setTimeout(r, 20));
        expect(asked.length).toBe(before);

        // Released: demand resumes.
        report({ kind: "band", at: "tail" }, false);
        await waitFor(() => expect(asked.length).toBeGreaterThan(before));
    });
});

describe("paging driver — a jump rebases", () => {
    test("jumping to element 40,000 does NOT load everything in between", async () => {
        const { value, asked } = source(250);             // 50,000 elements
        render(<Harness src={value} />);
        await waitFor(() => expect(text("resident")).toBe("0-600"));
        const beforeJump = new Set(asked);

        act(() => { latest?.jumpToElement(40_000); });

        // The run rebases AROUND the target — the demand ring keeps one window
        // behind it, so the interval starts just before element 40,000.
        await waitFor(() => {
            const [from, to] = text("resident").split("-").map(Number) as [number, number];
            expect(from).toBeLessThanOrEqual(40_000);
            expect(to).toBeGreaterThan(40_000);
        });
        // Everything before the run is now ONE band, not 199 loaded windows.
        const [from] = text("resident").split("-").map(Number) as [number, number];
        expect(text("head")).toBe(`0-${from - 1}`);
        // And the windows in between were never asked for.
        const newlyAsked = asked.filter((w) => !beforeJump.has(w));
        for (const w of newlyAsked) expect(w).toBeGreaterThanOrEqual(199);
    });

    test("after a jump the far end is released — the run stays bounded", async () => {
        const { value } = source(250);
        render(<Harness src={value} />);
        await waitFor(() => expect(text("resident")).toBe("0-600"));

        act(() => { latest?.jumpToElement(40_000); });
        await waitFor(() => {
            const [f] = text("resident").split("-").map(Number) as [number, number];
            expect(f).toBeGreaterThan(30_000);
        });

        // The window count resident is the demand span, not "everything ever
        // visited": the old run was dropped by the rebase.
        const [from, to] = text("resident").split("-").map(Number) as [number, number];
        expect((to - from) / PLAN_PAGE_SIZE).toBeLessThanOrEqual(4);
    });
});

describe("paging driver — an unreadable source", () => {
    test("reports the reason instead of an empty canvas", async () => {
        const boom = (): never => { throw new Error("no paging service"); };
        const bad = { id: "bad", page: boom, total: boom, seek: none } as unknown as PlanPagedSourceValue;
        render(<Harness src={bad} />);
        await waitFor(() => expect(latest?.error).toMatch(/no paging service/));
        expect(text("rows")).toBe("");
    });
});

describe("paging driver — bounded retention", () => {
    test("scrolling a 50,000-element source end to end keeps the resident rows under the cap", async () => {
        // #567's long-standing criterion, which nothing before this could meet:
        // the dense prefix kept everything it had ever loaded. 250 windows of
        // 100 rows is 25,000 rows if nothing is evicted; the budget is 4,000.
        const { value } = source(250, 100);
        render(<Harness src={value} />);
        await waitFor(() => expect(latest?.resident).toBeDefined());

        let peakRows = 0;
        // Walk the whole source the way a user does — one viewport step at a
        // time, always at the leading edge.
        for (let i = 0; i < 400; i++) {
            report({ kind: "band", at: "tail" });
            const r = latest?.resident;
            if (r !== undefined) peakRows = Math.max(peakRows, ((r.to - r.from) / PLAN_PAGE_SIZE) * 100);
            if (latest?.tail === undefined) break;      // reached the end
        }

        // Retention held the whole way: never the 25,000 rows a dense prefix
        // would have accumulated.
        expect(peakRows).toBeLessThanOrEqual(4_000);
        // ...and we genuinely travelled — the run is nowhere near the top.
        expect(latest!.resident!.from).toBeGreaterThan(10_000);
    });

    test("the head band grows as the run moves away from the top", async () => {
        const { value } = source(250, 100);
        render(<Harness src={value} />);
        await waitFor(() => expect(latest?.resident).toBeDefined());
        for (let i = 0; i < 60; i++) report({ kind: "band", at: "tail" });

        const head = latest?.head;
        expect(head).toBeDefined();
        expect(head!.from).toBe(0);
        // Everything left behind is described by ONE band, not by rows.
        expect(head!.to).toBeGreaterThan(1_000);
        expect(head!.px).toBeGreaterThan(0);
    });
});

describe("paging driver — a derived source whose rows change (#590)", () => {
    /** A source whose id and row-label are independent, so the two can be
     *  varied separately — which is the whole question here. */
    function labelled(id: string, label: string) {
        return {
            id,
            page: (offset: bigint) => {
                const w = Number(offset) / PLAN_PAGE_SIZE;
                const rows = new Map<string, PlanRowValue>();
                const key = `${label}-w${w}`;
                rows.set(key, { key, parent: none } as unknown as PlanRowValue);
                return some(rows);
            },
            total: () => some(BigInt(PLAN_PAGE_SIZE)),
            seek: none,
        } as unknown as PlanPagedSourceValue;
    }

    test("a NEW page function under the SAME id serves the OLD rows — the window cache is keyed on id alone", async () => {
        const { rerender } = render(<Harness src={labelled("ops", "before")} />);
        await waitFor(() => expect(text("rows")).toContain("before-w0"));

        // What a pick toggle does: the Reactive re-runs and the Plan rebuilds
        // its `page` (the series list inside it changed), but the underlying
        // handle's id is the author's and does not move.
        rerender(<Harness src={labelled("ops", "after")} />);
        await act(async () => { await Promise.resolve(); });

        // Resident windows are immutable and served from cache, so the canvas
        // keeps showing rows the author no longer asked for.
        expect(text("rows")).toContain("before-w0");
        expect(text("rows")).not.toContain("after-w0");
    });

    test("moving the id re-reads — which is why a derived source must sign its id", async () => {
        const { rerender } = render(<Harness src={labelled("ops#a", "before")} />);
        await waitFor(() => expect(text("rows")).toContain("before-w0"));

        // The same rebuild, but the id now carries a signature of what the
        // source was derived WITH. `PagedSourceType` already requires this:
        // "two sources with the same `id` must serve the same rows".
        rerender(<Harness src={labelled("ops#b", "after")} />);
        await waitFor(() => expect(text("rows")).toContain("after-w0"));
        expect(text("rows")).not.toContain("before-w0");
    });
});
