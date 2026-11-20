/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A Studio page's clicks (#1673, LNK-1 to LNK-5, LNK-9, CHT-8, TBL-6, LST-3),
 * measured in a real browser over the showcase's Customers page, each visual
 * answered by e3 in the page:
 *
 *  - C1 a list's row is a button where its click does something: a pointer's
 *    hand over it, its 48px kept. A follower with nothing selected says so in
 *    its eyebrow, on its name's line, its tag in place of its meta; one that
 *    asks for a pick draws its prompt, naming the leader's field and the
 *    leader.
 *  - C2 a click selects the row — `--paper-3` — and every visual that follows
 *    narrows to it, on e3: revenue by month redraws, the margin its number,
 *    each eyebrow the customer in `--brand-d` after the link icon.
 *  - C3 ⌘-click adds a row, and the followers say both; Esc clears the
 *    selection, and they show every customer again.
 *  - C4 a click on a donut's legend row filters the page: the slice is a chip
 *    on the rail and every other visual of the source narrows, while the
 *    donut keeps its slices and marks the one clicked — the rest the muted
 *    mark, their legend rows off. ⌘-click adds a slice; a click on it again,
 *    or the chip's ×, puts them back (#1673).
 *  - C5 a click on a bar opens the page it names, narrowed: the surface shows
 *    the Region orders page, the clicked region its chip, its numbers that
 *    region's alone — its count the records' own, every row drawn of it.
 *  - C6 a records table's row takes a click: a pointer's hand over it. The
 *    clicked row is marked — `--paper-3`, as a list's is, with no checkbox —
 *    its height kept, and a click on it again clears the mark.
 *  - C7 the margin's prompt is the spec's (LNK-5): a pointer's hand at 24 in
 *    `--rule-strong`, 28 under its eyebrow at the least; what to pick, in
 *    which visual; and what it then shows, named by what it draws — 10 apart,
 *    each centred, and the three centred in the tile's body, whatever height
 *    the tile stands at (its 240px here).
 *    Its eyebrow says nothing selected after the link, its 10px icon 6 before
 *    the words, and nothing more: its menu 4 after them.
 *
 * Every measurement is taken from the laid-out page.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-clicks --project desktop`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";

/** The showcase's Customers page, whose clicks select, filter and open. */
const HASH = "e3/studio/studio/studioClicks";

/** Opens the Customers page, its list and its charts drawn, at rest. */
async function openClicks(page: Page): Promise<Locator> {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(`/?theme=light#${HASH}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator('[data-studio-placement="k-customers"] [data-studio-list-row]').first()).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => entry.locator("[data-studio-chart]").count(), { timeout: 60_000 }).toBe(3);
    await settled(page);
    return entry;
}

/** A placement's tile, by its key. */
const tile = (entry: Locator, key: string) => entry.locator(`[data-studio-placement="${key}"]`);
/** A follower's tag: what it reads of its leader, its words, how it is drawn, and whether its eyebrow draws a meta beside it. */
const followOf = (entry: Locator, key: string) => tile(entry, key).locator("[data-studio-visual-follow]").evaluate((el) => {
    const head = el.closest("[data-studio-visual-head]")!;
    const name = head.querySelector("[data-studio-visual-name]")!.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return {
        kind: el.getAttribute("data-following"), text: el.textContent, icon: el.querySelector("svg") !== null, color: getComputedStyle(el).color,
        // On its name's line: its box's middle on the name's.
        onLine: Math.abs((box.top + box.bottom) / 2 - (name.top + name.bottom) / 2) <= 0.5,
        meta: head.querySelector("[data-studio-visual-meta]") !== null,
    };
});
/** A chart's axis and label words, in order. */
const chartWords = (entry: Locator, key: string) => tile(entry, key).locator("[data-studio-chart]").evaluate((el) => [...el.querySelectorAll("svg text")].map((t) => t.textContent).join("|"));
/** The rail's chips, by their words. */
const chips = (entry: Locator) => entry.locator("[data-studio-filters] [data-slice-clause]").evaluateAll((els) => els.map((el) => el.getAttribute("title")));
/** Colours of the theme's, as the page computes them: each token by its variable's name after `--chakra-colors-`. */
const colours = (entry: Locator, tokens: readonly string[]) => entry.evaluate((el, names) => names.map((token) => {
    const probe = el.appendChild(document.createElement("span"));
    probe.style.color = `var(--chakra-colors-${token})`;
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
}), tokens);

/** `--brand-d` and `--ink-4`, as the light theme computes them. */
const BRAND = "rgb(58, 119, 128)";

test.describe("A Studio page's clicks (#1673)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    test("C1: a list's row is a button with a pointer's hand, 48px; a follower with nothing selected says so on its name's line, in place of its meta, and one that asks for a pick draws its prompt", async ({ page }) => {
        const entry = await openClicks(page);
        const rows = await tile(entry, "k-customers").locator("[data-studio-list-row]").evaluateAll((els) => els.map((el) => ({
            role: el.getAttribute("role"), pressed: el.getAttribute("aria-pressed"), cursor: getComputedStyle(el).cursor, h: el.getBoundingClientRect().height, tab: el.getAttribute("tabindex"),
        })));
        expect(rows.length).toBeGreaterThan(3);
        for (const row of rows) expect(row).toEqual({ role: "button", pressed: "false", cursor: "pointer", h: 48, tab: "0" });
        const months = await followOf(entry, "k-months");
        expect([months.kind, months.text, months.icon, months.onLine, months.meta]).toEqual(["nothing", "nothing selected", true, true, false]);
        expect(months.color).not.toBe(BRAND);
        // The margin asks for a pick: no number, a prompt naming the field and the leader.
        const margin = tile(entry, "k-margin");
        expect(await margin.locator("[data-studio-kpi-value]").count()).toBe(0);
        await expect(margin.locator("[data-studio-visual-body]")).toContainText("Pick a customer in Customers");
        await expect(margin.locator("[data-studio-visual-body]")).toContainText("This KPI shows the customer you select.");
    });

    test("C2, C3: a click selects the row and every follower narrows to it on e3, saying whom in --brand-d; ⌘-click adds one; Esc clears, and they show every customer again", async ({ page }) => {
        const entry = await openClicks(page);
        const rows = tile(entry, "k-customers").locator("[data-studio-list-row]");
        const every = await chartWords(entry, "k-months");
        const paper = await rows.first().evaluate((el) => getComputedStyle(el).backgroundColor);
        const first = (await rows.first().locator("[data-studio-list-name]").textContent())!;
        const second = (await rows.nth(1).locator("[data-studio-list-name]").textContent())!;
        await rows.first().click();
        await expect(tile(entry, "k-months").locator("[data-studio-visual-follow]")).toHaveAttribute("data-following", "selected");
        await settled(page);
        // The row is marked, and is the only one.
        const marked = await rows.evaluateAll((els) => els.map((el) => [el.hasAttribute("data-selected"), el.getAttribute("aria-pressed"), getComputedStyle(el).backgroundColor]));
        expect(marked.filter(([selected]) => selected)).toHaveLength(1);
        expect([marked[0]![0], marked[0]![1], marked[0]![2] !== paper]).toEqual([true, "true", true]);
        // Each follower says whom, and draws that customer's alone: the chart's axis is another, the margin a number.
        for (const key of ["k-months", "k-margin"]) {
            const follow = await followOf(entry, key);
            expect([follow.kind, follow.text, follow.color, follow.onLine, follow.meta], key).toEqual(["selected", first, BRAND, true, false]);
        }
        await expect.poll(() => chartWords(entry, "k-months")).not.toBe(every);
        await expect(tile(entry, "k-margin").locator("[data-studio-kpi-value]")).toHaveText(/\d+%/);

        // ⌘-click adds the second; both are said.
        await rows.nth(1).click({ modifiers: ["ControlOrMeta"] });
        await settled(page);
        expect((await followOf(entry, "k-months")).text).toBe(`${first}, ${second}`);
        expect(await rows.evaluateAll((els) => els.filter((el) => el.hasAttribute("data-selected")).length)).toBe(2);

        // Esc: nothing selected, every customer again, and the margin asks for a pick.
        await page.keyboard.press("Escape");
        await settled(page);
        expect((await followOf(entry, "k-months")).kind).toBe("nothing");
        await expect.poll(() => chartWords(entry, "k-months")).toBe(every);
        expect(await rows.evaluateAll((els) => els.filter((el) => el.hasAttribute("data-selected")).length)).toBe(0);
        await expect(tile(entry, "k-margin").locator("[data-studio-visual-body]")).toContainText("Pick a customer in Customers");
    });

    test("C4: a click on a donut's legend row filters the page — the slice a chip on the rail, every other visual of the source narrowed — while the donut keeps its slices and marks the one clicked, the rest the muted mark and their rows off; ⌘-click adds one; a click on it again, or the chip's ×, puts them back", async ({ page }) => {
        const entry = await openClicks(page);
        const rows = tile(entry, "k-customers").locator("[data-studio-list-row]");
        const all = await rows.count();
        const donut = tile(entry, "k-category").locator("[data-studio-chart]");
        const legend = donut.locator("[data-clickable]");
        const slice = (await legend.first().textContent())!;
        /** The muted mark (`--ink-5`) and `--ink-4`, as the light theme computes them. */
        const [muted, ink4] = await colours(entry, ["fg-faint", "fg-subtle"]);
        /** Each slice and each legend row as drawn: its state; a slice's fill; a row's label, its colour and weight. */
        const drawn = () => donut.evaluate((el) => {
            const state = (part: Element) => (part.hasAttribute("data-marked") ? "marked" : part.hasAttribute("data-dimmed") ? "dimmed" : "as is");
            return {
                slices: [...el.querySelectorAll("path[data-chart-slice]")].map((path) => [state(path), getComputedStyle(path).fill]),
                rows: [...el.querySelectorAll("[data-chart-slice-entry]")].map((row) => {
                    const label = getComputedStyle(row.querySelectorAll("span")[1]!);
                    return [state(row), label.color, label.fontWeight];
                }),
            };
        });
        const marking = async () => (await drawn()).slices.map(([state]) => state);
        const before = await drawn();
        expect(before.slices.every(([state]) => state === "as is")).toBe(true);
        await legend.first().click();
        await expect.poll(() => chips(entry)).toHaveLength(1);
        const [chip] = await chips(entry);
        expect(chip).toMatch(/^category is /);
        expect(slice.startsWith(chip!.slice("category is ".length))).toBe(true);
        // Every other visual of the source narrows: fewer customers bought in that category.
        await expect.poll(() => rows.count()).toBeLessThan(all);
        // The donut keeps its slices: the one clicked as it was, the rest the muted mark, their legend rows off.
        await expect.poll(async () => (await marking())[0]).toBe("marked");
        const marked = await drawn();
        expect(marked.slices.length).toBe(before.slices.length);
        expect([marked.slices[0], marked.rows[0]]).toEqual([["marked", before.slices[0]![1]], ["marked", ...before.rows[0]!.slice(1)]]);
        for (const part of marked.slices.slice(1)) expect(part).toEqual(["dimmed", muted]);
        for (const row of marked.rows.slice(1)) expect(row).toEqual(["dimmed", ink4, "500"]);
        // Nothing is selected by it: a filter is no selection.
        expect(await rows.evaluateAll((els) => els.filter((el) => el.hasAttribute("data-selected")).length)).toBe(0);
        // ⌘-click adds a slice: both marked, any of them a row may pass.
        await legend.nth(1).click({ modifiers: ["ControlOrMeta"] });
        await expect.poll(async () => (await marking()).slice(0, 2)).toEqual(["marked", "marked"]);
        expect((await chips(entry))[0]).toMatch(/^category is .+ or category is .+$/);
        // A plain click on the first takes it alone; a click on it again clears it: every slice as it was, every customer.
        await legend.first().click();
        await expect.poll(async () => (await marking()).filter((state) => state === "marked")).toHaveLength(1);
        await legend.first().click();
        await expect.poll(() => chips(entry)).toEqual([]);
        await expect.poll(() => rows.count()).toBe(all);
        await expect.poll(drawn).toEqual(before);
        // The chip's × clears the mark with the filter.
        await legend.first().click();
        await expect.poll(() => chips(entry)).toHaveLength(1);
        await entry.locator("[data-studio-filters] [data-slice-clause] [data-chip-remove]").click();
        await expect.poll(() => chips(entry)).toEqual([]);
        await expect.poll(drawn).toEqual(before);
        await expect.poll(() => rows.count()).toBe(all);
    });

    test("C5, C6: a click on a bar opens the page it names, narrowed — the region its chip, the page's numbers that region's alone — and a records row there takes a click and is marked", async ({ page }) => {
        const entry = await openClicks(page);
        await tile(entry, "k-regions").scrollIntoViewIfNeeded();
        await settled(page);
        // The first bar: the region with the most revenue. The plot takes the click where the bar stands.
        const bar = await tile(entry, "k-regions").locator("[data-studio-chart]").evaluate((el) => {
            const bars = [...el.querySelectorAll<SVGRectElement>("svg rect")].map((rect) => ({ box: rect.getBoundingClientRect(), fill: rect.getAttribute("fill") }))
                .filter((rect) => rect.fill !== null && rect.fill !== "transparent" && rect.fill !== "none" && rect.box.width > 4);
            const label = [...el.querySelectorAll("svg text")].map((t) => t.textContent)[0];
            const first = bars.sort((a, b) => a.box.top - b.box.top)[0]!.box;
            return { x: first.left + first.width / 2, y: first.top + first.height / 2, label };
        });
        await page.mouse.click(bar.x, bar.y);
        // The surface shows the Region orders page: its own placements, and the clicked region its chip.
        await expect(tile(entry, "g-records").locator("[data-studio-records='']")).toBeVisible({ timeout: 30_000 });
        await settled(page);
        expect(await entry.locator("[data-studio-placement]").evaluateAll((els) => els.map((el) => el.getAttribute("data-studio-placement")))).toEqual(["g-revenue", "g-orders", "g-records"]);
        const [chip] = await chips(entry);
        expect(chip).toMatch(/^region is [A-Z]+$/);
        const region = chip!.slice("region is ".length);
        // Its orders are that region's alone: the count is the records' own — the page's note says how many there are in
        // all, in the words the count prints — and every row drawn is of the region.
        const count = (await tile(entry, "g-orders").locator("[data-studio-kpi-value]").textContent())!;
        const orders = Number(count.replace(/\D/g, ""));
        await expect(tile(entry, "g-records").locator("[data-studio-visual-note]")).toHaveText(new RegExp(`^Showing 1–\\d+ of ${count}$`));
        const table = tile(entry, "g-records").locator("tbody tr");
        await expect.poll(() => table.count()).toBeGreaterThan(0);
        const cells = await table.evaluateAll((els) => els.map((el) => [el.textContent ?? "", getComputedStyle(el).cursor] as const));
        for (const [text, cursor] of cells) expect([text.includes(region), cursor], text).toEqual([true, "pointer"]);
        // A click marks the row: the selected row's ground, its height kept, no checkbox drawn.
        const paper3 = await entry.evaluate((el) => {
            const probe = el.appendChild(document.createElement("span"));
            probe.style.background = "var(--chakra-colors-bg-subtle)";
            const ground = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return ground;
        });
        /** Each row as drawn: whether it is marked, the ground it stands on, and its height. */
        const drawn = () => table.evaluateAll((els) => els.map((el) => ({
            marked: el.getAttribute("data-selected") === "true", ground: getComputedStyle(el.parentElement!).backgroundColor, height: el.getBoundingClientRect().height,
        })));
        const before = await drawn();
        expect(before.filter((row) => row.marked)).toEqual([]);
        await table.first().click();
        await expect.poll(async () => (await drawn())[0]!.marked).toBe(true);
        const after = await drawn();
        expect([after[0]!.ground, after[0]!.height]).toEqual([paper3, before[0]!.height]);
        for (const row of after) expect(row.ground === paper3, "only a marked row stands on the selected ground").toBe(row.marked);
        expect(await tile(entry, "g-records").locator("input").count()).toBe(0);
        await table.first().click();
        await expect.poll(async () => (await drawn()).filter((row) => row.marked).length).toBe(0);
        // Its × clears the filter: the page holds every order again.
        await entry.locator("[data-studio-filters] [data-slice-clause] [data-chip-remove]").click();
        await expect.poll(async () => Number((await tile(entry, "g-orders").locator("[data-studio-kpi-value]").textContent())!.replace(/\D/g, ""))).toBeGreaterThan(orders);
    });

    test("C7: the margin's prompt is the spec's — a pointer's hand at 24 in the strong rule; what to pick, and in which visual; what it then shows; 10 apart, each centred, the three centred in the tile's body at its height — its eyebrow nothing selected after the link, and no more", async ({ page }) => {
        const entry = await openClicks(page);
        const [strong, subtle] = await colours(entry, ["border-strong", "fg-subtle"]);
        const read = await tile(entry, "k-margin").evaluate((el) => {
            const body = el.querySelector("[data-studio-visual-body]")!.getBoundingClientRect();
            const prompt = el.querySelector("[data-studio-visual=prompt]")!;
            const icon = prompt.querySelector("svg")!;
            const title = prompt.querySelector("h4")!;
            const hint = prompt.querySelector("[data-studio-visual-hint]")!;
            const [mark, head, line] = [icon, title, hint].map((part) => part.getBoundingClientRect());
            const middle = (body.left + body.right) / 2;
            const type = (part: Element) => {
                const look = getComputedStyle(part);
                return [look.fontSize, look.lineHeight, look.fontWeight];
            };
            const tag = el.querySelector("[data-studio-visual-follow]")!;
            const [link, said] = [tag.querySelector("svg")!.getBoundingClientRect(), tag.querySelector("span")!.getBoundingClientRect()];
            const menu = el.querySelector("[data-studio-visual-menu]")!.getBoundingClientRect();
            return {
                icon: [icon.getAttribute("data-icon"), mark!.height, mark!.top - body.top >= 28, getComputedStyle(icon).color],
                // The three, its icon's top to its hint's foot, as far from the body's foot as from its top.
                middle: Math.abs((mark!.top - body.top) - (body.bottom - line!.bottom)) <= 1,
                gaps: [head!.top - mark!.bottom, line!.top - head!.bottom],
                centred: [mark!, head!, line!].map((box) => Math.abs((box.left + box.right) / 2 - middle) <= 0.5),
                title: [title.textContent, ...type(title)],
                hint: [hint.textContent, ...type(hint), getComputedStyle(hint).color],
                eyebrow: [tag.textContent, el.querySelector("[data-studio-visual-meta]")?.textContent ?? null],
                tag: [link.height, said.left - link.right, menu.left - tag.getBoundingClientRect().right],
            };
        });
        expect(read.icon).toEqual(["hand-pointer", 24, true, strong]);
        // Centred in its body, whatever height its tile stands at.
        expect(read.middle).toBe(true);
        expect(read.gaps).toEqual([10, 10]);
        expect(read.centred).toEqual([true, true, true]);
        // The leader is named by what its rows stand for; the field mid-sentence.
        expect(read.title).toEqual(["Pick a customer in Customers", "15px", "20px", "700"]);
        expect(read.hint).toEqual(["This KPI shows the customer you select.", "12.5px", "15px", "400", subtle]);
        expect(read.eyebrow).toEqual(["nothing selected", null]);
        expect(read.tag).toEqual([10, 6, 4]);
    });
});
