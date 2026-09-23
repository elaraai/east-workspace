/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A canvas whose CLOSURES change must render the change (#809).
 *
 * East's `equalFor` treats every function as equal, so a Plan memoized on it
 * dropped any new root that differed only inside a closure: a resolver that
 * captured new data, a series `match` over a new threshold. The memo now
 * compares with `equivalentFor` (IR + captured values), and the paged window
 * cache is keyed on the source's equivalence — so both halves are exercised
 * here on values built by the real factory and COMPILED, whose closures are the
 * ones East emits.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    ArrayType, DateTimeType, DictType, East, FloatType, NullType, StringType, StructType,
    none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Paged } from "@elaraai/east-ui";
import { Plan, Text, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { EastChakraPlan, type PlanRootValue } from "./index.js";

afterEach(cleanup);

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const W27 = new Date("2026-06-29T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");
const NOW = new Date("2026-08-12T00:00:00Z");

const UnitRow = StructType({ start: DateTimeType, end: DateTimeType, tonnes: FloatType });

/** Twelve units with tonnes 5, 10, … 60 — generated at module scope (East
 *  bodies never call host helpers). */
const UNITS = new Map(Array.from({ length: 12 }, (_, i) => [
    `u${String(i).padStart(2, "0")}`,
    { start: W27, end: W39, tonnes: (i + 1) * 5 },
] as const));

/** Counts every call of the expand resolver — observed through a platform
 *  function inside its body, so the closure stays a real East function. */
let expandCalls = 0;
const countExpand = East.platform("test_plan_count_expand", [], NullType);
const PLATFORM = [
    ...getRegisteredPlatformImplementations(),
    countExpand.implement(() => { expandCalls += 1; }),
];

/** An INLINE canvas whose `expandRender` captures `label`. One compiled
 *  program, so every call yields closures over the same IR. */
const inlineCanvas = East.compile(East.function([StringType], UIComponentType, ($, label) => {
    const units = $.const(UNITS, DictType(StringType, UnitRow));
    const series = $.const([
        Plan.series.span(UnitRow, {
            key: "units", title: "Units",
            label: (_r, k) => k, id: true,
            expand: (_r) => some({ height: none, axis: variant("keep", null) }),
            runs: (r) => [Plan.run({ key: "run", start: r.start, end: r.end, label: "RUN", state: "actual" })],
        }),
    ], ArrayType(Plan.Types.Series(UnitRow)));
    const expandRender = $.const(East.function([Plan.Types.RowRef], UIComponentType, ($2, _ref) => {
        $2(countExpand());
        return Text.Root(label);
    }));
    const axis = $.const(Plan.axis({ window: { min: W27, max: W39 }, resolution: "week", now: NOW }));
    return Plan.Root({ axis, data: units, series, expandRender });
}), PLATFORM);

/** A PAGED canvas whose one series keeps the units heavier than `threshold`
 *  — the threshold is captured by the series, and so by the derived `page`. */
const pagedCanvas = East.compile(East.function([FloatType], UIComponentType, ($, threshold) => {
    const units = $.const(UNITS, DictType(StringType, UnitRow));
    const source = $.const(Paged.of("units", units));
    const series = $.const([
        Plan.series.span(UnitRow, {
            key: "units", title: "Units",
            match: (r) => r.tonnes.greater(threshold),
            label: (_r, k) => k, id: true,
            runs: (r) => [Plan.run({ key: "run", start: r.start, end: r.end, label: "RUN", state: "actual" })],
        }),
    ], ArrayType(Plan.Types.Series(UnitRow)));
    const axis = $.const(Plan.axis({ window: { min: W27, max: W39 }, resolution: "week", now: NOW }));
    return Plan.Root({ axis, data: source, series });
}), PLATFORM);

/** Unwrap the `Plan` arm the renderer takes. */
function planOf(value: ValueTypeOf<typeof UIComponentType>): PlanRootValue {
    return (value as { value: PlanRootValue }).value;
}

function view(value: PlanRootValue) {
    return (
        <ChakraProvider value={system}>
            <EastChakraPlan value={value} storageKey="plan-equivalence" />
        </ChakraProvider>
    );
}

const rowKeys = (container: HTMLElement): string[] =>
    [...container.querySelectorAll("[data-plan-row]")].map((el) => el.getAttribute("data-plan-row")!);

describe("Plan — closures that change (#809)", () => {
    test("a resolver that captured new data re-renders; a rebuild with the same captures does not", async () => {
        initializeStore(new UIStore());
        expandCalls = 0;
        const { container, rerender } = render(view(planOf(inlineCanvas("ALPHA"))));
        await waitFor(() => expect(container.querySelector('[data-plan-row="u00"]')).toBeTruthy());

        const control = container.querySelector('[data-plan-row="u00"] [data-plan-control="expand"]') as HTMLElement;
        fireEvent.click(control);
        await waitFor(() => expect(container.querySelector("[data-plan-expandrender]")?.textContent).toBe("ALPHA"));
        const callsAfterOpen = expandCalls;
        expect(callsAfterOpen).toBeGreaterThan(0);

        // The same program, the same capture: an equivalent root. The memo
        // bails, so the resolver is not called again.
        rerender(view(planOf(inlineCanvas("ALPHA"))));
        expect(expandCalls).toBe(callsAfterOpen);

        // Only the captured label differs — equalFor called these equal and
        // the canvas kept rendering "ALPHA".
        rerender(view(planOf(inlineCanvas("BETA"))));
        await waitFor(() => expect(container.querySelector("[data-plan-expandrender]")?.textContent).toBe("BETA"));
    }, 30_000);

    test("a paged series whose captured threshold changes re-derives the resident windows", async () => {
        initializeStore(new UIStore());
        const { container, rerender } = render(view(planOf(pagedCanvas(0))));
        await waitFor(() => expect(rowKeys(container)).toHaveLength(12));

        // Same handle id, same raw windows — only the series closure moved.
        rerender(view(planOf(pagedCanvas(40))));
        await waitFor(() => expect(rowKeys(container)).toEqual(["u08", "u09", "u10", "u11"]));
    }, 30_000);
});
