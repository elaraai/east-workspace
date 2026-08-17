/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Plan renderer DOM tests — the recipe's `data-*` state contract: run bars
 * carry the §4.3 truth table on `data-state` (+ `data-stuck` /
 * `data-runoff`), rollup bands their `×k · qty` caption, the ruler its ISO
 * week ticks + NOW chip, group strips toggle their subtree in place, heat
 * cells carry `data-nodata` / `data-warn` / label flip, selection is the one
 * `data-selected` tint with the esc ladder clearing it, bucket tiles wear
 * the same truth table with lanes / markers, table numerals their tones +
 * derived subtotals + row emphasis, cards chips the lifecycle looks, and
 * event rows their kind glyphs.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { buildSliceHandle } from "../../platform/slice/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { EastChakraPlan, type PlanRootValue, type PlanRowValue } from "./index.js";

afterEach(cleanup);

// jsdom lacks ResizeObserver — the floating-ui positioner behind the
// resolver popovers needs one; a no-op stub keeps positioning inert (the
// slice / schematic dom-test convention).
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const W27 = new Date("2026-06-29T00:00:00Z");           // Monday, ISO week 27
const W39 = new Date("2026-09-21T00:00:00Z");           // exclusive max → 12 weeks
const NOW = new Date("2026-08-12T00:00:00Z");

function run(key: string, start: Date, end: Date, state: unknown, opts?: { quantity?: string; stuck?: boolean; qty?: number }) {
    return {
        key, start, end, label: key.toUpperCase(),
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
 *  they are written. Key ORDER itself is covered in `model.test.ts`. */
function rowCollection(rows: PlanRowValue[]): Map<string, PlanRowValue> {
    return new Map(rows.map((r) => [r.key, r]));
}

function planRoot(rows: PlanRowValue[], opts?: { footer?: unknown[]; now?: Date | undefined; slice?: unknown; resolutions?: unknown[]; links?: unknown[]; popover?: unknown; hover?: unknown; expandRender?: unknown; source?: unknown; style?: { height?: string; maxHeight?: string } }): PlanRootValue {
    return {
        rows: opts?.source !== undefined ? variant("paged", opts.source) : variant("inline", rowCollection(rows)),
        links: opts?.links ?? [],
        axis: {
            window: some({ min: W27, max: W39 }),
            resolution: variant("week", null),
            resolutions: opts?.resolutions ?? [],
            now: opts?.now !== undefined ? some(opts.now) : (opts && "now" in opts ? none : some(NOW)),
            format: none,
        },
        grain: none,
        library: [],
        popover: opts?.popover !== undefined ? some(opts.popover) : none,
        hover: opts?.hover !== undefined ? some(opts.hover) : none,
        expandRender: opts?.expandRender !== undefined ? some(opts.expandRender) : none,
        review: none,
        slice: opts?.slice ?? none,
        footer: opts?.footer ?? [],
        id: "", sources: [], onDrag: none, canDrop: none,
        onSelect: none,
        onRunClick: none, onEventClick: none, onMarkClick: none, onChipClick: none,
        onCellClick: none, onGroupToggle: none, onGrainChange: none,
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

describe("Plan span rows (§4·K1)", () => {
    test("run bars carry the state truth table on data-state, the stuck ring and the runoff mask", () => {
        const { container } = renderPlan(planRoot([
            planRow("m1", spanKind([
                run("obs1", new Date("2026-06-29Z"), new Date("2026-07-13Z"), variant("actual", null), { quantity: "96 t" }),
                run("appr1", new Date("2026-07-13Z"), new Date("2026-07-27Z"), variant("confirmed", null)),
                run("prop1", new Date("2026-07-27Z"), new Date("2026-08-10Z"), variant("proposed", variant("recommended", null)), { stuck: true }),
                run("ghost1", new Date("2026-08-10Z"), new Date("2026-08-24Z"), variant("estimated", null)),
                run("rej1", new Date("2026-08-24Z"), new Date("2026-08-31Z"), variant("rejected", null)),
                run("runoff1", new Date("2026-09-07Z"), new Date("2026-10-19Z"), variant("in-progress", null)),
            ])),
        ]));
        const states = Array.from(container.querySelectorAll("[data-run]"))
            .map((n) => [n.getAttribute("data-run"), n.getAttribute("data-state")]);
        expect(states).toContainEqual(["obs1", "obs"]);
        expect(states).toContainEqual(["appr1", "appr"]);
        expect(states).toContainEqual(["prop1", "prop"]);
        expect(states).toContainEqual(["ghost1", "estimated"]);
        expect(states).toContainEqual(["rej1", "rejected"]);
        expect(container.querySelector('[data-run="prop1"]')!.hasAttribute("data-stuck")).toBe(true);
        expect(container.querySelector('[data-run="runoff1"]')!.hasAttribute("data-runoff")).toBe(true);
        expect(screen.getByText("96 t")).toBeTruthy();
    });

    test("declared rollups render renderer-DERIVED ×k · qty band captions", () => {
        // Parent declares union + unit; the overlapping child runs derive one
        // ×2 band summing 146 t in the pessimistic (confirmed) state.
        renderPlan(planRoot([
            planRow("prog", spanKind([], { rollup: "union", unit: "t" })),
            planRow("m1", spanKind([
                run("ra", new Date("2026-06-29Z"), new Date("2026-07-13Z"), variant("actual", null), { qty: 96 }),
                run("rb", new Date("2026-07-06Z"), new Date("2026-07-20Z"), variant("confirmed", null), { qty: 50 }),
            ]), { parent: "prog" }),
        ]));
        expect(screen.getByText("×2 · 146 t")).toBeTruthy();
    });
});

describe("Plan ruler + footer chrome", () => {
    test("a 12-week window ticks W27…W38 with the NOW chip and the grain caption", () => {
        renderPlan(planRoot([planRow("m1", spanKind([]))]));
        expect(screen.getByText("W27")).toBeTruthy();
        expect(screen.getByText("W38")).toBeTruthy();
        expect(screen.queryByText("W39")).toBeNull();
        expect(screen.getByText("NOW")).toBeTruthy();
        // The ruler's gutter caption is the active grain (§1 mock: RESOURCE).
        expect(screen.getAllByText("RESOURCE").length).toBeGreaterThan(0);
    });

    test("footer items render with their tone and end alignment attributes", () => {
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([]))], {
            footer: [
                { text: "512 RESOURCES", tone: none, end: none },
                { text: "3 EXCEPTIONS", tone: some(variant("warning", null)), end: none },
                { text: "RUN 412", tone: none, end: some(true) },
            ],
        }));
        expect(screen.getByText("512 RESOURCES")).toBeTruthy();
        const warn = screen.getByText("3 EXCEPTIONS");
        expect(warn.getAttribute("data-tone")).toBe("warning");
        expect(screen.getByText("RUN 412").hasAttribute("data-end")).toBe(true);
        expect(container.querySelector('[data-slot="footer"]')).toBeTruthy();
    });
});

describe("Plan group strips (§5)", () => {
    test("a group toggles its subtree in place and shows the member meta", () => {
        const { container } = renderPlan(planRoot([
            planRow("line1", variant("group", { summary: none, summaryAggregate: none, collapsed: none }),
                { gutter: gutter("LINE 1", { meta: "2 rs" }) }),
            planRow("m1", spanKind([]), { parent: "line1" }),
            planRow("m2", spanKind([]), { parent: "line1" }),
        ]));
        expect(screen.getByText("2 rs")).toBeTruthy();
        expect(container.querySelector('[data-plan-row="m1"]')).toBeTruthy();
        fireEvent.click(container.querySelector('[data-plan-group="line1"]')!);
        expect(container.querySelector('[data-plan-row="m1"]')).toBeNull();
        expect(container.querySelector('[data-plan-row="m2"]')).toBeNull();
        fireEvent.click(container.querySelector('[data-plan-group="line1"]')!);
        expect(container.querySelector('[data-plan-row="m1"]')).toBeTruthy();
    });

    test("an IR-collapsed group starts collapsed and renders its summary heat strip", () => {
        const { container } = renderPlan(planRoot([
            planRow("line2", variant("group", {
                summary: some(variant("heat", {
                    cells: [{ at: new Date("2026-06-29Z"), value: some(80), label: some("80") }],
                    min: some(0), max: some(100), warnAt: none,
                })),
                summaryAggregate: none,
                collapsed: some(true),
            })),
            planRow("m3", spanKind([]), { parent: "line2" }),
        ]));
        expect(container.querySelector('[data-plan-row="m3"]')).toBeNull();
        expect(screen.getByText("80")).toBeTruthy();
    });
});

describe("Plan heat rows (§4·K4)", () => {
    test("heat cells: depth labels, ≥ warnAt ring, no-data hatch, past-50% flip", () => {
        const { container } = renderPlan(planRoot([
            planRow("l1", variant("heat", {
                cells: variant("heat", {
                    cells: [
                        { at: new Date("2026-06-29Z"), value: some(30), label: some("30") },
                        { at: new Date("2026-07-06Z"), value: some(96), label: some("96") },
                        { at: new Date("2026-07-13Z"), value: none, label: none },
                    ],
                    min: some(0), max: some(100), warnAt: some(95),
                }),
                aggregate: none,
            })),
        ]));
        expect(screen.getByText("30")).toBeTruthy();
        const hot = screen.getByText("96");
        expect(hot.hasAttribute("data-flip")).toBe(true);
        expect(hot.closest("[data-warn]")).toBeTruthy();
        expect(container.querySelector("[data-nodata]")).toBeTruthy();
        expect(screen.getByText("–")).toBeTruthy();
    });
});

describe("Plan chart rows (§4·K3)", () => {
    test("marks render as SVG; ref labels print at expanded height (sparks stay bare)", () => {
        const chart = (height: unknown) => variant("chart", {
            layers: [
                variant("line", {
                    points: [
                        { t: new Date("2026-06-29Z"), y: 94 },
                        { t: new Date("2026-08-31Z"), y: 101 },
                    ],
                    axis: variant("left", null),
                    breach: none,
                }),
                variant("refLine", { y: 100, axis: variant("left", null), label: some("TARGET 100") }),
            ],
            left: some({
                domain: some(variant("number", { min: 80, max: 110 })),
                tickValues: some(variant("number", [80, 100])),
                format: none,
            }),
            right: none,
            height,
            expandedHeight: none,
            expandable: none,
        });
        const spark = renderPlan(planRoot([
            planRow("cov", chart(variant("spark", null)), { gutter: gutter("COVERAGE", { id: true, value: "94.2%" }) }),
        ]));
        expect(spark.container.querySelector('[data-plan-row="cov"] svg polyline')).toBeTruthy();
        expect(screen.queryByText("TARGET 100")).toBeNull();   // too shallow for the label
        expect(screen.getByText("94.2%")).toBeTruthy();
        expect(screen.getByText("80")).toBeTruthy();           // left tick in the gutter edge
        cleanup();
        renderPlan(planRoot([
            planRow("cov", chart(variant("expanded", null)), { gutter: gutter("COVERAGE", { id: true }) }),
        ]));
        expect(screen.getByText("TARGET 100")).toBeTruthy();
    });
});

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

function bucketEvent(key: string, at: Date, state: unknown, opts?: { lane?: string; label?: string; stretch?: string; tone?: string }) {
    return {
        key, at,
        lane: opts?.lane !== undefined ? some(opts.lane) : none,
        label: opts?.label !== undefined ? some(opts.label) : none,
        icon: none, state,
        tone: opts?.tone !== undefined ? some(variant(opts.tone, null)) : none,
        color: none, colorPalette: none,
        stretch: opts?.stretch !== undefined ? some(variant(opts.stretch, null)) : none,
        content: none, animation: none,
    };
}

describe("Plan bucket rows (§4·K2)", () => {
    test("tiles wear the state axis with the resting ✓ / plan looks; labels, tones and markers print", () => {
        const { container } = renderPlan(planRoot([
            planRow("dock", variant("buckets", {
                lanes: [],
                events: [
                    bucketEvent("e1", new Date("2026-06-29Z"), variant("actual", null)),
                    bucketEvent("e2", new Date("2026-07-06Z"), variant("proposed", variant("recommended", null))),
                    bucketEvent("e3", new Date("2026-07-13Z"), variant("confirmed", null),
                        { label: "TRIM · 4 t", stretch: "horizontal", tone: "warning" }),
                ],
                markers: [{ at: new Date("2026-07-20Z"), lane: none, status: variant("danger", null), message: "short 2 ops" }],
            })),
        ]));
        expect(container.querySelector('[data-event="e1"]')!.getAttribute("data-state")).toBe("obs");
        expect(container.querySelector('[data-event="e1"] svg')).toBeTruthy();       // the resting ✓
        expect(container.querySelector('[data-event="e2"]')!.getAttribute("data-state")).toBe("prop");
        expect(screen.getByText("plan")).toBeTruthy();                                // proposed resting look
        const trim = screen.getByText("TRIM · 4 t");
        expect(trim.getAttribute("data-tone")).toBe("warning");
        expect(container.querySelector('[data-status="danger"]')).toBeTruthy();       // marker ring + icon
    });

    test("lanes split the cell with per-cell captions; lane: none is the full-cell mixed grammar", () => {
        const { container } = renderPlan(planRoot([
            planRow("crew", variant("buckets", {
                lanes: [{ key: "am", label: some("AM") }, { key: "pm", label: some("PM") }],
                events: [
                    bucketEvent("am1", new Date("2026-06-29Z"), variant("confirmed", null), { lane: "am" }),
                    bucketEvent("full1", new Date("2026-07-06Z"), variant("confirmed", null)),
                ],
                markers: [],
            })),
        ]));
        // The caption prints in EVERY cell of its lane (the Planner `.bl`).
        expect(screen.getAllByText("AM").length).toBeGreaterThan(1);
        expect(screen.getAllByText("PM").length).toBeGreaterThan(1);
        expect(container.querySelector('[data-event="am1"]')).toBeTruthy();
        // The lane-less event takes the whole cell across lanes.
        const full = container.querySelector('[data-plan-cell="1:full"]')!;
        expect(full.querySelector('[data-event="full1"]')).toBeTruthy();
    });
});

function tableCell(at: Date, v: number | undefined, text?: string) {
    return {
        at,
        value: v !== undefined ? some(v) : none,
        text: text !== undefined ? some(text) : none,
        tone: none,
    };
}

// The stored table form is ALWAYS series — this wraps plain cells the way
// the factory's `cells` sugar does (one unstyled series).
function tableKindOf(cells: unknown[], opts?: { aggregate?: boolean; emphasis?: string }) {
    return variant("table", {
        series: cells.length > 0
            ? [{ cells, format: none, tone: none, strong: none, rollup: none }]
            : [],
        split: variant("horizontal", null),
        aggregate: opts?.aggregate === true ? some(variant("sum", null)) : none,
        format: none,
        emphasis: variant(opts?.emphasis ?? "body", null),
    });
}

describe("Plan table rows (§4·K5)", () => {
    test("numerals format renderer-side with derived tones; declared parents derive subtotals; emphasis rides the row", () => {
        const { container } = renderPlan(planRoot([
            planRow("net", tableKindOf([], { aggregate: true, emphasis: "footer" })),
            planRow("wk", tableKindOf([
                tableCell(new Date("2026-06-29Z"), 96),
                tableCell(new Date("2026-07-06Z"), -4),
                tableCell(new Date("2026-07-13Z"), undefined),
                tableCell(new Date("2026-07-20Z"), 7, "seven"),   // explicit text override
            ]), { parent: "net" }),
            planRow("wk2", tableKindOf([tableCell(new Date("2026-06-29Z"), 54)]), { parent: "net" }),
        ]));
        const wkRow = container.querySelector('[data-plan-row="wk"]')!;
        // Negatives tone `neg`, missing values the muted em-dash — derived
        // from the raw values at render; explicit text overrides win.
        expect(wkRow.querySelector('[data-tone="neg"]')!.textContent).toBe("-4");
        expect(wkRow.querySelector('[data-tone="muted"]')!.textContent).toBe("—");
        expect(wkRow.textContent).toContain("seven");
        const netRow = container.querySelector('[data-plan-row="net"]')!;
        expect(netRow.textContent).toContain("150");                  // derived 96 + 54
        expect(netRow.getAttribute("data-emphasis")).toBe("footer");
    });

    test("multi-series cells join by bucket with per-position style declarations", () => {
        const mkSeries = (cells: unknown[], opts?: { tone?: string; strong?: boolean }) => ({
            cells,
            format: none,
            tone: opts?.tone !== undefined ? some(variant(opts.tone, null)) : none,
            strong: opts?.strong !== undefined ? some(opts.strong) : none,
            rollup: none,
        });
        const { container } = renderPlan(planRoot([
            planRow("flow", variant("table", {
                series: [
                    mkSeries([tableCell(new Date("2026-06-29Z"), 96)], { strong: true }),
                    mkSeries([tableCell(new Date("2026-06-29Z"), 12)], { tone: "muted" }),
                ],
                split: variant("horizontal", null),
                aggregate: none, format: none, emphasis: variant("body", null),
            })),
        ]));
        const cell = container.querySelector('[data-plan-row="flow"] [data-split="horizontal"]')!;
        expect(cell).toBeTruthy();
        const parts = cell.querySelectorAll("span");
        expect(parts).toHaveLength(2);
        // Series order holds; part 0 wears the strong declaration.
        expect(parts[0]!.textContent).toBe("96");
        expect(parts[0]!.hasAttribute("data-strong")).toBe(true);
        // The POSITIVE second value wears the series' muted tone (derived
        // neg/em-dash would win over it per cell).
        expect(parts[1]!.getAttribute("data-tone")).toBe("muted");
    });

    test("a kind parent's whole gutter toggles its subtree (group-strip convention); its plot still selects", () => {
        const { container } = renderPlan(planRoot([
            planRow("net", tableKindOf([], { aggregate: true }),
                { gutter: gutter("net", { meta: "sum" }) }),
            planRow("wk", tableKindOf([tableCell(new Date("2026-06-29Z"), 96)]), { parent: "net" }),
        ]));
        const netRow = () => container.querySelector('[data-plan-row="net"]')!;
        expect(container.querySelector('[data-plan-row="wk"]')).toBeTruthy();
        // The `.of` aggregate-tag meta prints in the gutter's right cluster.
        expect(screen.getByText("sum")).toBeTruthy();

        // Clicking the LABEL (anywhere in the gutter, not just the caret)
        // collapses the subtree — and does NOT select the row.
        fireEvent.click(screen.getByText("net"));
        expect(container.querySelector('[data-plan-row="wk"]')).toBeNull();
        expect(netRow().hasAttribute("data-selected")).toBe(false);
        fireEvent.click(screen.getByText("net"));
        expect(container.querySelector('[data-plan-row="wk"]')).toBeTruthy();

        // The plot region keeps the selection contract.
        fireEvent.click(netRow().children[1]!);
        expect(netRow().hasAttribute("data-selected")).toBe(true);
        expect(container.querySelector('[data-plan-row="wk"]')).toBeTruthy();  // no accidental toggle
    });
});

describe("Plan cards rows (§4·K6)", () => {
    test("chips span their buckets and wear the lifecycle looks", () => {
        const { container } = renderPlan(planRoot([
            planRow("ops", variant("cards", {
                chips: [
                    { key: "c1", from: new Date("2026-06-29Z"), to: new Date("2026-07-13Z"), label: "D. OKAFOR",
                        state: variant("confirmed", null), icon: none },
                    { key: "c2", from: new Date("2026-07-13Z"), to: new Date("2026-07-27Z"), label: "+64h",
                        state: variant("proposed", variant("recommended", null)), icon: none },
                    { key: "c3", from: new Date("2026-07-27Z"), to: new Date("2026-08-10Z"), label: "L. CHEN",
                        state: variant("proposed", variant("removed", null)), icon: none },
                ],
            })),
        ]));
        expect(container.querySelector('[data-chip="c1"]')!.getAttribute("data-state")).toBe("appr");
        expect(container.querySelector('[data-chip="c2"]')!.getAttribute("data-state")).toBe("prop");
        expect(container.querySelector('[data-chip="c3"]')!.getAttribute("data-state")).toBe("propRemoved");
        expect(screen.getByText("D. OKAFOR")).toBeTruthy();
    });
});

describe("Plan resolution zoom (§3)", () => {
    test("switching resolution zooms the window to preserve the column count", () => {
        initializeStore(new UIStore());
        const cfg = {
            fields: new Map<string, unknown>([
                ["at", { type: "datetime", value: { label: "At", accessor: (r: { at: Date }) => r.at, format: none } }],
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

describe("Plan horizon brush — live pan preview (§7)", () => {
    test("sliding the window pans the slice range in discrete period steps BEFORE release", () => {
        initializeStore(new UIStore());
        const cfg = {
            fields: new Map<string, unknown>([
                ["at", { type: "datetime", value: { label: "At", accessor: (r: { at: Date }) => r.at, format: none } }],
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
        const handle = buildSliceHandle("plan.brush", cfg as never, initial as never,
            [{ at: W27 }, { at: W39 }] as never, none) as never as {
                read(): { range: { value: { value: { from: Date; to: Date } } } };
            };
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([]))], {
            slice: some({ slice: handle, affordances: [variant("brush", null)] }),
        }));
        const track = container.querySelector("[data-brush-track]") as HTMLElement;
        Object.defineProperty(track, "getBoundingClientRect", {
            value: () => ({ left: 0, top: 0, right: 1000, bottom: 32, width: 1000, height: 32, x: 0, y: 0, toJSON: () => ({}) }),
        });
        const range = () => handle.read().range.value.value;

        // Grab the window body (166.7px..500px on the mocked track) and
        // slide +86px ≈ +1.03 weeks — the snapped draft steps one period.
        fireEvent.pointerDown(track, { clientX: 300, pointerId: 1, buttons: 1 });
        fireEvent.pointerMove(track, { clientX: 386, pointerId: 1, buttons: 1 });
        // LIVE: the slice range already panned one whole week, pre-release.
        expect(range().from.toISOString()).toBe("2026-07-20T00:00:00.000Z");
        expect(range().to.toISOString()).toBe("2026-08-17T00:00:00.000Z");

        // Slide on to ≈ +2 weeks total and release — the commit lands the
        // same snapped window the live preview showed.
        fireEvent.pointerMove(track, { clientX: 467, pointerId: 1, buttons: 1 });
        fireEvent.pointerUp(track, { pointerId: 1 });
        expect(range().from.toISOString()).toBe("2026-07-27T00:00:00.000Z");
        expect(range().to.toISOString()).toBe("2026-08-24T00:00:00.000Z");
    });
});

describe("Plan links focus (R1)", () => {
    const link = (from: string, fromRun: string, to: string, toRun: string) => ({
        fromRow: from, fromRun, toRow: to, toRun, quantity: 34, label: "34 t",
    });

    test("the control gathers the TRANSITIVE family; unrelated rows rail; ← ALL ROWS returns", () => {
        const runAt = (key: string, s: Date, e: Date) => run(key, s, e, variant("confirmed", null));
        const { container } = renderPlan(planRoot([
            planRow("a", spanKind([runAt("ra", W27, new Date("2026-07-13Z"))])),
            planRow("b", spanKind([runAt("rb", new Date("2026-07-13Z"), new Date("2026-07-27Z"))])),
            planRow("c", spanKind([runAt("rc", new Date("2026-07-27Z"), new Date("2026-08-10Z"))])),
            planRow("x", spanKind([runAt("rx", W27, new Date("2026-07-13Z"))])),
        ], {
            // a → b → c is a two-hop chain: focusing b gathers BOTH.
            links: [link("a", "ra", "b", "rb"), link("b", "rb", "c", "rc")],
        }));
        // Rows an edge touches grow the links control; x has none.
        expect(container.querySelector('[data-plan-row="b"] [data-plan-control="links"]')).toBeTruthy();
        expect(container.querySelector('[data-plan-row="x"] [data-plan-control="links"]')).toBeNull();

        fireEvent.click(container.querySelector('[data-plan-row="b"] [data-plan-control="links"]')!);
        // Family keeps full rows with direction tags; x collapses to a rail.
        expect(container.querySelector('[data-plan-focusbar="links"]')).toBeTruthy();
        expect(screen.getByText("LINKS · b · 1 UPSTREAM · 1 DOWNSTREAM")).toBeTruthy();
        expect(container.querySelector('[data-plan-row="a"] [data-plan-focustag="UPSTREAM"]')).toBeTruthy();
        expect(container.querySelector('[data-plan-row="c"] [data-plan-focustag="DOWNSTREAM"]')).toBeTruthy();
        expect(container.querySelector('[data-plan-rail="x"]')).toBeTruthy();
        expect(container.querySelector('[data-plan-row="x"]')).toBeNull();

        // ← ALL ROWS restores everything.
        fireEvent.click(container.querySelector("[data-plan-focusback]")!);
        expect(container.querySelector('[data-plan-rail="x"]')).toBeNull();
        expect(container.querySelector('[data-plan-row="x"]')).toBeTruthy();
    });

    test("a RUN of unrelated rows elides to one ⋯ gap band; a lone one keeps its rail; the gap click returns", () => {
        const runAt = (key: string, s: Date, e: Date) => run(key, s, e, variant("confirmed", null));
        const { container } = renderPlan(planRoot([
            planRow("a", spanKind([runAt("ra", W27, new Date("2026-07-13Z"))])),
            planRow("x", spanKind([])),
            planRow("b", spanKind([runAt("rb", new Date("2026-07-13Z"), new Date("2026-07-27Z"))])),
            planRow("y1", spanKind([])),
            planRow("y2", spanKind([])),
            planRow("y3", spanKind([])),
        ], { links: [link("a", "ra", "b", "rb")] }));
        fireEvent.click(container.querySelector('[data-plan-row="a"] [data-plan-control="links"]')!);
        // The lone x stays an 11px rail; the y1–y3 run is ONE gap band.
        expect(container.querySelector('[data-plan-rail="x"]')).toBeTruthy();
        expect(container.querySelector('[data-plan-gap="3"]')).toBeTruthy();
        expect(container.querySelectorAll("[data-plan-gap]")).toHaveLength(1);
        expect(container.querySelector('[data-plan-row="y2"]')).toBeNull();

        fireEvent.click(container.querySelector("[data-plan-gap]")!);
        expect(container.querySelector("[data-plan-gap]")).toBeNull();
        expect(container.querySelector('[data-plan-row="y2"]')).toBeTruthy();
    });

    test("a rail click returns; esc walks the focus rung", () => {
        const { container } = renderPlan(planRoot([
            planRow("a", spanKind([run("ra", W27, new Date("2026-07-13Z"), variant("actual", null))])),
            planRow("x", spanKind([])),
        ], { links: [link("a", "ra", "a", "ra")] }));
        fireEvent.click(container.querySelector('[data-plan-control="links"]')!);
        expect(container.querySelector('[data-plan-rail="x"]')).toBeTruthy();
        fireEvent.click(container.querySelector('[data-plan-rail="x"]')!);
        expect(container.querySelector('[data-plan-rail="x"]')).toBeNull();

        fireEvent.click(container.querySelector('[data-plan-control="links"]')!);
        fireEvent.keyDown(container.querySelector('[tabindex="0"]')!, { key: "Escape" });
        expect(container.querySelector('[data-plan-rail="x"]')).toBeNull();
    });
});

describe("Plan expand-in-place (R2)", () => {
    test("the control opens the render; neighbours COMPRESS rather than disappear; esc returns", () => {
        const { container } = renderPlan(planRoot([
            planRow("l4m13", spanKind([run("rb", W27, new Date("2026-07-27Z"), variant("actual", null))]), {
                expand: { height: some("152px"), axis: variant("dim", null) },
            }),
            planRow("l4m14", spanKind([])),
        ], {
            // The render is the ROOT's resolver, called with the row ref.
            expandRender: (ref: { key: string }) =>
                variant("Text", { value: `UTIL RENDER · ${ref.key}`, style: none }),
        }));
        // Only the declaring row grows the control.
        expect(container.querySelector('[data-plan-row="l4m13"] [data-plan-control="expand"]')).toBeTruthy();
        expect(container.querySelector('[data-plan-row="l4m14"] [data-plan-control="expand"]')).toBeNull();

        fireEvent.click(container.querySelector('[data-plan-control="expand"]')!);
        expect(container.querySelector('[data-plan-focusbar="expand"]')).toBeTruthy();
        expect(screen.getByText("EXPANDED · l4m13")).toBeTruthy();
        // The focused row keeps its NORMAL anatomy, with the axis treatment on
        // its own plot; the render mounts as its own body item beneath it.
        const focal = container.querySelector('[data-plan-row="l4m13"]') as HTMLElement;
        expect(focal).toBeTruthy();
        expect(focal.hasAttribute("data-ctx")).toBe(false);
        // The row EXPANDS to hold the render — the render is inside the focal
        // row's plot cell, not a sibling, so the gutter grows with it.
        expect(focal.hasAttribute("data-expanded")).toBe(true);
        const region = focal.querySelector("[data-plan-expandrender]") as HTMLElement;
        expect(region).toBeTruthy();
        expect(screen.getByText("UTIL RENDER · l4m13")).toBeTruthy();
        expect(container.querySelector('[data-plan-row="l4m13"] [data-axis="dim"]')).toBeTruthy();

        // ── The #591 contract: COLLAPSE, NEVER REMOVE ──
        // The neighbour is still mounted, still in order, wearing the strip.
        const ctxRow = container.querySelector('[data-plan-row="l4m14"]') as HTMLElement;
        expect(ctxRow).toBeTruthy();
        expect(ctxRow.hasAttribute("data-ctx")).toBe(true);
        // ...and it is BELOW the focal row and its render, not reordered.
        const order = [...container.querySelectorAll("[data-plan-row]")]
            .map((el) => el.getAttribute("data-plan-row"));
        expect(order).toEqual(["l4m13", "l4m14"]);

        fireEvent.keyDown(container.querySelector('[tabindex="0"]')!, { key: "Escape" });
        expect(container.querySelector("[data-plan-expandrender]")).toBeNull();
        expect(container.querySelector('[data-plan-row="l4m13"]')!.hasAttribute("data-expanded")).toBe(false);
        expect(container.querySelector('[data-plan-row="l4m14"]')!.hasAttribute("data-ctx")).toBe(false);
    });

    test("a strip is the return click target — clicking one leaves the focus, never selects it", () => {
        const { container } = renderPlan(planRoot([
            planRow("focal", spanKind([]), { expand: { height: none, axis: variant("keep", null) } }),
            planRow("other", spanKind([])),
        ], {
            expandRender: (ref: { key: string }) =>
                variant("Text", { value: `R · ${ref.key}`, style: none }),
        }));
        fireEvent.click(container.querySelector('[data-plan-control="expand"]')!);
        const strip = container.querySelector('[data-plan-row="other"]') as HTMLElement;
        expect(strip.hasAttribute("data-ctx")).toBe(true);
        fireEvent.click(strip);
        expect(container.querySelector('[data-plan-focusbar="expand"]')).toBeNull();
        // Returning is ALL it does — the strip does not select the row under it.
        expect(strip.hasAttribute("data-selected")).toBe(false);
    });

    test("marks survive the strip: geometry shrinks, shape shrinks, values re-encode", () => {
        const { container } = renderPlan(planRoot([
            planRow("focal", spanKind([]), { expand: { height: none, axis: variant("keep", null) } }),
            planRow("s", spanKind([run("r1", W27, new Date("2026-07-13Z"), variant("actual", null))])),
            planRow("e", variant("events", { marks: [{
                key: "m1", at: W27, kind: variant("milestone", null), icon: none, label: some("KICKOFF"),
            }] })),
        ], {
            expandRender: (ref: { key: string }) =>
                variant("Text", { value: `R · ${ref.key}`, style: none }),
        }));
        fireEvent.click(container.querySelector('[data-plan-control="expand"]')!);
        // R1 — the span bar is still there, still positioned, flagged for 7px.
        const bar = container.querySelector('[data-plan-row="s"] [data-run="r1"]') as HTMLElement;
        expect(bar).toBeTruthy();
        expect(bar.hasAttribute("data-ctx")).toBe(true);
        // R3 — the milestone keeps its silhouette; its label does not.
        const dot = container.querySelector('[data-plan-row="e"] [data-mark="m1"]') as HTMLElement;
        expect(dot).toBeTruthy();
        expect(dot.hasAttribute("data-ctx")).toBe(true);
    });
});

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
                ["at", { type: "datetime", value: { label: "At", accessor: (r: { at: Date }) => r.at, format: none } }],
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
        const w0 = [planRow("m1", spanKind([run("r1", W27, new Date("2026-07-13Z"), variant("actual", null))]))];
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
        // source ELEMENTS it covers.
        const w0 = [planRow("m1", spanKind([run("r1", W27, new Date("2026-07-13Z"), variant("actual", null))]))];
        const source = {
            page: (offset: bigint) => (offset === 0n ? some(rowCollection(w0)) : some(rowCollection([]))),
            total: () => some(10_000n),          // 50 windows
            id: "dom-test-band",
            seek: none,
        };
        // Unbounded, like the other Plan DOM tests: jsdom has no layout, so a
        // bounded frame would virtualize down to nothing.
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

    test("a source that cannot be READ renders the reason, not a blank axis (#567 D10)", async () => {
        // There is no offline stand-in for `Data.bindPaged` — paging is a server
        // capability — so a bound canvas rendered outside a workspace has
        // nothing to read. Logging that and drawing an empty axis reads as
        // "this dataset is empty", which is a lie about the data.
        const boom = (): never => { throw new Error("no paging service — resolves only inside a live workspace"); };
        const source = {
            page: boom,
            total: boom,
            id: "dom-test-unreadable",
            seek: none,
        };
        const { container } = renderPlan(planRoot([], { source }), "plan-d10");
        const band = await screen.findByText(/NO ROWS — the paged source could not be read/);
        expect(band).toBeTruthy();
        // The reason travels with it — not just to the console.
        expect(band.textContent).toMatch(/no paging service/);
        expect(container.querySelector("[data-plan-error]")).toBeTruthy();
        // And no canvas is drawn behind it: an axis with no rows would read as
        // an empty dataset.
        expect(container.querySelector("[data-plan-body]")).toBeNull();
        expect(container.querySelector("[data-plan-row]")).toBeNull();
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

describe("Plan event rows (§4·K7)", () => {
    test("milestone dots, decision diamonds (applied fills) and exception triangles mark their instants; icons swap the glyph", () => {
        const { container } = renderPlan(planRoot([
            planRow("mile", variant("events", {
                marks: [
                    { key: "k1", at: new Date("2026-06-29Z"), kind: variant("milestone", null),
                        icon: none, label: some("KICKOFF") },
                    { key: "k2", at: new Date("2026-07-13Z"), kind: variant("decision", { applied: true }),
                        icon: none, label: none },
                    { key: "k3", at: new Date("2026-07-27Z"), kind: variant("exception", null),
                        icon: none, label: none },
                    { key: "k4", at: new Date("2026-08-10Z"), kind: variant("milestone", null),
                        icon: some({ prefix: "fas", name: "flag", label: none, style: none }), label: none },
                ],
            })),
        ]));
        expect(container.querySelector('[data-mark="k1"]')).toBeTruthy();
        expect(screen.getByText("KICKOFF")).toBeTruthy();
        expect(container.querySelector('[data-mark="k2"]')!.hasAttribute("data-applied")).toBe(true);
        expect(container.querySelector('[data-mark="k3"]')).toBeTruthy();
        const swapped = container.querySelector('[data-mark="k4"]')!;
        expect(swapped.getAttribute("data-kind")).toBe("milestone");
        expect(swapped.querySelector("svg")).toBeTruthy();
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
