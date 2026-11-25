/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Studio's page library, measured in a real browser (#997, #1762): one
 * `BuilderFrame`, borderless and with no pane — a 44px toolbar row holding
 * Pages · Templates, the rail and, after it, New page — over a grid of the
 * pages' cards. The grid holds as many cards across as fit at 300px each —
 * five in 1800px, three in 1240px, two in 846px, one in 560px and on a phone
 * — 12px apart and 20px in from the frame, each 224px tall with its layout's
 * wireframe, its title and its foot inside it, the foot at the card's end
 * whatever stands over it, in the order e3 pages them. Nothing says Live or
 * Draft. The open page's card is the brand's; Templates shows the templates,
 * a press on one opening New page from it; and a press on a page's card asks
 * the surface for it. Every measurement is polled until it holds, on a page at
 * rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-page-library --project desktop`.
 */

import { expect } from "playwright/test";
import { galleryGrid, openGallery } from "./gallery";
import { test } from "./kept-page";
import { settled } from "./settle";

const HASH = "e3/studio/studio/studioLibrary";

/** What a card's media draws: its layout's wireframe, a frame a placement. */
const CELLS = "[data-snap-grid-cell]";

/** The pages' titles, and the templates', in the order e3 pages them: each kind's in its keys' order. */
const PAGES = ["Ledger", "Rota", "Account detail", "Overview", "Regional rollup", "Weekly export"];
const TEMPLATES = ["Ops board", "Report brief", "Summary"];

test.describe("Studio page library (#997, #1762)", () => {
    test.describe("at the desktop width", () => {
        test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

        for (const theme of ["light", "dark"] as const) {
            test(`one borderless frame with no pane: a 44px toolbar row holding Pages · Templates, the rail and then New page, over the cards; nothing says Live or Draft (${theme})`, async ({ page }) => {
                const frame = await openGallery(page, HASH, 1240, theme);
                await expect.poll(() => frame.evaluate((root) => {
                    const f = root.getBoundingClientRect();
                    const box = (name: string) => {
                        const r = root.querySelector(`[data-frame-slot="${name}"]`)!.getBoundingClientRect();
                        return [Math.round(r.left - f.left), Math.round(r.top - f.top), Math.round(r.width), Math.round(r.height)];
                    };
                    const style = getComputedStyle(root);
                    const views = root.querySelector('[data-frame-slot="toolbar"] [data-studio-library-seg="view"]')!;
                    const rail = root.querySelector('[data-frame-slot="toolbar"] [data-toolbar-item="record-slices"]')!.getBoundingClientRect();
                    const action = root.querySelector("[data-page-library-new]")!.getBoundingClientRect();
                    return {
                        border: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
                        slots: [...root.querySelectorAll("[data-frame-slot]")].map((slot) => slot.getAttribute("data-frame-slot")),
                        toolbar: box("toolbar"), main: box("main"),
                        views: [...views.querySelectorAll('[role="radio"]')].map((radio) => [radio.textContent, radio.getAttribute("aria-checked")]),
                        viewsFirst: views.getBoundingClientRect().right <= rail.left,
                        rail: [...root.querySelectorAll('[data-frame-slot="toolbar"] [data-record-slice-field]')].map((field) => field.textContent),
                        newAfterRail: rail.right <= action.left, action: Math.round(action.height),
                        status: /\b(Live|Draft)\b/.test(root.textContent ?? ""),
                    };
                })).toEqual({
                    border: ["0px", "0px", "0px", "0px"],
                    slots: ["toolbar", "body", "main"],
                    toolbar: [0, 0, 1240, 44], main: [0, 44, 1240, 676],
                    views: [["Pages", "true"], ["Templates", "false"]], viewsFirst: true,
                    rail: ["Name", "Project", "Tag"],
                    newAfterRail: true, action: 28,
                    status: false,
                });
            });
        }

        test("the pages a card each, in the order e3 pages them, as many across as fit: five in 1800px, three in 1240px, two in 846px, one in 560px — 12px apart, 20px in, 224px tall, each holding what it draws", async ({ page }) => {
            const frame = await openGallery(page, HASH, 1240);
            await expect.poll(() => frame.evaluate((root) => [...root.querySelectorAll("[data-library-gallery] [data-library-title]")].map((title) => title.textContent))).toEqual(PAGES);
            await expect.poll(() => galleryGrid(frame, CELLS)).toEqual({ across: 3, card: [392, 224], apart: [12, 12], inset: [20, 20, 20], fits: true, feet: [11], sideways: false });
            for (const [width, across, card] of [[1800, 5, 342], [846, 2, 397], [560, 1, 520]] as const) {
                await frame.evaluate((root, px) => { (root as HTMLElement).style.width = `${px}px`; }, width);
                await settled(page);
                await expect.poll(() => galleryGrid(frame, CELLS), { message: `${width}px` }).toEqual({
                    across, card: [card, 224], apart: [across > 1 ? 12 : null, 12], inset: [20, 20, 20], fits: true, feet: [11], sideways: false,
                });
            }
        });

        test("a page's card is its layout's wireframe over its face: 112px of sunken paper, a frame a placement; its title, what it places, its tags, and its project and components; the open page's card is the brand's", async ({ page }) => {
            const frame = await openGallery(page, HASH, 1240);
            await expect.poll(() => frame.evaluate((root) => {
                const card = [...root.querySelectorAll("[data-library-card]")].find((el) => el.querySelector("[data-library-title]")!.textContent === "Overview")!;
                const media = card.querySelector("[data-library-media]")!;
                const part = (name: string) => card.querySelector(`[data-library-${name}]`)?.textContent;
                const marked = [...root.querySelectorAll("[data-library-card][data-placed]")];
                return {
                    media: Math.round(media.getBoundingClientRect().height), cells: media.querySelectorAll("[data-snap-grid-cell]").length,
                    sublabel: part("sublabel"), byline: part("byline"), action: part("action"),
                    tags: [...card.querySelectorAll('[data-library-dim="tags"] > *')].map((tag) => tag.textContent),
                    marked: marked.map((el) => el.querySelector("[data-library-title]")!.textContent),
                    status: marked[0]?.querySelector("[data-library-status]")?.textContent,
                    brand: marked[0] !== undefined && getComputedStyle(marked[0]).borderTopColor !== getComputedStyle(card).borderTopColor,
                };
            })).toEqual({
                media: 112, cells: 4,
                sublabel: "KPI rail · Revenue trend · Breakdown bars · Assignment board", byline: "Ops console · 4 components", action: "Open in builder →",
                tags: ["operations", "weekly"],
                marked: ["Account detail"], status: "Open", brand: true,
            });
        });

        test("Templates shows the templates — the rail its own — and a press on one opens New page from it: the project offered, and tags", async ({ page }) => {
            const frame = await openGallery(page, HASH, 1240);
            await frame.getByRole("radio", { name: "Templates" }).click();
            await expect.poll(() => frame.evaluate((root) => [...root.querySelectorAll("[data-library-gallery] [data-library-title]")].map((title) => title.textContent))).toEqual(TEMPLATES);
            await expect.poll(() => galleryGrid(frame, CELLS)).toEqual({ across: 3, card: [392, 224], apart: [12, null], inset: [20, 20, 20], fits: true, feet: [11], sideways: false });
            await expect.poll(() => frame.evaluate((root) => ({
                rail: [...root.querySelectorAll('[data-frame-slot="toolbar"] [data-record-slice-field]')].map((field) => field.textContent),
                actions: [...new Set([...root.querySelectorAll("[data-library-action]")].map((action) => action.textContent))],
            }))).toEqual({ rail: ["Name"], actions: ["Start a page →"] });
            await frame.locator("[data-library-card]").filter({ hasText: "Summary" }).click();
            await expect.poll(() => page.evaluate(() => {
                const content = document.querySelector('[data-scope="popover"][data-part="content"][data-state="open"]');
                if (content === null) return null;
                return {
                    from: content.querySelector("[data-page-library-from]")?.textContent,
                    fields: [...content.querySelectorAll("[data-page-library-form] [data-field]")].map((field) => field.getAttribute("data-editor")),
                    project: content.querySelector<HTMLInputElement>("[data-page-library-form] [data-field][data-editor=text] input")?.value,
                };
            })).toEqual({ from: "Starts from Summary.", fields: ["text", "tags"], project: "Ops console" });
            await page.keyboard.press("Escape");
            await frame.getByRole("radio", { name: "Pages" }).click();
            await expect.poll(() => frame.evaluate((root) => root.querySelectorAll("[data-library-gallery] [data-library-card]").length)).toBe(PAGES.length);
        });

        test("a press on a page's card asks the surface for it, whose card is then the one marked", async ({ page }) => {
            const frame = await openGallery(page, HASH, 1240);
            const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
            await frame.locator("[data-library-card]").filter({ hasText: "Regional rollup" }).click();
            await expect.poll(() => frame.evaluate((root) => [...root.querySelectorAll("[data-library-card][data-placed] [data-library-title]")].map((title) => title.textContent))).toEqual(["Regional rollup"]);
            await expect.poll(() => entry.evaluate((el) => [...el.querySelectorAll("*")].find((node) => node.children.length === 0 && /^Open in the builder:/.test(node.textContent ?? ""))?.textContent))
                .toBe("Open in the builder: Regional rollup, in Ops console");
        });
    });

    test.describe("on a phone", () => {
        test.skip(({ viewport }) => (viewport?.width ?? 0) > 560, "measured at a phone's width");

        test("the frame is a phone's, and the cards stand one across, each holding what it draws, with nothing scrolling sideways", async ({ page }) => {
            const frame = await openGallery(page, HASH);
            await expect.poll(async () => {
                const laid = await galleryGrid(frame, CELLS);
                const phone = await frame.evaluate((root) => ({ phone: root.hasAttribute("data-phone"), page: document.documentElement.scrollWidth > document.documentElement.clientWidth }));
                return { ...phone, across: laid.across, height: laid.card[1], apart: laid.apart[1], inset: laid.inset, fits: laid.fits, feet: laid.feet, sideways: laid.sideways };
            }).toEqual({ phone: true, page: false, across: 1, height: 224, apart: 12, inset: [20, 20, 20], fits: true, feet: [11], sideways: false });
        });
    });
});
