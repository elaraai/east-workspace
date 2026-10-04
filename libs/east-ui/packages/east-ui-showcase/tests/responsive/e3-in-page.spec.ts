/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The e3 the showcase runs in its page (#849), measured in a real browser.
 * The e3 examples read, write, page and call through e3-web — e3's storage,
 * runner and API on the page's own workers, the showcase's package deployed
 * and its dataflow run once — and nothing stands in for it:
 *
 * - a bound paged Plan lands its first units in key order, stands the units
 *   it has not read in one tail band, and lands the next windows where the
 *   band began, nothing on screen moving;
 * - an input written through one binding re-renders every reader of it;
 * - a function's result comes back from a unit worker;
 * - a record mutation commits, and every reader of the record follows;
 * - an edit staged against the e3 lives as long as the page, as the e3 does;
 * - a doc row the list mounts again shows its example at once;
 * - the isolated-file route starts the same e3;
 * - the page fetches its package at the URL the bundle carries, named by its
 *   content;
 * - an e3 that cannot start says why in the e3 examples' place, and the rest
 *   of the showcase is untouched; a Retry starts it again.
 *
 * Every measurement is polled until it holds, on a page at rest, never read
 * once after a fixed pause.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test e3-in-page --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";
import { openExample, rowId } from "./plan-page";

/** One example's entry in the doc list. */
function entryOf(page: Page, file: string, name: string): Locator {
    return page.locator("[data-index]", { has: page.locator(`a[href="#${file}/${name}"]`) });
}

/** The value of the Stat labelled `label` in an entry (a Stat is a `dl`: its
 *  label the `dt`, its value the first `dd`). */
function statValue(entry: Locator, label: string): Locator {
    return entry.locator("dl").filter({ has: entry.page().getByText(label, { exact: true }) }).locator("dd").first();
}

/** Open an e3 example's page and return its entry, at rest — e3 started and
 *  what the example reads loaded. */
async function openEntry(page: Page, file: string, name: string): Promise<Locator> {
    await page.goto(`/?theme=light#${file}/${name}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = entryOf(page, file, name);
    await entry.scrollIntoViewIfNeeded();
    await settled(page);
    return entry;
}

/** Every mounted canvas row of a Plan entry, in order: its id's text and its
 *  top, from the top of the canvas's extent. */
function rowsOf(entry: Locator): Promise<{ id: string; top: number }[]> {
    return entry.evaluate((root) => {
        const extent = root.querySelector("[data-virtual-extent]")!;
        const origin = extent.getBoundingClientRect().top;
        return [...extent.querySelectorAll("[data-plan-row]")].map((el) => ({
            id: el.getAttribute("data-plan-row")!,
            top: Math.round(el.getBoundingClientRect().top - origin),
        }));
    });
}

/** Every mounted unloaded band of a Plan entry: which end of its block, the
 *  units it stands for, its height as the ledger gives it and as it renders,
 *  where it starts in the extent, and what it says. */
function bandsOf(entry: Locator): Promise<{ at: string; elements: number; px: number; height: number; top: number; caption: string }[]> {
    return entry.evaluate((root) => {
        const origin = root.querySelector("[data-virtual-extent]")!.getBoundingClientRect().top;
        return [...root.querySelectorAll("[data-plan-window-band]")].map((el) => {
            const box = el.getBoundingClientRect();
            return {
                at: el.getAttribute("data-plan-window-band")!,
                elements: Number(el.getAttribute("data-plan-elements")),
                px: Number(el.getAttribute("data-plan-px")),
                height: Math.round(box.height),
                top: Math.round(box.top - origin),
                caption: el.textContent ?? "",
            };
        });
    });
}

test.describe("the showcase's e3, in the page (#849)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    test("a bound paged Plan lands its first units in key order, stands the rest in one tail band, and lands the next windows where the band began", async ({ page }) => {
        // `dataBindPagedBlocks`: the 3,000 units an e3 task generates, two
        // series over them — two blocks of 3,000 32px rows, read 200 units a
        // window.
        const ROW = 32;
        const BLOCK = 3_000 * ROW;
        const entry = await openExample(page, "dataBindPagedBlocks", "e3/bind/data/data");
        const frame = entry.locator('[data-virtual-rows="bounded"]');
        const transport = entry.locator('[data-slot="footerTransport"]');
        const scrollTo = async (top: number) => {
            await frame.evaluate((el, at) => { el.scrollTop = at; }, top);
            await settled(page);
        };

        // The first landing: three windows, the units in key order from the
        // top of the canvas, a row each.
        await expect(transport).toHaveText("600 loaded of 3,000");
        await expect(entry.locator("[data-virtual-extent]")).toHaveAttribute("data-virtual-extent", String(2 * BLOCK));
        const first = Array.from({ length: 10 }, (_, i) => ({ id: rowId("jobs", `U${10_000 + i}`), top: i * ROW }));
        await expect.poll(async () => (await rowsOf(entry)).slice(0, 10)).toEqual(first);

        // The loads block's first row at the top of the frame: the jobs block's
        // tail band sits just above it — the 2,400 units it has not read, a
        // row's height each, from where its landed rows end to where the next
        // block begins.
        await scrollTo(BLOCK);
        await expect.poll(() => bandsOf(entry)).toEqual([{
            at: "tail", elements: 2_400, px: 2_400 * ROW, height: 2_400 * ROW, top: 600 * ROW,
            caption: "2,400 more elements — scroll to load",
        }]);

        // Up to where the band begins: the next windows land there, unit 600's
        // row exactly where the band's top was, and the frame does not move.
        await scrollTo(600 * ROW);
        await expect(transport).toHaveText("1,200 loaded of 3,000");
        await expect.poll(async () => (await rowsOf(entry)).find((r) => r.id === rowId("jobs", "U10600"))?.top).toBe(600 * ROW);
        expect(await frame.evaluate((el) => el.scrollTop)).toBe(600 * ROW);

        // The band gave up exactly the units that landed.
        await scrollTo(BLOCK);
        await expect.poll(() => bandsOf(entry)).toEqual([{
            at: "tail", elements: 1_800, px: 1_800 * ROW, height: 1_800 * ROW, top: 1_200 * ROW,
            caption: "1,800 more elements — scroll to load",
        }]);
    });

    test("an input written through one binding re-renders every reader of it — its own, the next example's, and one that mounts after the write", async ({ page }) => {
        const file = "e3/bind/data/data";
        // `dataBindVariants` writes the `threshold` input from its slider and
        // reads it back below (HAS GUARD); `dataBindStagedVariants`, just above
        // it, reads it as the server's value; `dataBindFloat` shows it.
        const variants = await openEntry(page, file, "dataBindVariants");
        const staged = entryOf(page, file, "dataBindStagedVariants");
        await expect(variants.getByText("50.0", { exact: true })).toBeVisible();
        await expect(statValue(staged, "Server")).toHaveText("50");

        const slider = variants.getByRole("slider").first();
        await slider.focus();
        await page.keyboard.press("ArrowRight");
        await expect(slider).toHaveAttribute("aria-valuenow", "51");
        await expect(variants.getByText("51.0", { exact: true })).toBeVisible();
        await expect(statValue(staged, "Server")).toHaveText("51");
        await settled(page);

        // A reader that mounts after the write reads it too.
        await page.goto(`/?theme=light#${file}/dataBindFloat`);
        const float = entryOf(page, file, "dataBindFloat");
        await float.scrollIntoViewIfNeeded();
        await settled(page);
        await expect(statValue(float, "Threshold")).toHaveText("51");
        // And the writer's own reader still shows it, at rest.
        await page.goto(`/?theme=light#${file}/dataBindVariants`);
        await variants.scrollIntoViewIfNeeded();
        await settled(page);
        await expect(variants.getByText("51.0", { exact: true })).toBeVisible();
    });

    test("a function's result comes back from a unit worker, and every handle on its channel shows it", async ({ page }) => {
        const file = "e3/bind/func/func";
        // `funcBindStatus` renders the call's lifecycle and, below it, the
        // result it read (printed by East); the page's other `forecast`
        // handles share its channel.
        const status = await openEntry(page, file, "funcBindStatus");
        await expect(status.getByText("IDLE", { exact: true })).toBeVisible();
        await expect(status.getByText(".none", { exact: true })).toBeVisible();
        await status.getByRole("button", { name: "Run forecast" }).click();
        await expect(status.getByText("SUCCEEDED", { exact: true })).toBeVisible();
        // `forecast(12, 1.05)` returns its growth argument.
        await expect(status.getByText(".some 1.05", { exact: true })).toBeVisible();
        const call = entryOf(page, file, "funcBindCall");
        await call.scrollIntoViewIfNeeded();
        await expect(statValue(call, "Forecast")).toHaveText(".some 1.05");
    });

    test("a record mutation commits, and every reader of the record follows — its value and its history", async ({ page }) => {
        const file = "e3/bind/record/record";
        // `recordBindMutate` applies the `counter` record's mutations;
        // `recordBindHistory` reads the record and its commit chain.
        const mutate = await openEntry(page, file, "recordBindMutate");
        await expect(statValue(mutate, "Counter")).toHaveText("0");
        await expect(mutate.getByText("IDLE", { exact: true })).toBeVisible();
        await mutate.getByRole("button", { name: "Increment" }).click();
        await expect(mutate.getByText("COMMITTED", { exact: true })).toBeVisible();
        // The commit is e3's: the record's value comes back from it.
        await expect(statValue(mutate, "Counter")).toHaveText("1");
        const history = entryOf(page, file, "recordBindHistory");
        await history.scrollIntoViewIfNeeded();
        await settled(page);
        await expect(statValue(history, "Counter")).toHaveText("1");
        // The deploy's commit, and the increment.
        await expect(history.getByText("2 COMMITS", { exact: true })).toBeVisible();
    });

    test("an edit staged against the page's e3 lives as long as the page does: after a reload, the stage reads the server's value", async ({ page }) => {
        const file = "e3/bind/data/data";
        // `dataBindStagedVariants`' slider writes the `threshold` input's
        // staged buffer; "Live (with stage)" reads it over the server's value.
        const staged = await openEntry(page, file, "dataBindStagedVariants");
        await expect(statValue(staged, "Server")).toHaveText("50");
        await expect(statValue(staged, "Live (with stage)")).toHaveText("50");
        const slider = staged.getByRole("slider").first();
        await slider.focus();
        await page.keyboard.press("ArrowRight");
        await expect(statValue(staged, "Live (with stage)")).toHaveText("51");
        await expect(statValue(staged, "Server")).toHaveText("50");
        // The page reloads, and its e3 starts afresh from its package: the
        // edit staged against the last one went with it.
        await page.reload();
        await page.waitForSelector("header", { timeout: 20_000 });
        const again = entryOf(page, file, "dataBindStagedVariants");
        await again.scrollIntoViewIfNeeded();
        await settled(page);
        await expect(statValue(again, "Server")).toHaveText("50");
        await expect(statValue(again, "Live (with stage)")).toHaveText("50");
    });

    test("the isolated-file route starts the same e3: an e3 file's examples run against it", async ({ page }) => {
        await page.goto("/?theme=light&file=e3/bind/func/func");
        await settled(page);
        await expect(page.locator("[data-e3-start]")).toHaveCount(0);
        await expect(page.getByText("IDLE", { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Run forecast" }).first().click();
        await expect(page.getByText("SUCCEEDED", { exact: true })).toBeVisible();
        await expect(page.getByText(".some 1.05", { exact: true }).first()).toBeVisible();
    });

    test("a doc row the list mounts again renders its example in its first paint — never the starting line", async ({ page }) => {
        // Every e3 example, one after another: the doc list mounts a row as it
        // nears the view, and unmounts it once it is far.
        await page.goto("/?theme=light#all-e3-components");
        await page.waitForSelector("header", { timeout: 20_000 });
        await settled(page);
        /** Scrolls the doc list to its end — and back, when asked — a view at
         *  a time, and counts the starting lines in every frame. A step of the
         *  list's own height brings every row into view on the fewest frames:
         *  the sweep's time grows with the e3 catalog, which it walks whole. */
        const sweep = (back: boolean) => page.evaluate(async (back) => {
            // The doc list scrolls the first doc row's grandparent.
            const list = document.querySelector("[data-index]")!.parentElement!.parentElement!;
            const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            let starting = 0;
            const count = () => { starting += document.querySelectorAll('[data-e3-start="starting"]').length; };
            const step = list.clientHeight;
            for (let y = 0; y <= list.scrollHeight; y += step) { list.scrollTop = y; await frame(); count(); }
            if (back) for (let y = list.scrollHeight; y >= 0; y -= step) { list.scrollTop = y; await frame(); count(); }
            return starting;
        }, back);
        // The first sweep, down the list, mounts every example, and loads what each reads.
        await sweep(false);
        await settled(page);
        // Every row the second sweep mounts again, down and back, shows its example at once.
        expect(await sweep(true)).toBe(0);
    });

    test("the page fetches its package at the URL the bundle carries — the zip named by its content", async ({ page }) => {
        const fetched: { path: string; status: number }[] = [];
        page.on("response", (response) => {
            const url = new URL(response.url());
            if (url.pathname.includes("e3-showcase")) fetched.push({ path: url.pathname, status: response.status() });
        });
        const status = await openEntry(page, "e3/bind/func/func", "funcBindStatus");
        await expect(status.getByText("IDLE", { exact: true })).toBeVisible();
        expect(fetched).toHaveLength(1);
        expect(fetched[0]!.path).toMatch(/^\/assets\/e3-showcase-[\w-]{8,}\.zip$/);
        expect(fetched[0]!.status).toBe(200);
    });

    test("an e3 that cannot start says why in the e3 examples' place, and the rest of the showcase is untouched", async ({ page }) => {
        // The package the page's e3 imports cannot be fetched.
        await page.route("**/e3-showcase*.zip", (route) => route.fulfill({ status: 503, body: "the package is away" }));
        const entry = await openEntry(page, "e3/bind/func/func", "funcBindStatus");
        const failed = entry.locator('[data-e3-start="failed"]');
        await expect(failed).toContainText("e3 did not start in this page");
        await expect(failed).toContainText(
            /could not fetch its package: \S+\/e3-showcase-[\w-]+\.zip answered 503 Service Unavailable: the package is away/);
        // An East page renders as ever: no e3 example on it, no error, and its
        // example on screen.
        await page.goto("/?theme=light#buttons/button");
        await page.waitForSelector("header", { timeout: 20_000 });
        const button = entryOf(page, "buttons/button", "buttonBasic");
        await button.scrollIntoViewIfNeeded();
        await settled(page);
        await expect(button.getByRole("button", { name: "Click me" })).toBeVisible();
        await expect(page.locator("[data-e3-start]")).toHaveCount(0);
        await expect(page.locator("[data-showcase-error]")).toHaveCount(0);
    });

    test("a start that failed is tried again by its Retry: e3 starts, and the e3 examples run against it", async ({ page }) => {
        // The package cannot be fetched — until it can.
        let away = true;
        await page.route("**/e3-showcase*.zip", (route) => (away
            ? route.fulfill({ status: 503, body: "the package is away" })
            : route.continue()));
        const file = "e3/bind/func/func";
        const status = await openEntry(page, file, "funcBindStatus");
        await expect(status.locator('[data-e3-start="failed"]')).toContainText("e3 did not start in this page");
        away = false;
        await status.getByRole("button", { name: "Retry" }).click();
        await settled(page);
        await expect(page.locator("[data-e3-start]")).toHaveCount(0);
        // Every e3 example on the page runs against the e3 the Retry started.
        await expect(status.getByText("IDLE", { exact: true })).toBeVisible();
        await status.getByRole("button", { name: "Run forecast" }).click();
        await expect(status.getByText(".some 1.05", { exact: true })).toBeVisible();
        const call = entryOf(page, file, "funcBindCall");
        await call.scrollIntoViewIfNeeded();
        await expect(statValue(call, "Forecast")).toHaveText(".some 1.05");
    });
});
