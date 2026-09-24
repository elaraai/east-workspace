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
 * plain state now, so they need no renderer and no waiting.)
 */

import { describe, test, expect, vi } from "vitest";
import { some, none } from "@elaraai/east";
import type { PlanRowValue } from "../model.js";
import { PLAN_PAGE_SIZE, FAILED_BAND_MIN_PX, type PlanPagedSourceValue, type PlanViewport } from "../use-plan-paging.js";
import { createPagingDriver, type PlanPagingSnapshot } from "./paging.js";

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
        revision: () => none,
        refresh: () => null,
    } as unknown as PlanPagedSourceValue;
    return { value, asked };
}

/** A driver over `src`, with a count of its notifications. */
function drive(src: PlanPagedSourceValue) {
    let notified = 0;
    const d = createPagingDriver({ heightOf: (rows) => rows.length * ROW_PX, onChange: () => { notified += 1; } });
    d.setSource(src);
    return {
        d,
        snap: (): PlanPagingSnapshot => d.getSnapshot(),
        notified: () => notified,
        report: (at: PlanViewport, scrolling = false) => d.reportViewport(at, scrolling),
    };
}

const residentText = (s: PlanPagingSnapshot) => (s.resident ? `${s.resident.from}-${s.resident.to}` : "-");
const bandText = (b: PlanPagingSnapshot["head"]) => (b ? `${b.from}-${b.to}` : "-");
const span = (s: PlanPagingSnapshot) => residentText(s).split("-").map(Number) as [number, number];

describe("paging driver — first paint", () => {
    test("starts at the top and describes the rest of the source as a tail band", () => {
        const { snap } = drive(source(50).value);                // 10,000 elements
        // The demand settles at [0, ahead] — window 0 plus its prefetch ring.
        expect(residentText(snap())).toBe("0-600");
        expect(snap().rows).toHaveLength(6);
        expect(snap().rows[0]!.key).toBe("w0000r000");
        // Nothing above the top, and everything below is one band.
        expect(bandText(snap().head)).toBe("-");
        expect(bandText(snap().tail)).toBe("600-9999");
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
        report({ kind: "band", at: "tail" });
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
        report({ kind: "band", at: "tail" }, true);
        expect(asked.length).toBe(before);
        // Released: demand resumes.
        report({ kind: "band", at: "tail" }, false);
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
        expect(bandText(snap().head)).toBe(`0-${from - 1}`);
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
        report({ kind: "band", at: "tail", px: 147 * 200 + 50 });
        const [from, to] = span(snap());
        expect(from).toBeLessThanOrEqual(150 * PLAN_PAGE_SIZE);
        expect(to).toBeGreaterThan(150 * PLAN_PAGE_SIZE);
        // The destination ring was fetched; the ~146 windows in between were NOT.
        const newly = [...new Set(asked.filter((w) => !before.has(w)))].sort((a, b) => a - b);
        expect(newly.length).toBeLessThanOrEqual(4);
        for (const w of newly) expect(w).toBeGreaterThanOrEqual(148);
        // Everything skipped reads as ONE head band.
        expect(bandText(snap().head)).toMatch(/^0-/);
    });

    test("a shallow offset still walks one window at a time — no rebase at the band's edge", () => {
        const { value, asked } = source(50);
        const { snap, report } = drive(value);
        report({ kind: "band", at: "tail", px: 10 });          // barely into the band
        // The run EXTENDS to the demand ring around the adjacent window — the
        // head never leaves the top of the source.
        expect(residentText(snap())).toBe("0-1200");
        expect(bandText(snap().head)).toBe("-");
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
        for (let i = 0; i < 60; i++) report({ kind: "band", at: "tail" });
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
                return some(new Map([[`w${w}`, { key: `w${w}`, parent: none } as unknown as PlanRowValue]]));
            },
            total: () => some(total),
            seek: none,
            revision: () => none,
            refresh: () => null,
        } as unknown as PlanPagedSourceValue;
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const { snap, report } = drive(value);
            expect(snap().rows.map((r) => r.key)).toContain("w0");
            total = 1_600n;
            report({ kind: "band", at: "tail" });                // any re-read
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
                return some(new Map([`w${pad}r000`, `w${pad}r001`].map((key) =>
                    [key, { key, parent: none } as unknown as PlanRowValue])));
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
        report({ kind: "band", at: "head", px: 10 });
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
        report({ kind: "band", at: "head", px: 10 });
        expect(span(snap())).toEqual([from, to]);
        // A commit of a render from BEFORE the landing hands nothing back.
        d.committed(beforeLanding);
        expect(d.jumping()).toBe(true);
        // Shown, the pin drops and reports move the demand again.
        d.committed(snap());
        expect(d.jumping()).toBe(false);
        report({ kind: "band", at: "head", px: 10 });
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
            report({ kind: "band", at: "head", px: 10 });
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
                { w: 0, from: 0, to: PLAN_PAGE_SIZE - 1, px: FAILED_BAND_MIN_PX, error: "no paging service" },
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
                return some(new Map([`w${pad}r000`, `w${pad}r001`].map((key) =>
                    [key, { key, parent: none } as unknown as PlanRowValue])));
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
            const keys = snap().rows.map((r) => r.key);
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
            expect(snap().rows.map((r) => r.key)).toContain("w0001r000");
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
            report({ kind: "window", w: 1 });
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
            report({ kind: "band", at: "tail" });
            const r = snap().resident;
            if (r !== undefined) peakRows = Math.max(peakRows, ((r.to - r.from) / PLAN_PAGE_SIZE) * 100);
            if (snap().tail === undefined) break;                // reached the end
        }
        expect(peakRows).toBeLessThanOrEqual(4_000);
        // ...and we genuinely travelled — the run is nowhere near the top.
        expect(snap().resident!.from).toBeGreaterThan(10_000);
    });

    test("the head band grows as the run moves away from the top", () => {
        const { snap, report } = drive(source(250, 100).value);
        for (let i = 0; i < 60; i++) report({ kind: "band", at: "tail" });
        const head = snap().head;
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
                const key = `${label}-w${w}`;
                return some(new Map([[key, { key, parent: none } as unknown as PlanRowValue]]));
            },
            total: () => some(BigInt(PLAN_PAGE_SIZE)),
            seek: none,
            revision: () => none,
            refresh: () => null,
        } as unknown as PlanPagedSourceValue;
    }
    const keys = (s: PlanPagingSnapshot) => s.rows.map((r) => r.key).join(" ");

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
                return some(new Map([`w${pad}r000`, `w${pad}r001`].map((key) =>
                    [key, { key, parent: none, rev: state.revision } as unknown as PlanRowValue])));
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
        expect(bandText(snap().tail)).toBe("600-9999");
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
            report({ kind: "band", at: "tail" });
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
