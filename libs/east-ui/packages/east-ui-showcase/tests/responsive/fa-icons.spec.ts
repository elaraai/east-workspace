/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Every icon is a Font Awesome solid icon (#1263), in a real browser: on each
 * catalog page that holds a place the renderers once drew a text glyph as an
 * icon — an empty state's mark, a chip's caret or remove, a proposal's plus,
 * an open slot, a section's caret, a step button's arrow — in both themes, no
 * element's whole text and no `::before` or `::after` it draws is one of those
 * glyphs. The doc list mounts a page's examples as it scrolls, so the spec
 * walks the list from the file's first example to its last, reading each
 * example as it mounts, at rest — every example its file declares.
 *
 * And each such icon takes the room its glyph took: its own width, as its
 * shape gives it, never Font Awesome 7's fixed 1.25em cell — a chip's caret
 * 8px tall and 5px wide, a clause chip's remove as wide as the `×` it
 * replaced — so no row grows for the change.
 *
 * And each Chakra part that drew an icon of Chakra's own draws Font Awesome's
 * in the box Chakra's took, in both themes: the part and its icon each the
 * size Chromium measured before the change — a select's chevron 16px square,
 * a number input's steppers 9px in their 19 × 12 trigger, a close button's
 * xmark 20px in its 40 × 32 button. A tag's close, which Chakra's icon left
 * empty, is an xmark at 0.8em, its own width; a tree branch, which drew no
 * chevron, draws Font Awesome's, which turns down as the branch opens.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test fa-icons --project desktop`.
 */

import { readFileSync } from "node:fs";
import { test, expect, type Locator, type Page } from "playwright/test";
import { ICON_GLYPHS } from "@elaraai/east-ui-components/testing";
import { examplesFile } from "./routes";
import { settled } from "./settle";

/** The catalog pages that hold the places (#1263). */
const FILES = [
    "feedback/empty-state",
    "collections/library",
    "collections/calendar",
    "collections/board",
    "collections/roster",
    "slice/slice",
    "layout/snap-grid",
    "disclosure/story",
    "e3/decision/queue",
    "e3/query/query",
    "e3/plan/plan",
    "e3/studio/studio",
    "e3/sheet/sheet",
] as const;

/** The examples a file declares, by name — each one the catalog shows. */
const declared = (file: string): string[] =>
    [...readFileSync(examplesFile(file), "utf8").matchAll(/^export const (\w+) = example\(/gm)].map((m) => m[1]!).sort();

/** What one read of the doc list found: the file's examples mounted, the glyphs they draw as icons, and whether the file's last example has been read. */
interface Read {
    examples: string[];
    glyphs: string[];
    done: boolean;
}

/** Reads the file's examples the doc list has mounted: each element, and its `::before` and `::after`, whose whole text is a glyph. */
function read(page: Page, file: string): Promise<Read> {
    return page.evaluate(({ file, glyphs }) => {
        const anchorOf = (row: Element) => row.querySelector(`a[href^="#${file}/"]`);
        // The doc list's own rows: the mounted row holding one of the file's examples, and its siblings —
        // never the virtualized rows an example draws inside itself.
        const held = [...document.querySelectorAll<HTMLElement>("[data-index]")].find((row) => anchorOf(row) !== null);
        if (held === undefined) return { examples: [], glyphs: [], done: true };
        const list = held.parentElement!.parentElement!;
        const rows = [...held.parentElement!.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute("data-index"))
            .sort((a, b) => Number(a.dataset["index"]) - Number(b.dataset["index"]));
        const mine = rows.filter((row) => anchorOf(row) !== null);
        const nameOf = (row: Element) => anchorOf(row)!.getAttribute("href")!.slice(file.length + 2);
        /** A pseudo-element's drawn text, or `null` when it draws none. */
        const drawn = (content: string) => (content.length >= 2 && content.startsWith("\"") && content.endsWith("\"") ? content.slice(1, -1).trim() : null);
        const found: string[] = [];
        for (const row of mine) {
            for (const el of [row, ...row.querySelectorAll("*")]) {
                const tag = el.tagName.toLowerCase();
                const text = (el.textContent ?? "").trim();
                if (glyphs.includes(text)) found.push(`${nameOf(row)}: <${tag}> ${JSON.stringify(text)}`);
                for (const pseudo of ["::before", "::after"] as const) {
                    const css = drawn(getComputedStyle(el, pseudo).content);
                    if (css !== null && glyphs.includes(css)) found.push(`${nameOf(row)}: <${tag}>${pseudo} ${JSON.stringify(css)}`);
                }
            }
        }
        const last = mine.at(-1)!;
        // Past the file: a row after its last example is another file's, or the list ends.
        const past = rows.some((row) => Number(row.dataset["index"]) > Number(last.dataset["index"]) && anchorOf(row) === null);
        const end = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
        return { examples: mine.map(nameOf), glyphs: found, done: past || end };
    }, { file, glyphs: [...ICON_GLYPHS] });
}

/** Scrolls the doc list on by most of its height. */
function scrollOn(page: Page, file: string): Promise<void> {
    return page.evaluate((file) => {
        const row = [...document.querySelectorAll("[data-index]")].find((r) => r.querySelector(`a[href^="#${file}/"]`) !== null)!;
        const list = row.parentElement!.parentElement!;
        list.scrollTop += Math.max(200, Math.round(list.clientHeight * 0.75));
    }, file);
}

/** Walks the file's examples from its first to its last, each read at rest: every example read, and every glyph found. */
async function walk(page: Page, file: string): Promise<{ examples: string[]; glyphs: string[] }> {
    const examples = new Set<string>();
    const glyphs = new Set<string>();
    for (let step = 0; step < 200; step++) {
        const at = await read(page, file);
        at.examples.forEach((name) => examples.add(name));
        at.glyphs.forEach((glyph) => glyphs.add(glyph));
        if (at.done) break;
        await scrollOn(page, file);
        await settled(page);
    }
    return { examples: [...examples], glyphs: [...glyphs] };
}

/** An icon a converted place draws: its place, its example, its box, the width its own shape gives it, the width Font Awesome is told to take, and — where its place names one — the width the glyph it replaced takes there. */
interface Drawn {
    site: string;
    example: string;
    w: number;
    h: number;
    own: number;
    fa: string;
    glyph: number | null;
}

/** A converted place: the selector of its icons, and — when its width is the measure — the glyph it drew before, and the element that drew it, whose parent's font it took. */
type Site = { icons: string; glyph?: { text: string; drawnBy: string } };

/** Each icon of the places the file's examples draw, read as the doc list mounts them, from the file's first example to its last. */
async function measure(page: Page, file: string, sites: Readonly<Record<string, Site>>): Promise<Drawn[]> {
    const drawn = new Map<string, Drawn>();
    for (let step = 0; step < 200; step++) {
        const at = await page.evaluate(({ file, sites }) => {
            const anchorOf = (row: Element) => row.querySelector(`a[href^="#${file}/"]`);
            const held = [...document.querySelectorAll<HTMLElement>("[data-index]")].find((row) => anchorOf(row) !== null);
            if (held === undefined) return { icons: [], done: true };
            const list = held.parentElement!.parentElement!;
            const rows = [...held.parentElement!.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute("data-index"))
                .sort((a, b) => Number(a.dataset["index"]) - Number(b.dataset["index"]));
            const mine = rows.filter((row) => anchorOf(row) !== null);
            const round = (n: number) => Math.round(n * 100) / 100;
            const icons = Object.entries(sites).flatMap(([site, { icons, glyph }]) => mine.flatMap((row) => [...row.querySelectorAll<SVGSVGElement>(icons)].map((svg, i) => {
                const box = svg.getBoundingClientRect();
                const view = svg.viewBox.baseVal;
                // The glyph's width where it was drawn: a probe of its text in the font it took there, removed at once.
                let glyphWidth: number | null = null;
                if (glyph !== undefined && box.width > 0) {
                    const probe = document.createElement("span");
                    probe.textContent = glyph.text;
                    svg.closest(glyph.drawnBy)!.parentElement!.append(probe);
                    glyphWidth = round(probe.getBoundingClientRect().width);
                    probe.remove();
                }
                const example = anchorOf(row)!.getAttribute("href")!.slice(file.length + 2);
                return {
                    key: `${site}:${example}:${i}`, site, example, w: round(box.width), h: round(box.height),
                    own: round(box.height * view.width / view.height), fa: getComputedStyle(svg).getPropertyValue("--fa-width").trim(), glyph: glyphWidth,
                };
            })));
            const last = mine.at(-1)!;
            const past = rows.some((row) => Number(row.dataset["index"]) > Number(last.dataset["index"]) && anchorOf(row) === null);
            return { icons, done: past || list.scrollTop + list.clientHeight >= list.scrollHeight - 1 };
        }, { file, sites });
        for (const { key, ...icon } of at.icons) if (!drawn.has(key) || icon.w > 0) drawn.set(key, icon);
        if (at.done) break;
        await scrollOn(page, file);
        await settled(page);
    }
    return [...drawn.values()];
}

/** Opens a file's page, at rest. */
async function openFile(page: Page, file: string): Promise<void> {
    await page.goto(`/?theme=light#${encodeURIComponent(file)}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    await expect(page.locator(`a[href^="#${file}/"]`).first()).toBeVisible();
    await settled(page);
}

/** Within a third of a pixel. */
const near = (a: number, b: number) => Math.abs(a - b) <= 0.34;

test.describe("a converted icon takes the room its glyph took (#1263)", () => {
    test("a chip's caret — a segment's menu, the View chip, the key search — is 8px tall and 5px wide, its own width", async ({ page, isMobile }) => {
        test.skip(!isMobile, "the chips a caret marks are a folded toolbar's, on a phone");
        for (const file of ["e3/plan/plan", "layout/snap-grid", "e3/sheet/sheet"]) {
            await openFile(page, file);
            const carets = await measure(page, file, { caret: { icons: "svg[data-chip-caret]" } });
            expect(carets.length, `no caret drawn on ${file}`).toBeGreaterThan(0);
            expect(carets.filter((c) => !(near(c.h, 8) && near(c.w, 5) && c.fa === "auto")), `a caret on ${file} not 8 × 5`).toEqual([]);
        }
    });

    test("a clause chip's remove is as wide as the × it replaced, at 0.8em, its own width", async ({ page, isMobile }) => {
        test.skip(isMobile, "a clause chip draws its remove for a mouse");
        await openFile(page, "slice/slice");
        // The × was the remove's whole text, in its chip's font.
        const removes = await measure(page, "slice/slice", { remove: { icons: "[data-chip-remove] svg", glyph: { text: "×", drawnBy: "[data-chip-remove]" } } });
        expect(removes.length, "no remove drawn").toBeGreaterThan(0);
        expect(removes.filter((r) => !(r.glyph !== null && near(r.w, r.glyph) && near(r.w, r.own) && r.fa === "auto")), "a remove wider than its ×").toEqual([]);
    });

    test("every other converted icon is its own width, as its shape gives it — never Font Awesome's fixed cell", async ({ page, isMobile }) => {
        test.skip(isMobile, "measured once, at the desktop width");
        const pages: ReadonlyArray<[string, Readonly<Record<string, Site>>]> = [
            ["collections/board", { sign: { icons: "[data-chip-sign] svg" }, openSlot: { icons: "[aria-label='Open slot'] svg" } }],
            ["collections/roster", { sign: { icons: "[data-chip-sign] svg" }, hint: { icons: "[data-roster-hint] svg" } }],
            ["collections/library", { add: { icons: "[data-library-footer-add] svg" } }],
            ["e3/decision/queue", { caret: { icons: "[data-collapsible] > span > svg" } }],
            ["e3/query/query", { slotCaret: { icons: "button[aria-haspopup='listbox'] > span[aria-hidden] > svg" } }],
            ["layout/snap-grid", { endZone: { icons: "[data-snap-grid-end] svg" } }],
        ];
        for (const [file, sites] of pages) {
            await openFile(page, file);
            const icons = await measure(page, file, sites);
            expect(new Set(icons.map((i) => i.site)), `the places drawn on ${file}`).toEqual(new Set(Object.keys(sites)));
            // An icon its example hides — an end zone's words at rest, a collapsed pane's slots — has no box: its width is still its own.
            expect(icons.filter((i) => !(i.fa === "auto" && near(i.w, i.own))), `an icon on ${file} in Font Awesome's fixed cell`).toEqual([]);
        }
    });

    test("the narrow Plan's section go mark is its own width", async ({ page, isMobile }) => {
        test.skip(!isMobile, "the narrow Plan is a phone's");
        await openFile(page, "e3/plan/plan");
        const marks = await measure(page, "e3/plan/plan", { go: { icons: "[data-plan-section] svg" } });
        expect(marks.filter((m) => m.w > 0).length, "no go mark drawn").toBeGreaterThan(0);
        expect(marks.filter((m) => !(m.fa === "auto" && near(m.w, m.own))), "a go mark in Font Awesome's fixed cell").toEqual([]);
    });

    test("a query slot's caret, a publish change's sign: each its own width, where its builder shows it", async ({ page, isMobile }) => {
        test.skip(isMobile, "measured once, at the desktop width");
        /** Each icon under a part of an example: its box and its own width. */
        const iconsIn = (root: Locator, selector: string) => root.evaluate((el, sel) => [...el.querySelectorAll<SVGSVGElement>(sel)].map((svg) => {
            const box = svg.getBoundingClientRect();
            const view = svg.viewBox.baseVal;
            return { w: Math.round(box.width * 100) / 100, own: Math.round(box.height * view.width / view.height * 100) / 100, fa: getComputedStyle(svg).getPropertyValue("--fa-width").trim() };
        }), selector);
        /** Opens an example, its builder set to its mock's width, at rest once its own part shows. */
        const openBuilder = async (hash: string, builderSel: string, ready: string, width: number) => {
            await page.goto(`/?theme=light#${hash}`);
            await page.waitForSelector("header", { timeout: 20_000 });
            const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) });
            await entry.scrollIntoViewIfNeeded();
            const builder = entry.locator(builderSel).first();
            await expect(builder.locator(ready).first()).toBeVisible({ timeout: 20_000 });
            await builder.evaluate((root, w) => { (root as HTMLElement).style.width = `${w}px`; }, width);
            await settled(page);
            return builder;
        };
        const query = await openBuilder("e3/query/query/queryBuilder", "[data-query-builder]", "[data-query-results-view]", 1240);
        const carets = await iconsIn(query, "button[aria-haspopup='listbox'] > span[aria-hidden] > svg");
        expect(carets.filter((c) => c.w > 0).length, "no slot caret shown").toBeGreaterThan(0);
        expect(carets.filter((c) => !(c.fa === "auto" && near(c.w, c.own))), "a slot caret in Font Awesome's fixed cell").toEqual([]);
        const studio = await openBuilder("e3/studio/studio/studioBuilder", "[data-studio-builder]", "[data-snap-grid-tile]", 1440);
        await studio.getByRole("button", { name: "Preview", exact: true }).click();
        await expect(studio.locator("[data-publish-change]").first()).toBeVisible({ timeout: 20_000 });
        await settled(page);
        const signs = await iconsIn(studio, "[data-sign] svg");
        expect(signs.length, "no change signed").toBeGreaterThan(0);
        expect(signs.filter((c) => !(c.fa === "auto" && c.w > 0 && near(c.w, c.own))), "a sign in Font Awesome's fixed cell").toEqual([]);
    });

    test("the Calendar's delta: its caret its own width, beside the signed figure", async ({ page, isMobile }) => {
        test.skip(isMobile, "measured once, at the desktop width");
        const file = "collections/calendar";
        await openFile(page, file);
        // A day picked: the footer's delta chip draws.
        await page.evaluate(() => {
            const row = [...document.querySelectorAll("[data-index]")].find((r) => r.querySelector('a[href="#collections/calendar/calendarDemand"]') !== null)!;
            [...row.querySelectorAll<HTMLElement>("div[style*='background']")].find((cell) => !cell.hasAttribute("data-empty") && /\d/.test(cell.textContent ?? ""))!.click();
        });
        await settled(page);
        const deltas = await measure(page, file, { delta: { icons: "[data-dir] svg" } });
        expect(deltas.length, "no delta drawn").toBeGreaterThan(0);
        expect(deltas.filter((d) => !(d.fa === "auto" && d.w > 0 && near(d.w, d.own))), "a delta in Font Awesome's fixed cell").toEqual([]);
    });
});

test.describe("an empty state's mark (#1263)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    for (const theme of ["light", "dark"] as const) {
        test(`each example's icon is its indicator's 36px, centred over its title, in the strong rule's ink (${theme})`, async ({ page }) => {
            const file = "feedback/empty-state";
            await page.goto(`/?theme=${theme}#${file}`);
            await page.waitForSelector("header", { timeout: 20_000 });
            await expect(page.locator(`a[href^="#${file}/"]`).first()).toBeVisible();
            await settled(page);
            await expect.poll(() => page.evaluate((file) => {
                const rows = [...document.querySelectorAll<HTMLElement>("[data-index]")].filter((row) => row.querySelector(`:scope a[href^="#${file}/"]`) !== null);
                return rows.map((row) => {
                    const title = row.querySelector("h3")!;
                    const mark = title.parentElement!.previousElementSibling!;
                    const icon = mark.querySelector('svg[data-prefix="fas"]')!.getBoundingClientRect();
                    const words = title.getBoundingClientRect();
                    // The strong rule, as the theme paints a 1px border in it — a token the theme defines.
                    const token = getComputedStyle(row).getPropertyValue("--chakra-colors-border-strong").trim();
                    const rule = document.createElement("div");
                    rule.style.cssText = "border-top: 1px solid var(--chakra-colors-border-strong)";
                    row.append(rule);
                    const strong = getComputedStyle(rule).borderTopColor;
                    rule.remove();
                    return {
                        size: Math.round(icon.height * 10) / 10,
                        centred: Math.abs((icon.left + icon.right) / 2 - (words.left + words.right) / 2) <= 1,
                        above: icon.bottom <= words.top,
                        ink: token !== "" && getComputedStyle(mark).color === strong,
                    };
                });
            }, file)).toEqual([0, 1, 2].map(() => ({ size: 36, centred: true, above: true, ink: true })));
        });
    }
});

/** A Chakra part and the Font Awesome icon it draws: the icon's name — none for a part that draws none — the part's box and the icon's, the width the icon's shape gives it, Font Awesome's width and how far the icon and the part are turned. */
interface PartIcon {
    icon: string | null;
    part: readonly [number, number];
    svg: readonly [number, number];
    own: number;
    fa: string;
    /** The part's turn and its icon's, in whole degrees. */
    turn: readonly [number, number];
}

/** Each part a selector finds under a root — the whole page for none — as it draws now. */
function partIcons(page: Page, root: string, part: string): Promise<PartIcon[]> {
    return page.evaluate(({ root, part }) => {
        const round = (n: number) => Math.round(n * 100) / 100;
        /** An element's rotation, in whole degrees, from its computed transform. */
        const turnOf = (el: Element) => {
            const matrix = /^matrix\(([^,]+), ([^,]+),/.exec(getComputedStyle(el).transform);
            return matrix === null ? 0 : Math.round(Math.atan2(Number(matrix[2]), Number(matrix[1])) * 180 / Math.PI);
        };
        const scope = root === "" ? document : document.querySelector(root);
        if (scope === null) return [];
        return [...scope.querySelectorAll<HTMLElement>(part)].map((el) => {
            const box = el.getBoundingClientRect();
            const svg = el.querySelector<SVGSVGElement>('svg[data-prefix="fas"]');
            const icon = svg?.getBoundingClientRect();
            const view = svg?.viewBox.baseVal;
            return {
                icon: svg?.getAttribute("data-icon") ?? null,
                part: [round(box.width), round(box.height)] as const,
                svg: icon === undefined ? [0, 0] as const : [round(icon.width), round(icon.height)] as const,
                own: icon === undefined || view === undefined ? 0 : round(icon.height * view.width / view.height),
                fa: svg === null ? "" : getComputedStyle(svg).getPropertyValue("--fa-width").trim(),
                turn: [turnOf(el), svg === null ? 0 : turnOf(svg)] as const,
            };
        });
    }, { root, part });
}

/** The parts that draw another icon, or whose box or icon's box is not the one given, within a third of a pixel. */
function unlike(found: readonly PartIcon[], icon: string | RegExp, part: readonly [number, number], svg: readonly [number, number]): PartIcon[] {
    const named = (name: string | null) => name !== null && (typeof icon === "string" ? name === icon : icon.test(name));
    return found.filter((p) => !(named(p.icon) && near(p.part[0], part[0]) && near(p.part[1], part[1]) && near(p.svg[0], svg[0]) && near(p.svg[1], svg[1])));
}

/** The parts that show: a part its example hides — an item's check that is not picked, a nested branch's chevron — has no box. */
const shown = (found: readonly PartIcon[]) => found.filter((p) => p.part[0] > 0 && p.part[1] > 0);

/** Opens one example of the catalog in a theme, its row in view and the page at rest: the selector of its row. */
async function openExample(page: Page, hash: string, theme: "light" | "dark"): Promise<string> {
    await page.goto(`/?theme=${theme}#${hash}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    await page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) }).scrollIntoViewIfNeeded({ timeout: 30_000 });
    await settled(page);
    return `[data-index]:has(a[href="#${hash}"])`;
}

/** A select's or a combobox's open list. */
const openList = (scope: "select" | "combobox") => `[data-scope='${scope}'][data-part='content'][data-state='open']`;

test.describe("a Chakra part's icon is Font Awesome's, in the box Chakra's own took (#1263)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    for (const theme of ["light", "dark"] as const) {
        test(`a stat's caret is 10px square; a number input's steppers 9px in their 19 × 12 triggers (${theme})`, async ({ page }) => {
            let row = await openExample(page, "display/stat/statVariants", theme);
            const carets = await partIcons(page, row, "[class*='stat__indicator']");
            expect(carets.length, "no stat caret drawn").toBeGreaterThan(0);
            expect(unlike(carets, /^caret-(up|down)$/, [10, 10], [10, 10]), "a stat caret not 10px square").toEqual([]);
            row = await openExample(page, "collections/pagination/paginationVariants", theme);
            // Each input's increment, then its decrement.
            const steppers = await partIcons(page, row, "[data-scope='number-input'][data-part$='-trigger']");
            expect(steppers.length, "no stepper drawn").toBeGreaterThan(0);
            expect(steppers.map((s) => s.icon)).toEqual(steppers.map((_, i) => (i % 2 === 0 ? "chevron-up" : "chevron-down")));
            expect(unlike(steppers, /^chevron-(up|down)$/, [19, 12], [9, 9]), "a stepper not 9px in its 19 × 12 trigger").toEqual([]);
        });

        test(`a select's chevron is 16px square, and so is the picked item's check (${theme})`, async ({ page }) => {
            const row = await openExample(page, "forms/select/selectBasic", theme);
            expect(unlike(await partIcons(page, row, "[data-scope='select'][data-part='indicator']"), "chevron-down", [16, 16], [16, 16]), "a chevron not 16px square").toEqual([]);
            const trigger = page.locator(row).locator("[data-scope='select'][data-part='trigger']").first();
            await trigger.click();
            await page.locator(openList("select")).locator("[data-part='item']", { hasText: "Canada" }).click();
            await settled(page);
            await trigger.click();
            await page.locator(openList("select")).waitFor();
            await settled(page);
            const checks = shown(await partIcons(page, openList("select"), "[data-part='item-indicator']"));
            expect([checks.length, unlike(checks, "check", [16, 16], [16, 16])], "the picked item's check not 16px square").toEqual([1, []]);
        });

        test(`a combobox's chevron, its clear and its picked item's check are 16px in their parts (${theme})`, async ({ page }) => {
            const row = await openExample(page, "forms/combobox/comboboxBasic", theme);
            const trigger = page.locator(row).locator("[data-scope='combobox'][data-part='trigger']").first();
            expect(unlike(await partIcons(page, row, "[data-scope='combobox'][data-part='trigger']"), "chevron-down", [32, 16], [16, 16]), "a chevron not 16px in its 32 × 16 trigger").toEqual([]);
            await trigger.click();
            await page.locator(openList("combobox")).locator("[data-part='item']").first().click();
            await settled(page);
            const clears = shown(await partIcons(page, row, "[data-scope='combobox'][data-part='clear-trigger']"));
            expect([clears.length, unlike(clears, "xmark", [24, 16], [16, 16])], "the clear not 16px in its 24 × 16 trigger").toEqual([1, []]);
            await trigger.click();
            await page.locator(openList("combobox")).waitFor();
            await settled(page);
            const checks = shown(await partIcons(page, openList("combobox"), "[data-part='item-indicator']"));
            expect([checks.length, unlike(checks, "check", [16, 16], [16, 16])], "the picked item's check not 16px square").toEqual([1, []]);
        });

        test(`a tag's close — which Chakra's own icon left empty — is an xmark 8px tall at 0.8em, its own width (${theme})`, async ({ page }) => {
            const row = await openExample(page, "display/tag/tagStyles", theme);
            const closes = await partIcons(page, row, "[class*='tag__closeTrigger']");
            expect(closes.length, "no tag close drawn").toBeGreaterThan(0);
            expect(closes.filter((c) => !(c.icon === "xmark" && near(c.svg[1], 8) && near(c.svg[0], c.own) && near(c.part[0], c.svg[0]) && c.fa === "auto")), "a close not its own width at 0.8em").toEqual([]);
        });

        test(`a tags input's delete is 14.92px in its 18.66px trigger; a file's 16px in its 20px (${theme})`, async ({ page }) => {
            let row = await openExample(page, "forms/tags-input/tagsInputBasic", theme);
            const tags = await partIcons(page, row, "[data-scope='tags-input'][data-part='item-delete-trigger']");
            expect(tags.length, "no tag delete drawn").toBeGreaterThan(0);
            expect(unlike(tags, "xmark", [18.66, 18.66], [14.92, 14.92]), "a tag's delete not 14.92px in its 18.66px trigger").toEqual([]);
            row = await openExample(page, "forms/file-upload/fileUploadBasic", theme);
            // A PNG's signature: the example takes images.
            await page.locator(row).locator("input[type='file']").first().setInputFiles({ name: "chart.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a", "hex") });
            await settled(page);
            const files = await partIcons(page, row, "[data-scope='file-upload'][data-part='item-delete-trigger']");
            expect([files.length, unlike(files, "xmark", [20, 20], [16, 16])], "a file's delete not 16px in its 20px trigger").toEqual([1, []]);
        });

        test(`a close button's xmark is 20px in its 40 × 32 button; a banner's 16px in its 36 × 28 (${theme})`, async ({ page }) => {
            let row = await openExample(page, "buttons/close-button/closeButtonBasic", theme);
            const buttons = await partIcons(page, row, "button[aria-label='Close']");
            expect([buttons.length, unlike(buttons, "xmark", [40, 32], [20, 20])], "a close button's xmark not 20px in its 40 × 32 button").toEqual([1, []]);
            row = await openExample(page, "feedback/banner/bannerStatusVariants", theme);
            const banners = await partIcons(page, row, "button[aria-label='Close']");
            expect(banners.length, "no banner close drawn").toBeGreaterThan(0);
            expect(unlike(banners, "xmark", [36, 28], [16, 16]), "a banner's xmark not 16px in its 36 × 28 button").toEqual([]);
        });

        test(`an accordion's chevron is 12px square; a checkbox's check and minus 8px in its 14px box, an unchecked box empty (${theme})`, async ({ page }) => {
            let row = await openExample(page, "disclosure/accordion/accordionBasic", theme);
            const chevrons = await partIcons(page, row, "[data-scope='accordion'][data-part='item-indicator']");
            expect(chevrons.length, "no accordion chevron drawn").toBeGreaterThan(0);
            expect(unlike(chevrons, "chevron-down", [12, 12], [12, 12]), "an accordion chevron not 12px square").toEqual([]);
            row = await openExample(page, "forms/checkbox/checkboxBasic", theme);
            // Unchecked, checked, indeterminate, disabled.
            const boxes = await partIcons(page, row, "[data-scope='checkbox'][data-part='control']");
            expect(boxes.map((b) => b.icon)).toEqual([null, "check", "minus", null]);
            expect(boxes.filter((b) => !(near(b.part[0], 14) && near(b.part[1], 14) && (b.icon === null || (near(b.svg[0], 8) && near(b.svg[1], 8))))), "a mark not 8px in its 14px box").toEqual([]);
        });

        test(`a tree branch — which drew no chevron — leads with an 11px chevron, turned down while the branch is open (${theme})`, async ({ page }) => {
            const row = await openExample(page, "collections/tree-view/treeViewBasic", theme);
            const indicator = "[data-scope='tree-view'][data-part='branch-indicator']";
            const branches = shown(await partIcons(page, row, indicator));
            expect(branches.length, "no branch chevron drawn").toBeGreaterThan(0);
            expect(unlike(branches, "chevron-right", [11, 11], [11, 11]), "a branch chevron not 11px square").toEqual([]);
            expect(branches.map((b) => b.turn[0]), "a closed branch's chevron turned").toEqual(branches.map(() => 0));
            await page.locator(row).locator("[data-scope='tree-view'][data-part='branch-control']").first().click();
            // Chakra's indicator turns over its transition, to a quarter turn.
            await expect.poll(async () => (await partIcons(page, row, indicator))[0]!.turn[0]).toBe(90);
            expect(unlike([(await partIcons(page, row, indicator))[0]!], "chevron-right", [11, 11], [11, 11]), "an open branch's chevron not 11px square").toEqual([]);
        });

        test(`the Sheet's chevrons are 10px in their buttons, an open group's turned down; its number field's steppers 9px in their 19 × 13 triggers (${theme})`, async ({ page }) => {
            test.setTimeout(120_000);
            let row = await openExample(page, "e3/sheet/sheet/sheetBatches", theme);
            await expect(page.locator(row).locator("[data-slot='fold']").first()).toBeVisible({ timeout: 30_000 });
            await settled(page);
            const folds = await partIcons(page, row, "[data-slot='fold']");
            expect(folds.length, "no group fold drawn").toBeGreaterThan(0);
            expect(unlike(folds, "chevron-right", [24, 24], [10, 10]), "a fold not 10px in its 24px button").toEqual([]);
            expect(folds.map((f) => f.turn[1]), "an open group's chevron not turned down").toEqual(folds.map(() => 90));
            expect(unlike(await partIcons(page, row, "[data-slot='foldAll']"), "angles-right", [24, 24], [10, 10]), "the fold-all not 10px in its 24px button").toEqual([]);
            const subRows = await partIcons(page, row, "[data-slot='subRowChevron']");
            expect(subRows.length, "no sub-row chevron drawn").toBeGreaterThan(0);
            expect(unlike(subRows, "chevron-right", [16, 20], [10, 10]), "a sub-row chevron not 10px in its 16 × 20 button").toEqual([]);
            row = await openExample(page, "e3/sheet/sheet/sheetBasic", theme);
            const cell = page.locator(row).locator("[data-slot='cell'][data-key='qty']").first();
            await expect(cell).toBeVisible({ timeout: 30_000 });
            await cell.dblclick();
            await expect(page.locator(row).locator("[data-slot='editorStepper']").first()).toBeVisible();
            await settled(page);
            const steppers = await partIcons(page, row, "[data-slot='editorStepper'] [data-part$='-trigger']");
            expect(steppers.map((s) => s.icon)).toEqual(["chevron-up", "chevron-down"]);
            expect(unlike(steppers, /^chevron-(up|down)$/, [19, 13], [9, 9]), "a stepper not 9px in its 19 × 13 trigger").toEqual([]);
        });

        test(`Studio's height select and the page library's template select: each chevron and the picked item's check 16px square (${theme})`, async ({ page }) => {
            test.setTimeout(120_000);
            let row = await openExample(page, "e3/studio/studio/studioBuilder", theme);
            const builder = page.locator(row).locator("[data-studio-builder]").first();
            await expect(builder.locator("[data-snap-grid-tile]").first()).toBeVisible({ timeout: 30_000 });
            // The mock's width: the inspector shows its layout's fields beside the canvas.
            await builder.evaluate((root) => { (root as HTMLElement).style.width = "1440px"; });
            await settled(page);
            await builder.locator("[data-snap-grid-tile]").first().click();
            const height = page.locator(row).locator("[data-inspector-height]").first();
            await expect(height).toBeVisible();
            await settled(page);
            expect(unlike(await partIcons(page, row, "[data-studio-inspector] [data-scope='select'][data-part='indicator']"), "chevron-down", [16, 16], [16, 16]), "the height's chevron not 16px square").toEqual([]);
            await height.click();
            await page.locator(openList("select")).waitFor();
            await settled(page);
            let checks = shown(await partIcons(page, openList("select"), "[data-part='item-indicator']"));
            expect([checks.length, unlike(checks, "check", [16, 16], [16, 16])], "the picked height's check not 16px square").toEqual([1, []]);
            row = await openExample(page, "e3/studio/studio/studioLibrary", theme);
            const add = page.locator(row).locator("[data-page-library-new]").first();
            await expect(add).toBeVisible({ timeout: 30_000 });
            await add.click();
            const template = page.locator("[data-page-library-template]").first();
            await expect(template).toBeVisible();
            await settled(page);
            expect(unlike(await partIcons(page, "", "[data-scope='select'][data-part='control']:has([data-page-library-template]) [data-part='indicator']"), "chevron-down", [16, 16], [16, 16]),
                "the template's chevron not 16px square").toEqual([]);
            await template.click();
            await page.locator(openList("select")).waitFor();
            await settled(page);
            checks = shown(await partIcons(page, openList("select"), "[data-part='item-indicator']"));
            expect([checks.length, unlike(checks, "check", [16, 16], [16, 16])], "the picked template's check not 16px square").toEqual([1, []]);
        });

        test(`the query builder's note close is a 14px xmark in its 24px button (${theme})`, async ({ page }) => {
            test.setTimeout(120_000);
            const row = await openExample(page, "e3/query/query/queryBuilder", theme);
            const builder = page.locator(row).locator("[data-query-builder]").first();
            await expect(builder.locator("[data-query-results-view]")).toBeVisible({ timeout: 60_000 });
            // The mock's width: Download shows on the toolbar.
            await builder.evaluate((root) => { (root as HTMLElement).style.width = "1240px"; });
            await settled(page);
            await builder.locator("[data-query-download]").first().click();
            const download = page.waitForEvent("download");
            await page.locator("[data-query-download-format='csv']").first().click();
            await download;
            await expect(builder.locator("[data-query-strips] [data-tone='note']")).toBeVisible();
            await settled(page);
            const closes = await partIcons(page, row, "[data-query-strips] [data-tone='note'] button[aria-label='Close']");
            expect([closes.length, unlike(closes, "xmark", [24, 24], [14, 14])], "the note's close not a 14px xmark in its 24px button").toEqual([1, []]);
        });

        test(`the ontology node drawer's type picker draws a 16px chevron in its 16 × 36 indicator (${theme})`, async ({ page }) => {
            test.setTimeout(120_000);
            const row = await openExample(page, "e3/ontology/ontology/supplyChainOntology", theme);
            const nodes = page.locator(row).locator(".react-flow__node");
            await expect(nodes.first()).toBeVisible({ timeout: 30_000 });
            await settled(page);
            // A node's double click opens its drawer: the first node a pointer reaches, as Playwright's trial finds it — the minimap covers some.
            let reached: Locator | undefined;
            for (const node of await nodes.all()) {
                if (await node.dblclick({ trial: true, timeout: 2_000 }).then(() => true, () => false)) { reached = node; break; }
            }
            expect(reached, "no node a pointer reaches").toBeDefined();
            await reached!.dblclick();
            await expect(page.locator("[class*='native-select__indicator']").first()).toBeVisible();
            await settled(page);
            const pickers = await partIcons(page, "", "[class*='native-select__indicator']");
            expect([pickers.length, unlike(pickers, "chevron-down", [16, 36], [16, 16])], "the type picker's chevron not 16px in its 16 × 36 indicator").toEqual([1, []]);
        });
    }
});

test.describe("every icon is a Font Awesome solid icon, never a text glyph (#1263)", () => {
    for (const theme of ["light", "dark"] as const) {
        for (const file of FILES) {
            test(`${file} (${theme})`, async ({ page }) => {
                const pageErrors: string[] = [];
                page.on("pageerror", (e) => pageErrors.push(String(e)));
                await page.goto(`/?theme=${theme}#${encodeURIComponent(file)}`);
                await page.waitForSelector("header", { timeout: 20_000 });
                await expect(page.locator(`a[href^="#${file}/"]`).first()).toBeVisible();
                await settled(page);
                const walked = await walk(page, file);
                expect(walked.examples.sort(), `the examples of ${file} the walk read`).toEqual(declared(file));
                expect(walked.glyphs, `an element of ${file} draws a text glyph as its icon`).toEqual([]);
                expect(pageErrors, `uncaught page errors on ${file}`).toEqual([]);
            });
        }
    }
});
