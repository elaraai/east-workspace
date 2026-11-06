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
 * Run's keys, then Copy jq to its icon, then Copy jq and Save… into the ⋯
 * chip in one move (#1229), then the history item. The states by their tokens:
 * a step not finished dashed, a slot with a problem in the danger ink. Save…
 * opens the 320px save popover with the name and the description. The history
 * item's Save shows the drafts it saves until the record reads back, never the
 * query as it was before them. The frame is set to the mock's width, 1240px,
 * and every measurement is polled until it holds, on a page at rest. Its
 * builder frame (#1125 F3): on a desktop the pane is pinned, the results
 * beside it; on a phone it rests on its rail, and opened it floats over the
 * results from its edge, the results where they were, under the scrim —
 * which a tap closes.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test query-builder --project desktop`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";
import { frameAt, type Box } from "./builder-frame";

const HASH = "e3/query/query/queryBuilder";

/**
 * Open the builder example and return the builder, at rest: as wide as the
 * mock's (1240px), or, with `null`, as wide as the page lays it out.
 */
async function openBuilder(page: Page, theme: "light" | "dark" = "light", width: number | null = 1240): Promise<Locator> {
    await page.goto(`/?theme=${theme}#${HASH}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const builder = entry.locator("[data-query-builder]").first();
    // Opening a saved query runs it: the builder is at rest once the result shows.
    await expect(builder.locator("[data-query-results-view]")).toBeVisible({ timeout: 20_000 });
    if (width !== null) await builder.evaluate((root, w) => { (root as HTMLElement).style.width = `${w}px`; }, width);
    await settled(page);
    return builder;
}

/** A difference of boxes' edges, to a tenth of a pixel — subtraction leaves float noise. */
const tenth = (n: number) => Math.round(n * 10) / 10;

/** A box's place within another, to a tenth of a pixel. */
const within = (box: Box, frame: Box): Box => ({ x: tenth(box.x - frame.x), y: tenth(box.y - frame.y), w: box.w, h: box.h });

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
                const toolbar = root.querySelector("[data-builder-frame] > [data-frame-slot=toolbar]")!;
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

    test("the toolbar folds by one ladder — Run's keys, Copy jq to its icon, Copy jq and Save… into the ⋯ chip in one move, the history item — a move each time the frame is narrower than the row's items", async ({ page }) => {
        const builder = await openBuilder(page);
        const toolbar = builder.locator("[data-builder-frame] > [data-frame-slot=toolbar] [data-toolbar]");
        await expect.poll(() => toolbar.getAttribute("data-toolbar-ladder")).toBe("run>1 copy>1 copy>2 save>1 more>1 history>1");
        // At the mock's 1240px frame nothing folds.
        await expect.poll(() => toolbar.getAttribute("data-toolbar-folds")).toBe("0");
        // The configurations the ladder passes through, move by move: the ⋯ chip's bundle is one move of three steps (#1229).
        const MOVES = [
            { history: 0, copy: 0, save: 0, more: 0, run: 0 },
            { history: 0, copy: 0, save: 0, more: 0, run: 1 },
            { history: 0, copy: 1, save: 0, more: 0, run: 1 },
            { history: 0, copy: 2, save: 1, more: 1, run: 1 },
            { history: 1, copy: 2, save: 1, more: 1, run: 1 },
        ];
        // Each item's form, by its key.
        const folded = () => toolbar.evaluate((row) => Object.fromEntries((row.getAttribute("data-toolbar-state") ?? "").split(";")
            .map((s) => s.split("=")).map(([k, f]) => [k!, Number(f!.split("/")[0])])));
        // The frame whose row is exactly as wide as its items, as they are drawn now: their widths and a gap between each two.
        const fitting = () => builder.evaluate((root) => {
            const row = root.querySelector("[data-builder-frame] > [data-frame-slot=toolbar] [data-toolbar]")!;
            const items = [...row.children].map((el) => el.getBoundingClientRect().width);
            const style = getComputedStyle(row);
            const need = items.reduce((sum, w) => sum + w, 0) + Number.parseFloat(style.columnGap) * (items.length - 1)
                + Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
            return root.getBoundingClientRect().width - row.getBoundingClientRect().width + need;
        });
        const frameTo = async (frame: number) => {
            await builder.evaluate((root, w) => { (root as HTMLElement).style.width = `${w}px`; }, frame);
            await settled(page);
        };
        // Where each move falls is the fonts' to say, so the frames come from the items as measured: a frame
        // the row's items fit keeps their forms, and one 2px narrower takes the ladder's next move.
        for (let move = 0; move + 1 < MOVES.length; move++) {
            const frame = await fitting();
            // A phone's frame, 560px or narrower, has one form an item.
            if (frame - 2 <= 560) break;
            await frameTo(frame);
            await expect.poll(folded, { message: `at ${frame.toFixed(2)}px, the row's items' width` }).toEqual(MOVES[move]);
            await frameTo(frame - 2);
            await expect.poll(folded, { message: `at ${(frame - 2).toFixed(2)}px` }).toEqual(MOVES[move + 1]);
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

    test("the history item's Save: every state the steps pass through, from its click until the record reads back, is the drafts it saves — never the query as it was before them", async ({ page }) => {
        const builder = await openBuilder(page);
        const steps = () => builder.evaluate((root) => [...root.querySelectorAll("[data-step-id]")].map((el) => el.getAttribute("aria-label")).join(" · "));
        const before = await steps();
        // A draft: a step more at the query's end.
        await builder.locator("[data-query-foot] button", { hasText: "Keep the first" }).click();
        await expect.poll(steps).not.toBe(before);
        const drafted = await steps();
        await expect(builder.locator("[data-query-save]")).toHaveAttribute("data-query-save", "unsaved");
        // Every state the steps are drawn in from here, as the page commits it.
        await builder.evaluate((root) => {
            const seen: string[] = [];
            const read = () => [...root.querySelectorAll("[data-step-id]")].map((el) => el.getAttribute("aria-label")).join(" · ");
            new MutationObserver(() => {
                const now = read();
                if (seen.at(-1) !== now) seen.push(now);
            }).observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
            (window as unknown as { stepsSeen: string[] }).stepsSeen = seen;
        });
        await builder.locator("[data-builder-frame] > [data-frame-slot=toolbar]").getByRole("button", { name: "Save", exact: true }).click();
        await expect(builder.locator("[data-query-save]")).toHaveAttribute("data-query-save", "saved", { timeout: 20_000 });
        await settled(page);
        const seen = await page.evaluate(() => (window as unknown as { stepsSeen: string[] }).stepsSeen);
        expect(seen.filter((state) => state !== drafted), `the steps went back to ${before}`).toEqual([]);
    });
});

test.describe("Query builder — its builder frame on a desktop (#1125 F3)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured at the desktop width");

    test("the pane is pinned: the results start where the open pane ends; no scrim", async ({ page }) => {
        const builder = await openBuilder(page);
        await expect.poll(async () => {
            const at = await frameAt(builder);
            const pane = at.start!;
            return {
                mode: pane.mode, collapsed: pane.collapsed, end: at.end,
                resultsFromPane: tenth(at.main.x - (pane.slot.x + pane.slot.w)),
                // The pane in its slot, in the flow.
                inSlot: within(pane.sheet, pane.slot),
                scrim: at.scrim,
            };
        }).toEqual({
            mode: "pinned", collapsed: false, end: null, resultsFromPane: 0,
            inSlot: { x: 0, y: 0, w: 480, h: expect.any(Number) }, scrim: null,
        });
    });
});

test.describe("Query builder on a phone (`Query Builder Phone Spec.md`)", () => {
    test.skip(({ isMobile }) => !isMobile, "measured on the phone");

    /** The phone's example, its result landed. */
    async function openPhone(page: Page): Promise<Locator> {
        const route = "e3/query/query/queryBuilderMobile";
        await page.goto(`/?theme=light#${route}`);
        const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${route}"]`) });
        await entry.scrollIntoViewIfNeeded();
        const frame = entry.locator("[data-builder-frame][data-phone]").first();
        await expect(frame.locator("[data-query-results-view]")).toBeVisible({ timeout: 20_000 });
        await settled(page);
        return frame;
    }
    /** What no popover may be, on this phone: nothing floats (the spec's Answers). */
    const nothingFloats = (page: Page) => expect(page.locator('[data-scope="popover"][data-part="content"][data-state="open"], [data-scope="menu"][data-part="content"][data-state="open"]')).toHaveCount(0);

    test("the result: the first row (QP1–QP4), This result (QP34), the pager and the columns (QP8–QP11, QP34), and the strip's three tabs (QP17)", async ({ page }) => {
        const frame = await openPhone(page);
        expect(await frame.evaluate((root) => {
            const row = root.querySelector("[data-query-phone-bar]")!.getBoundingClientRect();
            const seg = root.querySelector("[data-query-result-view]")!.getBoundingClientRect();
            const run = root.querySelector("[data-query-run] > span")!.getBoundingClientRect();
            const target = root.querySelector("[data-query-run]")!.getBoundingClientRect();
            return {
                row: row.height, seg: seg.height, runBox: run.height, runTarget: target.height, runFromEdge: Math.round(root.getBoundingClientRect().right - run.right),
                tabs: [...root.querySelectorAll('[data-frame-slot="paneStrip"] [role=tab]')].map((t) => t.getAttribute("data-pane-tab")),
                band: root.querySelector("[data-query-results-bar]") === null && root.querySelector("[data-query-results-footer]") === null && root.querySelector("[data-query-status]") === null,
            };
        })).toEqual({ row: 44, seg: 32, runBox: 32, runTarget: 44, runFromEdge: 12, tabs: ["start:query", "start:datasets", "start:library"], band: true });
        // This result: a view over the builder, holding the read-outs and the downloads.
        await frame.locator("[data-query-count]").click(); await settled(page);
        const result = frame.locator("[data-query-this-result]");
        await expect(result).toContainText("Top shipped orders, 2026");
        await expect(result.locator("[data-query-download-format]")).toHaveCount(2);
        expect((await result.locator("[data-query-download-format]").first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await nothingFloats(page);
        await page.keyboard.press("Escape"); await settled(page);
        await expect(result).toHaveCount(0);
        // The pager opens Columns as a view, the pinned column first and each with its kind.
        await frame.locator("[data-table-pager-range]").click(); await settled(page);
        const columns = frame.locator("[data-table-columns-view]");
        await expect(columns.locator("[data-table-pager-columns] > *").first()).toContainText("pinned");
        await nothingFloats(page);
        await columns.getByRole("button", { name: "Back to the result" }).click(); await settled(page);
    });

    test("the Query view: sentences, one clause open, a slot's picker a full-height view, ⋯ inline, the foot's Save… and Run (QP20–QP29, QP33); Esc goes back a level at a time", async ({ page }) => {
        const frame = await openPhone(page);
        await frame.locator("[data-pane-tab='start:query']").click(); await settled(page);
        const view = frame.locator("[data-query-phone-view]");
        await expect(view).toBeVisible();
        expect(await view.evaluate((root) => ({
            head: root.querySelector("[data-query-head]") !== null,
            clauses: [...root.querySelectorAll("[data-query-clause] > button")].every((b) => b.getBoundingClientRect().height >= 44),
            sideways: root.scrollWidth - root.clientWidth <= 1,
        }))).toEqual({ head: true, clauses: true, sideways: true });
        // One clause open at a time.
        const clauses = view.locator("[data-query-clause] > button");
        await clauses.nth(2).click(); await settled(page);
        await expect(view.locator("[data-query-clause-editor]")).toHaveCount(1);
        await clauses.nth(1).click(); await settled(page);
        await expect(view.locator("[data-query-clause-editor]")).toHaveCount(1);
        // Its slots: a 44 row each, and the picker a view over the whole frame.
        const slot = view.locator("[data-query-clause-editor] [data-slot-key]").first();
        expect((await slot.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await slot.click(); await settled(page);
        const picker = frame.locator("[data-query-view-picker]");
        const [p, f] = [(await picker.boundingBox())!, (await frame.boundingBox())!];
        expect([Math.round(p.width), Math.round(p.height)]).toEqual([Math.round(f.width), Math.round(f.height)]);
        expect(await picker.locator("[role=option]").evaluateAll((rows) => rows.every((r) => r.getBoundingClientRect().height >= 44))).toBe(true);
        await nothingFloats(page);
        // Esc closes the picker, and the Query view stays under it.
        await page.keyboard.press("Escape"); await settled(page);
        await expect(picker).toHaveCount(0);
        await expect(view).toBeVisible();
        // ⋯ opens the step's actions in the card; again, it closes them.
        const more = view.locator("[data-query-step-more]").first();
        await more.click(); await expect(view.locator("[data-query-step-actions]")).toHaveCount(1);
        await more.click(); await expect(view.locator("[data-query-step-actions]")).toHaveCount(0);
        // Save… is a view, its fields labelled, Cancel and Save equal halves; Esc leaves the Query view under it.
        await view.locator("[data-query-save-open]").click(); await settled(page);
        const save = frame.locator("[data-frame-view]");
        await expect(save.getByText("Description", { exact: true })).toBeVisible();
        const halves = await save.locator("[data-part], button").filter({ hasText: /^(Cancel|Save)$/ }).evaluateAll((els) => els.map((b) => Math.round(b.getBoundingClientRect().width)));
        expect(halves[0]).toBe(halves[1]);
        await nothingFloats(page);
        await page.keyboard.press("Escape"); await settled(page);
        await expect(view).toBeVisible();
        // jq: nothing scrolls sideways; a wrapped line's number stands on its first row.
        await view.locator("[data-query-view] button").nth(1).click(); await settled(page);
        expect(await view.locator("[data-query-jq-editor]").evaluate((root) => {
            const scroller = root.firstElementChild!;
            const rows = [...root.querySelectorAll("[data-query-jq-highlight] > *")].map((r) => r.getBoundingClientRect());
            const numbers = [...root.querySelectorAll("[data-query-jq-gutter] > *")].map((n) => n.getBoundingClientRect());
            return { sideways: scroller.scrollWidth - scroller.clientWidth, aligned: rows.every((r, i) => Math.abs(r.top - numbers[i]!.top) < 1) };
        })).toEqual({ sideways: 0, aligned: true });
        await view.locator("[data-query-view] button").nth(0).click(); await settled(page);
        // Run closes the view onto the result.
        await view.locator("[data-query-run]").click(); await settled(page);
        await expect(frame.locator("[data-frame-drawer][data-open]")).toHaveCount(0);
    });

    test("after an edit the result is stale: its band under the pager, Run again 44 (QP14); a new query opens on its steps and, closed, has nothing to read (QP15, QP38)", async ({ page }) => {
        const frame = await openPhone(page);
        await frame.locator("[data-pane-tab='start:query']").click(); await settled(page);
        await frame.locator("[data-query-step-more]").last().click();
        await frame.getByRole("button", { name: "Remove step" }).click(); await settled(page);
        await page.keyboard.press("Escape"); await settled(page);
        const stale = frame.locator('[data-tone="stale"]');
        await expect(stale).toBeVisible();
        const [pager, band] = [(await frame.locator("[data-table-pager]").boundingBox())!, (await stale.boundingBox())!];
        expect(band.y).toBeGreaterThanOrEqual(pager.y + pager.height - 1);
        expect((await frame.locator("[data-query-run-again]").boundingBox())!.height).toBeGreaterThanOrEqual(44);
        // Undone, the query is what ran again; a new query from Datasets.
        await frame.getByRole("button", { name: "Discard", exact: true }).click();
        await frame.locator("[data-history-discard-confirm]").click(); await settled(page);
        await frame.locator("[data-pane-tab='start:datasets']").click(); await settled(page);
        await frame.locator("[data-frame-drawer] [data-library-item]").filter({ hasText: "forecast" }).first().click(); await settled(page);
        await expect(frame.locator("[data-query-phone-view] [data-query-empty]")).toBeVisible();
        await page.keyboard.press("Escape"); await settled(page);
        await expect(frame.locator("[data-query-results-idle]")).toBeVisible();
        await expect(frame.locator("[data-query-count]")).toBeDisabled();
    });
});
