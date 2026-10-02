/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The query builder, measured in a real browser (#940, `Query Editor Spec.md`
 * §4, §7 V2), on its example open on Top shipped orders, 2026, which runs as
 * it opens: one 44px toolbar row across a borderless frame, over the pane —
 * `min(480px, 52%)` wide whichever view the Query tab shows, its 44px tab row
 * level with the results' 44px band — and the status line along the foot; a
 * collapsed pane a 44px rail. The Query tab's band under its tab row, then the
 * source, a shape line after it and after every step, and the foot at the
 * pane's foot; the view shown in the brand. The toolbar folds by one ladder —
 * Run's keys, then Copy jq, then the history item. The states by their tokens:
 * a step not finished dashed, a slot with a problem in the danger ink. Save…
 * opens the 320px save popover with the name and the description. The frame is
 * set to the mock's width, 1240px, and every measurement is polled until it
 * holds, on a page at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test query-builder --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

const HASH = "e3/query/query/queryBuilder";

/** Open the builder example and return the builder, at rest, as wide as the mock's (1240px). */
async function openBuilder(page: Page, theme: "light" | "dark" = "light"): Promise<Locator> {
    await page.goto(`/?theme=${theme}#${HASH}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const builder = entry.locator("[data-query-builder]").first();
    // Opening a saved query runs it: the builder is at rest once the result shows.
    await expect(builder.locator("[data-query-results-view]")).toBeVisible({ timeout: 20_000 });
    await builder.evaluate((root) => { (root as HTMLElement).style.width = "1240px"; });
    await settled(page);
    return builder;
}

/** A part's width within the builder, to the pixel. */
function width(builder: Locator, selector: string): Promise<number> {
    return builder.evaluate((root, sel) => Math.round(root.querySelector(sel)!.getBoundingClientRect().width), selector);
}

test.describe("Query builder (#940)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    for (const theme of ["light", "dark"] as const) {
        test(`one 44px toolbar row across a borderless builder; the pane 480px wide, its 44px tab row level with the results' 44px band and the Query tab's band under it; the status line along the foot (${theme})`, async ({ page }) => {
            const builder = await openBuilder(page, theme);
            await expect.poll(() => builder.evaluate((root) => {
                const r = root.getBoundingClientRect();
                const box = (el: Element) => {
                    const b = el.getBoundingClientRect();
                    return [Math.round(b.left - r.left), Math.round(b.top - r.top), Math.round(b.width), Math.round(b.height)];
                };
                const toolbar = root.querySelector(":scope > [data-slot=toolbar]")!;
                const pane = root.querySelector("[data-side=start][data-surface=shell]")!;
                const style = getComputedStyle(root);
                return {
                    border: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
                    toolbar: box(toolbar), rows: toolbar.querySelectorAll("[data-toolbar]").length,
                    pane: box(pane), tabs: box(pane.firstElementChild!),
                    band: box(root.querySelector("[data-query-results-bar]")!),
                    tabBar: box(root.querySelector("[data-query-tab=query] > [data-query-tab-bar]")!),
                    status: box(root.querySelector("[data-query-status]")!),
                };
            })).toEqual({
                border: ["0px", "0px", "0px", "0px"],
                toolbar: [0, 0, 1240, 44], rows: 1,
                pane: [0, 44, 480, 684], tabs: [0, 44, 479, 44],
                band: [480, 44, 760, 44],
                tabBar: [0, 88, 479, 44],
                status: [0, 728, 1240, 32],
            });
        });
    }

    test("Visual · jq keeps the pane's width; collapsed, the pane is a 44px rail and the results take the room", async ({ page }) => {
        const builder = await openBuilder(page);
        const pane = "[data-side=start][data-surface=shell]";
        await builder.locator("[data-query-view] button", { hasText: "jq" }).click();
        await expect(builder.locator("[data-query-view]")).toHaveAttribute("data-query-view", "jq");
        await expect.poll(() => width(builder, pane)).toBe(480);
        await builder.locator("[data-query-view] button", { hasText: "Visual" }).click();
        await expect(builder.locator("[data-query-view]")).toHaveAttribute("data-query-view", "visual");
        const before = await width(builder, "[data-query-results]");

        await builder.getByRole("button", { name: "Collapse Query" }).click();
        await expect.poll(() => width(builder, pane)).toBe(44);
        await expect.poll(() => width(builder, "[data-query-results]")).toBe(before + 436);
    });

    test("the Query tab: the source, a shape line after it and after every step, and the foot at the pane's foot; the view shown in the brand", async ({ page }) => {
        const builder = await openBuilder(page);
        await expect.poll(() => builder.evaluate((root) => {
            const tab = root.querySelector("[data-query-tab=query]")!;
            const parts = [
                ...[...tab.querySelectorAll("[data-query-source]")].map((el) => ["source", el] as const),
                ...[...tab.querySelectorAll("[data-query-shape]")].map((el) => ["shape", el] as const),
                ...[...tab.querySelectorAll("[data-step-id]")].map((el) => ["step", el] as const),
            ].sort(([, a], [, b]) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
            const pane = root.querySelector("[data-side=start][data-surface=shell]")!.getBoundingClientRect();
            const foot = tab.querySelector("[data-query-foot]")!.getBoundingClientRect();
            const [shown, other] = [...root.querySelectorAll("[data-query-view] button")]
                .sort((a, b) => (a.getAttribute("data-state") === "on" ? -1 : 0) - (b.getAttribute("data-state") === "on" ? -1 : 0));
            return {
                order: parts.map(([kind]) => kind),
                footAtFoot: Math.round(pane.bottom - foot.bottom),
                shown: shown!.textContent,
                tinted: getComputedStyle(shown!).backgroundColor !== getComputedStyle(other!).backgroundColor,
            };
        })).toEqual({
            // The default query's five steps.
            order: ["source", "shape", "step", "shape", "step", "shape", "step", "shape", "step", "shape", "step", "shape"],
            footAtFoot: 0,
            shown: "Visual",
            tinted: true,
        });
    });

    test("the toolbar folds by one ladder — Run's keys, Copy jq, the history item — a step each time the frame is narrower than the row's items", async ({ page }) => {
        const builder = await openBuilder(page);
        const toolbar = builder.locator(":scope > [data-slot=toolbar] [data-toolbar]");
        await expect.poll(() => toolbar.getAttribute("data-toolbar-ladder")).toBe("run>1 copy>1 history>1");
        // At the mock's 1240px frame nothing folds.
        await expect.poll(() => toolbar.getAttribute("data-toolbar-folds")).toBe("0");
        const ladder = ["run", "copy", "history"];
        const folded = async () => {
            const keys = await toolbar.evaluate((row) => (row.getAttribute("data-toolbar-state") ?? "").split(";")
                .map((s) => s.split("=")).filter(([, f]) => !f!.startsWith("0/")).map(([k]) => k!));
            // The state lists the items in the row's order; they are put in the ladder's.
            return keys.sort((a, b) => ladder.indexOf(a) - ladder.indexOf(b));
        };
        // The frame whose row is exactly as wide as its items, as they are drawn now: their widths and a gap between each two.
        const fitting = () => builder.evaluate((root) => {
            const row = root.querySelector(":scope > [data-slot=toolbar] [data-toolbar]")!;
            const items = [...row.children].map((el) => el.getBoundingClientRect().width);
            const need = items.reduce((sum, w) => sum + w, 0) + Number.parseFloat(getComputedStyle(row).columnGap) * (items.length - 1);
            return root.getBoundingClientRect().width - row.getBoundingClientRect().width + need;
        });
        const frameTo = async (frame: number) => {
            await builder.evaluate((root, w) => { (root as HTMLElement).style.width = `${w}px`; }, frame);
            await settled(page);
        };
        // Where each step falls is the fonts' to say, so the frames come from the items as measured: a frame
        // the row's items fit keeps their forms, and one 2px narrower folds the ladder's next step.
        for (let folds = 0; folds < ladder.length; folds++) {
            const frame = await fitting();
            await frameTo(frame);
            await expect.poll(folded, { message: `at ${frame.toFixed(2)}px, the row's items' width` }).toEqual(ladder.slice(0, folds));
            await frameTo(frame - 2);
            await expect.poll(folded, { message: `at ${(frame - 2).toFixed(2)}px` }).toEqual(ladder.slice(0, folds + 1));
        }
    });

    test("a step not finished is dashed; a slot with a problem is in the danger ink, as its problem's line is", async ({ page }) => {
        const builder = await openBuilder(page);
        await builder.locator("[data-query-foot] button", { hasText: "Sort by" }).click();
        await expect.poll(() => builder.evaluate((root) => {
            const last = [...root.querySelectorAll("[data-step-id]")].pop()!;
            return [last.hasAttribute("data-unfinished"), getComputedStyle(last).borderTopStyle];
        })).toEqual([true, "dashed"]);

        // A field the rows don't have, written in the jq and read back as steps.
        await builder.locator("[data-query-view] button", { hasText: "jq" }).click();
        await builder.getByRole("textbox", { name: "jq query" }).fill(".orders\n| map(select(.totl >= 100))");
        await builder.locator("[data-query-view] button", { hasText: "Visual" }).click();
        await expect.poll(() => builder.evaluate((root) => {
            const slot = root.querySelector("[data-step-id] [data-slot-key][data-error]");
            const problem = root.querySelector("[data-query-problem][data-severity=error]");
            return slot === null || problem === null ? null : getComputedStyle(slot).color === getComputedStyle(problem).color;
        })).toBe(true);
    });

    test("Save… opens the 320px save popover, with the query's name and its description", async ({ page }) => {
        const builder = await openBuilder(page);
        await builder.locator("[data-query-save-open]").click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect.poll(() => dialog.evaluate((d) => ({
            w: Math.round(d.getBoundingClientRect().width),
            fields: [...d.querySelectorAll("input, textarea")].map((e) => e.getAttribute("aria-label")),
            name: (d.querySelector("input") as HTMLInputElement).value,
        }))).toEqual({ w: 320, fields: ["Query name", "What the query answers, in one sentence"], name: "Top shipped orders, 2026" });
    });
});
