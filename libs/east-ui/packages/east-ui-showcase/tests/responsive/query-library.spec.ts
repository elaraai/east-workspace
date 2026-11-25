/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The query library, measured in a real browser (#1761): one `BuilderFrame`,
 * borderless and with no pane — a 44px toolbar row holding the rail and, after
 * it, New query, over a grid of the saved queries' cards. The grid holds as
 * many cards across as fit at 300px each — five in 1800px, three in 1240px,
 * two in 846px, one in 560px and on a phone — 12px apart and 20px in from the
 * frame, each 224px tall with its wireframe, its name and its foot inside it,
 * the foot at the card's end whatever stands over it, in the order e3 pages
 * them — and so still once the rail has narrowed them, and whatever gutter the
 * platform's scrollbar keeps (east-workspace#1772); the open query's card is
 * the brand's; and a press on a card asks the surface for its query. Every
 * measurement is polled until it holds, on a page at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test query-library --project desktop`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { recordField } from "./record-slice";
import { settled } from "./settle";
import { LAYOUT_THEMES } from "./themes";

const HASH = "e3/query/query/queryLibrary";

/** The saved queries' names, in the order e3 pages them: the record's key order. */
const NAMES = [
    "Demand at $10–$12, NSW", "Large orders with no discount", "Pump parts cost", "Revenue by region", "Shipped revenue by month",
    "Top shipped orders, 2026", "Units by SKU",
];

/** Open the library example and return its frame, at rest — as wide as `width` where one is given. */
async function openLibrary(page: Page, width?: number, theme: "light" | "dark" = "light"): Promise<Locator> {
    await page.goto(`/?theme=${theme}#${HASH}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const frame = entry.locator("[data-builder-frame]").first();
    await expect(frame.locator("[data-library-gallery] [data-library-card]").first()).toBeVisible({ timeout: 20_000 });
    if (width !== undefined) await frame.evaluate((root, px) => { (root as HTMLElement).style.width = `${px}px`; }, width);
    await settled(page);
    return frame;
}

/** The grid as it is laid out: how many cards stand on its first line, a card's size, the gaps between them and their inset from main, whether each card holds what it draws, and how far each card's foot ends from its card's end. */
function grid(frame: Locator) {
    return frame.evaluate((root) => {
        const main = root.querySelector('[data-frame-slot="main"]')!.getBoundingClientRect();
        const cards = [...root.querySelectorAll("[data-library-gallery] [data-library-card]")];
        const boxes = cards.map((card) => card.getBoundingClientRect());
        const across = boxes.filter((box) => Math.abs(box.top - boxes[0]!.top) < 1).length;
        const fits = cards.every((card) => {
            const box = card.getBoundingClientRect();
            const inside = (el: Element) => {
                const r = el.getBoundingClientRect();
                return r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5;
            };
            const title = card.querySelector<HTMLElement>("[data-library-title]")!;
            // The wireframe's lines, the foot, the tags and the name: all inside the card, the name whole.
            return [...card.querySelectorAll("[data-query-wireframe] > [data-wire]")].every(inside) && inside(card.querySelector("[data-library-foot]")!)
                && [...card.querySelectorAll("[data-library-dim]")].every(inside) && title.scrollWidth <= title.clientWidth;
        });
        // Each card's foot, from its end to its card's: the same on every card, with tags or without.
        const feet = [...new Set(cards.map((card) => Math.round(card.getBoundingClientRect().bottom - card.querySelector("[data-library-foot]")!.getBoundingClientRect().bottom)))];
        const gallery = root.querySelector("[data-library-gallery]")!;
        return {
            across,
            card: [Math.round(boxes[0]!.width), Math.round(boxes[0]!.height)],
            apart: [across > 1 ? Math.round(boxes[1]!.left - boxes[0]!.right) : null, boxes[across] === undefined ? null : Math.round(boxes[across]!.top - boxes[0]!.bottom)],
            inset: [Math.round(boxes[0]!.left - main.left), Math.round(main.right - boxes[across - 1]!.right), Math.round(boxes[0]!.top - main.top)],
            fits,
            feet,
            sideways: gallery.scrollWidth > gallery.clientWidth + 1,
        };
    });
}

test.describe("Query library (#1761)", () => {
    test.describe("at the desktop width", { tag: "@desktop" }, () => {
        for (const theme of LAYOUT_THEMES) {
            test(`one borderless frame with no pane: a 44px toolbar row holding the rail then New query, over the cards (${theme})`, async ({ page }) => {
                const frame = await openLibrary(page, 1240, theme);
                await expect.poll(() => frame.evaluate((root) => {
                    const f = root.getBoundingClientRect();
                    const box = (name: string) => {
                        const r = root.querySelector(`[data-frame-slot="${name}"]`)!.getBoundingClientRect();
                        return [Math.round(r.left - f.left), Math.round(r.top - f.top), Math.round(r.width), Math.round(r.height)];
                    };
                    const style = getComputedStyle(root);
                    const rail = root.querySelector('[data-frame-slot="toolbar"] [data-toolbar-item="record-slices"]')!.getBoundingClientRect();
                    const action = root.querySelector("[data-query-library-new]")!.getBoundingClientRect();
                    return {
                        frames: root.parentElement!.querySelectorAll("[data-builder-frame]").length,
                        border: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
                        slots: [...root.querySelectorAll("[data-frame-slot]")].map((slot) => slot.getAttribute("data-frame-slot")),
                        toolbar: box("toolbar"), main: box("main"),
                        rail: [...root.querySelectorAll('[data-frame-slot="toolbar"] [data-record-slice-field]')].map((field) => field.textContent),
                        newAfterRail: rail.right <= action.left, action: Math.round(action.height),
                    };
                })).toEqual({
                    frames: 1,
                    border: ["0px", "0px", "0px", "0px"],
                    slots: ["toolbar", "body", "main"],
                    toolbar: [0, 0, 1240, 44], main: [0, 44, 1240, 676],
                    rail: ["Name", "Data source", "Tag", "Saved"],
                    newAfterRail: true, action: 28,
                });
            });
        }

        test("the saved queries a card each, in the order e3 pages them, as many across as fit: five in 1800px, three in 1240px, two in 846px, one in 560px — 12px apart, 20px in, 224px tall, each holding what it draws", async ({ page }) => {
            const frame = await openLibrary(page, 1240);
            await expect.poll(() => frame.evaluate((root) => [...root.querySelectorAll("[data-library-gallery] [data-library-card]")].map((card) => card.getAttribute("data-library-card")))).toEqual(NAMES);
            await expect.poll(() => grid(frame)).toEqual({ across: 3, card: [392, 224], apart: [12, 12], inset: [20, 20, 20], fits: true, feet: [11], sideways: false });
            for (const [width, across, card] of [[1800, 5, 342], [846, 2, 397], [560, 1, 520]] as const) {
                await frame.evaluate((root, px) => { (root as HTMLElement).style.width = `${px}px`; }, width);
                await settled(page);
                await expect.poll(() => grid(frame), { message: `${width}px` }).toEqual({
                    across, card: [card, 224], apart: [across > 1 ? 12 : null, 12], inset: [20, 20, 20], fits: true, feet: [11], sideways: false,
                });
            }
        });

        test("narrowed by the rail — its lines drawn again under the narrowing — the cards still follow the frame as it resizes (east-workspace#1772)", async ({ page }) => {
            const frame = await openLibrary(page, 1240);
            // The Tag field's search, its match chosen: the queries tagged sales.
            const editor = await recordField(page, frame, "tags");
            await editor.getByRole("combobox").fill("sales");
            await page.getByRole("option", { name: /^sales/ }).click();
            await page.keyboard.press("Escape");
            await expect(page.getByRole("dialog")).toHaveCount(0);
            await settled(page);
            await expect.poll(() => frame.evaluate((root) => root.querySelectorAll("[data-library-gallery] [data-library-card]").length)).toBe(3);
            for (const [width, across, card] of [[846, 2, 397], [1800, 5, 342], [560, 1, 520]] as const) {
                await frame.evaluate((root, px) => { (root as HTMLElement).style.width = `${px}px`; }, width);
                await settled(page);
                await expect.poll(() => frame.evaluate((root) => {
                    const line = root.querySelector<HTMLElement>("[data-library-gallery] [data-library-across]")!;
                    return [Number(line.dataset["libraryAcross"]), Math.round(root.querySelector("[data-library-gallery] [data-library-card]")!.getBoundingClientRect().width)];
                }), { message: `${width}px` }).toEqual([across, card]);
            }
        });

        test("the cards stand 20px in from each side whatever gutter the scrollbar keeps: none, where the bar overlays them as iOS's does, or Firefox's thin bar (east-workspace#1772)", async ({ page }) => {
            const frame = await openLibrary(page, 1240);
            for (const gutter of [0, 8]) {
                await page.addStyleTag({ content: `[data-library-gallery] *::-webkit-scrollbar { width: ${gutter}px !important; }` });
                await settled(page);
                await expect.poll(() => grid(frame), { message: `a ${gutter}px gutter` }).toEqual({
                    across: 3, card: [392, 224], apart: [12, 12], inset: [20, 20, 20], fits: true, feet: [11], sideways: false,
                });
            }
        });

        test("a card is its query's wireframe over its face: the source then a bar a step, four lines at most and the rest counted, 112px of sunken paper; the open query's card is the brand's", async ({ page }) => {
            const frame = await openLibrary(page, 1240);
            await expect.poll(() => frame.evaluate((root) => {
                const card = root.querySelector('[data-library-card="Top shipped orders, 2026"]')!;
                const media = card.querySelector("[data-library-media]")!.getBoundingClientRect();
                const wire = card.querySelector("[data-query-wireframe]")!;
                const edge = (name: string) => getComputedStyle(root.querySelector(`[data-library-card="${name}"]`)!).borderTopColor;
                return {
                    media: Math.round(media.height),
                    lines: [...wire.querySelectorAll("[data-wire]")].map((line) => [line.getAttribute("data-wire"), Math.round(line.getBoundingClientRect().height)]),
                    more: wire.lastElementChild!.textContent,
                    tags: [...card.querySelectorAll('[data-library-dim="tags"] > *')].map((tag) => tag.textContent),
                    byline: (card.querySelector("[data-library-byline]")!.textContent ?? "").startsWith("orders · 5 steps · up to 10 orders · saved "),
                    status: card.querySelector("[data-library-status]")!.textContent,
                    marked: [...root.querySelectorAll("[data-library-card][data-placed]")].map((el) => el.getAttribute("data-library-card")),
                    brand: edge("Top shipped orders, 2026") !== edge("Units by SKU"),
                };
            })).toEqual({
                media: 112,
                lines: [["source", 17], ["step", 17], ["step", 17], ["step", 17]],
                more: "+2 more",
                tags: ["sales", "weekly"],
                byline: true,
                status: "Open",
                marked: ["Top shipped orders, 2026"],
                brand: true,
            });
        });

        test("a press on a card asks the surface for its query, whose card is then the one marked; New query opens a menu of the bound data sources, and a pick asks for a new query on it", async ({ page }) => {
            const frame = await openLibrary(page, 1240);
            const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
            const asked = () => entry.evaluate((el) => [...el.querySelectorAll("*")].find((node) => node.children.length === 0 && /^Asked to open/.test(node.textContent ?? ""))?.textContent);
            await frame.locator('[data-library-card="Pump parts cost"]').click();
            await expect.poll(() => frame.evaluate((root) => [...root.querySelectorAll("[data-library-card][data-placed]")].map((el) => el.getAttribute("data-library-card")))).toEqual(["Pump parts cost"]);
            await expect.poll(asked).toBe("Asked to open in the builder: the saved query “Pump parts cost”");
            await frame.locator("[data-query-library-new]").click();
            await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent))).toEqual(["orders", "customers", "forecast", "model", "bom"]);
            await page.locator('[role="menuitem"]', { hasText: "bom" }).click();
            await expect.poll(asked).toBe("Asked to open in the builder: a new query on bom");
        });
    });

    test.describe("on a phone", { tag: "@mobile" }, () => {
        test("the frame is a phone's, and the cards stand one across, each holding what it draws, with nothing scrolling sideways", async ({ page }) => {
            const frame = await openLibrary(page);
            await expect.poll(async () => {
                const laid = await grid(frame);
                const phone = await frame.evaluate((root) => ({ phone: root.hasAttribute("data-phone"), page: document.documentElement.scrollWidth > document.documentElement.clientWidth }));
                return { ...phone, across: laid.across, height: laid.card[1], apart: laid.apart[1], inset: laid.inset, fits: laid.fits, feet: laid.feet, sideways: laid.sideways };
            }).toEqual({ phone: true, page: false, across: 1, height: 224, apart: 12, inset: [20, 20, 20], fits: true, feet: [11], sideways: false });
        });
    });
});
