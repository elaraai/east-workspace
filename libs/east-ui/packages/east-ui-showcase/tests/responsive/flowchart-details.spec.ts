/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Flowchart's details in a real browser (#1510, `Flowchart Records
 * Spec.md` R22–R41 and §4, its visual spec `Flowchart Records Spec.html`), on
 * the parcel depot's flowchart and the support desk's minutes in state — a bar
 * a bin, and drawn to scale — in both themes — the details hold colours of
 * their own — with no screenshot:
 *
 * - **Drawn whole**, at the desktop's width and a phone's: every read inside
 *   its card and every part of it inside the read; no tag cut — past its list,
 *   or its words past its box; three lines a tag list at most; every bar inside
 *   its band, drawing some width, and clear of the next — one too thin for the
 *   room between them, on a linear axis, flush with it; every tick clear of the next and inside its
 *   axis — on the app's bins and ticks, and its own words for them, on both
 *   scales; and no transition's label on a card, nor a line of it past its
 *   box.
 * - **The visual spec's measures**, at the desktop's width: a card's head, its
 *   rule, its padding and its reads 12 apart; a figure's line; a tag's height,
 *   spacing, wrapping and look; the bars' height and spacing, and their axis; a
 *   list row's name, track and share; *no data* and *none*; a label's lines;
 *   the legend's rows and its groups of tags; the inspector's figures, tags,
 *   histogram, list rows, Show n more and Show fewer; and a card hovered and
 *   selected, and a selected transition's label — each size and gap in px,
 *   each type its font, size, weight, case and spacing, each colour the
 *   theme's token as the page resolves it.
 *
 * Locally: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test flowchart-details`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { midLine, openFlowchart } from "./flowchart-page";
import { settled } from "./settle";
import { token } from "./tokens";

/** The themes: the details hold colours of their own (`themes.ts`). */
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

/** The depot's flowchart, and what draws once its rows' details land: sort chutes' parcels. */
const DEPOT = { name: "flowchartDepot", landed: "[data-flowchart-node='CH*'] [data-card-value]" } as const;
/** The desk's minutes in state, in the app's bins and words, a bar a bin, and what draws once they land: a card's bars. */
const MINUTES = { name: "flowchartTicketMinutes", landed: "[data-card-bars]" } as const;
/** The same bins drawn to scale: each bar as wide as its span. */
const MINUTES_LINEAR = { name: "flowchartTicketMinutesLinear", landed: "[data-card-bars]" } as const;

/** A frame wide enough to pin the inspector, 320 wide, beside main. */
const WIDE = 1200;

/** Two lengths the same, to half a pixel. */
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 0.5;

/**
 * Opens an example and waits until every drawn row's details have landed: what
 * draws once they do is in sight, and no card or label draws a placeholder.
 */
async function openLanded(page: Page, example: { readonly name: string; readonly landed: string }, theme: Theme): Promise<Locator> {
    const { root } = await openFlowchart(page, example.name, theme);
    await expect(root.locator(example.landed).first()).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => root.locator("[data-flowchart-node] [data-place], [data-flowchart-label] [data-line=placeholder]").count(),
        `${example.name}: every drawn row's details landed`).toBe(0);
    await settled(page);
    return root;
}

/** The theme's colours the details are drawn in, by their tokens' CSS names, as the page resolves them. */
async function coloursOf(page: Page) {
    const names = [
        "fg", "fg-strong", "fg-muted", "fg-subtle", "bg-surface", "bg-canvas", "bg-subtle",
        "border-subtle", "border-strong", "brand-solid", "brand-pressed",
    ] as const;
    const values = await Promise.all(names.map((name) => token(page, name)));
    return Object.fromEntries(names.map((name, i) => [name, values[i]!])) as { readonly [N in (typeof names)[number]]: string };
}

/** The theme's two fonts, as the page resolves them. */
function fontsOf(page: Page): Promise<{ mono: string; body: string }> {
    return page.evaluate(() => {
        const font = (name: string) => {
            const probe = document.createElement("span");
            probe.style.fontFamily = `var(--chakra-fonts-${name})`;
            document.body.appendChild(probe);
            const family = getComputedStyle(probe).fontFamily;
            probe.remove();
            return family;
        };
        return { mono: font("mono"), body: font("body") };
    });
}

/** A tag's three colours: its fill, its rule and its words. */
interface TagColours {
    readonly background: string;
    readonly border: string;
    readonly color: string;
}

/**
 * The wash a subtle tag in a palette draws (R30): a 6% wash of the palette's
 * solid on a 1px rule of it, its words the palette's text step — as the page
 * resolves them, and whether the palette's tokens are defined.
 */
function washOf(page: Page, palette: string): Promise<TagColours & { readonly defined: boolean }> {
    return page.evaluate((p) => {
        const probe = document.createElement("span");
        probe.style.background = `color-mix(in oklch, var(--chakra-colors-${p}-solid) 6%, transparent)`;
        probe.style.borderColor = `var(--chakra-colors-${p}-solid)`;
        probe.style.color = `var(--chakra-colors-${p}-fg)`;
        document.body.appendChild(probe);
        const s = getComputedStyle(probe);
        const out = {
            background: s.backgroundColor, border: s.borderTopColor, color: s.color,
            defined: s.getPropertyValue(`--chakra-colors-${p}-solid`).trim() !== "" && s.getPropertyValue(`--chakra-colors-${p}-fg`).trim() !== "",
        };
        probe.remove();
        return out;
    }, palette);
}

/**
 * What the design system's Tag draws a tag in that is given a palette (R30,
 * the Tag's `colored`): solid, the palette's fill on a rule of it, its words
 * the palette's contrast; outline, the surface on a 1px rule of the palette's
 * edge, its words the palette's text step — as the page resolves them, and
 * whether the palette's tokens are defined.
 */
function colouredOf(page: Page, palette: string, variant: "solid" | "outline"): Promise<TagColours & { readonly defined: boolean }> {
    return page.evaluate(([p, v]) => {
        const roles = v === "solid" ? ["solid", "solid", "contrast"] : ["border", "fg"];
        const probe = document.createElement("span");
        probe.style.background = v === "solid" ? `var(--chakra-colors-${p}-solid)` : "var(--chakra-colors-bg-surface)";
        probe.style.borderColor = `var(--chakra-colors-${p}-${v === "solid" ? "solid" : "border"})`;
        probe.style.color = `var(--chakra-colors-${p}-${v === "solid" ? "contrast" : "fg"})`;
        document.body.appendChild(probe);
        const s = getComputedStyle(probe);
        const out = {
            background: s.backgroundColor, border: s.borderTopColor, color: s.color,
            defined: roles.every((role) => s.getPropertyValue(`--chakra-colors-${p}-${role}`).trim() !== ""),
        };
        probe.remove();
        return out;
    }, [palette, variant] as const);
}

/** A text's look as the page computes it: its font, size, weight, line height, case, letter spacing, slant and colour. */
function lookOf(el: Element) {
    const s = getComputedStyle(el);
    return {
        font: s.fontFamily, size: s.fontSize, weight: s.fontWeight, line: s.lineHeight,
        case: s.textTransform, spacing: s.letterSpacing, style: s.fontStyle, color: s.color,
    };
}

/**
 * Each tag's box and look as the page computes them, and the card's line it is
 * on: its type and the colour of its words as the element holding them draws
 * them — the tag itself, or a part inside it that takes a type of its own.
 */
function tagsOf(els: Element[]) {
    return els.map((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const w = getComputedStyle(document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode()?.parentElement ?? el);
        return {
            text: el.textContent ?? "", look: el.getAttribute("data-look"), line: el.parentElement?.getAttribute("data-tag-line") ?? null,
            left: r.left, right: r.right, top: r.top, height: Math.round(r.height * 100) / 100, width: r.width,
            font: w.fontFamily, size: w.fontSize, weight: w.fontWeight, padding: [s.paddingLeft, s.paddingRight], border: s.borderTopWidth, radius: s.borderTopLeftRadius,
            colours: { background: s.backgroundColor, border: s.borderTopColor, color: w.color }, shadow: s.boxShadow,
        };
    });
}
type Tag = ReturnType<typeof tagsOf>[number];

/** Tags in their order, 4 apart where two stand on one line. */
function spacingFaults(tags: readonly Tag[]): string[] {
    return tags.flatMap((tag, i) => {
        const next = tags[i + 1];
        return next !== undefined && near(next.top, tag.top) && !near(next.left - tag.right, 4) ? [`${tag.text} → ${next.text}: ${next.left - tag.right}`] : [];
    });
}

/**
 * What is wrong with the details the canvas draws (R25–R32, R40): each read
 * not inside its card, or a part of it not inside the read; a tag cut — past
 * its list, or its words past its box; a tag list past three lines; a bar past
 * its band, or on the next; a tick on the next, or past its axis; and a
 * transition's label on a card, or a line of it past its box. Each fault, in
 * words; none for details drawn whole.
 *
 * @param root - The flowchart's root
 * @returns The faults
 */
function detailsFaults(root: Locator): Promise<string[]> {
    return root.evaluate((el) => {
        const faults: string[] = [];
        const inside = (b: DOMRect, p: DOMRect) => b.left >= p.left - 0.5 && b.right <= p.right + 0.5 && b.top >= p.top - 0.5 && b.bottom <= p.bottom + 0.5;
        const named = (part: Element) => [...part.attributes].find((a) => a.name.startsWith("data-"))?.name ?? part.tagName.toLowerCase();
        const cards = [...el.querySelectorAll<HTMLElement>("[data-flowchart-node][data-details]")];
        if (cards.length === 0) faults.push("no card draws details");
        for (const card of cards) {
            const key = card.getAttribute("data-flowchart-node")!;
            const c = card.getBoundingClientRect();
            const reads = [...card.querySelectorAll<HTMLElement>("[data-card-read]")];
            if (reads.length === 0) faults.push(`${key}: no read`);
            for (const read of reads) {
                const at = `${key} read ${read.getAttribute("data-card-read")}`;
                const r = read.getBoundingClientRect();
                if (!inside(r, c)) faults.push(`${at} leaves its card`);
                for (const part of read.querySelectorAll("*")) {
                    const b = part.getBoundingClientRect();
                    if (b.width > 0 && b.height > 0 && !inside(b, r)) faults.push(`${at}: its ${named(part)} leaves the read`);
                }
            }
            // No tag cut, and three lines a list at most.
            for (const list of card.querySelectorAll<HTMLElement>("[data-tag-lines]")) {
                const l = list.getBoundingClientRect();
                const lines = list.querySelectorAll("[data-tag-line]").length;
                if (lines > 3) faults.push(`${key}: a tag list of ${lines} lines`);
                for (const tag of list.querySelectorAll<HTMLElement>("[data-flowchart-tag], [data-flowchart-more]")) {
                    const name = tag.getAttribute("data-flowchart-tag") ?? tag.textContent ?? "";
                    if (!inside(tag.getBoundingClientRect(), l)) faults.push(`${key}: ${name} past its list`);
                    for (const words of [tag, ...tag.querySelectorAll<HTMLElement>("*")]) {
                        if (words.scrollWidth > words.clientWidth + 0.5) faults.push(`${key}: ${name}'s words cut`);
                    }
                }
            }
            // Every bar inside its band, clear of the next — but a bar too thin for the room between them, drawn flush
            // on a linear axis, which may meet its neighbour, over it by its least pixel at most.
            for (const band of card.querySelectorAll<HTMLElement>("[data-card-bars]")) {
                const b = band.getBoundingClientRect();
                const bars = [...band.querySelectorAll<HTMLElement>("[data-bin]")]
                    .map((bar) => ({ bin: bar.getAttribute("data-bin"), flush: bar.hasAttribute("data-flush"), r: bar.getBoundingClientRect() }))
                    .sort((x, y) => x.r.left - y.r.left);
                if (bars.length === 0) faults.push(`${key}: bars with no bar`);
                bars.forEach((bar, i) => {
                    if (!inside(bar.r, b)) faults.push(`${key}: bar ${bar.bin} past its band`);
                    if (bar.r.width < 0.5) faults.push(`${key}: bar ${bar.bin} draws no width`);
                    const next = bars[i + 1];
                    const over = next === undefined ? undefined : bar.r.right - next.r.left;
                    if (over !== undefined && (bar.flush || next!.flush ? over > 1.5 : over > -0.5)) faults.push(`${key}: bar ${bar.bin} on bar ${next!.bin}`);
                });
            }
            // Every tick clear of the next, inside its axis.
            for (const axis of card.querySelectorAll<HTMLElement>("[data-card-axis]")) {
                const a = axis.getBoundingClientRect();
                const ticks = [...axis.querySelectorAll<HTMLElement>("[data-tick]")]
                    .map((tick) => ({ text: tick.textContent, r: tick.getBoundingClientRect() }))
                    .sort((x, y) => x.r.left - y.r.left);
                if (ticks.length === 0) faults.push(`${key}: an axis with no tick`);
                ticks.forEach((tick, i) => {
                    if (tick.r.left < a.left - 0.5 || tick.r.right > a.right + 0.5) faults.push(`${key}: tick ${tick.text} past its axis`);
                    const next = ticks[i + 1];
                    if (next !== undefined && tick.r.right > next.r.left - 0.5) faults.push(`${key}: tick ${tick.text} on tick ${next.text}`);
                });
            }
        }
        // No label on a card, and its lines inside its box.
        const boxes = [...el.querySelectorAll<HTMLElement>("[data-flowchart-node]")]
            .map((card) => ({ key: card.getAttribute("data-flowchart-node")!, r: card.getBoundingClientRect() }));
        for (const label of el.querySelectorAll<SVGGElement>("g[data-flowchart-label]")) {
            const key = label.getAttribute("data-flowchart-label")!;
            const box = label.querySelector(":scope > rect:not([data-line])")!.getBoundingClientRect();
            for (const line of label.querySelectorAll(":scope > text, :scope > rect[data-line]")) {
                if (!inside(line.getBoundingClientRect(), box)) faults.push(`${key}'s label: "${line.textContent}" past its box`);
            }
            for (const card of boxes) {
                const on = box.left < card.r.right && box.right > card.r.left && box.top < card.r.bottom && box.bottom > card.r.top;
                if (on) faults.push(`${key}'s label on ${card.key}`);
            }
        }
        return faults;
    });
}

/** Clicks a transition's line halfway along it, scrolled into the canvas's view. */
async function clickLine(page: Page, root: Locator, key: string): Promise<void> {
    await root.locator(`[data-flowchart-link='${key}']`).scrollIntoViewIfNeeded();
    const at = await midLine(root, key);
    await page.mouse.click(at.x, at.y);
    await settled(page);
}

test.describe("The details drawn whole (R25–R32, R40)", () => {
    for (const theme of THEMES) {
        for (const example of [DEPOT, MINUTES, MINUTES_LINEAR]) {
            test(`${example.name}: every read inside its card and its parts inside it, no tag cut, three lines a tag list at most, every bar inside its band and clear of the next, every tick clear of the next and inside its axis, and no label on a card (${theme})`, async ({ page }) => {
                const root = await openLanded(page, example, theme);
                expect(await detailsFaults(root)).toEqual([]);
            });
        }
    }
});

test.describe("The details as the visual spec measures them (R22–R39, §4)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured at the desktop's width; the phone keeps the card's size");

    for (const theme of THEMES) {
        test(`a card: its head, its rule and padding, its reads 12 apart — a figure's line, tags in their looks and wrapping, bars and their axis, a list's rows (${theme})`, async ({ page }) => {
            const root = await openLanded(page, DEPOT, theme);
            const c = await coloursOf(page);
            const f = await fontsOf(page);
            const card = root.locator("[data-flowchart-node='CH*']");
            // The card: 272 wide in a 1px --rule-strong edge, r6, on --paper; its head 54 inside its edge, 12 in, its name's line
            // over its key 4 apart, centred down; the rule under it, then each read 12 apart inside 12 of padding.
            const frame = await card.evaluate((el) => {
                const q = (n: number) => Math.round(n * 100) / 100;
                const s = getComputedStyle(el);
                const box = (sel: string) => el.querySelector(sel)!.getBoundingClientRect();
                const c = el.getBoundingClientRect();
                const head = box("[data-card-head]");
                const title = el.querySelector("[data-card-name]")!.parentElement!.getBoundingClientRect();
                const key = box("[data-card-key]");
                const body = box("[data-card-body]");
                const bs = getComputedStyle(el.querySelector("[data-card-body]")!);
                const reads = [...el.querySelectorAll("[data-card-read]")].map((read) => read.getBoundingClientRect());
                return {
                    width: q(c.width), edge: [s.borderTopWidth, s.borderTopStyle, s.borderTopColor], radius: s.borderTopLeftRadius, background: s.backgroundColor,
                    head: [q(head.top - c.top), q(head.height), getComputedStyle(el.querySelector("[data-card-head]")!).paddingLeft],
                    title: q(title.height), gap: q(key.top - title.bottom), centred: Math.abs((title.top - head.top) - (head.bottom - key.bottom)) <= 0.5,
                    rule: [q(body.top - head.bottom), bs.borderTopWidth, bs.borderTopStyle, bs.borderTopColor, bs.padding],
                    first: q(reads[0]!.top - body.top), between: reads.slice(1).map((r, i) => q(r.top - reads[i]!.bottom)), last: q(c.bottom - reads[reads.length - 1]!.bottom),
                };
            });
            expect(frame).toEqual({
                width: 272, edge: ["1px", "solid", c["border-strong"]], radius: "6px", background: c["bg-surface"],
                head: [1, 54, "12px"], title: 16, gap: 4, centred: true,
                rule: [0, "1px", "solid", c["border-subtle"], "12px"],
                first: 13, between: [12, 12, 12, 12, 12], last: 13,
            });
            // Its name, its ×n and its key.
            expect(await card.locator("[data-card-name]").evaluate(lookOf)).toMatchObject({ font: f.body, size: "13px", weight: "500", line: "16px", color: c.fg });
            const members = await card.locator("[data-flowchart-members]").evaluate((el) => {
                const s = getComputedStyle(el);
                return { text: el.textContent, font: s.fontFamily, size: s.fontSize, weight: s.fontWeight, color: s.color, background: s.backgroundColor, height: el.getBoundingClientRect().height, radius: s.borderTopLeftRadius };
            });
            expect(members).toEqual({ text: "×14", font: f.mono, size: "10px", weight: "600", color: c["fg-strong"], background: c["bg-subtle"], height: 16, radius: "4px" });
            expect(await card.locator("[data-card-key]").evaluate(lookOf)).toMatchObject({ font: f.mono, size: "10px", weight: "400", line: "14px", color: c["fg-subtle"] });

            // A read's label: mono 9.5/600, 0.14em apart, in capitals, --ink-4.
            const label = { font: f.mono, size: "9.5px", weight: "600", case: "uppercase", spacing: "1.33px", color: c["fg-subtle"] };
            // A figure's line, 16: its label, then its value and its unit at its end, 4 apart.
            const figure = card.locator("[data-card-read='0']");
            expect(await figure.locator("[data-read-label]").evaluate(lookOf)).toMatchObject({ ...label, line: "14px" });
            const value = await figure.evaluate((el) => {
                const q = (n: number) => Math.round(n * 100) / 100;
                const r = el.getBoundingClientRect();
                const group = el.querySelector("[data-card-value]")!;
                const [number, unit] = [...group.children].map((part) => part.getBoundingClientRect());
                return { height: q(r.height), end: q(r.right - group.getBoundingClientRect().right), gap: q(unit!.left - number!.right) };
            });
            expect(value).toEqual({ height: 16, end: 0, gap: 4 });
            expect(await figure.locator("[data-card-value] > *").evaluateAll((els) => els.map((part) => {
                const s = getComputedStyle(part);
                return { text: part.textContent, font: s.fontFamily, size: s.fontSize, weight: s.fontWeight, color: s.color };
            }))).toEqual([
                { text: "18,290", font: f.mono, size: "11px", weight: "500", color: c.fg },
                { text: "parcels", font: f.mono, size: "10px", weight: "400", color: c["fg-subtle"] },
            ]);

            // The tag lists, one after another sharing a label column, each 8 beside it; each tag 15 high, mono 9.5/500, 4 in, r4,
            // a 1px rule, 4 apart on a line and each line 4 under the last; a line as full as the column lets it.
            const lists = await Promise.all(["2", "3", "4"].map(async (index) => {
                const read = card.locator(`[data-card-read='${index}']`);
                const shape = await read.evaluate((el) => {
                    const q = (n: number) => Math.round(n * 100) / 100;
                    const label = el.querySelector("[data-read-label]")!;
                    const l = label.getBoundingClientRect();
                    const column = el.querySelector("[data-tag-lines]")!.getBoundingClientRect();
                    const lines = [...el.querySelectorAll("[data-tag-line]")].map((line) => line.getBoundingClientRect());
                    return {
                        height: q(el.getBoundingClientRect().height), label: l.width, line: getComputedStyle(label).lineHeight, start: q(column.left - l.right), right: column.right,
                        lines: lines.map((line) => q(line.height)), apart: lines.slice(1).map((line, j) => q(line.top - lines[j]!.bottom)),
                    };
                });
                const tags = await read.locator("[data-flowchart-tag], [data-flowchart-more]").evaluateAll(tagsOf);
                const lines = [...new Set(tags.map((tag) => tag.line))].map((line) => tags.filter((tag) => tag.line === line));
                return { index, ...shape, tags: lines };
            }));
            const widths = lists.map((list) => list.label);
            expect(widths.every((w) => near(w, widths[0]!)), `the label column: ${widths.join(", ")}`).toBe(true);
            for (const list of lists) {
                const at = `tag list ${list.index}`;
                expect([list.line, list.start, list.lines.every((h) => h === 15), list.apart.every((gap) => gap === 4), list.tags.length], at).toEqual(["15px", 8, true, true, list.lines.length]);
                expect(list.height, at).toBe(15 * list.lines.length + 4 * (list.lines.length - 1));
                for (const [l, line] of list.tags.entries()) {
                    for (const tag of line) {
                        expect([tag.height, tag.font, tag.size, tag.weight, tag.padding, tag.border, tag.radius, tag.right <= list.right + 0.5], `${at}: ${tag.text}`)
                            .toEqual([15, f.mono, "9.5px", "500", ["4px", "4px"], "1px", "4px", true]);
                    }
                    expect(spacingFaults(line), at).toEqual([]);
                    const before = list.tags[l - 1];
                    if (before !== undefined) expect(before[before.length - 1]!.right + 4 + line[0]!.width > list.right + 0.5, `${at}: line ${l} wraps as late as it can`).toBe(true);
                }
            }
            // Each tag in its definition's look: subtle in a palette a wash of it, gray the neutral look, solid the Tag recipe's
            // in its palette.
            const tags = new Map(lists.flatMap((list) => list.tags.flat()).map((tag) => [tag.text, tag]));
            for (const [tag, palette] of [["At risk", "warning"], ["Conveyor", "teal"], ["Scanner", "blue"], ["Early", "yellow"], ["Late", "orange"]] as const) {
                const wash = await washOf(page, palette);
                expect([wash.defined, tags.get(tag)?.look, tags.get(tag)?.colours], tag).toEqual([true, "wash", { background: wash.background, border: wash.border, color: wash.color }]);
            }
            expect([tags.get("Weekend")?.look, tags.get("Weekend")?.colours]).toEqual(["neutral", { background: c["bg-subtle"], border: c["border-subtle"], color: c["fg-muted"] }]);
            const night = await colouredOf(page, "purple", "solid");
            expect([night.defined, tags.get("Night")?.look, tags.get("Night")?.colours]).toEqual([true, "recipe", { background: night.background, border: night.border, color: night.color }]);

            // The bars: under their title, 4 apart, 28 high on a 1px --rule, each --brand-d, 2 short of the next, the tallest 27;
            // the axis 4 under them, 12 high, its first tick at its start.
            const histogram = card.locator("[data-card-read='5']");
            expect(await histogram.locator("[data-read-label]").evaluate(lookOf)).toMatchObject({ ...label, line: "14px" });
            const bars = await histogram.evaluate((el) => {
                const q = (n: number) => Math.round(n * 100) / 100;
                const title = el.querySelector("[data-read-label]")!.getBoundingClientRect();
                const band = el.querySelector("[data-card-bars]")!;
                const b = band.getBoundingClientRect();
                const s = getComputedStyle(band);
                const axis = el.querySelector("[data-card-axis]")!.getBoundingClientRect();
                const drawn = [...band.querySelectorAll<HTMLElement>("[data-bin]")].map((bar) => ({
                    bin: Number(bar.getAttribute("data-bin")), r: bar.getBoundingClientRect(), background: getComputedStyle(bar).backgroundColor,
                }));
                const ticks = [...el.querySelectorAll("[data-card-axis] [data-tick]")];
                return {
                    title: q(title.height), under: q(b.top - title.bottom), height: q(b.height), rule: [s.borderBottomWidth, s.borderBottomStyle, s.borderBottomColor],
                    backgrounds: [...new Set(drawn.map((bar) => bar.background))], tallest: q(Math.max(...drawn.map((bar) => bar.r.height))),
                    floor: drawn.every((bar) => Math.abs(b.bottom - 1 - bar.r.bottom) <= 0.5),
                    widths: drawn.every((bar) => Math.abs(bar.r.width - drawn[0]!.r.width) <= 0.5),
                    gaps: drawn.slice(1).every((bar, i) => bar.bin !== drawn[i]!.bin + 1 || Math.abs(bar.r.left - drawn[i]!.r.right - 2) <= 0.5),
                    axis: [q(axis.top - b.bottom), q(axis.height)], first: q(ticks[0]!.getBoundingClientRect().left - axis.left), ticks: ticks.length,
                };
            });
            expect(bars).toEqual({
                title: 14, under: 4, height: 28, rule: ["1px", "solid", c["border-subtle"]], backgrounds: [c["brand-solid"]], tallest: 27,
                floor: true, widths: true, gaps: true, axis: [4, 12], first: 0, ticks: 5,
            });
            expect(await histogram.locator("[data-tick]").first().evaluate(lookOf)).toMatchObject({ font: f.mono, size: "9.5px", weight: "400", line: "12px", color: c["fg-subtle"] });

            // A list: its title, then a row 4 under it and each 4 apart, 16 high — its name, a 56 track filled to its share,
            // 8 apart, and the share in a 32 column at the row's end.
            const list = card.locator("[data-card-read='6']");
            expect(await list.locator("[data-read-label]").evaluate(lookOf)).toMatchObject({ ...label, line: "14px" });
            const rows = await list.evaluate((el) => {
                const q = (n: number) => Math.round(n * 100) / 100;
                const title = el.querySelector("[data-read-label]")!.getBoundingClientRect();
                const rows = [...el.querySelectorAll("[data-list-row]")];
                return rows.map((row, i) => {
                    const r = row.getBoundingClientRect();
                    const [name, track, share] = [...row.children];
                    const t = track!.getBoundingClientRect();
                    const fill = track!.firstElementChild!;
                    const before = i === 0 ? title : rows[i - 1]!.getBoundingClientRect();
                    return {
                        above: q(r.top - before.bottom), height: q(r.height), name: q(name!.getBoundingClientRect().left - r.left),
                        track: [q(t.width), q(t.height), getComputedStyle(track!).backgroundColor],
                        fill: [Math.round((fill.getBoundingClientRect().width / t.width) * 100), getComputedStyle(fill).backgroundColor],
                        share: [share!.textContent, q(r.right - share!.getBoundingClientRect().right), q(r.right - t.right)],
                    };
                });
            });
            expect(rows).toEqual([
                { above: 4, height: 16, name: 0, track: [56, 4, c["border-subtle"]], fill: [57, c["brand-solid"]], share: ["57%", 0, 40] },
                { above: 4, height: 16, name: 0, track: [56, 4, c["border-subtle"]], fill: [24, c["brand-solid"]], share: ["24%", 0, 40] },
            ]);
            expect(await list.locator("[data-list-row] > :first-child").first().evaluate(lookOf)).toMatchObject({ font: f.body, size: "12.5px", weight: "400", line: "16px", color: c["fg-strong"] });
            expect(await list.locator("[data-list-row] > :last-child").first().evaluate(lookOf)).toMatchObject({ font: f.mono, size: "10.5px", weight: "500", color: c.fg });
        });

        test(`no data and none; a transition's label lines under its evidence; the legend's rows and its groups of tags (${theme})`, async ({ page }) => {
            const root = await openLanded(page, DEPOT, theme);
            const c = await coloursOf(page);
            const f = await fontsOf(page);
            // No data — a row there is none of — and none — a list with no tags: mono 10 italic --ink-4, 16 under a title or on a
            // figure's line, 15 in a tag list's place.
            const empty = { font: f.mono, size: "10px", weight: "400", style: "italic", color: c["fg-subtle"] };
            const nothing = root.locator("[data-flowchart-node='DSP'] [data-card-empty]");
            expect(await nothing.evaluateAll((els) => els.map((el) => [el.textContent, getComputedStyle(el).lineHeight])))
                .toEqual([["no data", "16px"], ["no data", "15px"], ["no data", "15px"], ["no data", "15px"], ["no data", "16px"], ["no data", "16px"]]);
            for (const look of await nothing.evaluateAll((els) => els.map((el) => {
                const s = getComputedStyle(el);
                return { font: s.fontFamily, size: s.fontSize, weight: s.fontWeight, style: s.fontStyle, color: s.color };
            }))) expect(look).toEqual(empty);
            const none = root.locator("[data-flowchart-node='ARV'] [data-card-read='2'] [data-card-empty]");
            expect([await none.textContent(), await none.evaluate(lookOf)]).toEqual(["none", expect.objectContaining({ ...empty, line: "15px" })]);

            // A label: its evidence line, then its details' line 13 under it, mono 10 in --ink-3; its box 18, and 13 a line more.
            const lines = await root.locator("g[data-flowchart-label='l1']").evaluate((g) => {
                const look = (el: Element) => { const s = getComputedStyle(el); return { font: s.fontFamily, size: s.fontSize, weight: s.fontWeight, fill: s.fill }; };
                const evidence = g.querySelector(":scope > text:not([data-line])")!;
                const detail = g.querySelector(":scope > text[data-line=detail]")!;
                return {
                    box: Number(g.querySelector(":scope > rect:not([data-line])")!.getAttribute("height")),
                    under: Number(detail.getAttribute("y")) - Number(evidence.getAttribute("y")),
                    evidence: look(evidence), detail: { ...look(detail), text: detail.textContent },
                };
            });
            expect(lines).toEqual({
                box: 18 + 13, under: 13,
                evidence: expect.objectContaining({ font: f.mono, size: "10px", weight: "600" }),
                detail: { font: f.mono, size: "10px", weight: "400", fill: c["fg-muted"], text: "Metro 46%" },
            });

            // The legend: 10 and 14 of padding in a 1px --rule-strong edge, r6, on --paper; its rows' column, then each group
            // 24 beside it; its title mono 9/600, 2 apart, in capitals, --ink-4; every row 16 high, 6 under the last, each
            // read's mark 28 × 16, its words 10.5 in --ink-3.
            const legend = root.locator("[data-flowchart-legend]");
            const chrome = await legend.evaluate((el) => {
                const q = (n: number) => Math.round(n * 100) / 100;
                const s = getComputedStyle(el);
                const rows = el.querySelector("[data-legend-rows]")!.getBoundingClientRect();
                const groups = [...el.querySelectorAll("[data-legend-group]")].map((g) => g.getBoundingClientRect());
                const parts = [...el.querySelector("[data-legend-rows]")!.children].map((row) => row.getBoundingClientRect());
                return {
                    padding: s.padding, edge: [s.borderTopWidth, s.borderTopStyle, s.borderTopColor], radius: s.borderTopLeftRadius, background: s.backgroundColor,
                    beside: groups.map((g, i) => q(g.left - (i === 0 ? rows.right : groups[i - 1]!.right))),
                    rows: parts.slice(1).map((r) => q(r.height)), apart: parts.slice(1).map((r, i) => q(r.top - parts[i]!.bottom)),
                    marks: [...el.querySelectorAll("[data-legend-mark]")].map((m) => [q(m.getBoundingClientRect().width), q(m.getBoundingClientRect().height)]),
                    words: [...new Set([...el.querySelectorAll("[data-legend-read] > span:last-child")].map((w) => `${getComputedStyle(w).fontSize} ${getComputedStyle(w).color}`))],
                };
            });
            expect(chrome).toEqual({
                padding: "10px 14px", edge: ["1px", "solid", c["border-strong"]], radius: "6px", background: c["bg-surface"],
                beside: [24, 24], rows: Array<number>(8).fill(16), apart: Array<number>(8).fill(6), marks: Array.from({ length: 4 }, () => [28, 16]),
                words: [`10.5px ${c["fg-muted"]}`],
            });
            const title = { font: f.mono, size: "9px", weight: "600", case: "uppercase", spacing: "2px", color: c["fg-subtle"] };
            expect(await legend.locator("[data-legend-rows] > :first-child").evaluate(lookOf)).toMatchObject(title);
            // Each read's mark: a figure's 123 mono 9.5/600 --ink; bars --brand-d on a --rule-strong base; a list's lines --brand-d
            // and its shares --ink; a label's badge on --paper in --rule-strong, its lines --ink-2 and --ink-3.
            const marks = await legend.evaluate((el) => {
                const paint = (sel: string, prop: "fill" | "stroke") => [...new Set([...el.querySelectorAll(sel)].map((m) => getComputedStyle(m)[prop]))];
                const figure = getComputedStyle(el.querySelector("[data-legend-mark=figure] > span")!);
                return {
                    figure: [el.querySelector("[data-legend-mark=figure]")!.textContent, figure.fontFamily, figure.fontSize, figure.fontWeight, figure.color],
                    bars: [paint("[data-legend-mark=bars] [data-mark=bar]", "fill"), paint("[data-legend-mark=bars] [data-mark=base]", "stroke")],
                    lines: [paint("[data-legend-mark=lines] [data-mark=bar]", "fill"), paint("[data-legend-mark=lines] [data-mark=share]", "fill")],
                    label: [paint("[data-legend-mark=label] [data-mark=badge]", "fill"), paint("[data-legend-mark=label] [data-mark=badge]", "stroke"),
                        paint("[data-legend-mark=label] [data-mark=line]", "stroke"), paint("[data-legend-mark=label] [data-mark=detail]", "stroke")],
                };
            });
            expect(marks).toEqual({
                figure: ["123", f.mono, "9.5px", "600", c.fg],
                bars: [[c["brand-solid"]], [c["border-strong"]]],
                lines: [[c["brand-solid"]], [c.fg]],
                label: [[c["bg-surface"]], [c["border-strong"]], [c["fg-strong"]], [c["fg-muted"]]],
            });
            // Each group: its title as the legend's, then its tags at the card's size, 4 apart, wrapping inside 236, each in its look.
            const groups = legend.locator("[data-legend-group]");
            await expect(groups).toHaveCount(2);
            const looks = new Map<string, Tag>();
            for (const [g, expected] of [["Flags", ["Hazmat", "At risk", "Customs", "Oversize", "Fragile", "Cold chain"]], ["Equipment", ["Conveyor", "Scanner", "Forklift", "Label printer", "X-ray"]]] as const) {
                const group = groups.nth(g === "Flags" ? 0 : 1);
                expect(await group.locator(":scope > :first-child").evaluate(lookOf)).toMatchObject(title);
                await expect(group.locator(":scope > :first-child")).toHaveText(g);
                const width = await group.locator(":scope > :last-child").evaluate((list) => list.getBoundingClientRect().width);
                const tags = await group.locator(":scope > :last-child > *").evaluateAll(tagsOf);
                expect([tags.map((tag) => tag.text), width <= 236 + 0.5], `${g}: ${width}`).toEqual([[...expected], true]);
                for (const tag of tags) expect([tag.height, tag.font, tag.size, tag.padding], `${g}: ${tag.text}`).toEqual([15, f.mono, "9.5px", ["4px", "4px"]]);
                expect(spacingFaults(tags), g).toEqual([]);
                for (const tag of tags) looks.set(tag.text, tag);
            }
            for (const [tag, palette] of [["At risk", "warning"], ["Oversize", "orange"], ["Fragile", "purple"], ["Cold chain", "info"], ["Conveyor", "teal"], ["Scanner", "blue"]] as const) {
                const wash = await washOf(page, palette);
                expect([wash.defined, looks.get(tag)?.look, looks.get(tag)?.colours], tag).toEqual([true, "wash", { background: wash.background, border: wash.border, color: wash.color }]);
            }
            // Solid and outline, the Tag recipe's in their palettes: Hazmat filled in danger; each outline on one 1px rule of its
            // palette, no ring inside it.
            for (const [tag, palette, variant] of [
                ["Hazmat", "danger", "solid"], ["Customs", "brand", "outline"], ["Forklift", "gray", "outline"], ["Label printer", "purple", "outline"], ["X-ray", "info", "outline"],
            ] as const) {
                const look = await colouredOf(page, palette, variant);
                expect([look.defined, looks.get(tag)?.look, looks.get(tag)?.colours, looks.get(tag)?.shadow], tag)
                    .toEqual([true, "recipe", { background: look.background, border: look.border, color: look.color }, "none"]);
            }
            // Gray's edge is the design system's rule, in both themes: never the paper's step under it.
            expect(looks.get("Forklift")?.colours.border).toBe(c["border-subtle"]);
        });

        test(`the inspector's reads: the figures in the stats grid, every tag, the histogram — the bin under the pointer darkened — and its caption, a list's rows, Show n more and Show fewer (${theme})`, async ({ page }) => {
            const root = await openLanded(page, DEPOT, theme);
            const c = await coloursOf(page);
            const f = await fontsOf(page);
            await root.evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, WIDE);
            await settled(page);
            await expect(root.locator("[data-frame-slot='end']")).toHaveAttribute("data-pane-mode", "pinned");
            await root.locator("[data-flowchart-node='CH*']").click();
            await settled(page);
            const reads = root.locator("[data-frame-slot='end'] [data-inspector-reads]");
            await expect(reads).toHaveAttribute("data-reads", "landed");
            const label = { font: f.mono, size: "10px", weight: "600", case: "uppercase", spacing: "1.2px", color: c["fg-subtle"] };
            // The reads 20 apart: the stats grid — two figures side by side, 12 apart, each its value and its unit over its
            // label, 4 apart — then every other read, its title over it, 8 apart, its total at its end.
            const layout = await reads.evaluate((el) => {
                const q = (n: number) => Math.round(n * 100) / 100;
                const parts = [...el.children].map((part) => part.getBoundingClientRect());
                const stats = [...el.querySelectorAll("[data-read-stats] [data-pane-read]")].map((stat) => {
                    const v = stat.querySelector("[data-read-figure]")!.getBoundingClientRect();
                    return { r: stat.getBoundingClientRect(), under: q(stat.querySelector("[data-read-label]")!.getBoundingClientRect().top - v.bottom) };
                });
                const heads = [...el.querySelectorAll("[data-pane-read]:not([data-read=figure])")].map((read) => {
                    const head = read.firstElementChild!.getBoundingClientRect();
                    const total = read.querySelector("[data-read-total]")!.getBoundingClientRect();
                    return [q(read.children[1]!.getBoundingClientRect().top - head.bottom), q(read.getBoundingClientRect().right - total.right)];
                });
                return {
                    apart: parts.slice(1).map((r, i) => q(r.top - parts[i]!.bottom)),
                    stats: [q(stats[1]!.r.left - stats[0]!.r.right), q(stats[1]!.r.top - stats[0]!.r.top), ...stats.map((s) => s.under)],
                    heads,
                };
            });
            expect(layout).toEqual({ apart: Array<number>(6).fill(20), stats: [12, 0, 4, 4], heads: Array.from({ length: 6 }, () => [8, 0]) });
            expect(await reads.locator("[data-read-value]").first().evaluate(lookOf)).toMatchObject({ font: f.mono, size: "26px", weight: "600", line: "26px", color: c.fg });
            // Parcels' unit after its value, as a card's — mono 10/400 --ink-4 — 4 after it on its line, or at the line's start
            // under it where the column has no room, inside the figure's column either way; Still in state has none.
            const unit = await reads.locator("[data-read-stats] [data-pane-read='0']").evaluate((stat) => {
                const v = stat.querySelector("[data-read-value]")!.getBoundingClientRect();
                const el = stat.querySelector("[data-read-unit]")!;
                const u = el.getBoundingClientRect();
                const after = Math.abs(u.left - v.right - 4) <= 0.5 && u.bottom <= v.bottom + 0.5 && u.top >= v.top - 0.5;
                const under = Math.abs(u.left - v.left) <= 0.5 && u.top >= v.bottom - 0.5;
                return { text: el.textContent, placed: after || under, inside: u.right <= stat.getBoundingClientRect().right + 0.5 };
            });
            expect(unit).toEqual({ text: "parcels", placed: true, inside: true });
            expect(await reads.locator("[data-read-unit]").first().evaluate(lookOf)).toMatchObject({ font: f.mono, size: "10px", weight: "400", color: c["fg-subtle"] });
            await expect(reads.locator("[data-read-stats] [data-pane-read='1'] [data-read-unit]")).toHaveCount(0);
            expect(await reads.locator("[data-read-stats] [data-read-label]").first().evaluate(lookOf)).toMatchObject(label);
            expect(await reads.locator("[data-pane-read='5'] [data-read-label]").evaluate(lookOf)).toMatchObject(label);
            expect(await reads.locator("[data-read-total]").first().evaluate(lookOf)).toMatchObject({ font: f.mono, size: "11px", weight: "400", color: c["fg-muted"] });

            // Every tag, 20 high, mono 10/500, 8 in, r4, 4 apart, wrapping inside the pane, each in its look.
            const shifts = reads.locator("[data-pane-read='4'] [data-read-tags]");
            const right = await shifts.evaluate((el) => el.getBoundingClientRect().right);
            const tags = await shifts.locator(":scope > *").evaluateAll(tagsOf);
            expect(tags.map((tag) => tag.text)).toEqual(["Early", "Late", "Night", "Weekend"]);
            for (const tag of tags) {
                expect([tag.height, tag.font, tag.size, tag.weight, tag.padding, tag.radius, tag.right <= right + 0.5], tag.text).toEqual([20, f.mono, "10px", "500", ["8px", "8px"], "4px", true]);
            }
            expect(spacingFaults(tags)).toEqual([]);
            const [yellow, orange, purple] = [await washOf(page, "yellow"), await washOf(page, "orange"), await colouredOf(page, "purple", "solid")];
            expect(tags.map((tag) => [tag.look, tag.colours])).toEqual([
                ["wash", { background: yellow.background, border: yellow.border, color: yellow.color }],
                ["wash", { background: orange.background, border: orange.border, color: orange.color }],
                ["recipe", { background: purple.background, border: purple.border, color: purple.color }],
                ["neutral", { background: c["bg-subtle"], border: c["border-subtle"], color: c["fg-muted"] }],
            ]);

            // The histogram across the pane: bars 64 high on a 1px --rule, a slot a bin 2 short of the next, the tallest bar
            // 63, each --brand-d; the axis 4 under them, 16 high; the caption 4 under it.
            const histogram = reads.locator("[data-pane-histogram]");
            const pane = await histogram.evaluate((el) => {
                const q = (n: number) => Math.round(n * 100) / 100;
                const bars = el.querySelector("[data-pane-bars]")!;
                const b = bars.getBoundingClientRect();
                const s = getComputedStyle(bars);
                const slots = [...bars.querySelectorAll("[role=listitem]")].map((slot) => slot.getBoundingClientRect());
                const bins = [...bars.querySelectorAll("[role=listitem] > span")];
                const axis = el.querySelector("[data-pane-axis]")!.getBoundingClientRect();
                const caption = el.querySelector("[data-pane-caption]")!.getBoundingClientRect();
                return {
                    height: q(b.height), rule: [s.borderBottomWidth, s.borderBottomStyle, s.borderBottomColor], across: q(el.getBoundingClientRect().width - b.width),
                    gaps: slots.slice(1).every((r, i) => Math.abs(r.left - slots[i]!.right - 2) <= 0.5), tallest: q(Math.max(...bins.map((bin) => bin.getBoundingClientRect().height))),
                    backgrounds: [...new Set(bins.map((bin) => getComputedStyle(bin).backgroundColor))],
                    axis: [q(axis.top - b.bottom), q(axis.height)], caption: q(caption.top - axis.bottom),
                };
            });
            expect(pane).toEqual({ height: 64, rule: ["1px", "solid", c["border-subtle"]], across: 0, gaps: true, tallest: 63, backgrounds: [c["brand-solid"]], axis: [4, 16], caption: 4 });
            expect(await histogram.locator("[data-tick]").first().evaluate(lookOf)).toMatchObject({ font: f.mono, size: "10px", weight: "400", line: "16px", color: c["fg-subtle"] });
            expect(await histogram.locator("[data-pane-caption]").evaluate(lookOf)).toMatchObject({ font: f.body, size: "12.5px", weight: "400", line: "18.75px", color: c["fg-muted"] });
            // The bin under the pointer darkens to --brand-dd, the rest --brand-d, and the caption says its span, count and share.
            await histogram.locator("[role=listitem][data-bin='2']").hover();
            await expect.poll(() => histogram.locator("[role=listitem] > span").evaluateAll((bins) => bins.map((bin) => getComputedStyle(bin).backgroundColor)))
                .toEqual(Array.from({ length: 12 }, (_, i) => (i === 2 ? c["brand-pressed"] : c["brand-solid"])));
            await expect(histogram.locator("[data-pane-caption]")).toHaveText("30m – 1h · 6,218 parcels · 34%");

            // A list's rows, 8 apart: its name, its value and its share at the row's end, over a 4px track across the row.
            const service = await reads.locator("[data-pane-read='6'] [data-pane-list]").evaluate((el) => {
                const q = (n: number) => Math.round(n * 100) / 100;
                const rows = [...el.querySelectorAll("[data-list-row]")];
                return rows.map((row, i) => {
                    const r = row.getBoundingClientRect();
                    const track = row.children[3]!;
                    const t = track.getBoundingClientRect();
                    return {
                        apart: i === 0 ? 0 : q(r.top - rows[i - 1]!.getBoundingClientRect().bottom), end: q(r.right - row.children[2]!.getBoundingClientRect().right),
                        track: [q(r.width - t.width), q(t.height), getComputedStyle(track).backgroundColor, getComputedStyle(track.firstElementChild!).backgroundColor],
                    };
                });
            });
            expect(service).toEqual(Array.from({ length: 4 }, (_, i) => ({ apart: i === 0 ? 0 : 8, end: 0, track: [0, 4, c["border-subtle"], c["brand-solid"]] })));
            const row = reads.locator("[data-pane-read='6'] [data-list-row='0']");
            expect(await row.locator(":scope > :nth-child(1) > :first-child").evaluate(lookOf)).toMatchObject({ font: f.body, size: "13px", weight: "400", color: c.fg });
            expect(await row.locator(":scope > :nth-child(2)").evaluate(lookOf)).toMatchObject({ font: f.mono, size: "11px", weight: "500", color: c["fg-muted"] });
            expect(await row.locator(":scope > :nth-child(3)").evaluate(lookOf)).toMatchObject({ font: f.mono, size: "11px", weight: "600", color: c.fg });

            // A transition's Origin: each line's note 8 after its name, mono 10 --ink-4; the first 8, then Show 3 more 8 under
            // them — mono 10.5/600 in --brand-d — and Show fewer once open.
            await clickLine(page, root, "l1");
            await expect(reads).toHaveAttribute("data-reads", "landed");
            const origins = reads.locator("[data-pane-read='2']");
            expect(await origins.locator("[data-list-row='0'] > :first-child").evaluate((el) => {
                const [name, note] = [...el.children];
                const s = getComputedStyle(note!);
                return { gap: Math.round((note!.getBoundingClientRect().left - name!.getBoundingClientRect().right) * 100) / 100, text: note!.textContent, font: s.fontFamily, size: s.fontSize, color: s.color };
            })).toEqual({ gap: 8, text: "84 late", font: f.mono, size: "10px", color: c["fg-subtle"] });
            const more = origins.locator("[data-pane-more]");
            await expect(more).toHaveText("Show 3 more");
            expect(await more.evaluate((el) => {
                const s = getComputedStyle(el);
                return {
                    under: Math.round((el.getBoundingClientRect().top - el.previousElementSibling!.getBoundingClientRect().bottom) * 100) / 100,
                    font: s.fontFamily, size: s.fontSize, weight: s.fontWeight, spacing: s.letterSpacing, color: s.color,
                };
            })).toEqual({ under: 8, font: f.mono, size: "10.5px", weight: "600", spacing: "0.63px", color: c["brand-solid"] });
            await expect(origins.locator("[data-list-row]")).toHaveCount(8);
            await more.click();
            await expect(more).toHaveText("Show fewer");
            await expect(origins.locator("[data-list-row]")).toHaveCount(11);
            await more.click();
            await expect(more).toHaveText("Show 3 more");
            await expect(origins.locator("[data-list-row]")).toHaveCount(8);
        });

        test(`a card hovered on --paper-2; selected on --paper-3 in a 1px --ink edge, its ×n and neutral tags on --paper, its bars --brand-d; a selected transition's label lines --brand-dd (${theme})`, async ({ page }) => {
            const root = await openLanded(page, DEPOT, theme);
            const c = await coloursOf(page);
            const card = root.locator("[data-flowchart-node='CH*']");
            const looks = () => card.evaluate((el) => {
                const s = getComputedStyle(el);
                return {
                    background: s.backgroundColor, edge: [s.borderTopWidth, s.borderTopColor],
                    members: getComputedStyle(el.querySelector("[data-flowchart-members]")!).backgroundColor,
                    neutral: getComputedStyle(el.querySelector("[data-flowchart-tag='Weekend']")!).backgroundColor,
                    bars: [...new Set([...el.querySelectorAll("[data-card-bars] [data-bin]")].map((bar) => getComputedStyle(bar).backgroundColor))],
                };
            });
            const atRest = { background: c["bg-surface"], edge: ["1px", c["border-strong"]], members: c["bg-subtle"], neutral: c["bg-subtle"], bars: [c["brand-solid"]] };
            await expect.poll(looks).toEqual(atRest);
            await card.hover();
            await expect.poll(looks).toEqual({ ...atRest, background: c["bg-canvas"] });
            await card.click();
            await settled(page);
            await expect(card).toHaveAttribute("data-selected", "true");
            await expect.poll(looks).toEqual({ background: c["bg-subtle"], edge: ["1px", c.fg], members: c["bg-surface"], neutral: c["bg-surface"], bars: [c["brand-solid"]] });
            // A transition selected: its label's lines --brand-dd, --ink-3 before.
            const detail = () => root.locator("g[data-flowchart-label='l1'] [data-line=detail]").evaluateAll((lines) => lines.map((line) => getComputedStyle(line).fill));
            expect(await detail()).toEqual([c["fg-muted"]]);
            await clickLine(page, root, "l1");
            await expect(root.locator("g[data-flowchart-label='l1']")).toHaveAttribute("data-selected", "true");
            await expect.poll(detail).toEqual([c["brand-pressed"]]);
        });
    }
});
