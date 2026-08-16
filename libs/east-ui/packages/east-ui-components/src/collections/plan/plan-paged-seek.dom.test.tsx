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
 * hand-written `{ id, page, total, seek }` literal — `plan.dom.test.tsx` fakes
 * the source, `use-plan-paging.dom.test.tsx` fakes it again for the driver, and
 * `paged-source.spec.ts` exercises `Paged.of` with no renderer in sight. Each
 * half is covered and nothing proves they compose. Here the value under test is
 * built by the east-ui factory from a real `Paged.of` and COMPILED, so the
 * closures the driver calls are the ones East emits.
 *
 * The second is direction. Every paged renderer test streams forward from
 * window 0; none starts, or lands, anywhere else. But the reason a canvas pages
 * at all is that it can show the middle of a source without walking to it —
 * `usePlanSeek` → `jumpToElement` → a residency REBASE (#577), reached through
 * the toolbar key search (#574), which is the only random-access affordance a
 * user actually has. So the test types into that search and asserts the canvas
 * moved: the far window landed, the near one was released, the ~60 windows in
 * between were never requested, and the skipped span is described by a band
 * rather than by rows.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import {
    ArrayType, DateTimeType, DictType, East, FloatType, StringType, StructType,
    none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Paged } from "@elaraai/east-ui";
import { Plan, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { buildSliceHandle } from "../../platform/slice/index.js";
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
 * Give the canvas slice chrome.
 *
 * Not because random access needs a slice — it does not. The key search is a
 * capability of the SOURCE (`seek`), and `usePlanSeek` builds it unconditionally
 * — but the control mounts inside `PlanToolbar`, and the toolbar itself is gated
 * on `value.slice` (`index.tsx:693`, `chrome !== undefined`). So a paged canvas
 * with a keyed source, a working `seek` and no slice has no way to reach its own
 * search. That is a defect, reported separately; it is worked around here so the
 * random-access path can be exercised at all. When the gate is fixed this helper
 * should be deleted, not kept.
 */
function withChrome(root: PlanRootValue): PlanRootValue {
    const handle = buildSliceHandle(
        "plan.paged.seek",
        { fields: new Map(), rangeFieldId: none, searchFieldIds: [], breakdownFieldIds: [] } as never,
        {
            range: none, compare: none, filters: [], cohorts: [],
            activeCohorts: new Set<string>(), breakdown: none, search: none,
            visible: none, selectedIndex: none, resolution: none,
        } as never,
        [] as never,
        none,
    );
    return { ...root, slice: some({ slice: handle, affordances: [] }) as PlanRootValue["slice"] };
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
        const { root, asked } = withRecordedWindows(buildPagedPlan());
        const { container } = renderPlan(withChrome(root), "plan-jump");
        await waitFor(() => {
            expect(container.querySelector('[data-plan-row="u0000"]')).toBeTruthy();
        });
        const beforeJump = new Set(asked);

        // Drive the SHIPPED affordance: type the key, wait out the 250 ms
        // debounce for the seek to land, then commit with Enter.
        const input = container.querySelector('[data-part="dataset-key-search"] input')! as HTMLElement;
        await userEvent.type(input, TARGET_KEY);
        await waitFor(() => {
            expect(container.querySelector('[data-part="dataset-key-search"]')!.textContent)
                .toMatch(/match/);
        }, { timeout: 5_000 });
        fireEvent.keyDown(input, { key: "Enter" });

        // The canvas MOVED: the target window landed...
        await waitFor(() => {
            expect(container.querySelector(`[data-plan-row="${TARGET_KEY}"]`)).toBeTruthy();
        }, { timeout: 10_000 });
        // ...and the head it left behind is described by a band, not by rows.
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
    }, 30_000);
});
