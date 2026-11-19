/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Studio.Builder>` rendered (#1000), its toolbar on a row short of room
 * (#1229): its ladder, the ⋯ chip's bundle and menu, and Save as template hung
 * from the chip. The record and the builders are `builder.test-utils.tsx`'s.
 */

import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Record } from "@elaraai/e3-ui/internal";
import { act, settle } from "../e3-web-mount.test-utils.js";
import { before, mountBuilder, openPage, readRecord, commits, toolbarItems } from "./builder.test-utils.js";

describe("<Studio.Builder> — the toolbar on a row short of room (#1229)", () => {
    // jsdom lays nothing out: a toolbar row's box is `row.px`, an item's width is
    // its form's in FORM_PX (a hidden form has no box), and the gap is 10px. The
    // rows' ResizeObservers are captured, so a test moves the width as a browser does.
    const row = { px: 0 };
    /** Each item's width in each of its forms, widest first — none for a form that hides it. */
    const FORM_PX: Readonly<Record<string, ReadonlyArray<number | undefined>>> = {
        status: [57], grid: [110], readout: [62], zoom: [100, 45], rule: [1], history: [300, 136], widths: [150, 72],
        "save-template": [124], preview: [71], publish: [66], more: [undefined, 40],
    };
    const observers: { cb: ResizeObserverCallback; targets: Set<Element> }[] = [];
    class CapturingObserver {
        private readonly entry: { cb: ResizeObserverCallback; targets: Set<Element> };
        constructor(cb: ResizeObserverCallback) { this.entry = { cb, targets: new Set() }; observers.push(this.entry); }
        observe(el: Element) { this.entry.targets.add(el); }
        unobserve(el: Element) { this.entry.targets.delete(el); }
        disconnect() { this.entry.targets.clear(); }
    }
    const widthOf = (el: Element): number => {
        if (el.hasAttribute("data-toolbar")) return row.px;
        const key = el.getAttribute("data-toolbar-item");
        return key === null ? 0 : FORM_PX[key]?.[Number(el.getAttribute("data-toolbar-form"))] ?? 0;
    };
    const realRect = Element.prototype.getBoundingClientRect;
    const realObserver = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    beforeAll(() => {
        (globalThis as { ResizeObserver?: unknown }).ResizeObserver = CapturingObserver;
        Element.prototype.getBoundingClientRect = function (this: Element) {
            const width = widthOf(this);
            return { x: 0, y: 0, left: 0, top: 0, width, height: 30, right: width, bottom: 30, toJSON() { return {}; } } as DOMRect;
        };
    });
    beforeEach(() => {
        const computed = window.getComputedStyle.bind(window);
        vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pseudo?: string | null) => {
            const style = computed(el, pseudo);
            if (!el.hasAttribute("data-toolbar")) return style;
            return new Proxy(style, { get: (target, prop) => (prop === "columnGap" ? "10px" : Reflect.get(target, prop)) });
        });
    });
    afterEach(() => { vi.restoreAllMocks(); });
    afterAll(() => {
        Element.prototype.getBoundingClientRect = realRect;
        (globalThis as { ResizeObserver?: unknown }).ResizeObserver = realObserver;
    });

    /** Move the rows' width and deliver it as the browser does. */
    function resize(px: number) {
        row.px = px;
        act(() => {
            for (const o of observers) {
                const rowEl = [...o.targets].find((t) => t.hasAttribute("data-toolbar") && t.isConnected);
                if (rowEl !== undefined) o.cb([{ target: rowEl } as ResizeObserverEntry], {} as ResizeObserver);
            }
        });
    }
    /** The canvas's toolbar row. */
    const bar = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-frame-slot=toolbar] [data-toolbar]")!;
    /** Each item's form of its forms, as the toolbar says it folded them. */
    const stateOf = (c: HTMLElement) => new Map(bar(c).getAttribute("data-toolbar-state")!.split(";").map((part) => {
        const [key, of] = part.split("=");
        return [key!, Number(of!.split("/")[0])] as const;
    }));
    /** The row a configuration needs: every drawn form's width, and a 10px gap between drawn items. */
    function needs(forms: ReadonlyMap<string, number>): number {
        const widths = [...forms].flatMap(([key, form]) => {
            const px = FORM_PX[key]![form];
            return px === undefined ? [] : [px];
        });
        return widths.reduce((a, b) => a + b, 0) + 10 * Math.max(0, widths.length - 1);
    }
    /** The ladder, move by move — the View chip's bundle one move of two steps, the ⋯ chip's one of four. */
    const MOVES: ReadonlyArray<ReadonlyArray<readonly [string, number]>> = [
        [["grid", 1]], [["readout", 1]], [["widths", 1]], [["zoom", 1], ["widths", 2]],
        [["save-template", 1], ["preview", 1], ["publish", 1], ["more", 1]], [["status", 1]], [["history", 1]],
    ];
    /** The ⋯ chip, while the row draws it. */
    const chipOf = (c: HTMLElement) => bar(c).querySelector<HTMLElement>("[data-studio-more]");
    /** The View chip, while the row draws it. */
    const viewChipOf = (c: HTMLElement) => bar(c).querySelector<HTMLElement>("[data-snap-grid-view]");
    /** The menu a chip opens. */
    const menuOf = (chip: HTMLElement) => document.getElementById(chip.getAttribute("aria-controls")!)!;
    /** A chip's menu's items. */
    const menuItems = (chip: HTMLElement) => [...menuOf(chip).querySelectorAll<HTMLElement>("[role=menuitem], [role=menuitemradio]")];
    /** Opens a chip's menu. */
    async function openMenu(chip: HTMLElement) {
        await act(async () => { fireEvent.click(chip); });
        await waitFor(() => expect(chip.getAttribute("aria-expanded")).toBe("true"));
    }
    /** Picks an item of a chip's menu as a pointer does: pressed on it, then its click. */
    async function pick(chip: HTMLElement, words: string) {
        const found = menuItems(chip).find((el) => el.textContent === words);
        if (found === undefined) throw new Error(`no item “${words}”`);
        await act(async () => { fireEvent.pointerDown(found); });
        await act(async () => { fireEvent.click(found); });
        await settle();
    }
    /** Waits the frames in which a popover opened starts to hear Esc and a click outside: Zag defers that a frame. */
    const frames = () => act(async () => { await new Promise<void>((resolve) => { requestAnimationFrame(() => requestAnimationFrame(() => resolve())); }); });

    test("one ladder: the canvas's own steps — the zoom into the View chip as the widths hide, one move — then Save as template, Preview and Publish into the ⋯ chip, one move; the status, and the history item last", async () => {
        row.px = 4000;
        const { container } = await mountBuilder();
        expect(bar(container).getAttribute("data-toolbar-ladder"))
            .toBe("grid>1 readout>1 widths>1 zoom>1 widths>2 save-template>1 preview>1 publish>1 more>1 status>1 history>1");
        let forms = new Map([
            ["status", 0], ["grid", 0], ["readout", 0], ["zoom", 0], ["rule", 0], ["history", 0], ["widths", 0],
            ["save-template", 0], ["preview", 0], ["publish", 0], ["more", 0],
        ]);
        expect(stateOf(container)).toEqual(forms);
        // Each configuration holds in exactly the row it needs, and a pixel less takes the next move — and only that.
        for (const move of MOVES) {
            const room = needs(forms);
            resize(room);
            expect(stateOf(container), `${room}px`).toEqual(forms);
            forms = new Map(forms);
            for (const [key, form] of move) forms.set(key, form);
            resize(room - 1);
            expect(stateOf(container), `${room - 1}px, ${move.map(([k, f]) => `${k}→${f}`).join(" + ")}`).toEqual(forms);
        }
        // Folded all the way: the View chip, the rule, the history item's buttons and the ⋯ chip — Save as template's anchor.
        expect(toolbarItems(container)).toEqual(["zoom", "rule", "history", "more"]);
        expect([viewChipOf(container)!.getAttribute("aria-label"), chipOf(container)!.getAttribute("aria-label")]).toEqual(["View", "More"]);
        expect(chipOf(container)!.parentElement!.getAttribute("data-part")).toBe("anchor");
    });

    test("the ⋯ chip's menu holds Save as template…, Preview and Publish: Preview and Publish open the publish preview in the canvas's place; the View chip's widths draw the canvas at theirs", async () => {
        row.px = 1;
        const { container } = await mountBuilder();
        const canvas = () => container.querySelector<HTMLElement>("[data-studio-canvas]")!;
        for (const words of ["Preview", "Publish"]) {
            await openMenu(chipOf(container)!);
            expect(menuItems(chipOf(container)!).map((el) => el.textContent)).toEqual(["Save as template…", "Preview", "Publish"]);
            await pick(chipOf(container)!, words);
            expect([container.querySelector("[data-studio-publish]") !== null, canvas().hidden], words).toEqual([true, true]);
            await act(async () => { fireEvent.click(container.querySelector("[data-publish-exit]")!); });
            await settle();
            expect([container.querySelector("[data-studio-publish]"), canvas().hidden]).toEqual([null, false]);
        }
        await openMenu(viewChipOf(container)!);
        expect(menuItems(viewChipOf(container)!).map((el) => `${el.textContent}${el.getAttribute("aria-checked") === "true" ? " (checked)" : ""}`))
            .toEqual(["Zoom out", "Zoom in", "Desktop (checked)", "Tablet", "Mobile"]);
        await pick(viewChipOf(container)!, "Tablet");
        expect(container.querySelector<HTMLElement>("[data-snap-grid-canvas]")!.style.maxWidth).toBe("1024px");
    });

    test("the ⋯ chip's Save as template… opens its popover hung from the chip: it saves the open page, as last saved, in one commit, and the focus is back on the chip", async () => {
        row.px = 1;
        const { container } = await mountBuilder();
        await openMenu(chipOf(container)!);
        await pick(chipOf(container)!, "Save as template…");
        await frames();
        const popover = within(screen.getByRole("dialog"));
        // The popover hangs from the chip, whose menu has closed.
        expect([chipOf(container)!.parentElement!.getAttribute("data-part"), chipOf(container)!.getAttribute("aria-expanded")]).toEqual(["anchor", "false"]);
        expect(popover.getByText("Save as template ·").textContent).toBe("Save as template · Overview");
        expect((popover.getByRole("textbox", { name: "Template name" }) as HTMLInputElement).value).toBe("Overview template");
        await act(async () => { fireEvent.click(popover.getByRole("button", { name: "Save template" })); });
        await settle();
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(await commits()).toEqual(["patch", ...before]);
        const template = (await readRecord()).get({ project: "ops", page: "Overview template" })!;
        if (template.type !== "template") throw new Error("expected a template");
        expect(template.value.cells.map((c) => [c.key, c.span])).toEqual([["c-kpi", 12n], ["c-trend", 8n]]);
        await waitFor(() => expect(document.activeElement).toBe(chipOf(container)));
    });

    test("while a template is open, the ⋯ chip's Save as template… is disabled, and says why", async () => {
        row.px = 1;
        const { container } = await mountBuilder();
        await openPage("e-starter");
        await openMenu(chipOf(container)!);
        const saveAs = menuItems(chipOf(container)!)[0]!;
        expect([saveAs.textContent, saveAs.getAttribute("aria-disabled"), saveAs.title])
            .toEqual(["Save as template…", "true", "A template is open — open a page to save it as a template"]);
        await pick(chipOf(container)!, "Save as template…");
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    test("while Save as template's popover hangs from the ⋯ chip, the chip and the three it holds keep their forms as the row widens — the canvas's own items and the status unfold around it; closed, the row unfolds", async () => {
        row.px = 1;
        const { container } = await mountBuilder();
        await openMenu(chipOf(container)!);
        await pick(chipOf(container)!, "Save as template…");
        await frames();
        resize(4000);
        expect(stateOf(container)).toEqual(new Map([
            ["status", 0], ["grid", 0], ["readout", 0], ["zoom", 0], ["rule", 0], ["history", 0], ["widths", 0],
            ["save-template", 1], ["preview", 1], ["publish", 1], ["more", 1],
        ]));
        await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" })); });
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        await waitFor(() => expect(stateOf(container).get("more")).toBe(0));
        expect(["save-template", "preview", "publish"].map((key) => stateOf(container).get(key))).toEqual([0, 0, 0]);
        expect(await commits()).toEqual(before);
    });
});
