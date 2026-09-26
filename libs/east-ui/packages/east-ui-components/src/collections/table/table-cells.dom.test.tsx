/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A Table cell with no `render` prints itself, in the viewer's language
 * (#874). A number with no declared format keeps every digit and is never
 * grouped, with the viewer's decimal separator, so a year or an id prints as
 * stored in every language; a column that declares a `Format.*` spec prints
 * its cells, and its group totals, through it. In English every undeclared
 * cell reads exactly as East prints it — what the factory's old default
 * showed. The table is built by the east-ui factory and COMPILED, so the
 * renderer reads what an author's program produces.
 */

import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { I18nProvider } from "@react-aria/i18n";
import {
    ArrayType, BooleanType, DateTimeType, East, FloatType, IntegerType, StringType, StructType, printFor, type ValueTypeOf,
} from "@elaraai/east";
import { Format, Table, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { EastChakraComponent } from "../../component.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

beforeEach(() => { initializeStore(new UIStore()); });
afterEach(cleanup);

type UIValue = ValueTypeOf<typeof UIComponentType>;

// ── Fixtures, at module scope ───────────────────────────────────────────────

/** One region's order lines: every cell kind, and two declared formats. */
const LineType = StructType({
    region: StringType, year: IntegerType, id: IntegerType, qty: FloatType, whole: FloatType,
    revenue: FloatType, fee: FloatType, shipped: BooleanType, at: DateTimeType,
});
const AT = [new Date(Date.UTC(2026, 5, 29, 22, 30)), new Date(Date.UTC(2026, 5, 30, 8, 0))];
const LINES = [
    { region: "North", year: 2026n, id: 1234567n, qty: 1234.5, whole: 1234, revenue: 1234.5, fee: 12.5, shipped: true, at: AT[0]! },
    { region: "North", year: 2026n, id: 1234568n, qty: 0.25, whole: 2, revenue: 1000, fee: 7, shipped: false, at: AT[1]! },
];

/** The table, with no `render` anywhere: revenue sums through its declared
 *  number format; the fee column COUNTS its lines, so its currency format
 *  must not reach the total. Unvirtualized, so jsdom mounts every row. */
const TABLE = East.compile(East.function([], UIComponentType, ($) => {
    const lines = $.const(LINES, ArrayType(LineType));
    return Table.Root(lines, {
        region: { header: "Region" },
        year: { header: "Year" },
        id: { header: "Id" },
        qty: { header: "Qty" },
        whole: { header: "Whole" },
        revenue: { header: "Revenue", format: Format.Number(), aggregate: "sum" },
        fee: { header: "Fee", format: Format.Currency({ currency: "EUR" }), aggregate: "count" },
        shipped: { header: "Shipped" },
        at: { header: "At" },
    }, { virtualization: false, groupBy: [(r) => r.region] });
}), getRegisteredPlatformImplementations())() as UIValue;

/** A euro amount as `Intl` prints it in a locale — the oracle for the fee column. */
const eur = (locale: string, n: number): string => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);

function renderIn(locale: string) {
    return render(
        <ChakraProvider value={system}>
            <I18nProvider locale={locale}>
                <EastChakraComponent value={TABLE} storageKey={`table-cells-${locale}`} />
            </I18nProvider>
        </ChakraProvider>,
    );
}

/** Each member row's cell texts, in column order. */
function memberRows(container: HTMLElement): string[][] {
    return [...container.querySelectorAll("tbody tr")]
        .filter((tr) => tr.getAttribute("data-slot") !== "groupHead")
        .map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent ?? ""));
}

/** The group header's totals, in column order. */
function groupTotals(container: HTMLElement): string[] {
    return [...container.querySelectorAll('[data-slot="groupHeadAggregate"]')].map((el) => el.textContent ?? "");
}

// ── German ──────────────────────────────────────────────────────────────────

describe("a Table cell prints itself in the viewer's language (#874)", () => {
    test("German: an undeclared number has every digit and a decimal comma; a declared format groups; a year and an id print as stored", () => {
        const { container } = renderIn("de-DE");
        expect(memberRows(container)).toEqual([
            ["North", "2026", "1234567", "1234,5", "1234,0", "1.234,5", eur("de-DE", 12.5), "true", "2026-06-29T22:30:00.000"],
            ["North", "2026", "1234568", "0,25", "2,0", "1.000", eur("de-DE", 7), "false", "2026-06-30T08:00:00.000"],
        ]);
    });

    test("German: a declared format formats its sum's group total; a count counts, in no column's format", () => {
        const { container } = renderIn("de-DE");
        expect(groupTotals(container)).toEqual(["2.234,5", "2"]);
    });

    test("English: every undeclared cell is East's own text, exactly as before", () => {
        const { container } = renderIn("en-US");
        const int = printFor(IntegerType);
        const float = printFor(FloatType);
        const date = printFor(DateTimeType);
        const bool = printFor(BooleanType);
        expect(memberRows(container)).toEqual(LINES.map((l) => [
            l.region, int(l.year), int(l.id), float(l.qty), float(l.whole),
            new Intl.NumberFormat("en-US").format(l.revenue), eur("en-US", l.fee), bool(l.shipped), date(l.at),
        ]));
        // The same text the factory's default printed: a whole float keeps its `.0`.
        expect(memberRows(container)[0]![4]).toBe("1234.0");
        expect(groupTotals(container)).toEqual(["2,234.5", "2"]);
    });
});
