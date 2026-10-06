/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * One formatter (#850), rendered — the Sheet's own counts: under
 * `I18nProvider locale="de-DE"` the transport line, an unloaded band, a lens
 * gap, the view tabs, a grouped sheet's summary and a band's line count print
 * German numbers. The grouped sheet is `<Sheet>`, COMPILED, and renders
 * through its carrier in its frame (#1216), so the renderer reads what an
 * author's program produces. The other families' counts are
 * east-ui-components' `format.dom.test.tsx`.
 */

import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { ChakraProvider } from "@chakra-ui/react";
import { I18nProvider } from "@react-aria/i18n";
import { ArrayType, East, StringType, StructType, type ValueTypeOf } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Sheet } from "@elaraai/e3-ui/internal";
import { EastChakraComponent, UIStore, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { SheetFooter } from "./Footer.js";
import { SheetBandRow, SheetGapRow } from "./Rows.js";
import { SheetTabs } from "./Tabs.js";
import { boundFrame } from "./frame.test-utils.js";
// The renderer registers against its carrier as it loads.
import "./frame/index.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

let restoreFrame: () => void = () => {};
beforeEach(() => { initializeStore(new UIStore()); restoreFrame = boundFrame(2000); });
afterEach(() => { cleanup(); restoreFrame(); });

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
            <SheetTabs styles={styles} views={[{ id: "v", name: "SPRAY", count: 1234, title: "" }]} wholeCount={5000}
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
            // Folded, so the body is the band alone — the summary still counts every line.
            return Sheet({
                data, columns: { task: Sheet.column.text(TaskType, { header: "Task" }) },
                id: "id",
                group: Sheet.group(PlanType, "lines", { title: "name", folded: (_p) => true, noun: { singular: "plan", plural: "plans" } }),
            });
        })), "fmt-sheet");
        expect(container.querySelector('[data-slot="footerSummary"]')?.textContent).toBe("1 plan · 1.234 lines");
        expect(container.querySelector('[data-slot="groupCount"]')?.textContent).toBe("1.234");
    });
});
