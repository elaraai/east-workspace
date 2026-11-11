/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Flowchart as an app meets it, on the e3 the page runs (#1251, #1506,
 * `Flowchart Builder Spec.md` §3, §9.10, FB39–FB41), over the records its
 * examples bind:
 *
 * - **the pane combinations** — none (`flowchartDepotTopDown`), an inspector
 *   (`flowchartDepotEditing`) and both (`flowchartDepot`): the frame holds the
 *   panes it is given and no other, main the room they leave — pinned open
 *   beside main at the desktop width, tabs of the pane strip on a phone — in
 *   both themes;
 * - **the depot's records saved** (FB39, `flowchartDepot`): a step's card
 *   dropped on a lane, a transition's card on a transition and a state dragged
 *   across lanes, then Save — each record through its patch door, the drafts
 *   retiring as the records read them back, no banner — and the flowchart,
 *   mounted again over the records, draws what Save committed; its cards draw
 *   their details, so its lanes reach past main, and the canvas is scrolled to
 *   bring each drop's target to main's middle first, as the viewer's scrollbar
 *   brings it there, under a dragged state too; and a state carried by its
 *   key's letters (`flowchartDepotEditing`) lands however often it is carried,
 *   no carry selecting any text;
 * - **the host's props** (`flowchartDepotTopDown`): the host hears a state, a
 *   transition and a decision selected and a path ⌥-clicked; the minimap is
 *   drawn over the canvas, inside main, framed as the recipe frames it, and
 *   keeps main's corner while the canvas scrolls under it; the legend is left
 *   out; and read only, no gesture's control and no history item is drawn,
 *   though a click still selects;
 * - **top down** (`flowchartDepotTopDown`): opened TD, its lanes stacked, each
 *   state in its own.
 *
 * Every measurement is polled until it holds, on a page at rest; nothing
 * reads a screenshot.
 *
 * Locally: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test responsive/flowchart-builder`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { frameAt } from "./builder-frame";
import { settled } from "./settle";
import { CARRY_WINDOW, boxOf, boxesOf, captionOf, cardOf, carryTo, centreInMain, dragState, laneOf, middleOf, midLine, openFlowchart, openTab, paneOpen, pickUp, remount, sizeTo } from "./flowchart-page";

/** The inspector's open width (`Flowchart Builder Spec.md` §8). */
const INSPECTOR = 320;
/** The library's open width (§8). */
const LIBRARY = 272;
/** Each pane combination, and the example that has it. */
const COMBINATIONS = [
    { name: "flowchartDepotTopDown", library: false, inspector: false },
    { name: "flowchartDepotEditing", library: false, inspector: true },
    { name: "flowchartDepot", library: true, inspector: true },
] as const;

/** A frame wide enough to pin both panes beside main's 480px. */
const WIDE = 1200;

/** The history item's Save, by its name — the chevron of its choice of an automatic Save stands after it: in the toolbar's row or, in a phone's frame, its second row. */
const saveOf = (root: Locator): Locator => root.locator("[data-slot='history']").getByRole("button", { name: "Save", exact: true });

/**
 * Where each region's box meets the next: main's start against the library's
 * end, or the body's start; main's end against the inspector's start, or the
 * body's end — each gap to a tenth of a pixel.
 */
async function panesOf(root: Locator) {
    const frame = await frameAt(root);
    const round = (n: number) => Math.round(n * 10) / 10;
    const mainEnd = frame.main.x + frame.main.w;
    return {
        start: frame.start === null ? null : { mode: frame.start.mode, collapsed: frame.start.collapsed, width: frame.start.slot.w },
        end: frame.end === null ? null : { mode: frame.end.mode, collapsed: frame.end.collapsed, width: frame.end.slot.w },
        // Main runs from the library's end — or the body's start — to the inspector's start — or the body's end.
        before: round(frame.main.x - (frame.start === null ? frame.body.x : frame.start.slot.x + frame.start.slot.w)),
        after: round((frame.end === null ? frame.body.x + frame.body.w : frame.end.slot.x) - mainEnd),
    };
}

test.describe("Every pane combination (#1251, FB40)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured at the desktop width; the phone's below");

    for (const theme of ["light", "dark"] as const) {
        test(`with room, each pane it is given pinned open — the library 272px, the inspector 320px — and none it is not; main the room between (${theme})`, async ({ page }) => {
            for (const { name, library, inspector } of COMBINATIONS) {
                const { root } = await openFlowchart(page, name, theme);
                await root.evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, WIDE);
                await settled(page);
                await expect.poll(() => panesOf(root), name).toEqual({
                    start: library ? { mode: "pinned", collapsed: false, width: LIBRARY } : null,
                    end: inspector ? { mode: "pinned", collapsed: false, width: INSPECTOR } : null,
                    before: 0,
                    after: 0,
                });
            }
        });
    }
});

test.describe("Every pane combination on a phone (#1251, FB40)", () => {
    test.skip(({ isMobile }) => !isMobile, "the phone projects");

    for (const theme of ["light", "dark"] as const) {
        test(`each pane it is given a tab of the pane strip, and none it is not; main the frame's whole width (${theme})`, async ({ page }) => {
            for (const { name, library, inspector } of COMBINATIONS) {
                const { root } = await openFlowchart(page, name, theme);
                await expect(root.locator("[data-pane-tab='start']"), name).toHaveCount(library ? 1 : 0);
                await expect(root.locator("[data-pane-tab='end']"), name).toHaveCount(inspector ? 1 : 0);
                const wide = () => root.evaluate((el) => {
                    const frame = el.querySelector("[data-builder-frame]") ?? el;
                    return Math.round(frame.getBoundingClientRect().width - frame.querySelector("[data-frame-slot='main']")!.getBoundingClientRect().width);
                });
                await expect.poll(wide, name).toBe(0);
            }
        });
    }
});

/** A transition's own line, as it is drawn: its dashes and its stroke. */
function lineOf(root: Locator, key: string): Promise<[string | null, string]> {
    return root.evaluate((el, k) => {
        const line = el.querySelector(`[data-flowchart-link="${k}"]`)!.previousElementSibling!;
        return [line.getAttribute("stroke-dasharray"), getComputedStyle(line).stroke] as [string | null, string];
    }, key);
}

/** A token's colour as the page resolves it. */
function inkOf(page: Page, token: string): Promise<string> {
    return page.evaluate((t) => {
        const probe = document.createElement("div");
        probe.style.color = `var(--chakra-colors-${t})`;
        document.body.appendChild(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
    }, token);
}

test.describe("The depot's records on the e3 the page runs (#1251, #1503, FB39)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "carried by the mouse at the desktop width");
    test.beforeEach(async ({ page }) => { await page.setViewportSize(CARRY_WINDOW); });

    test("a step and a transition dropped, a state moved across lanes, and Save: each record through its patch door — and the flowchart, mounted again over the records, draws what Save committed", async ({ page }) => {
        const { root } = await openFlowchart(page, "flowchartDepot");
        // Too narrow to pin the library: it opens over main, and slides off it while a card is carried.
        await sizeTo(page, root, 700);
        await paneOpen(page, root, "overlay");
        const pending = root.locator("[data-flowchart-pending]");
        await expect(pending).toHaveText(" · 0 pending");

        // A step: the exception desk, onto the Sort lane under the chutes — a new state, selected. The canvas is
        // scrolled across till the lane stands in main's middle.
        await openTab(page, root, "Steps");
        await centreInMain(page, root, middleOf(await boxOf(root.locator("[data-flowchart-band='sort']"))));
        await pickUp(page, cardOf(root, "desk"));
        const [chutes, sort] = await boxesOf(root, ["[data-flowchart-node='CH*']", "[data-flowchart-band='sort']"]);
        await carryTo(page, root, { x: sort!.x + sort!.width / 2, y: chutes!.y + chutes!.height + 20 });
        await expect.poll(() => captionOf(page)).toEqual({ text: "after CH* in Sort", refused: false });
        await page.mouse.up();
        const added = root.locator("[data-flowchart-node][data-selected='true']");
        await expect(added).toHaveAttribute("data-flowchart-node", /^state-\d+$/);
        const desk = (await added.getAttribute("data-flowchart-node"))!;
        await expect(pending).toHaveText(" · 1 pending");

        // A transition: the chutes' to Sorted, retyped observed — its line, round the desk now standing between them,
        // scrolled across and down to main's middle.
        await paneOpen(page, root, "overlay");
        await openTab(page, root, "Transitions");
        await centreInMain(page, root, await midLine(root, "l5"), true);
        await pickUp(page, cardOf(root, "reroute"));
        await carryTo(page, root, () => midLine(root, "l5"));
        await expect.poll(() => captionOf(page)).toEqual({ text: "onto CH* → SRD", refused: false });
        await page.mouse.up();
        await expect(pending).toHaveText(" · 2 pending");

        // The library on its rail, the canvas whole: the loaded state dragged into the Sort lane.
        await root.getByRole("button", { name: "Collapse Library" }).click();
        await settled(page);
        expect(await laneOf(root, "LDD")).toBe("dispatch");
        // Into the Sort band, at the card's height, in the part of the band main shows — the band two lanes off: the
        // canvas scrolled across under the carried card till it stands in main's middle, then read.
        await dragState(page, root, "LDD", async () => {
            await centreInMain(page, root, middleOf(await boxOf(root.locator("[data-flowchart-band='sort']"))));
            const [loaded, sortBand, main] = await boxesOf(root, ["[data-flowchart-node='LDD']", "[data-flowchart-band='sort']", "[data-frame-slot='main']"]);
            const left = Math.max(sortBand!.x, main!.x), right = Math.min(sortBand!.x + sortBand!.width, main!.x + main!.width);
            return { x: (left + right) / 2, y: loaded!.y + loaded!.height / 2 };
        });
        await expect.poll(() => laneOf(root, "LDD")).toBe("sort");
        await expect(pending).toHaveText(" · 3 pending");

        // Save: each record through its patch mutation, the drafts retiring as the records read them back.
        const save = saveOf(root);
        await expect(save).toBeEnabled();
        await save.click();
        await expect(pending).toHaveText(" · 0 pending");
        await expect(save).toBeDisabled();
        await expect(root.locator("[role='alert']")).toHaveCount(0);

        // Mounted again over the records: the desk and the loaded state in Sort, the chutes' transition observed.
        const again = await remount(page, "flowchartDepot");
        await expect(again.locator("[data-flowchart-pending]")).toHaveText(" · 0 pending");
        await expect.poll(async () => [await laneOf(again, desk), await laneOf(again, "LDD")]).toEqual(["sort", "sort"]);
        expect(await lineOf(again, "l5")).toEqual(["5 4", await inkOf(page, "status-info")]);
        await expect(saveOf(again)).toBeDisabled();
    });

    test("a state carried by its key's letters lands however often it is carried — into another lane, back, and again after an Undo — and no carry selects any text", async ({ page }) => {
        const { root } = await openFlowchart(page, "flowchartDepotEditing");
        await sizeTo(page, root, 900);
        const pending = root.locator("[data-flowchart-pending]");
        // What the page has selected: a drag over the canvas is a gesture, never a selection of its words, which the
        // next drag begun on them would carry as the browser's own drag, the state never landing.
        const selected = () => page.evaluate(() => getSelection()?.toString() ?? "");
        // Into a lane, at the card's height, in the part of its band main shows: the canvas scrolled across under the
        // carried card till the lane stands in main's middle, then read.
        const into = (key: string, lane: string) => async () => {
            await centreInMain(page, root, middleOf(await boxOf(root.locator(`[data-flowchart-band='${lane}']`))));
            const [card, band, main] = await boxesOf(root, [`[data-flowchart-node='${key}']`, `[data-flowchart-band='${lane}']`, "[data-frame-slot='main']"]);
            const left = Math.max(band!.x, main!.x), right = Math.min(band!.x + band!.width, main!.x + main!.width);
            return { x: (left + right) / 2, y: card!.y + card!.height / 2 };
        };
        expect(await laneOf(root, "SRD")).toBe("sort");
        await dragState(page, root, "SRD", into("SRD", "hold"), "key");
        await expect.poll(() => laneOf(root, "SRD")).toBe("hold");
        await expect(pending).toHaveText(" · 1 pending");
        expect(await selected(), "the carry selects nothing").toBe("");
        // Carried back by its key's letters: it lands.
        await dragState(page, root, "SRD", into("SRD", "sort"), "key");
        await expect.poll(() => laneOf(root, "SRD")).toBe("sort");
        // Undo puts it back in Hold; carried once more, it lands in Sort again.
        await root.getByRole("button", { name: "Undo", exact: true }).click();
        await settled(page);
        await expect.poll(() => laneOf(root, "SRD")).toBe("hold");
        await dragState(page, root, "SRD", into("SRD", "sort"), "key");
        await expect.poll(() => laneOf(root, "SRD")).toBe("sort");
        expect(await selected(), "no carry selects anything").toBe("");
    });
});

/** The example's badge: what the host heard last. */
const heardOf = (entry: Locator): Locator => entry.getByText(/^(onSelectState|onSelectLink|onSelectTrigger|onTracePath): |^Select a state, a transition or a decision$/u);

test.describe("The host's props: the depot read only, top down (#1251, #1506, FB40)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "driven by the mouse at the desktop width");

    test("the host hears a state, a transition and a decision selected, and a path ⌥-clicked: onSelectState, onSelectLink, onSelectTrigger and onTracePath", async ({ page }) => {
        const { entry, root } = await openFlowchart(page, "flowchartDepotTopDown");
        await root.scrollIntoViewIfNeeded();
        await settled(page);
        await expect(heardOf(entry)).toHaveText("Select a state, a transition or a decision");
        await root.locator("[data-flowchart-node='SCN']").click();
        await expect(heardOf(entry)).toHaveText("onSelectState: SCN");
        // Scanned's move on to Inducted: its middle lies on no other transition.
        const inducted = await midLine(root, "l2");
        await page.mouse.click(inducted.x, inducted.y);
        await expect(heardOf(entry)).toHaveText("onSelectLink: l2");
        await root.locator("[data-flowchart-trigger='route']").click();
        await expect(heardOf(entry)).toHaveText("onSelectTrigger: route");
        // The loaded state's move on to Dispatched, in the last lane, brought into the canvas's view before the ⌥-click.
        await root.locator("[data-flowchart-link='l9']").evaluate((path) => { path.scrollIntoView({ block: "center", inline: "center" }); });
        await settled(page);
        const dispatch = await midLine(root, "l9");
        await page.keyboard.down("Alt");
        await page.mouse.click(dispatch.x, dispatch.y);
        await page.keyboard.up("Alt");
        await expect(heardOf(entry)).toHaveText("onTracePath: l9");
        // No inspector: the host's badge is where the selection goes.
        await expect(root.locator("[data-frame-slot='end']")).toHaveCount(0);
    });

    for (const theme of ["light", "dark"] as const) {
        test(`the minimap drawn over the canvas, inside main and framed as the recipe frames it, keeping main's corner while the canvas scrolls; no legend; read only, no gesture's control and no history item, a click still selecting (${theme})`, async ({ page }) => {
            const { root } = await openFlowchart(page, "flowchartDepotTopDown", theme);
            // A box narrower than the flowchart, just past a phone's frame: the canvas scrolls inside main.
            await root.evaluate((el) => { (el as HTMLElement).style.width = "600px"; });
            await settled(page);
            await expect(root.locator("[data-flowchart-legend]")).toHaveCount(0);
            await expect(root.locator("[data-flowchart-minimap]")).toHaveCount(1);
            const [surface, strong] = [await inkOf(page, "bg-surface"), await inkOf(page, "border-strong")];
            const map = await root.evaluate((el) => {
                const r = (sel: string) => el.querySelector(sel)!.getBoundingClientRect();
                const inside = (a: DOMRect, b: DOMRect) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
                const minimap = r("[data-flowchart-minimap]");
                const s = getComputedStyle(el.querySelector("[data-flowchart-minimap]")!);
                return {
                    canvas: inside(minimap, r("[data-flowchart-scroll]")),
                    main: inside(minimap, r("[data-frame-slot='main']")),
                    frame: [s.backgroundColor, s.borderTopWidth, s.borderTopStyle, s.borderTopColor],
                    shadow: s.boxShadow,
                };
            });
            expect(map).toEqual({ canvas: true, main: true, frame: [surface, "1px", "solid", strong], shadow: "none" });
            // It keeps main's corner while the canvas scrolls under it.
            const at = () => root.locator("[data-flowchart-minimap]").evaluate((el) => JSON.stringify(el.getBoundingClientRect()));
            const before = await at();
            const scrolled = await root.locator("[data-flowchart-scroll]").evaluate((el) => {
                el.scrollLeft = el.scrollWidth;
                el.scrollTop = el.scrollHeight;
                return el.scrollLeft + el.scrollTop > 0;
            });
            expect(scrolled, "the canvas is larger than main").toBe(true);
            await settled(page);
            expect(await at()).toBe(before);
            // Read only: no gesture's control and no history item; a click still selects.
            await expect(root.locator("[data-toolbar-item='history'], [data-flowchart-addlane], [data-flowchart-lane-delete]")).toHaveCount(0);
            await root.locator("[data-flowchart-node='SCN']").click();
            await expect(root.locator("[data-flowchart-node='SCN']")).toHaveAttribute("data-selected", "true");
        });
    }

    test("opened TD: LR · TD on TD, its lanes stacked down the canvas, each state below its lane's header and above the next", async ({ page }) => {
        const { root } = await openFlowchart(page, "flowchartDepotTopDown");
        // Room for LR · TD's strip, unfolded.
        await root.evaluate((el) => { (el as HTMLElement).style.width = "1000px"; });
        await settled(page);
        await expect(root.locator("[data-flowchart-seg='orientation'] [aria-checked='true']")).toHaveText("TD");
        const read = await root.evaluate((el) => {
            const top = (sel: string) => el.querySelector(sel)!.getBoundingClientRect().top;
            const heads = [...el.querySelectorAll("[data-flowchart-lane]")].map((h) => {
                const r = h.getBoundingClientRect();
                return { key: h.getAttribute("data-flowchart-lane"), left: Math.round(r.left), top: r.top };
            });
            return { heads, states: Object.fromEntries(["ARV", "IND", "CH*", "HLD", "LDD", "DLV"].map((k) => [k, top(`[data-flowchart-node="${k}"]`)])) };
        });
        expect(read.heads.map((h) => h.key)).toEqual(["intake", "induct", "sort", "hold", "dispatch"]);
        // Stacked: each header below the one before it, all at the canvas's start.
        expect(new Set(read.heads.map((h) => h.left)).size).toBe(1);
        const [intake, induct, sort, hold, dispatch] = read.heads.map((h) => h.top) as [number, number, number, number, number];
        expect(intake < induct && induct < sort && sort < hold && hold < dispatch).toBe(true);
        // Each state in its own lane: below its header, above the next — the ghost of the end no state is keyed by in the last.
        const s = read.states as Record<string, number>;
        expect([
            s["ARV"]! > intake && s["ARV"]! < induct, s["IND"]! > induct && s["IND"]! < sort, s["CH*"]! > sort && s["CH*"]! < hold,
            s["HLD"]! > hold && s["HLD"]! < dispatch, s["LDD"]! > dispatch, s["DLV"]! > dispatch,
        ]).toEqual([true, true, true, true, true, true]);
    });
});
