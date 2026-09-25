/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The canvas over its controller (#815), counted: a selection renders the two
 * rows it moved and never the canvas; a paged window landing is ONE commit
 * that renders only the rows it added; a value that removes the selected or
 * focused row commits once, already reconciled — no flash frame; an element's
 * open surface goes with the element; and a canvas StrictMode remounts keeps
 * listening to its source.
 *
 * Renders are counted with the rows' and the root's own probes — which
 * component ran is asserted deterministically — and commits with a React
 * Profiler.
 */

import { Profiler, StrictMode, type ReactNode } from "react";
import { describe, test, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { none, some, variant } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { registerReactiveTracker, type ReactiveTracker } from "../../reactive/tracker.js";
import { EastChakraPlan, setPlanRootRenderProbe, type PlanRootValue } from "./index.js";
import type { PlanWireRow } from "./model.js";
import { setBodyRowRenderProbe } from "./rows/BodyRow.js";
import { PLAN_PAGE_SIZE } from "./use-plan-paging.js";
import { rowId, rowIdEqual, rowSel, testKeyOf } from "./plan.test-utils.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const cleanups: (() => void)[] = [];
afterEach(() => {
    cleanup();
    while (cleanups.length > 0) cleanups.pop()!();
    setBodyRowRenderProbe(undefined);
    setPlanRootRenderProbe(undefined);
    localStorage.clear();
});

const W27 = new Date("2026-06-29T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");

const span = () => variant("span", { runs: [], decisions: [], ports: [], rollup: none, unit: none });

/** One WIRE row, as the source serves it — named by its test key (#822). */
function planRow(key: string, kind: unknown = span()): PlanWireRow {
    return {
        id: rowId(key),
        parent: none,
        gutter: { label: key, id: none, sub: none, value: none, meta: none, stacked: none, swatches: [] },
        kind,
        collapsed: none, pinned: none, height: none, status: none, approval: none, expand: none,
    } as unknown as PlanWireRow;
}
/** A stream without one row. */
const without = (rows: PlanWireRow[], key: string) => rows.filter((r) => !rowIdEqual(r.id, rowId(key)));

function planRoot(rows: PlanWireRow[], opts: { source?: unknown; links?: unknown[]; popover?: unknown } = {}): PlanRootValue {
    return {
        rows: opts.source !== undefined ? variant("paged", opts.source) : variant("inline", rows),
        links: opts.links ?? [],
        axis: variant("time", {
            window: some({ min: W27, max: W39 }), resolution: variant("week", null),
            resolutions: [], now: none, format: none,
        }),
        grain: none, popover: opts.popover !== undefined ? some(opts.popover) : none,
        hover: none, expandRender: none, expandGutter: none, review: none, pick: none,
        slice: none, footer: [], id: "", sources: [], onDrag: none, canDrop: none,
        onSelect: none, onRunClick: none, onEventClick: none, onMarkClick: none, onChipClick: none, onCellClick: none,
        onGroupToggle: none, onGrainChange: none, style: none,
    } as unknown as PlanRootValue;
}

/** The canvas inside a Profiler that records every commit's phase. */
function tree(value: PlanRootValue, key: string, commits: string[], wrap: (n: ReactNode) => ReactNode = (n) => n): ReactNode {
    return wrap(
        <ChakraProvider value={system}>
            <Profiler id="plan" onRender={(_id, phase) => { commits.push(phase); }}>
                <EastChakraPlan value={value} storageKey={key} />
            </Profiler>
        </ChakraProvider>,
    );
}

/** A tracker with explicit channels and a paged source whose windows after
 *  window 0 stay IN FLIGHT until `open` — each window's read registers its
 *  channel, and `fire` lands what is open. */
function heldSource(windows: number, rowsPer: number) {
    const subs = new Map<string, Set<() => void>>();
    let recording: string[] | null = null;
    const tracker: ReactiveTracker = {
        id: "plan-815-channels",
        enableTracking() { recording = []; },
        disableTracking() { const r = recording ?? []; recording = null; return r; },
        getStore: () => ({
            subscribe(key, cb) {
                const set = subs.get(key) ?? new Set<() => void>();
                set.add(cb);
                subs.set(key, set);
                return () => { set.delete(cb); };
            },
            getKeyVersion: () => 0,
        }),
    };
    const state = { openUpTo: 0 };
    const source = {
        id: "plan-815-held",
        page: (offset: bigint) => {
            const w = Number(offset) / PLAN_PAGE_SIZE;
            recording?.push(`w${w}`);
            if (w > state.openUpTo) return none;
            return some(Array.from({ length: rowsPer }, (_u, i) => planRow(`w${w}r${String(i).padStart(2, "0")}`)));
        },
        total: () => some(BigInt(windows * PLAN_PAGE_SIZE)),
        seek: none,
        revision: () => none,
        refresh: () => null,
    };
    const fire = (key: string) => { for (const cb of [...(subs.get(key) ?? [])]) cb(); };
    cleanups.push(registerReactiveTracker(tracker));
    return { source, state, fire };
}

describe("the canvas over its controller (#815)", () => {
    test("a selection renders the two rows it moved — and never the canvas", () => {
        initializeStore(new UIStore());
        const rows: string[] = [];
        let roots = 0;
        const commits: string[] = [];
        const { container } = render(tree(planRoot(["m1", "m2", "m3", "m4"].map((k) => planRow(k))), "plan-815-select", commits));
        setBodyRowRenderProbe((key) => rows.push(testKeyOf(key)));
        setPlanRootRenderProbe(() => { roots += 1; });

        fireEvent.click(container.querySelector(rowSel("m2"))!);
        expect(rows).toEqual(["m2"]);
        rows.length = 0;
        fireEvent.click(container.querySelector(rowSel("m3"))!);
        expect([...rows].sort()).toEqual(["m2", "m3"]);
        // The root rendered for neither click: selection is not in its view.
        expect(roots).toBe(0);
        expect(container.querySelector(rowSel("m3"))!.hasAttribute("data-selected")).toBe(true);
    });

    test("a paged window landing is ONE commit that renders only the rows it added", async () => {
        initializeStore(new UIStore());
        // Sixteen rows a window: window 0 fills the jsdom viewport, so the
        // demand rests on its ring [0, 2] and nothing past it is asked for.
        const held = heldSource(5, 16);
        const commits: string[] = [];
        const { container } = render(tree(planRoot([], { source: held.source }), "plan-815-landing", commits));
        await waitFor(() => expect(container.querySelector(rowSel("w0r15"))).toBeTruthy());
        expect(container.querySelector(rowSel("w1r00"))).toBeNull();

        const rows: string[] = [];
        setBodyRowRenderProbe((key) => rows.push(testKeyOf(key)));
        commits.length = 0;
        // Windows 1 and 2 land together — one channel firing, one settle.
        act(() => {
            held.state.openUpTo = 2;
            held.fire("w1");
        });
        expect(container.querySelector(rowSel("w2r15"))).toBeTruthy();
        expect(commits).toEqual(["update"]);
        // Every row that rendered is one that arrived; window 0's rows kept
        // their memo — their facts did not move.
        expect(rows.length).toBe(32);
        expect(rows.every((k) => k.startsWith("w1") || k.startsWith("w2"))).toBe(true);
    });

    test("a value without the selected row commits ONCE — the selection gone, and gone for good", () => {
        initializeStore(new UIStore());
        const commits: string[] = [];
        const all = ["r1", "r2", "r3", "r4"].map((k) => planRow(k));
        const { container, rerender } = render(tree(planRoot(all), "plan-815-vanish", commits));
        fireEvent.click(container.querySelector(rowSel("r2"))!);
        expect(container.querySelector("[data-selected]")).toBeTruthy();

        commits.length = 0;
        rerender(tree(planRoot(without(all, "r2")), "plan-815-vanish", commits));
        // The reconcile is a view of the render, not an effect after it.
        expect(commits).toEqual(["update"]);
        expect(container.querySelector("[data-selected]")).toBeNull();
        // The row returning is a new row — its old selection does not.
        rerender(tree(planRoot(all), "plan-815-vanish", commits));
        expect(container.querySelector(rowSel("r2"))!.hasAttribute("data-selected")).toBe(false);
    });

    test("a value without the FOCUSED row commits once with no focus — no frame of rails around a row that is gone", () => {
        initializeStore(new UIStore());
        const all = ["r1", "r2", "r3", "r4"].map((k) => planRow(k));
        const links = [{ fromRow: rowId("r2"), fromRun: "x", toRow: rowId("r3"), toRun: "y", quantity: 1, label: "L" }];
        // What EVERY commit put on screen — read as the commit lands.
        const frames: { rails: number; bar: boolean }[] = [];
        let container: HTMLElement | undefined;
        const frame = (n: ReactNode) => (
            <Profiler id="frames" onRender={() => {
                if (container === undefined) return;
                frames.push({
                    rails: container.querySelectorAll("[data-plan-rail]").length,
                    bar: container.querySelector("[data-plan-focusbar]") !== null,
                });
            }}>{n}</Profiler>
        );
        const commits: string[] = [];
        const view = render(tree(planRoot(all, { links }), "plan-815-focus", commits, frame));
        container = view.container;
        fireEvent.click(container.querySelector(`${rowSel("r2")} [data-plan-control="links"]`)!);
        expect(container.querySelector("[data-plan-focusbar]")).toBeTruthy();
        expect(container.querySelectorAll("[data-plan-rail]").length).toBeGreaterThan(0);

        commits.length = 0;
        frames.length = 0;
        view.rerender(tree(planRoot(without(all, "r2"), { links }), "plan-815-focus", commits, frame));
        expect(commits).toEqual(["update"]);
        expect(frames).toEqual([{ rails: 0, bar: false }]);
    });

    test("an element's open popover goes with its element — it does not come back when the element mounts again", async () => {
        initializeStore(new UIStore());
        const bar = variant("span", {
            runs: [{
                key: "b214", start: variant("time", W27), end: variant("time", new Date("2026-07-27T00:00:00Z")),
                label: "B-214", quantity: none, qty: none, state: variant("actual", null),
                status: none, moved: none, icon: none,
            }],
            decisions: [], ports: [], rollup: none, unit: none,
        });
        const popover = () => some(variant("Text", { value: "RUN DETAIL · B-214", style: none }));
        const all = [planRow("m1", bar), planRow("m2")];
        const commits: string[] = [];
        const { container, rerender } = render(tree(planRoot(all, { popover }), "plan-815-overlay", commits));
        await userEvent.setup().click(container.querySelector('[data-run="b214"]')!);
        expect(await screen.findByText("RUN DETAIL · B-214")).toBeTruthy();
        // The row goes — its bar, and the popover the bar opened, with it.
        rerender(tree(planRoot(all.slice(1), { popover }), "plan-815-overlay", commits));
        await waitFor(() => expect(screen.queryByText("RUN DETAIL · B-214")).toBeNull());
        // The row comes back: its bar mounts CLOSED. An open surface belongs to
        // its element; the canvas does not keep it for one that has gone.
        rerender(tree(planRoot(all, { popover }), "plan-815-overlay", commits));
        await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
        expect(container.querySelector('[data-run="b214"]')).toBeTruthy();
        expect(screen.queryByText("RUN DETAIL · B-214")).toBeNull();
    });

    test("under StrictMode a paged canvas keeps listening — its rehearsed unmount does not deafen it", async () => {
        initializeStore(new UIStore());
        const held = heldSource(5, 16);
        const commits: string[] = [];
        const { container } = render(tree(planRoot([], { source: held.source }), "plan-815-strict", commits,
            (n) => <StrictMode>{n}</StrictMode>));
        await waitFor(() => expect(container.querySelector(rowSel("w0r00"))).toBeTruthy());
        act(() => {
            held.state.openUpTo = 2;
            held.fire("w1");
        });
        expect(container.querySelector(rowSel("w2r15"))).toBeTruthy();
    });
});
