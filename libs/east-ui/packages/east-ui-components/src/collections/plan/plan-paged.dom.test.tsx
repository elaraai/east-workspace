/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Plan paged-source DOM tests (P-c) — the resident run, its bands, the
 * transport line and paging around the viewport.
 *
 * (Split out of `plan.dom.test.tsx`, #815: every test moved verbatim.)
 */

import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { buildSliceHandle } from "../../platform/slice/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { registerReactiveTracker, type ReactiveTracker } from "../../reactive/tracker.js";
import { EastChakraPlan, type PlanRootValue } from "./index.js";
import type { PlanRowId, PlanWireRow } from "./model.js";
import type { PlanInstantValue } from "./instant.js";
import { blocksSource, oneBlock, rowId, rowSel, sectionId, sectionSel } from "./plan.test-utils.js";

// A canvas persists its toggles under its storageKey (#813), and several tests
// share one — nothing may carry from one test to the next.
afterEach(() => {
    cleanup();
    localStorage.clear();
});

// jsdom lacks ResizeObserver — the floating-ui positioner behind the
// resolver popovers needs one; a no-op stub keeps positioning inert (the
// slice / schematic dom-test convention).
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const W27 = new Date("2026-06-29T00:00:00Z");           // Monday, ISO week 27
const W39 = new Date("2026-09-21T00:00:00Z");           // exclusive max → 12 weeks
const NOW = new Date("2026-08-12T00:00:00Z");
/** Instants on each arm — REAL East variant values, as the decoder yields them (#631). */
const t = (d: Date): PlanInstantValue => variant("time", d) as PlanInstantValue;

function run(key: string, start: Date, end: Date, state: unknown, opts?: { quantity?: number; unit?: string; text?: string; stuck?: boolean }) {
    return {
        key, start: t(start), end: t(end), label: key.toUpperCase(),
        quantity: opts?.quantity !== undefined
            ? some({ value: opts.quantity, unit: opts.unit !== undefined ? some(opts.unit) : none, format: none, text: opts.text !== undefined ? some(opts.text) : none })
            : none,
        state,
        status: opts?.stuck === true ? some(variant("warning", null)) : none,
        moved: none, icon: none,
    };
}

function gutter(label: string, opts?: { sub?: string; value?: string; meta?: string; id?: boolean }) {
    return {
        label,
        id: opts?.id === true,
        sub: opts?.sub !== undefined ? some(opts.sub) : none,
        value: opts?.value !== undefined ? some(opts.value) : none,
        meta: opts?.meta !== undefined ? some(opts.meta) : none,
        stacked: false,
        swatches: [],
    };
}

/** One WIRE row, as the source serves it — named by its test key (#822), or
 *  by an explicit `id` (a section header's), and nested under a parent named
 *  by its test key or by its `parentId`. */
function planRow(key: string, kind: unknown, opts?: { id?: PlanRowId; parent?: string; parentId?: PlanRowId; gutter?: unknown; expand?: unknown; collapsed?: boolean }): PlanWireRow {
    return {
        id: opts?.id ?? rowId(key),
        parent: opts?.parentId !== undefined ? some(opts.parentId)
            : opts?.parent !== undefined ? some(rowId(opts.parent)) : none,
        gutter: opts?.gutter ?? gutter(key),
        kind,
        collapsed: opts?.collapsed === true,
        pinned: false, height: none, status: none, approval: none,
        expand: opts?.expand !== undefined ? some(opts.expand) : none,
    } as unknown as PlanWireRow;
}

function spanKind(runs: unknown[], opts?: { rollup?: string }) {
    return variant("span", {
        runs, decisions: [], ports: [],
        rollup: opts?.rollup !== undefined ? some(variant(opts.rollup, null)) : none,
    });
}

function planRoot(rows: PlanWireRow[], opts?: { footer?: unknown[]; now?: Date | undefined; slice?: unknown; resolutions?: unknown[]; links?: unknown[]; popover?: unknown; hover?: unknown; expandRender?: unknown; source?: unknown; pick?: unknown; axis?: unknown; style?: { height?: string; maxHeight?: string }; onElementClick?: unknown; ui?: unknown }): PlanRootValue {
    return {
        rows: opts?.source !== undefined ? variant("paged", blocksSource(opts.source)) : variant("inline", oneBlock(rows)),
        links: opts?.links ?? [],
        // The TIME arm by default (#631); the typed-axis tests pass their own.
        axis: opts?.axis ?? variant("time", {
            window: some({ min: W27, max: W39 }),
            resolution: variant("week", null),
            resolutions: opts?.resolutions ?? [],
            now: opts?.now !== undefined ? some(opts.now) : (opts && "now" in opts ? none : some(NOW)),
            format: none,
        }),
        grain: none,
       
        popover: opts?.popover !== undefined ? some(opts.popover) : none,
        hover: opts?.hover !== undefined ? some(opts.hover) : none,
        expandRender: opts?.expandRender !== undefined ? some(opts.expandRender) : none,
        review: none,
        pick: opts?.pick !== undefined ? some(opts.pick) : none,
        slice: opts?.slice ?? none,
        footer: opts?.footer ?? [],
        id: none, sources: [], onDrag: none, canDrop: none,
        onSelect: none,
        onElementClick: opts?.onElementClick !== undefined ? some(opts.onElementClick) : none,
        onGroupToggle: none, onGrainChange: none, ui: opts?.ui !== undefined ? some(opts.ui) : none,
        style: opts?.style !== undefined
            ? some({
                height: opts.style.height !== undefined ? some(opts.style.height) : none,
                maxHeight: opts.style.maxHeight !== undefined ? some(opts.style.maxHeight) : none,
                density: none,
                gutterWidth: none,
            })
            : none,
    } as unknown as PlanRootValue;
}

function renderPlan(value: PlanRootValue, key = "plan") {
    return render(
        <ChakraProvider value={system}>
            <EastChakraPlan value={value} storageKey={key} />
        </ChakraProvider>,
    );
}

describe("Plan paged source (P-c)", () => {
    test("a paged source streams windows into the canvas; an empty window ends the stream", async () => {
        const w1 = [
            planRow("m1", spanKind([run("r1", W27, new Date("2026-07-13Z"), variant("actual", null))])),
            planRow("m2", spanKind([run("r2", new Date("2026-07-13Z"), new Date("2026-07-27Z"), variant("confirmed", null))])),
        ];
        const calls: bigint[] = [];
        const source = {
            // Window 0 carries the rows; the NEXT window is empty (= end).
            page: (offset: bigint, _limit: bigint) => {
                calls.push(offset);
                return offset === 0n ? some(w1) : some([]);
            },
            total: () => none,
            // The contract's comparable identity + seek capability (#567): a
            // fixture source is not key-ordered, so it declares no seek.
            id: "dom-test",
            seek: none,
            revision: () => none,
            refresh: () => null,
        };
        const { container } = renderPlan(planRoot([], { source }));
        // The loader streams the prefix in an effect — rows appear after it.
        await screen.findByText("R1");
        expect(container.querySelector(rowSel("m1"))).toBeTruthy();
        expect(container.querySelector(rowSel("m2"))).toBeTruthy();
        // Sequential prefix requests at PAGE_SIZE offsets, then done.
        expect(calls[0]).toBe(0n);
        expect(calls.length).toBeGreaterThanOrEqual(1);
    });

    test("a window that filters to ZERO canvas rows does not end the stream (#567 D2)", async () => {
        // The series pipeline runs inside `page`, so a window of source
        // elements matching nothing yields an EMPTY canvas window while the
        // source still has plenty left. The old loader read that as
        // exhaustion and silently dropped every later window.
        const w0 = [planRow("m1", spanKind([run("r1", W27, new Date("2026-07-13Z"), variant("actual", null))]))];
        const w2 = [planRow("m3", spanKind([run("r3", W27, new Date("2026-07-13Z"), variant("confirmed", null))]))];
        const calls: bigint[] = [];
        const source = {
            page: (offset: bigint, _limit: bigint) => {
                calls.push(offset);
                if (offset === 0n) return some(w0);
                if (offset === 200n) return some([]);   // filtered to nothing
                if (offset === 400n) return some(w2);
                return some([]);
            },
            // 600 source elements ⇒ three windows, whatever any window yields.
            total: () => some(600n),
            id: "dom-test-filtered",
            seek: none,
            revision: () => none,
            refresh: () => null,
        };
        const { container } = renderPlan(planRoot([], { source }), "plan-d2");
        await screen.findByText("R1");
        // The row from AFTER the empty window is what the old loader lost.
        await screen.findByText("R3");
        expect(container.querySelector(rowSel("m3"))).toBeTruthy();
        expect(calls).toContain(400n);
    });

    test("the footer carries the transport line, counted in ELEMENTS (#567 D9)", async () => {
        // `total` / `loadedElements` / `loading` were returned by the hook and
        // read by NOBODY: no spinner, no progress, no marker that the derived
        // numbers cover a prefix. The footer is where transport state belongs
        // (the rail is *narrowing* state), and it counts SOURCE ELEMENTS —
        // a series can emit any number of canvas rows per element, so a row
        // count would disagree with `total()` on screen.
        const w0 = [planRow("m1", spanKind([run("r1", W27, new Date("2026-07-13Z"), variant("actual", null))]))];
        const source = {
            // Window 0 lands; the next is still in flight.
            page: (offset: bigint) => (offset === 0n ? some(w0) : none),
            total: () => some(600n),
            id: "dom-test-transport",
            seek: none,
            revision: () => none,
            refresh: () => null,
        };
        const { container } = renderPlan(planRoot([], { source }), "plan-d9-footer");
        await screen.findByText("R1");

        const line = container.querySelector('[data-slot="footerTransport"]')!;
        expect(line).toBeTruthy();
        expect(line.textContent).toBe("200 loaded of 600 · Loading…");
        expect(line.getAttribute("data-partial")).toBe("");
        // Every derived number in the body is over that prefix.
        expect(container.querySelector("[data-plan-body][data-plan-partial]")).toBeTruthy();
    });

    test("an EXHAUSTED source drops every partial mark", async () => {
        const rows = [planRow("m1", spanKind([run("r1", W27, new Date("2026-07-13Z"), variant("actual", null))]))];
        const source = {
            page: (offset: bigint) => (offset === 0n ? some(rows) : some([])),
            total: () => some(2n),
            id: "dom-test-exhausted",
            seek: none,
            revision: () => none,
            refresh: () => null,
        };
        const { container } = renderPlan(planRoot([], { source }), "plan-d9-done");
        await screen.findByText("R1");

        const line = container.querySelector('[data-slot="footerTransport"]')!;
        // Loaded is clamped to the total — never "200 loaded of 2".
        expect(line.textContent).toBe("2 loaded of 2");
        expect(line.getAttribute("data-partial")).toBeNull();
        expect(container.querySelector("[data-plan-body][data-plan-partial]")).toBeNull();
    });

    test("an INLINE canvas has no transport line at all", () => {
        const { container } = renderPlan(planRoot([
            planRow("m1", spanKind([run("r1", W27, new Date("2026-07-13Z"), variant("actual", null))])),
        ]), "plan-d9-inline");
        expect(container.querySelector('[data-slot="footerTransport"]')).toBeNull();
        expect(container.querySelector("[data-plan-body][data-plan-partial]")).toBeNull();
    });

    test("a top-level section's count covers the loaded windows — MARKED until the source is exhausted (#822)", async () => {
        // A section's members are its series' ENTRIES, which the source's
        // windows share out between them — the one parent whose rows can span
        // windows. Over the loaded windows its derived member count is an
        // understatement, so it prints `~2 rs` and the band carries
        // `data-plan-partial` — the author's own `meta` is never rewritten,
        // since that is their text rather than a derivation.
        const line = sectionId("line");
        const w0 = [
            planRow("line", variant("group", { summary: variant("none", null) }),
                { id: line, gutter: gutter("Line 1") }),
            planRow("m1", spanKind([run("r1", W27, new Date("2026-07-13Z"), variant("actual", null))]), { parentId: line }),
            planRow("m2", spanKind([run("r2", W27, new Date("2026-07-13Z"), variant("actual", null))]), { parentId: line }),
        ];
        const sourceOf = (total: bigint, id: string) => ({
            page: (offset: bigint) => (offset === 0n ? some(w0) : total > 200n ? none : some([])),
            total: () => some(total),
            id,
            seek: none,
            revision: () => none,
            refresh: () => null,
        });
        const partial = renderPlan(planRoot([], { source: sourceOf(600n, "dom-test-partial") }), "plan-d9-partial");
        await screen.findByText("R1");
        const band = partial.container.querySelector(sectionSel("line"))!;
        expect(band.getAttribute("data-plan-partial")).toBe("");
        expect(band.textContent).toContain("~2 rs");
        cleanup();

        // Every element resident: the count is the section's, and final.
        const done = renderPlan(planRoot([], { source: sourceOf(3n, "dom-test-partial-done") }), "plan-d9-partial-done");
        await screen.findByText("R1");
        const final = done.container.querySelector(sectionSel("line"))!;
        expect(final.getAttribute("data-plan-partial")).toBeNull();
        expect(final.textContent).toContain("2 rs");
        expect(final.textContent).not.toContain("~");
    });

    test("every other parent is EXACT over a partial prefix — its subtree rides whole in one window, and it draws as it does inline (#822)", async () => {
        // A group strip per entry, a span parent rolling its children up, and
        // a section INSIDE an entry all derive from one entry's subtree, which
        // the entry carries whole and a window holds whole. Their numbers are
        // final the moment their window lands — marking them `~` on a paged
        // canvas would draw it differently from the same canvas inline.
        const groupKind = variant("group", { summary: variant("none", null) });
        const inner = sectionId("inner", "g2");
        const rows = [
            planRow("g1", groupKind, { gutter: gutter("Line 1") }),
            planRow("a", spanKind([run("ra", W27, new Date("2026-07-13Z"), variant("actual", null))]), { parent: "g1" }),
            planRow("b", spanKind([run("rb", W27, new Date("2026-07-13Z"), variant("actual", null))]), { parent: "g1" }),
            planRow("p1", spanKind([], { rollup: "union" }), { gutter: gutter("Program A") }),
            planRow("c", spanKind([run("rc", W27, new Date("2026-07-13Z"), variant("actual", null), { quantity: 10, unit: "t" })]), { parent: "p1" }),
            planRow("d", spanKind([run("rd", new Date("2026-07-06Z"), new Date("2026-07-20Z"), variant("actual", null), { quantity: 20, unit: "t" })]), { parent: "p1" }),
            planRow("g2", groupKind, { gutter: gutter("Line 2") }),
            planRow("inner", groupKind, { id: inner, parentId: rowId("g2"), gutter: gutter("Machines") }),
            planRow("e", spanKind([run("re", W27, new Date("2026-07-13Z"), variant("actual", null))]), { parentId: inner }),
        ];
        const source = {
            // Window 0 lands; 400 more elements have not.
            page: (offset: bigint) => (offset === 0n ? some(rows) : none),
            total: () => some(600n),
            id: "dom-test-exact",
            seek: none,
            revision: () => none,
            refresh: () => null,
        };
        /** What the parents say: each band's text, and the rollup's captions. */
        const said = (c: HTMLElement) => ({
            g1: c.querySelector(rowSel("g1", "data-plan-group"))!.textContent,
            g2: c.querySelector(rowSel("g2", "data-plan-group"))!.textContent,
            inner: c.querySelector(sectionSel("inner", ["g2"]))!.textContent,
            rollup: [...c.querySelector(rowSel("p1"))!.querySelectorAll("[data-state]:not([data-run])")].map((b) => b.textContent),
        });

        const paged = renderPlan(planRoot([], { source }), "plan-822-exact");
        await screen.findByText("RA");
        const c = paged.container;
        // The canvas IS partial — its source has more to serve…
        expect(c.querySelector("[data-plan-body][data-plan-partial]")).toBeTruthy();
        // …and none of these parents says so, because none of them is.
        expect(c.querySelectorAll("[data-plan-group][data-plan-partial]")).toHaveLength(0);
        const pagedSaid = said(c);
        expect(pagedSaid.g1).toContain("2 rs");
        expect(pagedSaid.inner).toContain("1 rs");
        expect(pagedSaid.rollup).toContain("×2 · 30 t");
        for (const text of [pagedSaid.g1, pagedSaid.g2, pagedSaid.inner, ...pagedSaid.rollup]) expect(text).not.toContain("~");
        cleanup();

        // The same rows inline say exactly the same.
        const inline = renderPlan(planRoot(rows), "plan-822-exact-inline");
        expect(said(inline.container)).toEqual(pagedSaid);
    });

    test("a narrowing affordance is SCOPE-BADGED and `summary` counts elements (#567 D9)", async () => {
        // `filter` / `cohort` / `breakdown` narrow whatever the host fed, which
        // on a paged source is the prefix that happened to land — so they keep
        // working and say what they are working on. `summary` stops reporting
        // slice results (`N of M matching`) and reports transport instead.
        initializeStore(new UIStore());
        const cfg = {
            fields: new Map<string, unknown>([
                ["at", variant("datetime", { label: "At", accessor: (r: { at: Date }) => r.at, format: none })],
            ]),
            rangeFieldId: some("at"), searchFieldIds: [], breakdownFieldIds: [],
        };
        const initial = {
            range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
            breakdown: none, search: none, visible: none, selectedIndex: none, resolution: none,
        };
        const handle = buildSliceHandle("plan.paged.chrome", cfg as never, initial as never, [] as never, none) as never;
        const w0 = [planRow("m1", spanKind([run("r1", W27, new Date("2026-07-13Z"), variant("actual", null))]))];
        const source = {
            page: (offset: bigint) => (offset === 0n ? some(w0) : none),
            total: () => some(600n),
            id: "dom-test-chrome",
            seek: none,
            revision: () => none,
            refresh: () => null,
        };
        const { container } = renderPlan(planRoot([], {
            source,
            slice: some({ slice: handle, affordances: [variant("filter", null), variant("summary", null)] }),
        }), "plan-d9-chrome");
        await screen.findByText("R1");

        expect(container.querySelector('[data-slot="scopeBadge"]')!.textContent).toBe("loaded rows only");
        // The toolbar summary is the count WITHOUT the footer's loading suffix.
        expect(screen.getByText("200 loaded of 600")).toBeTruthy();
    });

    test("`search` becomes a KEY SEARCH where the source declares seek (#574)", async () => {
        // The affordance table's paged column: filtering the loaded prefix and
        // seeking the whole source are different operations, so a seek-capable
        // source REPLACES the slice search chip rather than sitting beside it.
        initializeStore(new UIStore());
        const queries: { type: string; value: unknown }[] = [];
        const w0 = [
            planRow("l1m1", spanKind([run("r1", W27, new Date("2026-07-13Z"), variant("actual", null))])),
            planRow("l2m9", spanKind([run("r2", W27, new Date("2026-07-13Z"), variant("actual", null))])),
        ];
        const source = {
            page: (offset: bigint) => (offset === 0n ? some(w0) : none),
            total: () => some(600n),
            id: "dom-test-seek",
            // The compiled handle's `seek` — `some(fn)` for a key-ordered
            // source. It answers in SOURCE ELEMENT indices.
            seek: some((q: { type: string; value: unknown }) => {
                queries.push(q);
                return some({ found: true, row: 12n, count: 3n });
            }),
            revision: () => none,
            refresh: () => null,
        };
        const cfg = {
            fields: new Map<string, unknown>(), rangeFieldId: none,
            searchFieldIds: [], breakdownFieldIds: [],
        };
        const initial = {
            range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
            breakdown: none, search: none, visible: none, selectedIndex: none, resolution: none,
        };
        const handle = buildSliceHandle("plan.seek", cfg as never, initial as never, [] as never, none) as never;
        const { container } = renderPlan(planRoot([], {
            source,
            slice: some({ slice: handle, affordances: [variant("search", null)] }),
        }), "plan-seek");
        await screen.findByText("R1");

        const control = container.querySelector('[data-part="dataset-key-search"]');
        expect(control).toBeTruthy();
        // The slice's own search chip is gone — one word, one meaning.
        expect(container.querySelector('[data-slot="scopeBadge"]')).toBeNull();

        // Typing reaches the SOURCE's seek as one debounced prefix query.
        await userEvent.type(screen.getByPlaceholderText("Search keys"), "l2");
        await waitFor(() => expect(queries.length).toBeGreaterThan(0));
        expect(queries[0]!.type).toBe("prefix");
        expect(queries[0]!.value).toBe("l2");
        // ... and the answer surfaces as the control's match count.
        await waitFor(() => expect(screen.getByText("3 matches")).toBeTruthy());
        // The popup labels arrive on the FIRST search, anchored by the sought
        // KEY over the loaded rows (#614) — the control awaits `find` and then
        // calls `listRange`, which used to answer from state captured before
        // the search existed (empty), and to index a ROW array by an ELEMENT
        // delta (the answer's row 12) when it didn't.
        await waitFor(() => expect(screen.getByRole("option", { name: "l2m9" })).toBeTruthy());
    });

    test("a source WITHOUT seek keeps `search` as a scope-badged row filter", async () => {
        initializeStore(new UIStore());
        const w0 = [planRow("m1", spanKind([run("r1", W27, new Date("2026-07-13Z"), variant("actual", null))]))];
        const source = {
            page: (offset: bigint) => (offset === 0n ? some(w0) : none),
            total: () => some(600n),
            id: "dom-test-noseek",
            seek: none,
            revision: () => none,
            refresh: () => null,
        };
        const cfg = {
            fields: new Map<string, unknown>(), rangeFieldId: none,
            searchFieldIds: [], breakdownFieldIds: [],
        };
        const initial = {
            range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
            breakdown: none, search: none, visible: none, selectedIndex: none, resolution: none,
        };
        const handle = buildSliceHandle("plan.noseek", cfg as never, initial as never, [] as never, none) as never;
        const { container } = renderPlan(planRoot([], {
            source,
            slice: some({ slice: handle, affordances: [variant("search", null)] }),
        }), "plan-noseek");
        await screen.findByText("R1");

        expect(container.querySelector('[data-part="dataset-key-search"]')).toBeNull();
        // An Array-backed source cannot be searched, so `search` still filters
        // — of the loaded prefix, which is what the badge says.
        expect(container.querySelector('[data-slot="scopeBadge"]')!.textContent).toBe("loaded rows only");
    });

    test("a source far larger than the window cache STOPS at its budget instead of emptying (#581)", async () => {
        // The runtime retains a bounded number of decoded windows across all
        // paged sources. A reader that walks past that asks the cache to hold
        // more than it can: each landing evicted the coldest window, which was
        // the head the reader needs next pass, so the canvas blinked empty and
        // reloaded forever past ~4,800 elements. The prefix now stops at a
        // stated budget and the chrome reports the shortfall.
        //
        // The demand is the VIEWPORT's (#812): window 0 fills the 768px jsdom
        // window, so the canvas asks for window 0's ring and no further. A
        // canvas whose viewport showed unloaded space would load on — the
        // band says as much ("scroll to load").
        const w0 = [
            planRow("m1", spanKind([run("r1", W27, new Date("2026-07-13Z"), variant("actual", null))])),
            ...Array.from({ length: 29 }, (_u, i) => planRow(`f${i}`, spanKind([]))),
        ];
        const offsets: bigint[] = [];
        const source = {
            page: (offset: bigint) => {
                offsets.push(offset);
                return offset === 0n ? some(w0) : some([]);
            },
            // 40 windows — well past the runtime's retention cap.
            total: () => some(8000n),
            id: "dom-test-budget",
            seek: none,
            revision: () => none,
            refresh: () => null,
        };
        const { container } = renderPlan(planRoot([], { source }), "plan-budget");
        await screen.findByText("R1");

        // It walked a bounded prefix, not the whole source.
        const highest = offsets.reduce((a, b) => (b > a ? b : a), 0n);
        expect(highest).toBeLessThan(8000n);
        // ... and says so, rather than showing a blank canvas or claiming
        // the whole source landed.
        const line = container.querySelector('[data-slot="footerTransport"]')!;
        expect(line.textContent).toMatch(/loaded of 8,000$/);
        expect(line.getAttribute("data-partial")).toBe("");
        // The rows it did load are still there — the failure mode was that they
        // vanished on the next evaluation.
        expect(container.querySelector(rowSel("m1"))).toBeTruthy();
    });

    test("the unloaded remainder renders as ONE band, sized by the ledger (#577)", async () => {
        // Not one skeleton per row: the canvas cannot know how many rows an
        // unvisited window makes, so a per-row skeleton would assert a count it
        // has no way to support. One band, captioned with what IS known — the
        // source ELEMENTS it covers. (Window 0 fills the jsdom viewport, so
        // the demand rests on its ring and the band stays — #812.)
        const w0 = [
            planRow("m1", spanKind([run("r1", W27, new Date("2026-07-13Z"), variant("actual", null))])),
            ...Array.from({ length: 29 }, (_u, i) => planRow(`f${i}`, spanKind([]))),
        ];
        const source = {
            page: (offset: bigint) => (offset === 0n ? some(w0) : some([])),
            total: () => some(10_000n),          // 50 windows
            id: "dom-test-band",
            seek: none,
            revision: () => none,
            refresh: () => null,
        };
        // Unbounded, like the other Plan DOM tests: jsdom has no layout, so a
        // bounded frame would virtualize down to nothing. (Below 400 body
        // items an unbounded canvas mounts every one, band included.)
        const { container } = renderPlan(planRoot([], { source }), "plan-band");
        await screen.findByText("R1");

        const band = container.querySelector('[data-plan-window-band="tail"]');
        expect(band).toBeTruthy();
        // It reports ELEMENTS, never a row count.
        expect(Number(band!.getAttribute("data-plan-elements"))).toBeGreaterThan(9_000);
        expect(band!.textContent).toMatch(/more elements — scroll to load/);
        // Nothing above the first window, so no head band.
        expect(container.querySelector('[data-plan-window-band="head"]')).toBeNull();
    });

    test("a parent whose members are NOT resident still renders, and claims nothing (#577)", async () => {
        // A section header (`Plan.series.section`) is emitted by every window
        // whether or not that window holds any of its members, so a section
        // can be resident with none of its members (#822: the one parent whose
        // members span windows). It must render — it is wayfinding — and it
        // must not print `0 rs`, which would be a measured-looking claim about
        // rows that simply have not loaded.
        const w0 = [
            planRow("chrome", variant("group", { summary: variant("none", null) }),
                { id: sectionId("chrome"), gutter: gutter("Line 9") }),
            planRow("m1", spanKind([run("r1", W27, new Date("2026-07-13Z"), variant("actual", null))])),
        ];
        const source = {
            page: (offset: bigint) => (offset === 0n ? some(w0) : none),
            total: () => some(10_000n),
            id: "dom-test-lonely-parent",
            seek: none,
            revision: () => none,
            refresh: () => null,
        };
        const { container } = renderPlan(planRoot([], { source }), "plan-lonely");
        await screen.findByText("R1");

        const band = container.querySelector(sectionSel("chrome"));
        expect(band).toBeTruthy();
        expect(screen.getByText("Line 9")).toBeTruthy();
        // No member count at all — not `0 rs`, and not `~0 rs`.
        expect(band!.textContent).not.toMatch(/\d+\s*rs/);
        // And the canvas says its numbers are over a prefix.
        expect(band!.getAttribute("data-plan-partial")).toBe("");
    });

    test("ledger heights are the AT-REST render — declared collapse applied, pinned rows excluded (#613)", async () => {
        // Window 0: a declared-collapsed group hiding 20 members, 15 plain
        // rows and a pinned row (it renders in the header). Its at-rest body
        // height is GROUP_H + 15×ROW_H = 506px — NOT the 1,178px the flat row
        // list costs. The ledger seeds its frozen slot rate from this FIRST
        // measurement (506 / 200 elements), so the never-visited remainder —
        // two windows, 400 elements — must describe itself as 1,012px. The
        // old measure (every row at full height, pinned included) would have
        // said 2,356. (Fifteen rows put the jsdom viewport's center inside
        // window 0, so the demand rests on its ring and windows 3–4 stay a
        // band — #812.)
        const w0 = [
            planRow("g1", variant("group", { summary: variant("none", null) }), { collapsed: true }),
            ...Array.from({ length: 20 }, (_u, i) => planRow(`m${i}`, spanKind([]), { parent: "g1" })),
            ...Array.from({ length: 15 }, (_u, i) => planRow(`p${i}`, spanKind([]))),
            { ...planRow("pin", spanKind([])), pinned: true } as PlanWireRow,
        ];
        const source = {
            page: (offset: bigint) => {
                if (offset === 0n) return some(w0);
                if (offset === 200n) return some([planRow("w1", spanKind([]))]);
                if (offset === 400n) return some([planRow("w2", spanKind([]))]);
                return some([]);
            },
            total: () => some(1_000n),                    // 5 windows; [0..2] land
            id: "dom-test-rest-height",
            seek: none,
            revision: () => none,
            refresh: () => null,
        };
        const { container } = renderPlan(planRoot([], { source }), "plan-rest-height");
        await screen.findByText("p0");

        await waitFor(() => {
            const band = container.querySelector('[data-plan-window-band="tail"]');
            expect(band).not.toBeNull();
            expect(band!.getAttribute("data-plan-px")).toBe("1012");
        });
        // The window renders the way it was measured: collapsed, pin in header.
        expect(container.querySelector(rowSel("m0"))).toBeNull();
        expect(container.querySelector(rowSel("g1", "data-plan-group"))).toBeTruthy();
    });

    test("a source that cannot be READ says why where its rows would be — never a blank axis (#567 D10, #811)", async () => {
        // There is no offline stand-in for `Data.bindPaged` — paging is a server
        // capability — so a bound canvas rendered outside a workspace has
        // nothing to read. Drawing an empty axis reads as "this dataset is
        // empty", a lie about the data. Since #811 the failure is LOCAL: the
        // window that could not be read is a band carrying the reason and a
        // Retry, and the source's own failure is a toolbar chip — the canvas
        // itself stays up.
        const boom = (): never => { throw new Error("no paging service — resolves only inside a live workspace"); };
        const source = {
            page: boom,
            total: boom,
            id: "dom-test-unreadable",
            seek: none,
            revision: () => none,
            refresh: () => null,
        };
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const { container } = renderPlan(planRoot([], { source }), "plan-d10");
            const band = await waitFor(() => {
                const el = container.querySelector('[data-plan-failed="0"]');
                expect(el).toBeTruthy();
                return el!;
            });
            // The reason travels with it — not just to the console.
            expect(band.textContent).toMatch(/could not be read — no paging service/);
            expect(band.querySelector('[data-plan-retry="0"]')).toBeTruthy();
            expect(container.querySelector('[data-plan-diagnostics="source"]')!.textContent)
                .toMatch(/source unavailable — no paging service/);
            // No rows are claimed: nothing drawn reads as an empty dataset.
            expect(container.querySelector("[data-plan-body]")).toBeTruthy();
            expect(container.querySelector("[data-plan-row]")).toBeNull();
        } finally {
            err.mockRestore();
        }
    });
    test("a new source revision swaps the rows in place — no empty frame, no remount (#821)", async () => {
        // A tracker with explicit channels: the canvas subscribes to what its
        // reads touched — the source's revision and its windows — as it does
        // to the paged runtime's channels.
        const subs = new Map<string, Set<() => void>>();
        let recording: string[] | null = null;
        const tracker: ReactiveTracker = {
            id: "plan-revision-dom",
            enableTracking() { recording = []; },
            disableTracking() { const r = recording ?? []; recording = null; return r; },
            getStore: () => ({
                subscribe(key, cb) {
                    const set = subs.get(key) ?? new Set<() => void>();
                    set.add(cb);
                    subs.set(key, set);
                    return () => { set.delete(cb); };
                },
                getKeyVersion: () => 0,
            }),
        };
        const fire = (key: string) => { for (const cb of [...(subs.get(key) ?? [])]) cb(); };
        const unregister = registerReactiveTracker(tracker);
        // The dataset's content at a revision: one machine whose run is
        // labelled by the revision that served it.
        const state = { revision: "A", open: new Set(["A"]) };
        const rowsAt = (rev: string) => [
            planRow("m1", spanKind([run(`${rev.toLowerCase()}1`, W27, new Date("2026-07-13Z"), variant("actual", null))])),
        ];
        const source = {
            page: (offset: bigint) => {
                recording?.push("window");
                if (!state.open.has(state.revision)) return none;
                return offset === 0n ? some(rowsAt(state.revision)) : some([]);
            },
            total: () => (state.open.has(state.revision) ? some(1n) : none),
            id: "dom-test-revision",
            seek: none,
            revision: () => {
                recording?.push("revision");
                return some(state.revision);
            },
            refresh: () => null,
        };
        try {
            const { container } = renderPlan(planRoot([], { source }), "plan-revision");
            await screen.findByText("A1");
            const row = container.querySelector(rowSel("m1"));
            expect(row).toBeTruthy();
            // The dataset is written: the source serves B, its window in flight.
            state.revision = "B";
            act(() => { fire("revision"); });
            // The old rows stand in — the canvas is never emptied.
            expect(container.querySelector(rowSel("m1"))).toBe(row);
            expect(screen.getByText("A1")).toBeTruthy();
            // B's window lands: the same row swaps its content in place.
            state.open.add("B");
            act(() => { fire("window"); });
            await screen.findByText("B1");
            expect(screen.queryByText("A1")).toBeNull();
            expect(container.querySelector(rowSel("m1"))).toBe(row);
        } finally {
            unregister();
        }
    });
});
