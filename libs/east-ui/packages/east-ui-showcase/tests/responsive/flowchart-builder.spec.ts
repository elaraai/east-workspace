/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Flowchart as an app meets it, on the e3 the page runs (#1251,
 * `Flowchart Builder Spec.md` §3, §9.10, FB39–FB41), over its examples:
 *
 * - **every pane combination** — none (`flowchartHandover`), a library
 *   (`flowchartVariants`), an inspector (`flowchartDepot`) and both
 *   (`flowchartFlows`): the frame holds the panes it is given and no other,
 *   main the room they leave — pinned open beside main at the desktop width,
 *   rails on a phone — in both themes;
 * - **the depot's flows saved** (FB39, `flowchartLibrary`): a step's card
 *   dropped on a lane, a transition's card on a transition and a state
 *   dragged across lanes, then Save — one commit to the record, the drafts
 *   retiring as it reads back, no banner — and the flowchart, mounted again
 *   over the record, draws what Save committed;
 * - **the configurator** (`flowchartVariants`): the host hears a state, a
 *   transition and a decision selected and a path ⌥-clicked; its switches
 *   take the legend away, draw the minimap — over the canvas, inside main,
 *   clear of the legend, framed as the recipe frames it — and make the
 *   flowchart read only; and an edit saved through the host's `onApply` is in
 *   the record when the flowchart mounts again;
 * - **top down** (`flowchartHandover`): opened TD, its lanes stacked, each
 *   state in its own.
 *
 * Every measurement is polled until it holds, on a page at rest; nothing
 * reads a screenshot.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test flowchart-builder`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { frameAt } from "./builder-frame";
import { settled } from "./settle";
import { boxesOf, captionOf, cardOf, carryTo, midLine, openFlowchart, openTab, paneOpen, pickUp, remount, sizeTo } from "./flowchart-page";

/** The inspector's open width (`Flowchart Builder Spec.md` §8). */
const INSPECTOR = 320;
/** The library's open width (§8). */
const LIBRARY = 272;
/** A collapsed pane's rail. */
const RAIL = 44;

/** Each pane combination, and the example that has it. */
const COMBINATIONS = [
    { name: "flowchartHandover", library: false, inspector: false },
    { name: "flowchartVariants", library: true, inspector: false },
    { name: "flowchartDepot", library: false, inspector: true },
    { name: "flowchartFlows", library: true, inspector: true },
] as const;

/** A frame wide enough to pin both panes beside main's 480px. */
const WIDE = 1200;

/** The history item's last button: Save. */
const saveOf = (root: Locator): Locator => root.locator("[data-toolbar-item='history'] [data-slot='history'] button").last();

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
        test(`each pane it is given a 44px rail over main's edge, and none it is not; main the room between (${theme})`, async ({ page }) => {
            for (const { name, library, inspector } of COMBINATIONS) {
                const { root } = await openFlowchart(page, name, theme);
                await expect.poll(() => panesOf(root), name).toEqual({
                    start: library ? { mode: "overlay", collapsed: true, width: RAIL } : null,
                    end: inspector ? { mode: "overlay", collapsed: true, width: RAIL } : null,
                    before: 0,
                    after: 0,
                });
            }
        });
    }
});

/** Which lane's band a state's card stands in, by its middle: the band's key, or `null`. */
function laneOf(root: Locator, key: string): Promise<string | null> {
    return root.evaluate((el, k) => {
        const card = el.querySelector(`[data-flowchart-node="${k}"]`)!.getBoundingClientRect();
        const x = card.left + card.width / 2;
        const y = card.top + card.height / 2;
        const band = [...el.querySelectorAll("[data-flowchart-band]")].find((b) => {
            const r = b.getBoundingClientRect();
            return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        });
        return band?.getAttribute("data-flowchart-band") ?? null;
    }, key);
}

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

/** Drag a state's card by the mouse to a point of the canvas, past the move's threshold. */
async function dragState(page: Page, root: Locator, key: string, to: { x: number; y: number }): Promise<void> {
    const [card] = await boxesOf(root, [`[data-flowchart-node="${key}"]`]);
    await page.mouse.move(card!.x + card!.width / 2, card!.y + card!.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
    await settled(page);
}

test.describe("The depot's flows on the e3 the page runs (#1251, FB39)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "carried by the mouse at the desktop width");

    test("a step and a transition dropped, a state moved across lanes, and Save: one commit to the record — and the flowchart, mounted again over it, draws what Save committed", async ({ page }) => {
        const { root } = await openFlowchart(page, "flowchartLibrary");
        // Too narrow to pin the library: it opens over main, and slides off it while a card is carried.
        await sizeTo(page, root, 700);
        await paneOpen(page, root, "overlay");
        const pending = root.locator("[data-flowchart-pending]");
        await expect(pending).toHaveText(" · 0 pending");

        // A step: the hold, onto the Sort lane under the chutes.
        await openTab(page, root, "Steps");
        await pickUp(page, cardOf(root, "HLD"));
        const [chutes, sort] = await boxesOf(root, ["[data-flowchart-node='CH*']", "[data-flowchart-band='sort']"]);
        await carryTo(page, root, { x: sort!.x + sort!.width / 2, y: chutes!.y + chutes!.height + 20 });
        await expect.poll(() => captionOf(page)).toEqual({ text: "after CH* in Sort", refused: false });
        await page.mouse.up();
        await expect(root.locator("[data-flowchart-node='HLD']")).toHaveCount(1);
        await expect(pending).toHaveText(" · 1 pending");

        // A transition: the chutes' to the van, retyped observed.
        await paneOpen(page, root, "overlay");
        await openTab(page, root, "Transitions");
        await pickUp(page, cardOf(root, "Observed"));
        await carryTo(page, root, await midLine(root, "CH*→LDD#2"));
        await expect.poll(() => captionOf(page)).toEqual({ text: "onto CH* → LDD", refused: false });
        await page.mouse.up();
        await expect(pending).toHaveText(" · 2 pending");

        // The library on its rail, the canvas whole: the van's state dragged into the Sort lane.
        await root.getByRole("button", { name: "Collapse Library" }).click();
        await settled(page);
        const [loaded, sortBand] = await boxesOf(root, ["[data-flowchart-node='LDD']", "[data-flowchart-band='sort']"]);
        expect(await laneOf(root, "LDD")).toBe("load");
        await dragState(page, root, "LDD", { x: sortBand!.x + sortBand!.width / 2, y: loaded!.y + loaded!.height / 2 });
        await expect.poll(() => laneOf(root, "LDD")).toBe("sort");
        await expect(pending).toHaveText(" · 3 pending");

        // Save: one commit through the record's patch mutation, the drafts retiring as the record reads it back.
        const save = saveOf(root);
        await expect(save).toBeEnabled();
        await save.click();
        await expect(pending).toHaveText(" · 0 pending");
        await expect(save).toBeDisabled();
        await expect(root.locator("[role='alert']")).toHaveCount(0);

        // Mounted again over the record: the held state and the van's in Sort, the chutes' transition observed.
        const again = await remount(page, "flowchartLibrary");
        await expect(again.locator("[data-flowchart-pending]")).toHaveText(" · 0 pending");
        await expect.poll(async () => [await laneOf(again, "HLD"), await laneOf(again, "LDD")]).toEqual(["sort", "sort"]);
        expect(await lineOf(again, "CH*→LDD#2")).toEqual(["5 4", await inkOf(page, "status-info")]);
        await expect(saveOf(again)).toBeDisabled();
    });
});

/** The configurator's aside: what the host heard last. */
const heardOf = (entry: Locator): Locator => entry.getByText(/^(onSelectState|onSelectLink|onSelectTrigger|onTracePath): |^Select a state, a transition or a decision$/u);

/** Flip one of the configurator's switches, by its label. */
async function flip(page: Page, entry: Locator, label: string): Promise<void> {
    await entry.locator("[data-scope='switch'][data-part='root']", { hasText: label }).click();
    await settled(page);
}

test.describe("The Flowchart configurator (#1251, FB40)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "driven by the mouse at the desktop width");

    test("the host hears a state, a transition and a decision selected, and a path ⌥-clicked: onSelectState, onSelectLink, onSelectTrigger and onTracePath", async ({ page }) => {
        const { entry, root } = await openFlowchart(page, "flowchartVariants");
        await root.scrollIntoViewIfNeeded();
        await settled(page);
        await expect(heardOf(entry)).toHaveText("Select a state, a transition or a decision");
        await root.locator("[data-flowchart-node='SCN']").click();
        await expect(heardOf(entry)).toHaveText("onSelectState: SCN");
        const arrival = await midLine(root, "ARV→SCN#0");
        await page.mouse.click(arrival.x, arrival.y);
        await expect(heardOf(entry)).toHaveText("onSelectLink: ARV→SCN#0");
        await root.locator("[data-flowchart-trigger='route']").click();
        await expect(heardOf(entry)).toHaveText("onSelectTrigger: route");
        // The van's transition brought into the canvas's view before the ⌥-click.
        await root.locator("[data-flowchart-link='CH*→LDD#2']").evaluate((path) => { path.scrollIntoView({ block: "center", inline: "center" }); });
        await settled(page);
        const load = await midLine(root, "CH*→LDD#2");
        await page.keyboard.down("Alt");
        await page.mouse.click(load.x, load.y);
        await page.keyboard.up("Alt");
        await expect(heardOf(entry)).toHaveText("onTracePath: CH*→LDD#2");
        // No inspector: the host's aside is where the selection goes.
        await expect(root.locator("[data-frame-slot='end']")).toHaveCount(0);
    });

    for (const theme of ["light", "dark"] as const) {
        test(`its switches: the minimap drawn over the canvas, inside main, clear of the legend and framed as the recipe frames it; the legend taken away; read only, no gesture and no history item (${theme})`, async ({ page }) => {
            const { entry, root } = await openFlowchart(page, "flowchartVariants", theme);
            // A box narrower than the flow: the canvas scrolls inside main.
            await root.evaluate((el) => { (el as HTMLElement).style.width = "560px"; });
            await settled(page);
            await expect(root.locator("[data-flowchart-legend]")).toHaveCount(1);
            await expect(root.locator("[data-flowchart-minimap]")).toHaveCount(0);
            await flip(page, entry, "Minimap");
            await expect(root.locator("[data-flowchart-minimap]")).toHaveCount(1);
            const [surface, strong] = [await inkOf(page, "bg-surface"), await inkOf(page, "border-strong")];
            const map = await root.evaluate((el) => {
                const r = (sel: string) => el.querySelector(sel)!.getBoundingClientRect();
                const inside = (a: DOMRect, b: DOMRect) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
                const minimap = r("[data-flowchart-minimap]");
                const legend = r("[data-flowchart-legend]");
                const s = getComputedStyle(el.querySelector("[data-flowchart-minimap]")!);
                return {
                    canvas: inside(minimap, r("[data-flowchart-scroll]")),
                    main: inside(minimap, r("[data-frame-slot='main']")),
                    clear: minimap.right <= legend.left || minimap.left >= legend.right || minimap.bottom <= legend.top || minimap.top >= legend.bottom,
                    frame: [s.backgroundColor, s.borderTopWidth, s.borderTopStyle, s.borderTopColor],
                    shadow: s.boxShadow,
                };
            });
            expect(map).toEqual({ canvas: true, main: true, clear: true, frame: [surface, "1px", "solid", strong], shadow: "none" });
            // It stays in main's corner while the canvas scrolls under it.
            const at = () => root.locator("[data-flowchart-minimap]").evaluate((el) => JSON.stringify(el.getBoundingClientRect()));
            const before = await at();
            const scrolled = await root.locator("[data-flowchart-scroll]").evaluate((el) => {
                el.scrollLeft = el.scrollWidth;
                el.scrollTop = el.scrollHeight;
                return el.scrollLeft + el.scrollTop > 0;
            });
            expect(scrolled, "the canvas is wider than main").toBe(true);
            await settled(page);
            expect(await at()).toBe(before);
            // The legend away; the minimap stays.
            await flip(page, entry, "Legend");
            await expect(root.locator("[data-flowchart-legend]")).toHaveCount(0);
            await expect(root.locator("[data-flowchart-minimap]")).toHaveCount(1);
            // Read only: no gesture's control, no "+ New flow" and no history item; the selection stays.
            await expect(root.locator("[data-toolbar-item='history']")).toHaveCount(1);
            await flip(page, entry, "Read-only");
            await expect(root.locator("[data-toolbar-item='history'], [data-flowchart-addlane], [data-flowchart-lane-delete], [data-flowchart-new-flow]")).toHaveCount(0);
            await root.locator("[data-flowchart-node='SCN']").click();
            await expect(root.locator("[data-flowchart-node='SCN']")).toHaveAttribute("data-selected", "true");
        });
    }

    test("an edit saved through the host's onApply is one commit to the record: the drafts retire as the host's flows read it back, and the flowchart, mounted again, draws it", async ({ page }) => {
        const { root } = await openFlowchart(page, "flowchartVariants");
        const lanes = () => root.locator("[data-flowchart-lane]").allTextContents();
        const pending = root.locator("[data-flowchart-pending]");
        await expect(pending).toHaveText(" · 0 pending");
        await root.locator("[data-flowchart-addlane]").click();
        await expect.poll(lanes).toEqual(["INTAKE", "SORT", "LOAD", "LANE 4"]);
        await expect(pending).toHaveText(" · 1 pending");
        const save = saveOf(root);
        await save.click();
        await expect(pending).toHaveText(" · 0 pending");
        await expect(save).toBeDisabled();
        await expect(root.locator("[role='alert']")).toHaveCount(0);
        const again = await remount(page, "flowchartVariants");
        await expect.poll(() => again.locator("[data-flowchart-lane]").allTextContents()).toEqual(["INTAKE", "SORT", "LOAD", "LANE 4"]);
        await expect(again.locator("[data-flowchart-pending]")).toHaveText(" · 0 pending");
    });
});

test.describe("Top down (#1251, FB40)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    test("the host's one flow opens TD: LR · TD on TD, its lanes stacked down the canvas, each state below its lane's header and above the next", async ({ page }) => {
        const { root } = await openFlowchart(page, "flowchartHandover");
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
            return { heads, states: Object.fromEntries(["LDD", "DSP", "DLV", "RTN"].map((k) => [k, top(`[data-flowchart-node="${k}"]`)])) };
        });
        expect(read.heads.map((h) => h.key)).toEqual(["load", "road", "door"]);
        // Stacked: each header below the one before it, all at the canvas's start.
        expect(new Set(read.heads.map((h) => h.left)).size).toBe(1);
        const [load, road, door] = read.heads.map((h) => h.top);
        expect(load! < road! && road! < door!).toBe(true);
        // Each state in its own lane: below its header, above the next.
        expect(read.states["LDD"]! > load! && read.states["LDD"]! < road!).toBe(true);
        expect(read.states["DSP"]! > road! && read.states["DSP"]! < door!).toBe(true);
        expect(read.states["DLV"]! > door! && read.states["RTN"]! > door!).toBe(true);
    });
});
