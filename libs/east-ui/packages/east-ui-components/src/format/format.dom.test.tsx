/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * One formatter (#850), rendered: under `I18nProvider locale="de-DE"` every
 * component family prints German numbers and dates — Numeric and Stat, the
 * Table's cells and pager, a Chart's axes, a Deck's metrics, the Slice
 * summary, and the Sheet's own counts. Every value is built by the east-ui
 * factory and COMPILED, so the renderer reads what an author's program
 * produces. The date-bearing families run under timezones either side of UTC
 * and print the UTC day in each.
 */

import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { ChakraProvider } from "@chakra-ui/react";
import { I18nProvider } from "@react-aria/i18n";
import {
    ArrayType, DateTimeType, East, FloatType, IntegerType, NullType, StringType, StructType, type ValueTypeOf,
} from "@elaraai/east";
import { Chart, Deck, Format, Numeric, Sheet, Stat, Table, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../theme/index.js";
import { initializeStore } from "../platform/state-runtime.js";
import { UIStore } from "../platform/state-store.js";
import { getRegisteredPlatformImplementations } from "../platform/registry.js";
import { EastChakraComponent } from "../component.js";
import { EastChakraSliceSummary, type SliceSummaryValue } from "../slice/summary/index.js";
import { SheetFooter } from "../collections/sheet/Footer.js";
import { SheetBandRow, SheetGapRow } from "../collections/sheet/Rows.js";
import { SheetTabs } from "../collections/sheet/Tabs.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

beforeEach(() => { initializeStore(new UIStore()); });
afterEach(cleanup);

type UIValue = ValueTypeOf<typeof UIComponentType>;

/** Compile an author's program — the value the renderer receives. */
const compile = (fn: ReturnType<typeof East.function>): UIValue =>
    East.compile(fn as never, getRegisteredPlatformImplementations())() as UIValue;

/** Render under a locale (German by default). */
function german(node: ReactNode, locale = "de-DE") {
    return render(<ChakraProvider value={system}><I18nProvider locale={locale}>{node}</I18nProvider></ChakraProvider>);
}
const component = (value: UIValue, key: string, locale?: string) => german(<EastChakraComponent value={value} storageKey={key} />, locale);

/** Every text node that says something, trimmed. */
function texts(root: Element): string[] {
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
        const s = (n.textContent ?? "").trim();
        if (s !== "") out.push(s);
    }
    return out;
}

/** Timezones either side of UTC; a renderer reading local time would move the day in one of them. */
const TIMEZONES = ["UTC", "Pacific/Kiritimati", "America/Los_Angeles"];

// ── Fixtures, at module scope ───────────────────────────────────────────────

/** 1,234 rows — the pager counts them. */
const OrderType = StructType({ name: StringType, qty: FloatType });
const ORDERS = Array.from({ length: 1234 }, (_, i) => ({ name: `Order ${i}`, qty: 1234.5 + i }));

/** Three days' sales, each recorded late in the UTC day (east of UTC, the next day). */
const SaleType = StructType({ at: DateTimeType, sales: FloatType });
const SALES = [
    { at: new Date(Date.UTC(2026, 5, 29, 22, 30)), sales: 1200 },
    { at: new Date(Date.UTC(2026, 5, 30, 22, 30)), sales: 1800 },
    { at: new Date(Date.UTC(2026, 6, 1, 22, 30)), sales: 900 },
];

const LineType = StructType({ id: StringType, name: StringType, rate: FloatType });
const LINES = [{ id: "a", name: "Line A", rate: 1234567 }];

// ── Numbers: Numeric and Stat ───────────────────────────────────────────────

describe("numbers (#850)", () => {
    test("Numeric prints its declared currency in German", () => {
        const { container } = component(compile(East.function([], UIComponentType, (_$) =>
            Numeric.Root(1234.5, { format: Format.Currency({ currency: "EUR" }) }))), "fmt-numeric");
        expect(container.textContent).toBe("1.234,50\u00a0€");
    });

    test("Stat prints its declared compact value in German", () => {
        const { container } = component(compile(East.function([], UIComponentType, (_$) =>
            Stat.Root({ label: "Output", value: 1234567, format: Format.Compact() }))), "fmt-stat");
        expect(texts(container)).toContain("1,2\u00a0Mio.");
    });
});

// ── The Table ───────────────────────────────────────────────────────────────

describe("the Table (#850)", () => {
    // Its cells print in the viewer's language too: table-cells.dom.test.tsx (#874).
    test("the pager's counts are German", () => {
        const { container } = component(compile(East.function([], UIComponentType, ($) => {
            const orders = $.const(ORDERS, ArrayType(OrderType));
            const onPageChange = $.const(East.function([IntegerType], NullType, (_$2, _page) => {}));
            return Table.Root(orders, { name: { header: "Name" }, qty: { header: "Qty" } }, {
                pagination: { pageSize: 20n, page: 0n, onPageChange },
            });
        })), "fmt-table");
        expect(container.textContent).toContain("Page 1 of 62 (1.234 total)");
    });
});

// ── Charts ──────────────────────────────────────────────────────────────────

describe.each(TIMEZONES)("a Chart's axes — TZ=%s (#850)", (tz) => {
    beforeEach(() => { vi.stubEnv("TZ", tz); });
    afterEach(() => { vi.unstubAllEnvs(); });

    test("a declared currency axis is German; an undeclared time axis prints each UTC day", () => {
        const { container } = component(compile(East.function([], UIComponentType, ($) => {
            const sales = $.const(SALES, ArrayType(SaleType));
            return Chart.Root([Chart.Line(sales, { x: (r) => r.at, y: (r) => r.sales })], {
                width: 640,
                y: { format: Chart.format.currency({ code: "EUR" }), tickValues: [0, 1000, 2000] },
            });
        })), `fmt-chart-${tz}`);
        const words = texts(container);
        expect(words).toEqual(expect.arrayContaining(["0,00\u00a0€", "1.000,00\u00a0€", "2.000,00\u00a0€"]));
        expect(words).toEqual(expect.arrayContaining(["29.6.2026", "30.6.2026", "1.7.2026"]));
    });
});

// ── Deck ────────────────────────────────────────────────────────────────────

describe("a Deck (#850)", () => {
    test("a metric's declared format is German", () => {
        const { container } = component(compile(East.function([], UIComponentType, ($) => {
            const lines = $.const(LINES, ArrayType(LineType));
            return Deck.Root(lines, {
                card: (r) => ({ key: r.id, title: r.name, metrics: [Deck.metric("Rate", r.rate, { format: Chart.format.compact() })] }),
            });
        })), "fmt-deck");
        expect(texts(container)).toContain("1,2\u00a0Mio.");
    });
});

// ── The Slice ───────────────────────────────────────────────────────────────

describe("the Slice (#850)", () => {
    test("the summary's counts are German", () => {
        const slice = { key: "", activeCount: () => 0n, resultCount: () => 1284n, totalCount: () => 50000n, clearFilters: () => null };
        const { container } = german(<EastChakraSliceSummary value={{ slice } as unknown as SliceSummaryValue} />);
        const words = texts(container);
        expect(words).toContain("1.284");
        expect(words).toContain("of 50.000");
    });
});

// ── The Sheet's own counts ──────────────────────────────────────────────────

describe("the Sheet's counts (#850)", () => {
    const styles = {} as Record<string, Record<string, unknown>>;

    test("the transport line, an unloaded band and a lens gap", () => {
        const { container } = german(
            <>
                <SheetFooter styles={styles} items={[]} hint="" message="" transport={{ loaded: 600, total: 5000, loading: false }} />
                <SheetBandRow styles={styles} band={{ at: "tail", from: 600, to: 4999, px: 100 }} loading={false} colCount={2} />
                <SheetGapRow styles={styles} gap={{ key: "g", from: 10, to: 1509, hidden: 1500, first: false, last: false }}
                    reach={{ top: 1, bottom: 3, both: 10 }} onReveal={() => {}} colCount={2} />
            </>,
        );
        const words = texts(container);
        expect(words).toContain("600 loaded of 5.000");
        expect(words).toContain("4.400 not loaded");
        expect(words).toContain("1.500 hidden");
    });

    test("the view tabs' counts", () => {
        const { container } = german(
            <SheetTabs styles={styles} views={[{ id: "v", name: "PAINT", count: 1234, title: "" }]} wholeCount={5000}
                active={null} dirty={false} hasQuery={false} renaming={null} renameVal=""
                onSwitch={() => {}} onCreate={() => {}} onClose={() => {}} onRenameStart={() => {}}
                onRenameChange={() => {}} onRenameCommit={() => {}} onRenameCancel={() => {}} onReorder={() => {}} />,
        );
        const words = texts(container);
        expect(words).toContain("5.000");
        expect(words).toContain("1.234");
    });

    test("a grouped sheet's summary and a band's line count", () => {
        const TaskType = StructType({ task: StringType });
        const PlanType = StructType({ id: StringType, name: StringType, lines: ArrayType(TaskType) });
        const plans = [{ id: "p1", name: "Week 8", lines: Array.from({ length: 1234 }, (_, i) => ({ task: `Task ${i}` })) }];
        const { container } = component(compile(East.function([], UIComponentType, ($) => {
            const data = $.const(plans, ArrayType(PlanType));
            // Folded, so the unbounded body is the band alone — the summary still counts every line.
            return Sheet.Root(data, { task: Sheet.column.text(TaskType, { header: "Task" }) }, {
                id: "id",
                group: Sheet.group(PlanType, "lines", { title: "name", folded: (_p) => true, noun: { singular: "plan", plural: "plans" } }),
            });
        })), "fmt-sheet");
        expect(container.querySelector('[data-slot="footerSummary"]')?.textContent).toBe("1 plan · 1.234 lines");
        expect(container.querySelector('[data-slot="groupCount"]')?.textContent).toBe("1.234");
    });
});

// ── English is unchanged ────────────────────────────────────────────────────

describe("with no provider's locale, English (#850)", () => {
    test("Numeric and the Slice summary print as they always have", () => {
        const numeric = component(compile(East.function([], UIComponentType, (_$) =>
            Numeric.Root(1234.5, { format: Format.Currency({ currency: "EUR" }) }))), "fmt-numeric-en", "en-US");
        expect(numeric.container.textContent).toBe("€1,234.50");
        cleanup();
        const slice = { key: "", activeCount: () => 0n, resultCount: () => 1284n, totalCount: () => 50000n, clearFilters: () => null };
        const { container } = german(<EastChakraSliceSummary value={{ slice } as unknown as SliceSummaryValue} />, "en-US");
        expect(texts(container)).toEqual(expect.arrayContaining(["1,284", "of 50,000"]));
    });
});
