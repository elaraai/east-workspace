/* eslint-disable */
/**
 * Full-bleed single-example screenshots of the Slice.* examples, for precise
 * visual audit against `design/slice.html`. One legible PNG per example to
 * `dist-examples/probe-slice-<name>.png` (not the down-scaled combined sheet).
 *
 * Run: pnpm --filter @elaraai/east-ui-components exec tsx scripts/probe-slice-examples.ts
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = path.resolve(__dirname, "../snapshot");
// Vite pre-bundles workspace deps into node_modules/.vite keyed by version, not
// dist mtime — so a freshly rebuilt @elaraai/east-ui(-components) is masked by a
// stale optimized bundle. Drop the cache so the probe always serves the latest dist.
fs.rmSync(path.resolve(__dirname, "../node_modules/.vite"), { recursive: true, force: true });

const EXAMPLES = [
    "sliceComposed", "sliceFrameNarrow", "sliceFrameFaceted", "sliceFrameFull", "sliceChartFrame",
    "sliceChartBar", "sliceChartArea", "sliceChartScatter", "sliceChartTime", "sliceChartLinearX",
    "sliceFilter", "sliceSearch", "sliceBreakdown", "sliceRange",
    "sliceCohort", "sliceLegend", "sliceSummary",
];

async function main() {
    const server = await createServer({ root: HARNESS_ROOT, server: { port: 0, host: "127.0.0.1" }, logLevel: "warn" });
    await server.listen();
    const addr = server.httpServer?.address();
    const port = server.config.server.port ?? (addr && typeof addr === "object" ? addr.port : 5173);
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`probing slice examples at ${baseUrl}`);

    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 640 } });
    const page = await ctx.newPage();
    page.on("pageerror", err => console.log("[pageerror]", err.message));
    await page.addInitScript(() => { (globalThis as any).__name = (globalThis as any).__name || ((f: any) => f); });

    for (const example of EXAMPLES) {
        try {
            await page.goto(`${baseUrl}/?file=${encodeURIComponent("slice/slice")}&example=${example}`, { waitUntil: "networkidle", timeout: 30_000 });
            await page.evaluate(() => (document as any).fonts.ready);
            await page.waitForTimeout(500);
            const out = path.resolve(__dirname, `../dist-examples/probe-slice-${example}.png`);
            await page.screenshot({ path: out, fullPage: true });
            console.log(`  shot: probe-slice-${example}.png`);
        } catch (e: any) {
            console.log(`  ERROR ${example}: ${e.message}`);
        }
    }
    await browser.close();
    await server.close();
}
main().catch(err => { console.error(err); process.exit(1); });
