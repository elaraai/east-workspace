/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Plan renderer DOM tests — the recipe's `data-*` state contract: run bars
 * carry the §4.3 truth table on `data-state` (+ its status's `data-tone` /
 * `data-runoff`), rollup bands their `×k · qty` caption, the ruler its ISO
 * week ticks + NOW chip, group strips toggle their subtree in place, heat
 * cells carry `data-nodata` / `data-warn` / `data-level`, bucket tiles wear
 * the same truth table with lanes / markers, table numerals their tones +
 * derived subtotals + row emphasis, cards chips the lifecycle looks, and
 * event rows their kind glyphs.
 *
 * (Split out of `plan.dom.test.tsx`, #815: every test moved verbatim.)
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { system } from "@elaraai/east-ui-components";
import { EastChakraPlan, type PlanRootValue } from "./index.js";
import type { PlanWireRow } from "./model.js";
import type { PlanInstantValue } from "./instant.js";
import { blocksSource, oneBlock, rowId, rowSel } from "./plan.test-utils.js";

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
const n = (v: number): PlanInstantValue => variant("number", v) as PlanInstantValue;

function run(key: string, start: Date, end: Date, state: unknown, opts?: { quantity?: number; unit?: string; text?: string; stuck?: boolean }) {
    return {
        key, start: t(start), end: t(end), label: key.toUpperCase(),
        quantity: opts?.quantity !== undefined
            ? some({ value: opts.quantity, unit: opts.unit !== undefined ? some(opts.unit) : none, format: none, text: opts.text !== undefined ? some(opts.text) : none })
            : none,
        state,
        status: opts?.stuck === true ? some({ label: "Over dwell", tone: variant("warning", null), ring: false }) : none,
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

/** One WIRE row, as the source serves it — named by its test key (#822). */
function planRow(key: string, kind: unknown, opts?: { parent?: string; gutter?: unknown; expand?: unknown; collapsed?: boolean; status?: string }): PlanWireRow {
    return {
        id: rowId(key),
        parent: opts?.parent !== undefined ? some(rowId(opts.parent)) : none,
        gutter: opts?.gutter ?? gutter(key),
        kind,
        collapsed: opts?.collapsed === true,
        pinned: false, height: none,
        status: opts?.status !== undefined ? some(variant(opts.status, null)) : none,
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
        pick: opts?.pick !== undefined ? some(opts.pick) : none,
        slice: opts?.slice ?? none, nested: none,
        footer: opts?.footer ?? [],
        id: none, sources: [], editing: none, canDrop: none,
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

describe("Plan span rows (§4·K1)", () => {
    test("run bars carry the state truth table on data-state, a status's tone and the runoff mask", () => {
        const { container } = renderPlan(planRoot([
            planRow("m1", spanKind([
                run("obs1", new Date("2026-06-29Z"), new Date("2026-07-13Z"), variant("actual", null), { quantity: 96, unit: "k sheets" }),
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
        // Its status rings it in its tone, whatever its state (#1541); a bar with none wears no tone.
        expect(container.querySelector('[data-run="prop1"]')!.getAttribute("data-tone")).toBe("warning");
        expect(container.querySelector('[data-run="prop1"]')!.hasAttribute("data-ring")).toBe(false);
        expect([...container.querySelectorAll("[data-run]")].filter((bar) => bar.hasAttribute("data-tone")).map((bar) => bar.getAttribute("data-run"))).toEqual(["prop1"]);
        expect(container.querySelector('[data-run="runoff1"]')!.hasAttribute("data-runoff")).toBe(true);
        expect(screen.getByText("96 k sheets")).toBeTruthy();
    });

    test("declared rollups render renderer-DERIVED ×k · qty band captions", () => {
        // Parent declares union; the overlapping child runs derive one ×2 band
        // summing their quantities, 146 k sheets, in the pessimistic (confirmed) state.
        renderPlan(planRoot([
            planRow("contract", spanKind([], { rollup: "union" })),
            planRow("m1", spanKind([
                run("ra", new Date("2026-06-29Z"), new Date("2026-07-13Z"), variant("actual", null), { quantity: 96, unit: "k sheets" }),
                run("rb", new Date("2026-07-06Z"), new Date("2026-07-20Z"), variant("confirmed", null), { quantity: 50, unit: "k sheets" }),
            ]), { parent: "contract" }),
        ]));
        expect(screen.getByText("×2 · 146 k sheets")).toBeTruthy();
    });

    test("a run prints its ONE quantity — its text, else its value through its format and its unit; a band totals unit by unit (#824)", () => {
        const oneDp = variant("number", { minimumFractionDigits: some(1n), maximumFractionDigits: some(1n), signDisplay: none });
        const { container } = renderPlan(planRoot([
            planRow("contract", spanKind([], { rollup: "union" })),
            planRow("m1", spanKind([
                { ...run("ra", new Date("2026-06-29Z"), new Date("2026-07-13Z"), variant("actual", null)),
                    quantity: some({ value: 96.25, unit: some("k sheets"), format: some(oneDp), text: none }) },
                run("rb", new Date("2026-07-06Z"), new Date("2026-07-20Z"), variant("confirmed", null), { quantity: 112, unit: "k sheets", text: "one hundred twelve" }),
                run("rc", new Date("2026-07-06Z"), new Date("2026-07-13Z"), variant("confirmed", null), { quantity: 12, unit: "h" }),
            ]), { parent: "contract" }),
        ]));
        // The bar's caption, and its accessible name, say the same thing.
        const ra = container.querySelector('[data-run="ra"]')!;
        expect(ra.textContent).toContain("96.3 k sheets");
        expect(ra.getAttribute("aria-label")).toMatch(/96\.3 k sheets/u);
        expect(container.querySelector('[data-run="rb"]')!.textContent).toContain("one hundred twelve");
        // The band sums values, never captions — sheets with sheets, hours
        // with hours — each total through its first member's format.
        expect(screen.getByText("×3 · 208.3 k sheets · 12 h")).toBeTruthy();
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
                { text: "512 RESOURCES", tone: none, end: false },
                { text: "3 EXCEPTIONS", tone: some(variant("warning", null)), end: false },
                { text: "RUN 412", tone: none, end: true },
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
        const band: PlanWireRow["kind"] = variant("group", { summary: variant("none", null) });
        const { container } = renderPlan(planRoot([
            planRow("hall1", band, { gutter: gutter("HALL 1", { meta: "2 rows" }) }),
            planRow("m1", spanKind([]), { parent: "hall1" }),
            planRow("m2", spanKind([]), { parent: "hall1" }),
        ]));
        expect(screen.getByText("2 rows")).toBeTruthy();
        expect(container.querySelector(rowSel("m1"))).toBeTruthy();
        fireEvent.click(container.querySelector(rowSel("hall1", "data-plan-group"))!);
        expect(container.querySelector(rowSel("m1"))).toBeNull();
        expect(container.querySelector(rowSel("m2"))).toBeNull();
        fireEvent.click(container.querySelector(rowSel("hall1", "data-plan-group"))!);
        expect(container.querySelector(rowSel("m1"))).toBeTruthy();
    });

    test("an IR-collapsed group starts collapsed and renders its summary heat strip", () => {
        const { container } = renderPlan(planRoot([
            planRow("hall2", variant("group", {
                summary: variant("cells", heatArm([{ at: t(new Date("2026-06-29Z")), value: some(80), label: some("80") }], 0, 100)),
            }), { collapsed: true }),
            planRow("m3", spanKind([]), { parent: "hall2" }),
        ]));
        expect(container.querySelector(rowSel("m3"))).toBeNull();
        expect(screen.getByText("80")).toBeTruthy();
    });

    test("the summary strip's CELLS toggle the group like the rest of the band (#615)", () => {
        // The cells used to select the GROUP key — a click that visibly did
        // nothing, and it swallowed the band's own toggle.
        const { container } = renderPlan(planRoot([
            planRow("hall2", variant("group", {
                summary: variant("cells", heatArm([{ at: t(new Date("2026-06-29Z")), value: some(80), label: some("80") }], 0, 100)),
            }), { collapsed: true }),
            planRow("m3", spanKind([]), { parent: "hall2" }),
        ]), "plan-strip-toggle");
        expect(container.querySelector(rowSel("m3"))).toBeNull();
        fireEvent.click(screen.getByText("80"));
        expect(container.querySelector(rowSel("m3"))).toBeTruthy();
    });
});

describe("the gutter line (#1749)", () => {
    test("a row's line is one grid — a caret's cell where the row folds, a leaf none; then its name, and its value slot: its status's icon, its value, and its controls over them, links then expand, each in its place whether the row has the other or not; a level is the caret's cell and its gap; a band's name is the rows' grid, open or folded", () => {
        const band: PlanWireRow["kind"] = variant("group", { summary: variant("none", null) });
        const confirmed = variant("confirmed", null);
        const { container } = renderPlan(planRoot([
            planRow("hall1", band, { gutter: gutter("HALL 1", { meta: "2 rows", value: "9" }), status: "danger" }),
            planRow("m1", spanKind([run("r1", W27, new Date("2026-07-13Z"), confirmed)]), {
                parent: "hall1", gutter: gutter("m1", { value: "12k/h", meta: "sheets" }), status: "warning",
            }),
            planRow("m2", spanKind([run("r2", new Date("2026-07-13Z"), new Date("2026-07-27Z"), confirmed)]), {
                parent: "hall1", expand: { height: none, axis: variant("keep", null) }, status: "neutral",
            }),
            planRow("net", tableKindOf([], { aggregate: true })),
            planRow("wk", tableKindOf([tableCell(new Date("2026-06-29Z"), 96)]), { parent: "net" }),
        ], {
            links: [{ key: "r1>r2", from: { row: rowId("m1"), run: "r1" }, to: { row: rowId("m1"), run: "r1" }, quantity: none }],
            expandRender: () => variant("Text", { value: "R", style: none }),
        }), "plan-1749-gutter");
        const line = (key: string) => container.querySelector(`${rowSel(key)} [role='rowheader'] > [data-plan-gutter='name']`)!;
        /** A line's cells, and a band's name's: a caret, or a part of the gutter by its name. */
        const cells = (of: Element) => [...of.children].map((cell) => cell.getAttribute("data-plan-gutter") ?? (cell.querySelector("svg") !== null ? "caret" : ""));
        /** What a value slot holds, in order: a status's icon by its tone, a part of the gutter by its name, and the controls' two places. */
        const held = (of: Element) => [...of.querySelector(":scope > [data-plan-gutter='slot']")!.children].map((part) => (part.hasAttribute("data-plan-controls")
            ? [...part.children].map((place) => place.getAttribute("data-plan-control") ?? "").join("|")
            : part.getAttribute("role") === "img" ? `status:${part.getAttribute("data-tone")}` : part.getAttribute("data-plan-gutter") ?? ""));
        // A leaf folds nothing: no caret's cell, and its line says so, for the grid without one.
        expect([cells(line("m1")), cells(line("m2")), cells(line("net"))]).toEqual([["title", "slot"], ["title", "slot"], ["caret", "title", "slot"]]);
        expect([line("m1").hasAttribute("data-leaf"), line("m2").hasAttribute("data-leaf"), line("net").hasAttribute("data-leaf")]).toEqual([true, true, false]);
        // The value slot: a status's icon at its start — a neutral status draws none — then the value, there whether the
        // row has one or not; and the row's controls over them, two places in one order — none on a row with no control.
        expect([held(line("m1")), held(line("m2")), held(line("net"))]).toEqual([["status:warning", "value", "links|"], ["value", "|expand"], ["value"]]);
        const value = (key: string) => line(key).querySelector("[data-plan-gutter='slot'] > [data-plan-gutter='value']")!.textContent;
        expect([value("m1"), value("m2")]).toEqual(["12k/h", ""]);
        // The meta inline after the label, in the name's cell.
        expect(line("m1").querySelector("[data-plan-gutter='title'] > [data-plan-gutter='meta']")!.textContent).toBe("sheets");
        // A level's indent is the caret's cell and the gap after it: a member's line starts that far past its parent's,
        // so its words start where its parent's do.
        const indent = (key: string, attr = "data-plan-row") =>
            (container.querySelector(`${rowSel(key, attr)} [role='rowheader']`) as HTMLElement).style.paddingLeft;
        expect([indent("hall1", "data-plan-group"), indent("m1"), indent("net"), indent("wk")]).toEqual(["12px", "32px", "12px", "32px"]);
        // A band's name is the rows' grid, open or folded, never a heading across its row: its caption and its meta in
        // its name's cell, its status and its value in its value slot.
        const name = () => container.querySelector(`${rowSel("hall1", "data-plan-group")} [role='rowheader']`)!;
        const said = () => ({
            across: name().hasAttribute("data-across"), cells: cells(name()), slot: held(name()),
            title: [...name().querySelectorAll("[data-plan-gutter='title'] > [data-plan-gutter]")].map((part) => part.getAttribute("data-plan-gutter")),
        });
        const banded = { across: false, cells: ["caret", "title", "slot"], slot: ["status:danger", "value"], title: ["label", "meta"] };
        expect(said()).toEqual(banded);
        fireEvent.click(container.querySelector(rowSel("hall1", "data-plan-group"))!);
        expect(said()).toEqual(banded);
        fireEvent.click(container.querySelector(rowSel("hall1", "data-plan-group"))!);
        // A row's controls are drawn while one of them is pressed, whatever the pointer is over: its row is the focus's.
        const controls = () => line("m1").querySelector("[data-plan-controls]")!;
        expect(controls().hasAttribute("data-focal")).toBe(false);
        fireEvent.click(controls().querySelector("[data-plan-control='links']")!);
        expect([controls().hasAttribute("data-focal"), controls().querySelector("[data-plan-control='links']")!.getAttribute("aria-pressed")]).toEqual([true, "true"]);
    });

    test("a status is its tone's icon, told by its shape — a triangle for a warning, a ringed mark for a danger, a check for a success, a ringed i for a note — and named for a reader by its status; a neutral status draws none", () => {
        const tones = ["warning", "danger", "success", "info", "neutral"];
        const { container } = renderPlan(planRoot(tones.map((tone) => planRow(tone, spanKind([]), { status: tone }))), "plan-1749-status");
        /** A row's status as drawn: its tone, its icon's glyph and its name. */
        const drawn = (key: string) => {
            const icon = container.querySelector(`${rowSel(key)} [data-plan-gutter='slot'] > [role='img']`);
            return icon === null ? null : [icon.getAttribute("data-tone"), icon.querySelector("svg")!.getAttribute("data-icon"), icon.getAttribute("aria-label")];
        };
        expect(Object.fromEntries(tones.map((tone) => [tone, drawn(tone)]))).toEqual({
            warning: ["warning", "triangle-exclamation", "Status: warning"],
            danger: ["danger", "circle-exclamation", "Status: danger"],
            success: ["success", "check", "Status: success"],
            info: ["info", "circle-info", "Status: info"],
            neutral: null,
        });
    });
});

describe("Plan heat rows (§4·K4)", () => {
    test("heat cells: depth labels, ≥ warnAt ring, no-data hatch, an ink per level (#949)", () => {
        const { container } = renderPlan(planRoot([
            planRow("h1", variant("heat", {
                cells: heatArm([
                    { at: t(new Date("2026-06-29Z")), value: some(30), label: some("30") },
                    { at: t(new Date("2026-07-06Z")), value: some(96), label: some("96") },
                    { at: t(new Date("2026-07-13Z")), value: none, label: none },
                ], 0, 100, 95),
                aggregate: none, scale: none,
            })),
        ]));
        // A cell and its value carry one LEVEL — 0–4 by depth on the scale —
        // and the recipe inks each level for ≥ 4.5:1 against its own fill, so
        // the value reads at every depth (a 50% flip left 3.3:1 either side).
        const cool = screen.getByText("30");
        expect(cool.getAttribute("data-level")).toBe("1");
        expect(cool.parentElement!.getAttribute("data-level")).toBe("1");
        const hot = screen.getByText("96");
        expect(hot.getAttribute("data-level")).toBe("4");
        expect(hot.parentElement!.getAttribute("data-level")).toBe("4");
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
                        { t: t(new Date("2026-06-29Z")), y: 94 },
                        { t: t(new Date("2026-08-31Z")), y: 101 },
                    ],
                    axis: variant("left", null),
                    breach: none,
                    fold: variant("mean", null),
                    style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none },
                }),
                variant("refLine", { y: 100, axis: variant("left", null), label: some("TARGET 100"), dash: none, color: none }),
            ],
            left: some({
                domain: some(variant("number", { min: 80, max: 110 })),
                tickValues: some(variant("number", [80, 100])),
                format: none,
            }),
            right: none,
            height,
            expandedHeight: none,
            expandable: false,
        });
        const spark = renderPlan(planRoot([
            planRow("ontime", chart(variant("spark", null)), { gutter: gutter("ON-TIME", { id: true, value: "94.2%" }) }),
        ]));
        expect(spark.container.querySelector(`${rowSel("ontime")} svg [data-plan-mark="line"]`)).toBeTruthy();
        expect(screen.queryByText("TARGET 100")).toBeNull();   // too shallow for the label
        expect(screen.getByText("94.2%")).toBeTruthy();
        // A spark reads its scale by its gridlines alone (#1750): its 80 and 100 are lines across the plot, and no
        // number stands in the row — never in the gutter where the value is (#1680's review), nor in the plot.
        expect(spark.container.querySelectorAll(`${rowSel("ontime")} [data-plan-gridline]`)).toHaveLength(2);
        expect(screen.queryByText("80")).toBeNull();
        cleanup();
        renderPlan(planRoot([
            planRow("ontime", chart(variant("expanded", null)), { gutter: gutter("ON-TIME", { id: true }) }),
        ]));
        expect(screen.getByText("TARGET 100")).toBeTruthy();
        // Opened taller, with its first line free, its numbers read down the gutter's value slot.
        expect([screen.getByText("80"), screen.getByText("100")].map((tick) => tick.closest("[role='rowheader']") !== null)).toEqual([true, true]);
    });
});

function bucketEvent(key: string, at: Date, state: unknown, opts?: { lane?: string; label?: string; stretch?: string; tone?: string }) {
    return {
        key, at: t(at),
        lane: opts?.lane !== undefined ? some(opts.lane) : none,
        label: opts?.label !== undefined ? some(opts.label) : none,
        icon: none, state,
        status: opts?.tone !== undefined ? some({ label: "Late", tone: variant(opts.tone, null), ring: false }) : none,
        color: none, colorPalette: none,
        stretch: opts?.stretch !== undefined ? some(variant(opts.stretch, null)) : none,
        content: none, animation: none,
    };
}

describe("Plan bucket rows (§4·K2)", () => {
    test("tiles wear the state axis with the resting ✓ / plan looks; labels, tones and markers print", () => {
        const { container } = renderPlan(planRoot([
            planRow("van", variant("buckets", {
                lanes: [],
                events: [
                    bucketEvent("e1", new Date("2026-06-29Z"), variant("actual", null)),
                    bucketEvent("e2", new Date("2026-07-06Z"), variant("proposed", variant("recommended", null))),
                    bucketEvent("e3", new Date("2026-07-13Z"), variant("confirmed", null),
                        { label: "TRIM · 4 k sheets", stretch: "horizontal", tone: "warning" }),
                ],
                markers: [{ at: t(new Date("2026-07-20Z")), lane: none, status: variant("danger", null), message: "short 2 ops" }],
            })),
        ]));
        expect(container.querySelector('[data-event="e1"]')!.getAttribute("data-state")).toBe("obs");
        expect(container.querySelector('[data-event="e1"] svg')).toBeTruthy();       // the resting ✓
        expect(container.querySelector('[data-event="e2"]')!.getAttribute("data-state")).toBe("prop");
        expect(screen.getByText("plan")).toBeTruthy();                                // proposed resting look
        // The label is its own ellipsizing span inside the tile; the tile is
        // what wears the tone.
        const trim = screen.getByText("TRIM · 4 k sheets").closest("[data-event]")!;
        expect(trim.getAttribute("data-tone")).toBe("warning");
        expect(container.querySelector('[data-status="danger"]')).toBeTruthy();       // marker ring + icon
    });

    test("lanes split the cell, each named once on its own line of the gutter, never in every cell (#1680's review); lane: none is the full-cell mixed grammar", () => {
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
        // A gutter line per lane: the name's line holds the first lane's caption in its value cell, the next line the next.
        expect(screen.getAllByText("AM")).toHaveLength(1);
        expect(screen.getAllByText("PM")).toHaveLength(1);
        const row = container.querySelector(rowSel("crew"))!;
        const lines = [...row.querySelectorAll("[data-plan-gutter='name'], [data-plan-gutter='lane']")].map((line) => [
            line.getAttribute("data-plan-gutter"),
            line.querySelector("[data-plan-gutter='label']")?.textContent ?? null,
            line.querySelector("[data-plan-lane]")?.textContent ?? null,
        ]);
        expect(lines).toEqual([["name", "crew", "AM"], ["lane", null, "PM"]]);
        expect(row.querySelector("[data-plan-cell] [data-plan-lane]")).toBeNull();
        expect(container.querySelector('[data-event="am1"]')).toBeTruthy();
        // The lane-less event takes the whole cell across lanes.
        const full = container.querySelector('[data-plan-cell="1:full"]')!;
        expect(full.querySelector('[data-event="full1"]')).toBeTruthy();
    });

    test("a full-cell bucket keeps its lane events AND its markers; the worst marker wins (#615)", () => {
        // The spanning cell used to `continue` past the per-lane loop —
        // dropping the bucket's lane-assigned chips AND its markers outright.
        const { container } = renderPlan(planRoot([
            planRow("crew", variant("buckets", {
                lanes: [{ key: "am", label: some("AM") }, { key: "pm", label: some("PM") }],
                events: [
                    bucketEvent("full1", new Date("2026-07-06Z"), variant("confirmed", null)),
                    bucketEvent("am1", new Date("2026-07-06Z"), variant("confirmed", null), { lane: "am" }),
                ],
                markers: [
                    { at: t(new Date("2026-07-06Z")), lane: some("pm"), status: variant("warning", null), message: "tight" },
                    { at: t(new Date("2026-07-06Z")), lane: some("pm"), status: variant("danger", null), message: "short 2 ops" },
                ],
            })),
        ]), "plan-full-cell-615");
        const full = container.querySelector('[data-plan-cell="1:full"]')!;
        expect(full.querySelector('[data-event="full1"]')).toBeTruthy();
        // The lane-assigned chip flows after the spanning one — repositioned,
        // never dropped.
        expect(full.querySelector('[data-event="am1"]')).toBeTruthy();
        // The bucket's markers surface on the spanning cell; two markers on
        // one cell resolve to the WORST status — a cell has one ring.
        expect(full.getAttribute("data-over")).toBe("danger");
        expect(full.querySelector('[data-status="danger"]')).toBeTruthy();
    });
});

/** A heat cells arm (#824) — its cells on a scale, folding by `fold`, printing through `format`. */
function heatArm(cells: unknown[], min?: number, max?: number, warnAt?: number, opts?: { fold?: string; format?: unknown }) {
    return variant("heat", {
        cells,
        scale: {
            min: min !== undefined ? some(min) : none,
            max: max !== undefined ? some(max) : none,
            warnAt: warnAt !== undefined ? some(warnAt) : none,
        },
        fold: variant(opts?.fold ?? "mean", null),
        format: opts?.format !== undefined ? some(opts.format) : none,
    });
}

function tableCell(at: Date, v: number | undefined, text?: string) {
    return {
        at: t(at),
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
            ? [{ cells, format: none, tone: none, strong: false, rollup: false, fold: variant("sum", null) }]
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
        const wkRow = container.querySelector(rowSel("wk"))!;
        // Negatives tone `neg`, missing values the muted em-dash — derived
        // from the raw values at render; explicit text overrides win.
        expect(wkRow.querySelector('[data-tone="neg"]')!.textContent).toBe("-4");
        expect(wkRow.querySelector('[data-tone="muted"]')!.textContent).toBe("—");
        expect(wkRow.textContent).toContain("seven");
        const netRow = container.querySelector(rowSel("net"))!;
        expect(netRow.textContent).toContain("150");                  // derived 96 + 54
        expect(netRow.getAttribute("data-emphasis")).toBe("footer");
    });

    test("multi-series cells join by bucket with per-position style declarations", () => {
        const mkSeries = (cells: unknown[], opts?: { tone?: string; strong?: boolean }) => ({
            cells,
            format: none,
            tone: opts?.tone !== undefined ? some(variant(opts.tone, null)) : none,
            strong: opts?.strong === true,
            rollup: false,
            fold: variant("sum", null),
        });
        const { container } = renderPlan(planRoot([
            planRow("lot", variant("table", {
                series: [
                    mkSeries([tableCell(new Date("2026-06-29Z"), 96)], { strong: true }),
                    mkSeries([tableCell(new Date("2026-06-29Z"), 12)], { tone: "muted" }),
                ],
                split: variant("horizontal", null),
                aggregate: none, format: none, emphasis: variant("body", null),
            })),
        ]));
        const cell = container.querySelector(`${rowSel("lot")} [data-split="horizontal"]`)!;
        expect(cell).toBeTruthy();
        // Its numerals, together in one group (#1269).
        const parts = cell.querySelectorAll("[data-table-parts] > span");
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
        const netRow = () => container.querySelector(rowSel("net"))!;
        expect(container.querySelector(rowSel("wk"))).toBeTruthy();
        // The `.of` aggregate-tag meta prints in the name's cell, after the label.
        expect(screen.getByText("sum").closest("[data-plan-gutter='title']")).toBeTruthy();

        // Clicking the LABEL (anywhere in the gutter, not just the caret)
        // collapses the subtree — and does NOT select the row.
        fireEvent.click(screen.getByText("net"));
        expect(container.querySelector(rowSel("wk"))).toBeNull();
        expect(netRow().hasAttribute("data-selected")).toBe(false);
        fireEvent.click(screen.getByText("net"));
        expect(container.querySelector(rowSel("wk"))).toBeTruthy();

        // The plot region keeps the selection contract.
        fireEvent.click(netRow().children[1]!);
        expect(netRow().hasAttribute("data-selected")).toBe(true);
        expect(container.querySelector(rowSel("wk"))).toBeTruthy();  // no accidental toggle
    });
});

describe("Plan cards rows (§4·K6)", () => {
    test("chips span their buckets and wear the lifecycle looks", () => {
        const { container } = renderPlan(planRoot([
            planRow("ops", variant("cards", {
                chips: [
                    { key: "c1", from: t(new Date("2026-06-29Z")), to: t(new Date("2026-07-13Z")), label: "CREW A",
                        state: variant("confirmed", null), status: none, icon: none },
                    { key: "c2", from: t(new Date("2026-07-13Z")), to: t(new Date("2026-07-27Z")), label: "+64h",
                        state: variant("proposed", variant("recommended", null)), status: none, icon: none },
                    { key: "c3", from: t(new Date("2026-07-27Z")), to: t(new Date("2026-08-10Z")), label: "CREW B",
                        state: variant("proposed", variant("removed", null)), status: none, icon: none },
                ],
            })),
        ]));
        expect(container.querySelector('[data-chip="c1"]')!.getAttribute("data-state")).toBe("appr");
        expect(container.querySelector('[data-chip="c2"]')!.getAttribute("data-state")).toBe("prop");
        expect(container.querySelector('[data-chip="c3"]')!.getAttribute("data-state")).toBe("propRemoved");
        expect(screen.getByText("CREW A")).toBeTruthy();
    });
});

describe("Plan event rows (§4·K7)", () => {
    test("milestone dots, decision diamonds (applied fills) and exception triangles mark their instants; icons swap the glyph", () => {
        const { container } = renderPlan(planRoot([
            planRow("mile", variant("events", {
                marks: [
                    { key: "k1", at: t(new Date("2026-06-29Z")), kind: variant("milestone", null),
                        status: none, icon: none, label: some("KICKOFF") },
                    { key: "k2", at: t(new Date("2026-07-13Z")), kind: variant("decision", { applied: true }),
                        status: none, icon: none, label: none },
                    { key: "k3", at: t(new Date("2026-07-27Z")), kind: variant("exception", null),
                        status: none, icon: none, label: none },
                    { key: "k4", at: t(new Date("2026-08-10Z")), kind: variant("milestone", null),
                        status: none, icon: some({ prefix: "fas", name: "flag", label: none, style: none }), label: none },
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

describe("a coarser resolution FOLDS — one cell per bucket per row (#824)", () => {
    /** Twelve weekly instants from W27 (Jun 29): one in June, four in July, five in August, two in September. */
    const WEEKS = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, 5, 29 + 7 * i)));
    const monthAxis = variant("time", {
        window: some({ min: new Date("2026-06-01Z"), max: new Date("2026-10-01Z") }),
        resolution: variant("month", null), resolutions: [], now: none, format: none,
    });
    const weekAxis = variant("time", {
        window: some({ min: W27, max: W39 }), resolution: variant("week", null), resolutions: [], now: none, format: none,
    });
    /** A heat row of weekly cells valued 10, 20, … 120 and labelled so. */
    const weeklyHeat = (key: string, fold?: string) => planRow(key, variant("heat", {
        cells: heatArm(WEEKS.map((at, i) => ({ at: t(at), value: some(10 * (i + 1)), label: some(String(10 * (i + 1))) })), 0, 200, undefined,
            fold !== undefined ? { fold } : undefined),
        aggregate: none, scale: none,
    }));
    const weeklyTable = (key: string, fold?: string) => planRow(key, variant("table", {
        series: [{
            cells: WEEKS.map((at) => tableCell(at, 10)), format: none, tone: none, strong: false, rollup: false,
            fold: variant(fold ?? "sum", null),
        }],
        split: variant("horizontal", null), aggregate: none, format: none, emphasis: variant("body", null),
    }));
    const weeklyColumns = planRow("out", variant("chart", {
        layers: [variant("column", {
            points: WEEKS.map((at) => ({ t: t(at), y: 5 })), axis: variant("left", null), breach: none,
            fold: variant("sum", null),
            style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none },
        })],
        left: none, right: none, height: variant("expanded", null), expandedHeight: none, expandable: false,
    }));
    const texts = (row: Element | null, sel: string) => Array.from(row!.querySelectorAll(sel)).map((n) => n.textContent);

    test("WEEK → MONTH: a heat row's weeks fold to their MEAN, a table's to their SUM, a column layer's to its SUM", () => {
        const { container } = renderPlan(planRoot([weeklyHeat("load"), weeklyTable("dlv"), weeklyColumns], { axis: monthAxis }));
        const heat = container.querySelector(rowSel("load"));
        // Four months hold data — four cells, never twelve overlapping.
        expect(heat!.querySelectorAll("[data-cell]")).toHaveLength(4);
        // June's lone week keeps its own cell; July is the mean of 20, 30, 40, 50.
        expect(texts(heat, "[data-cell] > span")).toEqual(["10", "35", "80", "115"]);
        const table = container.querySelector(rowSel("dlv"));
        expect(table!.querySelectorAll("[data-cell]")).toHaveLength(4);
        expect(texts(table, "[data-cell]")).toEqual(["10", "40", "50", "20"]);
        // One column a month, each the sum of its weeks' points.
        expect(container.querySelectorAll(`${rowSel("out")} [data-plan-mark="column"]`)).toHaveLength(4);
    });

    test("at the data's own resolution nothing folds — twelve weekly cells", () => {
        const { container } = renderPlan(planRoot([weeklyHeat("load"), weeklyTable("dlv")], { axis: weekAxis }));
        expect(container.querySelector(rowSel("load"))!.querySelectorAll("[data-cell]")).toHaveLength(12);
        expect(container.querySelector(rowSel("dlv"))!.querySelectorAll("[data-cell]")).toHaveLength(12);
    });

    test("a declared fold is honoured — a heat row's max, a table's last", () => {
        const { container } = renderPlan(planRoot([weeklyHeat("peak", "max"), weeklyTable("stock", "last")], { axis: monthAxis }));
        expect(texts(container.querySelector(rowSel("peak")), "[data-cell] > span")).toEqual(["10", "50", "100", "120"]);
        expect(texts(container.querySelector(rowSel("stock")), "[data-cell]")).toEqual(["10", "10", "10", "10"]);
    });

    test("a cell with no label prints its value through the arm's declared format — and one without a format prints nothing", () => {
        const pct = variant("percent", { minimumFractionDigits: none, maximumFractionDigits: some(0n), signDisplay: none });
        const { container } = renderPlan(planRoot([
            planRow("fmt", variant("heat", {
                cells: heatArm([{ at: t(W27), value: some(0.42), label: none }], 0, 1, undefined, { format: pct }),
                aggregate: none, scale: none,
            })),
            planRow("bare", variant("heat", {
                cells: heatArm([{ at: t(W27), value: some(0.42), label: none }], 0, 1),
                aggregate: none, scale: none,
            })),
        ], { axis: weekAxis }));
        expect(texts(container.querySelector(rowSel("fmt")), "[data-cell] > span")).toEqual(["42%"]);
        expect(texts(container.querySelector(rowSel("bare")), "[data-cell] > span")).toEqual([""]);
    });
});
