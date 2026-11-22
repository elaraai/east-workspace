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
 *    page is as it was.
 *  - F16 a filter the row folds into `+N more` is edited there: a press on its
 *    line shows its editor in the same popover — its head and its foot the
 *    filter's — and Apply gives the list back, saying what was done, the page
 *    narrowed by it.
 *
 * Every measurement is taken from the laid-out page.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-filter-editor --project desktop`.
 */

import { expect, type Locator } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";
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

    test("F16: a filter the row folds into +N more is edited there — a press on its line shows its editor in the same popover, its head and its foot the filter's — and Apply gives the list back, saying what was done, the page narrowed by it (ruled 22 November 2026)", async ({ page }) => {
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
        /** The popover as it stands: its head's words, the filters it lists, and its foot's buttons. */
        const now = () => popover.evaluate((el) => ({
            head: el.querySelector("button[aria-label='Close']")!.parentElement!.querySelector("span")!.textContent,
            listed: [...el.querySelectorAll("[data-slice-more-words]")].map((line) => line.textContent),
            foot: [...el.querySelectorAll("button")].filter((b) => ["Remove filter", "Cancel", "Apply", "Clear all", "Done"].includes(b.textContent ?? "")).map((b) => b.textContent),
        }));
        const list = await now();
        expect([list.listed.includes("region is SA"), list.foot]).toEqual([true, ["Clear all", "Done"]]);
        // Its line is one button, its words and Edit: pressed, the popover is the filter's editor.
        const line = popover.getByRole("button", { name: "Edit filter: region is SA" });
        await expect(line).toHaveText("region is SAEdit");
        await line.click();
        await expect(rows).toBeVisible();
        expect(await now()).toEqual({ head: "Filter · Orders", listed: [], foot: ["Remove filter", "Cancel", "Apply"] });
        // Its value changed, and Apply: the list again, saying the filter as it is now, and the page New South Wales' alone.
        await rows.locator("[data-slot-key]", { hasText: "SA" }).first().click();
        await expect(chooser.locator("[role=option]", { hasText: "NSW" })).toBeVisible({ timeout: 20_000 });
        await chooser.locator("[role=option]", { hasText: "NSW" }).first().click();
        await expect(chooser).toHaveCount(0);
        await expect(revenue(grid)).toHaveText("38.4k");
        await submit(page).click();
        expect(await now()).toEqual({ ...list, listed: list.listed.map((words) => (words === "region is SA" ? "region is NSW" : words)) });
        await expect(revenue(grid)).toHaveText("117k");
        await popover.getByRole("button", { name: "Done", exact: true }).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
    });
});
