/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Plan through its carrier (#1177). `<Plan.View>` returns the canvas as the
 * `PlanView` extension — its payload's bytes beside its kind — and the
 * dispatcher hands it to the renderer registered against that kind, decoding
 * the payload's functions against the registered platform. Every canvas here
 * is built by the e3-ui factory, compiled, and rendered through
 * `EastChakraComponent`, as an app renders it.
 */

import { describe, test, expect, afterEach, afterAll } from "vitest";
import { render, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, StringType, StructType,
    encodeBeast2For, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Paged } from "@elaraai/east-ui";
import { Reactive, State, Text, UIComponentType } from "@elaraai/east-ui/internal";
import {
    EastChakraComponent, UIStore, getRegisteredPlatformImplementations, registerPlatformImplementation, system,
} from "@elaraai/east-ui-components";
import { getStore, initializeStore } from "@elaraai/east-ui-components/internal";
import { Plan } from "@elaraai/e3-ui/internal";
import { rowSel, testKeyOf } from "./plan.test-utils.js";
// The canvas is an extension: its renderer registers as it loads.
import "./index.js";

afterEach(() => {
    cleanup();
    localStorage.clear();
});

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

type UIValue = ValueTypeOf<typeof UIComponentType>;

const encodeString = encodeBeast2For(StringType);
const encodeInteger = encodeBeast2For(IntegerType);

const W27 = new Date("2026-06-29T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");
const NOW = new Date("2026-08-12T00:00:00Z");
const UnitRow = StructType({ start: DateTimeType, end: DateTimeType, tonnes: FloatType });
const Units = DictType(StringType, UnitRow);
/** Three units — module scope, so the East bodies call no host helper. */
const UNITS = new Map(Array.from({ length: 3 }, (_, i) => [
    `u${String(i).padStart(2, "0")}`,
    { start: W27, end: W39, tonnes: (i + 1) * 5 },
] as const));

/** The units as a paged source, built in East to the row-source contract: a
 *  window of them at a time, in key order. */
const UNITS_PAGE = East.function([IntegerType, IntegerType], OptionType(Units), ($, offset, limit) => {
    const all = $.const(UNITS, Units);
    const keys = $.let(all.toArray((_$, _v, k) => k));
    const n = $.let(keys.size());
    const start = $.let(offset.less(n).ifElse(() => offset, () => n));
    const end = $.let(start.add(limit).less(n).ifElse(() => start.add(limit), () => n));
    return some(all.getKeys(keys.slice(start, end).toSet()));
});
const UNITS_TOTAL = East.function([], OptionType(IntegerType), ($) => {
    const all = $.const(UNITS, Units);
    return some(all.size());
});
const UNITS_SOURCE = { id: "units", page: UNITS_PAGE, total: UNITS_TOTAL, seek: none };

/** Render a compiled UI value through the dispatcher. */
function mount(value: UIValue, storageKey: string) {
    return render(
        <ChakraProvider value={system}>
            <EastChakraComponent value={value} storageKey={storageKey} />
        </ChakraProvider>,
    );
}

/** A unit's row — the `units` series' entry at its key (#822). */
const unitRow = (key: string) => rowSel(key, "data-plan-row", "units");
/** Every row drawn, by its key in the test's words. */
const rowKeys = (container: HTMLElement): string[] =>
    [...container.querySelectorAll("[data-plan-row]")].map((el) => testKeyOf(el.getAttribute("data-plan-row")!));

/** A canvas over `data` — one span row per unit, its run labelled with its key. */
const VIEW = East.function([], UIComponentType, ($) => {
    const units = $.const(UNITS, Units);
    const series = $.const([
        Plan.series.span(UnitRow, {
            key: "units", title: "Units",
            label: (_r, k) => k, id: true,
            runs: (r, k) => [Plan.run({ key: "run", start: r.start, end: r.end, label: East.str`RUN · ${k}`, state: "actual" })],
        }),
    ], ArrayType(Plan.Types.Series(UnitRow)));
    const axis = $.const(Plan.axis({ window: { min: W27, max: W39 }, resolution: "week", now: NOW }));
    return Plan.View({ axis, data: units, series });
});

/** The same canvas over a paged source of the units. */
const PAGED_VIEW = East.function([], UIComponentType, ($) => {
    const source = $.const(UNITS_SOURCE, Paged.Types.Source(Units));
    const series = $.const([
        Plan.series.span(UnitRow, {
            key: "units", title: "Units",
            label: (_r, k) => k, id: true,
            runs: (r, k) => [Plan.run({ key: "run", start: r.start, end: r.end, label: East.str`RUN · ${k}`, state: "actual" })],
        }),
    ], ArrayType(Plan.Types.Series(UnitRow)));
    const axis = $.const(Plan.axis({ window: { min: W27, max: W39 }, resolution: "week", now: NOW }));
    return Plan.View({ axis, data: source, series });
});

describe("<Plan.View> through its carrier (#1177)", () => {
    test("the canvas is the PlanView extension — its payload carried as bytes beside its kind — and the dispatcher draws it", async () => {
        initializeStore(new UIStore());
        const value = East.compile(VIEW, getRegisteredPlatformImplementations())();
        if (value.type !== "Extension") throw new Error(`expected the PlanView extension, got the ${value.type} arm`);
        expect(value.value.kind).toBe("PlanView");
        const { container } = mount(value, "plan-carrier-view");
        await waitFor(() => expect(rowKeys(container)).toEqual(["u00", "u01", "u02"]));
        expect(container.querySelector(`${unitRow("u01")} [data-run="run"]`)!.textContent).toContain("RUN · u01");
        expect(container.querySelector("[role='treegrid']")!.getAttribute("aria-rowcount")).toBe("3");
    });

    test("a paged source crosses the carrier — its page and total are East functions, decoded, and called by the canvas", async () => {
        initializeStore(new UIStore());
        const { container } = mount(East.compile(PAGED_VIEW, getRegisteredPlatformImplementations())(), "plan-carrier-paged");
        await waitFor(() => expect(rowKeys(container)).toEqual(["u00", "u01", "u02"]));
        await waitFor(() => expect(container.querySelector('[data-slot="footerTransport"]')?.textContent).toBe("3 loaded of 3"));
    });
});

// ── A Plan whose resolver captured State (#809) ─────────────────────────────

const LABEL_KEY = "plan.carrier.label";
const TICK_KEY = "plan.carrier.tick";

/** Counts the resolver's calls — through a platform function in its body, so
 *  the resolver stays a real East closure. The dispatcher decodes the
 *  payload's functions against the registered platform, so it is registered
 *  there. */
let expandCalls = 0;
const countExpand = East.platform("test_plan_carrier_count_expand", [], NullType);
const unregisterCount = registerPlatformImplementation([countExpand.implement(() => { expandCalls += 1; })]);
afterAll(unregisterCount);

/** A Reactive canvas: the expand resolver captures the label READ from State
 *  (a value, not the handle), and the render also reads a tick nothing captures
 *  — so a tick write rebuilds an EQUIVALENT canvas, a label write a new one. */
const reactivePlan = East.compile(East.function([], UIComponentType, (_$) =>
    Reactive.Root(East.function([], UIComponentType, ($) => {
        const labelBind = $.let(State.bind([StringType], LABEL_KEY, "ALPHA"));
        const tickBind = $.let(State.bind([IntegerType], TICK_KEY, 0n));
        const label = $.const(labelBind.read());
        $(tickBind.read());
        const units = $.const(UNITS, Units);
        const series = $.const([
            Plan.series.span(UnitRow, {
                key: "units", title: "Units",
                label: (_r, k) => k, id: true,
                expand: (_r) => some({ height: none, axis: variant("keep", null) }),
                runs: (r) => [Plan.run({ key: "run", start: r.start, end: r.end, label: "RUN", state: "actual" })],
            }),
        ], ArrayType(Plan.Types.Series(UnitRow)));
        const expandRender = $.const(East.function([Plan.Types.RowId], UIComponentType, ($2, _id) => {
            $2(countExpand());
            return Text.Root(label);
        }));
        const axis = $.const(Plan.axis({ window: { min: W27, max: W39 }, resolution: "week", now: NOW }));
        return Plan.View({ axis, data: units, series, expandRender });
    })),
), getRegisteredPlatformImplementations());

describe("closure-only changes through the dispatcher (#809)", () => {
    test("a Reactive re-renders a Plan whose resolver captured new State; an equivalent rebuild does not", async () => {
        initializeStore(new UIStore());
        expandCalls = 0;
        const { container } = mount(reactivePlan(), "plan-carrier-equivalence");
        const unit = unitRow("u00");
        await waitFor(() => expect(container.querySelector(unit)).toBeTruthy());
        fireEvent.click(container.querySelector(`${unit} [data-plan-control="expand"]`) as HTMLElement);
        await waitFor(() => expect(container.querySelector("[data-plan-expandrender]")?.textContent).toBe("ALPHA"));
        const callsAfterOpen = expandCalls;
        expect(callsAfterOpen).toBeGreaterThan(0);

        // The render re-runs, but the rebuilt canvas is equivalent — same data,
        // same resolver IR, same captured label: every memo bails.
        act(() => { getStore().write(TICK_KEY, encodeInteger(1n)); });
        expect(expandCalls).toBe(callsAfterOpen);

        // Only the resolver's capture moved. `equalFor` called the canvases
        // equal and the open region kept saying ALPHA.
        act(() => { getStore().write(LABEL_KEY, encodeString("BETA")); });
        await waitFor(() => expect(container.querySelector("[data-plan-expandrender]")?.textContent).toBe("BETA"));
    }, 30_000);
});
