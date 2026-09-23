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

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";
import { some, none } from "@elaraai/east";
import type { PlanRowValue } from "./model.js";
import type { PlanPagedSourceValue } from "./use-plan-paging.js";
import { usePlanPaging, PLAN_PAGE_SIZE, FAILED_BAND_MIN_PX, type PlanViewport } from "./use-plan-paging.js";

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

describe("paging driver — a far scrollbar position rebases (#612)", () => {
    test("a band report carrying a deep pixel offset rebases to the window under the thumb", async () => {
        const { value, asked } = source(250);            // 50,000 elements
        render(<Harness src={value} />);
        await waitFor(() => expect(text("resident")).toBe("0-600"));
        const before = new Set(asked);

        // The geometry after first paint: three measured windows (2 rows ×
        // 32px = 64px each), then 1px-per-element slots — so the tail band's
        // windows sit 200px apart. A drag 147¼ windows into the band puts the
        // viewport center over window 150.
        report({ kind: "band", at: "tail", px: 147 * 200 + 50 });

        await waitFor(() => {
            const [from, to] = text("resident").split("-").map(Number) as [number, number];
            expect(from).toBeLessThanOrEqual(150 * PLAN_PAGE_SIZE);
            expect(to).toBeGreaterThan(150 * PLAN_PAGE_SIZE);
        });
        // The destination ring was fetched; the ~146 windows in between were
        // NOT — the precise behaviour the module header promises.
        const newly = [...new Set(asked.filter((w) => !before.has(w)))].sort((a, b) => a - b);
        expect(newly.length).toBeLessThanOrEqual(4);
        for (const w of newly) expect(w).toBeGreaterThanOrEqual(148);
        // Everything skipped reads as ONE head band.
        expect(text("head")).toMatch(/^0-/);
    });

    test("a shallow offset still walks one window at a time — no rebase at the band's edge", async () => {
        const { value, asked } = source(50);
        render(<Harness src={value} />);
        await waitFor(() => expect(text("resident")).toBe("0-600"));

        report({ kind: "band", at: "tail", px: 10 });    // barely into the band
        // The run EXTENDS to the demand ring around the adjacent window —
        // the head never leaves the top of the source.
        await waitFor(() => expect(text("resident")).toBe("0-1200"));
        expect(text("head")).toBe("-");
        expect([...new Set(asked)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    });
});

describe("paging driver — pins and totals (#614)", () => {
    test("a landed jump's pin is RELEASED — the target window is evictable again", async () => {
        const { value } = source(250, 100);
        render(<Harness src={value} />);
        await waitFor(() => expect(latest?.resident).toBeDefined());

        act(() => { latest?.jumpToElement(40_000); });
        await waitFor(() => {
            const [from] = text("resident").split("-").map(Number) as [number, number];
            expect(from).toBeGreaterThanOrEqual(39_800);
        });

        // Walk far past the target. The pin protected window 200 only until
        // it LANDED; leaked, it would block the head trim there forever and
        // the run's floor would freeze at element 40,000 for the session.
        for (let i = 0; i < 60; i++) report({ kind: "band", at: "tail" });
        const [from] = text("resident").split("-").map(Number) as [number, number];
        expect(from).toBeGreaterThan(40_000);
    });

    test("a total() change under ONE id warns and drops the cached windows", async () => {
        // The contract says same id ⇒ same rows — this source violates it,
        // which must be LOUD (the author's derived source needs a signed id)
        // and must not leave the old rows serving against the new geometry.
        const asked: number[] = [];
        let total = 800n;                                     // 4 windows
        const value = {
            id: "drift-test",
            page: (offset: bigint) => {
                const w = Number(offset) / PLAN_PAGE_SIZE;
                asked.push(w);
                const rows = new Map<string, PlanRowValue>();
                rows.set(`w${w}`, { key: `w${w}`, parent: none } as unknown as PlanRowValue);
                return some(rows);
            },
            total: () => some(total),
            seek: none,
        } as unknown as PlanPagedSourceValue;
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        render(<Harness src={value} />);
        await waitFor(() => expect(text("rows")).toContain("w0"));

        total = 1_600n;
        report({ kind: "band", at: "tail" });                 // any re-evaluation
        await waitFor(() => expect(warn).toHaveBeenCalled());
        expect(String(warn.mock.calls[0]![0])).toMatch(/changed total\(\)/);
        // The read-once cache went with the geometry: a window read before
        // the flip is ASKED AGAIN when the run returns to it, rather than
        // served stale against the new extent. (With the cache kept, no
        // window is ever asked twice — read-once is the cache's contract.)
        await waitFor(() => {
            const counts = new Map<number, number>();
            for (const w of asked) counts.set(w, (counts.get(w) ?? 0) + 1);
            expect([...counts.values()].some((n) => n > 1)).toBe(true);
        });
        warn.mockRestore();
    });
});

describe("paging driver — a pending jump owns the viewport (#812)", () => {
    /** Windows from 100 on stay IN FLIGHT until `open`, and window `broken`
     *  throws — a far jump's target arrives (or fails) when the test says. */
    function held(windows: number, broken?: number) {
        const state = { open: false };
        const value = {
            id: "held-driver",
            page: (offset: bigint) => {
                const w = Number(offset) / PLAN_PAGE_SIZE;
                if (w === broken) throw new Error("fetch failed: 503");
                if (w >= 100 && !state.open) return none;
                const pad = String(w).padStart(4, "0");
                return some(new Map([`w${pad}r000`, `w${pad}r001`].map((key) =>
                    [key, { key, parent: none } as unknown as PlanRowValue])));
            },
            total: () => some(BigInt(windows * PLAN_PAGE_SIZE)),
            seek: none,
        } as unknown as PlanPagedSourceValue;
        return { value, state };
    }

    test("a report taken before the jump lands does not undo it", async () => {
        const { value, state } = held(250);
        const { rerender } = render(<Harness src={value} />);
        await waitFor(() => expect(text("resident")).toBe("0-600"));

        act(() => { latest?.jumpToElement(40_000); });
        await act(async () => { await Promise.resolve(); });
        // The canvas cannot scroll to a row that has not landed, so it reports
        // where it still is — the top, now over the head band. Honoured, that
        // rebased the run back to window 0 and the jump never arrived.
        report({ kind: "band", at: "head", px: 10 });
        await act(async () => { await Promise.resolve(); });
        expect(text("resident")).toBe("-");

        // The target lands (an equivalent source re-runs the read).
        state.open = true;
        rerender(<Harness src={{ ...value }} />);
        await waitFor(() => {
            const [from, to] = text("resident").split("-").map(Number) as [number, number];
            expect(from).toBeLessThanOrEqual(40_000);
            expect(to).toBeGreaterThan(40_000);
        });
        // Landed, the pin drops and reports move the demand again.
        report({ kind: "band", at: "head", px: 10 });
        await waitFor(() => expect(text("resident")).toMatch(/^0-/));
    });

    test("a jump whose window FAILS hands the viewport back", async () => {
        const { value, state } = held(250, 200);
        state.open = true;
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            render(<Harness src={value} />);
            await waitFor(() => expect(text("resident")).toBe("0-600"));
            act(() => { latest?.jumpToElement(40_000); });
            await waitFor(() => expect(latest?.failures.map((f) => f.w)).toContain(200));
            // The target settled as a failure (#811): the jump is over, and a
            // report moves the demand — a pin that waited for a landing would
            // have frozen it there.
            report({ kind: "band", at: "head", px: 10 });
            await waitFor(() => expect(text("resident")).toMatch(/^0-/));
        } finally {
            err.mockRestore();
        }
    });
});

describe("paging driver — an unreadable source", () => {
    test("reports the reason — the SOURCE's for `total()`, and window 0's own failure (#811)", async () => {
        const boom = (): never => { throw new Error("no paging service"); };
        const bad = { id: "bad", page: boom, total: boom, seek: none } as unknown as PlanPagedSourceValue;
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            render(<Harness src={bad} />);
            await waitFor(() => expect(latest?.sourceError).toMatch(/no paging service/));
            // The bootstrap window failed as a WINDOW — a band with a reason,
            // floored to legible height since no geometry is known yet.
            expect(latest?.failures).toEqual([
                { w: 0, from: 0, to: PLAN_PAGE_SIZE - 1, px: FAILED_BAND_MIN_PX, error: "no paging service" },
            ]);
            expect(text("rows")).toBe("");
        } finally {
            err.mockRestore();
        }
    });
});

describe("paging driver — a failed window (#811)", () => {
    /** Window 1 throws while `failing` holds; the rest land (2 rows each). */
    function flaky(windows: number) {
        const asked: number[] = [];
        const state = { failing: true };
        const value = {
            id: "flaky-driver",
            page: (offset: bigint) => {
                const w = Number(offset) / PLAN_PAGE_SIZE;
                asked.push(w);
                if (w === 1 && state.failing) throw new Error("fetch failed: 503");
                const pad = String(w).padStart(4, "0");
                return some(new Map([`w${pad}r000`, `w${pad}r001`].map((key) =>
                    [key, { key, parent: none } as unknown as PlanRowValue])));
            },
            total: () => some(BigInt(windows * PLAN_PAGE_SIZE)),
            seek: none,
        } as unknown as PlanPagedSourceValue;
        return { value, asked, state };
    }

    test("the failure is reported at its window's ledger slot; its neighbours land", async () => {
        const { value } = flaky(50);
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            render(<Harness src={value} />);
            await waitFor(() => expect(latest?.failures.map((f) => f.w)).toEqual([1]));
            await waitFor(() => expect(text("rows")).toContain("w0002r000"));
            expect(text("rows")).toContain("w0000r000");
            expect(text("rows")).not.toContain("w0001");
            const f = latest!.failures[0]!;
            expect(f).toMatchObject({ from: 200, to: 399, error: "fetch failed: 503" });
            // The band IS window 1's ledger slot: window 0 measured 2 rows ×
            // 32px over 200 elements, and the frozen slot rate floors at 1px
            // per element — 200px, above the legibility floor.
            expect(f.px).toBe(200);
            expect(f.px).toBeGreaterThan(FAILED_BAND_MIN_PX);
        } finally {
            err.mockRestore();
        }
    });

    test("the failed window is not re-asked on its own; Retry asks it again and lands its rows", async () => {
        const { value, asked, state } = flaky(50);
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const { rerender } = render(<Harness src={value} />);
            await waitFor(() => expect(latest?.failures.map((f) => f.w)).toEqual([1]));
            const askedBefore = asked.filter((w) => w === 1).length;
            // Another evaluation — an equivalent rebuilt source re-runs the
            // read — does not hammer the failed window.
            rerender(<Harness src={{ ...value }} />);
            await act(async () => { await Promise.resolve(); });
            expect(latest?.failures.map((f) => f.w)).toEqual([1]);
            expect(asked.filter((w) => w === 1).length).toBe(askedBefore);

            state.failing = false;
            act(() => { latest!.retry(1); });
            await waitFor(() => expect(text("rows")).toContain("w0001r000"));
            expect(latest?.failures).toEqual([]);
            expect(asked.filter((w) => w === 1).length).toBe(askedBefore + 1);
        } finally {
            err.mockRestore();
        }
    });

    test("a failed window's band names its window as the viewport", async () => {
        const { value } = flaky(50);
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            render(<Harness src={value} />);
            await waitFor(() => expect(latest?.failures.map((f) => f.w)).toEqual([1]));
            // Over the failed band the demand centres on window 1 — the ring
            // [0, 3] — rather than wherever the last row report left it.
            report({ kind: "window", w: 1 });
            await waitFor(() => expect(text("resident")).toBe("0-800"));
        } finally {
            err.mockRestore();
        }
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

    test("a NEW page function under the SAME id re-reads its resident windows (#809)", async () => {
        const { rerender } = render(<Harness src={labelled("ops", "before")} />);
        await waitFor(() => expect(text("rows")).toContain("before-w0"));

        // What a pick toggle does: the Reactive re-runs and the Plan rebuilds
        // its `page` (the series list inside it changed), but the underlying
        // handle's id is the author's and does not move. The cache belongs to
        // the source that filled it, and this one is not equivalent — so the
        // resident window is read again instead of served stale.
        rerender(<Harness src={labelled("ops", "after")} />);
        await waitFor(() => expect(text("rows")).toContain("after-w0"));
        expect(text("rows")).not.toContain("before-w0");
    });

    test("an EQUIVALENT rebuilt source keeps the cache — no window is read twice", async () => {
        const { value, asked } = source(50);
        const { rerender } = render(<Harness src={value} />);
        await waitFor(() => expect(text("resident")).toBe("0-600"));
        const before = [...asked];

        // A fresh struct over the same functions — what an unrelated root
        // change hands the driver. Equivalent, so nothing is re-read.
        rerender(<Harness src={{ ...value }} />);
        await act(async () => { await Promise.resolve(); });
        expect(asked).toEqual(before);
        expect(text("resident")).toBe("0-600");
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
