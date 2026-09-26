/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A bound `ui` state (#824) — the host holds the canvas's interaction state in
 * `State.bind` at `Plan.Types.UiState`. The canvas draws it from its first
 * frame, takes every outside write (a selection, rows folded and opened, a
 * chart expanded, a row to bring into view) and writes the user's actions back.
 *
 * The canvas is built by the east-ui factories and COMPILED with the real
 * `State.bind`, so the handle the canvas reads and writes is the one East
 * emits over the state store; the host's own writes reach the store exactly as
 * any `State.bind` handle at the same key puts them there. jsdom lays nothing
 * out, so the bounded frame's height is stubbed and its `scrollTo` moves
 * `scrollTop`, as a browser's does.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    ArrayType, DateTimeType, DictType, East, FloatType, StringType, StructType,
    decodeBeast2For, encodeBeast2For, equalFor, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Chart, Plan, Reactive, State, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { EastChakraComponent } from "../../component.js";
import { getStore, initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { rowItemKey } from "./body-items.js";
import { rowKeyOf, type PlanRowId } from "./row-key.js";

// ── Layout stand-ins: a 400px bounded frame over a tall scroll extent ─────
const VIEWPORT = 400;
const frameHeight = (el: Element): number | undefined =>
    el.getAttribute("data-virtual-rows") === "bounded" ? VIEWPORT : undefined;
const saved = {
    offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!,
    clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")!,
    scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight")!,
    scrollTo: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo"),
};
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

beforeEach(() => {
    initializeStore(new UIStore());
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true, get(this: HTMLElement) { return frameHeight(this) ?? 0; },
    });
    Object.defineProperty(Element.prototype, "clientHeight", {
        configurable: true, get(this: Element) { return frameHeight(this) ?? 0; },
    });
    Object.defineProperty(Element.prototype, "scrollHeight", {
        configurable: true, get(this: Element) { return frameHeight(this) !== undefined ? 1_000_000 : 0; },
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
        configurable: true,
        writable: true,
        value(this: HTMLElement, arg: ScrollToOptions | number) {
            this.scrollTop = typeof arg === "number" ? arg : (arg.top ?? this.scrollTop);
            this.dispatchEvent(new Event("scroll"));
        },
    });
});
afterEach(() => {
    cleanup();
    localStorage.clear();
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", saved.offsetHeight);
    Object.defineProperty(Element.prototype, "clientHeight", saved.clientHeight);
    Object.defineProperty(Element.prototype, "scrollHeight", saved.scrollHeight);
    if (saved.scrollTo !== undefined) Object.defineProperty(HTMLElement.prototype, "scrollTo", saved.scrollTo);
    else delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
});

// ── The canvas ────────────────────────────────────────────────────────────
const W27 = new Date("2026-06-29T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");
const WEEK = 7 * 86_400_000;
const Job = StructType({ key: StringType, start: DateTimeType, end: DateTimeType });
const Machine = StructType({ line: StringType, jobs: ArrayType(Job) });
const Line = DictType(StringType, Machine);
const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
const pad = (n: number) => String(n).padStart(2, "0");

type MachineValue = ValueTypeOf<typeof Machine>;
/** One machine's entry — its line, and a fortnight's run `w` weeks in. */
const machineEntry = (key: string, line: string, w: number): [string, MachineValue] => [key, {
    line,
    jobs: [{ key: "run", start: new Date(W27.getTime() + w * WEEK), end: new Date(W27.getTime() + (w + 2) * WEEK) }],
}];
/** Lines 1 and 2 hold two machines each, Line 3 thirty — so most of Line 3
 *  lies below the 400px view. Module scope: East bodies call no host helpers. */
const MACHINES = new Map<string, MachineValue>([
    ...[1, 2].flatMap((line) => [1, 2].map((m) => machineEntry(`L${line}-M${pad(m)}`, `Line ${line}`, m))),
    ...Array.from({ length: 30 }, (_u, i) => machineEntry(`L3-M${pad(i + 1)}`, "Line 3", i % 8)),
]);
const COVERAGE = Array.from({ length: 12 }, (_u, i) => ({ week: new Date(W27.getTime() + i * WEEK), pct: 88 + (i % 5) }));

/** Where the host keeps the canvas's state. */
const KEY = "plan.824.ui";

/** A coverage chart the gutter opens, then one strip per line with its
 *  machines — the state bound at {@link KEY}, seeded with Line 3 folded. */
const program = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const machines = $.const(MACHINES, DictType(StringType, Machine));
    const lines = $.let(machines.groupToDicts((_$2, m) => m.line, (_$2, _m, k) => k));
    const coverage = $.const(COVERAGE, ArrayType(MeasureRow));
    const ui = $.let(State.bind([Plan.Types.UiState], KEY, Plan.uiState({ collapsed: [Plan.ref("lines", "Line 3")] })));
    return Plan.Root({
        axis: Plan.axis({ window: { min: W27, max: W39 }, resolution: "week" }),
        data: lines,
        series: [
            Plan.series.rows(Line, { key: "kpi", title: "Coverage" }, [
                Plan.chart({
                    key: "coverage", label: "COVERAGE", id: true, height: "spark", expandable: true,
                    layers: [Chart.Line(coverage, { x: (p) => p.week, y: (p) => p.pct })],
                }),
            ]),
            Plan.series.group(Line, {
                key: "lines", title: "Lines",
                label: (_g, line) => line,
                children: Plan.children((g) => g, [
                    Plan.series.span(Machine, {
                        key: "machines", title: "Machines",
                        label: (_m, k) => k, id: true,
                        runs: (m) => m.jobs.map((_$2, j) => Plan.run({
                            key: j.key, start: j.start, end: j.end, label: j.key, state: "confirmed",
                        })),
                    }),
                ]),
            }),
        ],
        ui,
        style: { height: `${VIEWPORT}px` },
    });
})));

function mount(storageKey = "plan-824-ui") {
    const value = East.compile(program as never, getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>;
    return render(
        <ChakraProvider value={system}>
            <EastChakraComponent value={value} storageKey={storageKey} />
        </ChakraProvider>,
    );
}

// ── The rows, by id ───────────────────────────────────────────────────────
/** A row's id — the series that made it and the path of keys to it. */
const entry = (series: string, ...path: string[]) => variant("entry", { series, path }) as PlanRowId;
const LINE = (n: number) => entry("lines", `Line ${n}`);
const MACHINE = (line: number, m: number) => entry("machines", `Line ${line}`, `L${line}-M${pad(m)}`);
const KPI = entry("kpi", "coverage");
/** A selector for a row's element — its `data-plan-row`, or a group band's `data-plan-group`. */
const sel = (id: PlanRowId, attr = "data-plan-row") => `[${attr}=${JSON.stringify(rowKeyOf(id))}]`;
/** A selector for a row's body item — what holds the canvas's tab stop. */
const item = (id: PlanRowId) => `[data-plan-item=${JSON.stringify(rowItemKey(rowKeyOf(id)))}]`;
const frameOf = (c: HTMLElement) => c.querySelector('[data-virtual-rows="bounded"]') as HTMLElement;

// ── The host's side ───────────────────────────────────────────────────────
type UiStateValue = ValueTypeOf<typeof Plan.Types.UiState>;
const encode = encodeBeast2For(Plan.Types.UiState);
const decode = decodeBeast2For(Plan.Types.UiState);
const uiEqual = equalFor(Plan.Types.UiState);
/** A whole state — everything not given empty. */
const state = (s: Partial<UiStateValue>): UiStateValue =>
    ({ selected: none, collapsed: [], expanded: [], charts: [], focus: none, ...s });
/** What the host holds — what its own `ui.read()` returns. */
const held = (): UiStateValue => decode(getStore().read(KEY)!);
/** The host writes its state, as a `ui.write` beside the canvas would. */
const hostWrites = (s: UiStateValue) => act(() => { getStore().write(KEY, encode(s)); });
const keys = (ids: readonly PlanRowId[]) => ids.map(rowKeyOf);
const selectedKey = () => {
    const s = held().selected;
    return s.type === "some" ? rowKeyOf(s.value) : null;
};

describe("a bound ui state (#824)", () => {
    test("the host's state is drawn from the first frame — Line 3 folded as it says, every other row as it declares", () => {
        const { container } = mount();
        expect(container.querySelector(sel(LINE(3), "data-plan-group"))!.getAttribute("aria-expanded")).toBe("false");
        expect(container.querySelector(sel(MACHINE(3, 1)))).toBeNull();
        expect(container.querySelector(sel(MACHINE(1, 1)))).toBeTruthy();
        expect(container.querySelector(sel(MACHINE(2, 2)))).toBeTruthy();
        // Nothing done yet, nothing written back: the host's seed stands.
        expect(uiEqual(held(), state({ collapsed: [LINE(3)] }))).toBe(true);
    });

    test("an outside write selects a row, folds a line, opens another and expands a chart — and nothing comes back", async () => {
        const { container } = mount();
        const written = state({ selected: some(MACHINE(2, 1)), collapsed: [LINE(1)], expanded: [LINE(3)], charts: [KPI] });
        hostWrites(written);
        expect(container.querySelector(sel(MACHINE(2, 1)))!.hasAttribute("data-selected")).toBe(true);
        expect(container.querySelector(sel(MACHINE(1, 1)))).toBeNull();
        expect(container.querySelector(sel(LINE(1), "data-plan-group"))!.getAttribute("aria-expanded")).toBe("false");
        expect(container.querySelector(sel(MACHINE(3, 1)))).toBeTruthy();
        // The chart at its expanded height — 88px, where the spark is 32.
        expect(container.querySelector(`${sel(KPI)} [data-plan-mark="line"]`)!.closest("svg")!.getAttribute("viewBox"))
            .toBe("0 0 1000 88");
        // The canvas took the host's state as it is: no write-back, no echo.
        await act(async () => { await Promise.resolve(); });
        expect(uiEqual(held(), written)).toBe(true);
        // A row in neither list follows its declaration again.
        hostWrites(state({ selected: some(MACHINE(2, 1)) }));
        expect(container.querySelector(sel(MACHINE(1, 1)))).toBeTruthy();
        expect(container.querySelector(sel(MACHINE(3, 1)))).toBeTruthy();
    });

    test("a focus request opens the folded line, scrolls its row to the top of the view and makes it the tab stop — and is spent", async () => {
        const { container } = mount();
        expect(frameOf(container).scrollTop).toBe(0);
        hostWrites(state({ collapsed: [LINE(3)], focus: some(MACHINE(3, 10)) }));
        // The row at the top of the view — Line 3 opened to show it: the spark
        // 32, two open lines of 26 + 2 × 32 each, Line 3's band 26 and nine
        // machines of 32 — 526px.
        await waitFor(() => expect(frameOf(container).scrollTop).toBe(526));
        expect(container.querySelector(sel(MACHINE(3, 10)))).toBeTruthy();
        expect(container.querySelector(item(MACHINE(3, 10)))!.getAttribute("tabindex")).toBe("0");
        // DOM focus stays where it was: the host asked for the row to be shown.
        expect(document.activeElement).toBe(document.body);
        // Spent — and the line it opened is the host's to hold, like any open.
        await waitFor(() => expect(held().focus.type).toBe("none"));
        expect(keys(held().collapsed)).toEqual([]);
        expect(keys(held().expanded)).toEqual([rowKeyOf(LINE(3))]);
        // Back at the top, Line 3's band says it is open.
        act(() => { frameOf(container).scrollTo({ top: 0 }); });
        expect(container.querySelector(sel(LINE(3), "data-plan-group"))!.getAttribute("aria-expanded")).toBe("true");
    });

    test("what the user does is written back — a selection, a fold, a chart — and no toggle is kept in storage", async () => {
        const { container } = mount("plan-824-writeback");
        fireEvent.click(container.querySelector(sel(MACHINE(1, 2)))!);
        await waitFor(() => expect(selectedKey()).toBe(rowKeyOf(MACHINE(1, 2))));
        // A fold joins the host's list after the rows it placed there.
        fireEvent.click(container.querySelector(sel(LINE(2), "data-plan-group"))!);
        expect(container.querySelector(sel(MACHINE(2, 1)))).toBeNull();
        await waitFor(() => expect(keys(held().collapsed)).toEqual([rowKeyOf(LINE(3)), rowKeyOf(LINE(2))]));
        fireEvent.click(container.querySelector(sel(KPI))!.children[0]!);
        await waitFor(() => expect(keys(held().charts)).toEqual([rowKeyOf(KPI)]));
        expect(selectedKey()).toBe(rowKeyOf(MACHINE(1, 2)));
        expect(held().focus.type).toBe("none");
        // Bound, the host holds the toggles: the canvas persists none of its own.
        const toggles = Object.keys(localStorage).flatMap((k) => {
            const stored = JSON.parse(localStorage.getItem(k) ?? "null") as { collapse?: unknown[]; charts?: unknown[] } | null;
            return [...(stored?.collapse ?? []), ...(stored?.charts ?? [])];
        });
        expect(toggles).toEqual([]);
    });
});
