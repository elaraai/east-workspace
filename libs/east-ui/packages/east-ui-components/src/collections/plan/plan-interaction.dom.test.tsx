/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Plan interaction DOM tests — selection and the esc ladder, the hover
 * cursor as DOM chrome (#609), element clicks and the keyboard rungs (#569),
 * the #615 interaction fixes, and the root's element resolvers (popover /
 * hover).
 *
 * (Split out of `plan.dom.test.tsx`, #815: every test moved verbatim.)
 */

import { describe, test, expect, afterEach } from "vitest";
import { Profiler } from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
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

describe("Plan selection + esc ladder", () => {
    test("click selects (data-selected); re-clicking holds; esc deselects", () => {
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([]))]));
        const row = () => container.querySelector('[data-plan-row="m1"]')!;
        fireEvent.click(row());
        expect(row().hasAttribute("data-selected")).toBe(true);
        fireEvent.click(row());
        expect(row().hasAttribute("data-selected")).toBe(true);
        const surface = container.querySelector('[tabindex="0"]')!;
        fireEvent.keyDown(surface, { key: "Escape" });
        expect(row().hasAttribute("data-selected")).toBe(false);
    });
});

describe("Plan hover cursor is DOM chrome (#609)", () => {
    const stubRect = (el: HTMLElement) => Object.defineProperty(el, "getBoundingClientRect", {
        value: () => ({ left: 0, top: 0, right: 1000, bottom: 32, width: 1000, height: 32, x: 0, y: 0, toJSON: () => ({}) }),
    });

    test("the hairline + ruler chip track the pointer through DIRECT DOM writes, across rows", () => {
        const { container } = renderPlan(planRoot([
            planRow("m1", spanKind([])),
            planRow("m2", spanKind([])),
            planRow("m3", spanKind([])),
        ]), "plan-609-cursor");
        const body = container.querySelector("[data-plan-body]") as HTMLElement;
        // One hairline element per data row, hidden until a plot is hovered —
        // all of them position from the body's ONE `--plan-cursor-x` variable.
        expect(container.querySelectorAll("[data-plan-cursorline]")).toHaveLength(3);
        expect(body.hasAttribute("data-plan-cursor")).toBe(false);

        const plot = container.querySelector('[data-plan-row="m1"]')!.children[1] as HTMLElement;
        stubRect(plot);
        fireEvent.pointerMove(plot, { clientX: 500 });
        expect(body.hasAttribute("data-plan-cursor")).toBe(true);
        expect(body.style.getPropertyValue("--plan-cursor-x")).toBe("0.5");
        // The ruler chip names the hovered bucket: frac 0.5 of W27..W39 ⇒ W33.
        const chip = container.querySelector("[data-plan-cursorchip]") as HTMLElement;
        expect(chip.textContent).toBe("W33");
        expect(chip.style.display).not.toBe("none");

        // Crossing to ANOTHER row keeps tracking — same variable, same chip.
        const plot2 = container.querySelector('[data-plan-row="m3"]')!.children[1] as HTMLElement;
        stubRect(plot2);
        fireEvent.pointerMove(plot2, { clientX: 250 });
        expect(body.style.getPropertyValue("--plan-cursor-x")).toBe("0.25");
        expect(chip.textContent).toBe("W30");

        fireEvent.pointerLeave(plot2);
        expect(body.hasAttribute("data-plan-cursor")).toBe(false);
        expect(chip.style.display).toBe("none");
    });

    test("a pointermove COMMITS NOTHING — profiler-verified O(0) renders per event", () => {
        // The issue's measurement: one full-canvas commit per pointermove,
        // linear in mounted rows (91.5ms per move at 200 rows). The cursor is
        // DOM chrome now, so the property under test is stronger than the
        // O(1)-rows criterion: ZERO React commits per pointer event.
        const commits: string[] = [];
        const rows = Array.from({ length: 30 }, (_u, i) => planRow(`r${i}`, spanKind([])));
        const { container } = render(
            <ChakraProvider value={system}>
                <Profiler id="plan-609" onRender={(_id, phase) => { commits.push(phase); }}>
                    <EastChakraPlan value={planRoot(rows)} storageKey="plan-609-profiler" />
                </Profiler>
            </ChakraProvider>,
        );
        const plot = container.querySelector('[data-plan-row="r0"]')!.children[1] as HTMLElement;
        stubRect(plot);
        const before = commits.length;
        for (let x = 100; x <= 900; x += 100) fireEvent.pointerMove(plot, { clientX: x });
        expect(commits.length).toBe(before);
        // ... and the chrome still tracked: the writes happened, renders did not.
        const body = container.querySelector("[data-plan-body]") as HTMLElement;
        expect(body.style.getPropertyValue("--plan-cursor-x")).toBe("0.9");
    });
});

function bucketEvent(key: string, at: Date, state: unknown, opts?: { lane?: string; label?: string; stretch?: string; tone?: string }) {
    return {
        key, at: t(at),
        lane: opts?.lane !== undefined ? some(opts.lane) : none,
        label: opts?.label !== undefined ? some(opts.label) : none,
        icon: none, state,
        tone: opts?.tone !== undefined ? some(variant(opts.tone, null)) : none,
        color: none, colorPalette: none,
        stretch: opts?.stretch !== undefined ? some(variant(opts.stretch, null)) : none,
        content: none, animation: none,
    };
}

describe("Plan element clicks (#569)", () => {
    test("each element kind reports its click ref to the right callback — and still selects", async () => {
        const seen: Record<string, unknown[]> = { run: [], event: [], mark: [], chip: [], cell: [] };
        const at = new Date("2026-06-29Z");
        const { container } = renderPlan(planRoot([
            planRow("s", spanKind([run("r1", W27, new Date("2026-07-13Z"), variant("actual", null))])),
            planRow("b", variant("buckets", {
                lanes: [], events: [bucketEvent("e1", at, variant("confirmed", null))], markers: [],
            })),
            planRow("e", variant("events", {
                marks: [{ key: "k1", at: t(at), kind: variant("milestone", null), icon: none, label: none }],
            })),
            planRow("c", variant("cards", {
                chips: [{ key: "c1", from: t(W27), to: t(new Date("2026-07-13Z")), label: "D. OKAFOR",
                    state: variant("confirmed", null), icon: none }],
            })),
            planRow("h", variant("heat", {
                cells: variant("heat", {
                    cells: [{ at: t(at), value: some(80), label: some("80") }],
                    min: some(0), max: some(100), warnAt: none,
                }),
                aggregate: none,
            })),
        ], {
            clicks: {
                onRunClick: (e: unknown) => { seen["run"]!.push(e); },
                onEventClick: (e: unknown) => { seen["event"]!.push(e); },
                onMarkClick: (e: unknown) => { seen["mark"]!.push(e); },
                onChipClick: (e: unknown) => { seen["chip"]!.push(e); },
                onCellClick: (e: unknown) => { seen["cell"]!.push(e); },
            },
        }), "plan-clicks-569");

        fireEvent.click(container.querySelector('[data-run="r1"]')!);
        fireEvent.click(container.querySelector('[data-event="e1"]')!);
        fireEvent.click(container.querySelector('[data-mark="k1"]')!);
        fireEvent.click(container.querySelector('[data-chip="c1"]')!);
        fireEvent.click(screen.getByText("80"));
        await waitFor(() => expect(seen["cell"]!.length).toBe(1));

        expect(seen["run"]).toEqual([{ row: "s", run: "r1" }]);
        expect(seen["event"]).toEqual([{ row: "b", event: "e1" }]);
        expect(seen["mark"]).toEqual([{ row: "e", mark: "k1" }]);
        expect(seen["chip"]).toEqual([{ row: "c", chip: "c1" }]);
        expect(seen["cell"]).toEqual([{ row: "h", at: t(at) }]);
        // The canvas behaviour is unchanged: the click also selected the row.
        expect(container.querySelector('[data-plan-row="h"]')!.hasAttribute("data-selected")).toBe(true);
    });
});

describe("Plan keyboard rungs (#569)", () => {
    const sliceFixture = (key: string) => {
        initializeStore(new UIStore());
        const cfg = {
            fields: new Map<string, unknown>([
                ["at", { type: "datetime", value: { label: "At", accessor: (r: { at: Date }) => r.at, format: none } }],
            ]),
            rangeFieldId: some("at"), searchFieldIds: [], breakdownFieldIds: [],
        };
        const initial = {
            range: some(variant("datetime", { from: W27, to: W39 })),
            compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
            breakdown: none, search: none, visible: none, selectedIndex: none,
            resolution: some(variant("week", null)),
        };
        return buildSliceHandle(key, cfg as never, initial as never, [{ at: W27 }] as never, none) as never as {
            read(): { range: { value: { value: { from: Date; to: Date } } } };
        };
    };

    test("[ and ] PAN the window one period through the slice; n recenters on now — asserted on the WINDOW, not on emitted effects", () => {
        const handle = sliceFixture("plan.kbd.pan");
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([]))], {
            slice: some({ slice: handle, affordances: [] }),
        }), "plan-kbd-pan");
        const surface = container.querySelector('[tabindex="0"]')!;
        const range = () => handle.read().range.value.value;

        fireEvent.keyDown(surface, { key: "[" });
        expect(range().from.toISOString()).toBe("2026-06-22T00:00:00.000Z");
        expect(range().to.toISOString()).toBe("2026-09-14T00:00:00.000Z");
        fireEvent.keyDown(surface, { key: "]" });
        expect(range().from.toISOString()).toBe("2026-06-29T00:00:00.000Z");

        // n re-derives the window on period edges with the same column count,
        // now (Aug 12 → its Monday, W33) a third of the way in.
        fireEvent.keyDown(surface, { key: "n" });
        expect(range().from.toISOString()).toBe("2026-07-13T00:00:00.000Z");
        expect(range().to.toISOString()).toBe("2026-10-05T00:00:00.000Z");
    });

    test("without a slice the pan rungs idle — the declared window is not writable", () => {
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([]))]), "plan-kbd-unbound");
        fireEvent.keyDown(container.querySelector('[tabindex="0"]')!, { key: "[" });
        expect(screen.getByText("W27")).toBeTruthy();
        expect(screen.queryByText("W26")).toBeNull();
    });

    test("g cycles the grain — the reducer arm is finally reachable", () => {
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([]))]), "plan-kbd-grain");
        expect(screen.getAllByText("RESOURCE").length).toBeGreaterThan(0);
        fireEvent.keyDown(container.querySelector('[tabindex="0"]')!, { key: "g" });
        expect(screen.getAllByText("GROUP").length).toBeGreaterThan(0);
        fireEvent.keyDown(container.querySelector('[tabindex="0"]')!, { key: "g" });
        expect(screen.getAllByText("RESOURCE").length).toBeGreaterThan(0);
    });
});

describe("Plan interaction fixes (#615)", () => {
    test("neither a caption click nor a sub-threshold strip click leaves a phantom brush esc rung", () => {
        initializeStore(new UIStore());
        const cfg = {
            fields: new Map<string, unknown>([
                ["at", { type: "datetime", value: { label: "At", accessor: (r: { at: Date }) => r.at, format: none } }],
            ]),
            rangeFieldId: some("at"), searchFieldIds: [], breakdownFieldIds: [],
        };
        const initial = {
            range: some(variant("datetime", { from: W27, to: W39 })),
            compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
            breakdown: none, search: none, visible: none, selectedIndex: none,
            resolution: some(variant("week", null)),
        };
        const handle = buildSliceHandle("plan.brush.phantom", cfg as never, initial as never,
            [{ at: W27 }, { at: W39 }] as never, none) as never;
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([]))], {
            slice: some({ slice: handle, affordances: [variant("brush", null)] }),
        }), "plan-brush-phantom");

        // Select a row — the esc target a phantom rung would eat.
        fireEvent.click(container.querySelector('[data-plan-row="m1"]')!);
        expect(container.querySelector('[data-plan-row="m1"]')!.hasAttribute("data-selected")).toBe(true);

        // A caption click is not a brush gesture...
        const caption = screen.getByText(/^HORIZON/);
        fireEvent.pointerDown(caption, { pointerId: 1, buttons: 1 });
        fireEvent.pointerUp(caption, { pointerId: 1 });
        // ... and a sub-threshold strip click releases as a noop — the strip
        // emits neither commit nor clear, so the rung must settle on the UP.
        const track = container.querySelector("[data-brush-track]") as HTMLElement;
        Object.defineProperty(track, "getBoundingClientRect", {
            value: () => ({ left: 0, top: 0, right: 1000, bottom: 32, width: 1000, height: 32, x: 0, y: 0, toJSON: () => ({}) }),
        });
        fireEvent.pointerDown(track, { clientX: 300, pointerId: 1, buttons: 1 });
        fireEvent.pointerUp(track, { clientX: 302, pointerId: 1 });

        // ONE Escape clears the selection — nothing ate it.
        fireEvent.keyDown(container.querySelector('[tabindex="0"]')!, { key: "Escape" });
        expect(container.querySelector('[data-plan-row="m1"]')!.hasAttribute("data-selected")).toBe(false);
    });

    test("the resolution segment does not mount without a bound slice — its write has nowhere to go", () => {
        // A pick mounts the toolbar with no slice; the segment used to render
        // on `resolutions` alone, and clicking it dispatched a slice write the
        // effect runner drops. The unbound fallback story is #572's.
        const pick = {
            key: "plan.seg.gate",
            state: { read: () => [] as string[], write: () => {}, has: () => true },
            items: [{ id: "a", title: "Machine jobs", subtitle: none, icon: none, count: none, narrowed: false }],
        };
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([]))], {
            pick,
            resolutions: [variant("week", null), variant("day", null)],
        }), "plan-seg-gate");
        expect(container.querySelector("[data-slot='toolbar']")).not.toBeNull();
        expect(container.querySelector("[data-slot='seg']")).toBeNull();
        expect(screen.queryByText("DAY")).toBeNull();
    });
});


describe("Plan element resolvers (popover / hover)", () => {
    test("the root popover resolver opens per ref — a some body for the named run, none opens nothing", async () => {
        const refs: string[] = [];
        const popover = (ref: { type: string; value: { row: string; run?: string } }) => {
            refs.push(`${ref.type}:${ref.value.row}/${ref.value.run}`);
            if (ref.type === "run" && ref.value.run === "b214") {
                return some(variant("Text", { value: "RUN DETAIL · B-214", style: none }));
            }
            return none;
        };
        const { container } = renderPlan(planRoot([
            planRow("m1", spanKind([
                run("b214", W27, new Date("2026-07-27Z"), variant("actual", null)),
                run("other", new Date("2026-07-27Z"), new Date("2026-08-10Z"), variant("confirmed", null)),
            ])),
        ], { popover }));
        const user = userEvent.setup();
        // The none-resolving run FIRST — the resolver ran, nothing opened
        // (lazy per-ref presence; no empty surface ever flashes).
        await user.click(container.querySelector('[data-run="other"]')!);
        expect(refs).toContain("run:m1/other");
        expect(screen.queryByText("RUN DETAIL · B-214")).toBeNull();
        // The named run resolves some — the popover opens with the body, and
        // the ref carried the element kind + row + run keys.
        await user.click(container.querySelector('[data-run="b214"]')!);
        expect(await screen.findByText("RUN DETAIL · B-214")).toBeTruthy();
        expect(refs).toContain("run:m1/b214");
    });

    test("without declared resolvers no overlay machinery mounts", () => {
        const { container } = renderPlan(planRoot([
            planRow("m1", spanKind([run("r1", W27, new Date("2026-07-27Z"), variant("actual", null))])),
        ]));
        // The bar renders bare — no popover/hovercard trigger wrappers.
        expect(container.querySelector('[data-run="r1"]')).toBeTruthy();
        expect(container.querySelector("[data-scope=\"popover\"]")).toBeNull();
        expect(container.querySelector("[data-scope=\"hover-card\"]")).toBeNull();
    });
});
