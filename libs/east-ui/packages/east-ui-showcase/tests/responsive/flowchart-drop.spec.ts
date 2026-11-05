/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Flowchart's drag and drop in a real browser (#1249, #1501, `Flowchart
 * Records Spec.md` R14), where jsdom has no layout to measure it — on the
 * depot's records with their library (`flowchartDepot`), held by the e3 the
 * page runs. In both themes: a step's card carried from the library over the
 * Sort lane says where it lands; the lane takes the brand's tint inside a
 * dashed brand rule, its band's box; the landing line lies 2px of the brand
 * across the state's footprint, in the middle of the gap under the chutes —
 * both hidden while it rests on the "+ LANE" tail, where the drop is refused;
 * dropped, a new state is drawn in that row, selected. A transition's card
 * over a transition says what it gives its values to, and the transition takes
 * the brand wash under its line — 12px of the brand mark at 0.3 — which goes
 * once the drag rests where the drop is refused, the caption turning red;
 * dropped, the transition is drawn observed. An owner's card over a decision's
 * diamond gives it the brand — its fill the brand's tint, its rule 2px — which
 * goes where the drop is refused. And the library: where the frame is too
 * narrow to pin it, it opens over main and slides off it while a card is
 * carried, so the canvas under the pointer takes the drop, and comes back
 * after; where it pins, it stays beside main. On a phone a tap on the selected
 * card drops it on the canvas's selection.
 *
 * The depot's cards draw their details, so its lanes reach past main at each
 * frame here: what a card is carried to is scrolled to main's middle first
 * (`centreInMain`), as the viewer's scrollbar brings it there, and the canvas is
 * scrolled under a carried card to reach the + LANE tail.
 *
 * Every measurement is polled until it holds, on a page at rest; nothing reads
 * a screenshot.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test flowchart-drop`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";
import { CARRY_WINDOW, boxOf, boxesOf, captionOf, cardOf, carryTo, centreInMain, middleOf, midLine, openFlowchart, openTab, paneOpen, pickUp, sizeTo } from "./flowchart-page";
import { LAYOUT_THEMES } from "./themes";

/** Open the depot with its library, at rest, and return the flowchart's root. */
async function openDepot(page: Page, theme: "light" | "dark" = "light"): Promise<Locator> {
    return (await openFlowchart(page, "flowchartDepot", theme)).root;
}

/**
 * A frame wide enough to pin the library beside main's 480px, inside the
 * carrying window. Main shows less than two of the depot's lanes: the canvas
 * scrolls across to show the one a card is carried to.
 */
const PINNED = 900;

/**
 * A frame too narrow to pin the library — it opens over main from its rail.
 * Main shows less than two of the depot's five lanes and the + LANE tail: the
 * canvas scrolls to show its end.
 */
const OVERLAID = 700;

/** The Sort lane's band: where a step's card is carried. */
const SORT = "[data-flowchart-band='sort']";

/** The states the canvas dims: each one's key, its opacity short of whole. */
function dimmed(root: Locator): Promise<string[]> {
    return root.evaluate((el) => [...el.querySelectorAll("[data-flowchart-node]")]
        .filter((node) => getComputedStyle(node).opacity !== "1")
        .map((node) => node.getAttribute("data-flowchart-node")!));
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

/** A dashed rule of a width, as this screen draws it: a width snaps to its device pixels. */
function ruleOf(page: Page, width: string): Promise<string> {
    return page.evaluate((w) => {
        const probe = document.createElement("div");
        probe.style.outline = `${w} dashed`;
        document.body.appendChild(probe);
        const drawn = getComputedStyle(probe).outlineWidth;
        probe.remove();
        return drawn;
    }, width);
}

/** The frame's region at a point — `main`, or a pane's side — or `null` outside the frame. */
function regionAt(page: Page, at: { x: number; y: number }): Promise<string | null> {
    return page.evaluate(({ x, y }) =>
        document.elementFromPoint(x, y)?.closest("[data-frame-slot]")?.getAttribute("data-frame-slot") ?? null, at);
}

/** The state the canvas has selected: a drop selects the state it adds, keyed `state-<n>`. */
function selectedState(root: Locator): Locator {
    return root.locator("[data-flowchart-node][data-selected='true']");
}

test.describe("The Flowchart's drag and drop (#1249)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "carried by the mouse at the desktop width; the phone's tap below");
    test.beforeEach(async ({ page }) => { await page.setViewportSize(CARRY_WINDOW); });

    // These hold the marks' colours: each theme's.
    for (const theme of ["light", "dark"] as const) {
        test(`a step's card over the Sort lane: the ghost says where it lands, the lane takes the brand's tint in a dashed brand rule, and the landing line lies 2px of the brand across the state's footprint in the middle of the gap under the chutes; dropped, a new state is drawn there, selected (${theme})`, async ({ page }) => {
            // The library opens over main, and slides off it once a card is carried; the canvas is scrolled across till
            // the Sort lane stands in main's middle.
            const root = await openDepot(page, theme);
            await sizeTo(page, root, OVERLAID);
            await paneOpen(page, root, "overlay");
            await openTab(page, root, "Steps");
            await centreInMain(page, root, middleOf(await boxOf(root.locator(SORT))));
            await pickUp(page, cardOf(root, "desk"));
            // Below the chutes' middle: after them.
            const restOf = async () => {
                const [chutes, band] = await boxesOf(root, ["[data-flowchart-node='CH*']", SORT]);
                return { x: band.x + band.width / 2, y: chutes.y + chutes.height + 20 };
            };
            await carryTo(page, root, restOf);
            const rest = await restOf();
            await expect.poll(() => captionOf(page)).toEqual({ text: "after CH* in Sort", refused: false });
            // The pointer over the lane raises no "+ STATE" ghost while a card is carried.
            await expect(root.locator("[data-flowchart-ghoststate]")).toHaveCount(0);
            const [tint, solid] = [await inkOf(page, "brand-tint"), await inkOf(page, "brand-solid")];
            // The marks, and what they mark, read at one moment.
            const marks = await root.evaluate((el) => {
                const round = (n: number) => Math.round(n * 10) / 10;
                const at = (e: Element) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(round); };
                const wash = el.querySelector("[data-flowchart-droplane]")!;
                const line = el.querySelector("[data-flowchart-landing]")!;
                const ws = getComputedStyle(wash);
                const ls = getComputedStyle(line);
                return {
                    lane: wash.getAttribute("data-flowchart-droplane"),
                    band: at(el.querySelector("[data-flowchart-band='sort']")!),
                    chutes: at(el.querySelector("[data-flowchart-node='CH*']")!),
                    wash: { box: at(wash), fill: ws.backgroundColor, rule: [ws.outlineStyle, ws.outlineWidth, ws.outlineColor], display: ws.display },
                    line: { box: at(line), fill: ls.backgroundColor, row: line.getAttribute("data-flowchart-landing"), display: ls.display },
                };
            });
            expect(marks.lane).toBe("sort");
            expect(marks.wash).toEqual({ box: marks.band, fill: tint, rule: ["dashed", await ruleOf(page, "1.5px"), solid], display: "block" });
            // Across the state's footprint, centred on the middle of the 56px gap under the chutes.
            const [cx, cy, cw, ch] = marks.chutes;
            expect(marks.line.box[0]).toBeCloseTo(cx, 1);
            expect(marks.line.box[2]).toBeCloseTo(cw, 1);
            expect(marks.line.box[3]).toBeCloseTo(2, 1);
            expect(marks.line.box[1] + marks.line.box[3] / 2).toBeCloseTo(cy + ch + 28, 1);
            expect([marks.line.fill, marks.line.row, marks.line.display]).toEqual([solid, "1", "block"]);
            // Over the + LANE tail, no lane — the canvas scrolled to its end under the carried card, the tail at the
            // rest's height: refused, red — the wash and the line hidden while the drop is refused.
            await root.locator("[data-flowchart-scroll]").evaluate((el) => { el.scrollLeft = el.scrollWidth; });
            await settled(page);
            const tail = await boxOf(root.locator("[data-flowchart-addlane]"));
            await carryTo(page, root, { x: tail.x + tail.width / 2, y: rest.y }, 6);
            await expect.poll(() => captionOf(page)).toEqual({ text: "Drop onto a lane", refused: true });
            expect(await root.evaluate((el) => ["[data-flowchart-droplane]", "[data-flowchart-landing]"]
                .map((sel) => getComputedStyle(el.querySelector(sel)!).display))).toEqual(["none", "none"]);
            // Back across, the Sort lane in main's middle again.
            await centreInMain(page, root, middleOf(await boxOf(root.locator(SORT))));
            await carryTo(page, root, restOf, 6);
            await expect.poll(() => captionOf(page)).toEqual({ text: "after CH* in Sort", refused: false });
            await page.mouse.up();
            // A new state, selected: in the chutes' lane, the next row down — the row each lane's second state stands
            // in, the scanned state's in the first lane, its cards centred in it.
            await expect(selectedState(root)).toHaveCount(1);
            const key = await selectedState(root).getAttribute("data-flowchart-node");
            expect(key).toMatch(/^state-\d+$/);
            const [drawn, above, second] = await boxesOf(root, [`[data-flowchart-node='${key}']`, "[data-flowchart-node='CH*']", "[data-flowchart-node='SCN']"]);
            expect([drawn.x, drawn.width]).toEqual([above.x, above.width]);
            expect(drawn.y).toBeGreaterThan(above.y + above.height);
            expect(drawn.y + drawn.height / 2).toBeCloseTo(second.y + second.height / 2, 1);
            // The drag over, nothing stays marked.
            await expect(root.locator("[data-flowchart-droplane], [data-flowchart-landing]")).toHaveCount(0);
            await expect(root.locator("[data-flowchart-pending]")).toHaveText(" · 1 pending");
        });

        test(`a transition's card over a transition gives it the brand wash under its line — 12px of the brand mark at 0.3 — gone where the drop is refused, the caption red; dropped, the transition is drawn observed (${theme})`, async ({ page }) => {
            const root = await openDepot(page, theme);
            await sizeTo(page, root, PINNED);
            await paneOpen(page, root, "pinned");
            await openTab(page, root, "Transitions");
            // CH* → SRD, down the Sort lane: the canvas scrolled across till its middle stands in main's — read again
            // as the card rests, carried in over main's start.
            await centreInMain(page, root, await midLine(root, "l5"));
            await pickUp(page, cardOf(root, "reroute"));
            const on = () => midLine(root, "l5");
            await carryTo(page, root, on);
            await expect.poll(() => captionOf(page)).toEqual({ text: "onto CH* → SRD", refused: false });
            const mark = await inkOf(page, "brand-mark");
            const wash = () => root.evaluate((el) => {
                const path = el.querySelector("[data-flowchart-dropwash]");
                if (path === null) return null;
                const s = getComputedStyle(path);
                const line = el.querySelector("[data-flowchart-link='l5']")!;
                return { key: path.getAttribute("data-flowchart-dropwash"), sameLine: path.getAttribute("d") === line.getAttribute("d"), display: s.display, stroke: s.stroke, width: s.strokeWidth, opacity: s.opacity, fill: s.fill };
            });
            expect(await wash()).toEqual({ key: "l5", sameLine: true, display: "inline", stroke: mark, width: "12px", opacity: "0.3", fill: "none" });
            // Over a state, no transition — the chutes, in view above the line: refused, red — the wash hidden while
            // the drop is refused.
            await carryTo(page, root, middleOf(await boxOf(root.locator("[data-flowchart-node='CH*']"))), 6);
            await expect.poll(() => captionOf(page)).toEqual({ text: "Drop onto a transition", refused: true });
            await expect.poll(async () => (await wash())?.display ?? "gone").not.toBe("inline");
            // The refusal is the caption's and the cursor's: the canvas takes no tint, frame or badge — and the
            // state under the pointer dims none of the others while a card is carried, those it has no transition
            // with among them.
            expect(await root.locator("[data-frame-slot='main'] [data-drag-cell]").evaluate((cell) => ({
                refused: cell.hasAttribute("data-drop-invalid"),
                fill: getComputedStyle(cell).backgroundColor,
                frame: getComputedStyle(cell, "::before").content,
                badge: getComputedStyle(cell, "::after").content,
                cursor: getComputedStyle(cell).cursor,
            }))).toEqual({ refused: true, fill: "rgba(0, 0, 0, 0)", frame: "none", badge: "none", cursor: "not-allowed" });
            await expect.poll(() => dimmed(root)).toEqual([]);
            await carryTo(page, root, on, 6);
            await expect.poll(() => captionOf(page)).toEqual({ text: "onto CH* → SRD", refused: false });
            await page.mouse.up();
            // Observed: the line's own stroke dashed in the info ink.
            const info = await inkOf(page, "status-info");
            await expect.poll(() => root.evaluate((el) => {
                const hit = el.querySelector("[data-flowchart-link='l5']")!;
                const line = hit.previousElementSibling!;
                return [line.getAttribute("stroke-dasharray"), getComputedStyle(line).stroke];
            })).toEqual(["5 4", info]);
            await expect(root.locator("[data-flowchart-dropwash]")).toHaveCount(0);
        });

        test(`an owner's card over the route decision's diamond gives it the brand — its fill the brand's tint, its rule 2px — gone where the drop is refused, the caption red; dropped, it is one change (${theme})`, async ({ page }) => {
            const root = await openDepot(page, theme);
            await sizeTo(page, root, PINNED);
            await paneOpen(page, root, "pinned");
            await openTab(page, root, "Owners");
            const diamond = root.locator("[data-flowchart-trigger='route']");
            // The canvas scrolled across till the diamond stands in main's middle.
            await centreInMain(page, root, middleOf(await boxOf(diamond)));
            const drawn = () => diamond.evaluate((g) => { const s = getComputedStyle(g.querySelector("rect")!); return [s.fill, s.strokeWidth]; });
            const plain = await drawn();
            await pickUp(page, cardOf(root, "cd"));
            // Read again as the card rests, carried in over main's start.
            const on = async () => middleOf(await boxOf(diamond));
            await carryTo(page, root, on);
            await expect.poll(() => captionOf(page)).toEqual({ text: "onto decision route", refused: false });
            expect(await drawn()).toEqual([await inkOf(page, "brand-tint"), "2px"]);
            // Over a state, no decision — the chutes, in view beside it: refused, red — the diamond as it was.
            await carryTo(page, root, middleOf(await boxOf(root.locator("[data-flowchart-node='CH*']"))), 6);
            await expect.poll(() => captionOf(page)).toEqual({ text: "Drop onto a decision", refused: true });
            expect(await drawn()).toEqual(plain);
            await carryTo(page, root, on, 6);
            await expect.poll(() => captionOf(page)).toEqual({ text: "onto decision route", refused: false });
            await page.mouse.up();
            await expect(root.locator("[data-flowchart-pending]")).toHaveText(" · 1 pending");
            expect(await drawn()).toEqual(plain);
        });
    }

    for (const theme of LAYOUT_THEMES) {
        for (const { placement, width } of [{ placement: "overlay", width: OVERLAID }, { placement: "pinned", width: PINNED }] as const) {
            test(`the library ${placement === "overlay" ? "opened over main, where the frame is too narrow to pin it, slides off main while a card is carried — the canvas under the pointer takes the drop — and comes back after" : "pinned beside main stays where it is while a card is carried"} (#1125, ${theme})`, async ({ page }) => {
                const root = await openDepot(page, theme);
                await sizeTo(page, root, width);
                const pane = root.locator("[data-frame-slot='start']");
                await paneOpen(page, root, placement);
                await openTab(page, root, "Steps");
                // The canvas scrolled across till the Sort lane stands in main's middle.
                await centreInMain(page, root, middleOf(await boxOf(root.locator(SORT))));
                const from = await pickUp(page, cardOf(root, "desk"));
                // Overlaid, the pane slides off main as the drag begins: where the card lay is main's; pinned, the pane's.
                await expect.poll(() => regionAt(page, from)).toBe(placement === "overlay" ? "main" : "start");
                await expect(root.locator("[data-scrim]")).toHaveCount(0);
                // Read again as the card rests: pinned, it is carried in over main's start.
                await carryTo(page, root, async () => {
                    const [sort, chutes] = await boxesOf(root, [SORT, "[data-flowchart-node='CH*']"]);
                    return { x: sort.x + sort.width / 2, y: chutes.y + chutes.height + 20 };
                });
                await expect.poll(() => captionOf(page)).toEqual({ text: "after CH* in Sort", refused: false });
                await page.mouse.up();
                await expect(selectedState(root)).toHaveAttribute("data-flowchart-node", /^state-\d+$/);
                // The drag over, the library is back where it was.
                await expect.poll(() => regionAt(page, from)).toBe("start");
                await expect(pane).toHaveAttribute("data-pane-mode", placement);
            });
        }
    }
});

test.describe("The Flowchart's drops on a phone (#1249)", () => {
    test.skip(({ isMobile }) => !isMobile, "a coarse pointer: the phone projects");

    test("a tap on a state selects it; in the library opened from its rail, a tap selects a step's card, and a tap on the selected card drops it after the state — the card staying selected", async ({ page }) => {
        const root = await openDepot(page);
        const states = root.locator("[data-flowchart-node]");
        await root.locator("[data-flowchart-node='SCN']").tap();
        await expect(root.locator("[data-flowchart-node='SCN']")).toHaveAttribute("data-selected", "true");
        const before = await states.count();
        await root.locator("[data-pane-tab='start']").click();
        await settled(page);
        await openTab(page, root, "Steps");
        const card = cardOf(root, "desk");
        await card.tap();
        await expect(card).toHaveAttribute("data-placed", "");
        await expect(states).toHaveCount(before);
        await card.tap();
        await expect(states).toHaveCount(before + 1);
        await expect(card).toHaveAttribute("data-placed", "");
        await expect(root.locator("[data-flowchart-pending]")).toHaveText(" · 1 pending");
    });
});
