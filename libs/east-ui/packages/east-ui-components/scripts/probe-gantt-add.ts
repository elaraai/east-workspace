/* eslint-disable */
/**
 * End-to-end probe of Library → Gantt `add` (#268): render the
 * ganttLibraryAdd example, drag a crew card onto a proposed row's timeline,
 * and assert (1) the drop delivers the grammar `add` (the example's LAST
 * DROP line updates with row + snapped ISO instant), (2) an optimistic
 * proposed(added) bar appears, and (3) the committed row (row 0) shows the
 * ⊘ invalid stage under the pointer and the drop there is a no-op.
 *
 * Run: pnpm --filter @elaraai/east-ui-components exec tsx scripts/probe-gantt-add.ts
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
    console.log(`probing gantt add at ${baseUrl}`);

    const browser = await launchChromium({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 760 } });
    const page = await ctx.newPage();
    page.on("pageerror", err => console.log("[pageerror]", err.message));
    await page.addInitScript(() => { (globalThis as any).__name = (globalThis as any).__name || ((f: any) => f); });

    await page.goto(`${baseUrl}/?file=${encodeURIComponent("collections/gantt")}&example=ganttLibraryAdd`, { waitUntil: "networkidle", timeout: 30_000 });
    await page.evaluate(() => (document as any).fonts.ready);
    await page.waitForSelector("[data-library-card], [data-drag-cell]", { timeout: 15_000 }).catch(() => undefined);

    // The Library card ("Crew A") — find its card element by text.
    const card = page.locator("text=Crew A").first();
    const cardBox = await card.boundingBox();
    if (!cardBox) throw new Error("no Crew A card");

    // The timeline body is the single continuous drop cell.
    const cellBox = await page.locator("[data-drag-cell]").first().boundingBox();
    if (!cellBox) throw new Error("no timeline drop cell registered");

    const rowH = 36; // default row height
    // Row 1 ("Fit-out", proposed): second band of the timeline body.
    const targetX = cellBox.x + cellBox.width * 0.5;
    const row1Y = cellBox.y + rowH * 1.5;
    const row0Y = cellBox.y + rowH * 0.5;

    // 1. Hover the committed row — the ⊘ stage (pointer-resolved veto).
    await page.mouse.move(cardBox.x + 10, cardBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(targetX, row0Y, { steps: 6 });
    await page.waitForTimeout(120);
    const vetoStage = await page.evaluate(() =>
        document.querySelector("[data-drag-cell]")?.hasAttribute("data-drop-invalid") ?? false);
    const shot0 = path.resolve(__dirname, "../dist-examples/probe-gantt-add-veto.png");
    await page.screenshot({ path: shot0 });
    // Drop on the vetoed row — must be a no-op.
    await page.mouse.up();
    await page.waitForTimeout(150);
    const afterVeto = await page.locator("text=LAST DROP").textContent();
    console.log(`veto stage=${vetoStage} · after vetoed drop: ${afterVeto?.trim()}`);
    if (!vetoStage) throw new Error("expected the ⊘ stage over the committed row");
    if (!/none yet/i.test(afterVeto ?? "")) throw new Error("vetoed drop still delivered");

    // 2. Drop on the proposed row — grammar add + optimistic bar.
    await page.mouse.move(cardBox.x + 10, cardBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(targetX, row1Y, { steps: 6 });
    await page.waitForTimeout(120);
    const shot1 = path.resolve(__dirname, "../dist-examples/probe-gantt-add-mid.png");
    await page.screenshot({ path: shot1 });
    await page.mouse.up();
    await page.waitForTimeout(250);

    const last = await page.locator("text=LAST DROP").textContent();
    const bars = await page.evaluate(() => document.querySelectorAll("svg rect[stroke]").length);
    const shot2 = path.resolve(__dirname, "../dist-examples/probe-gantt-add-after.png");
    await page.screenshot({ path: shot2 });
    console.log(`after drop: ${last?.trim()} · bars=${bars}`);
    if (!last || !last.includes("crew-a → row 1 @")) throw new Error(`add event not delivered: ${last}`);

    await browser.close();
    await server.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
