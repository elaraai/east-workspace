/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The paged sheet's driver (Sheet Spec §3.13, §5 row 21): the resident run
 * is contiguous from the top, the tail band describes the rest, exhaustion
 * arrives with the last window, an unreadable source reports why, a new
 * revision keeps the rows on screen until its own land (#851), and a failure
 * belongs to its window (#853).
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";
import { some, none, variant } from "@elaraai/east";
import { useSheetPaging, SHEET_PAGE_SIZE, type SheetViewport } from "./paging.js";
import type { SheetPagedSourceValue, SheetRowValue } from "./values.js";

afterEach(cleanup);

/** What a source's reads throw, while they do (#853) — the test moves them between renders. */
interface Faults {
    /** Why a window's read throws, by window. */
    windows: Map<number, string>;
    /** Why `total()` throws. */
    total?: string | undefined;
}

/** A synchronous positional source of `total` rows. Records which windows were asked for; the windows in `inFlight` stay on the wire while they are in it. */
function source(total: number, opts: { holdWindow?: number; faults?: Faults; inFlight?: Set<number> } = {}) {
    const asked: number[] = [];
    const value = {
        id: `sheet-driver-${total}`,
        page: (offset: bigint, limit: bigint) => {
            const w = Number(offset) / SHEET_PAGE_SIZE;
            asked.push(w);
            const fault = opts.faults?.windows.get(w);
            if (fault !== undefined) throw new Error(fault);
            if (opts.holdWindow === w || opts.inFlight?.has(w) === true) return none;
            const rows: SheetRowValue[] = [];
            for (let i = Number(offset); i < Math.min(total, Number(offset) + Number(limit)); i++) {
                rows.push({ id: `r${String(i).padStart(5, "0")}`, owned: false, cells: new Map(), lines: [], band: none, subRows: [] });
            }
            return some(rows);
        },
        total: () => {
            if (opts.faults?.total !== undefined) throw new Error(opts.faults.total);
            return some(BigInt(total));
        },
        seek: none,
    } as unknown as SheetPagedSourceValue;
    return { value, asked };
}

let latest: ReturnType<typeof useSheetPaging> | undefined;
/** Every render's resident row count — what an empty frame would show as a 0. */
let frames: number[] = [];

function Harness({ src }: { src: SheetPagedSourceValue }) {
    const paging = useSheetPaging(src, 36);
    latest = paging;
    frames.push(paging.rows.length);
    return (
        <div>
            <span data-testid="rows">{`${paging.rowsOffset}+${paging.rows.length}`}</span>
            <span data-testid="head">{paging.head ? `${paging.head.from}-${paging.head.to}` : "-"}</span>
            <span data-testid="tail">{paging.tail ? `${paging.tail.from}-${paging.tail.to}` : "-"}</span>
            <span data-testid="exhausted">{String(paging.exhausted)}</span>
        </div>
    );
}

const text = (id: string): string => screen.getByTestId(id).textContent ?? "";
const report = (at: SheetViewport, scrolling = false): void => {
    act(() => { latest?.reportViewport(at, scrolling); });
};

describe("sheet paging — first paint", () => {
    test("the run starts at the top, the rest is one tail band, nothing is exhausted", async () => {
        const { value, asked } = source(2_000);
        render(<Harness src={value} />);
        await waitFor(() => expect(text("rows")).toBe("0+600"));
        expect(text("head")).toBe("-");
        expect(text("tail")).toBe("600-1999");
        expect(text("exhausted")).toBe("false");
        expect([...new Set(asked)].sort((a, b) => a - b)).toEqual([0, 1, 2]);
        // The tail band's geometry: 1,400 unvisited elements at the seeded slot rate (36 px).
        expect(latest?.tail?.px).toBe(1_400 * 36);
    });

    test("a small source is exhausted once its windows land", async () => {
        const { value } = source(450);
        render(<Harness src={value} />);
        await waitFor(() => expect(text("exhausted")).toBe("true"));
        expect(text("rows")).toBe("0+450");
        expect(text("tail")).toBe("-");
        expect(latest?.total).toBe(450);
    });

    test("a window still in flight stops the run — the row space never carries a hole", async () => {
        const { value } = source(1_000, { holdWindow: 1 });
        render(<Harness src={value} />);
        await waitFor(() => expect(text("rows")).toBe("0+200"));
        expect(text("tail")).toBe("200-999");
        expect(latest?.loading).toBe(true);
        expect(text("exhausted")).toBe("false");
    });
});

describe("sheet paging — moving", () => {
    test("reporting the tail band walks the run forward one window per commit", async () => {
        const { value } = source(2_000);
        render(<Harness src={value} />);
        await waitFor(() => expect(text("rows")).toBe("0+600"));
        report({ kind: "band", at: "tail" });
        await waitFor(() => expect(text("rows")).not.toBe("0+600"));
        expect(text("rows").startsWith("0+") || text("rows").startsWith("200+")).toBe(true);
    });

    test("a jump rebases — the windows in between are never asked for", async () => {
        const { value, asked } = source(50_000);
        render(<Harness src={value} />);
        await waitFor(() => expect(text("rows")).toBe("0+600"));
        const before = new Set(asked);
        act(() => { latest?.jumpToElement(40_000); });
        await waitFor(() => expect(latest?.rowsOffset).toBeGreaterThanOrEqual(39_800));
        expect(text("head")).toMatch(/^0-/);
        for (const w of asked.filter((x) => !before.has(x))) expect(w).toBeGreaterThanOrEqual(199);
    });

    test("a pending jump owns the viewport: a report from the old place neither before nor after its window lands undoes it — only once the sheet hands it back (#854)", async () => {
        const inFlight = new Set([200]);
        const { value, asked } = source(50_000, { inFlight });
        const { rerender } = render(<Harness src={value} />);
        await waitFor(() => expect(text("rows")).toBe("0+600"));
        act(() => { latest!.jumpToElement(40_000); });
        await waitFor(() => expect(asked).toContain(200));
        expect(latest!.jump).toEqual({ window: 200, settled: false });
        // The sheet cannot scroll to rows that have not landed, so it reports
        // where it still is — the top, now over the head band. Honoured, that
        // moved the run back to window 0 and the jump never arrived.
        // (The run keeps one window behind the target: it starts at 39,800.)
        report({ kind: "band", at: "head", px: 10 });
        expect(latest!.rowsOffset).toBe(39_800);
        expect(text("head")).toBe("0-39799");
        // The target lands, but is not shown yet: the render that puts its rows
        // on screen still reports from the old place — that must not undo it either.
        inFlight.delete(200);
        rerender(<Harness src={{ ...value }} />);
        await waitFor(() => expect(latest!.jump).toEqual({ window: 200, settled: true }));
        report({ kind: "band", at: "head", px: 10 });
        expect(latest!.rowsOffset).toBe(39_800);
        expect(latest!.positions).toContain(40_000);
        // Shown, the sheet hands the viewport back and reports move the demand again.
        act(() => { latest!.clearJump(); });
        expect(latest!.jump).toBeUndefined();
        report({ kind: "band", at: "head", px: 10 });
        await waitFor(() => expect(latest!.rowsOffset).toBe(0));
    });

    test("a jump settles only once every window up to its target is in: the target landing with the window above it still on the wire keeps it pending (#854)", async () => {
        const inFlight = new Set([199, 200]);
        const { value, asked } = source(50_000, { inFlight });
        const { rerender } = render(<Harness src={value} />);
        await waitFor(() => expect(text("rows")).toBe("0+600"));
        act(() => { latest!.jumpToElement(40_000); });
        await waitFor(() => expect(asked).toContain(202));
        // The target lands; the window above it (the run's first) has not.
        inFlight.delete(200);
        rerender(<Harness src={{ ...value }} />);
        await waitFor(() => expect(asked.filter((w) => w === 200).length).toBeGreaterThanOrEqual(2));
        expect(latest!.jump).toEqual({ window: 200, settled: false });
        inFlight.delete(199);
        rerender(<Harness src={{ ...value }} />);
        await waitFor(() => expect(latest!.jump).toEqual({ window: 200, settled: true }));
        expect(latest!.positions).toContain(40_000);
    });
});

describe("sheet paging — an unreadable source", () => {
    test("reports the reason instead of an empty sheet", async () => {
        const boom = (): never => { throw new Error("no paging service"); };
        const bad = { id: "bad", page: boom, total: boom, seek: none } as unknown as SheetPagedSourceValue;
        render(<Harness src={bad} />);
        await waitFor(() => expect(latest?.error).toMatch(/no paging service/));
        expect(text("rows")).toBe("0+0");
    });
});


describe("sheet paging — content revisions", () => {
    test("a same-size update replaces resident rows without changing source identity", async () => {
        const base = source(450);
        const { rerender } = render(<Harness src={{ ...base.value, revision: () => some("A") }} />);
        await waitFor(() => expect(latest?.exhausted).toBe(true));
        expect(latest!.rows[0]!.id).toBe("r00000");
        const oldVersion = latest!.sizeVersion;
        const page: SheetPagedSourceValue["page"] = (offset, limit) => {
            const window = base.value.page(offset, limit);
            return window.type === "none" ? none : some(window.value.map(row => ({ ...row, id: `updated-${row.id}` })));
        };
        rerender(<Harness src={{ ...base.value, page, revision: () => some("B") }} />);
        await waitFor(() => expect(latest!.rows[0]!.id).toBe("updated-r00000"));
        expect(latest!.rows).toHaveLength(450);
        // The rows are the same height: the geometry holds, nothing re-measures (#851).
        expect(latest!.sizeVersion).toBe(oldVersion);
    });
});

/** A source whose content has revisions (#851). It serves `state.revision` —
 *  or names none while it is not `known`, as a source does while it
 *  discovers one — whose windows and total are in flight until it is `open`;
 *  every row names the revision that served it in its `rev` cell. The
 *  functions are fixed, so `{ ...value }` is the same source, re-read. */
function revisioned(total: number) {
    const state = { revision: "A", known: true, open: new Set(["A"]), totals: new Map([["A", total]]) };
    const size = () => state.totals.get(state.revision) ?? total;
    const value = {
        id: "sheet-revisioned",
        page: (offset: bigint, limit: bigint) => {
            if (!state.open.has(state.revision)) return none;
            const rows: SheetRowValue[] = [];
            for (let i = Number(offset); i < Math.min(size(), Number(offset) + Number(limit)); i++) {
                rows.push({ id: `r${String(i).padStart(5, "0")}`, owned: false, cells: new Map([["rev", variant("String", state.revision)]]), lines: [], band: none, subRows: [] } as SheetRowValue);
            }
            return some(rows);
        },
        total: () => (state.open.has(state.revision) ? some(BigInt(size())) : none),
        seek: none,
        revision: () => (state.known ? some(state.revision) : none),
        refresh: () => null,
    } as unknown as SheetPagedSourceValue;
    return { value, state };
}

const revOf = (row: SheetRowValue): unknown => row.cells.get("rev")?.value;

describe("sheet paging — a new revision keeps the rows (#851)", () => {
    test("the old rows stand in until the new revision's windows land — never an empty frame — and the geometry holds", async () => {
        const { value, state } = revisioned(2_000);
        const { rerender } = render(<Harness src={value} />);
        await waitFor(() => expect(text("rows")).toBe("0+600"));
        const before = { first: latest!.rows[0], tail: latest!.tail, sizeVersion: latest!.sizeVersion };
        frames = [];
        // The dataset is written: the source serves revision B, whose windows
        // and total are still on the wire.
        state.revision = "B";
        rerender(<Harness src={{ ...value }} />);
        expect(text("rows")).toBe("0+600");
        expect(latest!.rows[0]).toBe(before.first);
        expect(latest!.loading).toBe(true);
        expect(latest!.total).toBe(2_000);
        expect(latest!.tail).toEqual(before.tail);
        expect(latest!.exhausted).toBe(false);
        // B lands: every row takes B's content, in the same place.
        state.open.add("B");
        rerender(<Harness src={{ ...value }} />);
        await waitFor(() => expect(revOf(latest!.rows[0]!)).toBe("B"));
        expect(text("rows")).toBe("0+600");
        expect(latest!.rows.every((row) => revOf(row) === "B")).toBe(true);
        expect(latest!.rows[0]!.id).toBe(before.first!.id);
        expect(latest!.loading).toBe(false);
        expect(latest!.tail).toEqual(before.tail);
        expect(latest!.sizeVersion).toBe(before.sizeVersion);
        // No render between the two showed an empty sheet.
        expect(frames.length).toBeGreaterThan(0);
        expect(frames.every((n) => n === 600)).toBe(true);
    });

    test("a revision the source is still discovering keeps the last rows standing in", async () => {
        const { value, state } = revisioned(450);
        const { rerender } = render(<Harness src={value} />);
        await waitFor(() => expect(latest?.exhausted).toBe(true));
        const first = latest!.rows[0];
        // A refresh: the source names no revision yet, then names B — its
        // windows still in flight throughout.
        state.known = false;
        state.revision = "B";
        rerender(<Harness src={{ ...value }} />);
        expect(latest!.rows[0]).toBe(first);
        expect(latest!.exhausted).toBe(true);
        state.known = true;
        rerender(<Harness src={{ ...value }} />);
        expect(latest!.rows[0]).toBe(first);
        expect(latest!.loading).toBe(true);
        state.open.add("B");
        rerender(<Harness src={{ ...value }} />);
        await waitFor(() => expect(revOf(latest!.rows[0]!)).toBe("B"));
        expect(latest!.rows).toHaveLength(450);
    });

    test("a total that moves WITH the revision is the content changing: the geometry rebuilds, and nothing is reported", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const { value, state } = revisioned(2_000);
            const { rerender } = render(<Harness src={value} />);
            await waitFor(() => expect(text("rows")).toBe("0+600"));
            const sizeVersion = latest!.sizeVersion;
            state.revision = "C";
            state.totals.set("C", 2_400);
            state.open.add("C");
            rerender(<Harness src={{ ...value }} />);
            await waitFor(() => expect(latest!.total).toBe(2_400));
            expect(text("tail")).toBe("600-2399");
            expect(latest!.sizeVersion).toBeGreaterThan(sizeVersion);
            expect(warn).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });

    test("a total that moves under ONE revision breaks the source's contract: it is reported", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const { value, state } = revisioned(2_000);
            const { rerender } = render(<Harness src={value} />);
            await waitFor(() => expect(text("rows")).toBe("0+600"));
            state.totals.set("A", 2_400);
            rerender(<Harness src={{ ...value }} />);
            await waitFor(() => expect(latest!.total).toBe(2_400));
            expect(warn).toHaveBeenCalledWith(expect.stringMatching(/changed total\(\) without a revision change/));
        } finally {
            warn.mockRestore();
        }
    });
});

describe("sheet paging — a failure belongs to its window (#853)", () => {
    test("a window whose read throws is recorded against it: the run crosses it, the rows after it keep their positions, and only a retry asks it again", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const faults: Faults = { windows: new Map([[1, "gateway timeout"]]) };
            const { value, asked } = source(1_000, { faults });
            const { rerender } = render(<Harness src={value} />);
            await waitFor(() => expect(latest!.failures).toHaveLength(1));
            // Its band sits where its rows would be, sized by the ledger's slot for it.
            expect(latest!.failures[0]).toEqual({ w: 1, from: 200, to: 399, px: 200 * 36, error: "gateway timeout" });
            // Windows 0 and 2 are resident around it, each row at its own place in the source.
            expect(latest!.rows).toHaveLength(400);
            expect(latest!.positions[199]).toBe(199);
            expect(latest!.positions[200]).toBe(400);
            expect(latest!.rows[200]!.id).toBe("r00400");
            // It is neither in flight nor the sheet's failure: something landed.
            expect(latest!.loading).toBe(false);
            expect(latest!.error).toBeUndefined();
            expect(latest!.sourceError).toBeUndefined();
            expect(text("tail")).toBe("600-999");
            // The source recovers, and the rows are read again: a failed window is not asked by the reader.
            const asks = asked.filter((w) => w === 1).length;
            faults.windows.clear();
            rerender(<Harness src={{ ...value }} />);
            expect(asked.filter((w) => w === 1)).toHaveLength(asks);
            expect(latest!.failures).toHaveLength(1);
            // A retry of that window asks it once more, and it lands in place.
            act(() => { latest!.retry(1); });
            await waitFor(() => expect(latest!.failures).toHaveLength(0));
            expect(asked.filter((w) => w === 1)).toHaveLength(asks + 1);
            expect(latest!.rows).toHaveLength(600);
            expect(latest!.positions[200]).toBe(200);
            expect(latest!.rows[200]!.id).toBe("r00200");
        } finally {
            logged.mockRestore();
        }
    });

    test("a total() that throws is the source's failure beside its rows, and the count this revision last gave stands", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const faults: Faults = { windows: new Map() };
            const { value } = source(450, { faults });
            const { rerender } = render(<Harness src={value} />);
            await waitFor(() => expect(latest!.exhausted).toBe(true));
            const sizeVersion = latest!.sizeVersion;
            faults.total = "count unavailable";
            rerender(<Harness src={{ ...value }} />);
            expect(latest!.sourceError).toBe("count unavailable");
            expect(latest!.error).toBeUndefined();
            // Nothing else moves: the rows, the count, exhaustion (so the blank tail), the geometry.
            expect(latest!.rows).toHaveLength(450);
            expect(latest!.total).toBe(450);
            expect(latest!.exhausted).toBe(true);
            expect(latest!.sizeVersion).toBe(sizeVersion);
            // A retry asks the source again.
            faults.total = undefined;
            act(() => { latest!.retry(); });
            await waitFor(() => expect(latest!.sourceError).toBeUndefined());
            expect(latest!.total).toBe(450);
        } finally {
            logged.mockRestore();
        }
    });

    test("a jump whose window FAILS settles as that failure — and its report is still ignored until the sheet hands the viewport back (#854)", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const faults: Faults = { windows: new Map([[200, "fetch failed: 503"]]) };
            const { value } = source(50_000, { faults });
            render(<Harness src={value} />);
            await waitFor(() => expect(text("rows")).toBe("0+600"));
            act(() => { latest!.jumpToElement(40_000); });
            await waitFor(() => expect(latest!.jump).toEqual({ window: 200, settled: true }));
            expect(latest!.failures.map((f) => f.w)).toContain(200);
            report({ kind: "band", at: "head", px: 10 });
            expect(latest!.rowsOffset).toBeGreaterThanOrEqual(199 * SHEET_PAGE_SIZE);
            // Handed back, the reports move the demand again.
            act(() => { latest!.clearJump(); });
            expect(latest!.jump).toBeUndefined();
            report({ kind: "band", at: "head", px: 10 });
            await waitFor(() => expect(latest!.rowsOffset).toBe(0));
        } finally {
            logged.mockRestore();
        }
    });

    test("before anything lands a failure is the whole sheet's, and a retry asks the source and every failed window again", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const faults: Faults = { windows: new Map([[0, "no route"], [1, "no route"], [2, "no route"]]) };
            const { value } = source(450, { faults });
            render(<Harness src={value} />);
            await waitFor(() => expect(latest!.error).toBe("no route"));
            expect(latest!.rows).toHaveLength(0);
            // The windows stay recorded: the reader does not hammer a failing source.
            expect(latest!.loading).toBe(false);
            faults.windows.clear();
            act(() => { latest!.retry(); });
            await waitFor(() => expect(latest!.exhausted).toBe(true));
            expect(latest!.error).toBeUndefined();
            expect(latest!.failures).toHaveLength(0);
            expect(latest!.rows).toHaveLength(450);
        } finally {
            logged.mockRestore();
        }
    });
});
