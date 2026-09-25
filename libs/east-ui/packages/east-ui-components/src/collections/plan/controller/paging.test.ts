/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The paging driver (#577), framework-free (#815) — the loop between where the
 * viewport is and which windows are resident.
 *
 * The behaviours that matter to a user are all here: the canvas starts at the
 * top with the rest of the source described by a band, scrolling walks the run
 * forward, a jump REBASES instead of loading everything in between, the run
 * stays bounded however far you go, and every input settles in ONE
 * notification. (These scenarios drove the React hook until #815; the driver is
 * plain state now, so they need no renderer and no waiting.) A canvas is its
 * blocks (#823): one read of a window serves every block, and each paged block
 * pages on its own.
 */

import { describe, test, expect, vi } from "vitest";
import { some, none, variant } from "@elaraai/east";
import {
    GROUP_H, ROW_H, indexRows, restUi, rowHeight, skeletonHeight, visibleRows, windowSkeleton,
    type PlanRowValue, type PlanWireBlock, type PlanWireRow, type WindowSkeleton,
} from "../model.js";
import { PLAN_PAGE_SIZE, FAILED_BAND_MIN_PX, type PlanPagedSourceValue, type PlanViewport } from "../use-plan-paging.js";
import { createPagingDriver, type PagingDriverOptions, type PlanPagingSnapshot } from "./paging.js";
import { rowId, rowKey, testKeyOf } from "../plan.test-utils.js";

const ROW_PX = 32;

/** One paged block's rows (#823) — a data series' share of a window. */
function paged(rows: PlanWireRow[], parent?: string): PlanWireBlock {
    return { fixed: false, parent: parent !== undefined ? some(rowId(parent)) : none, rows } as unknown as PlanWireBlock;
}

/** A fixed block — rows no entry produces, the same in every window. */
function fixed(rows: PlanWireRow[]): PlanWireBlock {
    return { fixed: true, parent: none, rows } as unknown as PlanWireBlock;
}

/** A skeleton carrying what these tests measure by — a row count. The model's
 *  own skeletons are tested with the model; the driver only keeps them. */
function countSkeleton(rows: readonly PlanRowValue[]): WindowSkeleton {
    return {
        keys: rows.map((r) => r.key), parents: rows.map(() => -1), top: rows.map(() => true),
        pinned: rows.map(() => false), declared: rows.map(() => false), facts: [],
    };
}

/** Every row at {@link ROW_PX}, whatever the UI state. */
const measure: Pick<PagingDriverOptions, "skeletonOf" | "heightOf" | "restHeightOf"> = {
    skeletonOf: countSkeleton,
    heightOf: (sk) => sk.keys.length * ROW_PX,
    restHeightOf: (sk) => sk.keys.length * ROW_PX,
};

/** A wire row carrying what the driver reads — its id (#822), no parent, and
 *  anything else a test tags it with. */
function wire(key: string, extra?: Record<string, unknown>): PlanWireRow {
    return { id: rowId(key), parent: none, ...extra } as unknown as PlanWireRow;
}

/** The resident rows' test keys, in stream order. */
const rowKeys = (s: PlanPagingSnapshot) => s.rows.map((r) => testKeyOf(r.key));

/** A synchronous source of `windows` windows, `rowsPer` rows each, named by
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
            const rows: PlanWireRow[] = [];
            for (let i = 0; i < rowsPer; i++) rows.push(wire(`w${pad}r${String(i).padStart(3, "0")}`));
            return some([paged(rows)]);
        },
        total: () => some(BigInt(windows * PLAN_PAGE_SIZE)),
        seek: none,
        revision: () => none,
        refresh: () => null,
    } as unknown as PlanPagedSourceValue;
    return { value, asked };
}

/** A driver over `src`, with a count of its notifications. */
function drive(src: PlanPagedSourceValue, heights: Pick<PagingDriverOptions, "skeletonOf" | "heightOf" | "restHeightOf"> = measure) {
    let notified = 0;
    const d = createPagingDriver({ ...heights, onChange: () => { notified += 1; } });
    d.setSource(src);
    return {
        d,
        snap: (): PlanPagingSnapshot => d.getSnapshot(),
        notified: () => notified,
        report: (at: PlanViewport, scrolling = false) => d.reportViewport(at, scrolling),
    };
}

const residentText = (s: PlanPagingSnapshot) => (s.resident ? `${s.resident.from}-${s.resident.to}` : "-");
const bandText = (b: { from: number; to: number } | undefined) => (b ? `${b.from}-${b.to}` : "-");
const span = (s: PlanPagingSnapshot) => residentText(s).split("-").map(Number) as [number, number];
/** A block's head / tail band — block 0 unless named. */
const head = (s: PlanPagingSnapshot, block = 0) => s.blocks[block]?.head;
const tail = (s: PlanPagingSnapshot, block = 0) => s.blocks[block]?.tail;
/** A band report on a block's end — block 0 unless named. */
const band = (at: "head" | "tail", px?: number, block = 0): PlanViewport =>
    (px !== undefined ? { kind: "band", block, at, px } : { kind: "band", block, at });

describe("paging driver — first paint", () => {
    test("starts at the top and describes the rest of the source as a tail band", () => {
        const { snap } = drive(source(50).value);                // 10,000 elements
        // The demand settles at [0, ahead] — window 0 plus its prefetch ring.
        expect(residentText(snap())).toBe("0-600");
        expect(snap().rows).toHaveLength(6);
        expect(rowKeys(snap())[0]).toBe("w0000r000");
        // Nothing above the top, and everything below is one band.
        expect(bandText(head(snap()))).toBe("-");
        expect(bandText(tail(snap()))).toBe("600-9999");
    });

    test("only the demanded windows are ever asked for — each once — and the settle notifies ONCE", () => {
        const { value, asked } = source(50);
        const { notified } = drive(value);
        // Three windows, each asked once — not a walk of the whole source, and
        // not a re-read per step.
        expect([...asked].sort((a, b) => a - b)).toEqual([0, 1, 2]);
        // Bootstrap, total, three landings, the demand ring: one settle, one
        // notification (the hook took a render pass per step — #815).
        expect(notified()).toBe(1);
    });
});

describe("paging driver — scrolling", () => {
    test("reporting the tail band walks the run forward", () => {
        const { snap, report } = drive(source(50).value);
        report(band("tail"));
        const after = residentText(snap());
        expect(after).not.toBe("0-600");
        // The run extended rather than jumping — the head is still near the top.
        expect(after.startsWith("0-") || after.startsWith("200-")).toBe(true);
    });

    test("nothing is fetched while the gesture is still running", () => {
        const { value, asked } = source(50);
        const { report } = drive(value);
        const before = asked.length;
        // Mid-drag: the extent must not move under the cursor.
        report(band("tail"), true);
        expect(asked.length).toBe(before);
        // Released: demand resumes.
        report(band("tail"), false);
        expect(asked.length).toBeGreaterThan(before);
    });
});

describe("paging driver — a jump rebases", () => {
    test("jumping to element 40,000 does NOT load everything in between", () => {
        const { value, asked } = source(250);                   // 50,000 elements
        const { d, snap } = drive(value);
        const beforeJump = new Set(asked);
        d.jumpToElement(40_000);
        // The run rebases AROUND the target — the demand ring keeps one window
        // behind it, so the interval starts just before element 40,000.
        const [from, to] = span(snap());
        expect(from).toBeLessThanOrEqual(40_000);
        expect(to).toBeGreaterThan(40_000);
        // Everything before the run is now ONE band, not 199 loaded windows.
        expect(bandText(head(snap()))).toBe(`0-${from - 1}`);
        // And the windows in between were never asked for.
        for (const w of asked.filter((x) => !beforeJump.has(x))) expect(w).toBeGreaterThanOrEqual(199);
    });

    test("a NEAR jump extends the run — the windows it passes stay resident", () => {
        const { value, asked } = source(50);
        const { d, snap } = drive(value);
        // First paint holds [0, 2]; window 3 is adjacent — the run grows to it.
        d.jumpToElement(3 * PLAN_PAGE_SIZE);
        expect(span(snap())[0]).toBe(0);
        expect(span(snap())[1]).toBeGreaterThan(3 * PLAN_PAGE_SIZE);
        expect(asked).toContain(3);
    });

    test("opening at a window just past the prefetch ring REBASES — nothing in between is read (#813)", () => {
        const { value, asked } = source(50);
        const { d, snap } = drive(value);
        // First paint holds [0, 2]; window 6's ring is [5, 8] — near enough
        // that a jump would walk there, but reopening at a saved place is not
        // a scroll through the windows before it.
        const before = new Set(asked);
        d.openAt(6 * PLAN_PAGE_SIZE);
        const newly = [...new Set(asked.filter((w) => !before.has(w)))].sort((a, b) => a - b);
        expect(newly).toEqual([5, 6, 7, 8]);
        expect(residentText(snap())).toBe(`${5 * PLAN_PAGE_SIZE}-${9 * PLAN_PAGE_SIZE}`);
        expect(d.jumping()).toBe(true);
        d.committed(snap());
        expect(d.jumping()).toBe(false);
    });

    test("a jump past the end settles on the last window — its pin can drop", () => {
        const { d, snap } = drive(source(50).value);
        // An anchor saved against a longer source names a window this one lacks.
        d.jumpToElement(90 * PLAN_PAGE_SIZE);
        expect(span(snap())[1]).toBe(50 * PLAN_PAGE_SIZE);
        d.committed(snap());
        expect(d.jumping()).toBe(false);
    });

    test("after a jump the far end is released — the run stays bounded", () => {
        const { d, snap } = drive(source(250).value);
        d.jumpToElement(40_000);
        const [from, to] = span(snap());
        expect(from).toBeGreaterThan(30_000);
        // The window count resident is the demand span, not "everything ever
        // visited": the old run was dropped by the rebase.
        expect((to - from) / PLAN_PAGE_SIZE).toBeLessThanOrEqual(4);
    });
});

describe("paging driver — a far scrollbar position rebases (#612)", () => {
    test("a band report carrying a deep pixel offset rebases to the window under the thumb", () => {
        const { value, asked } = source(250);                   // 50,000 elements
        const { snap, report } = drive(value);
        const before = new Set(asked);
        // The geometry after first paint: three measured windows (2 rows ×
        // 32px = 64px each), then 1px-per-element slots — so the tail band's
        // windows sit 200px apart. A drag 147¼ windows into the band puts the
        // viewport center over window 150.
        report(band("tail", 147 * 200 + 50));
        const [from, to] = span(snap());
        expect(from).toBeLessThanOrEqual(150 * PLAN_PAGE_SIZE);
        expect(to).toBeGreaterThan(150 * PLAN_PAGE_SIZE);
        // The destination ring was fetched; the ~146 windows in between were NOT.
        const newly = [...new Set(asked.filter((w) => !before.has(w)))].sort((a, b) => a - b);
        expect(newly.length).toBeLessThanOrEqual(4);
        for (const w of newly) expect(w).toBeGreaterThanOrEqual(148);
        // Everything skipped reads as ONE head band.
        expect(bandText(head(snap()))).toMatch(/^0-/);
    });

    test("a shallow offset still walks one window at a time — no rebase at the band's edge", () => {
        const { value, asked } = source(50);
        const { snap, report } = drive(value);
        report(band("tail", 10));          // barely into the band
        // The run EXTENDS to the demand ring around the adjacent window — the
        // head never leaves the top of the source.
        expect(residentText(snap())).toBe("0-1200");
        expect(bandText(head(snap()))).toBe("-");
        expect([...new Set(asked)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    });
});

describe("paging driver — pins and totals (#614)", () => {
    test("a landed jump's pin is RELEASED — the target window is evictable again", () => {
        const { d, snap, report } = drive(source(250, 100).value);
        d.jumpToElement(40_000);
        expect(span(snap())[0]).toBeGreaterThanOrEqual(39_800);
        // The canvas shows the landing.
        d.committed(snap());
        // Walk far past the target. The pin protected window 200 only until it
        // LANDED and was shown; leaked, it would block the head trim there
        // forever.
        for (let i = 0; i < 60; i++) report(band("tail"));
        expect(span(snap())[0]).toBeGreaterThan(40_000);
    });

    test("a total() change under ONE id warns and drops the cached windows", () => {
        const asked: number[] = [];
        let total = 800n;                                        // 4 windows
        const value = {
            id: "drift-test",
            page: (offset: bigint) => {
                const w = Number(offset) / PLAN_PAGE_SIZE;
                asked.push(w);
                return some([paged([wire(`w${w}`)])]);
            },
            total: () => some(total),
            seek: none,
            revision: () => none,
            refresh: () => null,
        } as unknown as PlanPagedSourceValue;
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const { snap, report } = drive(value);
            expect(rowKeys(snap())).toContain("w0");
            total = 1_600n;
            report(band("tail"));                // any re-read
            expect(warn).toHaveBeenCalled();
            expect(String(warn.mock.calls[0]![0])).toMatch(/changed total\(\)/);
            // The read-once cache went with the geometry: a window read before
            // the flip is ASKED AGAIN, rather than served stale.
            const counts = new Map<number, number>();
            for (const w of asked) counts.set(w, (counts.get(w) ?? 0) + 1);
            expect([...counts.values()].some((n) => n > 1)).toBe(true);
        } finally {
            warn.mockRestore();
        }
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
                return some([paged([wire(`w${pad}r000`), wire(`w${pad}r001`)])]);
            },
            total: () => some(BigInt(windows * PLAN_PAGE_SIZE)),
            seek: none,
            revision: () => none,
            refresh: () => null,
        } as unknown as PlanPagedSourceValue;
        return { value, state };
    }

    test("a report taken before the jump lands does not undo it", () => {
        const { value, state } = held(250);
        const { d, snap, report } = drive(value);
        d.jumpToElement(40_000);
        // The canvas cannot scroll to a row that has not landed, so it reports
        // where it still is — the top, now over the head band. Honoured, that
        // rebased the run back to window 0 and the jump never arrived.
        report(band("head", 10));
        expect(residentText(snap())).toBe("-");
        expect(d.jumping()).toBe(true);
        // The target lands (an equivalent source re-runs the read).
        const beforeLanding = snap();
        state.open = true;
        d.setSource({ ...value });
        const [from, to] = span(snap());
        expect(from).toBeLessThanOrEqual(40_000);
        expect(to).toBeGreaterThan(40_000);
        // Landed but not yet SHOWN: the render that puts the rows on screen
        // reports from where the canvas still is — over the head band — before
        // it scrolls to the target. That report must not undo the jump either.
        expect(d.jumping()).toBe(true);
        report(band("head", 10));
        expect(span(snap())).toEqual([from, to]);
        // A commit of a render from BEFORE the landing hands nothing back.
        d.committed(beforeLanding);
        expect(d.jumping()).toBe(true);
        // Shown, the pin drops and reports move the demand again.
        d.committed(snap());
        expect(d.jumping()).toBe(false);
        report(band("head", 10));
        expect(residentText(snap())).toMatch(/^0-/);
    });

    test("a jump whose window FAILS hands the viewport back", () => {
        const { value, state } = held(250, 200);
        state.open = true;
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const { d, snap, report } = drive(value);
            d.jumpToElement(40_000);
            expect(snap().failures.map((f) => f.w)).toContain(200);
            // The target settled as a failure (#811): once the canvas shows the
            // failed band, the jump is over.
            d.committed(snap());
            expect(d.jumping()).toBe(false);
            report(band("head", 10));
            expect(residentText(snap())).toMatch(/^0-/);
        } finally {
            err.mockRestore();
        }
    });
});

describe("paging driver — an unreadable source", () => {
    test("reports the reason — the SOURCE's for `total()`, and window 0's own failure (#811)", () => {
        const boom = (): never => { throw new Error("no paging service"); };
        const bad = { id: "bad", page: boom, total: boom, seek: none, revision: () => none, refresh: () => null } as unknown as PlanPagedSourceValue;
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const { snap } = drive(bad);
            expect(snap().sourceError).toMatch(/no paging service/);
            // The bootstrap window failed as a WINDOW — a band with a reason,
            // floored to legible height since no geometry is known yet.
            expect(snap().failures).toEqual([
                { block: 0, w: 0, from: 0, to: PLAN_PAGE_SIZE - 1, px: FAILED_BAND_MIN_PX, error: "no paging service" },
            ]);
            expect(snap().rows).toEqual([]);
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
                return some([paged([wire(`w${pad}r000`), wire(`w${pad}r001`)])]);
            },
            total: () => some(BigInt(windows * PLAN_PAGE_SIZE)),
            seek: none,
            revision: () => none,
            refresh: () => null,
        } as unknown as PlanPagedSourceValue;
        return { value, asked, state };
    }

    test("the failure is reported at its window's ledger slot; its neighbours land", () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const { snap } = drive(flaky(50).value);
            expect(snap().failures.map((f) => f.w)).toEqual([1]);
            const keys = rowKeys(snap());
            expect(keys).toContain("w0002r000");
            expect(keys).toContain("w0000r000");
            expect(keys.some((k) => k.startsWith("w0001"))).toBe(false);
            const f = snap().failures[0]!;
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

    test("the failed window is not re-asked on its own; Retry asks it again and lands its rows", () => {
        const { value, asked, state } = flaky(50);
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const { d, snap } = drive(value);
            const askedBefore = asked.filter((w) => w === 1).length;
            // Another read — an equivalent rebuilt source — does not hammer the
            // failed window.
            d.setSource({ ...value });
            expect(snap().failures.map((f) => f.w)).toEqual([1]);
            expect(asked.filter((w) => w === 1).length).toBe(askedBefore);

            state.failing = false;
            d.retry(1);
            expect(rowKeys(snap())).toContain("w0001r000");
            expect(snap().failures).toEqual([]);
            expect(asked.filter((w) => w === 1).length).toBe(askedBefore + 1);
        } finally {
            err.mockRestore();
        }
    });

    test("a failed window's band names its window as the viewport", () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const { snap, report } = drive(flaky(50).value);
            // Over the failed band the demand centres on window 1 — the ring
            // [0, 3] — rather than wherever the last row report left it.
            report({ kind: "window", block: 0, w: 1 });
            expect(residentText(snap())).toBe("0-800");
        } finally {
            err.mockRestore();
        }
    });
});

describe("paging driver — bounded retention", () => {
    test("scrolling a 50,000-element source end to end keeps the resident rows under the cap", () => {
        // 250 windows of 100 rows is 25,000 rows if nothing is evicted; the
        // budget is 4,000.
        const { snap, report } = drive(source(250, 100).value);
        let peakRows = 0;
        // Walk the whole source the way a user does — one viewport step at a
        // time, always at the leading edge.
        for (let i = 0; i < 400; i++) {
            report(band("tail"));
            const r = snap().resident;
            if (r !== undefined) peakRows = Math.max(peakRows, ((r.to - r.from) / PLAN_PAGE_SIZE) * 100);
            if (tail(snap()) === undefined) break;                // reached the end
        }
        expect(peakRows).toBeLessThanOrEqual(4_000);
        // ...and we genuinely travelled — the run is nowhere near the top.
        expect(snap().resident!.from).toBeGreaterThan(10_000);
    });

    test("the head band grows as the run moves away from the top", () => {
        const { snap, report } = drive(source(250, 100).value);
        for (let i = 0; i < 60; i++) report(band("tail"));
        const above = head(snap());
        expect(above).toBeDefined();
        expect(above!.from).toBe(0);
        // Everything left behind is described by ONE band, not by rows.
        expect(above!.to).toBeGreaterThan(1_000);
        expect(above!.px).toBeGreaterThan(0);
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
                return some([paged([wire(`${label}-w${w}`)])]);
            },
            total: () => some(BigInt(PLAN_PAGE_SIZE)),
            seek: none,
            revision: () => none,
            refresh: () => null,
        } as unknown as PlanPagedSourceValue;
    }
    const keys = (s: PlanPagingSnapshot) => rowKeys(s).join(" ");

    test("a NEW page function under the SAME id re-reads its resident windows (#809)", () => {
        const { d, snap } = drive(labelled("ops", "before"));
        expect(keys(snap())).toContain("before-w0");
        // What a pick toggle does: the canvas rebuilds its `page` (the series
        // list inside it changed), but the author's id does not move. The cache
        // belongs to the source that filled it, and this one is not equivalent.
        d.setSource(labelled("ops", "after"));
        expect(keys(snap())).toContain("after-w0");
        expect(keys(snap())).not.toContain("before-w0");
    });

    test("an EQUIVALENT rebuilt source keeps the cache — no window is read twice, nothing is published", () => {
        const { value, asked } = source(50);
        const { d, snap, notified } = drive(value);
        const before = [...asked];
        const n = notified();
        // A fresh struct over the same functions — what an unrelated root change
        // hands the driver. Equivalent, so nothing is re-read or re-published.
        d.setSource({ ...value });
        expect(asked).toEqual(before);
        expect(residentText(snap())).toBe("0-600");
        expect(notified()).toBe(n);
    });

    test("moving the id re-reads — which is why a derived source must sign its id", () => {
        const { d, snap } = drive(labelled("ops#a", "before"));
        expect(keys(snap())).toContain("before-w0");
        d.setSource(labelled("ops#b", "after"));
        expect(keys(snap())).toContain("after-w0");
        expect(keys(snap())).not.toContain("before-w0");
    });
});

describe("paging driver — content revisions (#821)", () => {
    /** A source whose content has revisions. It serves `state.revision`; a
     *  revision's windows (and its total) are in flight until it is `open`, and
     *  every row carries the revision that served it. */
    function revisioned(windows: number) {
        const state = { revision: "A", open: new Set(["A"]), total: windows * PLAN_PAGE_SIZE };
        const value = {
            id: "revisioned",
            page: (offset: bigint) => {
                const w = Number(offset) / PLAN_PAGE_SIZE;
                if (!state.open.has(state.revision)) return none;
                const pad = String(w).padStart(4, "0");
                return some([paged([wire(`w${pad}r000`, { rev: state.revision }), wire(`w${pad}r001`, { rev: state.revision })])]);
            },
            total: () => (state.open.has(state.revision) ? some(BigInt(state.total)) : none),
            seek: none,
            revision: () => some(state.revision),
            refresh: () => null,
        } as unknown as PlanPagedSourceValue;
        return { value, state };
    }
    const revisionsShown = (s: PlanPagingSnapshot) => new Set(s.rows.map((r) => (r as unknown as { rev: string }).rev));

    test("a new revision keeps the old rows on screen until its own land — never an empty frame", () => {
        const { value, state } = revisioned(50);
        const { d, snap } = drive(value);
        expect(snap().revision).toBe("A");
        expect(revisionsShown(snap())).toEqual(new Set(["A"]));
        const shown = snap().rows.length;
        // The dataset was written: the source serves B, still in flight.
        state.revision = "B";
        d.refresh();
        expect(snap().revision).toBe("B");
        expect(snap().rows).toHaveLength(shown);
        expect(revisionsShown(snap())).toEqual(new Set(["A"]));
        expect(snap().loading).toBe(true);
        // The geometry stands meanwhile: no total, band or extent collapses.
        expect(snap().total).toBe(50 * PLAN_PAGE_SIZE);
        expect(bandText(tail(snap()))).toBe("600-9999");
        // B lands: every window swaps to its new rows, in place.
        state.open.add("B");
        d.refresh();
        expect(revisionsShown(snap())).toEqual(new Set(["B"]));
        expect(snap().rows).toHaveLength(shown);
        expect(snap().loading).toBe(false);
    });

    test("a revision that has not landed anywhere yet leaves the last rows standing through it", () => {
        const { value, state } = revisioned(50);
        const { d, snap } = drive(value);
        // A refresh in flight: the source names no revision for a moment,
        // then the new one, and nothing lands in between.
        state.revision = "?";
        d.refresh();
        state.revision = "C";
        d.refresh();
        expect(revisionsShown(snap())).toEqual(new Set(["A"]));
        state.open.add("C");
        d.refresh();
        expect(revisionsShown(snap())).toEqual(new Set(["C"]));
    });

    test("a total that moves WITH the revision rebuilds the geometry quietly — the viewport keeps its window", () => {
        const { value, state } = revisioned(250);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const { d, snap } = drive(value);
            d.jumpToElement(40_000);
            d.committed(snap());
            // Rows were appended: the content and its size moved together.
            state.revision = "B";
            state.total = 260 * PLAN_PAGE_SIZE;
            state.open.add("B");
            d.refresh();
            expect(warn).not.toHaveBeenCalled();
            expect(snap().total).toBe(260 * PLAN_PAGE_SIZE);
            // Rebuilt around where the reader was — not reset to the top.
            const [from, to] = span(snap());
            expect(from).toBeLessThanOrEqual(40_000);
            expect(to).toBeGreaterThan(40_000);
            expect(revisionsShown(snap())).toEqual(new Set(["B"]));
        } finally {
            warn.mockRestore();
        }
    });

    test("a total that moves under ONE revision still breaks the contract, and says so (#614)", () => {
        const { value, state } = revisioned(4);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const { snap, report } = drive(value);
            expect(snap().total).toBe(4 * PLAN_PAGE_SIZE);
            state.total = 8 * PLAN_PAGE_SIZE;
            report(band("tail"));
            expect(String(warn.mock.calls[0]?.[0])).toMatch(/under one id and revision/);
        } finally {
            warn.mockRestore();
        }
    });

    test("a source that cannot say which snapshot it serves has failed as a whole — and its windows say so (#811)", () => {
        const boom = (): never => { throw new Error("no content snapshot"); };
        const bad = {
            id: "no-revision", page: boom, total: () => none, seek: none, revision: boom, refresh: () => null,
        } as unknown as PlanPagedSourceValue;
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const { snap } = drive(bad);
            expect(snap().sourceError).toMatch(/no content snapshot/);
            expect(snap().failures.map((f) => f.error)).toEqual(["no content snapshot"]);
            expect(snap().rows).toEqual([]);
        } finally {
            err.mockRestore();
        }
    });
});

describe("paging driver — blocks page apart (#823)", () => {
    /** A source of `windows` windows serving TWO paged blocks per window — a
     *  span series and a heat series over the same entries, say — with
     *  `rowsPer` rows each, and a fixed header block ahead of them when asked. */
    function twoBlocks(windows: number, rowsPer = 2, opts?: { header?: boolean }) {
        const asked: number[] = [];
        const value = {
            id: "two-blocks",
            page: (offset: bigint) => {
                const w = Number(offset) / PLAN_PAGE_SIZE;
                asked.push(w);
                const pad = String(w).padStart(4, "0");
                const rowsOf = (series: string) => Array.from({ length: rowsPer },
                    (_, i) => wire(`w${pad}r${String(i).padStart(3, "0")}`, { id: rowId(`w${pad}r${String(i).padStart(3, "0")}`, series) }));
                const blocks = [paged(rowsOf("span")), paged(rowsOf("heat"))];
                return some(opts?.header === true ? [fixed([wire("hdr")]), ...blocks] : blocks);
            },
            total: () => some(BigInt(windows * PLAN_PAGE_SIZE)),
            seek: none,
            revision: () => none,
            refresh: () => null,
        } as unknown as PlanPagedSourceValue;
        return { value, asked };
    }
    /** A block's resident rows' series, in order. */
    const seriesOf = (s: PlanPagingSnapshot) => [...new Set(s.rows.map((r) => r.id.value.series))];

    test("ONE read of a window serves every block — the blocks draw one after another", () => {
        const { value, asked } = twoBlocks(50);
        const { snap } = drive(value);
        // Each window was asked for once, whatever the number of blocks.
        expect([...asked].sort((a, b) => a - b)).toEqual([0, 1, 2]);
        // Block after block: every span row, then every heat row.
        expect(seriesOf(snap())).toEqual(["span", "heat"]);
        expect(snap().rows.map((r) => r.block)).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
        // Each block has its own tail band, over the same elements.
        expect(bandText(tail(snap(), 0))).toBe("600-9999");
        expect(bandText(tail(snap(), 1))).toBe("600-9999");
        expect(snap().origin.get(snap().rows[6]!.key)).toEqual({ block: 1, w: 0 });
    });

    test("the viewport moves only its own block's demand", () => {
        const { value } = twoBlocks(250);
        const { snap, report } = drive(value);
        // Deep into block 1's tail: block 1 rebases there; block 0 stays put.
        report(band("tail", 147 * 200 + 50, 1));
        expect(bandText(head(snap(), 0))).toBe("-");
        expect(bandText(tail(snap(), 0))).toBe("600-49999");
        expect(head(snap(), 1)).toBeDefined();
        const blockOne = snap().blocks[1]!.resident!;
        expect(blockOne.from).toBeGreaterThan(100 * PLAN_PAGE_SIZE);
        // The transport counts the block the viewport is in.
        expect(snap().resident).toEqual(blockOne);
    });

    test("scrolling from the end of block 0 into block 1 finds block 1's window 0 — each window read once", () => {
        // 1,000 rows a window: block 0's row budget holds four windows, so
        // walking it to its end evicts its head.
        const { value, asked } = twoBlocks(12, 1000);
        const { snap, report } = drive(value);
        // Walk block 0 to its end.
        for (let i = 0; i < 40 && tail(snap(), 0) !== undefined; i++) report(band("tail"));
        expect(tail(snap(), 0)).toBeUndefined();
        expect(head(snap(), 0)).toBeDefined();
        // Into block 1: its first row is window 0's, still resident for it.
        const first = snap().rows.find((r) => r.block === 1)!;
        report({ kind: "row", key: first.key });
        expect(snap().origin.get(first.key)).toEqual({ block: 1, w: 0 });
        expect(head(snap(), 1)).toBeUndefined();
        expect(snap().resident!.from).toBe(0);
        // No window was ever read twice: block 1 kept window 0 in the cache
        // while block 0 walked away from it.
        expect(new Set(asked).size).toBe(asked.length);
    });

    test("a fixed block draws once, and no ledger counts it", () => {
        const { value } = twoBlocks(50, 2, { header: true });
        const { snap } = drive(value);
        // The header every window serves is ONE row, ahead of both blocks.
        expect(rowKeys(snap()).filter((k) => k === "hdr")).toHaveLength(1);
        expect(snap().rows[0]!.key).toBe(rowKey("hdr"));
        expect(snap().blocks.map((b) => b.fixed)).toEqual([true, false, false]);
        expect(tail(snap(), 0)).toBeUndefined();
        // The paged blocks' bands measure their own rows: 47 unvisited windows
        // at the rate window 0 drew (2 rows × 32px over 200 elements, floored
        // at 1px per element) — the header is in none of them.
        expect(tail(snap(), 1)!.px).toBe(47 * 200);
    });

    test("an unvisited window is estimated at the REST rate, a visited one at what it draws now", () => {
        // A canvas collapsed to half height: 20 rows draw 320px, at rest 640px.
        const { snap } = drive(source(50, 20).value, {
            skeletonOf: countSkeleton,
            heightOf: (sk) => sk.keys.length * ROW_PX / 2,
            restHeightOf: (sk) => sk.keys.length * ROW_PX,
        });
        // 47 unvisited windows × 200 elements × 3.2px — the rest rate, not
        // whatever the first window happened to draw at.
        expect(tail(snap())!.px).toBeCloseTo(47 * 640);
    });

    test("remeasure moves an evicted window's band to what its rows draw now — exactly", () => {
        let scale = 1;
        const { d, snap, report } = drive(source(50, 20).value, {
            skeletonOf: countSkeleton,
            heightOf: (sk) => sk.keys.length * ROW_PX * scale,
            restHeightOf: (sk) => sk.keys.length * ROW_PX,
        });
        // A far drag rebases the run to window 20: windows 0–2, measured at
        // first paint (640px each), are now inside the head band with the
        // unvisited windows 3–18 (the rest rate, 640px each).
        report(band("tail", 17 * 640 + 10));
        expect(snap().blocks[0]!.resident!.from / PLAN_PAGE_SIZE).toBe(19);
        const before = head(snap())!.px;
        expect(before).toBe(19 * 640);
        // "Collapse all": every row draws at half height now. The head band's
        // SEEN windows follow exactly; the unvisited ones stay estimates.
        scale = 0.5;
        d.remeasure();
        expect(head(snap())!.px).toBe(before - 3 * 320);
        // Back to rest: back to where it was.
        scale = 1;
        d.remeasure();
        expect(head(snap())!.px).toBe(before);
    });

    test("placeOf puts an evicted row in its block's band, at its window's offset", () => {
        const { d, snap, report } = drive(source(50, 20).value);
        // Rebase to window 20: windows 0–2 were seen, and are evicted now.
        report(band("tail", 17 * 640 + 10));
        expect(snap().blocks[0]!.resident!.from / PLAN_PAGE_SIZE).toBe(19);
        // Window 1's first row: one measured window (20 × 32px) below the
        // head band's top.
        expect(d.placeOf(rowKey("w0001r000"))).toEqual({ block: 0, at: "head", px: 20 * ROW_PX });
        // A resident row is the body's; a row never seen has no place.
        expect(d.placeOf(snap().rows[0]!.key)).toBeUndefined();
        expect(d.placeOf(rowKey("w0049r000"))).toBeUndefined();
    });
});

describe("the probe, inverted — a window holds its entries whole (#823)", () => {
    // The #823 probe: two lines of four machines, their keys interleaved across
    // the lines, one line a window. Grouped by a field, the old canvas drew line
    // 1's band from window 1 among window 0's machines, and its ledger counted
    // each 26px band once per window — 360px against 308 rendered. Nesting from
    // the data makes a line ONE entry, and its window holds it whole.
    const groupKind = variant("group", { summary: none, summaryAggregate: none });
    const spanKind = variant("span", { runs: [], decisions: [], ports: [], rollup: none, unit: none });
    /** A wire row with every field the model reads. */
    const full = (key: string, kind: unknown, parent?: string): PlanWireRow => ({
        id: rowId(key),
        parent: parent !== undefined ? some(rowId(parent)) : none,
        gutter: { label: key, id: none, sub: none, value: none, meta: none, stacked: none, swatches: [] },
        kind, collapsed: none, pinned: none, height: none, status: none, approval: none, expand: none,
    }) as unknown as PlanWireRow;
    /** Window w serves line `L{w+1}` with its machines: m001 m003 m005 m007 in
     *  window 0, m002 … m008 in window 1. */
    const lines = {
        id: "probe",
        page: (offset: bigint) => {
            const w = Number(offset) / PLAN_PAGE_SIZE;
            const line = `L${w + 1}`;
            const machines = [0, 1, 2, 3].map((k) => full(`m${String(w + 1 + 2 * k).padStart(3, "0")}`, spanKind, line));
            return some([paged([full(line, groupKind), ...machines])]);
        },
        total: () => some(BigInt(2 * PLAN_PAGE_SIZE)),
        seek: none,
        revision: () => none,
        refresh: () => null,
    } as unknown as PlanPagedSourceValue;
    /** The model's own height arithmetic, at rest — what the canvas measures windows with. */
    const real: Pick<PagingDriverOptions, "skeletonOf" | "heightOf" | "restHeightOf"> = {
        skeletonOf: (rows) => windowSkeleton(rows, "time"),
        heightOf: (sk) => skeletonHeight(sk, restUi("resource"), false),
        restHeightOf: (sk) => skeletonHeight(sk, restUi("resource"), false),
    };
    /** What rows draw on the canvas — the body's own walk and heights. */
    const drawn = (rows: readonly PlanRowValue[]) => visibleRows(indexRows(rows), { grain: "resource", collapsed: new Set() })
        .reduce((px, v) => px + rowHeight(v, false, new Set()), 0);
    /** Both lines, each band and its machines once. */
    const BOTH = 2 * (GROUP_H + 4 * ROW_H);

    test("the rows render in window order — each line whole, from its own window", () => {
        const { snap } = drive(lines, real);
        expect(rowKeys(snap())).toEqual(["L1", "m001", "m003", "m005", "m007", "L2", "m002", "m004", "m006", "m008"]);
        expect(snap().rows.map((r) => snap().origin.get(r.key)!.w)).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1]);
        expect(drawn(snap().rows)).toBe(BOTH);
    });

    test("the ledger holds each window at exactly what its rows draw — an evicted line is its band and machines, once", () => {
        // One window resident at a time: the other is always a band.
        const d = createPagingDriver({
            ...real, policy: { behind: 0, ahead: 0, rebaseGap: 0, maxRows: 4_000, evictTo: 0.75 }, onChange: () => {},
        });
        d.setSource(lines);
        const line1 = d.getSnapshot().rows;
        expect(rowKeys(d.getSnapshot())).toEqual(["L1", "m001", "m003", "m005", "m007"]);
        d.reportViewport({ kind: "window", block: 0, w: 1 }, false);
        const s = d.getSnapshot();
        expect(rowKeys(s)).toEqual(["L2", "m002", "m004", "m006", "m008"]);
        // Window 0 is the head band now — exactly what line 1 drew — and the
        // canvas is as tall as both lines drawn.
        expect(head(s)!.px).toBe(drawn(line1));
        expect(head(s)!.px + drawn(s.rows)).toBe(BOTH);
        // And back: window 1's band is line 2's rows.
        d.reportViewport({ kind: "window", block: 0, w: 0 }, false);
        expect(tail(d.getSnapshot())!.px).toBe(drawn(s.rows));
    });
});
