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
 * The canvas is built by the e3-ui factory and COMPILED with the real
 * `State.bind`, and rendered through its `Plan` carrier as an app's is, so
 * the handle the canvas reads and writes is the one East emits over the state
 * store, carried in the payload's bytes; the host's own writes reach the store
 * exactly as any `State.bind` handle at the same key puts them there. jsdom
 * lays nothing out, so the bounded frame's height is stubbed and its
 * `scrollTo` moves `scrollTop`, as a browser's does.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    ArrayType, DateTimeType, DictType, East, FloatType, StringType, StructType,
    decodeBeast2For, encodeBeast2For, equalFor, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Chart, Reactive, State, UIComponentType } from "@elaraai/east-ui/internal";
import { Plan } from "@elaraai/e3-ui/internal";
import { system, EastChakraComponent, UIStore, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { getStore, initializeStore } from "@elaraai/east-ui-components/internal";
import { rowItemKey } from "./body-items.js";
import { rowKeyOf, type PlanRowId } from "./row-key.js";
// The canvas is an extension: its renderer registers as it loads.
import "./index.js";

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
const Press = StructType({ hall: StringType, jobs: ArrayType(Job) });
const Hall = DictType(StringType, Press);
const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
const pad = (n: number) => String(n).padStart(2, "0");

type PressValue = ValueTypeOf<typeof Press>;
/** One press's entry — its hall, and a fortnight's run `w` weeks in. */
const pressEntry = (key: string, hall: string, w: number): [string, PressValue] => [key, {
    hall,
    jobs: [{ key: "run", start: new Date(W27.getTime() + w * WEEK), end: new Date(W27.getTime() + (w + 2) * WEEK) }],
}];
/** Halls 1 and 2 hold two presses each, Hall 3 thirty — so most of Hall 3
 *  lies below the 400px view. Module scope: East bodies call no host helpers. */
const PRESSES = new Map<string, PressValue>([
    ...[1, 2].flatMap((hall) => [1, 2].map((p) => pressEntry(`H${hall}-P${pad(p)}`, `Hall ${hall}`, p))),
    ...Array.from({ length: 30 }, (_u, i) => pressEntry(`H3-P${pad(i + 1)}`, "Hall 3", i % 8)),
]);
const ON_TIME = Array.from({ length: 12 }, (_u, i) => ({ week: new Date(W27.getTime() + i * WEEK), pct: 88 + (i % 5) }));

/** Where the host keeps the canvas's state. */
const KEY = "plan.824.ui";

/** An on-time chart the gutter opens, then one strip per hall with its
 *  presses — the state bound at {@link KEY}, seeded with Hall 3 folded. */
const program = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.const(PRESSES, DictType(StringType, Press));
    const halls = $.let(presses.groupToDicts((_$2, p) => p.hall, (_$2, _p, k) => k));
    const onTime = $.const(ON_TIME, ArrayType(MeasureRow));
    const ui = $.let(State.bind([Plan.Types.UiState], KEY, Plan.uiState({ collapsed: [Plan.ref("halls", "Hall 3")] })));
    return Plan({
        axis: Plan.axis({ window: { min: W27, max: W39 }, resolution: "week" }),
        data: halls,
        series: [
            Plan.series.rows(Hall, { key: "kpi", title: "On-time" }, [
                Plan.chart({
                    key: "ontime", label: "ON-TIME", id: true, height: "spark", expandable: true,
                    layers: [Chart.Line(onTime, { x: (p) => p.week, y: (p) => p.pct })],
                }),
            ]),
            Plan.series.group(Hall, {
                key: "halls", title: "Halls",
                label: (_g, hall) => hall,
                children: Plan.children((g) => g, [
                    Plan.series.span(Press, {
                        key: "presses", title: "Presses",
                        label: (_p, k) => k, id: true,
                        runs: (p) => p.jobs.map((_$2, j) => Plan.run({
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
const HALL = (n: number) => entry("halls", `Hall ${n}`);
const PRESS = (hall: number, p: number) => entry("presses", `Hall ${hall}`, `H${hall}-P${pad(p)}`);
const KPI = entry("kpi", "ontime");
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
    test("the host's state is drawn from the first frame — Hall 3 folded as it says, every other row as it declares", () => {
        const { container } = mount();
        expect(container.querySelector(sel(HALL(3), "data-plan-group"))!.getAttribute("aria-expanded")).toBe("false");
        expect(container.querySelector(sel(PRESS(3, 1)))).toBeNull();
        expect(container.querySelector(sel(PRESS(1, 1)))).toBeTruthy();
        expect(container.querySelector(sel(PRESS(2, 2)))).toBeTruthy();
        // Nothing done yet, nothing written back: the host's seed stands.
        expect(uiEqual(held(), state({ collapsed: [HALL(3)] }))).toBe(true);
    });

    test("an outside write selects a row, folds a hall, opens another and expands a chart — and nothing comes back", async () => {
        const { container } = mount();
        const written = state({ selected: some(PRESS(2, 1)), collapsed: [HALL(1)], expanded: [HALL(3)], charts: [KPI] });
        hostWrites(written);
        expect(container.querySelector(sel(PRESS(2, 1)))!.hasAttribute("data-selected")).toBe(true);
        expect(container.querySelector(sel(PRESS(1, 1)))).toBeNull();
        expect(container.querySelector(sel(HALL(1), "data-plan-group"))!.getAttribute("aria-expanded")).toBe("false");
        expect(container.querySelector(sel(PRESS(3, 1)))).toBeTruthy();
        // The chart at its expanded height — 88px, where the spark is 32.
        expect(container.querySelector(`${sel(KPI)} [data-plan-mark="line"]`)!.closest("svg")!.getAttribute("viewBox"))
            .toBe("0 0 1000 88");
        // The canvas took the host's state as it is: no write-back, no echo.
        await act(async () => { await Promise.resolve(); });
        expect(uiEqual(held(), written)).toBe(true);
        // A row in neither list follows its declaration again.
        hostWrites(state({ selected: some(PRESS(2, 1)) }));
        expect(container.querySelector(sel(PRESS(1, 1)))).toBeTruthy();
        expect(container.querySelector(sel(PRESS(3, 1)))).toBeTruthy();
    });

    test("a focus request opens the folded hall, scrolls its row to the top of the view and makes it the tab stop — and is spent", async () => {
        const { container } = mount();
        expect(frameOf(container).scrollTop).toBe(0);
        hostWrites(state({ collapsed: [HALL(3)], focus: some(PRESS(3, 10)) }));
        // The row at the top of the view — Hall 3 opened to show it: the spark
        // 32, two open halls of 26 + 2 × 32 each, Hall 3's band 26 and nine
        // presses of 32 — 526px.
        await waitFor(() => expect(frameOf(container).scrollTop).toBe(526));
        expect(container.querySelector(sel(PRESS(3, 10)))).toBeTruthy();
        expect(container.querySelector(item(PRESS(3, 10)))!.getAttribute("tabindex")).toBe("0");
        // DOM focus stays where it was: the host asked for the row to be shown.
        expect(document.activeElement).toBe(document.body);
        // Spent — and the hall it opened is the host's to hold, like any open.
        await waitFor(() => expect(held().focus.type).toBe("none"));
        expect(keys(held().collapsed)).toEqual([]);
        expect(keys(held().expanded)).toEqual([rowKeyOf(HALL(3))]);
        // Back at the top, Hall 3's band says it is open.
        act(() => { frameOf(container).scrollTo({ top: 0 }); });
        expect(container.querySelector(sel(HALL(3), "data-plan-group"))!.getAttribute("aria-expanded")).toBe("true");
    });

    test("what the user does is written back — a selection, a fold, a chart — and no toggle is kept in storage", async () => {
        const { container } = mount("plan-824-writeback");
        fireEvent.click(container.querySelector(sel(PRESS(1, 2)))!);
        await waitFor(() => expect(selectedKey()).toBe(rowKeyOf(PRESS(1, 2))));
        // A fold joins the host's list after the rows it placed there.
        fireEvent.click(container.querySelector(sel(HALL(2), "data-plan-group"))!);
        expect(container.querySelector(sel(PRESS(2, 1)))).toBeNull();
        await waitFor(() => expect(keys(held().collapsed)).toEqual([rowKeyOf(HALL(3)), rowKeyOf(HALL(2))]));
        fireEvent.click(container.querySelector(sel(KPI))!.children[0]!);
        await waitFor(() => expect(keys(held().charts)).toEqual([rowKeyOf(KPI)]));
        expect(selectedKey()).toBe(rowKeyOf(PRESS(1, 2)));
        expect(held().focus.type).toBe("none");
        // Bound, the host holds the toggles: the canvas persists none of its own.
        const toggles = Object.keys(localStorage).flatMap((k) => {
            const stored = JSON.parse(localStorage.getItem(k) ?? "null") as { collapse?: unknown[]; charts?: unknown[] } | null;
            return [...(stored?.collapse ?? []), ...(stored?.charts ?? [])];
        });
        expect(toggles).toEqual([]);
    });
});
