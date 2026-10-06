/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The review chrome as one item of a builder's toolbar (#1193): the batch
 * foot's summary and buttons at the row's end, folding to the buttons alone,
 * then into one menu, each at its rank; and no item where the foot would show
 * nothing. jsdom lays nothing out, so widths are stubbed from the form each
 * item shows: the summary and the buttons 300px, the buttons alone 200, the
 * menu 40; a peer item 300, or 100 once folded; the gap 10px.
 */

import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East } from "@elaraai/east";
import { Text, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { Toolbar, type ToolbarItem } from "../../toolbar/index.js";
import { reviewToolbarItem, type ReviewFootModel } from "./review.js";

afterEach(cleanup);

// jsdom lacks ResizeObserver; the toolbar observes its row and items through it.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }

/** The stubbed layout: the toolbar row's box. */
const row = { px: 0 };

function widthOf(el: Element): number {
    if (el.hasAttribute("data-toolbar")) return row.px;
    switch (el.getAttribute("data-toolbar-item")) {
        case "review":
            if (el.querySelector('[data-slot="reviewMenu"]') !== null) return 40;
            return el.querySelector('[data-review-form="buttons"]') !== null ? 200 : 300;
        case "peer": return el.querySelector('[data-peer="short"]') !== null ? 100 : 300;
        default: return 0;
    }
}

const originalRect = Element.prototype.getBoundingClientRect;
const originalRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
beforeAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
    Element.prototype.getBoundingClientRect = function (this: Element) {
        const width = widthOf(this);
        return { x: 0, y: 0, left: 0, top: 0, width, height: 30, right: width, bottom: 30, toJSON() { return {}; } } as DOMRect;
    };
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pseudo?: string | null) => {
        const style = computed(el, pseudo);
        if (!el.hasAttribute("data-toolbar")) return style;
        return new Proxy(style, { get: (target, prop) => (prop === "columnGap" ? "10px" : Reflect.get(target, prop)) });
    });
});
afterAll(() => {
    Element.prototype.getBoundingClientRect = originalRect;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalRO;
    vi.restoreAllMocks();
});

/** The host-composed summary: a UI component, as a surface's `review.summary` decodes to. */
const SUMMARY = East.compile(East.function([], UIComponentType, () => Text.Root("3 to review")), [])();

/** A surface's batch-review model, every verb recorded. */
function model(over: Partial<ReviewFootModel> = {}): ReviewFootModel & { calls: string[] } {
    const calls: string[] = [];
    return {
        showFoot: true, summary: SUMMARY, rerunLabel: "Re-plan",
        hasApproveAll: true, hasRejectAll: true, hasRerun: true,
        approveAll: () => calls.push("approve"), rejectAll: () => calls.push("reject"), rerun: () => calls.push("rerun"),
        calls,
        ...over,
    };
}

/** A collection's own item, which folds first. */
const PEER: ToolbarItem = { key: "peer", forms: [<span data-peer="long" />, <span data-peer="short" />], rank: 5 };

/** The review's two steps: the summary goes at 20, the buttons fold into the menu at 30. */
const RANK = { summary: 20, menu: 30 };

function mount(px: number, item: ToolbarItem | undefined) {
    row.px = px;
    return render(<ChakraProvider value={system}><Toolbar items={[PEER, item]} /></ChakraProvider>);
}

const buttons = (container: HTMLElement) =>
    [...container.querySelectorAll("button[data-review-batch]")].map((b) => `${b.getAttribute("data-review-batch")}:${b.textContent}`);

/** The open menu's items, as they read, and whether each is disabled. */
const menuItems = () => [...document.querySelectorAll('[role="menuitem"]')].map((item) =>
    `${item.getAttribute("data-review-batch")}:${item.textContent}${item.hasAttribute("data-disabled") ? " (disabled)" : ""}`);

/** Opens the menu from its trigger, once its items show. */
async function openMenu(trigger: HTMLElement) {
    await act(async () => { fireEvent.click(trigger); });
    await waitFor(() => expect(document.querySelectorAll('[role="menuitem"]').length).toBeGreaterThan(0));
}

/** Picks an item of the open menu as a pointer does — pressed on it, then its click — and waits for the menu to close. */
async function pick(trigger: HTMLElement, name: string) {
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent === name);
    if (item === undefined) throw new Error(`no menu item ${name}`);
    await act(async () => { fireEvent.pointerDown(item); });
    await act(async () => { fireEvent.click(item); });
    await waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("false"));
}

test("the item sits at the row's end — the summary, then Reject all, Rerun and Approve all — and folds to the buttons alone, then into its menu, each at its rank", () => {
    const review = model();
    const labels = { approveAll: "Approve every job", rejectAll: "Reject every job", menu: "Review the jobs" };
    // The whole row: 300 + 300 + 10.
    const whole = mount(610, reviewToolbarItem(review, { storageKey: "t", labels, rank: RANK }));
    const item = whole.container.querySelector('[data-toolbar-item="review"]')!;
    expect(item.hasAttribute("data-toolbar-end")).toBe(true);
    expect(item.querySelector('[data-slot="reviewSummary"]')?.textContent).toBe("3 to review");
    expect(buttons(whole.container)).toEqual(["reject:Reject every job", "rerun:Re-plan", "approve:Approve every job"]);
    fireEvent.click(item.querySelector('[data-review-batch="approve"]')!);
    fireEvent.click(item.querySelector('[data-review-batch="rerun"]')!);
    fireEvent.click(item.querySelector('[data-review-batch="reject"]')!);
    expect(review.calls).toEqual(["approve", "rerun", "reject"]);
    cleanup();
    // A pixel less: the peer folds first (rank 5), the review keeps its summary.
    const peerFolded = mount(609, reviewToolbarItem(review, { storageKey: "t", labels, rank: RANK }));
    expect(peerFolded.container.querySelector('[data-peer="short"]')).not.toBeNull();
    expect(peerFolded.container.querySelector('[data-slot="reviewSummary"]')).not.toBeNull();
    cleanup();
    // Past that (100 + 300 + 10 = 410): the buttons alone.
    const folded = mount(409, reviewToolbarItem(review, { storageKey: "t", labels, rank: RANK }));
    expect(folded.container.querySelector('[data-slot="reviewSummary"]')).toBeNull();
    expect(buttons(folded.container)).toEqual(["reject:Reject every job", "rerun:Re-plan", "approve:Approve every job"]);
    expect(folded.container.querySelector('[data-slot="reviewMenu"]')).toBeNull();
    cleanup();
    // Past those (100 + 200 + 10 = 310): one menu, named in the host's words.
    const menu = mount(309, reviewToolbarItem(review, { storageKey: "t", labels, rank: RANK }));
    expect(buttons(menu.container)).toEqual([]);
    expect(menu.container.querySelector('[data-slot="reviewMenu"]')?.getAttribute("aria-label")).toBe("Review the jobs");
});

test("the menu holds the verbs: each does what its button does", async () => {
    const review = model();
    const view = mount(160, reviewToolbarItem(review, { storageKey: "t", rank: RANK }));
    const trigger = view.container.querySelector<HTMLElement>('[data-slot="reviewMenu"]')!;
    // In English by default.
    expect(trigger.getAttribute("aria-label")).toBe("Review");
    for (const [name, call] of [["Reject all", "reject"], ["Re-plan", "rerun"], ["Approve all", "approve"]] as const) {
        await openMenu(trigger);
        expect(menuItems()).toEqual(["reject:Reject all", "rerun:Re-plan", "approve:Approve all"]);
        await pick(trigger, name);
        expect(review.calls.at(-1)).toBe(call);
    }
    expect(review.calls).toEqual(["reject", "rerun", "approve"]);
});

test("Approve all and Reject all are disabled while the surface's verdicts cannot be drafted, as buttons and in the menu; Rerun stays live", async () => {
    const { container } = mount(610, reviewToolbarItem(model({ batchDisabled: true }), { storageKey: "t" }));
    expect(container.querySelector<HTMLButtonElement>('[data-review-batch="approve"]')!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-review-batch="reject"]')!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-review-batch="rerun"]')!.disabled).toBe(false);
    cleanup();
    const review = model({ batchDisabled: true });
    const menu = mount(160, reviewToolbarItem(review, { storageKey: "t", rank: RANK }));
    const trigger = menu.container.querySelector<HTMLElement>('[data-slot="reviewMenu"]')!;
    await openMenu(trigger);
    expect(menuItems()).toEqual(["reject:Reject all (disabled)", "rerun:Re-plan", "approve:Approve all (disabled)"]);
    // A disabled item takes no pick: nothing is called, and the menu stays open.
    const approve = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent === "Approve all")!;
    await act(async () => { fireEvent.pointerDown(approve); });
    await act(async () => { fireEvent.click(approve); });
    expect(review.calls).toEqual([]);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
});

test("a foot with nothing to show is no item; a summary alone never folds; buttons alone fold into the menu at its rank", () => {
    expect(reviewToolbarItem(model({ showFoot: false }), { storageKey: "t" })).toBeUndefined();
    const summaryOnly = reviewToolbarItem(model({ hasApproveAll: false, hasRejectAll: false, hasRerun: false }), { storageKey: "t" })!;
    expect(summaryOnly.forms).toHaveLength(1);
    expect(summaryOnly.side).toBe("end");
    const buttonsOnly = reviewToolbarItem(model({ summary: undefined }), { storageKey: "t", rank: RANK })!;
    expect(buttonsOnly.forms).toHaveLength(2);
    expect(buttonsOnly.rank).toBe(30);
    const whole = mount(510, buttonsOnly);
    expect(whole.container.querySelector('[data-slot="reviewSummary"]')).toBeNull();
    expect(buttons(whole.container)).toEqual(["reject:Reject all", "rerun:Re-plan", "approve:Approve all"]);
    cleanup();
    // Past the buttons (100 + 200 + 10 = 310): the menu.
    const menu = mount(309, buttonsOnly);
    expect(menu.container.querySelector('[data-slot="reviewMenu"]')).not.toBeNull();
    // The steps' ranks, the summary's then the menu's — the default for each when not given.
    expect(reviewToolbarItem(model(), { storageKey: "t", rank: RANK })!.rank).toEqual([20, 30]);
    expect(reviewToolbarItem(model(), { storageKey: "t" })!.rank).toEqual([100, 100]);
});
