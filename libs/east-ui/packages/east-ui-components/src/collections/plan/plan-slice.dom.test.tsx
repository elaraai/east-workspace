/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Plan slice chrome DOM tests — the resolution zoom (§3), the horizon
 * brush's per-step live application (§7 / #620), chrome that tracks the
 * slice store (#611), sizing (#320 / #567 D1), and the series library as
 * toolbar chrome (#590).
 *
 * (Split out of `plan.dom.test.tsx`, #815: every test moved verbatim.)
 */

import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { buildSliceHandle } from "../../platform/slice/index.js";
import { initializeStore, getStore } from "../../platform/state-runtime.js";
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

describe("Plan resolution zoom (§3)", () => {
    test("switching resolution zooms the window to preserve the column count", () => {
        initializeStore(new UIStore());
        const cfg = {
            fields: new Map<string, unknown>([
                ["at", variant("datetime", { label: "At", accessor: (r: { at: Date }) => r.at, format: none })],
            ]),
            rangeFieldId: some("at"), searchFieldIds: [], breakdownFieldIds: [],
        };
        const initial = {
            range: some(variant("datetime", { from: W27, to: W39 })),           // 12 week columns
            compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
            breakdown: none, search: none, visible: none, selectedIndex: none,
            resolution: some(variant("week", null)),
        };
        const handle = buildSliceHandle("plan.zoom", cfg as never, initial as never, [{ at: W27 }] as never, none) as never as {
            read(): { resolution: { value: { type: string } }; range: { value: { value: { from: Date; to: Date } } } };
        };
        renderPlan(planRoot([planRow("m1", spanKind([]))], {
            slice: some({ slice: handle, affordances: [variant("resolution", null)] }),
            resolutions: [variant("week", null), variant("day", null)],
        }));
        fireEvent.click(screen.getByText("DAY"));
        const st = handle.read();
        expect(st.resolution.value.type).toBe("day");
        const r = st.range.value.value;
        expect(r.from.getTime()).toBe(W27.getTime());
        // 12 columns preserved: the window zoomed from 12 weeks to 12 days.
        expect((r.to.getTime() - r.from.getTime()) / 86_400_000).toBe(12);
    });
});

describe("Plan horizon brush — per-step live application (§7 / #620)", () => {
    const brushFixture = (key: string) => {
        initializeStore(new UIStore());
        const cfg = {
            fields: new Map<string, unknown>([
                ["at", variant("datetime", { label: "At", accessor: (r: { at: Date }) => r.at, format: none })],
            ]),
            rangeFieldId: some("at"), searchFieldIds: [], breakdownFieldIds: [],
        };
        const initial = {
            // Applied window W29..W33 (4 weeks) inside the wider horizon.
            range: some(variant("datetime", { from: new Date("2026-07-13T00:00:00Z"), to: new Date("2026-08-10T00:00:00Z") })),
            compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
            breakdown: none, search: none, visible: none, selectedIndex: none,
            resolution: some(variant("week", null)),
        };
        // Data spans W27..W39 — a 12-week brushable domain (84 days).
        const handle = buildSliceHandle(key, cfg as never, initial as never,
            [{ at: W27 }, { at: W39 }] as never, none) as never as {
                read(): { range: { value: { value: { from: Date; to: Date } } } };
            };
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([]))], {
            slice: some({ slice: handle, affordances: [variant("brush", null)] }),
        }), key);
        const track = container.querySelector("[data-brush-track]") as HTMLElement;
        Object.defineProperty(track, "getBoundingClientRect", {
            value: () => ({ left: 0, top: 0, right: 1000, bottom: 32, width: 1000, height: 32, x: 0, y: 0, toJSON: () => ({}) }),
        });
        return { container, track, range: () => handle.read().range.value.value };
    };

    test("a SLIDE applies each snapped step to the slice — the canvas re-renders honestly mid-gesture", async () => {
        const { track, range } = brushFixture("plan-620-slide");
        // Grab the window body (166.7px..500px on the mocked track) and
        // slide +86px ≈ +1.03 weeks — the snapped draft steps one period,
        // and that step is APPLIED (rAF-coalesced): the mid-gesture canvas
        // IS the draft window, so grid / ruler / geometry stay truthful
        // (the reverted transform preview slid stale DOM instead — #620).
        fireEvent.pointerDown(track, { clientX: 300, pointerId: 1, buttons: 1 });
        fireEvent.pointerMove(track, { clientX: 386, pointerId: 1, buttons: 1 });
        await waitFor(() => expect(range().from.toISOString()).toBe("2026-07-20T00:00:00.000Z"));
        expect(range().to.toISOString()).toBe("2026-08-17T00:00:00.000Z");

        // Slide on to ≈ +2 weeks total and release — the commit lands the
        // same window the last step already applied.
        fireEvent.pointerMove(track, { clientX: 467, pointerId: 1, buttons: 1 });
        fireEvent.pointerUp(track, { pointerId: 1 });
        expect(range().from.toISOString()).toBe("2026-07-27T00:00:00.000Z");
        expect(range().to.toISOString()).toBe("2026-08-24T00:00:00.000Z");
    });

    test("an edge RESIZE applies its snapped steps too — a live zoom, no transform anywhere", async () => {
        const { track, range } = brushFixture("plan-620-resize");
        // Grab the HI handle (winTo = 500px on the mocked track) and drag it
        // left one snapped week: the draft narrows W29..W33 → W29..W32 and
        // the step applies — the canvas re-lays at the narrower window, a
        // REAL zoom (columns re-derive; no scaled text, no hidden chrome).
        fireEvent.pointerDown(track, { clientX: 500, pointerId: 1, buttons: 1 });
        fireEvent.pointerMove(track, { clientX: 420, pointerId: 1, buttons: 1 });
        await waitFor(() => expect(range().to.toISOString()).toBe("2026-08-03T00:00:00.000Z"));
        expect(range().from.toISOString()).toBe("2026-07-13T00:00:00.000Z");

        fireEvent.pointerUp(track, { pointerId: 1 });
        expect(range().from.toISOString()).toBe("2026-07-13T00:00:00.000Z");
        expect(range().to.toISOString()).toBe("2026-08-03T00:00:00.000Z");
    });
});

describe("Plan chrome tracks the slice store (#611)", () => {
    // The trap under test: `useSliceReactivity` re-renders the canvas when
    // the store moves, but a re-render does not bust a memo whose deps did
    // not move. On a CHROME-ONLY bound slice (rows not routed through it) a
    // state write changes no value identity, so store-read memos must key on
    // the store's own version.
    test("the toolbar summary re-derives on a store write that changes NO rows", () => {
        initializeStore(new UIStore());
        const cfg = {
            fields: new Map<string, unknown>([
                ["at", variant("datetime", { label: "At", accessor: (r: { at: Date }) => r.at, format: none })],
            ]),
            rangeFieldId: some("at"), searchFieldIds: [], breakdownFieldIds: [],
        };
        const initial = {
            range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
            breakdown: none, search: none, visible: none, selectedIndex: none,
            resolution: some(variant("week", null)),
        };
        // Two datable rows live in the SLICE; the canvas's own row is inline
        // and never narrows.
        const handle = buildSliceHandle("plan.summary.chrome", cfg as never, initial as never,
            [{ at: W27 }, { at: W39 }] as never, none) as never as { setRange(r: unknown): void };
        renderPlan(planRoot([planRow("m1", spanKind([]))], {
            slice: some({ slice: handle, affordances: [variant("summary", null)] }),
        }), "plan-611-summary");
        expect(screen.getByText(/^2 of 2/)).toBeTruthy();

        act(() => {
            handle.setRange(some(variant("datetime", { from: W27, to: NOW })));
        });
        expect(screen.getByText(/^1 of 2/)).toBeTruthy();
    });

    test("the Series count re-derives on a pick-store write that changes NO rows", async () => {
        initializeStore(new UIStore());
        const user = userEvent.setup();
        let hidden: string[] = [];
        const pick = {
            key: "plan.pick.zero-rows",
            state: { read: () => hidden, write: (n: string[]) => { hidden = n; }, has: () => true },
            items: [
                { id: "a", title: "Machine jobs", subtitle: none, icon: none, count: none, narrowed: false },
                { id: "b", title: "Line load", subtitle: none, icon: none, count: none, narrowed: false },
            ],
        };
        renderPlan(planRoot([planRow("m1", spanKind([]))], { pick }), "plan-611-pick");
        // The count rides the OPEN popover's head.
        await user.click(screen.getByRole("button", { name: "Series library" }));
        await waitFor(() => expect(screen.getByText("2 of 2")).toBeTruthy());

        // What a ZERO-ROW series toggle does: the state moves and the store
        // key notifies — no rows change, no value identity moves. The count
        // must re-read, not serve the mount-time value.
        act(() => {
            hidden = ["a"];
            getStore().write("plan.pick.zero-rows", new Uint8Array());
        });
        expect(screen.getByText("1 of 2")).toBeTruthy();
    });
});

describe("Plan sizing (#320 / #567 D1)", () => {
    // 60 single-run span rows — enough that virtualization is observable.
    const many = Array.from({ length: 60 }, (_unused, i) =>
        planRow(`r${i}`, spanKind([
            run(`x${i}`, new Date("2026-06-29Z"), new Date("2026-07-13Z"), variant("actual", null)),
        ])));

    test("a declared height binds the WRAPPER and virtualizes the body", () => {
        const { container } = renderPlan(planRoot(many, { style: { height: "fill" } }), "plan-bounded");
        const body = container.querySelector("[data-plan-body]")!;
        // The bound must land on the wrapper: a percentage passed inward
        // resolves against an auto-height parent and silently unbinds, leaving
        // every row in flow (#567 D1).
        expect(body.hasAttribute("data-plan-bounded")).toBe(true);
        expect(container.querySelectorAll("[data-plan-row]").length).toBeLessThan(many.length);
    });

    test("an explicit px height binds the same way", () => {
        const { container } = renderPlan(planRoot(many, { style: { height: "400px" } }), "plan-bounded-px");
        expect(container.querySelector("[data-plan-body]")!.hasAttribute("data-plan-bounded")).toBe(true);
        expect(container.querySelectorAll("[data-plan-row]").length).toBeLessThan(many.length);
    });

    test("maxHeight alone binds", () => {
        const { container } = renderPlan(planRoot(many, { style: { maxHeight: "50%" } }), "plan-bounded-max");
        expect(container.querySelector("[data-plan-body]")!.hasAttribute("data-plan-bounded")).toBe(true);
    });

    test("no declared size keeps the grow-to-content flow — every row in flow", () => {
        const { container } = renderPlan(planRoot(many), "plan-unbounded");
        const body = container.querySelector("[data-plan-body]")!;
        expect(body.hasAttribute("data-plan-bounded")).toBe(false);
        expect(container.querySelectorAll("[data-plan-row]").length).toBe(many.length);
    });
});

describe("the series library is TOOLBAR chrome (#590)", () => {
    /** A `PickBindType` closure — the whole surface the panel consumes. */
    function fakePick(hidden: string[] = []) {
        let st = [...hidden];
        return {
            key: "test.plan.pick",
            state: { read: () => st, write: (n: string[]) => { st = n; }, has: () => true },
            items: [
                { id: "a", title: "Machine jobs", subtitle: none, icon: none, count: none, narrowed: false },
                { id: "b", title: "Line load", subtitle: none, icon: none, count: none, narrowed: false },
                { id: "c", title: "Crew shifts", subtitle: none, icon: none, count: none, narrowed: false },
            ],
        };
    }

    test("a pick mounts the toolbar even with NO slice bound, and costs no canvas at rest", () => {
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([]))], { pick: fakePick() }));
        // The bar mounts for the library the way it already mounts for a
        // seek-capable source: neither is a slice, both need their chrome.
        expect(container.querySelector("[data-slot='toolbar']")).not.toBeNull();
        expect(container.querySelector("[data-slot='planLibraryTrigger']")).not.toBeNull();
        // Closed: the library takes NO width from the canvas — that is the
        // whole point of a trigger over a dock.
        expect(container.querySelector("[data-slot='pickPanel']")).toBeNull();
    });

    test("no pick, no trigger — and no toolbar conjured for one", () => {
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([]))]));
        expect(container.querySelector("[data-slot='planLibraryTrigger']")).toBeNull();
        expect(container.querySelector("[data-slot='toolbar']")).toBeNull();
    });

    test("the trigger opens the library, and the panel comes up FRAMELESS inside the popover", async () => {
        const user = userEvent.setup();
        renderPlan(planRoot([planRow("m1", spanKind([]))], { pick: fakePick(["c"]) }));
        await user.click(screen.getByRole("button", { name: "Series library" }));
        await waitFor(() => expect(document.querySelector("[data-slot='pickPanel']")).not.toBeNull());
        const panel = document.querySelector("[data-slot='pickPanel']") as HTMLElement;
        // The popover provides `editor` density — the house signal for "you are
        // inside the terminal surface" — and the panel drops its frame on that,
        // not on a flag the call site had to remember.
        expect(panel.getAttribute("data-density")).toBe("editor");
        expect(screen.getByText("Machine jobs")).toBeTruthy();
        // The count rides the popover's head, not the panel's.
        expect(screen.getByText("2 of 3")).toBeTruthy();
    });

    test("the list is SEARCHABLE, and searching never touches the hidden set", async () => {
        const user = userEvent.setup();
        const pick = fakePick();
        renderPlan(planRoot([planRow("m1", spanKind([]))], { pick }));
        await user.click(screen.getByRole("button", { name: "Series library" }));
        await waitFor(() => expect(document.querySelector("[data-slot='pickSearch']")).not.toBeNull());
        expect(screen.getByText("Machine jobs")).toBeTruthy();

        await user.type(screen.getByLabelText("Search series"), "crew");
        await waitFor(() => expect(screen.queryByText("Machine jobs")).toBeNull());
        expect(screen.getByText("Crew shifts")).toBeTruthy();
        // Filtering the LIST is not hiding a series — the canvas is untouched.
        expect(pick.state.read()).toEqual([]);

        // A query that matches nothing says so rather than showing a blank box.
        await user.clear(screen.getByLabelText("Search series"));
        await user.type(screen.getByLabelText("Search series"), "zzz");
        await waitFor(() => expect(document.querySelector("[data-slot='pickEmpty']")).not.toBeNull());

        // Clearing brings everything back.
        await user.click(screen.getByRole("button", { name: "Clear search" }));
        await waitFor(() => expect(screen.getByText("Machine jobs")).toBeTruthy());
    });

    test("two entries sharing an id are ONE switch — reported, and reconciled correctly", async () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        const user = userEvent.setup();
        let st: string[] = [];
        const pick = {
            key: "k",
            state: { read: () => st, write: (n: string[]) => { st = n; }, has: () => true },
            items: [
                { id: "dup", title: "First", subtitle: none, icon: none, count: none, narrowed: false },
                { id: "dup", title: "Second", subtitle: none, icon: none, count: none, narrowed: false },
            ],
        };
        renderPlan(planRoot([planRow("m1", spanKind([]))], { pick }));
        await user.click(screen.getByRole("button", { name: "Series library" }));
        await waitFor(() => expect(document.querySelector("[data-slot='pickPanel']")).not.toBeNull());

        // Both render — the list is an Array, so duplicates are constructable.
        expect(screen.getByText("First")).toBeTruthy();
        expect(screen.getByText("Second")).toBeTruthy();
        // React reconciles them: position keys them, so no duplicate-key warning
        // (the list re-renders on every search keystroke, where that would bite).
        expect(err.mock.calls.some((c) => String(c[0]).includes("same key"))).toBe(false);
        // ...but the panel SAYS the ids collide, because nothing can resolve it.
        expect(err.mock.calls.some((c) => String(c[0]).includes("duplicate item id"))).toBe(true);

        // And the semantics it warns about: one id, so one switch for both.
        await user.click(screen.getByLabelText("Toggle First"));
        expect(st).toEqual(["dup"]);
        err.mockRestore();
    });

    test("toggling inside the popover writes the hidden set", async () => {
        const user = userEvent.setup();
        const pick = fakePick();
        renderPlan(planRoot([planRow("m1", spanKind([]))], { pick }));
        await user.click(screen.getByRole("button", { name: "Series library" }));
        await waitFor(() => expect(document.querySelector("[data-slot='pickPanel']")).not.toBeNull());
        await user.click(screen.getByLabelText("Toggle Machine jobs"));
        expect(pick.state.read()).toEqual(["a"]);
    });
});
