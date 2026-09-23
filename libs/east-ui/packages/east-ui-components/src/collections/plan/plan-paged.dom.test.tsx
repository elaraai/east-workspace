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
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { buildSliceHandle } from "../../platform/slice/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { EastChakraPlan, type PlanRootValue, type PlanRowValue } from "./index.js";
import type { PlanInstantValue } from "./instant.js";

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

function run(key: string, start: Date, end: Date, state: unknown, opts?: { quantity?: string; stuck?: boolean; qty?: number }) {
    return {
        key, start: t(start), end: t(end), label: key.toUpperCase(),
        quantity: opts?.quantity !== undefined ? some(opts.quantity) : none,
        qty: opts?.qty !== undefined ? some(opts.qty) : none,
        state,
        status: opts?.stuck === true ? some(variant("warning", null)) : none,
        moved: none, icon: none,
    };
}

function gutter(label: string, opts?: { sub?: string; value?: string; meta?: string; id?: boolean }) {
    return {
        label,
        id: opts?.id === true ? some(true) : none,
        sub: opts?.sub !== undefined ? some(opts.sub) : none,
        value: opts?.value !== undefined ? some(opts.value) : none,
        meta: opts?.meta !== undefined ? some(opts.meta) : none,
        stacked: none,
        swatches: [],
    };
}

function planRow(key: string, kind: unknown, opts?: { parent?: string; gutter?: unknown; expand?: unknown }): PlanRowValue {
    return {
        key,
        parent: opts?.parent !== undefined ? some(opts.parent) : none,
        gutter: opts?.gutter ?? gutter(key),
        kind,
        pinned: none, height: none, status: none, approval: none,
        expand: opts?.expand !== undefined ? some(opts.expand) : none,
    } as unknown as PlanRowValue;
}

function spanKind(runs: unknown[], opts?: { rollup?: string; unit?: string }) {
    return variant("span", {
        runs, decisions: [], ports: [],
        rollup: opts?.rollup !== undefined ? some(variant(opts.rollup, null)) : none,
        unit: opts?.unit !== undefined ? some(opts.unit) : none,
    });
}

/** The decoded row COLLECTION — the IR's `Dict<String, PlanRow>` (#568). A
 *  plain `Map` stands in for the decoder's `SortedMap`: the renderer only
 *  iterates it, and INSERTION order keeps these fixtures readable in the order
 *  they are written. Key ORDER itself is covered in `derive.test.ts`. */
function rowCollection(rows: PlanRowValue[]): Map<string, PlanRowValue> {
    return new Map(rows.map((r) => [r.key, r]));
}

function planRoot(rows: PlanRowValue[], opts?: { footer?: unknown[]; now?: Date | undefined; slice?: unknown; resolutions?: unknown[]; links?: unknown[]; popover?: unknown; hover?: unknown; expandRender?: unknown; source?: unknown; pick?: unknown; axis?: unknown; style?: { height?: string; maxHeight?: string }; clicks?: { onRunClick?: unknown; onEventClick?: unknown; onMarkClick?: unknown; onChipClick?: unknown; onCellClick?: unknown } }): PlanRootValue {
    return {
        rows: opts?.source !== undefined ? variant("paged", opts.source) : variant("inline", rowCollection(rows)),
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
        id: "", sources: [], onDrag: none, canDrop: none,
        onSelect: none,
        onRunClick: opts?.clicks?.onRunClick !== undefined ? some(opts.clicks.onRunClick) : none,
        onEventClick: opts?.clicks?.onEventClick !== undefined ? some(opts.clicks.onEventClick) : none,
        onMarkClick: opts?.clicks?.onMarkClick !== undefined ? some(opts.clicks.onMarkClick) : none,
        onChipClick: opts?.clicks?.onChipClick !== undefined ? some(opts.clicks.onChipClick) : none,
        onCellClick: opts?.clicks?.onCellClick !== undefined ? some(opts.clicks.onCellClick) : none,
        onGroupToggle: none, onGrainChange: none,
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
                return offset === 0n ? some(rowCollection(w1)) : some(rowCollection([]));
            },
            total: () => none,
            // The contract's comparable identity + seek capability (#567): a
            // fixture source is not key-ordered, so it declares no seek.
            id: "dom-test",
            seek: none,
        };
        const { container } = renderPlan(planRoot([], { source }));
        // The loader streams the prefix in an effect — rows appear after it.
        await screen.findByText("R1");
        expect(container.querySelector('[data-plan-row="m1"]')).toBeTruthy();
        expect(container.querySelector('[data-plan-row="m2"]')).toBeTruthy();
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
                if (offset === 0n) return some(rowCollection(w0));
                if (offset === 200n) return some(rowCollection([]));   // filtered to nothing
                if (offset === 400n) return some(rowCollection(w2));
                return some(rowCollection([]));
            },
            // 600 source elements ⇒ three windows, whatever any window yields.
            total: () => some(600n),
            id: "dom-test-filtered",
            seek: none,
        };
        const { container } = renderPlan(planRoot([], { source }), "plan-d2");
        await screen.findByText("R1");
        // The row from AFTER the empty window is what the old loader lost.
        await screen.findByText("R3");
        expect(container.querySelector('[data-plan-row="m3"]')).toBeTruthy();
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
            page: (offset: bigint) => (offset === 0n ? some(rowCollection(w0)) : none),
            total: () => some(600n),
            id: "dom-test-transport",
            seek: none,
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
            page: (offset: bigint) => (offset === 0n ? some(rowCollection(rows)) : some(rowCollection([]))),
            total: () => some(2n),
            id: "dom-test-exhausted",
            seek: none,
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

    test("derived numbers over a partial prefix are MARKED, not printed as final", async () => {
        // A group's member count is a renderer-derived aggregate (#568). Over a
        // loaded prefix it is an understatement, so it prints `~2 rs` and the
        // band carries `data-plan-partial` — the author's own `meta` is never
        // rewritten, since that is their text rather than a derivation.
        const w0 = [
            planRow("g1", variant("group", { summary: none, summaryAggregate: none, collapsed: none }),
                { gutter: gutter("Line 1") }),
            planRow("m1", spanKind([run("r1", W27, new Date("2026-07-13Z"), variant("actual", null))]), { parent: "g1" }),
            planRow("m2", spanKind([run("r2", W27, new Date("2026-07-13Z"), variant("actual", null))]), { parent: "g1" }),
        ];
        const source = {
            page: (offset: bigint) => (offset === 0n ? some(rowCollection(w0)) : none),
            total: () => some(600n),
            id: "dom-test-partial",
            seek: none,
        };
        const { container } = renderPlan(planRoot([], { source }), "plan-d9-partial");
        await screen.findByText("R1");

        const band = container.querySelector('[data-plan-group="g1"]')!;
        expect(band.getAttribute("data-plan-partial")).toBe("");
        expect(screen.getByText("~2 rs")).toBeTruthy();
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
            page: (offset: bigint) => (offset === 0n ? some(rowCollection(w0)) : none),
            total: () => some(600n),
            id: "dom-test-chrome",
            seek: none,
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
            page: (offset: bigint) => (offset === 0n ? some(rowCollection(w0)) : none),
            total: () => some(600n),
            id: "dom-test-seek",
            // The compiled handle's `seek` — `some(fn)` for a key-ordered
            // source. It answers in SOURCE ELEMENT indices.
            seek: some((q: { type: string; value: unknown }) => {
                queries.push(q);
                return some({ found: true, row: 12n, count: 3n });
            }),
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
            page: (offset: bigint) => (offset === 0n ? some(rowCollection(w0)) : none),
            total: () => some(600n),
            id: "dom-test-noseek",
            seek: none,
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
                return offset === 0n ? some(rowCollection(w0)) : some(rowCollection([]));
            },
            // 40 windows — well past the runtime's retention cap.
            total: () => some(8000n),
            id: "dom-test-budget",
            seek: none,
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
        expect(container.querySelector('[data-plan-row="m1"]')).toBeTruthy();
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
            page: (offset: bigint) => (offset === 0n ? some(rowCollection(w0)) : some(rowCollection([]))),
            total: () => some(10_000n),          // 50 windows
            id: "dom-test-band",
            seek: none,
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
        // Literal chrome (`Plan.series.rows`) is emitted by every window whether
        // or not that window holds any of its members, so a group parent can be
        // resident with none of its children. It must render — it is wayfinding
        // — and it must not print `0 rs`, which would be a measured-looking
        // claim about rows that simply have not loaded.
        const w0 = [
            planRow("chrome", variant("group", { summary: none, summaryAggregate: none, collapsed: none }),
                { gutter: gutter("Line 9") }),
            planRow("m1", spanKind([run("r1", W27, new Date("2026-07-13Z"), variant("actual", null))])),
        ];
        const source = {
            page: (offset: bigint) => (offset === 0n ? some(rowCollection(w0)) : none),
            total: () => some(10_000n),
            id: "dom-test-lonely-parent",
            seek: none,
        };
        const { container } = renderPlan(planRoot([], { source }), "plan-lonely");
        await screen.findByText("R1");

        const band = container.querySelector('[data-plan-group="chrome"]');
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
            planRow("g1", variant("group", { summary: none, summaryAggregate: none, collapsed: some(true) })),
            ...Array.from({ length: 20 }, (_u, i) => planRow(`m${i}`, spanKind([]), { parent: "g1" })),
            ...Array.from({ length: 15 }, (_u, i) => planRow(`p${i}`, spanKind([]))),
            { ...planRow("pin", spanKind([])), pinned: some(true) } as PlanRowValue,
        ];
        const source = {
            page: (offset: bigint) => {
                if (offset === 0n) return some(rowCollection(w0));
                if (offset === 200n) return some(rowCollection([planRow("w1", spanKind([]))]));
                if (offset === 400n) return some(rowCollection([planRow("w2", spanKind([]))]));
                return some(rowCollection([]));
            },
            total: () => some(1_000n),                    // 5 windows; [0..2] land
            id: "dom-test-rest-height",
            seek: none,
        };
        const { container } = renderPlan(planRoot([], { source }), "plan-rest-height");
        await screen.findByText("p0");

        await waitFor(() => {
            const band = container.querySelector('[data-plan-window-band="tail"]');
            expect(band).not.toBeNull();
            expect(band!.getAttribute("data-plan-px")).toBe("1012");
        });
        // The window renders the way it was measured: collapsed, pin in header.
        expect(container.querySelector('[data-plan-row="m0"]')).toBeNull();
        expect(container.querySelector('[data-plan-group="g1"]')).toBeTruthy();
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
});
