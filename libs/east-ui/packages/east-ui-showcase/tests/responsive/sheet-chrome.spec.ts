/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Sheet's chrome where a cell edits and where a row is numbered.
 *
 * Editing: the selected cell's ring is the field's chrome (`Sheet Spec.md`
 * §7): while a cell edits, its editor's 2 px ring is the one ring — no field
 * inside it casts the page's focus glow, carries an outline or draws a box of
 * its own, in every kind of cell and in a group band's title, and the date
 * segment being typed into is marked by the brand's tint alone.
 *
 * Numbering: a row's number stands clear of its checkbox however many digits
 * it has — deep in fifty thousand rows as at the top — every row's gutter as
 * wide as the header's corner, and a small sheet keeps the gutter it had, its
 * insertion chips in the actions column beside the numbers.
 *
 * Measured in the page — editing with a fine pointer, numbering in both
 * pointer modes; never a screenshot.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/** One example's entry, its sheet drawn and at rest. */
async function entryOf(page: Page, route: string): Promise<Locator> {
    await page.goto(`/?theme=dark#${route}`);
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${route}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-builder-frame] [data-sheet-card]")).toBeVisible({ timeout: 30_000 });
    await settled(page);
    return entry;
}

/** What a cell's editor draws: its own ring, and each part inside it that rings, outlines or boxes itself, or tints the segment being typed into. */
function editing(cell: Locator) {
    return cell.evaluate((el) => {
        const editor = el.querySelector<HTMLElement>("[data-slot=editor]");
        if (editor === null) return { ring: null, faults: ["no editor"], segment: null };
        const name = (part: Element) => part.getAttribute("data-slot") ?? part.getAttribute("data-part") ?? part.getAttribute("role") ?? part.tagName.toLowerCase();
        const clear = (color: string) => color === "transparent" || /rgba\(\d+, \d+, \d+, 0\)/.test(color);
        const faults: string[] = [];
        for (const part of editor.querySelectorAll("*")) {
            if (part.getBoundingClientRect().width === 0 || part.closest("[data-slot^=chip]") !== null) continue;
            const s = getComputedStyle(part);
            if (s.boxShadow !== "none") faults.push(`${name(part)} casts ${s.boxShadow}`);
            if (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) faults.push(`${name(part)} is outlined ${s.outlineWidth}`);
            const sides = (["Top", "Right", "Bottom", "Left"] as const)
                .filter((side) => parseFloat(s[`border${side}Width`]) > 0 && s[`border${side}Style`] !== "none" && !clear(s[`border${side}Color`]));
            if (sides.length === 4) faults.push(`${name(part)} draws a box`);
        }
        const focused = document.activeElement;
        const segment = focused?.getAttribute("role") === "spinbutton" && editor.contains(focused) ? getComputedStyle(focused).backgroundColor : null;
        return { ring: getComputedStyle(editor).boxShadow, faults, segment };
    });
}

/** A theme token's colour, as the page resolves it. */
function tokenColor(page: Page, token: string) {
    return page.evaluate((name) => {
        const probe = document.createElement("span");
        probe.style.backgroundColor = `var(${name})`;
        document.body.appendChild(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
    }, token);
}

// Double-click edits with a fine pointer; the chrome is the same on a touch.
test("a cell that edits draws one ring, its editor's: no field inside it glows, outlines or boxes itself, and a date's segment being typed into is tinted @desktop", async ({ page }) => {
    const weeks = await entryOf(page, "e3/sheet/sheet/sheetWeeks");
    const main = weeks.locator("[data-frame-slot=main]");
    const tint = await tokenColor(page, "--chakra-colors-brand-tint");
    const kinds = ["text", "date", "quantity", "integer", "reference", "enum", "set"];
    for (const kind of kinds) {
        const cell = main.locator(`[data-slot=row]:not([data-blank]) [data-slot=cell][data-editable][data-kind="${kind}"]`).first();
        await cell.dblclick();
        await expect(cell.locator("[data-slot=editor]")).toBeVisible();
        const drawn = await editing(cell);
        expect(drawn.ring, kind).toMatch(/inset/);
        expect(drawn.faults, kind).toEqual([]);
        if (kind === "date") expect(drawn.segment, "the date's focused segment").toBe(tint);
        await page.keyboard.press("Escape");
        await expect(cell.locator("[data-slot=editor]")).toHaveCount(0);
    }
    // A group band's title edits in the same ring.
    const workshop = await entryOf(page, "e3/sheet/sheet/sheetWorkshop");
    const title = workshop.locator("[data-frame-slot=main] [data-band-row] [data-slot=cell][data-kind=text]").first();
    await title.dblclick();
    await expect(title.locator("[data-slot=editor]")).toBeVisible();
    const band = await editing(title);
    expect(band.ring).toMatch(/inset/);
    expect(band.faults).toEqual([]);
});

test("a row's number stands clear of its checkbox however many digits it has: five, deep in fifty thousand rows, each row's gutter the header's width", async ({ page }, info) => {
    const mobile = info.project.name !== "desktop";
    const entry = await entryOf(page, `e3/sheet/sheet-records/${mobile ? "sheetRecordIndexesMobile" : "sheetRecordIndexes"}`);
    const card = entry.locator("[data-sheet-card]").first();
    // Seventy per cent of the way down the rows' scroller: rows numbered in the tens of thousands.
    await card.locator("[data-virtual-rows]").first().evaluate((el) => { el.scrollTop = el.scrollHeight * 0.7; });
    // The window there lands as its pages do: its rows, numbered in five digits.
    await expect.poll(() => card.evaluate((root) => [...root.querySelectorAll("[data-slot=row]:not([data-blank]) [data-slot=gutterNumber]")]
        .filter((n) => /^\d{5}$/.test((n.textContent ?? "").trim())).length), { timeout: 30_000 }).toBeGreaterThan(0);
    await settled(page);
    const measured = await card.evaluate((root) => {
        const width = (el: Element | null) => el === null ? null : Math.round(el.getBoundingClientRect().width * 10) / 10;
        const header = width(root.querySelector("[data-slot=headerGutter]"));
        const faults: string[] = [];
        let widest = 0;
        for (const row of root.querySelectorAll("[data-slot=row]:not([data-blank])")) {
            const gutter = row.querySelector(":scope > [data-slot=gutter]");
            const number = gutter?.querySelector("[data-slot=gutterNumber]");
            const checkbox = gutter?.querySelector("[data-slot=checkbox]");
            if (gutter == null || number == null || checkbox == null) continue;
            const text = [...number.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "");
            if (text.length === 0) continue;
            const range = document.createRange();
            range.setStart(text[0]!, 0);
            range.setEnd(text.at(-1)!, (text.at(-1)!.textContent ?? "").length);
            const digits = range.getBoundingClientRect(), column = number.getBoundingClientRect(), box = checkbox.getBoundingClientRect();
            const label = (number.textContent ?? "").trim();
            widest = Math.max(widest, label.length);
            if (digits.left < column.left - 0.5) faults.push(`${label} starts ${(column.left - digits.left).toFixed(1)}px before its column`);
            if (digits.left - box.right < 6) faults.push(`${label} is ${(digits.left - box.right).toFixed(1)}px from its checkbox`);
            if (width(gutter) !== header) faults.push(`${label}'s gutter is ${width(gutter)}px, the header's ${header}px`);
        }
        return { faults, widest };
    });
    expect(measured.widest, "rows deep in the record carry five digits").toBe(5);
    expect(measured.faults).toEqual([]);
    if (mobile) return;
    // A small sheet keeps the gutter it had: rail 28 · number 36 · actions 64.
    const basic = await entryOf(page, "e3/sheet/sheet/sheetBasic");
    expect(await basic.locator("[data-slot=headerGutter]").first().evaluate((el) => el.getBoundingClientRect().width)).toBe(128);
    // The seam above a row offers its chips in the gutter's actions column: past the numbers, inside the gutter.
    const second = basic.locator("[data-frame-slot=main] [data-slot=row]:not([data-blank])").nth(1);
    await second.locator("[data-slot=insertPoint]").hover();
    const chips = basic.locator("[data-slot=insertLayer] [data-slot=insertChips]");
    await expect(chips).toBeVisible();
    const placed = await second.evaluate((row, chipsBox) => {
        const number = row.querySelector("[data-slot=gutterNumber]")!.getBoundingClientRect();
        const gutter = row.querySelector(":scope > [data-slot=gutter]")!.getBoundingClientRect();
        return { afterNumbers: chipsBox.left - number.right, insideGutter: gutter.right - chipsBox.right };
    }, await chips.evaluate((el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right }; }));
    expect(placed.afterNumbers, "the chips start past the number column").toBeGreaterThanOrEqual(0);
    expect(placed.insideGutter, "the chips end inside the gutter").toBeGreaterThanOrEqual(0);
});
