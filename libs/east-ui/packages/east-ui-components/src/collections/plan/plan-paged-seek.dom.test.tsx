/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * RANDOM ACCESS through the shipped affordance, over a REAL source.
 *
 * Two gaps met here that no other test covers.
 *
 * The first is composition. Every paged test elsewhere hands the renderer a
 * hand-written `{ id, page, total, seek }` literal — `plan-paged.dom.test.tsx`
 * fakes the source, `controller/paging.test.ts` fakes it again for the driver,
 * and `paged-source.spec.ts` exercises `Paged.of` with no renderer in sight. Each
 * half is covered and nothing proves they compose. Here the value under test is
 * built by the east-ui factory from a real `Paged.of` and COMPILED, so the
 * closures the driver calls are the ones East emits.
 *
 * The second is direction. Every paged renderer test streams forward from
 * window 0; none starts, or lands, anywhere else. But the reason a canvas pages
 * at all is that it can show the middle of a source without walking to it —
 * the controller's `search.jump` → the driver's `jumpToElement` → a residency
 * REBASE (#577), reached through the toolbar key search (#574), which is the
 * only random-access affordance a user actually has. So the test types into
 * that search and asserts the canvas moved: the far window landed, the near one
 * was released, the ~60 windows in between were never requested, and the
 * skipped span is described by a band rather than by rows.
 *
 * The canvas has no height, and 600 rows land in its opening ring, so it
 * virtualizes against the WINDOW (#812): a jump scrolls the page to its row.
 * jsdom cannot scroll, so the jump test stands in for the window's scrolling.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import {
    ArrayType, DateTimeType, DictType, East, FloatType, StringType, StructType,
    variant, type ValueTypeOf,
} from "@elaraai/east";
import { Paged } from "@elaraai/east-ui";
import { Plan, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { EastChakraPlan, type PlanRootValue } from "./index.js";
import { PLAN_PAGE_SIZE } from "./use-plan-paging.js";

afterEach(cleanup);

// jsdom lacks ResizeObserver — the combobox positioner needs one.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const W27 = new Date("2026-06-29T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");
const NOW = new Date("2026-08-12T00:00:00Z");

/** Elements, deliberately far more than any residency retains. */
const ELEMENTS = 4_000;                        // 20 windows at PLAN_PAGE_SIZE
/** The element the search seeks to — deep enough that reaching it by walking
 *  would be unmistakable in the recorded offsets. */
const TARGET = 3_000;
const TARGET_KEY = `u${String(TARGET).padStart(4, "0")}`;

/** The source, generated at MODULE scope: East bodies never call host helpers
 *  (east 990020). Fixed-width keys, so canonical String order is index order —
 *  which is what makes "element N" and "key uN" the same place. */
const UNITS = new Map(Array.from({ length: ELEMENTS }, (_, i) => [
    `u${String(i).padStart(4, "0")}`,
    { start: W27, end: W39, tonnes: (i % 50) + 0.5 },
] as const));

/** Build the canvas the way an author does — `Paged.of` handed to the factory,
 *  then compiled — and unwrap the `Plan` arm the renderer takes. */
function buildPagedPlan(): PlanRootValue {
    const program = East.function([], UIComponentType, ($) => {
        const UnitRow = StructType({ start: DateTimeType, end: DateTimeType, tonnes: FloatType });
        const units = $.const(UNITS, DictType(StringType, UnitRow));
        const source = $.const(Paged.of("units", units));
        const series = $.const([
            Plan.series.span(UnitRow, {
                key: "units", title: "Units",
                label: (_r, k) => k, id: true,
                runs: (r, k) => [Plan.run({
                    key: "run", start: r.start, end: r.end,
                    label: East.str`RUN · ${k}`,
                    qty: r.tonnes, state: "actual",
                })],
            }),
        ], ArrayType(Plan.Types.Series(UnitRow)));
        const axis = $.const(Plan.axis({
            window: { min: W27, max: W39 }, resolution: "week", now: NOW,
        }));
        return Plan.Root({ axis, data: source, series });
    });
    const value = East.compile(program, getRegisteredPlatformImplementations())() as
        ValueTypeOf<typeof UIComponentType> & { value: PlanRootValue };
    return value.value;
}

/** Wrap the compiled source so every window request is recorded, delegating to
 *  the real closure — the behaviour stays East's, only the calls are observed. */
function withRecordedWindows(root: PlanRootValue): { root: PlanRootValue; asked: number[] } {
    const asked: number[] = [];
    const paged = (root.rows as { type: string; value: Record<string, unknown> }).value;
    const realPage = paged["page"] as (offset: bigint, limit: bigint) => unknown;
    const spied = {
        ...paged,
        page: (offset: bigint, limit: bigint) => {
            asked.push(Number(offset) / PLAN_PAGE_SIZE);
            return realPage(offset, limit);
        },
    };
    return { root: { ...root, rows: variant("paged", spied) as PlanRootValue["rows"] }, asked };
}

/**
 * What the unbounded canvas reads from the page it scrolls in (#812), for a
 * jsdom that lays nothing out: the canvas sits at the top of a tall document,
 * `window.scrollTo` moves `scrollY` and fires `scroll`, and the rows' top
 * moves with it. Returns the restore.
 */
function emulateWindowScroll(): () => void {
    let y = 0;
    const html = document.documentElement;
    const saved = {
        scrollY: Object.getOwnPropertyDescriptor(window, "scrollY"),
        scrollTo: Object.getOwnPropertyDescriptor(window, "scrollTo"),
        rect: Element.prototype.getBoundingClientRect,
    };
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => y });
    Object.defineProperty(window, "scrollTo", {
        configurable: true,
        writable: true,
        value: (arg: ScrollToOptions | number) => {
            y = Math.max(0, typeof arg === "number" ? arg : (arg.top ?? y));
            window.dispatchEvent(new Event("scroll"));
        },
    });
    // A document tall enough to scroll through the canvas (jsdom reports 0).
    Object.defineProperty(html, "scrollHeight", { configurable: true, get: () => 100_000_000 });
    Element.prototype.getBoundingClientRect = function (this: Element) {
        if (this.hasAttribute("data-virtual-extent")) {
            return { x: 0, y: -y, top: -y, left: 0, right: 1024, bottom: -y, width: 1024, height: 0, toJSON: () => ({}) } as DOMRect;
        }
        return saved.rect.call(this);
    };
    return () => {
        if (saved.scrollY !== undefined) Object.defineProperty(window, "scrollY", saved.scrollY);
        if (saved.scrollTo !== undefined) Object.defineProperty(window, "scrollTo", saved.scrollTo);
        delete (html as { scrollHeight?: number }).scrollHeight;
        Element.prototype.getBoundingClientRect = saved.rect;
    };
}

function renderPlan(value: PlanRootValue, key: string) {
    initializeStore(new UIStore());
    return render(
        <ChakraProvider value={system}>
            <EastChakraPlan value={value} storageKey={key} />
        </ChakraProvider>,
    );
}

describe("Plan paged random access (#567/#574/#577)", () => {
    test("a REAL Paged.of source drives the canvas — the seam the fakes never cross", async () => {
        const { root, asked } = withRecordedWindows(buildPagedPlan());
        const { container } = renderPlan(root, "plan-seam");

        // The compiled `page` answered, and its rows reached the canvas.
        await waitFor(() => {
            expect(container.querySelector('[data-plan-row="u0000"]')).toBeTruthy();
        });
        // The compiled `total` taught the transport the exact element count.
        await waitFor(() => {
            const line = container.querySelector('[data-slot="footerTransport"]');
            expect(line?.textContent).toMatch(/of 4,000$/);
        });
        // It walked a bounded ring, not the whole source.
        expect(Math.max(...asked)).toBeLessThan(5);
        // The compiled source carries a real `seek` — a keyed collection derives
        // one from its own keys — which is what the jump test then drives.
        const paged = (root.rows as { value: { seek: { type: string } } }).value;
        expect(paged.seek.type).toBe("some");
    }, 30_000);

    test("seeking element 3,000 REBASES — the windows in between are never fetched", async () => {
        const restore = emulateWindowScroll();
        try {
            const { root, asked } = withRecordedWindows(buildPagedPlan());
            const { container } = renderPlan(root, "plan-jump");
            await waitFor(() => {
                expect(container.querySelector('[data-plan-row="u0000"]')).toBeTruthy();
            });
            const beforeJump = new Set(asked);

            // Drive the SHIPPED affordance: type the key, wait out the 250 ms
            // debounce for the seek to land, then commit with Enter.
            // The search mounts because the SOURCE declares `seek` — this canvas
            // binds no slice at all (#587).
            const input = container.querySelector('[data-part="dataset-key-search"] input')! as HTMLElement;
            await userEvent.type(input, TARGET_KEY);
            await waitFor(() => {
                expect(container.querySelector('[data-part="dataset-key-search"]')!.textContent)
                    .toMatch(/match/);
            }, { timeout: 5_000 });
            fireEvent.keyDown(input, { key: "Enter" });

            // The canvas MOVED: the target window landed, and the page
            // scrolled to its row...
            await waitFor(() => {
                expect(container.querySelector(`[data-plan-row="${TARGET_KEY}"]`)).toBeTruthy();
            }, { timeout: 10_000 });
            expect(window.scrollY).toBeGreaterThan(0);
            // ...and the head it left behind is described by a band, not by
            // rows: scrolled back to the top, the band is what is there.
            act(() => { window.scrollTo({ top: 0 }); });
            const head = container.querySelector('[data-plan-window-band="head"]');
            expect(head).toBeTruthy();
            expect(Number(head!.getAttribute("data-plan-elements"))).toBeGreaterThan(2_000);
            expect(container.querySelector('[data-plan-row="u0000"]')).toBeNull();

            // The point of paging: it jumped, it did not walk. Everything between
            // the opening ring and the target ring stayed unread.
            const target = Math.floor(TARGET / PLAN_PAGE_SIZE);
            const newly = asked.filter((w) => !beforeJump.has(w));
            expect(newly.length).toBeGreaterThan(0);
            for (const w of newly) expect(w).toBeGreaterThanOrEqual(target - 2);
            expect(asked).not.toContain(8);
            expect(asked).not.toContain(10);
        } finally {
            restore();
        }
    }, 30_000);

    test("the bar appears for the SOURCE's sake — and only when there is a reason", async () => {
        // #587's other half. Mounting the toolbar for a seek-capable source
        // must not mount it for everything: an inline canvas binds no slice and
        // declares no seek, so it still gets no bar rather than an empty band.
        const { root } = withRecordedWindows(buildPagedPlan());
        const { container: paged } = renderPlan(root, "plan-bar-paged");
        await waitFor(() => {
            expect(paged.querySelector('[data-slot="toolbar"]')).toBeTruthy();
        });
        expect(paged.querySelector('[data-part="dataset-key-search"]')).toBeTruthy();
        cleanup();

        const inline: PlanRootValue = { ...root, rows: variant("inline", new Map()) as PlanRootValue["rows"] };
        const { container: plain } = renderPlan(inline, "plan-bar-inline");
        expect(plain.querySelector('[data-slot="toolbar"]')).toBeNull();
    }, 30_000);
});
