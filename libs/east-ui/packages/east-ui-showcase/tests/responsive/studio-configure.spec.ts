/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Studio builder's Configure tab against its designed mocks, measured in
 * a real browser (#1672): each part as the spec's editor draws it, on the
 * showcase's builder with a column chart selected.
 *
 *  - C1 the head (EDT-1): `Selected visual` in mono 10 / 600 capitals on a
 *    12px line, the visual's name in the heading face at 16 / 600 on a 21px
 *    line 4px under it, then what it is — its view, its kind and its source's
 *    key — in mono 10.5 on a 13px line; padded 16.
 *  - C2 a field: its label Inter 12.5 / 500 on a 15px line, 6px over its
 *    control; the source's and the click's selects 32px boxes of radius 6
 *    inside 1px, a 14px icon, Inter 13 on a 16px line and a 10px chevron; a
 *    hint on a whole 19px line; the section's fields 12px apart.
 *  - C3 the segment groups (EDT-2, EDT-8): the view's and a chart's kinds 32px
 *    tall, their segments equal and filling the row, each a 14px icon, the
 *    chosen one on the brand's tint; an option's — the stack — 24px tall, its
 *    names mono 10.5 / 600 capitals.
 *  - C4 the wells (EDT-3 to EDT-7): 14px apart, each label mono 10 / 600 6px
 *    over its pills; a pill 32px of radius 6, padded 10 and 4, its field's
 *    kind an 11px mark in a 14px box, its name Inter 13, a value's aggregate a
 *    22px chip in mono 10 / 600 capitals on `--paper-3`, its remove 24 × 24
 *    around a 14px mark; a value's menu a head, 32px items with 11px icons —
 *    the chosen one tinted — a 1px rule and its form, a choice of three a
 *    24px segment group.
 *  - C5 the source's fields (EDT-3): under their label and a 16px count, a
 *    32px search box, then 32px rows — a 7px grip, the kind's 11px mark in a
 *    14px box, the name in Inter 13, and a 12px check in `--pos` once a well
 *    holds the field.
 *  - C6 every part stands a whole number of pixels under the tab's top
 *    (#1638), so no line of its words is painted between two rows.
 *
 * Every measurement is taken from the laid-out page, at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-configure --project desktop`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";

/** The showcase's builder over a page of visuals. */
const HASH = "e3/studio/studio/studioContent";

/** What is read of one element: its box within the tab, and how its words are set. */
interface Read {
    readonly x: number; readonly y: number; readonly w: number; readonly h: number;
    readonly size: string; readonly weight: string; readonly line: string; readonly caps: string; readonly family: string;
    readonly radius: string; readonly edge: string; readonly padStart: string; readonly padEnd: string;
    readonly color: string; readonly bg: string;
}

/**
 * Opens the builder, selects its first visual and opens the inspector on its Configure tab.
 *
 * @param page - The browser's page
 * @returns The tab
 */
async function openConfigure(page: Page): Promise<Locator> {
    await page.goto(`/?theme=light#${HASH}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const tile = entry.locator("[data-snap-grid-tile]", { has: page.locator("[data-studio-visual-tile]") }).first();
    await expect(tile).toBeVisible({ timeout: 30_000 });
    await tile.click({ position: { x: 30, y: 60 } });
    // The inspector's pane is a rail at this width: open it.
    const expand = entry.getByRole("button", { name: "Expand Inspector" });
    if (await expand.count() > 0) await expand.click();
    const tab = entry.locator("[data-studio-configure]");
    await expect(tab.locator("[data-configure=fields] [data-field-row]").first()).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return tab;
}

/**
 * Reads each element a selector finds in a root, its box measured from the root's.
 *
 * @param root - The tab, or a menu
 * @param selector - What to read
 * @returns Each element found, in order
 */
function read(root: Locator, selector: string): Promise<Read[]> {
    return root.evaluate((el, sel) => {
        const origin = el.getBoundingClientRect();
        const round = (n: number) => Math.round(n * 100) / 100;
        return [...el.querySelectorAll(sel)].map((found) => {
            const box = found.getBoundingClientRect();
            const style = getComputedStyle(found);
            return {
                x: round(box.left - origin.left), y: round(box.top - origin.top), w: round(box.width), h: round(box.height),
                size: style.fontSize, weight: style.fontWeight, line: style.lineHeight, caps: style.textTransform, family: style.fontFamily.split(",")[0]!.replace(/"/g, ""),
                radius: style.borderTopLeftRadius, edge: style.borderTopWidth, padStart: style.paddingLeft, padEnd: style.paddingRight,
                color: style.color, bg: style.backgroundColor,
            };
        });
    }, selector);
}

/** A theme colour, as the page computes it. */
function token(page: Page, name: string): Promise<string> {
    return page.evaluate((variable) => {
        const probe = document.createElement("span");
        probe.style.color = `var(${variable})`;
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
    }, name);
}

test.describe("The Studio's Configure tab, as designed (#1672)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    test("C1: the head — a small label, the name at 16 / 600 and what the visual is, 4px apart, padded 16", async ({ page }) => {
        const tab = await openConfigure(page);
        const [label, name, is] = await read(tab, "[data-inspector=selection] > span");
        expect([label!.size, label!.weight, label!.line, label!.caps]).toEqual(["10px", "600", "12px", "uppercase"]);
        expect([name!.size, name!.weight, name!.line, name!.family]).toEqual(["16px", "600", "21px", "DM Sans Variable"]);
        expect([is!.size, is!.line, is!.family]).toEqual(["10.5px", "13px", "Chivo Mono Variable"]);
        expect(await tab.locator("[data-inspector-is]").textContent()).toBe("chart · column · sales");
        expect([label!.x, label!.y, name!.y - (label!.y + label!.h), is!.y - (name!.y + name!.h)]).toEqual([16, 16, 4, 4]);
    });

    test("C2: a field — its label 6px over a 32px select of radius 6, a 14px icon, Inter 13 and a 10px chevron; a hint on a 19px line; fields 12px apart", async ({ page }) => {
        const tab = await openConfigure(page);
        const [label] = await read(tab, "[data-configure=source] > span");
        expect([label!.size, label!.weight, label!.line, label!.caps, label!.family]).toEqual(["12.5px", "500", "15px", "none", "Inter Tight Variable"]);
        for (const select of ["[data-configure-source]", "[data-configure-click]"]) {
            const [box] = await read(tab, select);
            expect([box!.h, box!.radius, box!.edge, box!.padStart, box!.padEnd], select).toEqual([32, "6px", "1px", "12px", "10px"]);
            expect(box!.bg, select).toBe(await token(page, "--chakra-colors-bg-surface"));
        }
        const [box] = await read(tab, "[data-configure-source]");
        expect(box!.y - (label!.y + label!.h)).toBe(6);
        const [icon, name, caret] = await read(tab, "[data-configure-source] > span");
        expect([icon!.w, icon!.h, name!.size, name!.line, caret!.w, caret!.h]).toEqual([14, 14, "13px", "16px", 10, 10]);
        // Its words start a whole number of pixels under the box's edge.
        expect(name!.y - box!.y).toBe(8);
        const hints = await read(tab, "[data-configure-hint]");
        expect(hints.map((hint) => [hint.size, hint.line, hint.h])).toEqual([["12.5px", "19px", 19], ["12.5px", "19px", 19]]);
        expect(await tab.locator("[data-configure-hint]").allTextContents()).toEqual(["Switching view resets the wells.", "Column · categories or periods side by side"]);
        // The section's fields: the source, the view and the kind, 12px apart.
        const fields = await read(tab, "[data-configure-section=kind] > [data-configure]");
        expect(fields.slice(1).map((field, at) => field.y - (fields[at]!.y + fields[at]!.h))).toEqual([12, 12]);
    });

    test("C3: the view's and the kind's segment groups are 32px of equal icon segments filling the row, the chosen one tinted; an option's is 24px of mono 10.5 / 600 capitals", async ({ page }) => {
        const tab = await openConfigure(page);
        const tint = await token(page, "--chakra-colors-brand-tint");
        for (const [name, count] of [["views", 4], ["kinds", 7]] as const) {
            const [group] = await read(tab, `[data-seg-strip=${name}]`);
            const segments = await read(tab, `[data-seg-strip=${name}] > button`);
            const icons = await read(tab, `[data-seg-strip=${name}] > button > svg`);
            expect([group!.h, group!.radius, group!.edge, segments.length], name).toEqual([32, "6px", "1px", count]);
            // Equal, and filling the group inside its edge.
            expect(Math.max(...segments.map((s) => s.w)) - Math.min(...segments.map((s) => s.w)), name).toBeLessThan(0.1);
            expect(segments.reduce((sum, s) => sum + s.w, 0), name).toBeCloseTo(group!.w - 2, 0);
            expect(segments.every((s) => s.h === 30), name).toBe(true);
            expect(icons.map((icon) => [icon.w, icon.h]), name).toEqual(icons.map(() => [14, 14]));
            expect(segments.filter((s) => s.bg === tint).length, name).toBe(1);
        }
        const [stack] = await read(tab, "[data-seg-strip=stack]");
        const names = await read(tab, "[data-seg-strip=stack] > button");
        expect([stack!.h, stack!.w, names.length]).toEqual([24, 287, 3]);
        expect(names.map((n) => [n.h, n.size, n.weight, n.line, n.caps])).toEqual(names.map(() => [22, "10.5px", "600", "14px", "uppercase"]));
        expect(await tab.locator("[data-seg-strip=stack] > button").allTextContents()).toEqual(["Clustered", "Stacked", "Percent"]);
    });

    test("C4: the wells are 14px apart, each label 6px over 32px pills — an 11px kind mark, Inter 13, a 22px aggregate chip, a 24px remove — and a value's menu is a head, 32px items and its form", async ({ page }) => {
        const tab = await openConfigure(page);
        const wells = await read(tab, "[data-well]");
        expect(wells.slice(1).map((well, at) => well.y - (wells[at]!.y + wells[at]!.h))).toEqual(wells.slice(1).map(() => 14));
        const [label] = await read(tab, "[data-well=values] > span");
        const [pill] = await read(tab, "[data-well=values] [data-well-pill]");
        expect([label!.size, label!.weight, label!.line, label!.caps]).toEqual(["10px", "600", "12px", "uppercase"]);
        expect([pill!.h, pill!.radius, pill!.edge, pill!.padStart, pill!.padEnd, pill!.y - (label!.y + label!.h)]).toEqual([32, "6px", "1px", "10px", "4px", 6]);
        const [kind] = await read(tab, "[data-well=values] [data-pill-grip]");
        const [mark] = await read(tab, "[data-well=values] [data-pill-grip] > svg");
        const [name] = await read(tab, "[data-well=values] [data-pill-name]");
        const [chip] = await read(tab, "[data-well=values] [data-pill-chip]");
        const [remove] = await read(tab, "[data-well=values] [data-pill-remove]");
        const [cross] = await read(tab, "[data-well=values] [data-pill-remove] > svg");
        expect([kind!.w, mark!.w, mark!.h]).toEqual([14, 11, 11]);
        expect([name!.size, name!.line, name!.family, name!.y - pill!.y]).toEqual(["13px", "16px", "Inter Tight Variable", 8]);
        expect([chip!.h, chip!.size, chip!.weight, chip!.line, chip!.caps, chip!.radius, chip!.y - pill!.y]).toEqual([22, "10px", "600", "22px", "uppercase", "4px", 5]);
        expect(chip!.bg).toBe(await token(page, "--chakra-colors-bg-subtle"));
        expect([remove!.w, remove!.h, cross!.w, cross!.h, remove!.y - pill!.y]).toEqual([24, 24, 14, 14, 4]);

        // Its name and its chip are one button, which opens its menu.
        await tab.locator("[data-well=values] [data-pill-open]").click();
        const menu = page.locator("[data-pill-menu=value]");
        await expect(menu).toBeVisible();
        await settled(page);
        const [head] = await read(menu, ":scope > span");
        const items = await read(menu, "[role=radio]");
        const icons = await read(menu, "[role=radio] svg");
        const [rule] = await read(menu, "[role=separator]");
        expect([head!.size, head!.weight, head!.caps]).toEqual(["10px", "600", "uppercase"]);
        expect(items.map((item) => [item.h, item.radius, item.size, item.line])).toEqual(items.map(() => [32, "4px", "13px", "16px"]));
        expect(icons.map((icon) => [icon.w, icon.h])).toEqual(icons.map(() => [11, 11]));
        expect(items.filter((item) => item.bg === (items[0]!.bg)).length).toBe(1);
        expect(rule!.h).toBe(1);
        const [formLabel] = await read(menu, "[data-field=period] label");
        const [period] = await read(menu, "[data-seg-strip=period]");
        expect([formLabel!.size, formLabel!.weight, formLabel!.caps, period!.h, period!.y - (formLabel!.y + formLabel!.h)]).toEqual(["12.5px", "500", "none", 24, 6]);
        await page.keyboard.press("Escape");
    });

    test("C5: the source's fields — a label and a 16px count, a 32px search box, then 32px rows: a 7px grip, an 11px kind mark, Inter 13 and a 12px check for a placed field", async ({ page }) => {
        const tab = await openConfigure(page);
        const [count] = await read(tab, "[data-fields-count]");
        expect([count!.w, count!.h, count!.size, count!.line, count!.radius]).toEqual([16, 16, "9.5px", "16px", "4px"]);
        const [search] = await read(tab, "[data-configure=fields] > div:nth-of-type(2)");
        expect([search!.h, search!.radius, search!.edge]).toEqual([32, "6px", "1px"]);
        const rows = await read(tab, "[data-field-row]");
        expect(rows.map((row) => row.h)).toEqual(rows.map(() => 32));
        const [grip, kind, name] = await read(tab, "[data-field-row] > span");
        const [, mark] = await read(tab, "[data-field-row] > span > svg");
        expect([grip!.w, kind!.w, mark!.w, mark!.h, name!.size, name!.line]).toEqual([7, 14, 11, 11, "13px", "16px"]);
        expect(name!.y - rows[0]!.y).toBe(8);
        const [check] = await read(tab, "[data-field-row][data-placed] > [role=img]");
        expect([check!.w, check!.h, check!.color]).toEqual([12, 12, await token(page, "--chakra-colors-status-pos")]);
        const groups = await read(tab, "[data-fields-group]");
        expect(groups.map((group) => [group.size, group.caps, group.h])).toEqual(groups.map(() => ["10px", "uppercase", 18]));
    });

    test("C6: every part of the tab stands a whole number of pixels under its top", async ({ page }) => {
        const tab = await openConfigure(page);
        const parts = await read(tab, "[data-inspector], [data-configure], [data-well-pill], [data-field-row], [data-seg-strip], [data-configure-hint]");
        expect(parts.length).toBeGreaterThan(12);
        expect(parts.filter((part) => !Number.isInteger(part.y) || !Number.isInteger(part.h)).map((part) => [part.y, part.h])).toEqual([]);
    });
});
