/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A filter's editor (#1667, ruled 22 November 2026), measured in a real
 * browser over the showcase's page of visuals and its builder — its removes,
 * its popover's foot, and a filter edited from `+N more`. The rail itself is
 * `studio-filters.spec.ts`'s (F1–F13); the rules, step by step with no
 * renderer, `filter-flow.test.ts`'s.
 *
 *  - F14 a remove says what it takes (ruled 22 November 2026): a row's is a
 *    ×, a group's the words Remove group at its foot's end — after its add, in
 *    line with its rows' ×s, never a × in its head — and whichever is pointed
 *    at stands what it would take on the danger wash: the row alone, or the
 *    group's whole box. The rows are one part in the three places a filter is
 *    written, measured the same in each: a reader's rail, the builder's
 *    starting filters, and a visual's own Filter field in the inspector.
 *  - F15 in a reader's rail, a group left with one row is that row, plain; and
 *    a filter's rows change nothing until Apply — every condition of it
 *    removed, Apply removes the filter: its chip and its editor go, and the
 *    page is as it was. Its editor's head holds no close × — its foot's
 *    Cancel closes it — and it opens with the focus on its first condition's
 *    field.
 *  - F16 a filter the row folds into `+N more` is edited there: a press on its
 *    line shows its editor in the same popover — its head and its foot the
 *    filter's — and Apply gives the list back, saying what was done, the page
 *    narrowed by it. By the keyboard, the focus goes with what the popover
 *    shows: to the editor's first control, and back to the filter's line —
 *    never to Clear all, drawn where Cancel stood; and `+N more` left with no
 *    filter to hold is shut, its popover and its chip gone. Its list's head
 *    holds its close ×, its foot Done; a filter's editor in it holds none,
 *    its head as tall.
 *  - F17 a row's × stands on its row's first line, at the row's end, whatever
 *    the row holds: the page's starting filter — its latest quarter, two
 *    conditions of a date — reads one line a condition in its chip's editor,
 *    as a condition of a date does in a group — its popover 460 wide, each
 *    joiner's words on its row's first line, a group's on its box's head's;
 *    and in a window too narrow for a row, its slots wrap under its first
 *    slot — never under its joiner, and never its ×, which no slot runs
 *    under.
 *
 * Every measurement is taken from the laid-out page.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-filter-editor --project desktop`.
 */

import { expect, type Locator } from "playwright/test";
import { test } from "./kept-page";
import { animationsOver, settled } from "./settle";
import { openConfigure } from "./studio-configure-page";
import { openBuilder, railOnTop, revenue, submit, written } from "./studio-filters-page";
import { openVisuals } from "./studio-visuals-page";
import { token } from "./tokens";

test.describe("A filter's editor (#1667)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    test("F14: a remove says what it takes — a row's ×, a group's Remove group in words at its foot's end — and what it is pointed at stands on the danger wash; the rows measure the same in a reader's rail, the builder's starting filters and a visual's own Filter field (ruled 22 November 2026)", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1100 });
        const CLEAR = "rgba(0, 0, 0, 0)";
        /**
         * Writes a condition and adds a group in a block of rows — its first row empty, its field's list open or not —
         * then reads how its removes are drawn, and what each tints as it is pointed at.
         */
        const drawn = async (rows: Locator) => {
            const chooser = rows.locator("[data-chooser]");
            // The danger wash (`bg.danger.subtle`, the design system's `--neg` at its wash) and the danger rule.
            const [wash, edge] = [await token(page, "status-neg-subtle"), await token(page, "border-error")];
            if (await chooser.count() === 0) await rows.locator("[data-slot-key][data-empty]").first().click();
            await chooser.locator("[role=option]", { hasText: "region" }).first().click();
            await expect(chooser.locator("[role=option]").first()).toBeVisible({ timeout: 20_000 });
            await chooser.locator("[role=option]").first().click();
            await expect(chooser).toHaveCount(0);
            await rows.locator("[data-condition-rows] > [data-query-line=foot]").getByRole("button", { name: "Add group" }).click();
            // The group's first row opens on its field's list, which takes the Esc.
            await expect(chooser).toBeVisible();
            await page.keyboard.press("Escape");
            await expect(chooser).toHaveCount(0);
            await settled(page);
            const look = await rows.locator("[data-condition-rows]").evaluate((root) => {
                const at = (n: number) => Math.round(n * 2) / 2;
                const size = (el: Element) => [at(el.getBoundingClientRect().width), at(el.getBoundingClientRect().height)];
                const box = root.querySelector("[data-query-group-box]")!;
                const foot = box.querySelector(":scope > [data-query-line=foot]")!;
                const removeGroup = foot.querySelector("[data-query-remove=group]")!;
                const crosses = [...root.querySelectorAll("[data-query-line=row] > [data-query-remove=row]")];
                const words = getComputedStyle(removeGroup);
                return {
                    look: root.getAttribute("data-query-look"),
                    // The filter's own row's ×, then the group's two: each a button of one size.
                    crosses: crosses.map(size),
                    icons: crosses.map((cross) => cross.querySelector("svg")?.getAttribute("data-icon")),
                    foot: [...foot.querySelectorAll("button")].map((button) => button.textContent),
                    removeGroup: [removeGroup.querySelector("svg") === null, size(removeGroup)[1], words.fontSize, words.fontWeight],
                    // At its foot's end, in line with its rows' ×s; none in its head.
                    inLine: crosses.slice(1).every((cross) => at(cross.getBoundingClientRect().right) === at(removeGroup.getBoundingClientRect().right)),
                    afterAdd: foot.querySelector("button")!.getBoundingClientRect().right <= removeGroup.getBoundingClientRect().left,
                    inHead: box.querySelectorAll("[data-query-group-head] [data-query-remove]").length,
                    row: at(root.querySelector("[data-query-line=row]")!.getBoundingClientRect().height),
                    slot: at(root.querySelector("[data-slot-key]")!.getBoundingClientRect().height),
                };
            });
            /** Each row's fill and the rule around it — the filter's own, then the group's two — and the group's box's fill and edge. */
            const fills = () => rows.locator("[data-condition-rows]").evaluate((root) => {
                const box = getComputedStyle(root.querySelector("[data-query-group-box]")!);
                const looks = [...root.querySelectorAll("[data-query-line=row]")].map((row) => getComputedStyle(row));
                return {
                    rows: looks.map((look) => look.backgroundColor),
                    rules: looks.map((look) => (look.outlineStyle === "none" ? "none" : `${look.outlineWidth} ${look.outlineColor} +${look.outlineOffset}`)),
                    box: box.backgroundColor, edge: box.borderTopColor,
                };
            });
            const NO_RULES = ["none", "none", "none"];
            const rest = await fills();
            expect([rest.rows, rest.rules], "at rest no row is tinted").toEqual([[CLEAR, CLEAR, CLEAR], NO_RULES]);
            expect([rest.box === wash, rest.edge === edge], "at rest the group's box is its own").toEqual([false, false]);
            // A group's row's ×: that row alone on the wash, inside the danger rule 3px past it — not the rows beside it, nor its group's box.
            await rows.locator("[data-query-group-box] > [data-query-line=row] > [data-query-remove=row]").first().hover();
            await expect.poll(fills).toEqual({ rows: [CLEAR, wash, CLEAR], rules: ["none", `1px ${edge} +3px`, "none"], box: rest.box, edge: rest.edge });
            // Remove group: the group's whole box on the wash, its edge the danger rule — no row of its own tinted.
            await rows.locator("[data-query-remove=group]").hover();
            await expect.poll(fills).toEqual({ rows: [CLEAR, CLEAR, CLEAR], rules: NO_RULES, box: wash, edge });
            // Its words take the danger ink as they are pointed at.
            expect(await rows.locator("[data-query-remove=group]").evaluate((el) => getComputedStyle(el).color)).toBe(await token(page, "fg-danger"));
            await page.mouse.move(0, 0);
            await expect.poll(fills).toEqual(rest);
            return look;
        };
        /**
         * How the rows are drawn wherever a filter is written: a row 28 tall; its slots the small Select's trigger, 26; its
         * × the extra-small icon button, 26 square; Remove group the extra-small button, as tall, its words 11.5 / 500.
         */
        const ROWS = {
            look: "inline", crosses: [[26, 26], [26, 26], [26, 26]], icons: ["xmark", "xmark", "xmark"], foot: ["Add condition", "Remove group"],
            removeGroup: [true, 26, "11.5px", "500"], inLine: true, afterAdd: true, inHead: 0, row: 28, slot: 26,
        };

        // A reader's rail: a new filter's editor.
        const grid = await openVisuals(page, "light");
        const reader = grid.locator("xpath=..").locator("[data-studio-filters]");
        await railOnTop(page, reader);
        await reader.locator("[data-slice-add=filter]").click();
        expect(await drawn(page.locator("[data-studio-filter-rows]")), "a reader's rail").toEqual(ROWS);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);

        // The builder's starting filters: a new filter's editor, in the canvas's band.
        const builder = await openBuilder(page);
        const starting = builder.locator("[data-snap-grid-head] [data-studio-starting-filters]");
        await expect(starting.locator("[data-slice-add=filter]")).toBeVisible({ timeout: 30_000 });
        await railOnTop(page, starting);
        await starting.locator("[data-slice-add=filter]").click();
        expect(await drawn(page.locator("[data-studio-filter-rows]")), "the builder's starting filters").toEqual(ROWS);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);

        // A visual's own Filter field, in the inspector's Configure tab.
        const { tab } = await openConfigure(page);
        const field = tab.locator("[data-configure=where]");
        await field.scrollIntoViewIfNeeded();
        expect(await drawn(field.locator("[data-studio-filter-rows]")), "a visual's own Filter").toEqual(ROWS);
    });

    test("F15: in a reader's rail a group left with one row is that row, plain; and a filter's rows change nothing until Apply — every condition of it removed, Apply removes the filter, its chip and its editor gone, the page as it was (ruled 22 November 2026)", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1100 });
        const grid = await openVisuals(page, "light");
        const rail = grid.locator("xpath=..").locator("[data-studio-filters]");
        const all = await revenue(grid).textContent();
        const rows = page.locator("[data-studio-filter-rows]");
        const chooser = rows.locator("[data-chooser]");
        await railOnTop(page, rail);
        await rail.locator("[data-slice-add=filter]").click();
        await chooser.locator("[role=option]", { hasText: "region" }).first().click();
        await expect(chooser.locator("[role=option]", { hasText: "SA" })).toBeVisible({ timeout: 20_000 });
        await chooser.locator("[role=option]", { hasText: "SA" }).first().click();
        await expect(chooser).toHaveCount(0);
        await submit(page).click();
        await expect(revenue(grid)).toHaveText("38.4k");
        await expect(written(rail)).toHaveText("Region: SA");

        // Its chip's editor: Remove filter at its foot's start, then Cancel and Apply — off, its rows saying what it holds.
        await written(rail).click();
        await expect(rows).toBeVisible();
        const foot = () => page.getByRole("dialog").locator("button").evaluateAll((every) => every
            .filter((b) => ["Remove filter", "Cancel", "Apply"].includes(b.textContent ?? "")).map((b) => [b.textContent, (b as HTMLButtonElement).disabled]));
        expect(await foot()).toEqual([["Remove filter", false], ["Cancel", false], ["Apply", true]]);
        // Its foot's Cancel closes it: no × in its head, over its rows' own. It opened with the focus on its condition's field.
        await expect(page.getByRole("dialog").getByRole("button", { name: "Close" })).toHaveCount(0);
        await expect(rows.locator("[data-slot-key]").first()).toBeFocused();
        // A group added — two rows in its box — then one of them removed: the other stands, plain.
        await rows.locator("[data-condition-rows] > [data-query-line=foot]").getByRole("button", { name: "Add group" }).click();
        await expect(chooser).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(chooser).toHaveCount(0);
        await expect(rows.locator("[data-query-group-box] > [data-query-line=row]")).toHaveCount(2);
        await rows.locator("[data-query-group-box] > [data-query-line=row] > [data-query-remove=row]").first().click();
        await expect(rows.locator("[data-query-group-box]")).toHaveCount(0);
        await expect(rows.locator("[data-query-line=row]")).toHaveCount(2);
        // The empty row removed, then the filter's one condition: its rows hold none, and the page still holds the filter —
        // Apply on, to remove it.
        await rows.locator("[data-query-line=row] > [data-query-remove=row]").nth(1).click();
        await rows.locator("[data-query-line=row] > [data-query-remove=row]").click();
        await expect(rows.locator("[data-query-line=row]")).toHaveCount(0);
        expect(await foot()).toEqual([["Remove filter", false], ["Cancel", false], ["Apply", false]]);
        await expect(revenue(grid)).toHaveText("38.4k");
        // Cancel: the filter as it was. Again, and Apply: it goes — the editor shut, its chip gone, every region's revenue.
        await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(written(rail)).toHaveText("Region: SA");
        await written(rail).click();
        await rows.locator("[data-query-line=row] > [data-query-remove=row]").click();
        await submit(page).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(rail.locator("[data-slice-clause]")).toHaveCount(1);
        await expect(revenue(grid)).toHaveText(all ?? "");
    });

    test("F16: a filter the row folds into +N more is edited there — a press on its line shows its editor in the same popover, its head and its foot the filter's — and Apply gives the list back, saying what was done, the page narrowed by it; the focus goes with what it shows, never to Clear all, and +N more left with no filter is shut (ruled 22 November 2026)", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1100 });
        const grid = await openVisuals(page, "light");
        const rail = grid.locator("xpath=..").locator("[data-studio-filters]");
        const rows = page.locator("[data-studio-filter-rows]");
        const chooser = rows.locator("[data-chooser]");
        await railOnTop(page, rail);
        await rail.locator("[data-slice-add=filter]").click();
        await chooser.locator("[role=option]", { hasText: "region" }).first().click();
        await expect(chooser.locator("[role=option]", { hasText: "SA" })).toBeVisible({ timeout: 20_000 });
        await chooser.locator("[role=option]", { hasText: "SA" }).first().click();
        await submit(page).click();
        await expect(revenue(grid)).toHaveText("38.4k");
        // A window too narrow for its chip: the row folds it into +N more.
        await page.setViewportSize({ width: 480, height: 1000 });
        await expect(rail.locator("[data-slice-more]")).toBeVisible();
        await settled(page);
        await rail.locator("[data-slice-more]").click();
        const popover = page.locator("[data-scope='popover'][data-part='content'][data-state='open']");
        /** The popover as it stands: its head's words, whether it holds a close ×, and its height; the filters it lists; and its foot's buttons. */
        const now = () => popover.evaluate((el) => ({
            head: el.querySelector("[data-slice-edit-label]")!.textContent,
            close: el.querySelector("[data-slice-edit-head] button[aria-label='Close']") !== null,
            headHeight: el.querySelector("[data-slice-edit-head]")!.getBoundingClientRect().height,
            listed: [...el.querySelectorAll("[data-slice-more-words]")].map((line) => line.textContent),
            foot: [...el.querySelectorAll("button")].filter((b) => ["Remove filter", "Cancel", "Apply", "Clear all", "Done"].includes(b.textContent ?? "")).map((b) => b.textContent),
        }));
        // The popover opens by a scale: its head's height is read once that has ended.
        await animationsOver(popover);
        const list = await now();
        // Its list: Clear all and Done in its foot, and its close × in its head.
        expect([list.listed.includes("region is SA"), list.foot, list.close]).toEqual([true, ["Clear all", "Done"], true]);
        /** What holds the focus, by its name — its label, else its words; `nothing` where the page's body does. */
        const focused = () => page.evaluate(() => {
            const held = document.activeElement;
            return held === null || held === document.body ? "nothing" : held.getAttribute("aria-label") ?? held.textContent;
        });
        // Its line is one button, its words and Edit: pressed — by the keyboard — the popover is the filter's editor — no ×
        // in its head, which is as tall as the list's — the focus on its first control, its condition's field.
        const line = popover.getByRole("button", { name: "Edit filter: region is SA" });
        await expect(line).toHaveText("region is SAEdit");
        await line.press("Enter");
        await expect(rows).toBeVisible();
        expect(await now()).toEqual({ head: "Filter · Orders", close: false, headHeight: list.headHeight, listed: [], foot: ["Remove filter", "Cancel", "Apply"] });
        expect(await focused()).toBe("region");
        // Cancel gives the list back as it was, the focus on the filter's line — never on Clear all, drawn where Cancel
        // stood — and Enter opens its editor again.
        await popover.getByRole("button", { name: "Cancel", exact: true }).press("Enter");
        await expect.poll(focused).toBe("Edit filter: region is SA");
        expect(await now()).toEqual(list);
        await page.keyboard.press("Enter");
        await expect(rows).toBeVisible();
        // Its value changed, and Apply: the list again, saying the filter as it is now, and the page New South Wales' alone.
        await rows.locator("[data-slot-key]", { hasText: "SA" }).first().click();
        await expect(chooser.locator("[role=option]", { hasText: "NSW" })).toBeVisible({ timeout: 20_000 });
        await chooser.locator("[role=option]", { hasText: "NSW" }).first().click();
        await expect(chooser).toHaveCount(0);
        await expect(revenue(grid)).toHaveText("38.4k");
        await submit(page).press("Enter");
        await expect.poll(focused).toBe("Edit filter: region is NSW");
        expect(await now()).toEqual({ ...list, listed: list.listed.map((words) => (words === "region is SA" ? "region is NSW" : words)) });
        await expect(revenue(grid)).toHaveText("117k");
        // Each line's × takes its filter out. The last gone, +N more has none to hold: it is shut — its popover and its
        // chip gone. (The row hands the focus to + FILTER; the page's toolbar then draws the rail in another of its
        // forms, a new row, which holds none — the row's own hand-off is `chips.dom.test.tsx`'s.)
        for (let left = list.listed.length; left > 0; left -= 1) {
            await popover.getByRole("button", { name: "Remove filter", exact: true }).first().press("Enter");
            await expect(popover.locator("[data-slice-more-words]")).toHaveCount(left - 1);
        }
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(rail.locator("[data-slice-more]")).toHaveCount(0);
        await expect(rail.locator("[data-slice-clause]")).toHaveCount(0);
    });

    test("F17: a row's × stands on its row's first line, at the row's end — the page's date window one line a condition in its chip's editor, as a date's condition is in a group — and in a window too narrow for a row its slots wrap under its first slot, never its ×", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1100 });
        const grid = await openVisuals(page, "light");
        const rail = grid.locator("xpath=..").locator("[data-studio-filters]");
        const rows = page.locator("[data-studio-filter-rows]");
        const chooser = rows.locator("[data-chooser]");
        /**
         * Each row as it lies: how many lines its slots stand on; whether its joiner's words and its × are each centred on
         * its first slot's line, and its × ends where the row ends; whether every line of its slots starts under its first
         * slot; and whether every slot ends before its ×.
         */
        const laid = () => rows.locator("[data-condition-rows]").evaluate((root) => {
            const at = (n: number) => Math.round(n * 2) / 2;
            const middle = (box: DOMRect) => at(box.top + box.height / 2);
            return [...root.querySelectorAll("[data-query-line=row]")].map((row) => {
                const box = row.getBoundingClientRect();
                const cross = row.querySelector(":scope > [data-query-remove=row]")!.getBoundingClientRect();
                const joiner = row.querySelector(":scope > [data-query-joiner]");
                const slots = [...row.querySelectorAll("[data-slot-key]")].map((slot) => slot.getBoundingClientRect());
                const first = slots[0]!;
                const tops = [...new Set(slots.map((slot) => at(slot.top)))];
                return {
                    lines: tops.length,
                    // A joiner that says nothing — a first row's — and a lone condition's, which is not drawn, have no words to centre.
                    joinerOnFirst: joiner === null || joiner.textContent === "" || joiner.getBoundingClientRect().height === 0 || middle(joiner.getBoundingClientRect()) === middle(first),
                    crossOnFirst: middle(cross) === middle(first),
                    crossAtEnd: at(cross.right) === at(box.right),
                    under: tops.every((top) => at(Math.min(...slots.filter((slot) => at(slot.top) === top).map((slot) => slot.left))) === at(first.left)),
                    clear: slots.every((slot) => slot.right <= cross.left),
                };
            });
        });
        const ONE_LINE = { lines: 1, joinerOnFirst: true, crossOnFirst: true, crossAtEnd: true, under: true, clear: true };
        /** The open popover's width. */
        const width = () => page.locator("[data-scope='popover'][data-part='content'][data-state='open']").evaluate((el) => el.getBoundingClientRect().width);
        await railOnTop(page, rail);
        // The page's starting filter, its latest quarter: on or after a date, and before another — a line each.
        await rail.locator("[data-slice-clause]").first().click();
        await expect(rows.locator("[data-query-line=row]")).toHaveCount(2);
        await settled(page);
        expect(await laid(), "the page's date window").toEqual([ONE_LINE, ONE_LINE]);
        // The popover of a filter's rows: 460 wide, whichever of the row's it is.
        expect(await width()).toBe(460);
        // Its head — all of these are true — reads as one line: its words centred on its match's slot.
        expect(await rows.locator("[data-condition-rows] > [data-query-line=head]").evaluate((head) => {
            const middle = (el: Element) => Math.round((el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2) * 2) / 2;
            return middle(head.querySelector("[data-query-row-body] > span")!) === middle(head.querySelector("[data-slot-key]")!);
        })).toBe(true);
        // A group, its first condition a date's: its field, then the year its list opens on. It reads one line too, in the
        // group's box; the group's second row, still to be written, is its field's slot alone.
        await rows.locator("[data-condition-rows] > [data-query-line=foot]").getByRole("button", { name: "Add group" }).click();
        await chooser.locator("[role=option]", { hasText: "ordered at" }).first().click();
        await expect(chooser.locator("[role=option]", { hasText: "2026" })).toBeVisible({ timeout: 20_000 });
        await chooser.locator("[role=option]", { hasText: "2026" }).first().click();
        await expect(chooser).toHaveCount(0);
        await settled(page);
        expect(await laid(), "a date's condition in a group").toEqual([ONE_LINE, ONE_LINE, ONE_LINE, ONE_LINE]);
        // The group's joiner stands on its box's head's line: its words centred on the head's slot.
        expect(await rows.locator("[data-query-line=group]").evaluate((group) => {
            const middle = (el: Element) => Math.round((el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2) * 2) / 2;
            return middle(group.querySelector(":scope > [data-query-joiner]")!) === middle(group.querySelector("[data-query-group-head] [data-slot-key]")!);
        })).toBe(true);
        await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);

        // A window narrower than a condition of a date. The filter's editor opens from its chip — or, where the row has
        // folded it, from its line in +N more — inside the window: each row's value wraps under its field — the row's
        // first slot, not its joiner — and its × stays on the field's line, at the row's end, no slot under it.
        await page.setViewportSize({ width: 360, height: 900 });
        const [chip, more] = [rail.locator("[data-slice-clause]"), rail.locator("[data-slice-more]")];
        // The toolbar chooses its form by its measured room: read once it has.
        await expect.poll(async () => await chip.count() + await more.count()).toBe(1);
        await settled(page);
        if (await more.count() === 1) {
            await more.click();
            await page.locator("[data-scope='popover'][data-part='content'][data-state='open'] [data-slice-more-edit]").first().click();
        } else await chip.click();
        await expect(rows.locator("[data-query-line=row]")).toHaveCount(2);
        await settled(page);
        expect(await width()).toBeLessThanOrEqual(360);
        const WRAPPED = { ...ONE_LINE, lines: 2 };
        expect(await laid(), "in a window 360 wide").toEqual([WRAPPED, WRAPPED]);
        // And nothing of it runs past the popover's body.
        expect(await rows.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    });
});
