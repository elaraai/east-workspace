/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Flowchart's drag and drop in a real browser (#1249, `Flowchart Builder
 * Spec.md` §9.8, §10, FB30–FB34), where jsdom has no layout to measure it —
 * on the depot's flows with their library (`flowchartLibrary`), its record
 * held by the e3 the page runs. In both themes: a step's card carried from
 * the library over the Sort lane says where it lands; the lane takes the
 * brand's tint inside a dashed brand rule, its band's box; the landing line
 * runs 2px of the brand across the state's footprint, in the middle of the
 * gap under the chutes — both hidden while it rests on the "+ LANE" tail,
 * where the drop is refused; dropped, the state is drawn in that row, selected. A
 * transition's card over a transition says what it retypes, and the
 * transition takes the brand wash under its line — 12px of the brand mark at
 * 0.3 — which goes once the drag rests where the drop is refused, the caption
 * turning red; dropped, the transition is drawn observed. An owner's card over
 * a decision's diamond gives it the brand — its fill the brand's tint, its
 * rule 2px — which goes where the drop is refused. And the library:
 * where the frame is too narrow to pin it, it opens over main and slides off
 * it while a card is carried, so the canvas under the pointer takes the drop,
 * and comes back after; where it pins, it stays beside main. On a phone a tap
 * on the selected card drops it on the canvas's selection.
 *
 * Every measurement is polled until it holds, on a page at rest; nothing reads
 * a screenshot.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test flowchart-drop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

const HASH = "e3/flowchart/flowchart/flowchartLibrary";

/** Open the depot's flows with their library, at rest, and return the flowchart's root. */
async function openLibrary(page: Page, theme: "light" | "dark" = "light"): Promise<Locator> {
    await page.goto(`/?theme=${theme}#${HASH}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-builder-frame] [data-flowchart-node]").first()).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return entry.locator("[data-flowchart-root]").first();
}

/**
 * Size the flowchart's box and centre it in the window, at rest — wholly inside
 * it, clear of the 48px at each edge where a card carried there scrolls the
 * page, so nothing it measures moves under the drag.
 */
async function sizeTo(page: Page, root: Locator, width: number): Promise<void> {
    await root.evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, width);
    await settled(page);
    await root.evaluate((el) => { el.scrollIntoView({ block: "center" }); });
    await settled(page);
    expect(await root.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= 48 && r.top >= 48 && r.right <= innerWidth - 48 && r.bottom <= innerHeight - 48;
    }), "the flowchart stands inside the window, clear of its edges").toBe(true);
}

/** The library's open width (`Flowchart Builder Spec.md` §8). */
const PANE = 272;

/**
 * A frame wide enough to pin the library beside main's 480px, inside the
 * desktop window. The page's own right-hand column covers its canvas's last
 * lane and the + LANE tail, so a card carried there rests on the lanes before
 * them.
 */
const PINNED = 900;

/** A frame too narrow to pin the library — it opens over main from its rail — whose canvas the page leaves wholly uncovered. */
const OVERLAID = 700;

/** Boxes of the flowchart's elements, read at one moment. */
function boxesOf(root: Locator, selectors: readonly string[]): Promise<{ x: number; y: number; width: number; height: number }[]> {
    return root.evaluate((el, sels) => sels.map((sel) => {
        const r = el.querySelector(sel)!.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    }), selectors);
}

/** Open the library pane where it rests on its rail, and wait for it to stand open in its mode, at its whole width: its tab row folded for the room it keeps. */
async function paneOpen(page: Page, root: Locator, mode: "pinned" | "overlay"): Promise<void> {
    if (await root.locator("[data-frame-slot='start']").getAttribute("data-collapsed") !== null) {
        await root.getByRole("button", { name: "Expand Library" }).click();
        await settled(page);
    }
    await expect.poll(() => root.evaluate((el) => {
        const slot = el.querySelector("[data-frame-slot='start']")!;
        return [slot.getAttribute("data-pane-mode"), slot.hasAttribute("data-collapsed"), Math.round(slot.firstElementChild!.getBoundingClientRect().width * 10) / 10];
    })).toEqual([mode, false, PANE]);
}

/** Opens a library tab by its name: on the row, or from the `+n` menu. */
async function openTab(page: Page, root: Locator, name: string): Promise<void> {
    const onRow = root.locator("[data-frame-slot='start'] [role='tab']", { hasText: new RegExp(`^${name}( |$)`) });
    if (await onRow.count() > 0) await onRow.click();
    else {
        await root.locator("[data-frame-slot='start'] [data-dock-more]").click();
        await page.getByRole("menuitem", { name: new RegExp(`^${name}( |$)`) }).click();
        await expect(page.locator("[role='menu']")).toHaveCount(0);
    }
    await settled(page);
}

/** A card of the open tab, by its key. */
const cardOf = (root: Locator, key: string) => root.locator(`[data-frame-slot='start'] [role='tabpanel']:not([hidden]) [data-library-item="${key}"]`);

/** A locator's box — it must be laid out. */
async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await locator.boundingBox();
    if (box === null) throw new Error("not laid out");
    return box;
}

/** Press a card and carry it past the drag threshold — the drag is in flight. */
async function pickUp(page: Page, card: Locator): Promise<{ x: number; y: number }> {
    const box = await boxOf(card);
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 12, at.y + 12, { steps: 3 });
    await expect(card).toHaveAttribute("data-dragging", "");
    return at;
}

/** Carry the picked-up card to a point of the canvas — once main holds it, no pane and nothing of the page over it — and let it rest there. */
async function carryTo(page: Page, root: Locator, at: { x: number; y: number }, steps = 8): Promise<void> {
    await expect.poll(() => root.evaluate((el, p) => el.querySelector("[data-frame-slot='main']")!.contains(document.elementFromPoint(p.x, p.y)), at),
        `main holds (${Math.round(at.x)}, ${Math.round(at.y)})`).toBe(true);
    await page.mouse.move(at.x, at.y, { steps });
}

/** What the ghost says, and whether it says why not. */
async function captionOf(page: Page): Promise<{ text: string; refused: boolean } | null> {
    return page.evaluate(() => {
        const el = document.querySelector("[data-drag-caption]");
        return el === null ? null : { text: el.textContent ?? "", refused: el.hasAttribute("data-refused") };
    });
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

/** A point halfway along a transition's line, in client px. */
function midLine(root: Locator, key: string): Promise<{ x: number; y: number }> {
    return root.evaluate((el, k) => {
        const path = el.querySelector<SVGPathElement>(`[data-flowchart-link="${k}"]`)!;
        const svg = path.ownerSVGElement!.getBoundingClientRect();
        const at = path.getPointAtLength(path.getTotalLength() / 2);
        return { x: svg.left + at.x, y: svg.top + at.y };
    }, key);
}

/** The frame's region at a point — `main`, or a pane's side — or `null` outside the frame. */
function regionAt(page: Page, at: { x: number; y: number }): Promise<string | null> {
    return page.evaluate(({ x, y }) =>
        document.elementFromPoint(x, y)?.closest("[data-frame-slot]")?.getAttribute("data-frame-slot") ?? null, at);
}

test.describe("The Flowchart's drag and drop (#1249)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "carried by the mouse at the desktop width; the phone's tap below");

    for (const theme of ["light", "dark"] as const) {
        test(`a step's card over the Sort lane: the ghost says where it lands, the lane takes the brand's tint in a dashed brand rule, and the landing line runs 2px of the brand across the state's footprint in the middle of the gap under the chutes; dropped, the state is drawn there, selected (${theme})`, async ({ page }) => {
            // The whole canvas uncovered: the library opens over main, and slides off it once a card is carried.
            const root = await openLibrary(page, theme);
            await sizeTo(page, root, OVERLAID);
            await paneOpen(page, root, "overlay");
            await openTab(page, root, "Steps");
            await pickUp(page, cardOf(root, "HLD"));
            // Below the chutes' middle: after them.
            const [chutes, band] = await boxesOf(root, ["[data-flowchart-node='CH*']", "[data-flowchart-band='sort']"]);
            const rest = { x: band.x + band.width / 2, y: chutes.y + chutes.height + 20 };
            await carryTo(page, root, rest);
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
            // Over the + LANE tail, no lane: refused, red — the wash and the line hidden while the drop is refused.
            const tail = await boxOf(root.locator("[data-flowchart-addlane]"));
            await carryTo(page, root, { x: tail.x + tail.width / 2, y: tail.y + tail.height / 2 }, 6);
            await expect.poll(() => captionOf(page)).toEqual({ text: "Drop onto a lane", refused: true });
            expect(await root.evaluate((el) => ["[data-flowchart-droplane]", "[data-flowchart-landing]"]
                .map((sel) => getComputedStyle(el.querySelector(sel)!).display))).toEqual(["none", "none"]);
            await carryTo(page, root, rest, 6);
            await expect.poll(() => captionOf(page)).toEqual({ text: "after CH* in Sort", refused: false });
            await page.mouse.up();
            await expect(root.locator("[data-flowchart-node='HLD']")).toHaveAttribute("data-selected", "true");
            // In the chutes' lane, the next row down.
            const [drawn, above] = await boxesOf(root, ["[data-flowchart-node='HLD']", "[data-flowchart-node='CH*']"]);
            expect([drawn.x, drawn.width]).toEqual([above.x, above.width]);
            expect(drawn.y - above.y).toBeCloseTo(96, 1);
            // The drag over, nothing stays marked.
            await expect(root.locator("[data-flowchart-droplane], [data-flowchart-landing]")).toHaveCount(0);
            await expect(root.locator("[data-flowchart-pending]")).toHaveText(" · 1 pending");
        });

        test(`a transition's card over a transition gives it the brand wash under its line — 12px of the brand mark at 0.3 — gone where the drop is refused, the caption red; dropped, the transition is drawn observed (${theme})`, async ({ page }) => {
            const root = await openLibrary(page, theme);
            await sizeTo(page, root, PINNED);
            await paneOpen(page, root, "pinned");
            await openTab(page, root, "Transitions");
            await pickUp(page, cardOf(root, "Observed"));
            const on = await midLine(root, "CH*→LDD#2");
            await carryTo(page, root, on);
            await expect.poll(() => captionOf(page)).toEqual({ text: "onto CH* → LDD", refused: false });
            const mark = await inkOf(page, "brand-mark");
            const wash = () => root.evaluate((el) => {
                const path = el.querySelector("[data-flowchart-dropwash]");
                if (path === null) return null;
                const s = getComputedStyle(path);
                const line = el.querySelector("[data-flowchart-link='CH*→LDD#2']")!;
                return { key: path.getAttribute("data-flowchart-dropwash"), sameLine: path.getAttribute("d") === line.getAttribute("d"), display: s.display, stroke: s.stroke, width: s.strokeWidth, opacity: s.opacity, fill: s.fill };
            });
            expect(await wash()).toEqual({ key: "CH*→LDD#2", sameLine: true, display: "inline", stroke: mark, width: "12px", opacity: "0.3", fill: "none" });
            // Over a state, no transition: refused, red — the wash hidden while the drop is refused.
            const scanned = await boxOf(root.locator("[data-flowchart-node='SCN']"));
            await carryTo(page, root, { x: scanned.x + scanned.width / 2, y: scanned.y + scanned.height / 2 }, 6);
            await expect.poll(() => captionOf(page)).toEqual({ text: "Drop onto a transition", refused: true });
            await expect.poll(async () => (await wash())?.display ?? "gone").not.toBe("inline");
            // The refusal is the caption's and the cursor's: the canvas takes no tint, frame or badge — and the
            // state under the pointer dims none of the others while a card is carried.
            expect(await root.locator("[data-frame-slot='main'] [data-drag-cell]").evaluate((cell) => ({
                refused: cell.hasAttribute("data-drop-invalid"),
                fill: getComputedStyle(cell).backgroundColor,
                frame: getComputedStyle(cell, "::before").content,
                badge: getComputedStyle(cell, "::after").content,
                cursor: getComputedStyle(cell).cursor,
            }))).toEqual({ refused: true, fill: "rgba(0, 0, 0, 0)", frame: "none", badge: "none", cursor: "not-allowed" });
            await expect(root.locator("[data-flowchart-node='LDD']")).toHaveCSS("opacity", "1");
            await carryTo(page, root, on, 6);
            await expect.poll(() => captionOf(page)).toEqual({ text: "onto CH* → LDD", refused: false });
            await page.mouse.up();
            // Observed: the line's own stroke dashed in the info ink.
            const info = await inkOf(page, "status-info");
            await expect.poll(() => root.evaluate((el) => {
                const hit = el.querySelector("[data-flowchart-link='CH*→LDD#2']")!;
                const line = hit.previousElementSibling!;
                return [line.getAttribute("stroke-dasharray"), getComputedStyle(line).stroke];
            })).toEqual(["5 4", info]);
            await expect(root.locator("[data-flowchart-dropwash]")).toHaveCount(0);
        });

        test(`an owner's card over the route decision's diamond gives it the brand — its fill the brand's tint, its rule 2px — gone where the drop is refused, the caption red; dropped, it is one change (${theme})`, async ({ page }) => {
            const root = await openLibrary(page, theme);
            await sizeTo(page, root, PINNED);
            await paneOpen(page, root, "pinned");
            await openTab(page, root, "Owners");
            const diamond = root.locator("[data-flowchart-trigger='route']");
            const drawn = () => diamond.evaluate((g) => { const s = getComputedStyle(g.querySelector("rect")!); return [s.fill, s.strokeWidth]; });
            const plain = await drawn();
            await pickUp(page, cardOf(root, "customs-desk"));
            const box = await boxOf(diamond);
            const on = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
            await carryTo(page, root, on);
            await expect.poll(() => captionOf(page)).toEqual({ text: "onto decision route", refused: false });
            expect(await drawn()).toEqual([await inkOf(page, "brand-tint"), "2px"]);
            // Over a state, no decision: refused, red — the diamond as it was.
            const scanned = await boxOf(root.locator("[data-flowchart-node='SCN']"));
            await carryTo(page, root, { x: scanned.x + scanned.width / 2, y: scanned.y + scanned.height / 2 }, 6);
            await expect.poll(() => captionOf(page)).toEqual({ text: "Drop onto a decision", refused: true });
            expect(await drawn()).toEqual(plain);
            await carryTo(page, root, on, 6);
            await expect.poll(() => captionOf(page)).toEqual({ text: "onto decision route", refused: false });
            await page.mouse.up();
            await expect(root.locator("[data-flowchart-pending]")).toHaveText(" · 1 pending");
            expect(await drawn()).toEqual(plain);
        });
    }

    for (const { placement, width } of [{ placement: "overlay", width: OVERLAID }, { placement: "pinned", width: PINNED }] as const) {
        test(`the library ${placement === "overlay" ? "opened over main, where the frame is too narrow to pin it, slides off main while a card is carried — the canvas under the pointer takes the drop — and comes back after" : "pinned beside main stays where it is while a card is carried"} (#1125)`, async ({ page }) => {
            const root = await openLibrary(page);
            await sizeTo(page, root, width);
            const pane = root.locator("[data-frame-slot='start']");
            await paneOpen(page, root, placement);
            await openTab(page, root, "Steps");
            const from = await pickUp(page, cardOf(root, "HLD"));
            // Overlaid, the pane slides off main as the drag begins: where the card lay is main's; pinned, the pane's.
            await expect.poll(() => regionAt(page, from)).toBe(placement === "overlay" ? "main" : "start");
            await expect(root.locator("[data-scrim]")).toHaveCount(0);
            const [sort, chutes] = await boxesOf(root, ["[data-flowchart-band='sort']", "[data-flowchart-node='CH*']"]);
            await carryTo(page, root, { x: sort.x + sort.width / 2, y: chutes.y + chutes.height + 20 });
            await expect.poll(() => captionOf(page)).toEqual({ text: "after CH* in Sort", refused: false });
            await page.mouse.up();
            await expect(root.locator("[data-flowchart-node='HLD']")).toHaveAttribute("data-selected", "true");
            // The drag over, the library is back where it was.
            await expect.poll(() => regionAt(page, from)).toBe("start");
            await expect(pane).toHaveAttribute("data-pane-mode", placement);
        });
    }
});

test.describe("The Flowchart's drops on a phone (#1249)", () => {
    test.skip(({ isMobile }) => !isMobile, "a coarse pointer: the phone projects");

    test("a tap on a state selects it; in the library opened from its rail, a tap selects a step's card, and a tap on the selected card drops it after the state — the card staying selected", async ({ page }) => {
        const root = await openLibrary(page);
        await root.locator("[data-flowchart-node='SCN']").tap();
        await expect(root.locator("[data-flowchart-node='SCN']")).toHaveAttribute("data-selected", "true");
        await root.getByRole("button", { name: "Expand Library" }).click();
        await settled(page);
        await openTab(page, root, "Steps");
        const card = cardOf(root, "HLD");
        await card.tap();
        await expect(card).toHaveAttribute("data-placed", "");
        await expect(root.locator("[data-flowchart-node='HLD']")).toHaveCount(0);
        await card.tap();
        await expect(root.locator("[data-flowchart-node='HLD']")).toHaveCount(1);
        await expect(card).toHaveAttribute("data-placed", "");
        await expect(root.locator("[data-flowchart-pending]")).toHaveText(" · 1 pending");
    });
});
