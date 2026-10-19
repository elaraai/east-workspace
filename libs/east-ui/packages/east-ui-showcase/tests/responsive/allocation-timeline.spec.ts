/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
/**
 * The Allocation's Timeline (#1326) on the real in-page e3: the mock's
 * anatomy, measured in the page in both themes (`Allocation Spec.md` §8); the
 * board at every width with nothing overflowing; the scrolls that follow a
 * selection (A12); and what a drag draws (#1328, A24–A31), as the mock draws
 * LD-2201's; a link's drag — its `was` line, the new line to the pointer and
 * the drag's families (A69, A65) — and an event's lines into its best fits
 * (A30), at the widths that drag, in both themes.
 */
import { expect, test, type Locator, type Page } from "playwright/test";
import { open, size, token } from "./allocation-page";
import { settled } from "./settle";

/** An element's type, as the page draws it. */
const type = (el: Element) => { const s = getComputedStyle(el); return { size: s.fontSize, weight: s.fontWeight, line: s.lineHeight, mono: /mono/i.test(s.fontFamily) }; };
/** A colour the page mixes, as it resolves it: `pct` of one token into another. */
const mix = (page: Page, a: string, pct: number, b: string) => page.evaluate(([a, pct, b]) => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = `color-mix(in oklch, var(--chakra-colors-${a}) ${pct}%, var(--chakra-colors-${b}))`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
}, [a, pct, b] as const);
/** Picks an element up with the mouse, past the 5px a drag waits for, and waits for the board to draw the drag. */
async function pickUp(page: Page, el: Locator, timeline: Locator, kind: "body" | "port" | "link" | "event", at?: { x: number; y: number }) {
    const box = (await el.boundingBox())!;
    const from = at ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 4; i++) await page.mouse.move(from.x + i * 3, from.y + i * 2);
    await expect(timeline).toHaveAttribute("data-allocation-drag", kind);
    await settled(page);
}
/**
 * Where the drag's ghost is, against the pointer: its words, and whether the
 * overlay holding it sits 12 right of and 8 below the pointer, as the shared
 * layer sets it (a px either way for the pointer's fraction), the ghost at its
 * corner.
 */
const ghostAt = (page: Page, pointer: readonly number[]) => page.evaluate(([x, y]) => {
    const overlay = document.querySelector(".east-drag-ghost")!.getBoundingClientRect(), ghost = document.querySelector("[data-drag-ghost] [data-move-ghost]")!;
    const box = ghost.getBoundingClientRect();
    return { text: ghost.textContent, beside: Math.abs(overlay.left - x! - 12) <= 1 && Math.abs(overlay.top - y! - 8) <= 1 && Math.abs(box.left - overlay.left) <= 1 && box.top >= overlay.top - 1 && box.top <= overlay.top + 6 };
}, pointer);
/** A point over a resource row in its pane's view: its middle, short of the pane's right edge, where a row wider than its pane runs under it. */
const rowPoint = (row: Locator) => row.evaluate(el => {
    const b = el.getBoundingClientRect(), pane = el.closest("[data-virtual-rows]")!.getBoundingClientRect();
    return [Math.round(Math.min(b.left + b.width / 2, pane.right - 60)), Math.round(b.top + b.height / 2)];
});
/** Brings an under-way drag to a point, in steps. */
async function moveTo(page: Page, [x, y]: readonly number[]) {
    await page.mouse.move(x! - 4, y!, { steps: 4 });
    await page.mouse.move(x!, y!);
    await settled(page);
}
/** Each link the board's links layer draws: its bin and resource, its tone, and its band's and head's ink. */
const linksDrawn = (layer: Locator) => layer.evaluate(el => [...el.querySelectorAll("[data-plan-link]")].map(g => {
    const band = getComputedStyle(g.querySelector("[data-plan-ribbon-band]")!), head = getComputedStyle(g.querySelector("[data-plan-ribbon-head]")!);
    return { link: g.querySelector("[data-link]")!.getAttribute("data-allocation-link"), tone: g.getAttribute("data-tone"), stroke: band.stroke, width: band.strokeWidth, head: head.fill };
}));
/**
 * Scrolls the resource pane to a row offset as the board does: its mandatory
 * snap waits for the rows there to mount, else it would land on the nearest
 * row mounted before the jump.
 */
const rowsTo = (timeline: Locator, top: "start" | "end") => timeline.locator("[data-virtual-rows]").evaluate(async (el, top) => {
    el.setAttribute("data-snap-suspended", "");
    el.scrollTop = top === "start" ? 0 : el.scrollHeight;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    el.removeAttribute("data-snap-suspended");
}, top);
/**
 * Brings an under-way drag over an element, at a point of it — by default a
 * third of the way in, clear of every scrolling box's edge band, where the
 * drag layer would scroll the box under the pointer.
 */
async function bring(page: Page, el: Locator, at: { x: number } = { x: 0.3 }) {
    const box = (await el.boundingBox())!;
    await page.mouse.move(box.x + box.width * at.x - 4, box.y + box.height / 2, { steps: 4 });
    await page.mouse.move(box.x + box.width * at.x, box.y + box.height / 2);
    await settled(page);
}

for (const theme of ["light", "dark"] as const) {
    test(`Timeline anatomy is the mock's (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationKilnYard", theme);
        await size(page, entry, 1440);
        const timeline = entry.locator("[data-allocation-timeline]").first();
        const geometry = await timeline.evaluate((root) => {
            const r = (el: Element | null) => { const b = el!.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
            const heads = [...root.querySelectorAll(":scope [data-allocation-lanes] > * > :first-child, [data-allocation-channel] > :first-child, [data-allocation-resource-head]")].map(el => r(el).h);
            const grid = r(root.querySelector("[data-allocation-grid]"));
            const card = r(root.querySelector('[data-allocation-card="3101"]'));
            const caption = root.querySelector("[data-allocation-lanes] [data-head-caption]")!;
            const lanes = [...root.querySelectorAll("[data-allocation-lane]")].map(el => r(el).w);
            const row = root.querySelector('[data-allocation-resource="K-105"]')!;
            const label = row.firstElementChild!, labelStyle = getComputedStyle(label);
            const load = row.querySelector("[data-allocation-load]")!;
            const units = root.querySelector("[data-time-ruler=units]")!, ticks = root.querySelector("[data-time-ruler=ticks]")!;
            const badge = root.querySelector("[data-time-ruler=ticks] > [data-now] > [data-tick-label]")!;
            return {
                heads, laneCaption: r(caption).w, lanes, channel: r(root.querySelector("[data-allocation-channel]")).w,
                card: { w: card.w, h: card.h, left: card.x - grid.x, top: card.y - grid.y },
                rowH: r(row).h, label: { w: r(label).w, left: labelStyle.paddingLeft, right: labelStyle.paddingRight },
                bar: { top: r(load).y - r(row).y, h: r(load).h, radius: getComputedStyle(load).borderTopLeftRadius },
                ruler: { units: r(units).h, ticks: r(ticks).h, badge: r(badge).h },
            };
        });
        expect(geometry.heads).toEqual([48, 48, 48]);
        expect(geometry.laneCaption).toBe(48);
        expect(geometry.lanes).toEqual([96, 96, 96]);
        expect(geometry.channel).toBe(48);
        // LD-2201 is B-3's 01:55 bin: 88 × 28 at 52 + 96 × 2, the hour of 01's top + 4.
        expect(geometry.card).toEqual({ w: 88, h: 28, left: 244, top: 40 });
        expect(geometry.rowH).toBe(36);
        expect(geometry.label).toEqual({ w: 152, left: "20px", right: "12px" });
        expect(geometry.bar).toEqual({ top: 8, h: 20, radius: "4px" });
        expect(geometry.ruler).toEqual({ units: 24, ticks: 23, badge: 16 });

        const card = timeline.locator('[data-allocation-card="3101"]');
        expect(await card.locator("[data-allocation-code]").evaluate(type)).toEqual({ size: "10.5px", weight: "600", line: "12px", mono: true });
        expect(await card.locator("[data-allocation-to]").evaluate(type)).toMatchObject({ size: "9.5px", mono: true });
        expect(await card.evaluate(el => getComputedStyle(el).borderTopColor)).toBe(await token(page, "border-strong"));
        const row = timeline.locator('[data-allocation-resource="K-207"]');
        expect(await row.locator("span").first().evaluate(type)).toEqual({ size: "11px", weight: "600", line: "14px", mono: true });
        const line = row.locator("[data-allocation-line]");
        expect(await line.evaluate(type)).toEqual({ size: "9.5px", weight: "600", line: "12px", mono: true });
        expect(await line.evaluate(el => getComputedStyle(el).color)).toBe(await token(page, "fg-danger"));
        expect(await timeline.locator('[data-allocation-resource="K-101"] [data-allocation-line]').evaluate(el => getComputedStyle(el).color)).toBe(await token(page, "fg-subtle"));
        expect(await timeline.locator('[data-allocation-resource="K-105"] [data-allocation-load]').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await token(page, "brand-solid"));
        expect(await timeline.locator("[data-allocation-channel]").evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await token(page, "bg-canvas"));
        expect(await timeline.locator("[data-time-ruler=ticks] > [data-now] > [data-tick-label]").evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await token(page, "brand-solid"));

        // A13: the focus dims every other card to the rule border and ink-4 words; the pointer on one lifts it.
        await card.click(); await settled(page);
        const other = timeline.locator('[data-allocation-card="3102"]');
        await page.mouse.move(0, 0);
        expect(await other.evaluate(el => getComputedStyle(el).borderTopColor)).toBe(await token(page, "border-subtle"));
        expect(await other.locator("[data-allocation-code]").evaluate(el => getComputedStyle(el).color)).toBe(await token(page, "fg-subtle"));
        await other.hover();
        expect(await other.evaluate(el => getComputedStyle(el).borderTopColor)).toBe(await token(page, "border-strong"));
        // A21: the selected card's connector, a 22px target on its right edge holding a 10px square.
        const connector = card.locator("[data-allocation-connector]");
        expect(await connector.evaluate(el => { const b = el.getBoundingClientRect(), c = el.parentElement!.getBoundingClientRect(); return { w: b.width, h: b.height, right: Math.round(b.right - c.right), top: Math.round(b.top - c.top) }; }))
            .toEqual({ w: 22, h: 22, right: 11, top: 3 });
    });

    test(`Timeline fits 1440/1024/768/390/360 and a 294px parent; below 480px of main, its cards (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await open(page, "allocationKilnYard", theme);
        for (const width of [1440, 1024, 768, 390, 360, 294]) {
            await size(page, entry, width);
            const at = await entry.locator("[data-allocation-frame]").first().evaluate((frame) => {
                const faults: string[] = [];
                const box = frame.getBoundingClientRect();
                const main = frame.querySelector("[data-allocation-main]")!.getBoundingClientRect();
                if (frame.scrollWidth - frame.clientWidth > 1) faults.push("frame overflows");
                const timeline = frame.querySelector("[data-allocation-timeline]");
                // The Timeline is main's from 480px of main; below it, the narrow layout's cards (A78, #1333).
                const cards = frame.querySelector('[data-allocation-cards="timeline"]');
                if (main.width < 480 && (timeline !== null || cards === null)) faults.push("below 480px of main, main is not the Timeline's cards");
                if (main.width >= 480 && (timeline === null || cards !== null)) faults.push("from 480px of main, main is not the Timeline");
                if (timeline !== null && main.width >= 480) {
                    const t = timeline.getBoundingClientRect();
                    if (t.right > box.right + 1 || t.left < box.left - 1) faults.push("timeline leaves the frame");
                    for (const pane of timeline.children) if (pane.getBoundingClientRect().right > t.right + 1) faults.push(`a pane leaves the timeline`);
                }
                return { main: main.width, faults };
            });
            expect(at.main, `${width}px main`).toBeGreaterThan(0);
            expect(at.faults, `${width}px`).toEqual([]);
            expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px page`).toBeLessThanOrEqual(0);
        }
    });

    test(`A12 — selecting follows the selection: a bin scrolls its lane hour into view and levels its resource row with it (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationKilnYard", theme);
        await size(page, entry, 1440);
        const timeline = entry.locator("[data-allocation-timeline]").first();
        // A bin's resource row levels with its card, snapped to rows: LD-2216 (B-3 17:56) on K-205, LD-2213 (B-3 16:55) on K-303.
        for (const [id, resource] of [["3119", "K-205"], ["3116", "K-303"]] as const) {
            const card = timeline.locator(`[data-allocation-card="${id}"]`);
            await card.scrollIntoViewIfNeeded();
            await card.click(); await settled(page);
            const level = await timeline.evaluate((root, [id, resource]) => {
                const lane = root.querySelector<HTMLElement>("[data-allocation-lanes]")!, rows = root.querySelector<HTMLElement>("[data-virtual-rows]")!;
                const card = root.querySelector(`[data-allocation-card="${id}"]`)!.getBoundingClientRect();
                const row = root.querySelector(`[data-allocation-resource="${resource}"]`)!.getBoundingClientRect();
                const view = lane.getBoundingClientRect();
                return { inView: card.top >= view.top + 48 && card.bottom <= view.bottom, apart: Math.abs((card.top + card.height / 2) - (row.top + row.height / 2)), snapped: rows.scrollTop % 36 };
            }, [id, resource]);
            expect(level.inView, id).toBe(true);
            expect(level.apart, id).toBeLessThanOrEqual(18);
            expect(level.snapped, id).toBe(0);
        }
        // A resource below the view scrolls its row into view.
        const k602 = timeline.locator('[data-allocation-resource="K-602"]');
        await timeline.locator("[data-virtual-rows]").evaluate(el => { el.scrollTop = el.scrollHeight; });
        await settled(page);
        await k602.click(); await settled(page);
        expect(await k602.evaluate(el => { const b = el.getBoundingClientRect(), p = el.closest("[data-virtual-rows]")!.getBoundingClientRect(); return b.top >= p.top + 48 && b.bottom <= p.bottom; })).toBe(true);
    });

    test(`A65–A68 — the focus's links: Plan's look, its routes through the channel, lit, selected and unlinked (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationKilnYard", theme);
        await size(page, entry, 1440);
        const timeline = entry.locator("[data-allocation-timeline]").first();
        await expect(timeline.locator("[data-allocation-links]")).toHaveCount(0);
        // K-202 holds LD-2219 (B-3 20:55, 22 m³) and LD-2221 (B-2 23:35, 17 m³). Selecting LD-2219 brings its card and its row level.
        const row = timeline.locator('[data-allocation-resource="K-202"]');
        const ld2219 = timeline.locator('[data-allocation-card="3123"]');
        await ld2219.scrollIntoViewIfNeeded();
        await ld2219.click(); await settled(page);
        const layer = timeline.locator("[data-allocation-links]");
        await expect(layer.locator("[data-plan-link]")).toHaveCount(2);
        const routeOf = () => timeline.evaluate((root) => {
            const box = root.getBoundingClientRect(), layerBox = root.querySelector("[data-allocation-links]")!.getBoundingClientRect();
            const card = root.querySelector('[data-allocation-card="3123"]')!.getBoundingClientRect();
            const channel = root.querySelector("[data-allocation-channel]")!.getBoundingClientRect();
            const hit = root.querySelector('[data-allocation-link="3123|K-202"]')!;
            const link = hit.closest("[data-plan-link]")!;
            const start = hit.getAttribute("d")!.match(/^M ([\d.]+) ([\d.]+)/)!;
            const tips = [...link.querySelector("[data-plan-ribbon-head]")!.getAttribute("d")!.matchAll(/L ([\d.]+) ([\d.]+)/g)].map(m => Number(m[1]));
            return { route: link.getAttribute("data-plan-route"), stub: link.querySelector("[data-plan-stub]")?.getAttribute("data-plan-stub") ?? null,
                startX: Math.round(Number(start[1]) + layerBox.left - box.left), cardRight: Math.round(card.right - box.left),
                startY: Math.round(Number(start[2]) + layerBox.top), cardMiddle: Math.round(card.top + card.height / 2),
                tip: Math.round(Math.max(...tips) + layerBox.left), channelRight: Math.round(channel.right) };
        });
        const level = await routeOf();
        // Both ends in view: an S through the channel (a straight feed when the two lie level).
        expect(["s", "feed"]).toContain(level.route);
        // It leaves the card's right edge at its middle, and its head meets the row's leading edge.
        expect(level.startX).toBe(level.cardRight);
        expect(Math.abs(level.startY - level.cardMiddle)).toBeLessThanOrEqual(1);
        expect(level.tip).toBe(level.channelRight);
        // The card scrolled out of the lane grid's view below: the link enters up from the view's edge, in Plan's stub.
        await timeline.locator("[data-allocation-lanes]").evaluate(el => { el.scrollTop = 0; }); await settled(page);
        const off = await routeOf();
        expect([off.route, off.stub]).toEqual(["stub", "below"]);
        await ld2219.scrollIntoViewIfNeeded(); await settled(page);
        // Plan's look: the muted ink over a paper casing; captions mono 10 / 500 on a paper knockout 12 tall.
        const band = layer.locator('[data-plan-link] [data-plan-ribbon-band]').first();
        expect(await band.evaluate(el => getComputedStyle(el).stroke)).toBe(await token(page, "fg-muted"));
        expect(await layer.locator('[data-plan-casing="band"]').first().evaluate(el => getComputedStyle(el).stroke)).toBe(await token(page, "bg-surface"));
        const caption = layer.locator("[data-plan-ribbon-caption]").first();
        expect(await caption.evaluate(el => { const s = getComputedStyle(el); return [s.fontSize, s.fontWeight, /mono/i.test(s.fontFamily)]; })).toEqual(["10px", "500", true]);
        expect(await layer.locator("[data-plan-ribbon-knockout]").first().evaluate(el => [el.getAttribute("height"), getComputedStyle(el).fill])).toEqual(["12", await token(page, "bg-surface")]);
        // A67: the pointer on a link lights it in the strong ink, its card and its resource's load haloed 1px, 4 outside.
        const hit = layer.locator('[data-allocation-link="3123|K-202"]');
        await hit.hover({ force: true }); await settled(page);
        expect(await layer.locator("[data-plan-link][data-lit] [data-plan-ribbon-band]").evaluate(el => getComputedStyle(el).stroke)).toBe(await token(page, "fg-strong"));
        const halo = (el: Element) => { const s = getComputedStyle(el); return [s.outlineStyle, s.outlineWidth, s.outlineOffset, s.outlineColor]; };
        const strong = await token(page, "fg-strong");
        expect(await timeline.locator('[data-allocation-card="3123"]').evaluate(halo)).toEqual(["solid", "1px", "4px", strong]);
        expect(await row.locator("[data-allocation-load]").evaluate(halo)).toEqual(["solid", "1px", "4px", strong]);
        // A68: a click selects it, in the ink, its caption outlined with a 16px × that unlinks.
        await hit.click({ force: true }); await settled(page);
        expect(await layer.locator("[data-plan-link][data-selected] [data-plan-ribbon-band]").evaluate(el => getComputedStyle(el).stroke)).toBe(await token(page, "fg"));
        const unlink = layer.locator("[data-plan-ribbon-unlink] button");
        expect(await unlink.evaluate(el => { const b = el.getBoundingClientRect(); return [b.width, b.height]; })).toEqual([16, 16]);
        await unlink.click(); await settled(page);
        await expect(timeline.locator('[data-allocation-card="3123"] [data-unlinked]')).toHaveCount(1);
    });

    test(`A27–A31 — a connector's drag: receded rows under run labels, the row under the pointer, the #1's marker, its rank and preview (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationKilnYard", theme);
        await size(page, entry, 1440);
        const timeline = entry.locator("[data-allocation-timeline]").first();
        const card = timeline.locator('[data-allocation-card="3101"]');
        await card.scrollIntoViewIfNeeded();
        // Selected, its connector shows; the resource pane back at its top, where K-101 is.
        await card.click(); await settled(page);
        // The whole board in the window, clear of the page's own header.
        await timeline.evaluate(el => el.scrollIntoView({ block: "center" })); await settled(page);
        await rowsTo(timeline, "start"); await settled(page);
        await pickUp(page, card.locator("[data-allocation-connector]"), timeline, "port");
        const k101 = timeline.locator('[data-allocation-resource="K-101"]');
        await expect(k101).toHaveAttribute("data-refused", "");
        // A27: a refusing row recedes — its name in ink-4, its load on paper-3 in the rule, what it refuses for outlined in warn.
        const k102 = timeline.locator('[data-allocation-resource="K-102"]');
        expect(await k102.locator("span").first().evaluate(el => getComputedStyle(el).color)).toBe(await token(page, "fg-subtle"));
        const load = await k102.locator("[data-allocation-load]").evaluate(el => { const s = getComputedStyle(el); return [s.backgroundColor, s.borderTopColor, s.outlineStyle, s.outlineWidth, s.outlineOffset, s.outlineColor]; });
        expect(load).toEqual([await token(page, "bg-subtle"), await token(page, "border-strong"), "solid", "1px", "2px", await token(page, "status-warn")]);
        // Its run's label: mono 10 / 600 in warn-text on the paper, ringed in warn, 20 tall, 22px in from the plot's right; its count and range in ink-3 500.
        const run = timeline.locator("[data-run][data-from='0']");
        expect(await run.evaluate(el => { const s = getComputedStyle(el), b = el.getBoundingClientRect(), row = el.closest("[data-virtual-rows]")!.querySelector('[data-allocation-resource="K-101"]')!.getBoundingClientRect();
            return [s.fontSize, s.fontWeight, /mono/i.test(s.fontFamily), s.color, s.backgroundColor, s.borderTopColor, b.height, Math.round(row.right - b.right)]; }))
            .toEqual(["10px", "600", true, await token(page, "fg-warning"), await token(page, "bg-surface"), await token(page, "status-warn"), 20, 22]);
        expect(await run.locator("span").last().evaluate(el => [getComputedStyle(el).fontWeight, getComputedStyle(el).color])).toEqual(["500", await token(page, "fg-muted")]);
        // A31: the #1 lies below the view — one marker at the pane's edge, dashed in the brand on the paper, 28 tall, mono 10.5 / 600.
        const marker = timeline.locator("[data-allocation-marker]");
        await expect(marker).toHaveText("1 fit below · #1 K-601 · drop here");
        expect(await marker.evaluate(el => { const s = getComputedStyle(el), b = el.getBoundingClientRect(), pane = el.closest("[data-virtual-rows]")!.getBoundingClientRect();
            return [s.borderTopStyle, s.borderTopColor, s.borderTopLeftRadius, s.backgroundColor, s.color, s.fontSize, s.fontWeight, b.height, Math.round(pane.bottom - b.bottom), Math.round(b.left - pane.left)]; }))
            .toEqual(["dashed", await token(page, "brand-solid"), "6px", await token(page, "bg-surface"), await token(page, "brand-pressed"), "10.5px", "600", 28, 12, 164]);
        // A29: the row under the pointer refuses — warn 6% on the paper, its reason `✕ over max by 34 m³` in warn-text, its bin outlined warn, its run's label aside.
        await bring(page, k101);
        await expect(k101).toHaveAttribute("data-drop-invalid", "");
        expect(await k101.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await mix(page, "status-warn", 6, "bg-surface"));
        const why = k101.locator("[data-allocation-reason]");
        expect(await why.evaluate(el => { const s = getComputedStyle(el); return [s.display, s.fontSize, s.fontWeight, s.lineHeight, s.color, s.backgroundColor]; }))
            .toEqual(["block", "9.5px", "600", "16px", await token(page, "fg-warning"), await token(page, "bg-surface")]);
        await expect(why).toHaveText(/over max by 34 m³/);
        expect(await timeline.locator('[data-allocation-card="3125"]').evaluate(el => getComputedStyle(el).borderTopColor)).toBe(await token(page, "status-warn"));
        expect(await run.evaluate(el => getComputedStyle(el).visibility)).toBe("hidden");
        // A refused drop: nothing moves (A40).
        await page.mouse.up(); await settled(page);
        await expect(timeline.locator("[data-refused], [data-run], [data-allocation-marker]")).toHaveCount(0);

        // A28: with K-601 in view, its #1 — a 16px brand badge before its name, a dashed preview `+35 m³ · 35 m³` in brand-tint, its reason in ink-2.
        await rowsTo(timeline, "end"); await settled(page);
        await pickUp(page, card.locator("[data-allocation-connector]"), timeline, "port");
        const k601 = timeline.locator('[data-allocation-resource="K-601"]');
        const rank = k601.locator("[data-allocation-rank]");
        await expect(rank).toHaveText("1");
        expect(await rank.evaluate(el => { const s = getComputedStyle(el), b = el.getBoundingClientRect(); return [b.width, b.height, s.backgroundColor, s.color, s.fontSize, s.fontWeight, s.borderTopLeftRadius]; }))
            .toEqual([16, 16, await token(page, "brand-solid"), await token(page, "bg-surface"), "10px", "600", "4px"]);
        const preview = k601.locator("[data-allocation-preview]");
        await expect(preview).toHaveText("+35 m³ · 35 m³");
        expect(await preview.evaluate(el => { const s = getComputedStyle(el); return [s.borderTopStyle, s.borderTopColor, s.backgroundColor, getComputedStyle(el.firstElementChild!).color]; }))
            .toEqual(["dashed", await token(page, "brand-solid"), await token(page, "brand-tint"), await token(page, "brand-pressed")]);
        expect(await k601.locator("[data-allocation-reason]").evaluate(el => [getComputedStyle(el).display, getComputedStyle(el).color])).toEqual(["block", await token(page, "fg-strong")]);
        // Under the pointer it fits: brand-tint.
        await bring(page, k601);
        await expect(k601).toHaveAttribute("data-drop-active", "");
        expect(await k601.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await token(page, "brand-tint"));
        await page.keyboard.press("Escape"); await page.mouse.up(); await settled(page);
    });

    test(`A24 — a card body's drag: every free lane hour a dashed target 4px in, the one under the pointer brand-tint; the card it leaves a dashed hole (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationKilnYard", theme);
        await size(page, entry, 1440);
        const timeline = entry.locator("[data-allocation-timeline]").first();
        const card = timeline.locator('[data-allocation-card="3103"]');
        await card.scrollIntoViewIfNeeded();
        await pickUp(page, card, timeline, "body");
        const free = timeline.locator("[data-allocation-cell][data-free]").first();
        const placeholder = (cell: Locator) => cell.locator("[data-allocation-placeholder]").evaluate(el => {
            const s = getComputedStyle(el), b = el.getBoundingClientRect(), c = el.parentElement!.getBoundingClientRect();
            return { style: [s.display, s.borderTopStyle, s.borderTopColor, s.backgroundColor, s.borderTopLeftRadius], inset: [Math.round(b.top - c.top), Math.round(c.bottom - b.bottom), Math.round(c.right - b.right)] };
        });
        expect(await placeholder(free)).toEqual({ style: ["block", "dashed", await token(page, "border-strong"), "rgba(0, 0, 0, 0)", "4px"], inset: [4, 4, 4] });
        const target = timeline.locator("[data-allocation-cell][data-free]").nth(4);
        await bring(page, target, { x: 0.5 });
        expect((await placeholder(target)).style.slice(1, 4)).toEqual(["dashed", await token(page, "brand-solid"), await token(page, "brand-tint")]);
        // The pointer gone from it, the card it leaves is a hole.
        expect(await card.evaluate(el => { const s = getComputedStyle(el); return [s.borderTopStyle, s.borderTopColor, s.backgroundColor]; }))
            .toEqual(["dashed", await token(page, "brand-solid"), "rgba(0, 0, 0, 0)"]);
        await page.keyboard.press("Escape"); await page.mouse.up(); await settled(page);
        await expect(timeline.locator("[data-allocation-placeholder]").first()).toBeHidden();
    });

    test(`A69, A65 — a link's drag wherever main takes drags: its caption a grip, its link the 1.5 ink-4 was line on its casing, the brand-d 3 new line over the cards to the pointer, the target's family ink-2 where it fits and warn where it refuses, no link taking the pointer; narrower, no grip — at 1440/1024/768/390/360 and in a 294px parent (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationKilnYard", theme);
        const frame = entry.locator("[data-allocation-frame]").first();
        const ink = { muted: await token(page, "fg-muted"), strong: await token(page, "fg-strong"), subtle: await token(page, "fg-subtle"), warn: await token(page, "status-warn"),
            brand: await token(page, "brand-solid"), paper: await token(page, "bg-surface") };
        for (const width of [1440, 1024, 768, 390, 360, 294]) {
            await size(page, entry, width);
            const timeline = frame.locator("[data-allocation-timeline]");
            if (await frame.locator("[data-allocation-main]").evaluate(el => el.hasAttribute("data-allocation-narrow"))) {
                // Main under 480px takes no drag (A78): no link to pick up, and nothing leaves the page.
                await expect(frame.locator("[data-allocation-grip], [data-allocation-link-lines]"), `${width}px`).toHaveCount(0);
                expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px page`).toBeLessThanOrEqual(0);
                continue;
            }
            // LD-2208, 1 m³ on K-304 at B-1 09:15, selected: K-304's family drawn, its row level with the card (A12).
            const card = timeline.locator('[data-allocation-card="3110"]');
            await card.scrollIntoViewIfNeeded(); await card.click(); await settled(page);
            await timeline.evaluate(el => el.scrollIntoView({ block: "center" })); await settled(page);
            const layer = timeline.locator("[data-allocation-links]");
            const caption = layer.locator('[data-allocation-caption="3110|K-304"]');
            // At rest a caption is a grip: a hand to pick up.
            expect(await caption.evaluate(el => [el.hasAttribute("data-allocation-grip"), getComputedStyle(el).cursor, getComputedStyle(el).touchAction]), `${width}px`).toEqual([true, "grab", "none"]);
            if (width === 1440) {
                // Reached from the keyboard, it is ringed in the focus ink on its knockout, 2px: the link's one control.
                await page.keyboard.press("Shift"); await caption.focus();
                expect(await caption.evaluate(el => { const k = getComputedStyle(el.querySelector("[data-plan-ribbon-knockout]")!); return [el.matches(":focus-visible"), k.stroke, k.strokeWidth, getComputedStyle(el).outlineStyle]; }))
                    .toEqual([true, await token(page, "border-focus"), "2px", "none"]);
                await caption.blur();
            }
            await caption.hover(); await settled(page);
            await pickUp(page, caption, timeline, "link");
            // Over K-302, which takes LD-2208's part: LD-2217's link into it ink-2.
            const pointer = await rowPoint(timeline.locator('[data-allocation-resource="K-302"]'));
            await moveTo(page, pointer);
            const drawn = await linksDrawn(layer);
            expect(drawn.filter(l => l.link === "3120|K-302").map(l => [l.tone, l.stroke, l.head]), `${width}px fits`).toEqual([["fits", ink.strong, ink.strong]]);
            // K-304's own family plain; LD-2208's link the was line: 1.5 in ink-4, its head too, its casing at the weight it had.
            expect(drawn.filter(l => l.link!.endsWith("|K-304") && l.link !== "3110|K-304").map(l => [l.tone, l.stroke, l.head]), `${width}px plain`)
                .toEqual([[null, ink.muted, ink.muted], [null, ink.muted, ink.muted], [null, ink.muted, ink.muted], [null, ink.muted, ink.muted]]);
            const was = await layer.evaluate(el => {
                const g = el.querySelector("[data-plan-link][data-was]")!, casing = el.querySelector(`[data-plan-ribbon-casing="${g.getAttribute("data-plan-link")}"] [data-plan-casing=band]`)!;
                const band = g.querySelector("[data-plan-ribbon-band]")!;
                return { link: g.querySelector("[data-link]")!.getAttribute("data-allocation-link"), stroke: getComputedStyle(band).stroke, width: getComputedStyle(band).strokeWidth,
                    head: getComputedStyle(g.querySelector("[data-plan-ribbon-head]")!).fill, casing: [getComputedStyle(casing).stroke, getComputedStyle(casing).strokeWidth], weight: Number(band.getAttribute("stroke-width")) };
            });
            expect(was, `${width}px was`).toEqual({ link: "3110|K-304", stroke: ink.subtle, width: "1.5px", head: ink.subtle, casing: [ink.paper, `${was.weight + 2}px`], weight: was.weight });
            // The new line: brand-d 3, its corners round, out of the card's right edge at its middle, its head's tip at the pointer — over the cards.
            const line = await timeline.evaluate((root) => {
                const box = root.querySelector("[data-allocation-link-lines]")!, origin = box.getBoundingClientRect();
                const band = box.querySelector("[data-plan-link-preview] [data-plan-ribbon-band]")!, head = box.querySelector("[data-plan-link-preview] [data-plan-ribbon-head]")!;
                const at = (el: Element) => [...el.getAttribute("d")!.matchAll(/(?:M|L) (-?[\d.]+) (-?[\d.]+)/g)].map(m => [Math.round(Number(m[1]) + origin.left), Math.round(Number(m[2]) + origin.top)]);
                const s = getComputedStyle(band), card = root.querySelector('[data-allocation-card="3110"]')!.getBoundingClientRect();
                const tip = at(head).reduce((a, b) => b[0]! > a[0]! ? b : a);
                return { stroke: s.stroke, width: s.strokeWidth, join: s.strokeLinejoin, cap: s.strokeLinecap, fill: s.fill, head: getComputedStyle(head).fill,
                    z: [getComputedStyle(box).zIndex, getComputedStyle(root.querySelector("[data-allocation-links]")!).zIndex],
                    start: at(band)[0], card: [Math.round(card.right), Math.round(card.top + card.height / 2)], tip };
            });
            expect(line, `${width}px new line`).toEqual({ stroke: ink.brand, width: "3px", join: "round", cap: "butt", fill: "none", head: ink.brand, z: ["7", "5"], start: line.card, card: line.card, tip: pointer });
            // Nothing of a link takes the pointer during a drag, its line or its caption; the captions stay, in ink-3.
            expect(await layer.evaluate(el => [...new Set([...el.querySelectorAll("[data-link], [data-plan-ribbon-label]")].map(n => getComputedStyle(n).pointerEvents))]), `${width}px pointer`).toEqual(["none"]);
            expect(await layer.evaluate(el => [...new Set([...el.querySelectorAll("[data-plan-ribbon-caption]")].map(n => getComputedStyle(n).fill))]), `${width}px captions`).toEqual([ink.muted]);
            // The ghost says the part it carries, set 12 right of and 8 below the pointer.
            expect(await ghostAt(page, pointer), `${width}px ghost`).toEqual({ text: "LD-2208 · 1 m³", beside: true });
            // Over K-301, which refuses it: LD-2214's link warn.
            await moveTo(page, await rowPoint(timeline.locator('[data-allocation-resource="K-301"]')));
            const refused = await linksDrawn(layer);
            expect(refused.filter(l => l.link === "3117|K-301").map(l => [l.tone, l.stroke, l.head]), `${width}px refused`).toEqual([["refused", ink.warn, ink.warn]]);
            expect(refused.some(l => l.link === "3120|K-302"), `${width}px target gone`).toBe(false);
            await page.keyboard.press("Escape"); await page.mouse.up(); await settled(page);
            await expect(timeline.locator("[data-allocation-link-lines], [data-allocation-links] [data-was]")).toHaveCount(0);
        }
    });

    test(`A69 — a link picked up by its line keeps its ghost beside the pointer by the window's edge: the window holds the ghost by its own width, never the route's (${theme}) @desktop`, async ({ page }) => {
        // Below the page's xl breakpoint its table of contents hides: the board's rows may end 160px short of the window's right edge.
        await page.setViewportSize({ width: 1279, height: 1200 });
        const entry = await open(page, "allocationKilnYard", theme);
        const frame = entry.locator("[data-allocation-frame]").first();
        const timeline = frame.locator("[data-allocation-timeline]");
        const gap = () => timeline.evaluate(el => window.innerWidth - el.getBoundingClientRect().right);
        let width = 800;
        await size(page, entry, width);
        for (let step = 0; step < 8 && Math.abs(await gap() - 160) > 2; step++) { width = Math.round(width + await gap() - 160); await size(page, entry, width); }
        expect([Math.abs(await gap() - 160) <= 2, await frame.locator("[data-allocation-main]").evaluate(el => el.hasAttribute("data-allocation-narrow"))]).toEqual([true, false]);
        const card = timeline.locator('[data-allocation-card="3110"]');
        await card.scrollIntoViewIfNeeded(); await card.click(); await settled(page);
        await timeline.evaluate(el => el.scrollIntoView({ block: "center" })); await settled(page);
        // LD-2208's line, pressed 24px out of its card, clear of the connector: its route runs from the card to K-304's leading edge.
        const hit = timeline.locator('[data-allocation-link="3110|K-304"]');
        const from = await card.evaluate(el => { const b = el.getBoundingClientRect(); return { x: b.right + 24, y: b.top + b.height / 2 }; });
        await page.mouse.move(0, 0);
        await pickUp(page, hit, timeline, "link", from);
        const k302 = timeline.locator('[data-allocation-resource="K-302"]');
        const right = await timeline.evaluate(el => el.getBoundingClientRect().right);
        const pointer = [Math.round(right - 40), (await rowPoint(k302))[1]!];
        await moveTo(page, pointer);
        await expect(k302).toHaveAttribute("data-drop-active", "");
        expect(await ghostAt(page, pointer)).toEqual({ text: "LD-2208 · 1 m³", beside: true });
        expect(await page.locator("[data-drag-ghost] [data-move-ghost]").evaluate(el => el.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
        await page.keyboard.press("Escape"); await page.mouse.up(); await settled(page);
    });

    test(`A30 — an event dragged over the lane grid wherever main takes drags: a brand 1.5 line from the pointer into each of its three best fits' rows, over the Library too; over the rows, none; narrower, none — at 1440/1024/768/390/360 and in a 294px parent (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, "allocationKilnYard", theme);
        const frame = entry.locator("[data-allocation-frame]").first();
        const brand = await token(page, "brand-mark");
        for (const width of [1440, 1024, 768, 390, 360, 294]) {
            await size(page, entry, width);
            const timeline = frame.locator("[data-allocation-timeline]");
            if (await frame.locator("[data-allocation-main]").evaluate(el => el.hasAttribute("data-allocation-narrow"))) {
                await expect(frame.locator("[data-allocation-link-lines]"), `${width}px`).toHaveCount(0);
                expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px page`).toBeLessThanOrEqual(0);
                continue;
            }
            const event = frame.locator('[data-allocation-library="events"] [data-library-item="event:LD-2236"]');
            if (!(await event.isVisible())) { await frame.getByRole("button", { name: "Expand Library", exact: true }).click(); await settled(page); }
            await timeline.evaluate(el => el.scrollIntoView({ block: "center" })); await settled(page);
            await event.scrollIntoViewIfNeeded(); await event.hover();
            await pickUp(page, event, timeline, "event");
            // Still over the Library, left of the board: three lines out of the drag point, cut at the board's edge.
            const lines = timeline.locator("[data-allocation-link-lines] [data-plan-link-guide]");
            await expect(lines, `${width}px over the Library`).toHaveCount(3);
            // Over a lane hour: each line out of the pointer, 1.5 in the brand, its head at the row's leading edge or Plan's stub toward a row out of view.
            const cell = timeline.locator(`[data-allocation-cell="B-1|${Date.UTC(2027, 4, 11, 4, 15)}"]`);
            await bring(page, cell, { x: 0.5 });
            const pointer = await cell.evaluate(el => { const b = el.getBoundingClientRect(); return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)]; });
            const guides = await timeline.evaluate((root) => {
                const origin = root.querySelector("[data-allocation-link-lines]")!.getBoundingClientRect();
                const at = (el: Element) => [...el.getAttribute("d")!.matchAll(/(?:M|L) (-?[\d.]+) (-?[\d.]+)/g)].map(m => [Math.round(Number(m[1]) + origin.left), Math.round(Number(m[2]) + origin.top)]);
                const edge = Math.round(root.querySelector("[data-allocation-channel]")!.getBoundingClientRect().right);
                return [...root.querySelectorAll("[data-allocation-link-lines] [data-plan-link-guide]")].map(g => {
                    const band = g.querySelector("[data-plan-ribbon-band]")!, head = g.querySelector("[data-plan-ribbon-head]")!, s = getComputedStyle(band);
                    // A row in view: the head's tip on the rows' leading edge; out of view, Plan's stub on the riser, 27 short of it.
                    const tip = at(head).reduce((a, b) => b[0]! > a[0]! ? b : a);
                    return { stroke: s.stroke, width: s.strokeWidth, fill: s.fill, head: getComputedStyle(head).fill, start: at(band)[0], end: tip[0] === edge || tip[0] === edge - 23 };
                });
            });
            expect(guides, `${width}px lines`).toEqual([0, 1, 2].map(() => ({ stroke: brand, width: "1.5px", fill: "none", head: brand, start: pointer, end: true })));
            expect(await timeline.locator("[data-allocation-link-lines]").evaluate(el => getComputedStyle(el).zIndex)).toBe("5");
            // Over the rows: none.
            await moveTo(page, await rowPoint(timeline.locator('[data-allocation-resource="K-106"]')));
            await expect(lines, `${width}px over the rows`).toHaveCount(0);
            await page.keyboard.press("Escape"); await page.mouse.up(); await settled(page);
            await expect(timeline.locator("[data-allocation-link-lines]")).toHaveCount(0);
        }
    });
}
