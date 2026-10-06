/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Sheet in its frame, measured in a real browser (#1184, #1216, `Sheet
 * Builder Spec.md` §7, §8, SB18–SB24), on the joinery workshop's orders: a
 * borderless `BuilderFrame` filling the box its example gives it — one 44px toolbar row,
 * the library and the inspector beside main, the grid filling main with the
 * strip docked under it, and the sheet's footer along the foot. The toolbar
 * folds by one ladder, the slice's rail first, then the sheet's own steps,
 * the history item last, and stays one row at every width from 1440px to
 * 360px. The panes are pinned beside main while main keeps 480px, overlaid on
 * their rails past that, and under a scrim at 560px and narrower, which a
 * click — on a phone, a tap — closes. The library (#1186): the tabs the
 * workshop's `library` lists, their counts out of the 272px pane's row and
 * kept in each tab's name (#1210), and its cards' anatomy; a hidden column's
 * card dimmed, and the column out of the grid. The inspector (#1188): a
 * line's Details in the 320px pane, its sections and its fields, a changed
 * field tinted; and on the weeks' sheet the author's own Details, its
 * slider's step one transaction. Drag and drop (#1187), on the day's
 * batches: a template carried over a line — its caption under the ghost, the
 * 2px brand seam it would land on — and dropped there; a card refused, red;
 * a batch moved to the top by its grip, every row drawn from the first
 * (#1213); and at 560px the library sliding off main while a drag is under
 * way. Apply in each record form (SB54): the workshop's orders, the record's
 * entries, and one week's plan, one entry's rows — each an edit committed to
 * the page's e3, and read back by the sheet mounted again over the record.
 * On a phone (#1215) the sheet's gutter folds: the first column's cell shows
 * beside it, each row's actions one 44 × 44 button whose tap opens its menu
 * and whose drag moves the row. In both themes; every measurement is polled
 * until it holds, on a page at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test sheet-frame --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";
import { frameAt, tapScrim, type Box } from "./builder-frame";

const HASH = "e3/sheet/sheet/sheetWorkshop";
/** The weeks' sheet: one entry's rows, and the author's own Details (SB58). */
const WEEKS = "e3/sheet/sheet/sheetWeeks";
/** The day's batches (#1187): a grouped sheet in the planner's order — templates in its Rows tab, every line and batch moved by its grip. */
const BATCHES = "e3/sheet/sheet/sheetBatches";

/** The fold ladder: the rail's four steps, the view tabs' strip closing up, the history item to its buttons. */
const LADDER = "rail>1 rail>2 rail>3 rail>4 tabs>1 tabs>2 tabs>3 history>1";

/**
 * Open the workshop's sheet and return the box its example gives it, at
 * rest: as wide as given, or, with `null`, as the page lays it out.
 */
async function openSheet(page: Page, theme: "light" | "dark" = "light", width: number | null = 1440, hash = HASH): Promise<Locator> {
    await page.goto(`/?theme=${theme}#${hash}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-builder-frame] [data-sheet-card]")).toBeVisible({ timeout: 20_000 });
    const box = entry.locator("[data-builder-frame]").first().locator("xpath=..");
    if (width !== null) await sizeTo(page, box, width);
    await settled(page);
    return box;
}

/** Set the sheet's box to a width, and wait for the page to be at rest. */
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

test.describe("The Sheet's frame (#1184, #1216)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    for (const theme of ["light", "dark"] as const) {
        test(`a borderless frame filling its box: one 44px toolbar row, the library 272px and the inspector 320px pinned beside main, the grid filling main, the footer along the foot (${theme})`, async ({ page }) => {
            const box = await openSheet(page, theme, null);
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
        const box = await openSheet(page);
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
        const box = await openSheet(page);
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
        const box = await openSheet(page);
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

test.describe("The Sheet's frame — the library pane (#1186)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    for (const theme of ["light", "dark"] as const) {
        test(`the library: the tabs \`library\` lists, their counts out of the 272px pane's row and in each tab's name; cards that fit the pane — the name 13px 600, the line under it mono 10px — under mono caps group heads; collapsed, a 44px rail with the templates' count (${theme})`, async ({ page }) => {
            const box = await openSheet(page, theme);
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
                    const t = getComputedStyle(tab);
                    const c = getComputedStyle(count);
                    return {
                        text: tab.textContent,
                        name: [t.fontFamily === mono, t.fontSize, t.fontWeight, t.textTransform],
                        count: [c.fontWeight, c.letterSpacing, c.color === quiet],
                        // The row folds its counts out (#1210): each takes no room on it.
                        countOnRow: count.getBoundingClientRect().width > 1,
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
                    fold: el.querySelector('[role="tablist"]')!.getAttribute("data-fold"),
                    tabs,
                    label: [label.fontSize, label.fontWeight],
                    line: [line.fontFamily === mono, line.fontSize, line.color === quiet],
                    head: [head.fontFamily === mono, head.fontSize, head.fontWeight, head.textTransform],
                    // Every card inside the pane, none wider than it.
                    fit: cards.every((c) => c.left >= paneBox.left && c.right <= paneBox.right),
                };
            })).toEqual({
                width: 272,
                fold: "compact",
                tabs: [
                    { text: "Rows 11", name: [true, "10.5px", "600", "uppercase"], count: ["500", "0.42px", true], countOnRow: false },
                    { text: "Statuses 3", name: [true, "10.5px", "600", "uppercase"], count: ["500", "0.42px", true], countOnRow: false },
                    { text: "Columns 6", name: [true, "10.5px", "600", "uppercase"], count: ["500", "0.42px", true], countOnRow: false },
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
        const box = await openSheet(page);
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

test.describe("The Sheet's frame — on a phone (#1184)", () => {
    test.skip(({ isMobile }) => !isMobile, "measured on the phone");

    test("both panes rest on their 44px rails; the inspector, opened, covers main from its edge under the scrim — and a tap on the scrim closes it", async ({ page }) => {
        const box = await openSheet(page, "light", null);
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

test.describe("The Sheet's frame — the inspector (#1188)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    for (const theme of ["light", "dark"] as const) {
        test(`a line's Details in the 320px pane: sections padded 16px with a rule between, the eyebrow mono caps in the quiet ink, every field the shared field inside the pane, a changed field tinted brand (${theme})`, async ({ page }) => {
            const box = await openSheet(page, theme);
            const pane = box.locator("[data-builder-frame] [data-frame-slot=end]");
            // The first operation of the first order: a line, never a band.
            await box.locator("[data-frame-slot=main] [data-slot=row]:not(:has([data-slot=groupSummary])) [data-slot=cell][data-key=notes]").first().click();
            await expect(pane.locator("[data-sheet-inspector=line]")).toBeVisible();
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
                const rule = resolve("color", "--chakra-colors-border-subtle");
                const quiet = resolve("color", "--chakra-colors-fg-subtle");
                const mono = resolve("fontFamily", "--chakra-fonts-mono");
                const details = el.querySelector("[data-sheet-inspector]")!;
                const paneBox = el.getBoundingClientRect();
                const section = (sel: string) => {
                    const st = getComputedStyle(details.querySelector(sel)!);
                    return [st.paddingTop, st.paddingRight, st.paddingBottom, st.paddingLeft, st.borderBottomWidth, st.borderBottomStyle, st.borderBottomColor === rule];
                };
                const eyebrow = getComputedStyle(details.querySelector("[data-inspector-what]")!);
                const fields = [...details.querySelectorAll("[data-field]")].map((f) => f.getBoundingClientRect());
                const actions = getComputedStyle(details.querySelector("[data-inspector-actions]")!);
                return {
                    width: Math.round(paneBox.width),
                    head: section(":scope > div:first-child"),
                    fields: section("[data-inspector-fields]"),
                    actions: [actions.paddingTop, actions.borderBottomWidth],
                    eyebrow: [eyebrow.fontFamily === mono, eyebrow.textTransform, eyebrow.color === quiet],
                    // Every field inside the pane: nothing wider than it, nothing scrolled sideways.
                    fit: fields.length > 0 && fields.every((b) => b.left >= paneBox.left && b.right <= paneBox.right),
                };
            })).toEqual({
                width: 320,
                head: ["16px", "16px", "16px", "16px", "1px", "solid", true],
                fields: ["16px", "16px", "16px", "16px", "1px", "solid", true],
                actions: ["16px", "0px"],
                eyebrow: [true, "uppercase", true],
                fit: true,
            });
            // An edit in the inspector: the field the drafts changed is tinted brand.
            const notes = pane.locator('[data-field="notes"]');
            await notes.getByRole("textbox").fill("Oak veneered board, checked");
            await notes.getByRole("textbox").press("Enter");
            await expect.poll(() => notes.evaluate((el) => {
                const probe = document.createElement("span");
                probe.style.background = "var(--chakra-colors-brand-tint)";
                document.body.appendChild(probe);
                const tint = getComputedStyle(probe).backgroundColor;
                probe.remove();
                return [el.hasAttribute("data-dirty"), getComputedStyle(el).backgroundColor === tint];
            })).toEqual([true, true]);
        });
    }

    test("the author's own Details on the weeks' sheet: a row's quantity on a slider, its key step one transaction through the cell, Undo taking it back (SB58)", async ({ page }) => {
        const box = await openSheet(page, "light", 1440, WEEKS);
        const pane = box.locator("[data-builder-frame] [data-frame-slot=end]");
        const qty = box.locator("[data-frame-slot=main] [data-slot=row] [data-slot=cell][data-key=qty]").first();
        await box.locator("[data-frame-slot=main] [data-slot=row] [data-slot=cell][data-key=task]").first().click();
        await expect(pane.locator('[data-inspector-fields="custom"]')).toContainText("Cut the kitchen carcasses");
        await expect(qty).toHaveText("48");
        await pane.getByRole("slider").focus();
        await page.keyboard.press("ArrowRight");
        await expect(qty).toHaveText("49");
        await expect(pane.locator('[data-state="pending"]')).toHaveText("Pending");
        await box.getByRole("button", { name: "Undo" }).click();
        await expect(qty).toHaveText("48");
    });
});

/** A locator's box — it must be laid out. */
async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await locator.boundingBox();
    if (box === null) throw new Error("not laid out");
    return box;
}

/** A point over a row's top or bottom half, past its gutter, in client px. */
async function onRow(row: Locator, half: "top" | "bottom"): Promise<{ x: number; y: number }> {
    const box = await boxOf(row);
    return { x: box.x + 300, y: box.y + box.height * (half === "top" ? 0.25 : 0.75) };
}

/** Press a card or a grip and carry it past the drag's threshold: the drag is under way. */
async function pickUp(page: Page, handle: Locator): Promise<void> {
    const box = await boxOf(handle);
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 12, at.y + 12, { steps: 3 });
    await expect(handle).toHaveAttribute("data-dragging", "");
}

/** A grouped sheet's lines in a group, by the text under a column. */
const lineTexts = (box: Locator, group: string, key: string) =>
    box.locator(`[data-frame-slot=main] [data-slot="row"][data-group-id="${group}"]:not([data-blank])`)
        .evaluateAll((rows, k) => rows.map((row) => row.querySelector(`[data-key="${k}"]`)?.textContent ?? ""), key);

test.describe("The Sheet's frame — the folded gutter on a phone (#1215)", () => {
    test.skip(({ isMobile }) => !isMobile, "measured on the phone");

    test("the workshop's sheet folds its gutter to 108px: the first column's cell shows beside it, 128px and more, each row's actions one 44 × 44 button in it; a tap opens the row's menu, every item 44px tall", async ({ page }) => {
        const box = await openSheet(page, "light", null);
        const line = box.locator('[data-frame-slot=main] [data-slot="row"][data-group-id="WO-2201"]:not([data-blank])').first();
        await expect.poll(() => line.evaluate((row) => {
            const main = row.closest("[data-frame-slot=main]")!.getBoundingClientRect();
            const gutter = row.querySelector("[data-slot=gutter]")!.getBoundingClientRect();
            const cell = row.querySelector("[data-slot=cell]")!.getBoundingClientRect();
            const button = row.querySelector("[data-slot=rowActions]")?.getBoundingClientRect();
            return {
                folded: row.closest("[data-sheet-card]")!.getAttribute("data-gutter"),
                gutter: Math.round(gutter.width),
                // What shows of the first column's cell, from the gutter's edge to main's.
                shows: Math.round(Math.min(cell.right, main.right) - Math.max(cell.left, gutter.right)) >= 128,
                button: button === undefined ? null : [Math.round(button.width), Math.round(button.height), button.left >= gutter.left - 0.5 && button.right <= gutter.right + 0.5],
            };
        })).toEqual({ folded: "folded", gutter: 108, shows: true, button: [44, 44, true] });
        await line.locator("[data-slot=rowActions]").tap();
        const items = page.locator('[role="menu"] [role="menuitem"]');
        await expect.poll(() => items.evaluateAll((els) => els.map((el) => [el.textContent, el.getBoundingClientRect().height >= 44])))
            .toEqual([["Insert above", true], ["Insert below", true], ["New order", true]]);
    });

    test("a drag on a batch's line's row-actions button moves the line, as its grip does", async ({ page }) => {
        const box = await openSheet(page, "light", null, BATCHES);
        const lines = box.locator('[data-frame-slot=main] [data-slot="row"][data-group-id="B-101"]:not([data-blank])');
        await expect.poll(() => lineTexts(box, "B-101", "task")).toEqual(["Cut doors", "Band doors", "Spray doors"]);
        // The batch in the window's middle: no row the drag rests on lies near an edge, where a drag scrolls the page.
        await lines.first().evaluate((row) => row.scrollIntoView({ block: "center" }));
        await settled(page);
        await pickUp(page, lines.nth(2).locator("[data-slot=rowActions]"));
        // Over the first line's top half, in its first cell, beside the gutter.
        const at = await lines.first().evaluate((row) => {
            const gutter = row.querySelector("[data-slot=gutter]")!.getBoundingClientRect();
            const box = row.getBoundingClientRect();
            return { x: gutter.right + 24, y: box.top + box.height * 0.25 };
        });
        await page.mouse.move(at.x, at.y, { steps: 6 });
        await expect(page.locator("[data-drag-caption]")).toHaveText("before line 1 of Doors, oak");
        await page.mouse.up();
        await expect.poll(() => lineTexts(box, "B-101", "task")).toEqual(["Spray doors", "Cut doors", "Band doors"]);
        await expect(page.locator('[role="menu"]')).toHaveCount(0);
    });
});

test.describe("The Sheet's frame — drag and drop (#1187)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    for (const theme of ["light", "dark"] as const) {
        test(`a template carried over a line: its caption under the ghost — mono, the muted ink on the paper in a strong rule — and along the seam it would land on a 2px brand line from the gutter's edge; dropped, the line inserted there (${theme})`, async ({ page }) => {
            const box = await openSheet(page, theme, 1440, BATCHES);
            const card = box.locator('[data-frame-slot=start] [role="tabpanel"]:not([hidden]) [data-library-item="sand"]');
            const target = box.locator('[data-frame-slot=main] [data-slot="row"][data-group-id="B-101"]:not([data-blank])').nth(1);
            await pickUp(page, card);
            const at = await onRow(target, "top");
            await page.mouse.move(at.x, at.y, { steps: 6 });
            await expect.poll(() => page.evaluate(() => {
                // The theme's tokens, as the page resolves them.
                const resolve = (property: "color" | "fontFamily" | "fontSize" | "backgroundColor" | "borderTopColor", token: string) => {
                    const probe = document.createElement("span");
                    probe.style[property] = `var(${token})`;
                    document.body.appendChild(probe);
                    const resolved = getComputedStyle(probe)[property];
                    probe.remove();
                    return resolved;
                };
                const caption = document.querySelector("[data-drag-caption]");
                const row = document.querySelector("[data-frame-slot=main] [data-row][data-drop-seam]");
                if (caption === null || row === null) return null;
                const c = getComputedStyle(caption);
                const seam = getComputedStyle(row, "::after");
                return {
                    text: caption.textContent, refused: caption.hasAttribute("data-refused"),
                    caption: [
                        c.fontFamily === resolve("fontFamily", "--chakra-fonts-mono"), c.fontSize === resolve("fontSize", "--chakra-font-sizes-label-md"),
                        c.color === resolve("color", "--chakra-colors-fg-muted"), c.backgroundColor === resolve("backgroundColor", "--chakra-colors-bg-surface"),
                        c.borderTopWidth, c.borderTopStyle, c.borderTopColor === resolve("borderTopColor", "--chakra-colors-border-strong"),
                    ],
                    // The line runs along the top of the line it lands before, from the gutter's edge.
                    seam: [row.getAttribute("data-drop-seam"), seam.content, seam.left, seam.height, seam.top, seam.backgroundColor === resolve("backgroundColor", "--chakra-colors-brand-solid")],
                    // No row lights as a candidate: the one under the pointer stays on its paper, unhovered.
                    paper: getComputedStyle(row).backgroundColor === resolve("backgroundColor", "--chakra-colors-bg-surface"),
                };
            })).toEqual({
                text: "before line 2 of Doors, oak", refused: false,
                caption: [true, true, true, true, "1px", "solid", true],
                seam: ["top", '""', "128px", "2px", "-1px", true],
                paper: true,
            });
            await page.mouse.up();
            await expect.poll(() => lineTexts(box, "B-101", "task")).toEqual(["Cut doors", "Sand", "Band doors", "Spray doors"]);
            // The drag over: no caption, no seam.
            await expect(page.locator("[data-drag-caption]")).toHaveCount(0);
            await expect(box.locator("[data-drop-seam]")).toHaveCount(0);
        });

        test(`a status card over the rows: on a line refused — the caption red, the line its invalid wash right under the pointer — and on its order's band the brand wash; let go there, the order drafted (${theme})`, async ({ page }) => {
            // A window that holds the whole sheet: no row it measures near the edges where a drag scrolls the page.
            await page.setViewportSize({ width: page.viewportSize()!.width, height: 1300 });
            const box = await openSheet(page, theme);
            const pane = box.locator("[data-builder-frame] [data-frame-slot=start]");
            await pane.getByRole("tab", { name: "Statuses 3" }).click();
            // A status is a group's: on a line it is refused, on a band it lands.
            const card = pane.locator('[role="tabpanel"]:not([hidden]) [data-library-item="RELEASED"]');
            const line = box.locator('[data-frame-slot=main] [data-slot="row"][data-group-id="WO-2202"]:not([data-blank])').first();
            const band = box.locator('[data-frame-slot=main] [data-slot="row"][data-band-row][data-row-id="WO-2202"]');
            await pickUp(page, card);
            const over = await onRow(line, "bottom");
            await page.mouse.move(over.x, over.y, { steps: 6 });
            await expect.poll(() => page.evaluate(({ x, y }) => {
                const resolve = (property: "color" | "backgroundColor" | "borderTopColor", value: string) => {
                    const probe = document.createElement("span");
                    probe.style[property] = value;
                    document.body.appendChild(probe);
                    const resolved = getComputedStyle(probe)[property];
                    probe.remove();
                    return resolved;
                };
                const caption = document.querySelector("[data-drag-caption]");
                const row = document.querySelector("[data-frame-slot=main] [data-row][data-drop-invalid]");
                const cell = document.elementFromPoint(x, y)?.closest("[data-slot=cell]") ?? null;
                if (caption === null || row === null || cell === null) return null;
                const c = getComputedStyle(caption);
                const wash = resolve("backgroundColor", "color-mix(in oklch, var(--chakra-colors-status-neg) 8%, var(--chakra-colors-bg-surface))");
                return {
                    text: caption.textContent, refused: caption.hasAttribute("data-refused"),
                    ink: [c.color === resolve("color", "var(--chakra-colors-fg-danger)"), c.borderTopColor === resolve("borderTopColor", "var(--chakra-colors-status-neg)")],
                    // The row's wash — its gutter's too — and the cell under the pointer clear over it: no hover.
                    wash: [getComputedStyle(row).backgroundColor === wash, getComputedStyle(row.querySelector("[data-slot=gutter]")!).backgroundColor === wash, getComputedStyle(cell).backgroundColor],
                };
            }, over)).toEqual({ text: "Drop onto a band", refused: true, ink: [true, true], wash: [true, true, "rgba(0, 0, 0, 0)"] });
            const onBand = await onRow(band, "bottom");
            await page.mouse.move(onBand.x, onBand.y, { steps: 6 });
            await expect.poll(() => band.evaluate((el) => {
                const probe = document.createElement("span");
                probe.style.backgroundColor = "var(--chakra-colors-brand-tint)";
                document.body.appendChild(probe);
                const tint = getComputedStyle(probe).backgroundColor;
                probe.remove();
                return { text: document.querySelector("[data-drag-caption]")?.textContent ?? null, tint: getComputedStyle(el).backgroundColor === tint };
            })).toEqual({ text: "→ order 2", tint: true });
            await page.mouse.up();
            await expect(band).toHaveAttribute("data-draft", "");
            await expect(page.locator("[data-drag-caption]")).toHaveCount(0);
        });
    }

    test("a sheet whose rows fit its frame, its first batch moved to the end by its grip: every row is still drawn from the first — the frame cannot scroll to keep the batch where it stood (#1213)", async ({ page }) => {
        // A box tall enough that the rows fit the frame — it has nowhere to scroll — in a window that shows all of it.
        await page.setViewportSize({ width: 1280, height: 1300 });
        const box = await openSheet(page, "light", 1440, BATCHES);
        const main = box.locator("[data-frame-slot=main]");
        const frameOf = () => main.locator('[data-virtual-rows="bounded"]');
        await box.evaluate((el) => { (el as HTMLElement).style.height = "1000px"; });
        await settled(page);
        await box.scrollIntoViewIfNeeded();
        await settled(page);
        await expect.poll(() => frameOf().evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
        const band = (id: string) => main.locator(`[data-slot="row"][data-band-row][data-row-id="${id}"]`);
        // The grip shows on the row's hover. The batch is the top row — the scroll's anchor.
        await band("B-101").hover();
        await pickUp(page, band("B-101").locator('[data-slot="rowGrip"]'));
        const at = await onRow(main.locator('[data-slot="row"][data-group-id="B-103"][data-blank]'), "bottom");
        await page.mouse.move(at.x, at.y, { steps: 6 });
        await expect(page.locator("[data-drag-caption]")).toHaveText("after batch 3");
        await page.mouse.up();
        await expect.poll(() => frameOf().evaluate((frame) => {
            const header = frame.firstElementChild!.getBoundingClientRect();
            const view = frame.getBoundingClientRect();
            // The rows the frame draws — the sticky copies under the header are not among them.
            const bands = [...frame.querySelectorAll('[data-virtual-extent] [data-slot="row"][data-band-row]')];
            const first = bands[0]?.getBoundingClientRect();
            return {
                scrollTop: frame.scrollTop,
                bands: bands.map((b) => b.getAttribute("data-row-id")),
                firstInView: first !== undefined && first.top >= header.bottom - 1 && first.bottom <= view.bottom + 1,
            };
        })).toEqual({ scrollTop: 0, bands: ["B-102", "B-103", "B-101"], firstInView: true });
    });

    test("at 560px the library floats over main under the scrim; a card picked up slides it off main and lifts the scrim, and lands on the line it is dropped on — the pane back over main once the drag is over", async ({ page }) => {
        const box = await openSheet(page, "light", 1440, BATCHES);
        await sizeTo(page, box, 560);
        await box.getByRole("button", { name: "Expand Library" }).click();
        await expect.poll(async () => {
            const at = await frameAt(box);
            return { open: !at.start!.collapsed, scrim: at.scrim !== null };
        }).toEqual({ open: true, scrim: true });
        await pickUp(page, box.locator('[data-frame-slot=start] [role="tabpanel"]:not([hidden]) [data-library-item="seal"]'));
        // Off main, toward its own edge, and no scrim over the drop targets.
        await expect.poll(async () => {
            const at = await frameAt(box);
            return { offMain: at.start!.sheet.x + at.start!.sheet.w <= at.main.x + 0.5, scrim: at.scrim };
        }).toEqual({ offMain: true, scrim: null });
        const target = box.locator('[data-frame-slot=main] [data-slot="row"][data-group-id="B-102"]:not([data-blank])').first();
        const at = await onRow(target, "bottom");
        await page.mouse.move(at.x, at.y, { steps: 6 });
        await expect(page.locator("[data-drag-caption]")).toHaveText("after line 1 of Carcasses, birch");
        await page.mouse.up();
        await expect.poll(() => lineTexts(box, "B-102", "task")).toEqual(["Cut carcasses", "Seal", "Drill carcasses"]);
        await expect.poll(async () => {
            const at = await frameAt(box);
            return { open: !at.start!.collapsed, back: at.start!.sheet.x >= at.body.x - 0.5, scrim: at.scrim !== null };
        }).toEqual({ open: true, back: true, scrim: true });
    });
});

/**
 * Leave the Sheet's page for another e3 page — the paged sheet a dataset
 * binds — and come back to it, in the same page — its e3 kept in memory — so
 * the sheet mounts afresh over what the record holds.
 */
async function remount(page: Page, hash: string): Promise<Locator> {
    const away = "e3/bind/data/data/dataBindPagedSheet";
    await page.evaluate((h) => { location.hash = `#${h}`; }, away);
    await expect(page.locator("[data-index]", { has: page.locator(`a[href="#${away}"]`) }).locator("[data-sheet-card]")).toBeVisible({ timeout: 20_000 });
    await page.evaluate((h) => { location.hash = `#${h}`; }, hash);
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-builder-frame] [data-sheet-card]")).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return entry.locator("[data-builder-frame]").first().locator("xpath=..");
}

/** The rows of a sheet that still hold a draft. */
const drafts = (box: Locator) => box.locator("[data-frame-slot=main] [data-slot='row'][data-draft]");

test.describe("The Sheet's frame — Apply on e3-web (SB54)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    test("the workshop's orders, the record's entries: an operation's notes, edited and applied, are one commit to the page's e3 — and the sheet, mounted again over the record, shows them", async ({ page }) => {
        const box = await openSheet(page);
        // The wardrobes order's first operation: a line, its notes empty.
        const notesOf = (b: Locator) => b.locator('[data-frame-slot=main] [data-slot="row"][data-group-id="WO-2202"]:not([data-blank]) [data-key="notes"]').first();
        await notesOf(box).dblclick();
        const input = page.locator("[data-slot='editorInput']");
        await input.fill("Ash veneered board");
        await input.press("Enter");
        const apply = box.getByRole("button", { name: "Apply changes" });
        await expect(apply).toBeEnabled();
        await apply.click();
        // Confirmed by the rows the record reads back: Apply off, no draft left.
        await expect(apply).toBeDisabled();
        await expect(drafts(box)).toHaveCount(0);
        const again = await remount(page, HASH);
        await expect(notesOf(again)).toHaveText("Ash veneered board");
        await expect(drafts(again)).toHaveCount(0);
    });

    test("one week's plan, one entry's rows: a task, edited and applied, is one commit to the week in the page's e3 — and the sheet, mounted again over the record, shows it", async ({ page }) => {
        const box = await openSheet(page, "light", 1440, WEEKS);
        const taskOf = (b: Locator) => b.locator("[data-frame-slot=main] [data-slot='row'][data-row-id='w42-1'] [data-key='task']");
        await expect(taskOf(box)).toHaveText("Cut the kitchen carcasses");
        await taskOf(box).dblclick();
        const input = page.locator("[data-slot='editorInput']");
        await input.fill("Cut the wardrobe carcasses");
        await input.press("Enter");
        const apply = box.getByRole("button", { name: "Apply changes" });
        await expect(apply).toBeEnabled();
        await apply.click();
        await expect(apply).toBeDisabled();
        await expect(drafts(box)).toHaveCount(0);
        const again = await remount(page, WEEKS);
        await expect(taskOf(again)).toHaveText("Cut the wardrobe carcasses");
        await expect(drafts(again)).toHaveCount(0);
    });
});
