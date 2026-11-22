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
 *  - A2 a visual's bell opens its alerts' popover, 380 wide: each alert the
 *    row every flush popover's list draws (the pick panel's) — padded 8 12,
 *    its name 12.5 / 600 over where it stands in mono 9.5: firing since when,
 *    in `--neg`; watching; paused. Its head holds its close ×.
 *  - A3 an alert opened in it is its editor: its name, its condition in the
 *    query builder's rows, its pause, and Now — the rows that meet it now, a
 *    table of them, and how many of how many. Its foot's Cancel leaves it:
 *    its head holds no close ×, over its condition's rows' ×s.
 *  - A4 the bar's bell lists the alerts firing, and opening one sets the
 *    page's filters to the alert's, over a reader's who had cleared them, and
 *    draws its banner: its name, how many rows met it, Show rows — those rows
 *    — and Dismiss, which puts it away.
 *  - A5 New alert starts from the visual's first value, under its goal, its
 *    rows over the line shown now; Save adds it to the visual's alerts, and the
 *    page's check fires it. Delete asks first, in the popover, then takes it
 *    off.
 *  - P1 on a phone, a bell and its menu are each a 44 × 44 tap target, their
 *    boxes the desktop's 24 × 24: the tile's head stands 44 on a touch
 *    screen, so every tap down a control's column lands on it from the head's
 *    top edge to its foot — none past the tile's edge, where the grid's cell
 *    would end a halo, and none on the body under it, whose table's header
 *    would take one; and across the head each takes the 44 on its own side of
 *    the 4 between them — the bell from 18 before its box to 2 past it, the
 *    menu from 2 before its box to 18 past it — so neither takes a tap on the
 *    other's box. Its popover stands inside the screen.
 *
 * And the builder over the same page, given the same record (asked 22 November
 * 2026): the selected visual's alerts in its inspector.
 *
 *  - B1 a visual's Configure tab holds Alerts, after what it follows and
 *    before its source's fields: its alerts in a box the section's width, each
 *    the popover list's own row, then New alert at the section's start, then
 *    what they are — nothing past the section's edges.
 *  - B2 an alert opened there is edited in place, at the pane's width: each
 *    condition row's × at the section's end on the row's first line, whatever
 *    the row wraps to — one too wide for the pane wraps inside itself; Now's
 *    table the section's width; and a foot of its own — Delete at its start,
 *    Cancel and Save at its end, on one line. Cancel gives the list back.
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

/** The showcase's builder over the same page, given the same alerts record. */
const BUILDER = "e3/studio/alerts/studioAlertsBuilder";

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

/**
 * The alerts a popover lists: each one's name, where it stands, its words and its colour, and how its row is drawn —
 * its padding, its name's size and weight, and its line's size and face.
 */
const listed = (open: Locator) => open.locator("[data-studio-alert]").evaluateAll((rows) => rows.map((row) => {
    const status = row.querySelector("[data-status]")!;
    const [own, name, line] = [getComputedStyle(row), getComputedStyle(status.previousElementSibling!), getComputedStyle(status)];
    return {
        name: row.getAttribute("data-studio-alert"), status: status.getAttribute("data-status"), says: status.textContent, color: line.color,
        row: [own.paddingTop, own.paddingRight, own.paddingBottom, own.paddingLeft, name.fontSize, name.fontWeight, line.fontSize, line.fontFamily.includes("Mono")],
    };
}));

/** How the row of a flush popover's list is drawn — the pick panel's: padded 8 12, its name 12.5 / 600, its line mono 9.5. */
const POPOVER_ROW = ["8px", "12px", "8px", "12px", "12.5px", "600", "9.5px", true];

/**
 * Opens the builder in the light theme, selects a visual on its canvas, and opens the inspector on its Configure tab.
 *
 * @returns The tab's Alerts, scrolled to and at rest
 */
async function openInspector(page: Page, key: string): Promise<Locator> {
    await page.goto(`/?theme=light#${BUILDER}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${BUILDER}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const placed = entry.locator(`[data-snap-grid-tile="${key}"]`);
    await expect(placed.locator("[data-studio-alert-bell]")).toBeVisible({ timeout: 60_000 });
    await placed.click({ position: { x: 30, y: 60 } });
    // The inspector's pane is a rail at this width: open it.
    const expand = entry.getByRole("button", { name: "Expand Inspector" });
    if (await expand.count() > 0) await expand.click();
    const section = entry.locator('[data-studio-configure] [data-configure="alerts"]');
    await expect(section).toBeVisible({ timeout: 20_000 });
    await section.scrollIntoViewIfNeeded();
    await settled(page);
    return section;
}

/** Whether any drawn part of a section passes its start or its end — a control hidden for assistive technology aside. */
const passes = (section: Locator) => section.evaluate((el) => {
    const own = el.getBoundingClientRect();
    return [...el.querySelectorAll("*")].some((part) => {
        const box = part.getBoundingClientRect();
        // A ghost button hangs its padding 4 before the section's start, so its words stand on the start.
        return box.width > 1 && box.height > 1 && (box.right > own.right + 0.5 || box.left < own.left - 4.5);
    });
});

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

    test("A2: a visual's bell opens its alerts' popover, 380 wide — each alert the row every flush popover's list draws, its name over where it stands: firing since when, in --neg; watching; paused", async ({ page }) => {
        const entry = await openAlerts(page);
        // A row's line is the popover list's own: `--ink-3`, and `--neg` while its alert fires.
        const [neg, muted] = [await token(page, "status-neg"), await token(page, "fg-muted")];
        const name = (await tile(entry, "v-revenue").locator("[data-studio-visual-name]").textContent())!;
        const open = await openBell(page, entry, "v-revenue");
        expect((await open.boundingBox())!.width).toBe(380);
        await expect(open).toContainText(`Alerts · ${name}`);
        await expect(open.getByRole("button", { name: "Close" })).toHaveCount(1);
        const [quarter] = await listed(open);
        expect([quarter!.name, quarter!.status, quarter!.color]).toEqual(["Quarter under goal", "firing", neg]);
        expect(quarter!.says).toMatch(/^Firing since /);
        expect(quarter!.row).toEqual(POPOVER_ROW);
        await escapeLayer(page);
        await expect(popover(page)).toHaveCount(0);
        for (const [key, alert, says] of [["v-customers", "Customer over 50,000", "Watching"], ["v-combo", "Margin under 19%", "Paused"]] as const) {
            const shown = await listed(await openBell(page, entry, key));
            expect(shown.map((row) => [row.name, row.says, row.color]), key).toEqual([[alert, says, muted]]);
            expect(shown[0]!.row, key).toEqual(POPOVER_ROW);
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
        // Its foot's Cancel leaves it: no close × in its head.
        await expect(open.getByRole("button", { name: "Close" })).toHaveCount(0);
        await expect(open.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
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

    test("P1: a bell and its menu are each a 44 × 44 tap target in a head that stands 44 on a touch screen — every tap down a control's column landing on it from the head's top edge to its foot, none past the tile's edge or on the body, each taking the 44 on its own side of the 4 between them — and its popover stands inside the screen @mobile", async ({ page }) => {
        const entry = await openAlerts(page);
        // A KPI's body, under its head, and a records table's, whose header row runs edge to edge under it.
        for (const key of ["v-revenue", "v-records"]) {
            await tile(entry, key).scrollIntoViewIfNeeded();
            await settled(page);
            const taps = await tile(entry, key).evaluate((el) => {
                // The browser tells a tap by the pixel that starts at its point, so each is taken at a pixel of the tile's own
                // grid — counted from its edges, wherever the page's scroll stands it: a quarter of a pixel off the screen's, here.
                const px = Math.round;
                const top = el.getBoundingClientRect().top;
                const head = el.querySelector("[data-studio-visual-head]")!.getBoundingClientRect();
                const [bell, menu] = [el.querySelector("[data-studio-alert-bell]")!, el.querySelector("[data-studio-visual-menu]")!];
                /** Which of the two a tap on a pixel lands on — `b`, `m` — or `-` for neither. */
                const at = (x: number, y: number) => {
                    const hit = document.elementFromPoint(x, y);
                    return hit === null ? "-" : bell.contains(hit) ? "b" : menu.contains(hit) ? "m" : "-";
                };
                /** A control's box, how far its middle is under the tile's top edge and over the head's foot, and the taps down its column: from the pixel past the tile's top edge to the first under the head. */
                const column = (control: Element) => {
                    const own = control.getBoundingClientRect();
                    const y = own.top + own.height / 2;
                    let lands = "";
                    for (let row = -1; row <= px(head.bottom - top); row++) lands += at(own.left + own.width / 2, top + row);
                    return { box: [own.width, own.height], above: px(y - top), below: px(head.bottom - y), lands };
                };
                // The taps across the head at the controls' middle: from 24 before the bell's box to 24 past the menu's.
                const [first, last] = [bell.getBoundingClientRect(), menu.getBoundingClientRect()];
                let across = "";
                for (let step = -24; step < px(last.right - first.left) + 24; step++) across += at(first.left + step, first.top + first.height / 2);
                return { bell: column(bell), menu: column(menu), gap: last.left - first.right, across };
            });
            // Past the tile's edge, nothing; over the head's 44, from its top edge to its foot's last pixel, the control; under it, the body's own.
            expect(taps.bell, key).toEqual({ box: [24, 24], above: 22, below: 22, lands: `-${"b".repeat(44)}-` });
            expect(taps.menu, key).toEqual({ box: [24, 24], above: 22, below: 22, lands: `-${"m".repeat(44)}-` });
            // Across the head: the bell's 44 from 18 before its box, then the menu's 44 to 18 past its own — each control's whole box its own.
            expect([taps.gap, taps.across], key).toEqual([4, `${"-".repeat(6)}${"b".repeat(44)}${"m".repeat(44)}${"-".repeat(6)}`]);
        }
        const open = await openBell(page, entry, "v-records");
        const box = (await open.boundingBox())!;
        const screen = page.viewportSize()!;
        expect([box.x >= 0, box.x + box.width <= screen.width]).toEqual([true, true]);
    });
});

test.describe("The builder's inspector's alerts (#1674)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    test("B1: a visual's Configure tab holds Alerts, after what it follows and before its fields — its alerts in a box the section's width, each the popover list's row, then New alert at the section's start, then what they are; nothing past the section's edges", async ({ page }) => {
        const section = await openInspector(page, "v-combo");
        const muted = await token(page, "fg-muted");
        expect(await section.evaluate((el) => [...el.closest("[data-studio-configure]")!.querySelectorAll("[data-configure]")].map((part) => part.getAttribute("data-configure")).slice(-3)))
            .toEqual(["follow", "alerts", "fields"]);
        await expect(section).toHaveAttribute("aria-label", "Alerts");
        expect((await listed(section)).map((row) => [row.name, row.says, row.color, row.row])).toEqual([["Margin under 19%", "Paused", muted, POPOVER_ROW]]);
        const read = await section.evaluate((el) => {
            const own = el.getBoundingClientRect();
            const list = el.querySelector("[data-studio-alerts]")!.parentElement!.getBoundingClientRect();
            const add = el.querySelector("[data-studio-new-alert]")!;
            const hint = el.querySelector("[data-configure-hint]")!;
            const [button, said] = [add.getBoundingClientRect(), hint.getBoundingClientRect()];
            return {
                // The list's box: the section's width.
                list: [list.left - own.left, own.right - list.right],
                // New alert: at the section's start, under the list, the row controls' 26 high; the hint under it.
                add: [add.textContent, button.left - own.left, button.height, button.top >= list.bottom, said.top >= button.bottom],
                hint: hint.textContent,
            };
        });
        expect(read).toEqual({
            list: [0, 0],
            add: ["New alert", 0, 26, true, true],
            hint: "Checked on the published page. An alert is saved as you write it, not with the page.",
        });
        expect(await passes(section)).toBe(false);
    });

    test("B2: an alert opened in the inspector is edited in place at the pane's width — each condition row's × at the section's end on the row's first line, a row too wide wrapping inside itself; Now's table the section's width; its foot Delete at the start, Cancel and Save at the end, on one line; Cancel gives the list back", async ({ page }) => {
        const section = await openInspector(page, "v-combo");
        await section.locator('[data-studio-alert="Margin under 19%"]').click();
        await expect(section.locator("[data-studio-alert-name]")).toHaveValue("Margin under 19%");
        // Now: Queensland's margin, of the quarter's five regions.
        await expect(section.locator("[data-studio-alert-now]")).toContainText("1 of 5 rows meets it now", { timeout: 30_000 });
        await expect.poll(() => section.locator("[data-studio-alert-rows] tbody tr").count()).toBe(1);
        await section.scrollIntoViewIfNeeded();
        await settled(page);
        const read = await section.evaluate((el) => {
            const own = el.getBoundingClientRect();
            const mid = (box: DOMRect) => box.top + box.height / 2;
            const rows = [...el.querySelectorAll("[data-query-line=row]")].map((row) => {
                const [box, cross, body] = [row.getBoundingClientRect(), row.querySelector(":scope > [data-query-remove=row]")!.getBoundingClientRect(), row.querySelector("[data-query-row-body]")!];
                const first = body.querySelector("[data-slot-key]")!.getBoundingClientRect();
                return {
                    says: [...body.querySelectorAll("[data-slot-key]")].map((slot) => slot.textContent),
                    // Its ×: at the section's end, on its first line, past what it says.
                    cross: [own.right - cross.right, Math.abs(mid(cross) - mid(first)) <= 0.5, body.getBoundingClientRect().right <= cross.left],
                    lines: Math.round(box.height / 28),
                };
            });
            const table = el.querySelector("[data-studio-alert-rows]")!.getBoundingClientRect();
            const foot = ["[data-studio-alert-delete]", "[data-studio-alert-save]"].map((mark) => el.querySelector(mark)!);
            const cancel = foot[1]!.previousElementSibling!;
            const [remove, keep, save] = [foot[0]!.getBoundingClientRect(), cancel.getBoundingClientRect(), foot[1]!.getBoundingClientRect()];
            return {
                rows,
                table: [table.left - own.left, own.right - table.right],
                foot: {
                    says: [foot[0]!.textContent, cancel.textContent, foot[1]!.textContent],
                    // Delete at the section's start; Cancel 8 before Save, at its end; one line of the row controls' 26, under the table.
                    at: [remove.left - own.left, save.left - keep.right, own.right - save.right],
                    line: [remove.top === keep.top && keep.top === save.top, remove.height, remove.top >= table.bottom],
                },
            };
        });
        expect(read).toEqual({
            rows: [
                { says: ["mean margin", "has a value"], cross: [0, true, true], lines: 1 },
                // Three slots are wider than the pane leaves a row: its value goes to a second line, its × stays on the first.
                { says: ["mean margin", "is less than", "0.19"], cross: [0, true, true], lines: 2 },
            ],
            table: [0, 0],
            foot: { says: ["Delete", "Cancel", "Save"], at: [0, 8, 0], line: [true, 26, true] },
        });
        expect(await passes(section)).toBe(false);
        await section.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(section.locator("[data-studio-alert-editor]")).toHaveCount(0);
        expect((await listed(section)).map((row) => row.name)).toEqual(["Margin under 19%"]);
    });
});
