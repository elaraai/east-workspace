/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Flowchart in its frame, measured in a real browser (#1245, `Flowchart
 * Builder Spec.md` §7, §7.1, §8, FB7–FB11), on the parcel depot's flowchart
 * over the host's tables: a borderless `BuilderFrame` filling the box its
 * example gives it — one 44px toolbar row, the canvas filling main, the
 * inspector at main's end (#1250) — on by default, and at the example's width
 * its 44px rail, the frame too narrow to pin it beside main — the footer's
 * counts along the foot — and no eyebrow of the canvas's own. The
 * toolbar folds by one ladder, the slice's rail first, then the freshness
 * chip goes, LR · TD folds into its chip and find state into its icon: one
 * row at every width from 1440px to 320px, nothing past its edge, a narrower
 * row never folding less. The canvas scrolls both ways inside main under the
 * viewer's wheel, its lanes running main's whole height, the toolbar and the
 * footer staying put; over the host's tables with no `onApply` it edits nothing
 * — no "+ LANE", no lane's ×, no history item (#1247); find
 * state's query, typed a key at a time, finds a state by its label, and a
 * pick selects it and scrolls it into the canvas's view. In both themes; on a
 * phone the row holds every item, folded — LR · TD's chip with Font Awesome's
 * caret, sized by the chip recipe — and on a touch screen 1920px wide every
 * item unfolded. Every measurement is polled until it holds, on a page at
 * rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test flowchart-frame --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

const HASH = "e3/flowchart/flowchart/flowchartDepot";

/** The fold ladder: the rail's four steps, then the freshness chip, LR · TD and find state. */
const LADDER = "rail>1 rail>2 rail>3 rail>4 freshness>1 orientation>1 seek>1";

/** Open the depot's flowchart, at rest, and return its root: the box its frame fills. */
async function openDepot(page: Page, theme: "light" | "dark" = "light"): Promise<Locator> {
    await page.goto(`/?theme=${theme}#${HASH}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-builder-frame] [data-flowchart-node]").first()).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return entry.locator("[data-flowchart-root]").first();
}

/** Size the flowchart's box — its width, and its height when given — and wait for the page to be at rest. */
async function sizeTo(page: Page, root: Locator, width: number, height?: number): Promise<void> {
    await root.evaluate((el, [w, h]) => {
        (el as HTMLElement).style.width = `${w}px`;
        if (h !== undefined) (el as HTMLElement).style.height = `${h}px`;
    }, [width, height] as const);
    await settled(page);
}

/** What the toolbar says of itself: each item's form, the ladder, how many steps it took, and what runs past its row. */
function toolbarOf(root: Locator) {
    return root.evaluate((el) => {
        const band = el.querySelector("[data-frame-slot='toolbar']")!;
        const bar = band.querySelector("[data-toolbar]")!;
        const b = band.getBoundingClientRect();
        const row = bar.getBoundingClientRect();
        const past = [...bar.querySelectorAll("[data-toolbar-item]")].flatMap((item) => {
            const r = item.getBoundingClientRect();
            if (r.width === 0) return [];
            const key = item.getAttribute("data-toolbar-item");
            const out: string[] = [];
            if (r.right > row.right + 0.5) out.push(`${key} ends past the row`);
            if (r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5) out.push(`${key} out of the band`);
            return out;
        });
        return {
            band: Math.round(b.height),
            rows: band.querySelectorAll("[data-toolbar]").length,
            state: bar.getAttribute("data-toolbar-state") ?? "",
            ladder: bar.getAttribute("data-toolbar-ladder") ?? "",
            folds: Number(bar.getAttribute("data-toolbar-folds")),
            row: row.width,
            past,
        };
    });
}

test.describe("The Flowchart's frame (#1245)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width; the phone's below");

    for (const theme of ["light", "dark"] as const) {
        test(`a borderless frame filling its box: one 44px toolbar row, the canvas filling main, the inspector's rail at its end, the footer along the foot, no eyebrow (${theme})`, async ({ page }) => {
            const root = await openDepot(page, theme);
            await expect.poll(() => root.evaluate((el) => {
                const round = (n: number) => Math.round(n * 10) / 10;
                const frame = el.querySelector("[data-builder-frame]")!;
                const host = el.parentElement!.getBoundingClientRect();
                const r = el.getBoundingClientRect();
                const f = frame.getBoundingClientRect();
                const at = (sel: string) => {
                    const b = frame.querySelector(sel)!.getBoundingClientRect();
                    return [round(b.left - f.left), round(b.top - f.top), round(b.width), round(b.height)];
                };
                const border = (s: CSSStyleDeclaration) => [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth];
                return {
                    // The root fills the example's box, and the frame the root.
                    root: [r.left - host.left, r.top - host.top, r.width - host.width, r.height - host.height].map(round),
                    frame: [f.left - r.left, f.top - r.top, f.width - r.width, f.height - r.height].map(round),
                    border: [...border(getComputedStyle(el)), ...border(getComputedStyle(frame))],
                    toolbar: at("[data-frame-slot='toolbar']"),
                    rows: frame.querySelectorAll("[data-frame-slot='toolbar'] [data-toolbar]").length,
                    main: at("[data-frame-slot='main']"),
                    // The canvas is main's whole box.
                    body: at("[data-frame-slot='main'] > [data-flowchart-body]"),
                    footer: at("[data-frame-slot='footer']"),
                    eyebrows: el.querySelectorAll("[data-flowchart-eyebrow]").length,
                    // Read only: no gesture's control, and no history item (#1247).
                    gestures: el.querySelectorAll("[data-flowchart-addlane], [data-flowchart-lane-delete], [data-flowchart-band], [data-toolbar-item='history']").length,
                    w: round(f.width),
                    h: round(f.height),
                };
            })).toEqual(expect.objectContaining({ root: [0, 0, 0, 0], frame: [0, 0, 0, 0], border: Array.from({ length: 8 }, () => "0px"), rows: 1, eyebrows: 0, gestures: 0 }));
            const read = await root.evaluate((el) => {
                const f = el.querySelector("[data-builder-frame]")!.getBoundingClientRect();
                const at = (sel: string) => {
                    const b = el.querySelector(sel)!.getBoundingClientRect();
                    return [Math.round(b.left - f.left), Math.round(b.top - f.top), Math.round(b.width), Math.round(b.height)];
                };
                return {
                    w: Math.round(f.width), h: Math.round(f.height), toolbar: at("[data-frame-slot='toolbar']"), main: at("[data-frame-slot='main']"),
                    body: at("[data-flowchart-body]"), end: at("[data-frame-slot='end']"), footer: at("[data-frame-slot='footer']"),
                    mode: el.querySelector("[data-frame-slot='end']")!.getAttribute("data-pane-mode"),
                };
            });
            expect(read.toolbar).toEqual([0, 0, read.w, 44]);
            expect(read.footer).toEqual([0, read.h - 38, read.w, 38]);
            // The inspector, on by default (#1250): too narrow a frame to pin it beside main, its 44px rail at main's end.
            expect([read.mode, read.end]).toEqual(["overlay", [read.w - 44, 44, 44, read.h - 44 - 38]]);
            expect(read.main).toEqual([0, 44, read.w - 44, read.h - 44 - 38]);
            expect(read.body).toEqual(read.main);
        });

        test(`the toolbar folds by one ladder — the rail first, then the freshness chip, LR · TD into its chip, find state into its icon — one row at every width from 1440px to 320px, nothing past its edge (${theme})`, async ({ page }) => {
            const root = await openDepot(page, theme);
            const seen: { row: number; folds: number }[] = [];
            for (const width of [1440, 1200, 1000, 800, 640, 480, 400, 360, 320]) {
                await sizeTo(page, root, width);
                const bar = await toolbarOf(root);
                expect(bar.ladder).toBe(LADDER);
                expect([bar.band, bar.rows, bar.past], `at ${width}px`).toEqual([44, 1, []]);
                // What it folded is the ladder's first steps: each item at the form they put it.
                const steps = LADDER.split(" ").slice(0, bar.folds);
                for (const part of bar.state.split(";")) {
                    const [key, of] = part.split("=");
                    expect(Number(of!.split("/")[0]), `at ${width}px: ${key}`).toBe(steps.filter((s) => s.startsWith(`${key}>`)).length);
                }
                seen.push({ row: bar.row, folds: bar.folds });
            }
            // Unfolded with room, every step taken at the narrowest — and a narrower row never folds less.
            expect(seen[0]!.folds).toBe(0);
            expect(seen[seen.length - 1]!.folds).toBe(LADDER.split(" ").length);
            for (let i = 1; i < seen.length; i++) expect(seen[i]!.folds).toBeGreaterThanOrEqual(seen[i - 1]!.folds);
        });
    }

    test("the canvas scrolls both ways inside main, its lanes running main's whole height; the toolbar and the footer stay put", async ({ page }) => {
        const root = await openDepot(page);
        // At rest, the lanes run main's whole height.
        await expect.poll(() => root.evaluate((el) => {
            const scroll = el.querySelector("[data-flowchart-scroll]")!;
            return Math.round(el.querySelector("[data-flowchart-canvas]")!.getBoundingClientRect().height) - scroll.clientHeight;
        })).toBe(0);
        await sizeTo(page, root, 480, 360);
        const before = await root.evaluate((el) => {
            const scroll = el.querySelector("[data-flowchart-scroll]") as HTMLElement;
            const at = (sel: string) => JSON.stringify(el.querySelector(sel)!.getBoundingClientRect());
            return {
                wide: scroll.scrollWidth > scroll.clientWidth, tall: scroll.scrollHeight > scroll.clientHeight,
                toolbar: at("[data-frame-slot='toolbar']"), footer: at("[data-frame-slot='footer']"), main: at("[data-frame-slot='main']"),
            };
        });
        expect([before.wide, before.tall]).toEqual([true, true]);
        // The viewer's wheel scrolls it, down and across.
        const view = (await root.locator("[data-flowchart-scroll]").boundingBox())!;
        await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
        await page.mouse.wheel(0, 400);
        await page.mouse.wheel(400, 0);
        await expect.poll(() => root.locator("[data-flowchart-scroll]").evaluate((el) => el.scrollLeft > 0 && el.scrollTop > 0)).toBe(true);
        await settled(page);
        const after = await root.evaluate((el) => {
            const scroll = el.querySelector("[data-flowchart-scroll]") as HTMLElement;
            const at = (sel: string) => JSON.stringify(el.querySelector(sel)!.getBoundingClientRect());
            return {
                scrolled: scroll.scrollLeft > 0 && scroll.scrollTop > 0,
                toolbar: at("[data-frame-slot='toolbar']"), footer: at("[data-frame-slot='footer']"), main: at("[data-frame-slot='main']"),
                page: document.scrollingElement!.scrollWidth - window.innerWidth,
            };
        });
        expect(after.scrolled).toBe(true);
        expect([after.toolbar, after.footer, after.main]).toEqual([before.toolbar, before.footer, before.main]);
        expect(after.page).toBeLessThanOrEqual(1);
    });

    test("find state: a query typed a key at a time finds a state by its label, and a pick selects it and scrolls it into the canvas's view", async ({ page }) => {
        const root = await openDepot(page);
        await sizeTo(page, root, 520, 400);
        const box = root.locator("[data-toolbar-item='seek'] input");
        await box.pressSequentially("dispatch");
        await expect(box).toHaveValue("dispatch");
        await page.getByRole("option", { name: "DSP · Dispatched" }).click();
        const node = root.locator("[data-flowchart-node='DSP']");
        await expect(node).toHaveAttribute("data-selected", "true");
        await expect.poll(() => root.evaluate((el) => {
            const view = el.querySelector("[data-flowchart-scroll]")!.getBoundingClientRect();
            const n = el.querySelector("[data-flowchart-node='DSP']")!.getBoundingClientRect();
            return n.left >= view.left && n.right <= view.right && n.top >= view.top && n.bottom <= view.bottom;
        })).toBe(true);
    });
});

test.describe("The Flowchart's frame on a phone and on a touch screen (#1245)", () => {
    test.skip(({ isMobile }) => !isMobile, "the phone projects");

    for (const theme of ["light", "dark"] as const) {
        test(`on the phone the row holds every item, folded — the rail's icon, LR · TD's chip, its caret Font Awesome's, find state's icon — in its 44px band, nothing past its edge (${theme})`, async ({ page }) => {
            const root = await openDepot(page, theme);
            const bar = await toolbarOf(root);
            expect([bar.band, bar.rows, bar.past]).toEqual([44, 1, []]);
            expect(bar.ladder).toBe(LADDER);
            expect(bar.state).toBe("seek=1/2;orientation=1/2;freshness=1/2;rail=4/5");
            for (const control of ["[data-toolbar-item='rail'] [data-slot='railTrigger']", "[data-flowchart-segmenu]", "[data-toolbar-item='seek'] [data-key-search='icon']"]) {
                await expect(root.locator(control)).toBeVisible();
            }
            // LR · TD's chip: its caret Font Awesome's solid caret-down (#1246), the chip recipe sizing it —
            // 8px tall, and its own width, never Font Awesome's fixed 1.25em, so the chip is no wider than a glyph made it.
            const caret = root.locator("[data-flowchart-segmenu] [data-chip-caret] svg");
            await expect(caret).toHaveCount(1);
            expect(await caret.evaluate((svg) => {
                const box = svg.getBoundingClientRect();
                return [svg.getAttribute("data-prefix"), svg.getAttribute("data-icon"), Math.round(box.height), Math.round(box.width)];
            })).toEqual(["fas", "caret-down", 8, 5]);
        });

        test(`on a touch screen 1920px wide the row holds every item unfolded, in its 44px band, nothing past its edge (${theme})`, async ({ page }) => {
            await page.setViewportSize({ width: 1920, height: 1000 });
            const root = await openDepot(page, theme);
            const bar = await toolbarOf(root);
            expect([bar.band, bar.rows, bar.past, bar.folds]).toEqual([44, 1, [], 0]);
            expect(bar.ladder).toBe(LADDER);
        });
    }
});
