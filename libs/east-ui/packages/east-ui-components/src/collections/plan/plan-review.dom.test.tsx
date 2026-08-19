/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Plan's review chrome (#569) — actions only.
 *
 * The property under test is not "buttons render". It is that the canvas keeps
 * NO verdict of its own: clicking Approve reports a row KEY and changes
 * nothing on screen; what a decided row looks like comes back through the
 * DATA, exactly like every other pixel here. A renderer-local copy would pass
 * a "does the tick appear" test and still be wrong — it would keep claiming a
 * verdict after the write that triggered it had failed and rolled back.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { EastChakraPlan, type PlanRootValue, type PlanRowValue } from "./index.js";

afterEach(cleanup);

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const W27 = new Date("2026-06-29T00:00:00Z");
const W31 = new Date("2026-08-03T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");

/** One span row, with the verdict its DATA carries. */
function row(key: string, opts?: { approval?: "approved" | "pending" | "rejected"; state?: string; parent?: string }): PlanRowValue {
    return {
        key,
        parent: opts?.parent !== undefined ? some(opts.parent) : none,
        gutter: { label: key, id: none, sub: none, value: none, meta: none, stacked: none, swatches: [] },
        kind: variant("span", {
            runs: [{
                key: "r1", start: W27, end: W31, label: key.toUpperCase(),
                quantity: none, qty: none,
                state: variant(opts?.state ?? "proposed", opts?.state === undefined ? variant("recommended", null) : null),
                status: none, moved: none, icon: none,
            }],
            decisions: [], ports: [], rollup: none, unit: none,
        }),
        pinned: none, height: none, status: none,
        approval: opts?.approval !== undefined ? some(variant(opts.approval, null)) : none,
        expand: none,
    } as unknown as PlanRowValue;
}

/** A DECLARED-collapsed group band. */
function groupRow(key: string): PlanRowValue {
    return {
        key,
        parent: none,
        gutter: { label: key, id: none, sub: none, value: none, meta: none, stacked: none, swatches: [] },
        kind: variant("group", { summary: none, summaryAggregate: none, collapsed: some(true) }),
        pinned: none, height: none, status: none, approval: none, expand: none,
    } as unknown as PlanRowValue;
}

function planRoot(rows: PlanRowValue[], review: unknown): PlanRootValue {
    return {
        rows: variant("inline", new Map(rows.map((r) => [r.key, r]))),
        links: [],
        axis: {
            window: some({ min: W27, max: W39 }), resolution: variant("week", null),
            resolutions: [], now: some(W31), format: none,
        },
        grain: none, popover: none, hover: none,
        expandRender: none,
        review: review === undefined ? none : some(review),
        slice: none, footer: [],
        id: "", sources: [], onDrag: none, canDrop: none,
        onSelect: none,
        onRunClick: none, onEventClick: none, onMarkClick: none, onChipClick: none,
        onCellClick: none, onGroupToggle: none, onGrainChange: none,
        style: none,
    } as unknown as PlanRootValue;
}

/** A review config with the verbs the test wires. */
function reviewCfg(opts: { onApprove?: (r: { key: string }) => void; onReject?: (r: { key: string }) => void; onApproveAll?: () => void }) {
    return {
        columnLabel: "Decision",
        summary: none,
        onApprove: opts.onApprove !== undefined ? some(opts.onApprove) : none,
        onReject: opts.onReject !== undefined ? some(opts.onReject) : none,
        onApproveAll: opts.onApproveAll !== undefined ? some(opts.onApproveAll) : none,
        onRejectAll: none,
        onRerun: none,
        rerunLabel: "Rerun",
    };
}

function renderPlan(value: PlanRootValue) {
    initializeStore(new UIStore());
    return render(
        <ChakraProvider value={system}>
            <EastChakraPlan value={value} storageKey="plan-review" />
        </ChakraProvider>,
    );
}

describe("Plan review chrome (#569)", () => {
    test("mounts from `value.review` and reports the row KEY, never an index", async () => {
        const onApprove = vi.fn();
        const onReject = vi.fn();
        const { container } = renderPlan(planRoot(
            [row("m1"), row("m2")], reviewCfg({ onApprove, onReject })));

        expect(container.querySelector('[data-slot="decisionHeader"]')!.textContent).toBe("Decision");
        expect(container.querySelectorAll('[data-slot="decisionCell"]')).toHaveLength(2);

        fireEvent.click(container.querySelector('[data-plan-approve="m2"]')!);
        await waitFor(() => expect(onApprove).toHaveBeenCalled());
        // The subject is the row's KEY. An index would survive this assertion
        // only by coincidence, and would reattach to the wrong row the moment
        // a paged window landed above it (#577).
        expect(onApprove).toHaveBeenCalledWith({ key: "m2" });

        fireEvent.click(container.querySelector('[data-plan-reject="m1"]')!);
        await waitFor(() => expect(onReject).toHaveBeenCalledWith({ key: "m1" }));
    });

    test("no chrome without `review` — the column and foot simply are not there", () => {
        const { container } = renderPlan(planRoot([row("m1")], undefined));
        expect(container.querySelector('[data-slot="decisionHeader"]')).toBeNull();
        expect(container.querySelector('[data-slot="decisionCell"]')).toBeNull();
        expect(container.querySelector('[data-slot="reviewFoot"]')).toBeNull();
    });

    test("the canvas holds NO verdict — clicking changes nothing until the DATA does", async () => {
        // A callback that records the click but writes nowhere: exactly the
        // case a renderer-local copy would paper over.
        const onApprove = vi.fn();
        const { container, rerender } = renderPlan(planRoot([row("m1")], reviewCfg({ onApprove })));

        const pressed = () => container.querySelector('[data-plan-approve="m1"]')!.getAttribute("aria-pressed");
        const verdict = () => container.querySelector('[data-slot="decisionCell"]')!.getAttribute("data-verdict");
        expect(pressed()).toBe("false");
        expect(verdict()).toBe("pending");

        fireEvent.click(container.querySelector('[data-plan-approve="m1"]')!);
        await waitFor(() => expect(onApprove).toHaveBeenCalled());
        // Nothing recorded the verdict, so nothing claims one.
        expect(pressed()).toBe("false");
        expect(verdict()).toBe("pending");

        // The author's write lands and comes back through the data — NOW it shows.
        rerender(
            <ChakraProvider value={system}>
                <EastChakraPlan value={planRoot([row("m1", { approval: "approved" })], reviewCfg({ onApprove }))}
                    storageKey="plan-review" />
            </ChakraProvider>,
        );
        await waitFor(() => expect(pressed()).toBe("true"));
        expect(verdict()).toBe("approved");
    });

    test("an Approve write-back repaints the verdict and NOTHING else — the opened group and the selection survive (#610)", async () => {
        const onApprove = vi.fn();
        const v = (approval?: "approved") => planRoot(
            [groupRow("g1"), row("m1", { parent: "g1" }),
                row("m2", approval !== undefined ? { approval } : undefined)],
            reviewCfg({ onApprove }));
        const { container, rerender } = renderPlan(v());

        // The user opens the declared-collapsed group and selects the member.
        expect(container.querySelector('[data-plan-row="m1"]')).toBeNull();
        fireEvent.click(container.querySelector('[data-plan-group="g1"]')!);
        expect(container.querySelector('[data-plan-row="m1"]')).toBeTruthy();
        fireEvent.click(container.querySelector('[data-plan-row="m1"]')!);
        expect(container.querySelector('[data-plan-row="m1"]')!.hasAttribute("data-selected")).toBe(true);

        // Approve m2; the author's write lands and comes back through the data.
        fireEvent.click(container.querySelector('[data-plan-approve="m2"]')!);
        await waitFor(() => expect(onApprove).toHaveBeenCalledWith({ key: "m2" }));
        rerender(
            <ChakraProvider value={system}>
                <EastChakraPlan value={v("approved")} storageKey="plan-review" />
            </ChakraProvider>,
        );
        await waitFor(() => expect(
            container.querySelector('[data-slot="decisionCell"][data-verdict="approved"]')).toBeTruthy());
        // The verdict is ALL that changed: the group is still open, the
        // selection held — a data commit reconciles, it does not reset.
        expect(container.querySelector('[data-plan-row="m1"]')).toBeTruthy();
        expect(container.querySelector('[data-plan-row="m1"]')!.hasAttribute("data-selected")).toBe(true);
    });

    test("appearance is DERIVED — the same write can repaint the bar, not just the button", async () => {
        // The point of keeping the verdict in data: a decision diamond is one
        // presentation of it, and so is a bar colour. The author's accessors
        // decide; the chrome has no opinion.
        const { container, rerender } = renderPlan(planRoot(
            [row("m1", { approval: "pending" })], reviewCfg({ onApprove: vi.fn() })));
        expect(container.querySelector("[data-run]")!.getAttribute("data-state")).toBe("prop");

        rerender(
            <ChakraProvider value={system}>
                <EastChakraPlan
                    value={planRoot([row("m1", { approval: "approved", state: "confirmed" })],
                        reviewCfg({ onApprove: vi.fn() }))}
                    storageKey="plan-review" />
            </ChakraProvider>,
        );
        await waitFor(() => {
            expect(container.querySelector("[data-run]")!.getAttribute("data-state")).toBe("appr");
        });
        expect(container.querySelector('[data-slot="decisionCell"]')!.getAttribute("data-verdict")).toBe("approved");
    });

    test("the batch foot mounts its wired verbs only", async () => {
        const onApproveAll = vi.fn();
        const { container } = renderPlan(planRoot([row("m1")], reviewCfg({ onApproveAll })));
        const foot = container.querySelector('[data-slot="reviewFoot"]');
        expect(foot).toBeTruthy();
        expect(foot!.textContent).toContain("Approve all");
        expect(foot!.textContent).not.toContain("Reject all");   // not wired
        expect(foot!.textContent).not.toContain("Rerun");        // not wired
        fireEvent.click([...foot!.querySelectorAll("button")].find((b) => b.textContent === "Approve all")!);
        await waitFor(() => expect(onApproveAll).toHaveBeenCalled());
    });
});
