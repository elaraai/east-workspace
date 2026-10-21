/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */
/**
 * Split loads and Find a fit (#1332, `Allocation Spec.md` §9.10) on the real
 * in-page e3, over the kiln yard's Wed 12: a split bin's card line, its
 * remainder in warn-text and cut where the card cuts it (A70); its parts in
 * Assigned to, the shared form's fields, and `Split…`'s anchored popover
 * (A71); the Table's part chips and `+ resource` inside their cell at the
 * Table's least width (A71); and Find a fit's chip and found cards in the
 * Library's Resources tab (A74) — measured in the page in both themes, from
 * 1440px to a 294px parent, nothing leaving the frame. And a bin wholly on one
 * kiln split onto a second (#1362), saved to e3 and read back.
 */
import { expect, test, type Locator, type Page } from "playwright/test";
import { FILE, open, size, token } from "./allocation-page";
import { settled } from "./settle";

const endPane = (frame: Locator) => frame.locator('[data-frame-slot="end"]');
const startPane = (frame: Locator) => frame.locator('[data-frame-slot="start"]');
const details = (frame: Locator) => frame.locator('[data-allocation-inspector="details"]');
/**
 * What leaves a box sideways, or scrolls inside it sideways: each by its tag and the nearest part around it that names itself. Only a
 * scroll container can scroll — a box whose overflow is visible may paint past itself, as a touch target's halo does by design.
 */
const leaves = (sheet: Element) => {
    const box = sheet.getBoundingClientRect(), out: string[] = [];
    const own = (el: Element) => `${el.tagName.toLowerCase()}${el.attributes.length > 0 ? `[${el.attributes[0]!.name}]` : ""}`;
    const named = (el: Element) => [...el.attributes].find(a => a.name.startsWith("data-") && a.name !== "data-scope" && a.name !== "data-part");
    const name = (el: Element) => {
        let up = el.parentElement;
        while (up !== null && up !== sheet && named(up) === undefined) up = up.parentElement;
        return up === null || up === sheet ? own(el) : `${own(el)} in ${up.tagName.toLowerCase()}[${named(up)!.name}]`;
    };
    for (const el of [sheet, ...sheet.querySelectorAll("*")]) {
        const scrolls = ["auto", "scroll"].includes(getComputedStyle(el).overflowX);
        if (scrolls && el.scrollWidth - el.clientWidth > 1) out.push(`${name(el)} scrolls sideways`);
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        if (b.right > box.right + 0.5 || b.left < box.left - 0.5) out.push(`${name(el)} leaves the box`);
    }
    return out;
};
/** The page scrolls sideways by this much: nothing may. */
const pageOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const theme of ["light", "dark"] as const) {
    test(`A70, A71 — a split bin: its card's line cut where the card cuts it, the remainder in warn-text and whole in its tooltip; its parts in Assigned to, the shared form's 32px lines, the remainder in warn-text; Split…'s popover, its quantity over the Chooser laid in it (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationSplit", theme);
        await size(page, entry, 1440);
        const frame = entry.locator("[data-allocation-frame]").first();
        const [warnText, strong, brand] = [await token(page, "fg-warning"), await token(page, "border-strong"), await token(page, "brand-solid")];
        // The card: `→ K-601 + 1 · 4 m³ unallocated`, its line one line inside the card, cut with an ellipsis; the remainder warn-text 600.
        const card = frame.locator('[data-allocation-timeline] [data-allocation-card="3201"]');
        await card.scrollIntoViewIfNeeded();
        const line = await card.evaluate((el) => {
            const to = el.querySelector("[data-allocation-to]")!, left = to.querySelector("[data-allocation-left]")!, s = getComputedStyle(to), c = el.getBoundingClientRect(), b = to.getBoundingClientRect();
            return { text: to.textContent, inside: b.left >= c.left - 0.5 && b.right <= c.right + 0.5, cut: to.scrollWidth > to.clientWidth, ellipsis: s.textOverflow, wrap: s.whiteSpace,
                left: [getComputedStyle(left).color, getComputedStyle(left).fontWeight], title: el.getAttribute("title") };
        });
        expect(line).toMatchObject({ text: "K-601 + 1 · 4 m³ unallocated", inside: true, cut: true, ellipsis: "ellipsis", wrap: "nowrap", left: [warnText, "600"] });
        expect(line.title).toContain("on K-601 + 1 · 4 m³ unallocated");
        // Assigned to: a field per part, each the shared form's 32px line, every part of it inside the pane; the remainder in warn-text 600.
        await card.click(); await settled(page);
        const body = details(frame);
        await expect(body.locator("[data-inspector-title]")).toHaveText("LD-2232 · 30 m³");
        const parts = await body.locator("[data-allocation-parts]").evaluate((root) => {
            const lines = [...root.querySelectorAll("[data-field] [data-field-line]")].map(l => Math.round(l.getBoundingClientRect().height));
            const rest = root.querySelector("[data-allocation-remainder]")!, s = getComputedStyle(rest);
            return { fields: [...root.querySelectorAll("[data-field]")].map(f => f.getAttribute("data-field")), lines, remainder: [rest.textContent, s.color, s.fontWeight] };
        });
        expect(parts).toEqual({ fields: ["K-208", "K-601"], lines: [32, 32], remainder: ["4 m³ unallocated", warnText, "600"] });
        expect(await endPane(frame).locator(":scope > *").first().evaluate(leaves)).toEqual([]);
        // `Split…`: a brand text action at the head's end; its popover anchored, 320px, its quantity's 32px line over the Chooser in its own border.
        const opener = body.locator("[data-allocation-split-open]");
        expect(await opener.evaluate(el => getComputedStyle(el).color)).toBe(brand);
        await opener.click(); await settled(page);
        const popover = page.locator('[data-allocation-split="3201"]');
        await expect(popover.getByRole("option").first()).toBeVisible();
        const laid = await popover.evaluate((root) => {
            const content = root.closest("[role=dialog]")!, c = content.getBoundingClientRect(), chooser = root.querySelector("[data-chooser]")!, s = getComputedStyle(chooser), b = chooser.getBoundingClientRect();
            return { width: Math.round(c.width), inView: c.left >= 0 && c.right <= window.innerWidth, line: Math.round(root.querySelector("[data-field-line]")!.getBoundingClientRect().height),
                border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`, inside: b.left >= c.left - 0.5 && b.right <= c.right + 0.5,
                option: Math.round(chooser.querySelector("[role=option]")!.getBoundingClientRect().height) };
        });
        expect(laid).toMatchObject({ width: 320, inView: true, line: 32, border: `1px solid ${strong}`, inside: true });
        expect(laid.option).toBeGreaterThanOrEqual(40);
        // Nothing of the popover leaves it sideways.
        expect(await popover.evaluate(el => {
            const sheet = el.closest("[role=dialog]")!, box = sheet.getBoundingClientRect(), out: string[] = [];
            for (const n of sheet.querySelectorAll("*")) { const b = n.getBoundingClientRect(); if (b.width > 0 && (b.right > box.right + 0.5 || b.left < box.left - 0.5)) out.push(n.tagName.toLowerCase()); }
            return out;
        })).toEqual([]);
        await page.keyboard.press("Escape"); await settled(page);
        await expect(popover).toBeHidden();
        expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    });

    test(`A71 — the Table's split row: each part a 28px chip on the rule-strong border, its resource and its quantity in ink-2 one button that gives way to the cell, and its ×; \`+ resource\` a dashed 28px placeholder taking what is left, its words whole; every part of it inside its cell at the Table's least width (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationTable", theme);
        await size(page, entry, 1440);
        const frame = entry.locator("[data-allocation-frame]").first();
        await frame.getByRole("button", { name: "Next day", exact: true }).click(); await settled(page);
        const row = frame.locator('[data-allocation-row="bin:3201"]');
        await row.scrollIntoViewIfNeeded(); await settled(page);
        const [strong, ink2] = [await token(page, "border-strong"), await token(page, "fg-strong")];
        const cell = await row.locator("[data-allocation-parts]").evaluate((root) => {
            const c = root.getBoundingClientRect(), s = getComputedStyle(root);
            const content = { left: c.left + parseFloat(s.paddingLeft), right: c.right - parseFloat(s.paddingRight) };
            const chips = [...root.querySelectorAll('[data-allocation-chip="part"]')].map((chip) => {
                const b = chip.getBoundingClientRect(), cs = getComputedStyle(chip), face = chip.firstElementChild!, fs = getComputedStyle(face), qty = face.children[1]!, qs = getComputedStyle(qty);
                return { h: Math.round(b.height), border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`, inside: b.left >= content.left - 0.5 && b.right <= content.right + 0.5,
                    qty: [qty.textContent, qs.color, qs.fontSize], cut: [...face.children].some(k => k.scrollWidth > k.clientWidth + 0.5),
                    // The yard's names fit whole; a longer one is cut where the face gives way to the cell, never pushed past it.
                    give: [fs.flexShrink, fs.minWidth],
                    face: [face.tagName.toLowerCase(), face.getAttribute("aria-haspopup")], remove: chip.lastElementChild!.getAttribute("aria-label") };
            });
            const plus = root.querySelector('[data-allocation-placeholder="remainder"]')!, p = plus.getBoundingClientRect(), ps = getComputedStyle(plus);
            // The cell spans the Resource and the Load columns: as wide as the two heads under which it sits.
            const heads = [...root.closest("[data-allocation-table]")!.querySelectorAll("[data-allocation-table-head] > span")];
            const resourceHead = heads[heads.length - 3]!.getBoundingClientRect(), loadHead = heads[heads.length - 2]!.getBoundingClientRect();
            const words = plus.querySelector('[data-say="idle"]')!;
            return { chips, plus: { h: Math.round(p.height), border: `${ps.borderTopWidth} ${ps.borderTopStyle} ${ps.borderTopColor}`, inside: p.left >= content.left - 0.5 && p.right <= content.right + 0.5,
                fills: Math.abs(p.right - content.right) <= 0.5, whole: words.scrollWidth <= words.clientWidth + 0.5 }, spans: Math.abs(c.width - (resourceHead.width + loadHead.width)) <= 1, resource: Math.round(resourceHead.width) };
        });
        // At 1440 with both panes pinned the Table is at its least width: the Resource column its 176px.
        expect(cell.resource).toBe(176);
        expect(cell.spans).toBe(true);
        expect(cell.chips.map(c => c.qty[0])).toEqual(["20 m³", "6 m³"]);
        for (const chip of cell.chips) expect([chip.h, chip.border, chip.inside, chip.cut, chip.qty[1], chip.qty[2], chip.give, chip.face]).toEqual([28, `1px solid ${strong}`, true, false, ink2, "10.5px", ["1", "0px"], ["button", "listbox"]]);
        expect(cell.chips.map(c => c.remove)).toEqual(["Unlink LD-2232 from K-601", "Unlink LD-2232 from K-208"]);
        // `+ resource` takes what is left, its words whole at the Table's least width.
        expect(cell.plus).toEqual({ h: 28, border: `1px dashed ${strong}`, inside: true, fills: true, whole: true });
        expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    });

    test(`A74 — Find a fit at 1440/1024/768/390/360 and a 294px parent: its chip and each found card's reason inside the Library's pane, the reason in the card note's voice and whole in the card's title (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "allocationSplit", theme);
        const frame = entry.locator("[data-allocation-frame]").first();
        const resources = frame.locator('[data-allocation-library="resources"]');
        // A found card's line is the fit's reason in the note's voice: ink-4, or warn-text when the fit warns (`under min`).
        const voices = [await token(page, "fg-subtle"), await token(page, "fg-warning")];
        for (const width of [1440, 1024, 768, 390, 360, 294]) {
            await size(page, entry, width);
            // The fix, pressed under its issue in the Inspector — opened over main where it overlays it.
            const end = endPane(frame);
            if (await end.getAttribute("data-collapsed") !== null) { await end.getByRole("button", { name: "Expand Inspector" }).click(); await settled(page); }
            await end.getByRole("tab", { name: /^Issues/ }).click(); await settled(page);
            await end.locator('[data-allocation-issue-group="unallocated"]').getByRole("button", { name: "Find a fit", exact: true }).click(); await settled(page);
            await expect(resources.locator("[data-allocation-find] button"), `${width}px`).toHaveText("Find · LD-2232 · 4 m³");
            await expect(resources, `${width}px`).not.toHaveAttribute("aria-busy", "true");
            const faults = await resources.evaluate((root, quiet) => {
                const inside = (b: DOMRect, p: DOMRect) => b.left >= p.left - 0.5 && b.right <= p.right + 0.5;
                const out: string[] = [];
                const pane = root.getBoundingClientRect();
                if (!inside(pane, root.closest("[data-builder-frame]")!.getBoundingClientRect())) out.push("the Resources tab leaves the frame");
                const chip = root.querySelector("[data-allocation-find] button")!;
                if (!inside(chip.getBoundingClientRect(), pane)) out.push("the chip leaves the pane");
                if (chip.scrollWidth - chip.clientWidth > 1) out.push("the chip cuts its words");
                const cards = [...root.querySelectorAll("[data-library-item]")];
                if (cards.length === 0) out.push("no card found");
                for (const card of cards) {
                    const note = card.querySelector("[data-library-note]");
                    const key = card.getAttribute("data-library-item"), c = card.getBoundingClientRect();
                    if (note === null) { out.push(`${key} has no reason`); continue; }
                    const s = getComputedStyle(note);
                    if (!inside(c, pane)) out.push(`${key} leaves the pane`);
                    if (!inside(note.getBoundingClientRect(), c)) out.push(`${key}'s reason leaves its card`);
                    if (s.fontSize !== "10px" || !quiet.includes(s.color)) out.push(`${key}'s reason is not in the note's voice: ${s.color} ${s.fontSize}`);
                    if (note.scrollWidth - note.clientWidth > 0.5 && (s.textOverflow !== "ellipsis" || s.whiteSpace !== "nowrap")) out.push(`${key}'s reason is cut with no ellipsis`);
                    if (card.getAttribute("title") !== note.textContent) out.push(`${key}'s title is not its reason`);
                }
                const scroller = root.querySelector("[data-library] [data-scrollable]");
                if (scroller !== null && scroller.scrollWidth - scroller.clientWidth > 1) out.push("the cards scroll sideways");
                return out;
            }, voices);
            expect(faults, `${width}px`).toEqual([]);
            expect(await pageOverflow(page), `${width}px page`).toBeLessThanOrEqual(0);
            // Its chip pressed, the find clears; the Library goes back to its rail where it overlays main.
            await resources.locator("[data-allocation-find] button").click(); await settled(page);
            await expect(resources.locator("[data-allocation-find]")).toHaveCount(0);
            const start = startPane(frame);
            if (await start.getAttribute("data-pane-mode") === "overlay" && await start.getAttribute("data-collapsed") === null) {
                await start.getByRole("button", { name: "Collapse Library" }).click(); await settled(page);
            }
        }
    });

    test(`the split bin at 1440/1024/768/390/360 and a 294px parent: its parts and Split… inside the Inspector, beside main or over it; Split…'s popover inside the window; nothing leaves the frame (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "allocationSplit", theme);
        const frame = entry.locator("[data-allocation-frame]").first();
        const end = endPane(frame);
        await size(page, entry, 1440);
        const card = frame.locator('[data-allocation-timeline] [data-allocation-card="3201"]');
        await card.scrollIntoViewIfNeeded();
        await card.click(); await settled(page);
        for (const width of [1440, 1024, 768, 390, 360, 294]) {
            await size(page, entry, width);
            if (await end.getAttribute("data-collapsed") !== null) { await end.getByRole("button", { name: "Expand Inspector" }).click(); await settled(page); }
            await expect(details(frame).locator("[data-allocation-parts] [data-field]"), `${width}px`).toHaveCount(2);
            expect(await end.locator(":scope > *").first().evaluate(leaves), `${width}px`).toEqual([]);
            expect(await frame.evaluate(root => root.scrollWidth - root.clientWidth), `${width}px frame`).toBeLessThanOrEqual(1);
            await details(frame).locator("[data-allocation-split-open]").click(); await settled(page);
            const popover = page.locator('[data-allocation-split="3201"]');
            await expect(popover.getByRole("option").first(), `${width}px`).toBeVisible();
            expect(await popover.evaluate(el => { const c = el.closest("[role=dialog]")!.getBoundingClientRect(); return c.left >= -0.5 && c.right <= window.innerWidth + 0.5; }), `${width}px popover`).toBe(true);
            expect(await pageOverflow(page), `${width}px page`).toBeLessThanOrEqual(0);
            await page.keyboard.press("Escape"); await settled(page);
            await expect(popover).toBeHidden();
            if (await end.getAttribute("data-pane-mode") === "overlay") { await end.getByRole("button", { name: "Collapse Inspector" }).click(); await settled(page); }
        }
    });
}

test(`#1362, A71 — a bin wholly on one kiln splits onto a second on e3: Split… takes half of LD-2210's 32 m³ off K-108 onto the kiln the fit offers first; Save writes both parts, and the board remounted reads them back (light) @desktop`, async ({ page }) => {
    await page.setViewportSize({ width: 2160, height: 1200 });
    const entry = await open(page, "allocationKilnYard");
    await size(page, entry, 1440);
    const frame = entry.locator("[data-allocation-frame]").first();
    const card = frame.locator('[data-allocation-timeline] [data-allocation-card="3113"]');
    await card.scrollIntoViewIfNeeded();
    await card.click(); await settled(page);
    const opener = details(frame).locator("[data-allocation-split-open]");
    await expect(opener).toHaveAttribute("title", "Split LD-2210 · 32 m³ on K-108");
    await opener.click(); await settled(page);
    const popover = page.locator('[data-allocation-split="3113"]');
    await expect(popover.getByRole("spinbutton")).toHaveValue("16");
    // The kiln the yard's fit ranks first for 16 m³, K-108 left out.
    const fits = popover.getByRole("group", { name: "Gaps that fit" }).getByRole("option");
    await expect(fits.first()).toBeVisible();
    const to = await fits.first().evaluate(o => o.querySelector("span:nth-child(2) > span:first-child")!.textContent!);
    expect(to).not.toBe("K-108");
    await fits.first().click(); await settled(page);
    const parts = (at: Locator) => details(at).locator("[data-allocation-parts] [data-field]")
        .evaluateAll(fields => Object.fromEntries(fields.map(f => [f.getAttribute("data-field"), Number(f.querySelector("input")!.value)])));
    expect(await parts(frame)).toEqual({ "K-108": 16, [to]: 16 });
    await expect(card).toHaveAttribute("data-draft", "");
    await frame.getByRole("button", { name: "Save", exact: true }).click();
    await expect(card).not.toHaveAttribute("data-draft", "");
    // Another example and back: the board reads the day the record now holds.
    await page.evaluate(() => { location.hash = "#e3/plan/plan/planTargetState"; });
    await expect(page.locator("[data-plan-frame]").first()).toBeVisible({ timeout: 30_000 });
    await page.evaluate(key => { location.hash = key; }, `#${FILE}/allocationKilnYard`);
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-allocation-frame]").first()).toBeVisible({ timeout: 30_000 });
    await settled(page);
    await size(page, entry, 1440);
    const again = entry.locator("[data-allocation-frame]").first();
    const saved = again.locator('[data-allocation-timeline] [data-allocation-card="3113"]');
    await saved.scrollIntoViewIfNeeded();
    await saved.click(); await settled(page);
    expect(await parts(again)).toEqual({ "K-108": 16, [to]: 16 });
    await expect(saved).not.toHaveAttribute("data-draft", "");
});
