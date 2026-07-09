/* eslint-disable */
/**
 * Mid-drag visual probe of the shared trash sink (#267): render the
 * rosterInteractive example in the snapshot harness, start a drag on a
 * proposed chip, and screenshot the live trash zone (bottom-centre,
 * `data-drop-valid`). Asserts the zone appears during the drag, never wears
 * `data-drop-invalid`, and unmounts on release.
 *
 * Run: pnpm --filter @elaraai/east-ui-components exec tsx scripts/probe-trash.ts
 */
import { createServer } from "vite";
import { launchChromium } from "../../../scripts/snapshot-capture.mts";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = path.resolve(__dirname, "../snapshot");

async function main() {
    const server = await createServer({ root: HARNESS_ROOT, server: { port: 0, host: "127.0.0.1" }, logLevel: "warn" });
    await server.listen();
    const addr = server.httpServer?.address();
    const port = server.config.server.port ?? (addr && typeof addr === "object" ? addr.port : 5173);
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`probing trash sink at ${baseUrl}`);

    const browser = await launchChromium({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1120, height: 700 } });
    const page = await ctx.newPage();
    page.on("pageerror", err => console.log("[pageerror]", err.message));
    await page.addInitScript(() => { (globalThis as any).__name = (globalThis as any).__name || ((f: any) => f); });

    await page.goto(`${baseUrl}/?file=${encodeURIComponent("collections/roster")}&example=rosterInteractive`, { waitUntil: "networkidle", timeout: 30_000 });
    await page.evaluate(() => (document as any).fonts.ready);
    await page.waitForSelector("[data-draggable]", { timeout: 15_000 });

    // Begin a drag on the first proposed chip and move off it.
    const chip = page.locator("[data-draggable]").first();
    const box = await chip.boundingBox();
    if (!box) throw new Error("no draggable chip box");
    await page.mouse.move(box.x + 8, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y + 120, { steps: 5 });
    await page.waitForSelector("[data-drag-trash]", { timeout: 5_000 });
    await page.waitForTimeout(250); // entrance animation

    const state = await page.evaluate(() => {
        const zone = document.querySelector("[data-drag-trash]");
        return {
            valid: zone?.hasAttribute("data-drop-valid") ?? false,
            invalid: zone?.hasAttribute("data-drop-invalid") ?? false,
        };
    });
    const out = path.resolve(__dirname, "../dist-examples/probe-trash-mid-drag.png");
    await page.screenshot({ path: out, fullPage: false });
    console.log(`mid-drag shot → ${out} · data-drop-valid=${state.valid} · data-drop-invalid=${state.invalid}`);
    if (!state.valid || state.invalid) throw new Error("trash zone stage attributes wrong");

    // Release away from any destination — the zone must unmount.
    await page.mouse.up();
    await page.waitForTimeout(150);
    const gone = await page.evaluate(() => document.querySelector("[data-drag-trash]") === null);
    console.log(`released · zone unmounted=${gone}`);
    if (!gone) throw new Error("trash zone did not unmount after release");

    await browser.close();
    await server.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
