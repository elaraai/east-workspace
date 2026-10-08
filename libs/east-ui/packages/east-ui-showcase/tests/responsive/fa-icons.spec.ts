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
