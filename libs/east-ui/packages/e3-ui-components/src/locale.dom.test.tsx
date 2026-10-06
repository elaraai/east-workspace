/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * One locale for every renderer: a host's one `I18nProvider` — the one
 * east-ui-components re-exports, or react-aria's own — reaches this package's
 * renderers (the Plan, the Sheet) and east-ui-components' alike. Bundled into
 * a package's build, react-aria's locale context was that package's alone:
 * the Plan read one, east-ui-components' components another, and a host's
 * provider reached only one of them.
 */

import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { I18nProvider as ReactAriaI18nProvider } from "@react-aria/i18n";
import { ArrayType, DateTimeType, DictType, East, FloatType, OptionType, StringType, StructType, some } from "@elaraai/east";
import { Format, Numeric, UIComponentType } from "@elaraai/east-ui/internal";
import {
    EastChakraComponent, I18nProvider as ComponentsI18nProvider, UIStore, getRegisteredPlatformImplementations, system,
} from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { Plan, Sheet } from "@elaraai/e3-ui/internal";
import { boundFrame } from "./sheet/frame.test-utils.js";
// The Plan and the Sheet are extensions: each renderer registers as it loads.
import "./plan/index.js";
import "./sheet/frame/index.js";

// The Sheet's frame, tall enough for its row (#1216).
let restoreFrame: () => void = () => {};
beforeEach(() => { restoreFrame = boundFrame(2000); });
afterEach(() => {
    cleanup();
    localStorage.clear();
    restoreFrame();
});

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const W27 = new Date("2026-06-29T00:00:00Z");           // a Monday
const W28 = new Date("2026-07-06T00:00:00Z");
const UnitRow = StructType({ start: DateTimeType, end: DateTimeType });
const Units = DictType(StringType, UnitRow);
/** One unit — module scope, so the East bodies call no host helper. */
const UNITS = new Map([["u1", { start: W27, end: W28 }]]);

/** A Plan over one week at day resolution: its ruler names the days in the locale. */
const PLAN = East.function([], UIComponentType, ($) => {
    const units = $.const(UNITS, Units);
    const series = $.const([
        Plan.series.span(UnitRow, {
            key: "units", title: "Units", label: (_r, k) => k, id: true,
            runs: (r) => [Plan.run({ key: "run", start: r.start, end: r.end, label: "RUN", state: "actual" })],
        }),
    ], ArrayType(Plan.Types.Series(UnitRow)));
    const axis = $.const(Plan.axis({ window: { min: W27, max: W28 }, resolution: "day", now: W27 }));
    return Plan.View({ axis, data: units, series });
});

/** A Sheet with a quantity: its cell prints in the locale. */
const QtyRow = StructType({ id: StringType, qty: OptionType(FloatType) });
const QTY_ROWS = [{ id: "a", qty: some(1234.5) }];
const SHEET = East.function([], UIComponentType, ($) => {
    const rows = $.const(QTY_ROWS, ArrayType(QtyRow));
    return Sheet({ data: rows, columns: { qty: Sheet.column.quantity(QtyRow, { header: "Qty" }) }, id: "id" });
});

/** One of east-ui-components' own: a currency. */
const NUMERIC = East.function([], UIComponentType, (_$) => Numeric.Root(1234.5, { format: Format.Currency({ currency: "EUR" }) }));

const PROVIDERS = [
    ["the one east-ui-components re-exports", ComponentsI18nProvider],
    ["react-aria's own", ReactAriaI18nProvider],
] as const;

describe.each(PROVIDERS)("the host's provider is %s", (_name, Provider) => {
    test("the Plan, the Sheet and east-ui-components' components speak its locale alike", () => {
        initializeStore(new UIStore());
        const platform = getRegisteredPlatformImplementations();
        const { container } = render(
            <ChakraProvider value={system}>
                <Provider locale="de-DE">
                    <div data-locale-part="plan"><EastChakraComponent value={East.compile(PLAN, platform)()} storageKey="locale-plan" /></div>
                    <div data-locale-part="sheet"><EastChakraComponent value={East.compile(SHEET, platform)()} storageKey="locale-sheet" /></div>
                    <div data-locale-part="numeric"><EastChakraComponent value={East.compile(NUMERIC, platform)()} storageKey="locale-numeric" /></div>
                </Provider>
            </ChakraProvider>,
        );
        const part = (name: string) => container.querySelector(`[data-locale-part="${name}"]`)!;
        expect([...part("plan").querySelectorAll("[data-slot='rulerTick']")].map((t) => t.textContent))
            .toEqual(["MO", "DI", "MI", "DO", "FR", "SA", "SO"]);
        expect(part("sheet").querySelector('[data-row-id="a"] [data-key="qty"]')!.textContent).toBe("1.234,5");
        expect(part("numeric").textContent).toBe("1.234,50\u00a0€");
    });
});
