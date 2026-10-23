/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
/** Cold paints with fonts deliberately held, over the real e3-web examples. */
import { expect, test } from "playwright/test";
import { settled } from "./settle";

type Paint = { width: number; height: number; main: number; busy: boolean; visible: boolean; narrow: boolean; agenda: boolean; content: boolean };
type Probe = { active: boolean; paints: Paint[] };

/**
 * Each builder by its example: what its main's content is, whether that
 * content turns to cards below 480px of main and what they are — the
 * Roster's, the Calendar's and the Allocation's do; the Schematic's canvas
 * (#1387, SC32) is one canvas at every width — whether its footer stays live
 * under the cover, its loading line carrying the wait (#1398): the Roster's,
 * the Calendar's, the Allocation's and the Schematic's do — and the pitch its
 * cover's rows stand at, its own rows' where the cover is held to it (CL1):
 * the Allocation's 36, the Calendar's hour at its regular density, 48.
 */
const BUILDERS: readonly { scope: string; name: string; main: string; narrows: boolean; cards: string; liveFooter: boolean; pitch?: number }[] = [
    { scope: "roster", name: "rosterWarehouse", main: "[data-roster-main]", narrows: true, cards: "[data-roster-agenda]", liveFooter: true },
    { scope: "calendar", name: "calendarOperations", main: "[data-calendar-main]", narrows: true, cards: "[data-calendar-agenda]", liveFooter: true, pitch: 48 },
    { scope: "allocation", name: "allocationKilnYard", main: "[data-allocation-main]", narrows: true, cards: "[data-allocation-cards]", liveFooter: true, pitch: 36 },
    { scope: "schematic", name: "schematicDataCentre", main: "[data-schematic-canvas]", narrows: false, cards: "[data-schematic-agenda]", liveFooter: true },
];

for (const { scope, name, main: mainSelector, narrows, cards, liveFooter, pitch } of BUILDERS) {
    for (const theme of ["light", "dark"] as const) {
        test(`${scope} cold load uses a stable Chakra skeleton before the complete layout (${theme}) @narrow`, async ({ page }, info) => {
            if (info.project.name === "desktop") await page.setViewportSize({ width: 1440, height: 1080 });
            let release!: () => void;
            const fonts = new Promise<void>(resolve => { release = resolve; });
            await page.route(/\.woff2(?:\?.*)?$/, async route => { await fonts; await route.continue(); });
            const route = `e3/${scope}/${scope}/${name}`;
            await page.addInitScript(({ scope, route, mainSelector, cards }) => {
                const probe: Probe = { active: true, paints: [] };
                (window as unknown as { builderLoad: Probe }).builderLoad = probe;
                const next = () => requestAnimationFrame(() => setTimeout(() => {
                    const entry = document.querySelector(`a[href="#${route}"]`)?.closest('[data-index]');
                    const frame = entry?.querySelector('[data-builder-frame]');
                    const main = frame?.querySelector(mainSelector);
                    if (frame && main) {
                        const rect = frame.getBoundingClientRect();
                        probe.paints.push({ width: rect.width, height: rect.height, main: main.getBoundingClientRect().width,
                            busy: frame.getAttribute("aria-busy") === "true", visible: getComputedStyle(main.closest('[data-frame-slot="body"]')!).opacity !== "0",
                            narrow: main.hasAttribute(`data-${scope}-narrow`), agenda: main.querySelector(cards) !== null,
                            content: main.children.length > 0 });
                    }
                    if (probe.active) next();
                }, 0));
                next();
            }, { scope, route, mainSelector, cards });
            try {
                await page.goto(`/?theme=${theme}#${route}`, { waitUntil: "domcontentloaded" });
                const entry = page.locator('[data-index]', { has: page.locator(`a[href="#${route}"]`) });
                const frame = entry.locator('[data-builder-frame]');
                const loading = frame.locator('[data-builder-loading]');
                await expect(loading).toBeVisible({ timeout: 30_000 });
                await expect(frame).toHaveAttribute('aria-busy', 'true');
                const lines = loading.locator('.elara-skeleton');
                expect(await lines.count()).toBeGreaterThan(0);
                expect(await lines.evaluateAll(nodes => nodes.every(el => {
                    const box = el.getBoundingClientRect();
                    return box.width > 0 && box.height > 0;
                }))).toBe(true);
                // A tall host must not stretch sparse text lines into giant rows: the body's rows stand at one pitch, the
                // component's (#1398) — 44px at most where it declares none — each value a 12px bar across the middle of its row.
                const density = await loading.locator('[data-builder-loading-row]').evaluateAll(rows => rows.map(row => {
                    const box = row.getBoundingClientRect();
                    const cells = Array.from(row.querySelectorAll('.elara-skeleton'), cell => cell.getBoundingClientRect());
                    return { height: box.height, cells: cells.map(cell => ({ height: cell.height, offset: (cell.top + cell.height / 2) - (box.top + box.height / 2) })) };
                }));
                expect(density.length).toBeGreaterThan(0);
                for (const row of density) {
                    expect(row.height).toBeLessThanOrEqual(pitch ?? 44);
                    expect(row.height).toBeCloseTo(pitch ?? density[0]!.height, 0);
                    expect(row.cells.length).toBeGreaterThan(0);
                    for (const cell of row.cells) {
                        expect(cell.height).toBeCloseTo(12, 0);
                        expect(Math.abs(cell.offset)).toBeLessThanOrEqual(1);
                    }
                }
                const before = await frame.boundingBox();
                expect(before).not.toBeNull();
                const cover = await loading.boundingBox();
                expect(cover!.width).toBeCloseTo(before!.width, 0);
                // A live footer stays out from under the cover: the cover ends where the footer begins.
                const footer = frame.locator(':scope > [data-frame-slot="footer"]');
                const footerBox = liveFooter ? await footer.boundingBox() : null;
                expect(cover!.height).toBeCloseTo(before!.height - (footerBox?.height ?? 0), 0);
                const regions = frame.locator(liveFooter ? ':scope > [data-frame-slot]:not([data-frame-live])' : ':scope > [data-frame-slot]');
                for (const region of await regions.all()) {
                    await expect(region).toHaveAttribute('inert', '');
                    await expect(region).toHaveCSS('opacity', '0');
                    await expect(region).toHaveAttribute('aria-hidden', 'true');
                }
                if (liveFooter) {
                    // The footer is the one live region: seen, reachable, heard — its loading line the frame's only motion.
                    await expect(footer).toHaveAttribute('data-frame-live', '');
                    await expect(footer).not.toHaveAttribute('inert', '');
                    await expect(footer).toHaveCSS('opacity', '1');
                    await expect(footer).not.toHaveAttribute('aria-hidden', 'true');
                    await expect(footer.locator('[data-footer-line]')).toHaveAttribute('role', 'status');
                }
                release();
                await expect(frame).toHaveAttribute('aria-busy', 'false');
                await expect(loading).toHaveCount(0);
                await settled(page);
                const after = await frame.boundingBox();
                expect(after!.width).toBeCloseTo(before!.width, 0);
                expect(after!.height).toBeCloseTo(before!.height, 0);
                const paints = await page.evaluate(() => {
                    const probe = (window as unknown as { builderLoad: Probe }).builderLoad;
                    probe.active = false;
                    return probe.paints;
                });
                expect(paints.some(p => p.busy)).toBe(true);
                const visible = paints.filter(p => p.visible && !p.busy && p.content);
                expect(visible.length).toBeGreaterThan(0);
                expect(paints.filter(p => p.busy && p.visible)).toEqual([]);
                if (narrows) expect(visible.filter(p => p.narrow !== (p.main < 480) || p.agenda !== (p.main < 480))).toEqual([]);
                expect(Math.max(...paints.map(p => p.width)) - Math.min(...paints.map(p => p.width))).toBeLessThanOrEqual(1);
            } finally {
                release();
            }
        });
    }
}
