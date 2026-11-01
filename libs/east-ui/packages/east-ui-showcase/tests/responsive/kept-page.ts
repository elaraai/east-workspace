/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A page kept from one test to the next of a spec file (#1466). A test of a
 * spec that imports `test` from here gets the page its file's tests share,
 * reset as a fresh load would make it, rather than a browser context of its own
 * that loads the whole showcase and starts its e3 again: some five seconds of
 * each test.
 *
 * The page is marked kept before it first loads (`__showcaseKeptPage`), which
 * gives it the showcase's reset (`main.tsx`). A visit to the showcase's own
 * page — `/`, its query naming a theme at most — from that page sets the
 * address and draws the page afresh, its e3 a new session of copies of its
 * areas' workspaces; a visit anywhere else, or from a page whose document no
 * longer holds the showcase (`setContent`), loads the page. As each test starts
 * the page's storage goes, as a new browser context has none — and as each
 * ends, so a page made after it starts with none either — its viewport is its
 * project's again, and the mouse is off the page, as on a page no input has
 * reached yet.
 *
 * A test gets a page of its own when its spec file is not the last test's,
 * when the last test failed, or when the last test installed a script before
 * the page loads (`installE3Faults`): that script stays the page's, so a test
 * that installs one loads the page for real at its first visit, and the page
 * goes when the test ends.
 *
 * A spec that holds the clock, routes requests, emulates media, listens to the
 * page's events, reaches its context, reloads, or sets options of its own
 * (`test.use`) keeps Playwright's own `test`: a page made for it alone.
 */

import { test as base, type BrowserContext, type Page } from "playwright/test";

/** Whether an address is the showcase's own page, its query naming a theme at most: a visit the reset serves. */
function resettable(url: URL): boolean {
    return url.pathname === "/" && [...url.searchParams.keys()].every((key) => key === "theme");
}

/** The showcase's reset, as the page holds it: whether it reset the page. */
type Reset = (address: string) => boolean;

/** A worker's kept page: its context, the base its addresses resolve against, and the page with the spec file its tests are of. */
interface Kept {
    readonly context: BrowserContext;
    readonly base: string;
    page?: KeptPage;
}

/** The page a spec file's tests share, and whether a test installed a script on it before it loads. */
interface KeptPage {
    readonly page: Page;
    readonly file: string;
    scripted: boolean;
}

/** A page for the context, its visits to the showcase's own page served by the reset until a script is installed on it. */
async function keptPage(context: BrowserContext, base: string, file: string): Promise<KeptPage> {
    const page = await context.newPage();
    const kept: KeptPage = { page, file, scripted: false };
    // A script installed before the page loads runs at a load: the test's next visit loads the page for real.
    let load = false;
    const install = page.addInitScript.bind(page);
    page.addInitScript = async (...args: Parameters<Page["addInitScript"]>) => {
        kept.scripted = true;
        load = true;
        return install(...args);
    };
    const visit = page.goto.bind(page);
    page.goto = async (address, options) => {
        const target = new URL(address, base);
        const at = page.url();
        if (!load && at.startsWith(base) && resettable(new URL(at)) && resettable(target)
            && await page.evaluate((to) => (window as { __showcaseReset?: Reset }).__showcaseReset?.(to) === true, target.pathname + target.search + target.hash)) {
            return null;
        }
        load = false;
        // From the blank page a new page starts at: a visit to an address that differs from the page's by its hash alone would scroll, not load.
        if (at.startsWith(base)) await visit("about:blank");
        return visit(address, options);
    };
    return kept;
}

/** Clears a page's storage — the origin's, and the page's own — when it is on the showcase. */
async function clearStorage(page: Page, base: string): Promise<void> {
    if (!page.isClosed() && page.url().startsWith(base)) await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
}

export const test = base.extend<object, { kept: Kept }>({
    // Each fixture hands its value on through `serve`: Playwright's `use`, named apart from React's hook.
    kept: [async ({ browser }, serve, workerInfo) => {
        const { viewport, isMobile, hasTouch, deviceScaleFactor, baseURL, ignoreHTTPSErrors } = workerInfo.project.use;
        if (baseURL === undefined) throw new Error("a kept page resolves its addresses against the project's baseURL");
        const context = await browser.newContext({ viewport, isMobile, hasTouch, deviceScaleFactor, baseURL, ignoreHTTPSErrors });
        await context.addInitScript(() => {
            (window as { __showcaseKeptPage?: boolean }).__showcaseKeptPage = true;
        });
        // Playwright traces the context itself, each test a chunk, as the config's `retain-on-failure` asks.
        await serve({ context, base: new URL(baseURL).origin });
        await context.close();
    }, { scope: "worker" }],

    page: async ({ kept }, serve, testInfo) => {
        if (kept.page !== undefined && (kept.page.file !== testInfo.file || kept.page.page.isClosed())) {
            await kept.page.page.close();
            kept.page = undefined;
        }
        kept.page ??= await keptPage(kept.context, kept.base, testInfo.file);
        const { page } = kept.page;
        // As a new browser context has none: the page's storage, its viewport as its project has it, and no element under the mouse.
        await clearStorage(page, kept.base);
        const viewport = testInfo.project.use.viewport;
        if (viewport && (page.viewportSize()?.width !== viewport.width || page.viewportSize()?.height !== viewport.height)) await page.setViewportSize(viewport);
        await page.mouse.move(-1, -1);
        await serve(page);
        // The origin's storage, which a page the context makes next shares.
        await clearStorage(page, kept.base);
        // A test that failed, or installed a script before the page loads, leaves the next test a page of its own.
        if (kept.page.scripted || testInfo.status !== testInfo.expectedStatus) {
            await page.close();
            kept.page = undefined;
        }
    },
});
