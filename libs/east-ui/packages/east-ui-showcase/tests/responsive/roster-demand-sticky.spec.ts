/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
/**
 * The Roster's work requirement sticks under the People grid's header while its band's people scroll (#1568, A6),
 * against the real in-page e3. Deep in a band's people, by week and by month, the band, its eyebrow and its lanes stand
 * under the header, each under the one above it, and the next band pushes them out together (A6.1); past half of main
 * an open lane's skill rows scroll with the people while the band, the eyebrow and the lanes stay, the stuck block no
 * taller than half of main (A6.2). A drag over the stuck block lands on none of the rows it covers, and what the
 * keyboard reaches under it — a Shift+Tab onto a covered row, a keyboard drag's step to one — is brought out from
 * under it.
 */
import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";
import { LAYOUT_THEMES } from "./themes";

const FILE = "e3/roster/roster";
const NAME = "rosterWorkRequirement";

async function open(page: Page, theme: "light" | "dark") {
    await page.goto(`/?theme=${theme}#${FILE}/${NAME}`);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${FILE}/${NAME}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-roster-frame]").first()).toBeVisible({ timeout: 30_000 });
    await settled(page);
    await entry.locator("[data-roster-frame]").first().locator("xpath=..").evaluate((el) => { (el as HTMLElement).style.width = "1440px"; });
    await settled(page);
    const frame = entry.locator("[data-roster-frame]").first();
    // The whole frame in the window, so what a point hits there is what the viewer would.
    await frame.evaluate((el) => { el.scrollIntoView({ block: "start" }); });
    await settled(page);
    return { frame, rows: frame.locator("[data-roster-main] [data-virtual-rows]").first() };
}

/** A People row as it shows: what it draws, its kind, its place in the rows' own coordinates, whether it sticks, and its box on screen. */
interface Shown {
    readonly name: string;
    readonly kind: string;
    readonly place: number;
    readonly stuck: boolean;
    readonly top: number;
    readonly bottom: number;
}
/** Main's view as it stands: its top, its header's foot, its height and scroll, and its rows in their order. */
interface View {
    readonly top: number;
    readonly header: number;
    readonly height: number;
    readonly scrollTop: number;
    readonly rows: readonly Shown[];
}
/**
 * Main's view as it stands. A row is named as the DOM tests name it: `band:<group>`, a work requirement row by its key
 * (`demand:…`, `lane:…`, `skill:…`, `assign:…`), or `row:<key>` for a person's row or a group's requests'.
 */
const viewOf = (rows: Locator): Promise<View> => rows.evaluate((scroller): View => {
    const nameOf = (box: Element): string => {
        const row = box.querySelector("[data-roster-group], [data-roster-demand], [data-roster-lane], [data-roster-lane-skill], [data-roster-assign-head], [data-roster-person-row]");
        if (row === null) return "other:";
        const band = row.getAttribute("data-roster-group"), person = row.getAttribute("data-roster-person-row");
        return band !== null ? `band:${band}` : person !== null ? `row:${person}`
            : row.getAttribute("data-roster-demand") ?? row.getAttribute("data-roster-lane") ?? row.getAttribute("data-roster-lane-skill") ?? row.getAttribute("data-roster-assign-head") ?? "other:";
    };
    const header = scroller.querySelector("[data-roster-people-head], [data-roster-month-head]");
    if (header === null) throw new Error("main's rows have no header");
    const view = scroller.getBoundingClientRect();
    return {
        top: view.top, header: header.getBoundingClientRect().bottom, height: scroller.clientHeight, scrollTop: scroller.scrollTop,
        rows: [...scroller.querySelectorAll<HTMLElement>('[data-slot="virtualRow"]')].map((box) => {
            const name = nameOf(box), shown = (box.firstElementChild ?? box).getBoundingClientRect();
            return {
                name, kind: name.slice(0, name.indexOf(":")), place: Number.parseFloat(box.style.top),
                stuck: box.hasAttribute("data-virtual-stuck"), top: shown.top, bottom: shown.bottom,
            };
        }),
    };
});
/** Rests main's view at `top`, at its left: a step before may have scrolled it across, the focus brought into view. */
async function rest(page: Page, rows: Locator, top: number) {
    await rows.evaluate((el, at) => { el.scrollTop = at; el.scrollLeft = 0; }, top);
    await settled(page);
}
/** Scrolls main on until the row `name` names is mounted: its place. */
async function placeOf(page: Page, rows: Locator, name: string): Promise<number> {
    for (let step = 0; step < 60; step++) {
        const view = await viewOf(rows);
        const found = view.rows.find(row => row.name === name);
        if (found !== undefined) return found.place;
        await rest(page, rows, view.scrollTop + Math.round(view.height * 0.6));
    }
    throw new Error(`${name} never mounted`);
}
/** The first band's group, from the view at the list's top. */
const firstGroup = (view: View) => view.rows.find(row => row.kind === "band")!.name.slice("band:".length);
/** The rows heading band `group` as they stand — from its band to the assignment's eyebrow after it — each with its height. */
function headOf(view: View, group: string): { readonly name: string; readonly kind: string; readonly size: number }[] {
    const from = view.rows.findIndex(row => row.name === `band:${group}`);
    const to = view.rows.findIndex((row, i) => i > from && row.kind === "assign");
    expect([from, to], group).not.toContain(-1);
    return view.rows.slice(from, to).map((row, i) => ({ name: row.name, kind: row.kind, size: view.rows[from + i + 1]!.place - row.place }));
}
const heightOf = (rows: readonly { readonly size: number }[]) => rows.reduce((sum, row) => sum + row.size, 0);
/**
 * Holds a stuck head to A6.1: the rows `head` names stick and stand under the header, each on the foot of the one above
 * it, at its height. Returns the stuck block's foot.
 */
function stacks(view: View, head: readonly { readonly name: string; readonly size: number }[]): number {
    let at = view.header;
    for (const { name, size } of head) {
        const row = view.rows.find(shown => shown.name === name);
        expect(row?.stuck, `${name} sticks`).toBe(true);
        expect(Math.abs(row!.top - at), `${name} stands on the foot of what is above it`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(row!.bottom - row!.top - size), `${name}'s height`).toBeLessThanOrEqual(0.5);
        at = row!.bottom;
    }
    return at;
}
/** Whether the element is covered where it shows: the point at its middle, in the window, hits something outside it. */
const covered = (el: Locator) => el.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) throw new Error(`the middle of ${node.tagName} is out of the window, at ${x}, ${y}`);
    const hit = document.elementFromPoint(x, y);
    return hit === null || !node.contains(hit);
});

for (const theme of LAYOUT_THEMES) {
    test(`deep in a band's people, by week and by month, its band, eyebrow and lanes stand under the header, each under the one above it, and the next band pushes them out together (A6.1) (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const { frame, rows } = await open(page, theme);
        for (const period of ["Week", "Month"] as const) {
            await test.step(period, async () => {
                if (period === "Month") {
                    await frame.locator('[data-frame-slot="toolbar"]').getByRole("radio", { name: "Month", exact: true }).click();
                    await settled(page);
                    await expect(frame.locator('[data-roster-grid="people-month"]')).toBeVisible();
                }
                await rest(page, rows, 0);
                const start = await viewOf(rows);
                // The band stands under the header: the mock's 36px by week and 56px by month, over the header's rule.
                expect(Math.round(start.header - start.top), "the header").toBe(period === "Week" ? 37 : 57);
                const first = firstGroup(start);
                const head = headOf(start, first);
                expect(head.map(row => row.kind)).toEqual(["band", "demand", ...head.slice(2).map(() => "lane")]);
                const height = heightOf(head);
                // Deep in the band's people, its head stands under the header, and its people scroll under the head.
                await rest(page, rows, await placeOf(page, rows, `row:requests:${first}`) - 300);
                const deep = await viewOf(rows);
                const foot = stacks(deep, head);
                const under = deep.rows.filter(row => !row.stuck && row.bottom > deep.header + 0.5 && row.top < foot - 0.5).map(row => row.name);
                expect(under.every(name => name.startsWith("row:")), `only people under the head: ${under.join(", ")}`).toBe(true);
                // The next band, brought within the head's height of the header: the head ends on it, pushed up whole.
                const next = deep.rows.find(row => row.kind === "band" && row.name !== `band:${first}`);
                expect(next, "the next band").toBeDefined();
                const into = Math.round(height / 2);
                await rest(page, rows, next!.place - into);
                const pushed = await viewOf(rows);
                const band = pushed.rows.find(row => row.name === next!.name)!;
                expect(Math.abs(band.top - (pushed.header + into)), "the next band, where it scrolled to").toBeLessThanOrEqual(0.5);
                expect(Math.abs(pushed.rows.find(row => row.name === head.at(-1)!.name)!.bottom - band.top), "the head ends on the next band").toBeLessThanOrEqual(0.5);
                expect(Math.abs(pushed.rows.find(row => row.name === `band:${first}`)!.top - (band.top - height)), "the head pushed out whole").toBeLessThanOrEqual(0.5);
                // Deep in the next band's people, its head stands there instead.
                const second = next!.name.slice("band:".length);
                const theirs = headOf(pushed, second);
                await rest(page, rows, await placeOf(page, rows, `row:requests:${second}`) - 300);
                const after = await viewOf(rows);
                stacks(after, theirs);
                expect(after.rows.find(row => row.name === `band:${first}`)?.stuck ?? false, "the first band gone").toBe(false);
            });
        }
    });

    test(`lanes opened past half of main: their skill rows scroll with the people, and the band, eyebrow and lanes stay, the stuck block no taller than half of main (A6.2) (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const { rows } = await open(page, theme);
        await rest(page, rows, 0);
        const start = await viewOf(rows);
        const first = firstGroup(start), half = start.height / 2;
        // The first band's lanes opened in turn until its head is taller than half of main.
        for (const lane of headOf(start, first).filter(row => row.kind === "lane").map(row => row.name)) {
            if (heightOf(headOf(await viewOf(rows), first)) > half) break;
            await rows.locator(`[data-roster-lane='${lane}'] [data-roster-lane-head]`).click();
            await settled(page);
        }
        const head = headOf(await viewOf(rows), first);
        expect(heightOf(head), "the head, past half of main").toBeGreaterThan(half);
        const skills = head.filter(row => row.kind === "skill");
        expect(skills.length).toBeGreaterThan(0);
        // What sticks: the rows that do not give way — every one of them here — while they fit in half of main.
        const firm = head.filter(row => row.kind !== "skill");
        expect(heightOf(firm)).toBeLessThanOrEqual(half);
        await rest(page, rows, await placeOf(page, rows, `row:requests:${first}`) - 300);
        const deep = await viewOf(rows);
        const foot = stacks(deep, firm);
        expect(foot - deep.header, "the stuck block").toBeLessThanOrEqual(half);
        // The skill rows went by with the people: none sticks, and none shows.
        for (const skill of skills) {
            const shown = deep.rows.find(row => row.name === skill.name);
            expect(shown?.stuck ?? false, `${skill.name} scrolls`).toBe(false);
            if (shown !== undefined) expect(shown.bottom, `${skill.name} went by`).toBeLessThanOrEqual(deep.top + 0.5);
        }
    });

    test(`a row the stuck block covers takes no drop, and the keyboard brings one out from under it: a Shift+Tab onto it, a keyboard drag's step to it (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const { frame, rows } = await open(page, theme);
        await rest(page, rows, 0);
        const first = firstGroup(await viewOf(rows));
        const height = heightOf(headOf(await viewOf(rows), first));
        await rest(page, rows, await placeOf(page, rows, `row:requests:${first}`) - 300);
        // A person of the band with a duty, the row above theirs a person's too: their row's top put on the stuck block's
        // foot, so the row above is wholly under the block.
        const deep = await viewOf(rows);
        const people = deep.rows.filter(row => row.kind === "row" && !row.name.startsWith("row:requests") && row.place < deep.rows.find(r => r.name === `row:requests:${first}`)!.place);
        let pick: { readonly row: Shown; readonly above: Shown } | undefined;
        for (let i = people.length - 1; i > 0 && pick === undefined; i--) {
            const key = people[i]!.name.slice("row:".length);
            if (await rows.locator(`[data-roster-person-row="${key}"] [data-roster-tile]`).count() > 0 && people[i - 1]!.place + 40 > people[i]!.place - 40) pick = { row: people[i]!, above: people[i - 1]! };
        }
        expect(pick, "a person with a duty under another person").toBeDefined();
        const at = async () => {
            await rest(page, rows, pick!.row.place - height);
            const view = await viewOf(rows);
            const foot = view.header + height;
            const mine = view.rows.find(row => row.name === pick!.row.name)!, theirs = view.rows.find(row => row.name === pick!.above.name)!;
            expect(Math.abs(mine.top - foot), "their row on the block's foot").toBeLessThanOrEqual(0.5);
            expect(theirs.top >= view.header - 0.5 && theirs.bottom <= foot + 0.5, "the row above wholly under the block").toBe(true);
        };
        const mine = rows.locator(`[data-roster-person-row="${pick!.row.name.slice("row:".length)}"]`);
        const theirs = rows.locator(`[data-roster-person-row="${pick!.above.name.slice("row:".length)}"]`);
        const tile = mine.locator("[data-roster-tile]").first();
        const day = Number((await tile.locator("xpath=ancestor::*[@data-roster-person-day][1]").getAttribute("data-roster-person-day"))!.split(".").at(-1));
        const theirDay = theirs.locator("[data-roster-person-day]").nth(day);
        const otherDay = mine.locator("[data-roster-person-day]").nth(day === 0 ? 1 : 0);
        const hovered = main(frame).locator("[data-drop-active], [data-drop-invalid]");

        await test.step("a drag over the block lands on none of the rows it covers", async () => {
            await at();
            expect(await covered(theirDay), "the row above, covered").toBe(true);
            const from = (await tile.boundingBox())!, over = (await theirDay.boundingBox())!, beside = (await otherDay.boundingBox())!;
            await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
            await page.mouse.down();
            await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2, { steps: 2 });
            await expect(page.locator("[data-drag-ghost]")).toBeVisible();
            await page.mouse.move(over.x + over.width / 2, over.y + over.height / 2, { steps: 4 });
            await expect(hovered, "nothing under the block takes the drag").toHaveCount(0);
            await page.mouse.move(beside.x + beside.width / 2, beside.y + beside.height / 2, { steps: 4 });
            await expect(hovered, "a day in view takes it").toHaveCount(1);
            await page.keyboard.press("Escape");
            await page.mouse.up();
            await expect(page.locator("[data-drag-ghost]")).toHaveCount(0);
            await expect(frame.locator("[data-roster-tile][data-drafted]")).toHaveCount(0);
        });

        await test.step("a Shift+Tab onto a row under the block brings it out from under it", async () => {
            await at();
            await mine.locator("[data-roster-person-head]").focus();
            await page.keyboard.press("Shift+Tab");
            await settled(page);
            const focused = page.locator(":focus");
            await expect(theirs.locator(":focus"), "the focus in the row above").toHaveCount(1);
            expect(await covered(focused), "the focused control in view").toBe(false);
        });

        await test.step("a keyboard drag's step to a row under the block brings it out from under it", async () => {
            await at();
            await tile.focus();
            await page.keyboard.press("Space");
            await expect(page.locator("[data-drag-ghost]")).toBeVisible();
            await page.keyboard.press("ArrowUp");
            await settled(page);
            await expect(hovered, "the day above takes the drag").toHaveCount(1);
            await expect(theirs.locator("[data-drop-active], [data-drop-invalid]"), "the day above is the row above's").toHaveCount(1);
            expect(await covered(hovered), "the day above in view").toBe(false);
            await page.keyboard.press("Escape");
            await expect(page.locator("[data-drag-ghost]")).toHaveCount(0);
            await expect(frame.locator("[data-roster-tile][data-drafted]")).toHaveCount(0);
        });
    });
}

/** The Roster's main. */
const main = (frame: Locator) => frame.locator("[data-roster-main]");
