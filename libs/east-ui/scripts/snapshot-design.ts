/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Renders every `*.html` under `libs/east-ui/design/` in headless Chromium
 * and writes two files per capture to `packages/east-ui-showcase/dist-design/`:
 *
 *   - a PNG screenshot of the element (`*.png`)
 *   - a self-contained HTML snippet (`*.html`) — the element's `outerHTML`
 *     with all readable page stylesheets inlined into a `<style>` block, plus
 *     any cross-origin CDN `<link>` tags preserved so the snippet renders
 *     standalone in any browser.
 *
 * Two capture targets per page:
 *   - every `.pattern` element  → `<slug>__pattern__<id-or-index>.{png,html}`
 *   - the `#brand-system` section (groups all `.bsys` rows on `index.html`)
 *                                → `<slug>__bsys.{png,html}`
 *
 * The design directory mixes plain HTML with a chart script that pulls
 * react / visx from `https://esm.sh` at runtime, so we serve over loopback
 * HTTP (Node's built-in `http`) rather than `file://` — relative assets
 * resolve and module imports work.
 *
 * @packageDocumentation
 */

import { chromium, type Browser } from "playwright";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../");
const DESIGN_DIR = path.resolve(ROOT, "./design");
const OUT_DIR = path.join(ROOT, "./dist-design");

const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".js":   "application/javascript; charset=utf-8",
    ".mjs":  "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg":  "image/svg+xml",
    ".woff2": "font/woff2",
};

function startStaticServer(root: string): Promise<{ port: number; close: () => Promise<void> }> {
    return new Promise(resolve => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url ?? "/", "http://x");
            const reqPath = decodeURIComponent(url.pathname);
            const safe = path.resolve(root, "." + reqPath);
            /* Reject any path-traversal attempt by rooting the resolution at `root`. */
            if (!safe.startsWith(root + path.sep) && safe !== root) {
                res.writeHead(403); res.end(); return;
            }
            fs.readFile(safe).then(data => {
                const ext = path.extname(safe).toLowerCase();
                res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
                res.end(data);
            }).catch(() => { res.writeHead(404); res.end(); });
        });
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            const port = (addr && typeof addr === "object") ? addr.port : 0;
            resolve({
                port,
                close: () => new Promise(r => server.close(() => r(undefined))),
            });
        });
    });
}

function sanitise(s: string): string {
    return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c] as string));
}

/**
 * Capture the element's `outerHTML` plus every readable CSS rule on the
 * page (cross-origin sheets like Font Awesome are CORS-blocked and stay
 * referenced via their original `<link>` tag instead). Returns a standalone
 * HTML document with the inlined CSS and any external stylesheet links
 * preserved — opens correctly under `file://` provided the CDN-hosted
 * stylesheets are reachable.
 */
async function captureSelfContainedHtml(
    el: import("playwright").Locator,
    title: string,
): Promise<string> {
    const captured = await el.evaluate(node => {
        const cssText = Array.from(document.styleSheets).map(sheet => {
            try {
                return Array.from(sheet.cssRules).map(r => (r as CSSRule).cssText).join("\n");
            } catch {
                /* CORS-blocked (cross-origin CDN sheet) — we keep its <link> below. */
                return "";
            }
        }).filter(Boolean).join("\n\n");

        const externalLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
            .map(l => (l as HTMLLinkElement).href)
            .filter(href => /^https?:/.test(href))
            .filter(href => !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(href));

        return {
            outerHtml: (node as HTMLElement).outerHTML,
            cssText,
            externalLinks,
        };
    });

    const links = captured.externalLinks
        .map(href => `<link rel="stylesheet" href="${escapeHtml(href)}">`)
        .join("\n");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
${links}
<style>
${captured.cssText}
</style>
</head>
<body>
${captured.outerHtml}
</body>
</html>
`;
}

async function writeSnapshotPair(
    el: import("playwright").Locator,
    pngPath: string,
    title: string,
): Promise<void> {
    await el.screenshot({ path: pngPath });
    const html = await captureSelfContainedHtml(el, title);
    await fs.writeFile(pngPath.replace(/\.png$/, ".html"), html, "utf8");
}

/**
 * One PNG per `.pattern` element on the page. Horizontal padding is
 * baked into the `.pattern` CSS rule in `design/spec.css`, so a tight
 * element screenshot already includes the side gutters.
 */
async function snapshotPatterns(
    page: import("playwright").Page,
    slug: string,
): Promise<number> {
    const handles = await page.locator(".pattern").all();
    let captured = 0;
    for (let i = 0; i < handles.length; i++) {
        const el = handles[i];
        const id = await el.getAttribute("id");
        const key = id ? sanitise(id) : `${i + 1}`;
        const out = path.join(OUT_DIR, `${slug}__pattern__${key}.png`);
        try {
            await writeSnapshotPair(el, out, `${slug} · pattern · ${key}`);
            captured++;
        } catch (err) {
            console.warn(`[snapshot-design]   skipped ${slug} .pattern#${key}:`, (err as Error).message);
        }
    }
    return captured;
}

/**
 * One combined PNG of the brand-system section (`#brand-system`) per page,
 * which contains every `.bsys` row in document order. Pages without the
 * section are skipped without warning.
 */
async function snapshotBsysSection(
    page: import("playwright").Page,
    slug: string,
): Promise<number> {
    const handles = await page.locator(".bsys").all();
    let captured = 0;
    for (let i = 0; i < handles.length; i++) {
        const el = handles[i];
        const id = await el.getAttribute("id");
        const key = id ? sanitise(id) : `${i + 1}`;
        const out = path.join(OUT_DIR, `${slug}__bsys__${key}.png`);
        try {
            await writeSnapshotPair(el, out, `${slug} · bsys · ${key}`);
            captured++;
        } catch (err) {
            console.warn(`[snapshot-design]   skipped ${slug} .bsys#${key}:`, (err as Error).message);
        }
    }
    return captured;
}

async function main(): Promise<void> {
    const allFiles = await fs.readdir(DESIGN_DIR);
    const pages = allFiles.filter(name => name.endsWith(".html")).sort();
    if (pages.length === 0) {
        console.error(`[snapshot-design] no HTML files in ${DESIGN_DIR}`);
        process.exit(2);
    }

    const { port, close } = await startStaticServer(DESIGN_DIR);
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`[snapshot-design] static server: ${baseUrl}  (root: ${path.relative(ROOT, DESIGN_DIR)})`);

    let browser: Browser | undefined;
    try {
        console.log(`[snapshot-design] launching chromium…`);
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
        await fs.mkdir(OUT_DIR, { recursive: true });

        let total = 0;
        for (const pageName of pages) {
            const slug = sanitise(pageName.replace(/\.html$/, ""));
            const url = `${baseUrl}/${pageName}`;
            const page = await context.newPage();
            try {
                await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
                await page.evaluate(() => document.fonts.ready);
                /* Charts pull react/visx from esm.sh and mount asynchronously —
                 * give the page a moment after networkidle for the final paint. */
                await page.waitForTimeout(500);

                const pat = await snapshotPatterns(page, slug);
                const bsys = await snapshotBsysSection(page, slug);
                console.log(`[snapshot-design] ${pageName}: .pattern=${pat} #brand-system=${bsys}`);
                total += pat + bsys;
            } catch (err) {
                console.warn(`[snapshot-design] FAILED ${pageName}:`, (err as Error).message);
            } finally {
                await page.close();
            }
        }
        console.log(`[snapshot-design] done — wrote ${total} images to ${path.relative(ROOT, OUT_DIR)}/`);
    } finally {
        await browser?.close();
        await close();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
