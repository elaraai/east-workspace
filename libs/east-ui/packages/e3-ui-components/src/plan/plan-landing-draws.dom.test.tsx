/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * A far jump's landing draws only what it moves (#1398, CL9), on e3 itself:
 * End over the work orders Plan (`planRecordIndexes`) past the rows read. The
 * window at the record's far end lands, the operations' cells of its rows after
 * it, and the frame is drawn again at each — the canvas's every commit draws
 * it. Drawn again, it works out none of its recipe's styles again: the library
 * reads the plan recipe's, made once for the theme. What is counted is each
 * slot recipe's styles worked out, by the recipe.
 *
 * jsdom lays nothing out: the canvas's bounded frame is 400px tall over a tall
 * scroll extent, its `scrollTo` moving `scrollTop` as a browser's does.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { system } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-records";
import * as sheet from "@elaraai/e3-ui/examples/sheet/sheet-records";
import { act, el, planHarness, settle, slot } from "./frame/harness.test-utils.js";

const h = planHarness({ "plan/plan-records": ex, "sheet/sheet-records": sheet });

// Layout stand-ins: a 400px bounded frame over a tall scroll extent, its `scrollTo` moving `scrollTop` as a browser's does.
const VIEWPORT = 400;
const frameHeight = (node: Element): number | undefined => (node.getAttribute("data-virtual-rows") === "bounded" ? VIEWPORT : undefined);
const saved = {
    offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!,
    clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")!,
    scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight")!,
    scrollTo: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo"),
};

beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get(this: HTMLElement) { return frameHeight(this) ?? 0; } });
    Object.defineProperty(Element.prototype, "clientHeight", { configurable: true, get(this: Element) { return frameHeight(this) ?? 0; } });
    Object.defineProperty(Element.prototype, "scrollHeight", { configurable: true, get(this: Element) { return frameHeight(this) !== undefined ? 10_000_000 : 0; } });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
        configurable: true, writable: true,
        value(this: HTMLElement, arg: ScrollToOptions | number) {
            this.scrollTop = typeof arg === "number" ? arg : (arg.top ?? this.scrollTop);
            this.dispatchEvent(new Event("scroll"));
        },
    });
});
afterEach(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", saved.offsetHeight);
    Object.defineProperty(Element.prototype, "clientHeight", saved.clientHeight);
    Object.defineProperty(Element.prototype, "scrollHeight", saved.scrollHeight);
    if (saved.scrollTo !== undefined) Object.defineProperty(HTMLElement.prototype, "scrollTo", saved.scrollTo);
    vi.restoreAllMocks();
});

/** JOB-10000's operation's bar: drawn once the canvas has read its first cells. */
const FIRST_BAR = el("data-run", "operation", "JOB-10000-run");

/** The rows the canvas draws, by their keys. */
const rowsOf = (c: HTMLElement) => [...slot(c, "main")!.querySelectorAll("[data-plan-row]")].map((row) => row.getAttribute("data-plan-row"));

/** Every slot recipe's styles worked out from here on, by the recipe's class name: each call of a recipe `sva` made. */
function slotStylesWorked(): string[] {
    const worked: string[] = [];
    const sva = system.sva.bind(system);
    vi.spyOn(system, "sva").mockImplementation((config) => {
        const styles = sva(config);
        return Object.assign((props?: Parameters<typeof styles>[0]) => {
            worked.push(String(config.className));
            return styles(props);
        }, styles);
    });
    return worked;
}

/**
 * The work orders Plan mounted with its first rows' cells drawn, the keyboard on its first row; then End, past the rows
 * read, the far window and its rows' cells landed.
 *
 * @param before - Starts counting, just before End
 */
async function farEnd(before: () => void) {
    const ui = await h.mount(ex.planRecordIndexes);
    const c = ui.container;
    await waitFor(() => expect(c.querySelector(FIRST_BAR)).not.toBeNull());
    await settle();
    const first = rowsOf(c);
    const row = slot(c, "main")!.querySelector<HTMLElement>("[data-plan-item^='r:']")!;
    await act(async () => { row.focus(); });
    await settle();
    before();
    await act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key: "End" }); });
    await settle();
    // The far end's rows drawn in place of the first, their operations' cells read.
    await waitFor(() => expect(rowsOf(c).some((key) => !first.includes(key))).toBe(true));
    await settle();
}

describe("End over the work orders Plan: the landing draws only what it moves", () => {
    test("the frame, drawn again as the far window and its cells land, works out none of the plan recipe's styles again: the library reads them made once for the theme", async () => {
        // Watched from before the mount — the frame's parts make their recipes as they mount — and counted from End on.
        const worked = slotStylesWorked();
        await farEnd(() => { worked.length = 0; });
        expect(worked.filter((name) => name === "elara-plan")).toEqual([]);
    });
});
