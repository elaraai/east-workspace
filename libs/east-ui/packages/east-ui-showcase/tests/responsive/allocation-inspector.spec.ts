/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */
/**
 * The Allocation's Inspector (#1331) on the real in-page e3: the end pane,
 * 320px beside main where it has room and over main where it has not, its
 * tabs and its rail (A55); a bin's head, its Bin section's stepper and rows,
 * Assigned to's field, meter and bins, and the field's Chooser laid in the
 * pane (A56–A59); a resource's banner (A62); the summary's counts (A63); the
 * Issues tab (A64); the drop list's rows under a pick (A34) and a refused
 * drop's note (A40) — the shared inspector's parts, measured in the page in
 * both themes (§8).
 */
import { expect, test, type Locator, type Page } from "playwright/test";
import { open, size, token } from "./allocation-page";
import { settled } from "./settle";

const endPane = (frame: Locator) => frame.locator('[data-frame-slot="end"]');
const details = (frame: Locator) => frame.locator('[data-allocation-inspector="details"]');
/**
 * What leaves the pane's sheet sideways, or scrolls inside it sideways: each by its tag and first attribute. Only a scroll
 * container can scroll — a box whose overflow is visible may paint past itself, as a touch target's halo does by design,
 * and what it paints is a box the bounds check sees.
 */
const leaves = (sheet: Element) => {
    const box = sheet.getBoundingClientRect(), out: string[] = [];
    // An element, and the nearest part around it that names itself (`span in div[data-chooser]`).
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
        if (b.right > box.right + 0.5 || b.left < box.left - 0.5) out.push(`${name(el)} leaves the pane`);
    }
    return out;
};
/** Picks an element up with the mouse, past the 5px a drag waits for, and waits for the board to draw the drag. */
async function pickUp(page: Page, el: Locator, timeline: Locator, kind: string) {
    const box = (await el.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 4; i++) await page.mouse.move(box.x + box.width / 2 + i * 3, box.y + box.height / 2 + i * 2);
    await expect(timeline).toHaveAttribute("data-allocation-drag", kind);
    await settled(page);
}
/** Brings an under-way drag over an element, a third of the way in: clear of every scrolling box's edge band. */
async function bring(page: Page, el: Locator) {
    const box = (await el.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3 - 4, box.y + box.height / 2, { steps: 4 });
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
    await settled(page);
}

for (const theme of ["light", "dark"] as const) {
    test(`A55–A59 — the Inspector, 320px beside main: its tabs; a bin's head, Bin section and Assigned to on the shared parts, its Chooser laid in the pane (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationKilnYard", theme);
        await size(page, entry, 1440);
        const frame = entry.locator("[data-allocation-frame]").first();
        const end = endPane(frame);
        expect(await end.evaluate(el => [el.getAttribute("data-pane-mode"), Math.round(el.getBoundingClientRect().width)])).toEqual(["pinned", 320]);
        expect(await end.locator('[role="tab"]').allTextContents()).toEqual(["Details", "Issues 3"]);
        const card = frame.locator('[data-allocation-timeline] [data-allocation-card="3113"]');
        await card.scrollIntoViewIfNeeded();
        await card.click(); await settled(page);
        const body = details(frame);
        await expect(body.locator("[data-inspector-title]")).toHaveText("LD-2210 · 32 m³");
        // Every other gap the fit ranks has landed.
        await expect(body.locator("[data-allocation-alternative]").first()).toBeVisible();
        const parts = await body.evaluate((root) => {
            const pick = (selector: string) => root.querySelector(selector)!;
            const section = (el: Element) => { const s = getComputedStyle(el); return { padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].join(" "), rule: `${s.borderBottomWidth} ${s.borderBottomStyle} ${s.borderBottomColor}` }; };
            const head = pick("[data-inspector-title]").closest('[data-allocation-inspector="details"] > *')!;
            const tile = head.querySelector('[aria-hidden="true"]')!.getBoundingClientRect();
            const stepper = pick("[data-allocation-stepper]");
            const meter = pick("[data-allocation-meter]"), track = meter.firstElementChild!.getBoundingClientRect(), tick = pick("[data-allocation-min]");
            const t = tick.getBoundingClientRect();
            const mates = [...root.querySelectorAll("[data-allocation-mate]")];
            const alternative = pick("[data-allocation-alternative]"), rank = alternative.firstElementChild!;
            const lanes = pick('[data-allocation-seg="inspector-lane"]'), cells = [...lanes.querySelectorAll('[role="radio"]')].map(c => c.getBoundingClientRect());
            const line = lanes.closest("[data-field-line]")!.getBoundingClientRect();
            return {
                head: section(head), tile: [tile.width, tile.height], actions: head.querySelector("[data-allocation-bin-actions]") !== null,
                bin: section(pick("[data-allocation-bin-section]")), assigned: section(pick("[data-allocation-assigned]")), alternatives: section(pick("[data-allocation-alternatives]")),
                stepper: { h: Math.round(stepper.getBoundingClientRect().height), buttons: [...stepper.querySelectorAll("button")].map(b => Math.round(b.getBoundingClientRect().width)),
                    value: getComputedStyle(pick("[data-allocation-time]")).paddingLeft, border: getComputedStyle(stepper).borderTopColor },
                lanes: { count: cells.length, spread: Math.max(...cells.map(c => c.width)) - Math.min(...cells.map(c => c.width)), fills: Math.abs(lanes.getBoundingClientRect().width - line.width) <= 0.5 },
                rows: [getComputedStyle(pick("[data-allocation-values]")).gridTemplateColumns.split(" ")[0], getComputedStyle(pick("[data-allocation-facts]")).gridTemplateColumns.split(" ")[0]],
                field: Math.round(pick("[data-allocation-resource-field]").getBoundingClientRect().height),
                track: Math.round(track.height),
                tick: { w: t.width, above: Math.round(track.top - t.top), below: Math.round(t.bottom - track.bottom), at: Math.round(((t.left - track.left) / track.width) * 100), color: getComputedStyle(tick).backgroundColor },
                mates: mates.map(m => Math.round(m.getBoundingClientRect().height)), mateColumns: getComputedStyle(mates[0]!).gridTemplateColumns.split(" ").slice(0, 2).join(" "),
                alternative: Math.round(alternative.getBoundingClientRect().height), rank: [Math.round(rank.getBoundingClientRect().width), Math.round(rank.getBoundingClientRect().height), getComputedStyle(rank).backgroundColor],
            };
        });
        const [subtle, strong, ink, paper3] = [await token(page, "border-subtle"), await token(page, "border-strong"), await token(page, "fg"), await token(page, "bg-subtle")];
        // Each section the shared one: 16px in, a rule under it.
        for (const key of ["head", "bin", "assigned", "alternatives"] as const) expect(parts[key], key).toEqual({ padding: "16px 16px 16px 16px", rule: `1px solid ${subtle}` });
        expect([parts.tile, parts.actions]).toEqual([[30, 30], true]);
        // The Bin section: the lanes in the shared full-width segments, the time in the shared stepper at md, the app's values on 88px.
        expect(parts.lanes.count).toBe(3); expect(parts.lanes.spread).toBeLessThanOrEqual(1); expect(parts.lanes.fills).toBe(true);
        expect(parts.stepper).toEqual({ h: 28, buttons: [28, 28], value: "10px", border: strong });
        expect(parts.rows).toEqual(["88px", "88px"]);
        // Assigned to: the 32px field, the shared meter's 6px track, the min tick 1px of ink 4px past it each side at min / max (16 of 32), the bins 28px rows on 44px 32px.
        expect([parts.field, parts.track]).toEqual([32, 6]);
        expect(parts.tick).toEqual({ w: 1, above: 4, below: 4, at: 50, color: ink });
        expect(parts.mates).toEqual([28]);
        expect(parts.mateColumns).toBe("44px 32px");
        // The other gaps: 36px rows, each rank a 16px badge on paper-3.
        expect(parts.alternative).toBeGreaterThanOrEqual(36);
        expect(parts.rank).toEqual([16, 16, paper3]);
        expect(await end.locator(":scope > *").first().evaluate(leaves)).toEqual([]);

        // The field's Chooser, laid in the pane under it: its own border, the popover's sizes, nothing past the section.
        await body.locator("[data-allocation-resource-field]").click(); await settled(page);
        const chooser = body.locator("[data-chooser]");
        await expect(chooser.getByRole("option", { name: /K-103/ })).toBeVisible();
        const laid = await chooser.evaluate((root) => {
            const r = (el: Element | null) => el === null ? null : Math.round(el.getBoundingClientRect().height);
            const s = getComputedStyle(root), b = root.getBoundingClientRect(), section = root.closest("[data-allocation-assigned]")!, p = section.getBoundingClientRect(), ps = getComputedStyle(section);
            return { border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`, inside: b.left >= p.left + parseFloat(ps.paddingLeft) - 0.5 && b.right <= p.right - parseFloat(ps.paddingRight) + 0.5,
                cap: s.maxHeight, tall: b.height <= 340.5,
                search: r(root.querySelector("label")), head: r(root.querySelector("[role=group] > [aria-hidden]")), option: r(root.querySelector("[role=option]")), foot: r(root.lastElementChild) };
        });
        expect(laid).toMatchObject({ border: `1px solid ${strong}`, inside: true, cap: "340px", tall: true, search: 32, head: 24, foot: 32 });
        expect(laid.option).toBeGreaterThanOrEqual(40);
        expect(await end.locator(":scope > *").first().evaluate(leaves)).toEqual([]);
        await page.keyboard.press("Escape"); await settled(page);
        await expect(chooser).toHaveCount(0);
        await expect(body.locator("[data-inspector-title]")).toHaveText("LD-2210 · 32 m³");
    });

    test(`A55, A62–A64 — a resource's banner, the summary's counts, the Issues tab and the rail's count and mark (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationKilnYard", theme);
        await size(page, entry, 1440);
        const frame = entry.locator("[data-allocation-frame]").first();
        const end = endPane(frame);
        const body = details(frame);
        const [subtle, strong, warnText] = [await token(page, "border-subtle"), await token(page, "border-strong"), await token(page, "fg-warning")];
        // Nothing selected: the summary's four counts two to a row, the issues' in warn-text, the hints under them.
        const stats = await body.locator("[data-allocation-stats]").evaluate((el) => {
            const s = getComputedStyle(el), cells = [...el.querySelectorAll("[data-allocation-stat]")];
            return { columns: s.gridTemplateColumns.split(" ").length, padding: s.paddingTop, count: cells.length,
                issues: getComputedStyle(el.querySelector('[data-allocation-stat="Issues"]')!.children[1]!).color,
                rows: new Set(cells.map(c => Math.round(c.getBoundingClientRect().top))).size };
        });
        expect(stats).toEqual({ columns: 2, padding: "16px", count: 4, issues: warnText, rows: 2 });
        await expect(body.locator("[data-allocation-hints] li")).toHaveCount(3);
        // A resource over its max: its banner, the shared one, in a section 12px by 16px.
        const row = frame.locator('[data-allocation-timeline] [data-allocation-resource="K-207"]');
        await row.scrollIntoViewIfNeeded();
        await row.click(); await settled(page);
        const banner = body.locator('[data-allocation-banner="Over max"]');
        await expect(banner).toContainText("K-207 holds 44 m³ against a 40 m³ max · 4 m³ over.");
        expect(await banner.evaluate((el) => { const s = getComputedStyle(el); return { padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].join(" "), rule: `${s.borderBottomWidth} ${s.borderBottomStyle} ${s.borderBottomColor}`, alert: el.querySelector("[role]") !== null }; }))
            .toEqual({ padding: "12px 16px 12px 16px", rule: `1px solid ${subtle}`, alert: true });
        expect(await end.locator(":scope > *").first().evaluate(leaves)).toEqual([]);
        // Issues: 16px in, groups 20px apart; each group's head and its 16px count; each issue a bordered card 8px by 12px.
        await end.getByRole("tab", { name: /^Issues/ }).click(); await settled(page);
        const issues = end.locator('[data-allocation-inspector="issues"] [data-allocation-issues]');
        const tab = await issues.evaluate((root) => {
            const s = getComputedStyle(root), groups = [...root.querySelectorAll("[data-allocation-issue-group]")];
            const head = groups[0]!.firstElementChild!, count = head.lastElementChild!, issue = groups[0]!.querySelector("[data-allocation-issue]")!, is = getComputedStyle(issue);
            const gaps = groups.slice(1).map((g, i) => Math.round(g.getBoundingClientRect().top - groups[i]!.getBoundingClientRect().bottom));
            return { padding: s.paddingTop, gaps: [...new Set(gaps)], head: Math.round(head.getBoundingClientRect().height), count: [Math.round(count.getBoundingClientRect().width), Math.round(count.getBoundingClientRect().height)],
                issue: { border: `${is.borderTopWidth} ${is.borderTopStyle} ${is.borderTopColor}`, padding: [is.paddingTop, is.paddingLeft].join(" ") } };
        });
        expect(tab).toMatchObject({ padding: "16px", gaps: [20], head: 16, count: [16, 16] });
        expect(tab.issue).toEqual({ border: `1px solid ${strong}`, padding: "8px 12px" });
        expect(await end.locator(":scope > *").first().evaluate(leaves)).toEqual([]);
        // Collapsed: a 44px rail, its badge the count, its mark in warn.
        await end.getByRole("button", { name: "Collapse Inspector" }).click(); await settled(page);
        const rail = await end.evaluate((el) => {
            const badge = el.querySelector("[data-dock-badge]")!, mark = el.querySelector("[data-dock-mark]")!;
            return { w: Math.round(el.getBoundingClientRect().width), badge: badge.textContent, mark: mark.getAttribute("aria-label"), color: getComputedStyle(mark).color,
                icon: mark.querySelector("svg[data-icon='triangle-exclamation']") !== null };
        });
        expect(rail).toEqual({ w: 44, badge: "3", mark: "3 issues", color: await token(page, "status-warn"), icon: true });
        await end.getByRole("button", { name: "Expand Inspector" }).click(); await settled(page);
        expect(await end.evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(320);
    });

    test(`A34, A40 — a pick's drop list, 48px dashed brand targets; a refused drop's note at the top of Details, 12px by 16px in (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationKilnYard", theme);
        await size(page, entry, 1440);
        const frame = entry.locator("[data-allocation-frame]").first();
        const end = endPane(frame);
        const body = details(frame);
        const brand = await token(page, "brand-solid");
        // A pick: its best fits as rows — the fit's, at most three (the DOM spec holds which) — each a dashed brand target 48px at
        // least, its rank a 16px brand badge, a Book on it.
        const picked = frame.locator('[data-allocation-library="events"] [data-library-item="event:LD-2235"]');
        await picked.scrollIntoViewIfNeeded();
        await picked.click(); await settled(page);
        const rows = body.locator("[data-allocation-drop-row]");
        await expect(rows.first()).toBeVisible();
        expect(await rows.count()).toBeLessThanOrEqual(3);
        const drop = await rows.evaluateAll((els) => els.map((el) => {
            const s = getComputedStyle(el), rank = el.firstElementChild!, r = rank.getBoundingClientRect();
            return { h: el.getBoundingClientRect().height, border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
                rank: [Math.round(r.width), Math.round(r.height), getComputedStyle(rank).backgroundColor], book: el.querySelector("button")?.textContent ?? null };
        }));
        for (const row of drop) {
            expect(row.h).toBeGreaterThanOrEqual(48);
            expect([row.border, row.rank, row.book]).toEqual([`1px dashed ${brand}`, [16, 16, brand], "Book"]);
        }
        expect(await end.locator(":scope > *").first().evaluate(leaves)).toEqual([]);
        await page.keyboard.press("Escape"); await settled(page);
        await expect(rows).toHaveCount(0);
        // A connector dropped on a resource that refuses it: nothing moves, and the reason is the note at the top of Details.
        const timeline = frame.locator("[data-allocation-timeline]");
        const card = timeline.locator('[data-allocation-card="3101"]');
        await card.scrollIntoViewIfNeeded();
        await card.click(); await settled(page);
        await timeline.evaluate(el => el.scrollIntoView({ block: "center" })); await settled(page);
        await timeline.locator("[data-virtual-rows]").evaluate(async (el) => {
            el.setAttribute("data-snap-suspended", "");
            el.scrollTop = 0;
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            el.removeAttribute("data-snap-suspended");
        });
        await settled(page);
        await pickUp(page, card.locator("[data-allocation-connector]"), timeline, "port");
        const k101 = timeline.locator('[data-allocation-resource="K-101"]');
        await bring(page, k101);
        await expect(k101).toHaveAttribute("data-drop-invalid", "");
        await page.mouse.up(); await settled(page);
        const note = body.locator("[data-allocation-refusal]");
        await expect(note).toContainText("LD-2201 can’t go into K-101: over max by 34 m³.");
        expect(await note.evaluate((el) => {
            const s = getComputedStyle(el);
            return { margin: [s.marginTop, s.marginRight, s.marginBottom, s.marginLeft].join(" "), first: el.parentElement!.firstElementChild === el, dismiss: el.querySelector("button") !== null };
        })).toEqual({ margin: "12px 16px 0px 16px", first: true, dismiss: true });
        await expect(card.locator("[data-allocation-to]")).toHaveText("K-209");
        expect(await end.locator(":scope > *").first().evaluate(leaves)).toEqual([]);
    });

    test(`the Inspector at 1440/1024/768/390/360 and a 294px parent: beside main where it has room, else over main with a strip of it left; its Chooser inside it; nothing leaves the frame (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "allocationKilnYard", theme);
        const frame = entry.locator("[data-allocation-frame]").first();
        const end = endPane(frame);
        await size(page, entry, 1440);
        const card = frame.locator('[data-allocation-timeline] [data-allocation-card="3113"]');
        await card.scrollIntoViewIfNeeded();
        await card.click(); await settled(page);
        /** The field's Chooser, opened in the pane: nothing of it leaves the pane; Esc closes it and keeps the bin. */
        const chooserFits = async (width: number) => {
            const body = details(frame);
            await body.locator("[data-allocation-resource-field]").click(); await settled(page);
            await expect(body.locator("[data-chooser]").getByRole("option").first()).toBeVisible();
            expect(await end.locator(":scope > *").first().evaluate(leaves), `${width}px Chooser`).toEqual([]);
            await page.keyboard.press("Escape"); await settled(page);
            await expect(body.locator("[data-chooser]")).toHaveCount(0);
        };
        for (const width of [1440, 1024, 768, 390, 360, 294]) {
            await size(page, entry, width);
            const fit = await frame.evaluate((root) => {
                const f = root.getBoundingClientRect(), slot = root.querySelector('[data-frame-slot="end"]')!;
                const out: string[] = [];
                if (root.scrollWidth - root.clientWidth > 1) out.push("the frame overflows");
                if (slot.getBoundingClientRect().right > f.right + 0.5) out.push("the pane leaves the frame");
                return { mode: slot.getAttribute("data-pane-mode"), faults: out };
            });
            expect(fit.faults, `${width}px`).toEqual([]);
            expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px page`).toBeLessThanOrEqual(0);
            if (width === 1440) {
                expect(fit.mode).toBe("pinned");
                expect(await end.locator(":scope > *").first().evaluate(leaves), `${width}px`).toEqual([]);
                await chooserFits(width);
                continue;
            }
            // Short of room, it overlays main: opened, it floats over it, a 48px strip of main beside it, the bin's sections inside it.
            expect(fit.mode, `${width}px`).toBe("overlay");
            await end.getByRole("button", { name: "Expand Inspector" }).click(); await settled(page);
            const opened = await frame.evaluate((root) => {
                const sheet = root.querySelector('[data-frame-slot="end"] > *')!.getBoundingClientRect(), start = root.querySelector('[data-frame-slot="start"]')!.getBoundingClientRect();
                return { strip: Math.round(sheet.left - start.right), title: root.querySelector('[data-allocation-inspector="details"] [data-inspector-title]')?.textContent ?? null };
            });
            expect(opened.strip, `${width}px strip`).toBeGreaterThanOrEqual(48);
            expect(opened.title, `${width}px`).toBe("LD-2210 · 32 m³");
            expect(await end.locator(":scope > *").first().evaluate(leaves), `${width}px`).toEqual([]);
            await chooserFits(width);
            await end.getByRole("button", { name: "Collapse Inspector" }).click(); await settled(page);
        }
    });
}
