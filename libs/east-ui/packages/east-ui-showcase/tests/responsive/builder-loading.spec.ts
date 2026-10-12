/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
/** Cold paints with fonts deliberately held, over the real e3-web examples. */
import { expect, test } from "playwright/test";
import { settled } from "./settle";

type Paint = { width: number; height: number; main: number; busy: boolean; visible: boolean; narrow: boolean; agenda: boolean; content: boolean };
type Probe = { active: boolean; paints: Paint[] };

for (const [scope, name] of [["roster", "rosterWarehouse"], ["calendar", "calendarOperations"]] as const) {
    for (const theme of ["light", "dark"] as const) {
        test(`${scope} cold load uses a stable Chakra skeleton before the complete layout (${theme}) @narrow`, async ({ page }, info) => {
            if (info.project.name === "desktop") await page.setViewportSize({ width: 1440, height: 1080 });
            let release!: () => void;
            const fonts = new Promise<void>(resolve => { release = resolve; });
            await page.route(/\.woff2(?:\?.*)?$/, async route => { await fonts; await route.continue(); });
            const route = `e3/${scope}/${scope}/${name}`;
            await page.addInitScript(({ scope, route }) => {
                const probe: Probe = { active: true, paints: [] };
                (window as unknown as { builderLoad: Probe }).builderLoad = probe;
                const next = () => requestAnimationFrame(() => setTimeout(() => {
                    const entry = document.querySelector(`a[href="#${route}"]`)?.closest('[data-index]');
                    const frame = entry?.querySelector('[data-builder-frame]');
                    const main = frame?.querySelector(`[data-${scope}-main]`);
                    if (frame && main) {
                        const rect = frame.getBoundingClientRect();
                        probe.paints.push({ width: rect.width, height: rect.height, main: main.getBoundingClientRect().width,
                            busy: frame.getAttribute("aria-busy") === "true", visible: getComputedStyle(main.closest('[data-frame-slot="body"]')!).opacity !== "0",
                            narrow: main.hasAttribute(`data-${scope}-narrow`), agenda: main.querySelector(`[data-${scope}-agenda]`) !== null,
                            content: main.children.length > 0 });
                    }
                    if (probe.active) next();
                }, 0));
                next();
            }, { scope, route });
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
                // A tall host must not stretch sparse text lines into giant rows.
                const density = await loading.locator('[data-builder-loading-row]').evaluateAll(rows => rows.map(row => {
                    const box = row.getBoundingClientRect();
                    const cells = Array.from(row.querySelectorAll('.elara-skeleton'), cell => cell.getBoundingClientRect());
                    return { height: box.height, cells: cells.map(cell => ({ height: cell.height, ratio: cell.height / box.height })) };
                }));
                expect(density.length).toBeGreaterThan(0);
                for (const row of density) {
                    expect(row.height).toBeLessThanOrEqual(44);
                    for (const cell of row.cells) {
                        expect(cell.height).toBeGreaterThanOrEqual(24);
                        expect(cell.ratio).toBeGreaterThanOrEqual(0.5);
                    }
                }
                const before = await frame.boundingBox();
                expect(before).not.toBeNull();
                const cover = await loading.boundingBox();
                expect(cover!.width).toBeCloseTo(before!.width, 0);
                expect(cover!.height).toBeCloseTo(before!.height, 0);
                const regions = frame.locator(':scope > [data-frame-slot]');
                for (const region of await regions.all()) {
                    await expect(region).toHaveAttribute('inert', '');
                    await expect(region).toHaveCSS('opacity', '0');
                    await expect(region).toHaveAttribute('aria-hidden', 'true');
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
                expect(visible.filter(p => p.narrow !== (p.main < 480) || p.agenda !== (p.main < 480))).toEqual([]);
                expect(Math.max(...paints.map(p => p.width)) - Math.min(...paints.map(p => p.width))).toBeLessThanOrEqual(1);
            } finally {
                release();
            }
        });
    }
}
