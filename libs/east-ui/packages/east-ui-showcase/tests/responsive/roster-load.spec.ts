/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
/** Cold-load paint states and bounded work, independent of machine speed. */
import { expect, test } from "playwright/test";
import { settled } from "./settle";

type LoadSample = { width: number; agenda: boolean; grid: boolean; assignments: number; covered: boolean };
type LoadProbe = { samples: LoadSample[]; active: boolean };

for (const theme of ["light", "dark"] as const) {
    test(`Roster cold load paints the layout for its actual main width (${theme}) @narrow`, async ({ page }, info) => {
        if (info.project.name === "desktop") await page.setViewportSize({ width: 1920, height: 1080 });
        await page.addInitScript(() => {
            const probe: LoadProbe = { samples: [], active: true };
            (window as unknown as { rosterLoad: LoadProbe }).rosterLoad = probe;
            const next = () => requestAnimationFrame(() => setTimeout(() => {
                const entry = document.querySelector('a[href="#e3/roster/roster/rosterWarehouse"]')?.closest('[data-index]');
                const main = entry?.querySelector('[data-roster-main]');
                if (main !== null && main !== undefined) {
                    const width = main.getBoundingClientRect().width;
                    const agenda = main.querySelector('[data-roster-agenda]') !== null;
                    const grid = main.querySelector('[data-roster-grid]') !== null;
                    // While the week's window is read, the frame's loading surface covers it.
                    const covered = main.closest('[data-builder-frame]')?.hasAttribute('data-loading') === true;
                    if (width > 0 && (agenda || grid)) probe.samples.push({ width, agenda, grid, assignments: main.querySelectorAll('[data-roster-assignment]').length, covered });
                }
                // Read after the frame's ResizeObserver/layout work has painted.
                if (probe.active) next();
            }, 0));
            next();
        });
        await page.goto(`/?theme=${theme}#e3/roster/roster/rosterWarehouse`);
        const entry = page.locator('[data-index]', { has: page.locator('a[href="#e3/roster/roster/rosterWarehouse"]') });
        await expect(entry.locator('[data-roster-main]')).toBeVisible({ timeout: 30_000 });
        await settled(page);
        const samples = await page.evaluate(() => {
            const probe = (window as unknown as { rosterLoad: LoadProbe }).rosterLoad;
            probe.active = false;
            return probe.samples;
        });
        expect(samples.length).toBeGreaterThan(0);
        // Covered or not, main lays out for its own width, so nothing switches as the cover lifts.
        expect(samples.filter(s => s.agenda !== (s.width < 480) || s.grid !== (s.width >= 480))).toEqual([]);
        // Once the cover lifts, the grid shows the week's duties: never an empty week first.
        expect(samples.some(s => !s.covered)).toBe(true);
        expect(samples.filter(s => !s.covered && s.grid && s.assignments === 0)).toEqual([]);
        if (info.project.name === "desktop") {
            // One visible large example plus one adjacent entry on each side.
            expect(await page.locator('[data-roster-frame]').count()).toBeLessThanOrEqual(3);
            expect(await entry.locator('[data-library-item]').count()).toBeLessThan(30);
        }
    });
}
