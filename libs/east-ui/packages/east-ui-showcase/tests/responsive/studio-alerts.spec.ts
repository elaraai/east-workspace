/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A Studio page's alerts (#1674), measured in a real browser over the
 * showcase's alerts page — the Visuals page given the alerts record, under
 * the bell for the host's bar — each visual answered, and each alert checked,
 * by e3 in the page:
 *
 *  - A1 each data visual's header carries a bell beside its menu: the menu's
 *    own 24 × 24, on its line, 4 before it. The page's check fires the two
 *    alerts its rows meet — the quarter's revenue under its goal, the months
 *    under theirs — and their bells are marked in `--neg`, the rest the
 *    menu's own ink; the bar's bell counts two.
 *  - A2 a visual's bell opens its alerts' popover, 380 wide: each alert a row
 *    of 48 at least, its name over where it stands — firing since when, in
 *    `--neg`; watching; paused.
 *  - A3 an alert opened in it is its editor: its name, its condition in the
 *    query builder's rows, its pause, and Now — the rows that meet it now, a
 *    table of them, and how many of how many.
 *  - A4 the bar's bell lists the alerts firing, and opening one sets the
 *    page's filters to the alert's, over a reader's who had cleared them, and
 *    draws its banner: its name, how many rows met it, Show rows — those rows
 *    — and Dismiss, which puts it away.
 *  - A5 New alert starts from the visual's first value, under its goal, its
 *    rows over the line shown now; Save adds it to the visual's alerts, and the
 *    page's check fires it. Delete asks first, in the popover, then takes it
 *    off.
 *  - P1 on a phone, a bell is the tap target its menu is: its 24 × 24, every
 *    tap down its column over the tile's head — from the tile's top edge, 18
 *    above its middle, to the head's foot, 18 below — landing on it, none past
 *    the tile's edge, where the grid's cell ends its halo, and at every point
 *    from there to 22 below its middle the menu's column taking the same taps
 *    — and its popover stands inside the screen.
 *
 * Every measurement is taken from the laid-out page.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-alerts --project desktop`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { escapeLayer, settled } from "./settle";
import { token } from "./tokens";

/** The showcase's alerts page. */
const HASH = "e3/studio/alerts/studioAlertsPage";

/** The visuals whose alerts the page's check fires: the quarter's revenue, and its months. */
const FIRING = ["v-revenue", "v-trend"];

/** Opens the alerts page in the light theme, its visuals answered and the two alerts its rows meet fired, at rest. */
async function openAlerts(page: Page): Promise<Locator> {
    await page.goto(`/?theme=light#${HASH}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect.poll(() => entry.locator("[data-studio-alert-bell]").count(), { timeout: 60_000 }).toBe(13);
    await expect.poll(() => entry.locator("[data-studio-alert-bell][data-firing]").count(), { timeout: 60_000 }).toBe(FIRING.length);
    await settled(page);
    return entry;
}

/** A placement's tile, by its key. */
const tile = (entry: Locator, key: string) => entry.locator(`[data-studio-placement="${key}"]`);
/** A visual's bell. */
const bell = (entry: Locator, key: string) => tile(entry, key).locator("[data-studio-alert-bell]");
/** The popover open now. */
const popover = (page: Page) => page.locator('[data-scope="popover"][data-part="content"][data-state="open"]');

/** Waits for the popover open now to have finished its entrance: read during it, its box and its rows are scaled. */
async function entered(page: Page): Promise<void> {
    await expect(popover(page)).toBeVisible();
    await popover(page).evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((run) => run.finished.then(() => undefined, () => undefined))));
}

/** Opens a visual's bell, scrolled to, and waits for its popover. */
async function openBell(page: Page, entry: Locator, key: string): Promise<Locator> {
    await tile(entry, key).scrollIntoViewIfNeeded();
    await bell(entry, key).click();
    await entered(page);
    await settled(page);
    return popover(page);
}

/** The alerts a popover lists: each one's name, where it stands, its words, its colour and its row's height. */
const listed = (open: Locator) => open.locator("[data-studio-alert]").evaluateAll((rows) => rows.map((row) => {
    const status = row.querySelector("[data-status]")!;
    return {
        name: row.getAttribute("data-studio-alert"), status: status.getAttribute("data-status"), says: status.textContent,
        color: getComputedStyle(status).color, height: row.getBoundingClientRect().height,
    };
}));

test.describe("A Studio page's alerts (#1674)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    test("A1: each data visual carries a bell beside its menu — the menu's own 24 × 24, on its line, 4 before it — and the page's check fires the two alerts its rows meet: their bells in --neg, the rest the menu's ink; the bar counts two", async ({ page }) => {
        const entry = await openAlerts(page);
        const neg = await token(page, "status-neg");
        const tiles = await entry.locator("[data-studio-placement]").evaluateAll((els) => els.map((el) => {
            const b = el.querySelector("[data-studio-alert-bell]")!;
            const m = el.querySelector("[data-studio-visual-menu]")!;
            const [own, menu] = [b.getBoundingClientRect(), m.getBoundingClientRect()];
            return {
                key: el.getAttribute("data-studio-placement")!,
                box: [own.width, own.height, menu.width, menu.height],
                line: Math.abs((own.top + own.bottom) / 2 - (menu.top + menu.bottom) / 2) <= 0.5,
                gap: menu.left - own.right,
                firing: b.hasAttribute("data-firing"),
                color: getComputedStyle(b).color,
                ink: getComputedStyle(m).color,
            };
        }));
        expect(tiles).toHaveLength(13);
        for (const read of tiles) {
            expect([read.box, read.line, read.gap], read.key).toEqual([[24, 24, 24, 24], true, 4]);
            const fires = FIRING.includes(read.key);
            expect([read.firing, read.color], read.key).toEqual([fires, fires ? neg : read.ink]);
        }
        const bar = entry.locator("[data-studio-alert-bar]");
        await expect(bar).toHaveAttribute("aria-label", "Alerts · 2 alerts firing");
        await expect(bar).toHaveText("2");
    });

    test("A2: a visual's bell opens its alerts' popover, 380 wide — each alert a row of 48 at least, its name over where it stands: firing since when, in --neg; watching; paused", async ({ page }) => {
        const entry = await openAlerts(page);
        const [neg, subtle] = [await token(page, "status-neg"), await token(page, "fg-subtle")];
        const name = (await tile(entry, "v-revenue").locator("[data-studio-visual-name]").textContent())!;
        const open = await openBell(page, entry, "v-revenue");
        expect((await open.boundingBox())!.width).toBe(380);
        await expect(open).toContainText(`Alerts · ${name}`);
        const [quarter] = await listed(open);
        expect([quarter!.name, quarter!.status, quarter!.color]).toEqual(["Quarter under goal", "firing", neg]);
        expect(quarter!.says).toMatch(/^Firing since /);
        expect(quarter!.height).toBeGreaterThanOrEqual(48);
        await escapeLayer(page);
        await expect(popover(page)).toHaveCount(0);
        for (const [key, alert, says] of [["v-customers", "Customer over 50,000", "Watching"], ["v-combo", "Margin under 19%", "Paused"]] as const) {
            const shown = await listed(await openBell(page, entry, key));
            expect(shown.map((row) => [row.name, row.says, row.color]), key).toEqual([[alert, says, subtle]]);
            expect(shown[0]!.height, key).toBeGreaterThanOrEqual(48);
            await escapeLayer(page);
            await expect(popover(page)).toHaveCount(0);
        }
    });

    test("A3: an alert opened in its visual's popover is its editor — its name, its condition in the query builder's rows, its pause, and Now: the rows that meet it now, a table of them, and how many of how many", async ({ page }) => {
        const entry = await openAlerts(page);
        const open = await openBell(page, entry, "v-trend");
        await open.locator('[data-studio-alert="Month under goal"]').click();
        await expect(open.locator("[data-studio-alert-editor]")).toBeVisible();
        await expect(open.locator("[data-studio-alert-name]")).toHaveValue("Month under goal");
        await expect(open.locator("[data-studio-filter-rows]")).toBeVisible();
        await expect(open.getByRole("checkbox", { name: "Paused — not checked" })).not.toBeChecked();
        // Now: July and August under the month's goal of 130,000, of the quarter's three months.
        await expect(open.locator("[data-studio-alert-now]")).toContainText("2 of 3 rows meet it now", { timeout: 30_000 });
        await expect.poll(() => open.locator("[data-studio-alert-rows] tbody tr").count()).toBe(2);
        await expect(open.locator("[data-studio-alert-save]")).toBeEnabled();
        await expect(open.locator("[data-studio-alert-delete]")).toBeVisible();
    });

    test("A4: the bar's bell lists the alerts firing; opening one sets the page's filters to the alert's over a reader's who cleared them, and draws its banner — its name, how many rows met it, Show rows, Dismiss", async ({ page }) => {
        const entry = await openAlerts(page);
        const chips = () => entry.locator("[data-studio-filters] [data-slice-clause]").evaluateAll((els) => els.map((el) => el.getAttribute("title")));
        const quarter = await chips();
        expect(quarter).toHaveLength(1);
        // The reader clears the page's filter: every order.
        await entry.locator("[data-studio-filters] [data-slice-clause] [data-chip-remove]").click();
        await expect.poll(chips).toEqual([]);
        await entry.locator("[data-studio-alert-bar]").click();
        await entered(page);
        const firing = await listed(popover(page));
        expect(firing.map((row) => row.name).sort()).toEqual(["Month under goal", "Quarter under goal"]);
        for (const row of firing) expect(row.says).toMatch(/^Visuals · fired /);
        await popover(page).locator('[data-studio-alert="Month under goal"]').click();
        await expect(popover(page)).toHaveCount(0);
        // The alert's filters are the page's again: the quarter, as its chip.
        await expect.poll(chips).toEqual(quarter);
        const banner = page.getByText(/^Month under goal fired at /);
        await expect(banner).toBeVisible();
        await expect(page.getByText("2 rows met it")).toBeVisible();
        await page.getByRole("button", { name: "Show rows" }).click();
        await expect(popover(page)).toBeVisible();
        await expect.poll(() => popover(page).locator("[data-studio-alert-fired-rows] tbody tr").count()).toBe(2);
        await escapeLayer(page);
        await expect(popover(page)).toHaveCount(0);
        await page.getByRole("button", { name: "Dismiss" }).click();
        await expect(banner).toHaveCount(0);
    });

    test("A5: New alert starts from the visual's first value, under its goal, its rows over the line shown now; Save adds it to the visual's alerts and the page's check fires it; Delete asks first, in the popover, then takes it off", async ({ page }) => {
        const entry = await openAlerts(page);
        const name = (await tile(entry, "v-revenue").locator("[data-studio-visual-name]").textContent())!;
        let open = await openBell(page, entry, "v-revenue");
        await open.locator("[data-studio-new-alert]").click();
        await expect(open.locator("[data-studio-alert-name]")).toHaveValue(`${name} alert`);
        // The quarter's revenue, 392,489, is under its goal of 400,000: its one row meets the condition now.
        await expect(open.locator("[data-studio-alert-now]")).toContainText("1 of 1 row meets it now", { timeout: 30_000 });
        await open.locator("[data-studio-alert-save]").click();
        await expect.poll(async () => (await listed(popover(page))).map((row) => row.name)).toEqual(["Quarter under goal", `${name} alert`]);
        // The page's check fires it, as it fired the quarter's own.
        await expect.poll(async () => (await listed(popover(page))).map((row) => row.status), { timeout: 30_000 }).toEqual(["firing", "firing"]);
        await expect(entry.locator("[data-studio-alert-bar]")).toHaveText("3");
        open = popover(page);
        await open.locator(`[data-studio-alert="${name} alert"]`).click();
        await open.locator("[data-studio-alert-delete]").click();
        await expect(open.locator("[data-studio-alert-confirm]")).toHaveText(`Delete ${name} alert?`);
        await open.locator("[data-studio-alert-delete-confirmed]").click();
        await expect.poll(async () => (await listed(popover(page))).map((row) => row.name)).toEqual(["Quarter under goal"]);
        await expect(entry.locator("[data-studio-alert-bar]")).toHaveText("2");
    });
});

test.describe("A Studio page's alerts on a phone (#1674)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1000, "read at the phone's width");

    test("P1: a bell is the tap target its menu is — its 24 × 24, every tap down its column over the tile's head landing on it, none past the tile's edge, and the menu's column taking the same taps to 22 below — and its popover stands inside the screen @mobile", async ({ page }) => {
        const entry = await openAlerts(page);
        // A KPI's body, under its head, and a records table's, whose header row runs edge to edge under it.
        for (const key of ["v-revenue", "v-records"]) {
            await tile(entry, key).scrollIntoViewIfNeeded();
            await settled(page);
            const taps = await tile(entry, key).evaluate((el) => {
                const top = el.getBoundingClientRect().top;
                const head = el.querySelector("[data-studio-visual-head]")!.getBoundingClientRect();
                /** Where taps down a control's column land on it, a pixel at a time from a pixel past the tile's top edge to 22 below its middle. */
                const column = (control: Element) => {
                    const own = control.getBoundingClientRect();
                    const x = own.left + own.width / 2;
                    const y = own.top + own.height / 2;
                    const lands: boolean[] = [];
                    for (let dy = Math.round(top - y) - 1; dy <= 22; dy++) {
                        const hit = document.elementFromPoint(x, y + dy);
                        lands.push(hit !== null && control.contains(hit));
                    }
                    return { box: [own.width, own.height], above: Math.round(y - top), below: Math.round(head.bottom - y), lands };
                };
                return { bell: column(el.querySelector("[data-studio-alert-bell]")!), menu: column(el.querySelector("[data-studio-visual-menu]")!) };
            });
            const { bell: own, menu } = taps;
            expect([own.box, own.above, own.below], key).toEqual([[24, 24], 18, 18]);
            // Past the tile's edge, nothing; over the head, from its top edge to its foot's last pixel, the bell.
            expect(own.lands[0], key).toBe(false);
            expect(own.lands.slice(1, 1 + own.above + own.below).every(Boolean), key).toBe(true);
            // The menu's column takes the same taps, the menu's own: the two are each other's size and reach.
            expect(menu, key).toEqual(own);
        }
        const open = await openBell(page, entry, "v-records");
        const box = (await open.boundingBox())!;
        const screen = page.viewportSize()!;
        expect([box.x >= 0, box.x + box.width <= screen.width]).toEqual([true, true]);
    });
});
