/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Sheet builder, measured in a real browser (#1184, `Sheet Builder Spec.md`
 * §7, §8, SB18–SB24), on the joinery workshop's orders: a borderless
 * `BuilderFrame` filling the box its example gives it — one 44px toolbar row,
 * the library and the inspector beside main, the grid filling main with the
 * strip docked under it, and the sheet's footer along the foot. The toolbar
 * folds by one ladder, the slice's rail first, then the sheet's own steps,
 * the history item last, and stays one row at every width from 1440px to
 * 360px. The panes are pinned beside main while main keeps 480px, overlaid on
 * their rails past that, and under a scrim at 560px and narrower, which a
 * click — on a phone, a tap — closes. The library (#1186): its tabs, each
 * with its count, and its cards' anatomy in the 272px pane; a hidden
 * column's card dimmed, and the column out of the grid. In both themes;
 * every measurement is polled until it holds, on a page at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test sheet-builder --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";
import { frameAt, tapScrim, type Box } from "./builder-frame";

const HASH = "e3/sheet/sheet-builder/sheetBuilderWorkshop";

/** The fold ladder: the rail's four steps, the view tabs' strip closing up, the history item to its buttons. */
const LADDER = "rail>1 rail>2 rail>3 rail>4 tabs>1 tabs>2 tabs>3 history>1";

/**
 * Open the workshop's builder and return the box its example gives it, at
 * rest: as wide as given, or, with `null`, as the page lays it out.
 */
async function openBuilder(page: Page, theme: "light" | "dark" = "light", width: number | null = 1440): Promise<Locator> {
    await page.goto(`/?theme=${theme}#${HASH}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-builder-frame] [data-sheet-card]")).toBeVisible({ timeout: 20_000 });
    const box = entry.locator("[data-builder-frame]").first().locator("xpath=..");
    if (width !== null) await sizeTo(page, box, width);
    await settled(page);
    return box;
}

/** Set the builder's box to a width, and wait for the page to be at rest. */
async function sizeTo(page: Page, box: Locator, width: number): Promise<void> {
    await box.evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, width);
    await settled(page);
}

/** A difference of boxes' edges, to a tenth of a pixel — subtraction leaves float noise. */
const tenth = (n: number) => Math.round(n * 10) / 10;

/** A box's place within another, to a tenth of a pixel. */
const within = (box: Box, frame: Box): Box => ({ x: tenth(box.x - frame.x), y: tenth(box.y - frame.y), w: box.w, h: box.h });

/** Each toolbar item's form, in the row's order, as the toolbar says it folded them. */
function formsOf(state: string): Map<string, number> {
    return new Map(state.split(";").map((item) => {
        const [key, form] = item.split("=");
        return [key!, Number(form!.split("/")[0])];
    }));
}

/** The forms the first `n` steps of the ladder leave. */
function ladderForms(n: number, keys: readonly string[]): Map<string, number> {
    const forms = new Map(keys.map((key) => [key, 0]));
    for (const step of LADDER.split(" ").slice(0, n)) {
        const [key, to] = step.split(">");
        forms.set(key!, Number(to));
    }
    return forms;
}

test.describe("Sheet builder (#1184)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    for (const theme of ["light", "dark"] as const) {
        test(`a borderless frame filling its box: one 44px toolbar row, the library 272px and the inspector 320px pinned beside main, the grid filling main, the footer along the foot (${theme})`, async ({ page }) => {
            const box = await openBuilder(page, theme, null);
            // As the page lays it out: the frame is its box, whatever the box's width.
            await expect.poll(() => box.evaluate((el) => {
                const frame = el.querySelector("[data-builder-frame]")!;
                const b = el.getBoundingClientRect();
                const f = frame.getBoundingClientRect();
                return [tenthOf(f.left - b.left), tenthOf(f.top - b.top), tenthOf(f.width - b.width), tenthOf(f.height - b.height)];
                function tenthOf(n: number) { return Math.round(n * 10) / 10; }
            })).toEqual([0, 0, 0, 0]);

            await sizeTo(page, box, 1440);
            await expect.poll(() => box.evaluate((el) => {
                const frame = el.querySelector("[data-builder-frame]")!;
                const r = frame.getBoundingClientRect();
                const at = (sel: string) => {
                    const b = frame.querySelector(sel)!.getBoundingClientRect();
                    return [Math.round(b.left - r.left), Math.round(b.top - r.top), Math.round(b.width), Math.round(b.height)];
                };
                const style = getComputedStyle(frame);
                // The theme's surface, as the page resolves it.
                const probe = document.createElement("div");
                probe.style.background = "var(--chakra-colors-bg-surface)";
                document.body.appendChild(probe);
                const surface = getComputedStyle(probe).backgroundColor;
                probe.remove();
                const footer = frame.querySelector("[data-frame-slot=footer]")!.getBoundingClientRect();
                return {
                    border: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
                    surface: style.backgroundColor === surface,
                    toolbar: at("[data-frame-slot=toolbar]"), rows: frame.querySelectorAll("[data-frame-slot=toolbar] [data-toolbar]").length,
                    start: at("[data-frame-slot=start]"), end: at("[data-frame-slot=end]"),
                    mainFromStart: Math.round(frame.querySelector("[data-frame-slot=main]")!.getBoundingClientRect().left - frame.querySelector("[data-frame-slot=start]")!.getBoundingClientRect().right),
                    // The grid fills main.
                    sheetIsMain: JSON.stringify(at("[data-frame-slot=main] > [data-sheet]")) === JSON.stringify(at("[data-frame-slot=main]")),
                    footerAtFoot: [Math.round(footer.bottom - r.bottom), Math.round(footer.width)],
                    // Main holds no toolbar row (each library tab keeps its search band, in the pane).
                    grids: frame.querySelectorAll("[data-frame-slot=main] [data-slot=toolbar], [data-frame-slot=main] [data-toolbar]").length,
                };
            })).toEqual({
                border: ["0px", "0px", "0px", "0px"],
                surface: true,
                toolbar: [0, 0, 1440, 44], rows: 1,
                start: [0, 44, 272, expect.any(Number)], end: [1120, 44, 320, expect.any(Number)],
                mainFromStart: 0,
                sheetIsMain: true,
                footerAtFoot: [0, 1440],
                // The grid draws no toolbar of its own.
                grids: 0,
            });
        });
    }

    test("the toolbar folds by one ladder — the rail first, the sheet's steps, the history item last — one 44px row at every width from 1440px to 360px", async ({ page }) => {
        const box = await openBuilder(page);
        const toolbar = box.locator("[data-builder-frame] > [data-frame-slot=toolbar] [data-toolbar]");
        await expect.poll(() => toolbar.getAttribute("data-toolbar-ladder")).toBe(LADDER);
        let folded = 0;
        let narrowest = new Map<string, number>();
        for (const width of [1440, 1280, 1024, 900, 768, 640, 560, 480, 420, 360]) {
            await sizeTo(page, box, width);
            const at = await toolbar.evaluate((row) => {
                const band = row.closest("[data-frame-slot=toolbar]")!.getBoundingClientRect();
                const items = [...row.children].map((el) => el.getBoundingClientRect());
                return {
                    state: row.getAttribute("data-toolbar-state") ?? "",
                    folds: Number(row.getAttribute("data-toolbar-folds")),
                    band: Math.round(band.height),
                    // No item wraps to a second row, or out of the band; nothing scrolls.
                    inBand: items.every((b) => b.top >= band.top && b.bottom <= band.bottom),
                    scrolls: row.scrollWidth > row.clientWidth + 0.5,
                    // The row's items fit beside each other in it.
                    fits: items.every((b) => b.right <= band.right + 0.5),
                };
            });
            const forms = formsOf(at.state);
            expect({ width, band: at.band, inBand: at.inBand, scrolls: at.scrolls, fits: at.fits })
                .toEqual({ width, band: 44, inBand: true, scrolls: false, fits: true });
            // What has folded is the ladder's first steps, and no fewer than at a wider frame.
            expect([...forms]).toEqual([...ladderForms(at.folds, [...forms.keys()])]);
            expect(at.folds).toBeGreaterThanOrEqual(folded);
            folded = at.folds;
            narrowest = forms;
        }
        // At 360px the rail is down to its icon, as far as it folds, and the row still fits.
        expect(narrowest.get("rail")).toBe(4);
    });

    test("main holds the grid and, docked under it, the strip while a cell is edited", async ({ page }) => {
        const box = await openBuilder(page);
        await box.locator("[data-frame-slot=main] [data-slot='row'] [data-key='start']").first().dblclick();
        await expect.poll(() => box.evaluate((el) => {
            const main = el.querySelector("[data-frame-slot=main]")!.getBoundingClientRect();
            const card = el.querySelector("[data-frame-slot=main] [data-sheet-card]")!.getBoundingClientRect();
            const strip = el.querySelector("[data-frame-slot=main] [data-slot=strip]");
            if (strip === null) return null;
            const s = strip.getBoundingClientRect();
            return { underCard: Math.round(s.top - card.bottom), atFoot: Math.round(main.bottom - s.bottom), width: Math.round(s.width - main.width) };
        })).toEqual({ underCard: 0, atFoot: 0, width: 0 });
    });

    test("the panes are pinned beside main while main keeps 480px; past that the inspector rests on its rail; at 560px and narrower both do, and an opened pane floats over main under the scrim, which a click closes", async ({ page }) => {
        const box = await openBuilder(page);
        await expect.poll(async () => {
            const at = await frameAt(box);
            return { start: [at.start!.mode, at.start!.collapsed], end: [at.end!.mode, at.end!.collapsed], scrim: at.scrim };
        }).toEqual({ start: ["pinned", false], end: ["pinned", false], scrim: null });

        // 900px: the library and main's 480px leave no room for the inspector open.
        await sizeTo(page, box, 900);
        await expect.poll(async () => {
            const at = await frameAt(box);
            return { start: [at.start!.mode, at.start!.collapsed], end: [at.end!.mode, at.end!.collapsed, at.end!.slot.w] };
        }).toEqual({ start: ["pinned", false], end: ["overlay", true, 44] });

        await sizeTo(page, box, 560);
        const rest = await frameAt(box);
        expect({ start: [rest.start!.mode, rest.start!.collapsed, rest.start!.slot.w], end: [rest.end!.mode, rest.end!.collapsed, rest.end!.slot.w], scrim: rest.scrim })
            .toEqual({ start: ["overlay", true, 44], end: ["overlay", true, 44], scrim: null });
        const mainAtRest = within(rest.main, rest.body);
        await box.getByRole("button", { name: "Expand Library" }).click();
        await expect.poll(async () => {
            const at = await frameAt(box);
            const sheet = within(at.start!.sheet, at.body);
            return {
                open: !at.start!.collapsed, main: within(at.main, at.body),
                fromEdge: sheet.x, overMain: sheet.x + sheet.w > mainAtRest.x, height: [sheet.y, sheet.h],
                scrim: at.scrim === null ? null : within(at.scrim, at.body), ink: at.ink.scrim === at.ink.backdrop,
            };
        }).toEqual({ open: true, main: mainAtRest, fromEdge: 0, overMain: true, height: [0, rest.body.h], scrim: mainAtRest, ink: true });
        // A click on the scrim, past the pane's edge, closes it.
        const scrim = box.locator("[data-scrim]");
        const scrimBox = (await scrim.boundingBox())!;
        await scrim.click({ position: { x: scrimBox.width - 12, y: scrimBox.height / 2 } });
        await expect.poll(async () => {
            const at = await frameAt(box);
            return { collapsed: at.start!.collapsed, scrim: at.scrim };
        }).toEqual({ collapsed: true, scrim: null });
    });
});

test.describe("Sheet builder — the library pane (#1186)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    for (const theme of ["light", "dark"] as const) {
        test(`the library: three tabs, each its name and count; cards that fit the 272px pane — the name 13px 600, the line under it mono 10px — under mono caps group heads; collapsed, a 44px rail with the templates' count (${theme})`, async ({ page }) => {
            const box = await openBuilder(page, theme);
            const pane = box.locator("[data-builder-frame] [data-frame-slot=start]");
            await expect.poll(() => pane.evaluate((el) => {
                // The theme's tokens, as the page resolves them.
                const resolve = (property: "color" | "fontFamily", token: string) => {
                    const probe = document.createElement("span");
                    probe.style[property] = `var(${token})`;
                    document.body.appendChild(probe);
                    const resolved = getComputedStyle(probe)[property];
                    probe.remove();
                    return resolved;
                };
                const quiet = resolve("color", "--chakra-colors-fg-subtle");
                const mono = resolve("fontFamily", "--chakra-fonts-mono");
                const paneBox = el.getBoundingClientRect();
                const tabs = [...el.querySelectorAll('[role="tab"]')].map((tab) => {
                    const count = tab.querySelector("[data-tab-count]")!;
                    const name = document.createRange();
                    name.selectNodeContents(tab.firstChild!);
                    const t = getComputedStyle(tab);
                    const c = getComputedStyle(count);
                    return {
                        text: tab.textContent,
                        name: [t.fontFamily === mono, t.fontSize, t.fontWeight, t.textTransform],
                        count: [c.fontWeight, c.letterSpacing, c.color === quiet],
                        gap: Math.round(count.getBoundingClientRect().left - name.getBoundingClientRect().right),
                    };
                });
                const panel = el.querySelector('[role="tabpanel"]:not([hidden])')!;
                const card = panel.querySelector("[data-library-item]")!;
                const body = card.querySelector(":scope > div")!;
                const label = getComputedStyle(body.children[0]!);
                const line = getComputedStyle(body.children[1]!);
                const head = getComputedStyle(panel.querySelector("[data-library-head] > span")!);
                const cards = [...panel.querySelectorAll("[data-library-item]")].map((c) => c.getBoundingClientRect());
                return {
                    width: Math.round(paneBox.width),
                    tabs,
                    label: [label.fontSize, label.fontWeight],
                    line: [line.fontFamily === mono, line.fontSize, line.color === quiet],
                    head: [head.fontFamily === mono, head.fontSize, head.fontWeight, head.textTransform],
                    // Every card inside the pane, none wider than it.
                    fit: cards.every((c) => c.left >= paneBox.left && c.right <= paneBox.right),
                };
            })).toEqual({
                width: 272,
                tabs: [
                    { text: "Rows 11", name: [true, "10.5px", "600", "uppercase"], count: ["500", "0.42px", true], gap: 7 },
                    { text: "Registers 29", name: [true, "10.5px", "600", "uppercase"], count: ["500", "0.42px", true], gap: 7 },
                    { text: "Columns 6", name: [true, "10.5px", "600", "uppercase"], count: ["500", "0.42px", true], gap: 7 },
                ],
                label: ["13px", "600"],
                line: [true, "10px", true],
                head: [true, "10px", "600", "uppercase"],
                fit: true,
            });
            await box.getByRole("button", { name: "Collapse Library" }).click();
            await expect.poll(async () => {
                const at = await frameAt(box);
                const badge = await pane.locator("[data-collapsed]").first().evaluate((el) => el.textContent);
                return { collapsed: at.start!.collapsed, w: at.start!.slot.w, badge };
            }).toEqual({ collapsed: true, w: 44, badge: expect.stringContaining("11") });
        });
    }

    test("a hidden column's card is dimmed under an eye-slash, and the grid leaves the column out; shown again, it returns", async ({ page }) => {
        const box = await openBuilder(page);
        const pane = box.locator("[data-builder-frame] [data-frame-slot=start]");
        await pane.getByRole("tab", { name: "Columns 6" }).click();
        const notes = pane.locator('[role="tabpanel"]:not([hidden]) [data-library-item="notes"]');
        const headers = () => box.locator("[data-frame-slot=main] [data-slot=headerCell]").evaluateAll((cells) => cells.map((c) => c.getAttribute("data-key")));
        await expect.poll(headers).toContain("notes");
        await notes.click();
        await expect.poll(async () => ({
            opacity: await notes.evaluate((el) => getComputedStyle(el).opacity),
            eye: await notes.locator("svg[data-icon]").getAttribute("data-icon"),
            headers: await headers(),
        })).toEqual({ opacity: "0.45", eye: "eye-slash", headers: ["activity", "start", "end", "qty", "machines"] });
        await notes.click();
        await expect.poll(async () => ({
            opacity: await notes.evaluate((el) => getComputedStyle(el).opacity),
            eye: await notes.locator("svg[data-icon]").getAttribute("data-icon"),
            headers: await headers(),
        })).toEqual({ opacity: "1", eye: "eye", headers: ["activity", "start", "end", "qty", "machines", "notes"] });
    });
});

test.describe("Sheet builder — its frame on a phone (#1184)", () => {
    test.skip(({ isMobile }) => !isMobile, "measured on the phone");

    test("both panes rest on their 44px rails; the inspector, opened, covers main from its edge under the scrim — and a tap on the scrim closes it", async ({ page }) => {
        const box = await openBuilder(page, "light", null);
        const rest = await frameAt(box);
        expect({ start: [rest.start!.mode, rest.start!.collapsed, rest.start!.slot.w], end: [rest.end!.mode, rest.end!.collapsed, rest.end!.slot.w], scrim: rest.scrim })
            .toEqual({ start: ["overlay", true, 44], end: ["overlay", true, 44], scrim: null });
        const mainAtRest = within(rest.main, rest.body);
        await box.getByRole("button", { name: "Expand Inspector" }).click();
        await expect.poll(async () => {
            const at = await frameAt(box);
            const sheet = within(at.end!.sheet, at.body);
            return {
                open: !at.end!.collapsed, main: within(at.main, at.body),
                toEdge: tenth(at.body.w - (sheet.x + sheet.w)), height: [sheet.y, sheet.h],
                scrim: at.scrim === null ? null : within(at.scrim, at.body), ink: at.ink.scrim === at.ink.backdrop,
            };
        }).toEqual({ open: true, main: mainAtRest, toEdge: 0, height: [0, rest.body.h], scrim: mainAtRest, ink: true });
        await tapScrim(page, box, "end");
        await expect.poll(async () => {
            const at = await frameAt(box);
            return { collapsed: at.end!.collapsed, scrim: at.scrim };
        }).toEqual({ collapsed: true, scrim: null });
    });
});
